# RIT Staff Attendance (phone web app)

Mobile-first staff punch portal for **Rajalakshmi Institute of Technology**.

No role-based login, no admin account. Staff simply log in and tap **PUSH** once; every successful push appends a row to the admin's Excel file on this computer. You (the admin) check that file directly whenever you want.

Campus blocks come from `RIT_Campus_Coordinates_Updated.pdf` (KML bounding ranges), defined in `geofence.py`.

## What staff can do

1. Open the link on a phone (layout is built for phones — large tap targets, no zoom-on-input, "Add to Home Screen" supported).
2. Sign in with a dummy Staff ID and password.
3. Tap **PUSH** once. After that the button stays disabled, and the server rejects any second attempt for that Staff ID.
4. Nothing else — no Excel, no history, no menus, only the PUSH screen and Logout.

On tap, the phone GPS is matched to a campus block and a row is appended to the Excel file: **Staff ID**, **Time** (HH:MM:SS, time only), **Block**.

## The Excel sheet

Every push appends a row under the header `Staff ID | Time | Block`. Two ways to view the sheet:

**1. Google Sheet (recommended — link works from anywhere, no server needed)** — see "Sync to Google Sheets" below. Share that sheet's link with whoever should see attendance; they open it like any Google Sheet.

**2. Local file + server link** — the file also lives locally: `staff_presence.xlsx` in this project folder, and the running app serves it at

```
http://<this-pc-ip>:3000/excel
```

Anyone with that link downloads the current file (no login). It only works while the app is running.

**Keep the local file closed in Excel while staff are pushing** — Excel locks it, and a push during that time will fail until you close it.

## Sync to Google Sheets (cloud link)

A Google Sheet lives in the cloud, so its link keeps working from anywhere even when your PC/server is off. Setting it up takes ~3 minutes:

1. Open https://sheets.new, create a spreadsheet, name its first tab (e.g. `Staff Presence`).
2. In the spreadsheet: **Extensions → Apps Script** → delete the default code → paste the whole contents of **`google_sheet_code.gs`** (in this folder) → Save.
3. **Deploy → New deployment → Web app**: *Execute as* = Me, *Who has access* = **Anyone** → Deploy → Allow/Authorize when prompted. Copy the URL (looks like `https://script.google.com/macros/s/AKfycb.../exec`).
4. Tell the app about it — create a file named **`google_sheet_webhook.txt`** in this project folder containing only that URL (or set the env var `GOOGLE_SHEET_WEBHOOK`). Restart `python app.py`; the banner should say **Google Sheets sync: ON**.
5. Optional: in the spreadsheet, Share → *Anyone with the link* → Viewer, and send that link to whoever should see attendance.

From then on, every PUSH is appended to both the local Excel file and the Google Sheet. If Google is briefly unreachable the push still succeeds locally and the miss is logged in the server console.

Re-enable by emptying/deleting `google_sheet_webhook.txt` (or unsetting the env var) and restarting.

## Dummy logins

| Role | ID | Password |
|------|----|----------|
| Staff | `STAFF001` … `STAFF050` (or any `STAFF###`) | `staff123` |

## Run (share on phones on the same Wi-Fi)

```bash
pip install -r requirements.txt
python app.py
```

The console prints a LAN URL, for example: `http://192.168.x.x:3000`

Allow location access on the phone.

### ⚠️ Phone GPS needs HTTPS

Android Chrome and iPhone Safari only allow GPS (geolocation) on **HTTPS** (or `localhost`). Over plain `http://<lan-ip>` staff can log in and the button works, but **block detection will fail** because the browser blocks GPS.

Two options for real on-campus testing from a phone:

1. **Tunnel (recommended, easiest):** run one of these, then share the `https://…` link it prints (also works from outside the campus Wi-Fi):
   ```bash
   cloudflared tunnel --url http://localhost:3000
   # or
   npx ngrok http 3000
   ```
2. **Deploy:** host `app.py` anywhere that gives HTTPS (Railway, Render, Fly, a college server, etc.):
   ```bash
   pip install -r requirements.txt
   gunicorn app:app --bind 0.0.0.0:3000
   ```
   The tunneled/deployed link is then accessible to **whoever has the link** — no install, no app store. The Excel file still lands on the computer/disk that runs the app.

On the phone you can also use **Add to Home Screen** (Chrome menu → Add to Home screen) — the portal opens full-screen like an app with an RIT icon.

## Notes

- **One punch per Staff ID, ever** (per the spec: the button is clickable only once). Ask for a "once per day" variant if needed for real attendance — that is a one-line change in `app.py`.
- Staff ID/password are dummy and checked only in `app.py` — swap in a real staff table or Firebase later.
- Location is matched as **bounding boxes** from the coordinates PDF. If you have precise building polygons from the PDF, they can replace the box check in `geofence.py::detect_location` without touching anything else.
- `staff_presence.xlsx` currently contains earlier test punches; clear its rows (keep the header) to start fresh.

## Blocks (from the coordinates PDF)

| Place | Longitude | Latitude |
|-------|-----------|----------|
| A / Admin Block | 80.0452364 → 80.0457732 | 13.0381457 → 13.0386539 |
| B Block | 80.0448116 → 80.0450932 | 13.0386850 → 13.0394490 |
| C-Block | 80.0454785 → 80.0459096 | 13.0388561 → 13.0399281 |
| Steve Jobs | 80.0445206 → 80.0448954 | 13.0395535 → 13.0398507 |
| Green Building | 80.0447137 → 80.0450191 | 13.0377332 → 13.0381709 |
| Invisible Statue | 80.0449631 → 80.0452458 | 13.0396760 → 13.0403240 |
| Canteen (Bill Counter) | 80.0453383 → 80.0454868 | 13.0399611 → 13.0403701 |
| Canteen (Calcutta Box) | 80.0452012 → 80.0453752 | 13.0403335 → 13.0405236 |

Anywhere else is recorded as **Outside**.

## Repository layout

- `app.py`, `templates/`, `static/`, `geofence.py` — **the live app** (Flask + openpyxl). This is what you run.
- `staff_presence.xlsx` — the admin Excel file this app updates.
- `src/`, `server.ts`, `data/pushes.json`, `package.json`, `staff_presence*.csv` — leftovers from an earlier React/Express prototype; **not used** (ignore or delete).
