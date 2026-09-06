/**
 * RIT Staff Attendance - Google Sheet sync webhook
 * =================================================
 *
 * SETUP:
 * 1. https://sheets.new -> new spreadsheet.
 * 2. In the spreadsheet: Extensions -> Apps Script.
 *    Delete sample code, paste ALL of this file, press Ctrl+S.
 * 3. Deploy -> New deployment -> Web app:
 *      Execute as: Me   |   Who has access: Anyone
 *    Deploy -> authorize -> copy the /exec URL.
 * 4. Save that URL into google_sheet_webhook.txt (project folder) or
 *    GOOGLE_SHEET_WEBHOOK env var, restart the server.
 *
 * NOTE: doGet only exists as a health check. If opening the URL in a
 * browser shows "RIT punch webhook OK", the deployment is live.
 */

function doGet() {
  return ContentService.createTextOutput('RIT punch webhook OK')
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var staffId = String(payload.staff_id || '').trim();
    var time = String(payload.time || '').trim();
    var block = String(payload.block || 'Outside').trim();

    if (!staffId) {
      throw new Error('Missing staff_id in request body');
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheets()[0];

    // Add the header row once, if the sheet is still empty.
    if (!sheet.getRange('A1').getValue()) {
      sheet.appendRow(['Staff ID', 'Time', 'Block']);
    }

    sheet.appendRow([staffId, time, block]);

    return ContentService.createTextOutput(
      JSON.stringify({ success: true })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, error: String(err) })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}
