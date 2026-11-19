import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import * as xlsxModule from 'xlsx';
const XLSX = (xlsxModule as any).default || xlsxModule;
import { detectLocation } from './src/geofence.ts';

const app = express();
const PORT = 3000;

app.use(express.json());

// DEMO / DUMMY CREDENTIALS
// Pre-configured staff accounts (STAFF001 to STAFF050 + custom accounts)
const DUMMY_STAFF: Record<string, string> = {
  ADMIN01: 'admin123',
  HOD01: 'staff123',
};

for (let i = 1; i <= 50; i++) {
  const id = `STAFF${i.toString().padStart(3, '0')}`;
  DUMMY_STAFF[id] = 'staff123';
}

function authenticateStaff(staffId: string, password: string): boolean {
  const normalizedId = staffId.trim().toUpperCase();
  const trimmedPassword = password.trim();

  // Check explicit registered accounts
  if (DUMMY_STAFF[normalizedId] && DUMMY_STAFF[normalizedId] === trimmedPassword) {
    return true;
  }

  // Dynamic support for any STAFF### pattern with default password 'staff123'
  if (/^STAFF\d+$/i.test(normalizedId) && trimmedPassword === 'staff123') {
    return true;
  }

  return false;
}

// Paths for persistence
const DATA_DIR = path.join(process.cwd(), 'data');
const PUSHES_JSON_FILE = path.join(DATA_DIR, 'pushes.json');
const EXCEL_FILE = path.join(process.cwd(), 'staff_presence.xlsx');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory / file-persisted pushed staff tracking
interface PushRecord {
  staffId: string;
  phoneNumber?: string;
  date?: string;
  timestamp: string;
  latitude: number;
  longitude: number;
  location: string;
}

interface AttendanceRecord {
  staffId: string;
  phoneNumber?: string;
  date: string;
  time: string;
  timestamp?: string;
  block?: string;
  isAttendance?: boolean;
}

const RECORDS_JSON_FILE = path.join(DATA_DIR, 'records.json');

