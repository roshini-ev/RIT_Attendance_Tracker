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

import http.client
import json
import os
import re
import socket
from datetime import datetime
from urllib.parse import urljoin, urlparse

from flask import (
    Flask,
    jsonify,
    redirect,
    render_template,
    request,
    send_file,
    session,
    url_for,
)
from openpyxl import Workbook, load_workbook

from geofence import detect_location

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "rit-attendance-dummy-secret-key-2026")

DUMMY_STAFF = {f"STAFF{i:03d}": "staff123" for i in range(1, 51)}
DUMMY_STAFF["HOD01"] = "staff123"

EXCEL_FILE = os.path.join(os.path.dirname(__file__), "staff_presence.xlsx")
EXCEL_HEADERS = ["Staff ID", "Time", "Block"]

already_pushed_staff = set()

# Optional Google Sheets sync. Put the Apps Script web app URL in the
# GOOGLE_SHEET_WEBHOOK env var or in a google_sheet_webhook.txt file next to
# this script (see README "Sync to Google Sheets"). Empty = local Excel only.
GOOGLE_SHEET_WEBHOOK = os.environ.get("GOOGLE_SHEET_WEBHOOK", "").strip()
if not GOOGLE_SHEET_WEBHOOK:
    _hook_file = os.path.join(os.path.dirname(__file__), "google_sheet_webhook.txt")
    if os.path.exists(_hook_file):
        try:
            with open(_hook_file, encoding="utf-8") as _fh:
                GOOGLE_SHEET_WEBHOOK = _fh.read().strip()
        except OSError:
            pass


def post_json_follow_redirects(url: str, payload: dict) -> None:
    """POST JSON to a URL, keeping the POST body through redirects.

    Google Apps Script web apps answer the first POST with a redirect to a
    script.googleusercontent.com host and expect the POST to be re-sent, so a
    plain urllib/requests call (which converts POST to GET on 301/302) would
    fail. This loop re-sends the body until a final response arrives.
    """
    body = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    current = url
    for _ in range(6):
        parsed = urlparse(current)
        if parsed.scheme not in ("http", "https"):
            raise ValueError(f"Unsupported webhook scheme: {parsed.scheme!r}")
        if parsed.scheme == "https":
            conn = http.client.HTTPSConnection(parsed.hostname, parsed.port or 443, timeout=10)
        else:
            conn = http.client.HTTPConnection(parsed.hostname, parsed.port or 80, timeout=10)
        try:
            path = parsed.path or "/"
            if parsed.query:
                path = f"{path}?{parsed.query}"
            conn.request("POST", path, body=body, headers=headers)
            resp = conn.getresponse()
            resp.read()
            if resp.status in (301, 302, 303, 307, 308):
                location = resp.getheader("Location")
                if not location:
                    raise ConnectionError(f"Webhook redirect without Location (HTTP {resp.status})")
                current = urljoin(current, location)
                continue
            if resp.status >= 400:
                raise ConnectionError(f"Google Sheet webhook returned HTTP {resp.status}")
            return
        finally:
            conn.close()
    raise ConnectionError("Too many redirects while posting to the Google Sheet webhook")


def sync_to_google_sheet(staff_id: str, timestamp: str, block: str) -> None:
    """Append one punch row to the linked Google Sheet (best effort)."""
    if not GOOGLE_SHEET_WEBHOOK:
        return
    post_json_follow_redirects(
        GOOGLE_SHEET_WEBHOOK,
        {"staff_id": staff_id, "time": timestamp, "block": block},
    )


def authenticate_staff(staff_id: str, password: str) -> bool:
    sid = str(staff_id).strip().upper()
    pwd = str(password).strip()
    if sid == "ADMIN01":
        return False
    if sid in DUMMY_STAFF and DUMMY_STAFF[sid] == pwd:
        return True
    if re.match(r"^STAFF\d+$", sid) and pwd == "staff123":
        return True
    return False


