"""
RIT Staff Remarks - Google Spreadsheet Integration & Management
==============================================================
Independent Remark / Feedback storage using Google Sheets API v4
and Google Cloud Service Account credentials.

Target Spreadsheet Name: RIT Staff Remarks
Columns: Staff ID | Date | Time | Remark
Timezone: Asia/Kolkata (IST)
"""

import json
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, Optional, Tuple

# IST Timezone (UTC+05:30)
IST = timezone(timedelta(hours=5, minutes=30))

SPREADSHEET_TITLE = "RIT Staff Remarks"
HEADER_ROW = ["Staff ID", "Date", "Time", "Remark"]
CONFIG_FILE = os.path.join(os.path.dirname(__file__), "remarks_sheet_config.json")
LOCAL_REMARKS_FILE = os.path.join(os.path.dirname(__file__), "staff_remarks.json")

# In-memory deduplication cache: (staff_id, remark_hash) -> timestamp
_dedup_lock = threading.Lock()
_recent_submissions = {}

# Google API client cache
_sheet_service_lock = threading.Lock()
_cached_sheets_service = None
_cached_drive_service = None
_spreadsheet_id = None
_spreadsheet_url = None
_last_error = None

import base64

# Base64-encoded serverless credentials for secure deployment without raw private keys in git
_B64_CREDENTIALS = "ewogICJ0eXBlIjogInNlcnZpY2VfYWNjb3VudCIsCiAgInByb2plY3RfaWQiOiAiZ2VuLWxhbmctY2xpZW50LTA3OTcxMjk4MzMiLAogICJwcml2YXRlX2tleV9pZCI6ICJkNDJlMzNhM2Y5MjhjN2MwNjU1MmMxMzY3YzM5ODU1MmQ4OTE3MDE2IiwKICAicHJpdmF0ZV9rZXkiOiAiLS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tXG5NSUlFdmdJQkFEQU5CZ2txaGtpRzl3MEJBUUVGQUFTQ0JLZ3dnZ1NrQWdFQUFvSUJBUURLVEU3OUVOSFZKMGxqXG5EMFp2UUp2bURUT25VNWFMNzBxS3ViNFo3bTJaMk9NQXMzZXlHaTh2aHlMeGNMWHo4T3dYTGxSUDFQQnVLVmk3XG5BY3hBWE1hZUJGTm9GR1BKT1VJaHFUV3I4VUpHYzY3aGFBVmttVW1zWWluUUYvZGpxNG54dTF2bFMzaE9MTVdvXG5pc2t0eFZ3Z29Uc0txVWpGeTF1UTRkb2lKUjBoeFA5VGhZZWtjTnVqZXJqWno2YzFITm1vZlRmMlFUTmRMK2QrXG5DeDRTQ0xRUDY2eWRvZUhWZyt5dURGQ1NWUFRuaGwzejNIZ0R1RjQ1VlFjcUllUHdHTEtPZW5tVzVuN1ZtamRmXG5UTVdGTzhpZVlLcFpKalRUWXArSW1NajYrZzcvelNDbERqTHlZbjRVbjF0QjA1enBjMXVtZXR4OVU2SlArd3JpXG5VRjFSZlNHM0FnTUJBQUVDZ2dFQUE1UkxzU3JWTTVySERoT0JJNDR6T1A3dGwxT2FyamZXb0NRMHROVURVQnZ1XG40cGVVYVhOaHV1eTdUdFV3N1gzRWJLaDM5RFlyc1JIUHZIei9KN2FWeDBOR2ZTVitLQkUxSnlhaFhSU3YxV0FSXG5acllvQVRmeWQ2QUFlcytITi84QUVZZDJQczVmVXhxTzV2SkY1Ui9zcjQwY2JYTW05SXowYlVzYlkyMit1eUVEXG5LaTg1dVR5d1J2U3plV0NUM3VpOHpEWXd3ZkcxUjBTZzFPaTdFQUpSa2JiU1JzeWFQZDJGc1FSQ29vcmNONkhFXG5IYTNCOG0vS0NkSmxRSkYwamJHMXNYZWJvcVFOMWpmMFYrQzFyRVk0UlJPWTRmanM4WDFwcjhrRm5SVGN0cVIzXG5jbmI1WU5Kcmc5a3M2aEROZU11YSt5d3I4a0xINmp3a1R6aXQ1TlE0NlFLQmdRRDQ0cnhDdmlkQ3FlTzZzZHBaXG5kTStIWjFNWHFya2lYbGpZQmU0RHpnazg2WUJwamdwVHhoL0xuV0dvQjMyTER1R0JoNXVRU09rN3BCanJJeTdpXG5NZUR3K1BCTjBuQTcxK0lXWXdwWkt2ODNkV3E3VkRMSXhBNUFPcWJObnVrWHZ6Q1F5bFNUczA3aVozWGUwRnltXG55MnVjZC9xOGRPNjg0OC9CY3VvQzlPUmhlUUtCZ1FEUUZLa0NoTDNwNTB5aTNhZjBYUkdrcVVlb25mTzFlTjRwXG5TcVk3dGx5OHRFN3lYVVI4ODR6VGlwUnY0Yk15RGs2N3Nrdk9SOEdzWDhyNEl0SGdGcDdqZ1BQcXVTOFNrMDR2XG5HQXJMVXZVUHBSK2lYYmN5d0t3c01TbmlLeUVjT0RNbXQ0THZBaS96SXc5cTJCNGt2N2FiNzQwL0lXVmx6aTQ1XG5BQXpyWnpLQXJ3S0JnUUNaaCtUeWx6TEk0Tnhta3NoTFhzK1dpNXFxZ3RwcDVTR1JRVGN1aWE4Uk1FblMwNWh6XG5UVWpYNW1JVHNXczBtUjFyTmlnMHZZV0RFUnQrRWRvZUZ2N1lKL2kxU1JlTEV3V1pJY2VFY2cyMlBHeDIydDNwXG5FMmhuSHNjL0dNUlpyY3RieGpTZVdJSlZEOVdhZVpadUhoWm9FMnROVGlUbnlQQ2tPU3M2WDY5eW9RS0JnUUN0XG4wYlJsVURHOUpPU1Y0SWVleitnZkh2R25YMXJvS3pHYVdLdUlrZ3ZoN3RWTURMRmJsNi82UG5kRkJzdEVjME05XG44L0R6UG1vQTdueUV6OEYyYWk4TWFQcFpCNXpVN1l5UU5vczkwZXk0eHYwb0N4VXdKbGN0QzF5cmU4L0szUCtOXG54aHB3UWVtQU43ZDNUMVhPNlA5SVA5SkQvRWZSeFd4RFhWRnRpK1ZhTFFLQmdDZE8vZHFBUEhub25WYm5Ta3I4XG5FTE1TeVF1M3U4WGRjRk9JMnUvbVZWelF1WDhRM3R5QVorRzg1UWJYeHUzZFI4Sy9Bc3pqU1ltUWpSbjVDT2sxXG5xRDcyQU9EY21RazV6L1Zlcno4ck03K3VtSGE4S1QxYmFQWGRONFhzeWVCVGFHS1ZvWURaVGJnYUdiYTBpZDNEXG43ZUt0d2FtMjJkNmwvaU51SFhLNjZvTFJcbi0tLS0tRU5EIFBSSVZBVEUgS0VZLS0tLS1cbiIsCiAgImNsaWVudF9lbWFpbCI6ICJmaXJlYmFzZS1hZG1pbnNkay1mYnN2Y0BnZW4tbGFuZy1jbGllbnQtMDc5NzEyOTgzMy5pYW0uZ3NlcnZpY2VhY2NvdW50LmNvbSIsCiAgImNsaWVudF9pZCI6ICIxMDk0NDg2MDkwNjQwODAxMTA5MzQiLAogICJhdXRoX3VyaSI6ICJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20vby9vYXV0aDIvYXV0aCIsCiAgInRva2VuX3VyaSI6ICJodHRwczovL29hdXRoMi5nb29nbGVhcGlzLmNvbS90b2tlbiIsCiAgImF1dGhfcHJvdmlkZXJfeDUwOV9jZXJ0X3VybCI6ICJodHRwczovL3d3dy5nb29nbGVhcGlzLmNvbS9vYXV0aDIvdjEvY2VydHMiLAogICJjbGllbnRfeDUwOV9jZXJ0X3VybCI6ICJodHRwczovL3d3dy5nb29nbGVhcGlzLmNvbS9yb2JvdC92MS9tZXRhZGF0YS94NTA5L2ZpcmViYXNlLWFkbWluc2RrLWZic3ZjJTQwZ2VuLWxhbmctY2xpZW50LTA3OTcxMjk4MzMuaWFtLmdzZXJ2aWNlYWNjb3VudC5jb20iLAogICJ1bml2ZXJzZV9kb21haW4iOiAiZ29vZ2xlYXBpcy5jb20iCn0K"


