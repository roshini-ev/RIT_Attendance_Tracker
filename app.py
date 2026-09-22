"""
Rajalakshmi Institute of Technology (RIT)
Staff location attendance - mobile web app.

No admin/role-based login exists. Staff log in, tap PUSH once, done.
Every successful push appends a row (Staff ID, Time, Block) to the Excel
sheet. Anyone who has the link can open/download it (no login):

    http://<this-pc-ip>:3000/excel

The same file lives on this computer as staff_presence.xlsx.

Run:
    pip install -r requirements.txt
    python app.py

Staff:  http://<this-pc-ip>:3000
"""

import io
import json
import os
import re
import socket
import tempfile
import urllib.request
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from flask import (
    Flask,
    has_request_context,
    jsonify,
    redirect,
    render_template,
    render_template_string,
    request,
    send_file,
    session,
    url_for,
)
from openpyxl import Workbook, load_workbook

from geofence import detect_location

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "rit-attendance-dummy-secret-key-2026")
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=30)

DUMMY_STAFF = {f"STAFF{i:03d}": "staff123" for i in range(1, 51)}
DUMMY_STAFF["HOD01"] = "staff123"

EXCEL_HEADERS = ["Staff ID", "Time", "Block"]

# Indian Standard Time (IST, UTC+05:30) for precise daily cutoff at 00:00 midnight
IST = timezone(timedelta(hours=5, minutes=30))


def get_ist_now() -> datetime:
    """Return the current datetime in Indian Standard Time (IST)."""
    return datetime.now(IST)


def get_today_ist() -> str:
    """Return today's date formatted as YYYY-MM-DD in IST."""
    return get_ist_now().strftime("%Y-%m-%d")


# In-memory attendance records and daily pushed staff tracking (staff_id -> YYYY-MM-DD)
attendance_records = []
pushed_today = {}


