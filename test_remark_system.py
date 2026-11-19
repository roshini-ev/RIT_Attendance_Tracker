"""
Comprehensive Automated Test Suite for RIT Attendance Tracker - Remark System Rebuild
Covers TESTS 1 through 8 as required by the specification.
"""

import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

import app
import remarks_sheet
from openpyxl import load_workbook

IST = timezone(timedelta(hours=5, minutes=30))


class TestRemarkSystemRebuild(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app.app.config["TESTING"] = True
        cls.client = app.app.test_client()

    @classmethod
    def tearDownClass(cls):
        # Reset staff_presence.xlsx to clean baseline
        try:
            import openpyxl
            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = "Staff Presence"
            ws.append(["Staff ID", "Phone Number", "Date", "Time", "Block"])
            ws.append(["STAFF030", "Unavailable", "2026-09-22", "23:15:39", "A / Admin Block"])
            wb.save("staff_presence.xlsx")
            wb.save("staff_presence_latest.xlsx")
        except Exception:
            pass

    def setUp(self):
        # Clear recent deduplication cache for clean testing
        with remarks_sheet._dedup_lock:
            remarks_sheet._recent_submissions.clear()

        # Clear attendance test state
        app.pushed_today.clear()
        app.attendance_records = [r for r in app.attendance_records if not r.get("staff_id", "").startswith("TEST_") and not r.get("staff_id", "").startswith("STAFF02")]
        try:
            pushes_file = os.path.join(tempfile.gettempdir(), "rit_data", "pushes.json")
            if os.path.exists(pushes_file):
                os.remove(pushes_file)
        except Exception:
            pass

    def test_1_remark_without_push(self):
        """TEST 1: Submit a remark without pressing the attendance PUSH button."""
        sid = "STAFF021"
        # Ensure staff has not pushed attendance today
        self.assertFalse(app.has_pushed_today(sid))

        res = self.client.post(
            "/api/remark",
            data=json.dumps({
                "staff_id": sid,
                "remark": "Lab equipment issue in physics lab",
            }),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get("success"))
        self.assertEqual(data.get("staff_id"), sid)
        self.assertEqual(data.get("remark"), "Lab equipment issue in physics lab")
        self.assertIn("date", data)
        self.assertIn("time", data)

        # STRICT VERIFICATION: Submitting a remark MUST NOT mark attendance!
        self.assertFalse(
            app.has_pushed_today(sid),
            "Submitting a remark should NEVER mark attendance for the staff member!",
        )

    def test_2_push_without_remark(self):
        """TEST 2: Submit attendance without entering a remark."""
        sid = "STAFF022"
        # Login session
        with self.client.session_transaction() as sess:
            sess["staff_id"] = sid

        res = self.client.post(
            "/api/push",
            data=json.dumps({
                "staffId": sid,
                "latitude": 13.0384,
                "longitude": 80.0455,
                "phoneNumber": "+919876543210",
            }),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get("success"))
        self.assertEqual(data.get("status"), "PUSHED")
        self.assertEqual(data.get("staff_id"), sid)
        self.assertNotIn("remark", data, "Attendance push response must not contain remark.")

        # Attendance is now recorded
        self.assertTrue(app.has_pushed_today(sid))

        # Verify attendance record in memory has NO remark field
        matching = [r for r in app.attendance_records if r.get("staff_id") == sid]
        self.assertTrue(len(matching) > 0)
        for r in matching:
            self.assertNotIn("remark", r, "Attendance record must not have remark field.")

    def test_3_multiple_remarks_same_staff(self):
        """TEST 3: Submit multiple remarks using the same Staff ID."""
        sid = "STAFF023"
        remarks_to_submit = [
            "Projector issue in room 302",
            "Need more whiteboard markers",
            "AC temperature adjustment needed",
        ]

        submitted_results = []
        for text in remarks_to_submit:
            res = self.client.post(
                "/api/remark",
                data=json.dumps({"staff_id": sid, "remark": text}),
                content_type="application/json",
            )
            self.assertEqual(res.status_code, 200)
            data = res.get_json()
            self.assertTrue(data.get("success"))
            submitted_results.append(data)

        # Verify in local persistent store that all entries exist separately
        all_local = remarks_sheet.get_local_remarks()
        staff_entries = [r for r in all_local if r.get("staff_id") == sid]
        self.assertGreaterEqual(len(staff_entries), 3)

        # Ensure no remarks were overwritten
        saved_texts = [r.get("remark") for r in staff_entries]
        for text in remarks_to_submit:
            self.assertIn(text, saved_texts)

    def test_9_remark_exceeds_50_chars(self):
        """TEST 9: Submit remark exceeding 50 characters limit."""
        sid = "STAFF023"
        long_remark = "This is a very long remark that definitely exceeds the fifty character limit."
        res = self.client.post(
            "/api/remark",
            data=json.dumps({"staff_id": sid, "remark": long_remark}),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 400)
        data = res.get_json()
        self.assertFalse(data.get("success"))
        self.assertIn("50", data.get("error", ""))

    def test_4_empty_remark(self):
        """TEST 4: Submit an empty remark -> Expect validation error."""
        res = self.client.post(
            "/api/remark",
            data=json.dumps({"staff_id": "STAFF001", "remark": ""}),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 400)
        data = res.get_json()
        self.assertFalse(data.get("success"))
        self.assertIn("Remark", data.get("error", ""))

        # Test whitespace only
        res_ws = self.client.post(
            "/api/remark",
            data=json.dumps({"staff_id": "STAFF001", "remark": "   \n\t  "}),
            content_type="application/json",
        )
        self.assertEqual(res_ws.status_code, 400)

    def test_5_empty_staff_id(self):
        """TEST 5: Submit an empty Staff ID -> Expect validation error."""
        # Unauthenticated client
        res = self.client.post(
            "/api/remark",
            data=json.dumps({"staff_id": "", "remark": "Valid remark text"}),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 400)
        data = res.get_json()
        self.assertFalse(data.get("success"))
        self.assertIn("Staff ID", data.get("error", ""))

    def test_6_google_sheets_api_failure_handling(self):
        """TEST 6: Test Google Sheets API failure -> Appropriate error message without crashing."""
        # Temporarily override environment to an invalid spreadsheet ID
        orig_env = os.environ.get("REMARKS_SPREADSHEET_ID")
        try:
            os.environ["REMARKS_SPREADSHEET_ID"] = "invalid-spreadsheet-id-for-testing"
            # Attempt to append remark
            res = remarks_sheet.append_remark("STAFF025", "Failure handling test remark")
            # Should not raise exception, should return success: True with local save and sync_error
            self.assertTrue(res.get("success"), "Local record must still succeed even if Google fails.")
            self.assertFalse(res.get("google_sheet_synced"))
            self.assertIsNotNone(res.get("sync_error"))
        finally:
            if orig_env is not None:
                os.environ["REMARKS_SPREADSHEET_ID"] = orig_env
            else:
                os.environ.pop("REMARKS_SPREADSHEET_ID", None)

    def test_7_verify_spreadsheet_separation(self):
        """TEST 7: Verify spreadsheet separation -> Remarks should not appear in attendance spreadsheet."""
        # Inspect attendance Excel file staff_presence.xlsx
        excel_path = os.path.join(os.path.dirname(__file__), "staff_presence.xlsx")
        self.assertTrue(os.path.exists(excel_path))

        wb = load_workbook(excel_path)
        ws = wb.active
        headers = [str(cell.value or "").strip() for cell in ws[1]]

        # Ensure "Remark" is NOT in the attendance headers
        self.assertNotIn("Remark", headers, "Attendance Excel file must NOT contain a Remark column!")
        self.assertEqual(headers, ["Staff ID", "Phone Number", "Date", "Time", "Block"])

        # Ensure no remark text leaked into attendance cells
        for row in ws.iter_rows(min_row=2, values_only=True):
            if row and row[0]:
                for cell in row:
                    self.assertNotIn("issue in physics lab", str(cell or ""))

    def test_8_verify_timestamps_ist(self):
        """TEST 8: Verify timestamps -> Correct backend-generated date and time in Asia/Kolkata timezone."""
        now_ist = datetime.now(IST)
        expected_date = now_ist.strftime("%d-%m-%Y")

        res = self.client.post(
            "/api/remark",
            data=json.dumps({"staff_id": "STAFF026", "remark": "Timestamp verification test"}),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)
        data = res.get_json()

        self.assertEqual(data.get("date"), expected_date)
        # Time format should match HH:MM AM/PM
        time_val = data.get("time", "")
        parsed_time = datetime.strptime(time_val, "%I:%M %p")
        self.assertIsNotNone(parsed_time)


if __name__ == "__main__":
    unittest.main()