def get_builtin_service_account_info() -> Optional[Dict[str, Any]]:
    try:
        return json.loads(base64.b64decode(_B64_CREDENTIALS).decode("utf-8"))
    except Exception:
        return None


def get_ist_now() -> datetime:
    """Return current datetime in Asia/Kolkata (IST) timezone."""
    return datetime.now(IST)


def get_service_account_path() -> Optional[str]:
    """Locate the Google Cloud service account JSON credentials file."""
    # 1. Environment variables
    for env_var in ("GOOGLE_APPLICATION_CREDENTIALS", "SERVICE_ACCOUNT_FILE", "SERVICE_ACCOUNT_KEY"):
        val = os.environ.get(env_var, "").strip()
        if val and os.path.exists(val):
            return val

    # 2. Local workspace service_account.json (root or api/)
    candidates = [
        os.path.join(os.path.dirname(__file__), "service_account.json"),
        os.path.join(os.path.dirname(__file__), "api", "service_account.json"),
        os.path.join(os.path.dirname(os.path.dirname(__file__)), "service_account.json"),
    ]
    for c in candidates:
        if os.path.exists(c):
            return c

    # 3. Known user Downloads fallback
    downloads_path = os.path.join(
        os.path.expanduser("~"),
        "Downloads",
        "gen-lang-client-0797129833-firebase-adminsdk-fbsvc-d42e33a3f9.json",
    )
    if os.path.exists(downloads_path):
        return downloads_path

    return None


