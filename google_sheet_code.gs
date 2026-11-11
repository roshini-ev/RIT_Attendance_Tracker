/**
 * RIT Staff Attendance - Google Sheet sync webhook
 * =================================================
 *
 * SETUP:
 * 1. https://sheets.new -> new spreadsheet.
 * 2. In the spreadsheet: Extensions -> Apps Script.
 *    Delete sample code, paste ALL of this file, press Ctrl+S.
 * 3. Deploy -> New deployment (or Manage deployments -> Edit -> New version) -> Web app:
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

function ensureAttendanceHeaders_(sheet) {
  if (!sheet.getRange('A1').getValue()) {
    sheet.appendRow(['Staff ID', 'Phone Number', 'Date', 'Time', 'Block']);
    sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
    return;
  }

  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var rawHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var normHeaders = rawHeaders.map(function (h) {
    return String(h || '').trim().toLowerCase();
  });

  // Remove any previously added Status column if present
  var statusIdx = normHeaders.indexOf('status');
  if (statusIdx !== -1) {
    sheet.deleteColumn(statusIdx + 1);
    lastCol = Math.max(sheet.getLastColumn(), 1);
    rawHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    normHeaders = rawHeaders.map(function (h) {
      return String(h || '').trim().toLowerCase();
    });
  }

  // Upgrade legacy 3-column sheet (Staff ID, Time, Block)
  if (normHeaders.indexOf('phone number') === -1 && normHeaders.indexOf('date') === -1 && normHeaders[1] === 'time') {
    sheet.insertColumnBefore(2);
    sheet.getRange('B1').setValue('Date');
    sheet.insertColumnBefore(2);
    sheet.getRange('B1').setValue('Phone Number');
  } else if (normHeaders.indexOf('phone number') === -1) {
    // Insert Phone Number before Date (column B) for 4-column sheets
    sheet.insertColumnBefore(2);
    sheet.getRange('B1').setValue('Phone Number');
  }

  // Format header row bold
  sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 5)).setFontWeight('bold');
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var staffId = String(payload.staff_id || '').trim();
    var phoneNumber = String(payload.phone_number || 'Unavailable').trim();
    var date = String(payload.date || Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd')).trim();
    var time = String(payload.time || '').trim();
    var block = String(payload.block || 'Outside').trim();

    if (!staffId) {
      throw new Error('Missing staff_id in request body');
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheets()[0];

    ensureAttendanceHeaders_(sheet);

    var lastCol = Math.max(sheet.getLastColumn(), 5);
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
      return String(h || '').trim().toLowerCase();
    });

    var rowValues = new Array(headers.length);
    for (var i = 0; i < headers.length; i++) {
      var h = headers[i];
      if (h === 'staff id') {
        rowValues[i] = staffId;
      } else if (h === 'phone number') {
        rowValues[i] = phoneNumber;
      } else if (h === 'date') {
        rowValues[i] = date;
      } else if (h === 'time' || h === 'timestamp') {
        rowValues[i] = time;
      } else if (h === 'block' || h === 'detected block' || h === 'location') {
        rowValues[i] = block;
      } else {
        rowValues[i] = '';
      }
    }

    sheet.appendRow(rowValues);
    var newRowIndex = sheet.getLastRow();
    var phoneColIndex = headers.indexOf('phone number') + 1;
    if (phoneColIndex > 0) {
      // Preserve leading '+' (e.g. +919876543210) as plain text instead of formula/scientific notation
      sheet.getRange(newRowIndex, phoneColIndex).setNumberFormat('@').setValue(phoneNumber);
    }

    return ContentService.createTextOutput(
      JSON.stringify({ success: true })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, error: String(err) })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}