def init_excel_file():
    """Create or migrate the admin Excel file to Staff ID / Time / Block."""
    if not os.path.exists(EXCEL_FILE):
        wb = Workbook()
        ws = wb.active
        ws.title = "Staff Presence"
        ws.append(EXCEL_HEADERS)
        wb.save(EXCEL_FILE)
        return

    try:
        wb = load_workbook(EXCEL_FILE)
        ws = wb.active
        header = [str(c).strip() if c is not None else "" for c in next(ws.iter_rows(min_row=1, max_row=1, values_only=True))]
        rows = []
        for row in ws.iter_rows(min_row=2, values_only=True):
            if not row or not row[0]:
                continue
            staff_id = str(row[0]).strip().upper()
            already_pushed_staff.add(staff_id)
            if header[:3] == EXCEL_HEADERS:
                time_val = row[1]
                block = row[2] if len(row) > 2 else "Outside"
            else:
                # Older format: Staff ID, Timestamp, Latitude, Longitude, Location
                time_val = row[1]
                block = row[4] if len(row) > 4 else (row[2] if len(row) > 2 else "Outside")
            rows.append([staff_id, time_val, block])

        if header[:3] != EXCEL_HEADERS:
            wb = Workbook()
            ws = wb.active
            ws.title = "Staff Presence"
            ws.append(EXCEL_HEADERS)
            for r in rows:
                ws.append(r)
            wb.save(EXCEL_FILE)
    except Exception as e:
        print(f"Error inspecting Excel file: {e}")


def append_excel_record(staff_id, timestamp, block):
    if not os.path.exists(EXCEL_FILE):
        init_excel_file()
    wb = load_workbook(EXCEL_FILE)
    ws = wb.active
    ws.append([staff_id, timestamp, block])
    wb.save(EXCEL_FILE)


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
            return redirect(url_for("staff_screen"))
        return render_template("login.html", error="Invalid Staff ID or Password")
    return render_template("login.html")


@app.route("/staff")
def staff_screen():
    if "staff_id" not in session:
        return redirect(url_for("login"))
    staff_id = session["staff_id"]
    return render_template("staff.html", staff_id=staff_id, has_pushed=staff_id in already_pushed_staff)


@app.route("/api/push", methods=["POST"])
def api_push():
    if "staff_id" not in session:
        return jsonify({"success": False, "error": "Not authenticated"}), 401

    staff_id = session["staff_id"]
    if staff_id in already_pushed_staff:
        return jsonify({"success": False, "error": "Push already recorded for this staff member."}), 400

    data = request.get_json() or {}
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
    # Time only (HH:MM:SS) per requirement - each staff member pushes only once.
    timestamp = datetime.now().strftime("%H:%M:%S")

    try:
        append_excel_record(staff_id, timestamp, block)
        already_pushed_staff.add(staff_id)
        # Cloud sync is best-effort: the local Excel row is the durable record.
        try:
            sync_to_google_sheet(staff_id, timestamp, block)
        except Exception as e:
            print(f"[Google Sheet] sync failed for {staff_id}: {e}")
        return jsonify({"success": True, "status": "PUSHED"})
    except PermissionError:
        # Excel on the admin's PC locks the file while it is open.
        return jsonify({
            "success": False,
            "error": "The Excel file is open on the admin computer. Please close it and tap PUSH again.",
        }), 409
    except Exception as e:
        return jsonify({"success": False, "error": f"Failed to save record: {str(e)}"}), 500


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/excel")
def shared_excel():
    """Serve the live Excel sheet to anyone who has the link - no login."""
    if not os.path.exists(EXCEL_FILE):
        init_excel_file()
    response = send_file(
        EXCEL_FILE,
        as_attachment=True,
        download_name="staff_presence.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    # Always hand out the current file, never a cached copy.
    response.headers["Cache-Control"] = "no-store"
    return response


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
    print("=" * 56)
    print("  RIT Staff Attendance - running")
    print(f"  Staff link:        http://{ip}:3000")
    print(f"  Excel sheet link:  http://{ip}:3000/excel   (anyone with the link can open it)")
    print("=" * 56)
    print(f"  Local copy of the sheet: {EXCEL_FILE}")
    print("  (Keep the local file closed while staff are pushing, or Excel locks it.)")
    if GOOGLE_SHEET_WEBHOOK:
        print("  Google Sheets sync: ON - every push is also written to your Google Sheet.")
    else:
        print("  Google Sheets sync: OFF (local Excel only). To enable, put your Apps Script")
        print("  web app URL in GOOGLE_SHEET_WEBHOOK or in google_sheet_webhook.txt - see README.")
    print()
    print("Phones on the same Wi-Fi can open the link above.")
    print("NOTE: Android/iOS only allow GPS on HTTPS. For on-campus")
    print("location to work on phones, share an HTTPS tunnel link instead")
    print("(e.g. ngrok or Cloudflare Tunnel) - see README.")
    app.run(host="0.0.0.0", port=3000, debug=False)