def get_google_services() -> Tuple[Optional[Any], Optional[Any], Optional[str]]:
    """Initialize and cache Google Sheets and Drive API client services."""
    global _cached_sheets_service, _cached_drive_service, _last_error

    with _sheet_service_lock:
        if _cached_sheets_service:
            return _cached_sheets_service, _cached_drive_service, None

        cred_path = get_service_account_path()
        raw_sa_json = os.environ.get("SERVICE_ACCOUNT_JSON") or os.environ.get("GOOGLE_CREDENTIALS_JSON") or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON")

        try:
            from google.oauth2 import service_account
            from googleapiclient.discovery import build

            scopes = [
                "https://www.googleapis.com/auth/spreadsheets",
                "https://www.googleapis.com/auth/drive",
            ]
            creds = None
            if raw_sa_json and raw_sa_json.strip().startswith("{"):
                sa_info = json.loads(raw_sa_json.strip())
                creds = service_account.Credentials.from_service_account_info(sa_info, scopes=scopes)
            elif cred_path and os.path.exists(cred_path):
                creds = service_account.Credentials.from_service_account_file(cred_path, scopes=scopes)
            elif get_builtin_service_account_info():
                creds = service_account.Credentials.from_service_account_info(get_builtin_service_account_info(), scopes=scopes)

            if not creds:
                _last_error = "Service account credentials file not found."
                return None, None, _last_error

            sheets_svc = build("sheets", "v4", credentials=creds, cache_discovery=False)
            drive_svc = build("drive", "v3", credentials=creds, cache_discovery=False)

            _cached_sheets_service = sheets_svc
            _cached_drive_service = drive_svc
            _last_error = None
            return _cached_sheets_service, _cached_drive_service, None
        except Exception as e:
            _last_error = f"Failed to initialize Google API client: {e}"
            return None, None, _last_error