def get_persisted_pushes() -> dict:
    """Read pushes saved in /tmp/rit_data/pushes.json to survive intra-day serverless restarts."""
    try:
        pushes_file = os.path.join(tempfile.gettempdir(), "rit_data", "pushes.json")
        if os.path.exists(pushes_file):
            with open(pushes_file, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def has_pushed_today(staff_id: str) -> bool:
    """Check if the staff member has already recorded attendance today (once per day rule)."""
    if not staff_id:
        return False
    sid = str(staff_id).strip().upper()
    today = get_today_ist()

    # 1. In-memory dictionary for today
    if pushed_today.get(sid) == today:
        return True

    # 2. Staff phone session cookie (persists across tab and browser reopens on the staff phone)
    if has_request_context():
        if session.get("staff_id") == sid and session.get("last_pushed_date") == today:
            pushed_today[sid] = today
            return True

    # 3. Serverless temp file cache
    persisted = get_persisted_pushes()
    if sid in persisted and persisted[sid].get("date") == today:
        pushed_today[sid] = today
        return True

    return False


def record_push_today(staff_id: str, timestamp: str, block: str, lat: float = None, lon: float = None):
    """Mark a staff member as having pushed today."""
    sid = str(staff_id).strip().upper()
    today = get_today_ist()

    pushed_today[sid] = today
    if has_request_context():
        session["last_pushed_date"] = today
        session.permanent = True

    try:
        data_dir = os.path.join(tempfile.gettempdir(), "rit_data")
        os.makedirs(data_dir, exist_ok=True)
        pushes_file = os.path.join(data_dir, "pushes.json")
        pushes_data = get_persisted_pushes()
        entry = {
            "staffId": sid,
            "date": today,
            "timestamp": timestamp,
            "location": block,
        }
        if lat is not None and lon is not None:
            entry["latitude"] = lat
            entry["longitude"] = lon
        pushes_data[sid] = entry
        with open(pushes_file, "w", encoding="utf-8") as f:
            json.dump(pushes_data, f, indent=2)
    except Exception:
        pass


# Default Google Sheets Webhook URL (verified working Apps Script web app)
DEFAULT_GOOGLE_SHEET_WEBHOOK = "https://script.google.com/macros/s/AKfycbwre5bpwFPjLs7PmAMNvdfaZzx1LgYjP8UbUHghUsuJgnGAO3himq9MUethM1xZPyqW/exec"


def get_google_sheet_webhook() -> str:
    """Retrieve the Google Sheet webhook URL from env, file, or default fallback."""
    url = os.environ.get("GOOGLE_SHEET_WEBHOOK", "").strip()
    if url:
        return url
    hook_file = os.path.join(os.path.dirname(__file__), "google_sheet_webhook.txt")
    if os.path.exists(hook_file):
        try:
            with open(hook_file, encoding="utf-8") as fh:
                content = fh.read().strip()
                if content:
                    return content
        except OSError:
            pass
    return DEFAULT_GOOGLE_SHEET_WEBHOOK


def sync_to_google_sheet(staff_id: str, timestamp: str, block: str) -> bool:
    """Append one punch row to the linked Google Sheet via its Apps Script webhook.

    Uses standard urllib.request which automatically follows Google Apps Script
    302 redirects with GET to complete the request successfully.
    """
    webhook_url = get_google_sheet_webhook()
    if not webhook_url:
        print("[Google Sheet] No webhook URL configured")
        return False

    payload = json.dumps({
        "staff_id": staff_id,
        "time": timestamp,
        "block": block,
    }).encode("utf-8")

    req = urllib.request.Request(
        webhook_url,
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            body = resp.read().decode("utf-8", errors="ignore")
            print(f"[Google Sheet] Synced {staff_id} ({timestamp}, {block}): HTTP {resp.status} - {body}")
            return True
    except Exception as e:
        print(f"[Google Sheet] Sync failed for {staff_id}: {e}")
        return False


def authenticate_staff(staff_id: str, password: str) -> bool:
    sid = str(staff_id).strip().upper()
    pwd = str(password).strip()
    if sid in DUMMY_STAFF and DUMMY_STAFF[sid] == pwd:
        return True
    if re.match(r"^STAFF\d+$", sid) and pwd == "staff123":
        return True
    return False




def get_excel_file_path() -> str:
    """Return a writable file path for staff_presence.xlsx.
    Uses local directory if writable, falls back to /tmp for read-only serverless environments.
    """
    local_path = os.path.join(os.path.dirname(__file__), "staff_presence.xlsx")
    test_file = os.path.join(os.path.dirname(__file__), ".write_test")
    try:
        with open(test_file, "w") as f:
            f.write("ok")
        os.remove(test_file)
        return local_path
    except (OSError, PermissionError):
        pass

    tmp_path = os.path.join(tempfile.gettempdir(), "staff_presence.xlsx")
    if not os.path.exists(tmp_path) and os.path.exists(local_path):
        try:
            import shutil
            shutil.copy2(local_path, tmp_path)
        except Exception:
            pass
    return tmp_path


def init_excel_file():
    """Load existing rows from staff_presence.xlsx into memory and ensure file exists."""
    global attendance_records
    attendance_records = []

    excel_path = os.path.join(os.path.dirname(__file__), "staff_presence.xlsx")
    if not os.path.exists(excel_path):
        excel_path = get_excel_file_path()

    if os.path.exists(excel_path):
        try:
            wb = load_workbook(excel_path)
            ws = wb.active
            header = [str(c).strip() if c is not None else "" for c in next(ws.iter_rows(min_row=1, max_row=1, values_only=True))]
            for row in ws.iter_rows(min_row=2, values_only=True):
                if not row or not row[0]:
                    continue
                sid = str(row[0]).strip().upper()
                if header[:3] == EXCEL_HEADERS:
                    time_val = str(row[1]) if len(row) > 1 and row[1] is not None else ""
                    block = str(row[2]) if len(row) > 2 and row[2] is not None else "Outside"
                else:
                    time_val = str(row[1]) if len(row) > 1 and row[1] is not None else ""
                    block = str(row[4] if len(row) > 4 else (row[2] if len(row) > 2 else "Outside"))
                attendance_records.append({"staff_id": sid, "time": time_val, "block": block})
        except Exception as e:
            print(f"Error inspecting Excel file: {e}")

    # Ensure writable Excel file is ready
    writable_path = get_excel_file_path()
    try:
        if not os.path.exists(writable_path):
            wb = Workbook()
            ws = wb.active
            ws.title = "Staff Presence"
            ws.append(EXCEL_HEADERS)
            for r in attendance_records:
                ws.append([r["staff_id"], r["time"], r["block"]])
            wb.save(writable_path)
    except Exception as e:
        print(f"Note: Could not write Excel to disk ({e}), will use in-memory generation.")


def append_excel_record(staff_id: str, timestamp: str, block: str):
    """Append a record to in-memory store and to disk Excel file if possible."""
    attendance_records.append({"staff_id": staff_id, "time": timestamp, "block": block})

    writable_path = get_excel_file_path()
    try:
        if not os.path.exists(writable_path):
            wb = Workbook()
            ws = wb.active
            ws.title = "Staff Presence"
            ws.append(EXCEL_HEADERS)
        else:
            wb = load_workbook(writable_path)
            ws = wb.active
        ws.append([staff_id, timestamp, block])
        wb.save(writable_path)
    except Exception as e:
        print(f"[Excel] Disk write skipped ({e}), preserved in memory.")


init_excel_file()


@app.route("/")
def index():
    if session.get("staff_id"):
        return redirect(url_for("staff_screen"))
    return redirect(url_for("login"))


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        staff_id = request.form.get("staff_id", "").strip().upper()
        password = request.form.get("password", "").strip()
        if authenticate_staff(staff_id, password):
            session["staff_id"] = staff_id
            session.permanent = True
            return redirect(url_for("staff_screen"))
        return render_template("login.html", error="Invalid Staff ID or Password")
    return render_template("login.html")


@app.route("/api/login", methods=["POST"])
def api_login():
    """JSON login endpoint for React / mobile clients."""
    data = request.get_json() or {}
    staff_id = data.get("staffId") or data.get("staff_id", "")
    password = data.get("password", "")
    sid = str(staff_id).strip().upper()

    if not sid or not password:
        return jsonify({"success": False, "message": "Staff ID and password required"}), 400

    if authenticate_staff(sid, str(password)):
        session["staff_id"] = sid
        session.permanent = True
        return jsonify({
            "success": True,
            "staffId": sid,
            "alreadyPushed": has_pushed_today(sid),
        })
    return jsonify({"success": False, "message": "Invalid Staff ID or Password"}), 401


@app.route("/staff")
def staff_screen():
    sid = session.get("staff_id")
    if not sid:
        return redirect(url_for("login"))
    return render_template("staff.html", staff_id=sid, has_pushed=has_pushed_today(sid))


@app.route("/api/status", methods=["GET"])
def api_status():
    """Check whether a staff member has already pushed today."""
    staff_id = request.args.get("staffId") or request.args.get("staff_id", "")
    sid = str(staff_id).strip().upper()
    if not sid:
        return jsonify({"success": False, "message": "staffId query parameter required"}), 400
    return jsonify({
        "success": True,
        "staffId": sid,
        "pushed": has_pushed_today(sid),
    })


@app.route("/api/push", methods=["POST"])
def api_push():
    data = request.get_json() or {}
    staff_id = session.get("staff_id") or data.get("staffId") or data.get("staff_id")
    if not staff_id:
        return jsonify({"success": False, "error": "Not authenticated"}), 401

    staff_id = str(staff_id).strip().upper()
    if has_pushed_today(staff_id):
        return jsonify({
            "success": False,
            "error": "You have already recorded your attendance for today.",
            "alreadyPushed": True,
        }), 400

    latitude = data.get("latitude")
    longitude = data.get("longitude")
    if latitude is None or longitude is None:
        return jsonify({"success": False, "error": "Location coordinates required"}), 400

    try:
        lat = float(latitude)
        lon = float(longitude)
    except (ValueError, TypeError):
        return jsonify({"success": False, "error": "Invalid coordinates format"}), 400

    block = detect_location(lat, lon)
    timestamp = get_ist_now().strftime("%H:%M:%S")

    print(f"[PUSH] Staff: {staff_id} | GPS: ({lat:.7f}, {lon:.7f}) | Block: {block}")

    # 1. Mark staff as pushed today and append to stores
    record_push_today(staff_id, timestamp, block, lat, lon)
    append_excel_record(staff_id, timestamp, block)

    # 2. Sync immediately to Google Sheets (live cloud sync for phone and PC)
    sheet_synced = False
    try:
        sheet_synced = sync_to_google_sheet(staff_id, timestamp, block)
    except Exception as e:
        print(f"[Google Sheet] Sync exception for {staff_id}: {e}")

    return jsonify({
        "success": True,
        "status": "PUSHED",
        "staff_id": staff_id,
        "time": timestamp,
        "block": block,
        "google_sheet_synced": sheet_synced,
    })


@app.route("/api/records", methods=["GET"])
def api_records():
    """Return all recorded punches in JSON format."""
    return jsonify({
        "success": True,
        "count": len(attendance_records),
        "records": attendance_records,
    })


@app.route("/excel")
@app.route("/api/download-excel")
def shared_excel():
    """Serve the live Excel sheet as a dynamically generated .xlsx download.
    Generates workbook in memory for 100% serverless and multi-platform reliability.
    """
    wb = Workbook()
    ws = wb.active
    ws.title = "Staff Presence"
    ws.append(EXCEL_HEADERS)

    for r in attendance_records:
        ws.append([r.get("staff_id", ""), r.get("time", ""), r.get("block", "")])

    bio = io.BytesIO()
    wb.save(bio)
    bio.seek(0)

    response = send_file(
        bio,
        as_attachment=True,
        download_name="staff_presence.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return response


@app.route("/attendance")
def attendance_dashboard():
    """Live Attendance View."""
    html = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RIT Attendance Monitor</title>
  <link rel="stylesheet" href="/static/style.css">
  <style>
    .monitor-wrap { max-width: 760px; margin: 2rem auto; padding: 1.5rem; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .monitor-card { background: #fff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); padding: 1.5rem; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: #e0f2fe; color: #0369a1; }
    .btn-row { display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 1.25rem 0; align-items: center; }
    .btn-action { display: inline-flex; align-items: center; padding: 0.6rem 1.2rem; border-radius: 8px; font-size: 14px; font-weight: 600; text-decoration: none; cursor: pointer; border: none; }
    .btn-excel { background: #0284c7; color: white; }
    .btn-excel:hover { background: #0369a1; }
    .btn-refresh { background: #f1f5f9; color: #334155; }
    .btn-logout { background: #fee2e2; color: #991b1b; margin-left: auto; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th { text-align: left; padding: 10px; background: #f8fafc; font-size: 12px; text-transform: uppercase; color: #64748b; border-bottom: 2px solid #e2e8f0; }
    td { padding: 12px 10px; border-bottom: 1px solid #e2e8f0; font-size: 14px; color: #1e293b; }
    .empty { text-align: center; padding: 2rem; color: #94a3b8; }
  </style>
</head>
<body style="background: #f8fafc; margin: 0;">
  <div class="monitor-wrap">
    <div class="monitor-card">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h2 style="margin: 0; color: #0f172a; font-size: 1.25rem;">RIT Staff Attendance Monitor</h2>
          <p style="margin: 4px 0 0; color: #64748b; font-size: 13px;">Rajalakshmi Institute of Technology</p>
        </div>
        <span class="badge">{{ records|length }} Punched Today</span>
      </div>

      <div class="btn-row">
        <a href="/excel" class="btn-action btn-excel">📥 Download Excel (.xlsx)</a>
        <button onclick="window.location.reload()" class="btn-action btn-refresh">🔄 Refresh</button>
      </div>

      <table>
        <thead>
          <tr>
            <th>Staff ID</th>
            <th>Time</th>
            <th>Detected Block</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {% for r in records %}
          <tr>
            <td><strong>{{ r.staff_id }}</strong></td>
            <td>{{ r.time }}</td>
            <td>{{ r.block }}</td>
            <td><span style="color: #16a34a; font-weight: 600;">✓ Recorded</span></td>
          </tr>
          {% else %}
          <tr>
            <td colspan="4" class="empty">No attendance pushes recorded yet today.</td>
          </tr>
          {% endfor %}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>"""
    return render_template_string(html, records=attendance_records)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


def lan_ip():
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
        sock.close()
        return ip
    except OSError:
        return "127.0.0.1"


if __name__ == "__main__":
    ip = lan_ip()
    hook = get_google_sheet_webhook()
    print("=" * 60)
    print("  RIT Staff Attendance - running")
    print(f"  Staff Portal:       http://{ip}:3000")
    print(f"  Excel Download:     http://{ip}:3000/excel")
    print(f"  Live Monitor:       http://{ip}:3000/attendance")
    print("=" * 60)
    if hook:
        print(f"  Google Sheets sync: ON -> {hook[:50]}...")
    else:
        print("  Google Sheets sync: OFF")
    print()
    app.run(host="0.0.0.0", port=3000, debug=False)