function getTodayDateString(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function loadPushes(): Record<string, PushRecord> {
  try {
    if (fs.existsSync(PUSHES_JSON_FILE)) {
      const data = fs.readFileSync(PUSHES_JSON_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error reading pushes.json:', err);
  }
  return {};
}

function savePushes(pushes: Record<string, PushRecord>): void {
  try {
    fs.writeFileSync(PUSHES_JSON_FILE, JSON.stringify(pushes, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing pushes.json:', err);
  }
}

function loadRecords(): AttendanceRecord[] {
  try {
    if (fs.existsSync(RECORDS_JSON_FILE)) {
      const data = fs.readFileSync(RECORDS_JSON_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error reading records.json:', err);
  }
  return [];
}

function saveRecords(records: AttendanceRecord[]): void {
  try {
    fs.writeFileSync(RECORDS_JSON_FILE, JSON.stringify(records, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing records.json:', err);
  }
}

/**
 * Formats current server time as HH:MM:SS (time only, no date)
 */
function getFormattedTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  const seconds = pad(now.getSeconds());
  return `${hours}:${minutes}:${seconds}`;
}

function formatTimeOnly(timestamp: string): string {
  if (!timestamp) return '';
  const match = timestamp.match(/\b\d{2}:\d{2}:\d{2}\b/);
  return match ? match[0] : timestamp;
}

// Local synchronization destinations on the user's computer
const LOCAL_EXCEL_DESTINATIONS = [
  path.join(process.cwd(), 'staff_presence.xlsx'),
  'C:\\Users\\rosh7\\Downloads\\staff_presence.xlsx',
  'C:\\Users\\rosh7\\OneDrive\\Desktop\\staff_presence.xlsx',
];

/**
 * Syncs all recorded punches and feedback records to staff_presence.xlsx across
 * local computer directories (Project, Downloads, and Desktop).
 * Syncs all recorded punches to staff_presence.xlsx across
 * local computer directories (Project, Downloads, and Desktop).
 */
function syncAllRecordsToExcel(): void {
  try {
    const records = loadRecords();
    const rows = [
      ['Staff ID', 'Phone Number', 'Date', 'Time', 'Block'],
      ...records.map((r) => [
        r.staffId,
        r.phoneNumber || 'Unavailable',
        r.date || getTodayDateString(),
        formatTimeOnly(r.time || r.timestamp || ''),
        r.block || 'Outside',
      ]),
    ];

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet['!cols'] = [
      { wch: 14 },
      { wch: 20 },
      { wch: 14 },
      { wch: 12 },
      { wch: 26 },
    ];
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Staff Presence');

    // Also generate CSV content
    const csvContent = XLSX.utils.sheet_to_csv(worksheet);

    for (const destPath of LOCAL_EXCEL_DESTINATIONS) {
      const dir = path.dirname(destPath);
      if (fs.existsSync(dir)) {
        // 1. Try writing main .xlsx file, or fallback to _latest.xlsx if locked by Excel
        try {
          XLSX.writeFile(workbook, destPath);
          console.log(`[Excel Sync] Updated: ${destPath}`);
        } catch (fileErr: any) {
          if (fileErr.code === 'EBUSY') {
            console.warn(`[Excel Sync] Notice: ${destPath} is open in Excel. Saving fallback copy...`);
            try {
              const fallbackPath = destPath.replace(/\.xlsx$/i, '_latest.xlsx');
              XLSX.writeFile(workbook, fallbackPath);
              console.log(`[Excel Sync] Updated fallback: ${fallbackPath}`);
            } catch {}
          } else {
            console.error(`[Excel Sync] Error writing to ${destPath}:`, fileErr);
          }
        }

        // 2. Always write companion .csv (never blocked by Excel viewer)
        try {
          const csvPath = destPath.replace(/\.xlsx$/i, '.csv');
          fs.writeFileSync(csvPath, csvContent, 'utf-8');
        } catch (csvErr: any) {
          console.error(`[Excel Sync] Error writing CSV to ${destPath}:`, csvErr);
        }
      }
    }
  } catch (err: any) {
    console.error('[Excel Sync] Critical error syncing records:', err);
  }
}

/**
 * Initialize on startup: read any existing rows in staff_presence.xlsx
 * and ensure they exist in records.json and pushes.json, then ensure Excel is up-to-date.
 */
function initExcelSync(): void {
  try {
    let records = loadRecords();
    const pushes = loadPushes();

    if (records.length === 0 && fs.existsSync(EXCEL_FILE)) {
      const workbook = XLSX.readFile(EXCEL_FILE);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet);

      for (const row of rows) {
        const sid = String(row['Staff ID'] || '').trim().toUpperCase();
        const dateVal = String(row['Date'] || '').trim();
        const timeVal = formatTimeOnly(String(row['Time'] || row['Timestamp'] || getFormattedTimestamp()));
        const phoneVal = String(row['Phone Number'] || 'Unavailable').trim() || 'Unavailable';
        const rawBlock = String(row['Block'] || row['Location'] || '').trim();
        const blockVal = rawBlock.toLowerCase() === 'none' ? 'Outside' : rawBlock || 'Outside';

        if (sid && dateVal) {
          records.push({
            staffId: sid,
            phoneNumber: phoneVal,
            date: dateVal,
            time: timeVal,
            block: blockVal,
            isAttendance: true,
          });

          if (!pushes[sid]) {
            pushes[sid] = {
              staffId: sid,
              phoneNumber: phoneVal,
              date: dateVal,
              timestamp: timeVal,
              latitude: 0,
              longitude: 0,
              location: blockVal,
            };
          }
        }
      }

      saveRecords(records);
      savePushes(pushes);
    }

    syncAllRecordsToExcel();
  } catch (err) {
    console.error('Error initializing Excel sync:', err);
  }
}

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// Staff login
app.post('/api/login', (req, res) => {
  const { staffId, password } = req.body;

  if (!staffId || !password) {
    return res.status(400).json({ success: false, message: 'Staff ID and password required.' });
  }

  const normalizedId = String(staffId).trim().toUpperCase();

  if (!authenticateStaff(normalizedId, String(password))) {
    return res.status(401).json({ success: false, message: 'Invalid Staff ID or password.' });
  }

  const pushes = loadPushes();
  const alreadyPushed = Boolean(pushes[normalizedId]);

  return res.json({
    success: true,
    staffId: normalizedId,
    alreadyPushed,
  });
});

// Check staff push status
app.get('/api/status', (req, res) => {
  const staffId = req.query.staffId ? String(req.query.staffId).trim().toUpperCase() : '';

  if (!staffId) {
    return res.status(400).json({ success: false, message: 'staffId query parameter required.' });
  }

  const pushes = loadPushes();
  const record = pushes[staffId];

  return res.json({
    success: true,
    staffId,
    pushed: Boolean(record),
  });
});

// Record push (strictly attendance)
app.post('/api/push', (req, res) => {
  const { staffId, latitude, longitude, phoneNumber } = req.body;

  if (!staffId) {
    return res.status(400).json({ success: false, message: 'Staff ID is required.' });
  }

  const normalizedId = String(staffId).trim().toUpperCase();
  const normalizedPhone = String(phoneNumber || 'Unavailable').trim() || 'Unavailable';

  // Validate staff member exists or matches pattern
  if (!DUMMY_STAFF[normalizedId] && !/^STAFF\d+$/i.test(normalizedId)) {
    return res.status(403).json({ success: false, message: 'Unrecognized Staff ID.' });
  }

  // Duplicate check - once per day per staff ID
  const pushes = loadPushes();
  const today = getTodayDateString();
  if (pushes[normalizedId] && pushes[normalizedId].date === today) {
    return res.status(400).json({
      success: false,
      message: 'Push already recorded for this staff member.',
      alreadyPushed: true,
    });
  }

  // Validate coordinates
  const lat = parseFloat(latitude);
  const lon = parseFloat(longitude);

  if (isNaN(lat) || isNaN(lon)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid GPS coordinates received.',
    });
  }

  // Detect location using geofence logic
  const detectedPlace = detectLocation(lat, lon);

  // Generate server timestamp in HH:MM:SS format
  const timestamp = getFormattedTimestamp();

  const record: PushRecord = {
    staffId: normalizedId,
    phoneNumber: normalizedPhone,
    date: today,
    timestamp,
    latitude: lat,
    longitude: lon,
    location: detectedPlace,
  };

  // Persist record
  pushes[normalizedId] = record;
  savePushes(pushes);

  const records = loadRecords();
  records.push({
    staffId: normalizedId,
    phoneNumber: normalizedPhone,
    date: today,
    time: timestamp,
    block: detectedPlace,
    isAttendance: true,
  });
  saveRecords(records);

  // Sync immediately to Excel file across all destinations
  syncAllRecordsToExcel();

  return res.json({
    success: true,
    status: 'PUSHED',
    staff_id: normalizedId,
    phone_number: normalizedPhone,
    date: today,
    time: timestamp,
    block: detectedPlace,
  });
});

// Completely Independent Staff Remark submission
app.post('/api/remark', (req, res) => {
  const staffId = req.body.staff_id || req.body.staffId;
  const remark = req.body.remark || req.body.remarkText;

  if (!staffId || !String(staffId).trim()) {
    return res.status(400).json({ success: false, error: 'Staff ID is required.' });
  }

  const cleanRemark = String(remark || '').trim();
  if (!cleanRemark) {
    return res.status(400).json({ success: false, error: 'Remark text is required.' });
  }

  const normalizedId = String(staffId).trim().toUpperCase();
  const today = getTodayDateString();
  const timestamp = getFormattedTimestamp();

  // Save independently to staff_remarks.json
  const remarksFile = path.join(__dirname, 'staff_remarks.json');
  try {
    let existing: any[] = [];
    if (fs.existsSync(remarksFile)) {
      existing = JSON.parse(fs.readFileSync(remarksFile, 'utf-8'));
    }
    existing.push({
      staff_id: normalizedId,
      date: today,
      time: timestamp,
      remark: cleanRemark,
    });
    fs.writeFileSync(remarksFile, JSON.stringify(existing, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error persisting remark:', err);
  }

  return res.json({
    success: true,
    message: 'Remark submitted successfully!',
    staff_id: normalizedId,
    date: today,
    time: timestamp,
    remark: cleanRemark,
  });
});

// Return all recorded punches & feedback entries in JSON format
app.get('/api/records', (req, res) => {
  const records = loadRecords();
  return res.json({
    success: true,
    count: records.length,
    records,
  });
});

// Admin-only Excel download (not linked from the staff UI)
app.get('/api/download-excel', (req, res) => {
  const key = String(req.query.key || req.headers['x-admin-key'] || '');
  if (key !== 'admin123') {
    return res.status(403).json({ error: 'Admin only.' });
  }
  syncAllRecordsToExcel();
  if (fs.existsSync(EXCEL_FILE)) {
    res.download(EXCEL_FILE, 'staff_presence.xlsx');
  } else {
    res.status(404).json({ error: 'Excel file not yet generated.' });
  }
});

// ----------------------------------------------------
// VITE & STATIC FILE SERVING
// ----------------------------------------------------
async function startServer() {
  initExcelSync();

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