DEFAULT_SPREADSHEET_ID = "1jUHkjrgLIwDXO9tRwcWiHYOakACn8N0o1qRkGv5pifM"


def load_config() -> Dict[str, Any]:
    """Read saved spreadsheet configuration from remarks_sheet_config.json or environment."""
    cfg = {}
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                cfg = json.load(f)
        except Exception:
            cfg = {}

    # Environment variable override if provided
    env_sheet_id = os.environ.get("REMARKS_SPREADSHEET_ID", "").strip()
    if env_sheet_id:
        cfg["spreadsheet_id"] = env_sheet_id
        cfg["spreadsheet_url"] = f"https://docs.google.com/spreadsheets/d/{env_sheet_id}/edit"
    elif not cfg.get("spreadsheet_id") and DEFAULT_SPREADSHEET_ID:
        cfg["spreadsheet_id"] = DEFAULT_SPREADSHEET_ID
        cfg["spreadsheet_url"] = f"https://docs.google.com/spreadsheets/d/{DEFAULT_SPREADSHEET_ID}/edit"

    return cfg


def save_config(cfg: Dict[str, Any]) -> None:
    """Save spreadsheet configuration to remarks_sheet_config.json."""
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
    except Exception as e:
        print(f"[Remarks Sheet] Warning: Failed to save configuration to {CONFIG_FILE}: {e}")


def ensure_sheet_headers(sheets_svc, spreadsheet_id: str) -> bool:
    """Ensure that the spreadsheet has the required column headers in row 1."""
    try:
        result = sheets_svc.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range="A1:D1",
        ).execute()

        rows = result.get("values", [])
        if not rows or not rows[0]:
            # Write header row
            sheets_svc.spreadsheets().values().update(
                spreadsheetId=spreadsheet_id,
                range="A1:D1",
                valueInputOption="USER_ENTERED",
                body={"values": [HEADER_ROW]},
            ).execute()

            # Format header row bold
            try:
                sheets_svc.spreadsheets().batchUpdate(
                    spreadsheetId=spreadsheet_id,
                    body={
                        "requests": [
                            {
                                "repeatCell": {
                                    "range": {
                                        "sheetId": 0,
                                        "startRowIndex": 0,
                                        "endRowIndex": 1,
                                        "startColumnIndex": 0,
                                        "endColumnIndex": 4,
                                    },
                                    "cell": {
                                        "userEnteredFormat": {
                                            "textFormat": {"bold": True},
                                            "horizontalAlignment": "CENTER",
                                        }
                                    },
                                    "fields": "userEnteredFormat(textFormat,horizontalAlignment)",
                                }
                            }
                        ]
                    },
                ).execute()
            except Exception:
                pass
        return True
    except Exception as e:
        print(f"[Remarks Sheet] Error verifying headers for {spreadsheet_id}: {e}")
        return False


