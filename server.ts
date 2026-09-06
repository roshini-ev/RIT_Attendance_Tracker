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
  timestamp: string;
  latitude: number;
  longitude: number;
  location: string;
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
 * Syncs all recorded pushes from pushes.json to staff_presence.xlsx across
 * local computer directories (Project, Downloads, and Desktop).
 * Reconstructs the sheet so every push is accurately and reliably saved.
 */
function syncAllPushesToExcel(): void {
  try {
    const pushes = loadPushes();
    const rows = [
      ['Staff ID', 'Time', 'Block'],
      ...Object.values(pushes).map((p) => [
        p.staffId,
        formatTimeOnly(p.timestamp),
        p.location,
      ]),
    ];

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
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
    console.error('[Excel Sync] Critical error syncing pushes:', err);
  }
}

/**
 * Initialize on startup: read any existing rows in staff_presence.xlsx
 * and ensure they exist in pushes.json, then ensure Excel is up-to-date.
 */
function initExcelSync(): void {
  try {
    if (fs.existsSync(EXCEL_FILE)) {
      const workbook = XLSX.readFile(EXCEL_FILE);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet);
      const pushes = loadPushes();
      let changed = false;

      for (const row of rows) {
        const sid = String(row['Staff ID'] || '').trim().toUpperCase();
        if (sid && !pushes[sid]) {
          pushes[sid] = {
            staffId: sid,
            timestamp: String(row['Timestamp'] || getFormattedTimestamp()),
            latitude: Number(row['Latitude']) || 0,
            longitude: Number(row['Longitude']) || 0,
            location: String(row['Block'] || row['Location'] || 'Outside'),
          };
          changed = true;
        }
      }

      if (changed) {
        savePushes(pushes);
      }
    }
    syncAllPushesToExcel();
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

// Record push
app.post('/api/push', (req, res) => {
  const { staffId, latitude, longitude } = req.body;

  if (!staffId) {
    return res.status(400).json({ success: false, message: 'Staff ID is required.' });
  }

  const normalizedId = String(staffId).trim().toUpperCase();

  // Validate staff member exists or matches pattern
  if (!DUMMY_STAFF[normalizedId] && !/^STAFF\d+$/i.test(normalizedId)) {
    return res.status(403).json({ success: false, message: 'Unrecognized Staff ID.' });
  }

  // Duplicate check - server-side prevention
  const pushes = loadPushes();
  if (pushes[normalizedId]) {
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

  // Generate server timestamp in YYYY-MM-DD HH:MM:SS format
  const timestamp = getFormattedTimestamp();

  const record: PushRecord = {
    staffId: normalizedId,
    timestamp,
    latitude: lat,
    longitude: lon,
    location: detectedPlace,
  };

  // Persist record
  pushes[normalizedId] = record;
  savePushes(pushes);

  // Sync immediately to Excel file
  syncAllPushesToExcel();

  return res.json({
    success: true,
    status: 'PUSHED',
  });
});

// Admin-only Excel download (not linked from the staff UI)
app.get('/api/download-excel', (req, res) => {
  const key = String(req.query.key || req.headers['x-admin-key'] || '');
  if (key !== 'admin123') {
    return res.status(403).json({ error: 'Admin only.' });
  }
  syncAllPushesToExcel();
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