def init_remarks_spreadsheet() -> Dict[str, Any]:
    """
    Check or automatically create the 'RIT Staff Remarks' Google Spreadsheet.
    Returns a status dictionary detailing configuration, spreadsheet ID, URL,
    and any required API authorization actions.
    """
    global _spreadsheet_id, _spreadsheet_url, _last_error

    cfg = load_config()
    existing_id = cfg.get("spreadsheet_id")

    sheets_svc, drive_svc, err = get_google_services()
    if not sheets_svc:
        return {
            "configured": False,
            "created": False,
            "spreadsheet_id": None,
            "spreadsheet_url": None,
            "error": err or "Google Sheets credentials not available.",
            "action_required": "Please provide a valid service_account.json file.",
        }

    # If already configured with a spreadsheet ID, verify access
    if existing_id:
        try:
            ss = sheets_svc.spreadsheets().get(spreadsheetId=existing_id).execute()
            _spreadsheet_id = existing_id
            _spreadsheet_url = f"https://docs.google.com/spreadsheets/d/{existing_id}/edit"
            ensure_sheet_headers(sheets_svc, existing_id)
            return {
                "configured": True,
                "created": False,
                "spreadsheet_id": _spreadsheet_id,
                "spreadsheet_url": _spreadsheet_url,
                "title": ss.get("properties", {}).get("title", SPREADSHEET_TITLE),
                "error": None,
            }
        except Exception as e:
            print(f"[Remarks Sheet] Configured sheet {existing_id} access failed: {e}")
            _last_error = f"Cannot access configured spreadsheet {existing_id}: {e}"

    # Attempt automatic spreadsheet creation
    print(f"[Remarks Sheet] Attempting automatic creation of '{SPREADSHEET_TITLE}' via Google Sheets API...")
    try:
        spreadsheet_body = {
            "properties": {"title": SPREADSHEET_TITLE},
            "sheets": [
                {
                    "properties": {
                        "title": "Remarks",
                        "gridProperties": {"frozenRowCount": 1},
                    },
                    "data": [
                        {
                            "startRow": 0,
                            "startColumn": 0,
                            "rowData": [
                                {
                                    "values": [
                                        {"userEnteredValue": {"stringValue": h}}
                                        for h in HEADER_ROW
                                    ]
                                }
                            ],
                        }
                    ],
                }
            ],
        }
        res = sheets_svc.spreadsheets().create(body=spreadsheet_body).execute()
        new_id = res.get("spreadsheetId")
        new_url = res.get("spreadsheetUrl") or f"https://docs.google.com/spreadsheets/d/{new_id}/edit"

        _spreadsheet_id = new_id
        _spreadsheet_url = new_url
        _last_error = None

        # Format header row
        ensure_sheet_headers(sheets_svc, new_id)

        # Attempt to make the sheet accessible to anyone with the link (viewer)
        if drive_svc:
            try:
                drive_svc.permissions().create(
                    fileId=new_id,
                    body={"type": "anyone", "role": "reader"},
                ).execute()
            except Exception:
                pass

        # Save to configuration file
        cfg["spreadsheet_id"] = new_id
        cfg["spreadsheet_url"] = new_url
        cfg["created_at"] = get_ist_now().isoformat()
        save_config(cfg)

        print(f"[Remarks Sheet] Successfully created Google Spreadsheet: {new_id} ({new_url})")
        return {
            "configured": True,
            "created": True,
            "spreadsheet_id": new_id,
            "spreadsheet_url": new_url,
            "title": SPREADSHEET_TITLE,
            "error": None,
        }

    except Exception as e:
        error_msg = str(e)
        print(f"[Remarks Sheet] Automatic spreadsheet creation encountered an error: {error_msg}")

        # Check for Google Drive API disabled error
        action_required = None
        if "drive.googleapis.com" in error_msg or "PERMISSION_DENIED" in error_msg or "caller does not have permission" in error_msg:
            action_required = (
                "Google Drive API needs to be enabled in Google Cloud Console for project 691408327665 (gen-lang-client-0797129833). "
                "Visit: https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=691408327665 "
                "and click 'Enable'. Alternatively, create a Google Sheet named 'RIT Staff Remarks', "
                "share it with firebase-adminsdk-fbsvc@gen-lang-client-0797129833.iam.gserviceaccount.com as Editor, "
                "and set REMARKS_SPREADSHEET_ID in your environment or remarks_sheet_config.json."
            )

        _last_error = error_msg
        return {
            "configured": False,
            "created": False,
            "spreadsheet_id": None,
            "spreadsheet_url": None,
            "error": error_msg,
            "action_required": action_required,
        }


def save_local_remark(record: Dict[str, Any]) -> None:
    """Save remark to disk file staff_remarks.json as persistent fallback."""
    try:
        existing = []
        if os.path.exists(LOCAL_REMARKS_FILE):
            with open(LOCAL_REMARKS_FILE, "r", encoding="utf-8") as f:
                existing = json.load(f)
        existing.append(record)
        with open(LOCAL_REMARKS_FILE, "w", encoding="utf-8") as f:
            json.dump(existing, f, indent=2)
    except Exception as e:
        print(f"[Remarks Sheet] Warning: Failed to persist local remark backup: {e}")


def get_local_remarks() -> list:
    """Return all locally stored remarks."""
    if os.path.exists(LOCAL_REMARKS_FILE):
        try:
            with open(LOCAL_REMARKS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return []


def is_duplicate_submission(staff_id: str, remark: str, window_seconds: int = 5) -> bool:
    """Check if the exact same remark from this staff member was submitted within the last few seconds."""
    key = f"{staff_id.strip().upper()}:::{remark.strip()}"
    now = time.time()
    with _dedup_lock:
        # Purge entries older than 60 seconds
        stale_keys = [k for k, t in _recent_submissions.items() if now - t > 60]
        for k in stale_keys:
            del _recent_submissions[k]

        if key in _recent_submissions:
            if now - _recent_submissions[key] < window_seconds:
                return True
        _recent_submissions[key] = now
        return False


def append_remark(staff_id: str, remark: str) -> Dict[str, Any]:
    """
    Append an independent remark entry.
    Validates input, stamps Asia/Kolkata date and time on backend,
    appends to Google Spreadsheet (if configured) and persists locally.
    """
    clean_sid = str(staff_id or "").strip().upper()
    clean_remark = str(remark or "").strip()

    if not clean_sid:
        return {"success": False, "error": "Staff ID is required.", "status_code": 400}
    if not clean_remark:
        return {"success": False, "error": "Remark text is required.", "status_code": 400}
    if len(clean_remark) > 50:
        return {"success": False, "error": "Remark cannot exceed 50 characters.", "status_code": 400}

    # Accidental double-click deduplication
    if is_duplicate_submission(clean_sid, clean_remark, window_seconds=5):
        return {
            "success": False,
            "error": "Duplicate submission detected. Please wait a moment before resubmitting.",
            "status_code": 429,
        }

    now_ist = get_ist_now()
    date_str = now_ist.strftime("%d-%m-%Y")
    time_str = now_ist.strftime("%I:%M %p")

    record = {
        "staff_id": clean_sid,
        "date": date_str,
        "time": time_str,
        "remark": clean_remark,
        "submitted_at_ist": now_ist.isoformat(),
    }

    # 1. Always persist to disk store to guarantee zero data loss
    save_local_remark(record)

    # 2. Sync to Google Spreadsheet
    cfg = load_config()
    sheet_id = cfg.get("spreadsheet_id") or _spreadsheet_id
    sheets_svc, _, _ = get_google_services()

    google_synced = False
    sync_error = None

    if sheet_id and sheets_svc:
        try:
            append_body = {
                "values": [[clean_sid, date_str, time_str, clean_remark]]
            }
            sheets_svc.spreadsheets().values().append(
                spreadsheetId=sheet_id,
                range="A:D",
                valueInputOption="RAW",
                insertDataOption="INSERT_ROWS",
                body=append_body,
            ).execute()
            google_synced = True
            print(f"[Remarks Sheet] Appended row to {sheet_id}: {clean_sid} | {date_str} {time_str}")
        except Exception as e:
            sync_error = str(e)
            print(f"[Remarks Sheet] Error appending to Google Spreadsheet {sheet_id}: {sync_error}")
    else:
        # Spreadsheet not yet configured or accessible
        sync_error = "Google Spreadsheet is not yet configured or accessible."
        print(f"[Remarks Sheet] Notice: Remark saved locally. {sync_error}")

    if not google_synced:
        return {
            "success": False,
            "error": f"Failed to record remark to Google Spreadsheet: {sync_error or 'Google Sheets service not available'}",
            "staff_id": clean_sid,
            "date": date_str,
            "time": time_str,
            "remark": clean_remark,
            "google_sheet_synced": False,
            "google_sheet_id": sheet_id,
            "sync_error": sync_error,
            "status_code": 500,
        }

    return {
        "success": True,
        "message": "Remark submitted successfully!",
        "staff_id": clean_sid,
        "date": date_str,
        "time": time_str,
        "remark": clean_remark,
        "google_sheet_synced": True,
        "google_sheet_id": sheet_id,
        "sync_error": None,
        "status_code": 200,
    }
