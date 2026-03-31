// ============================================================
//  Google Apps Script — ESP32 → Google Sheets Driver
//  Based on your working "SHEET DRIVER" approach
// ============================================================

// ---------- Settings ----------
// Paste real values from your working deployment
var SHEET_ID       = "1MHJBLY5a7idjjQG783aYYf_lraHXmGmvivIZ1n0pqDE";
var API_SECRET_KEY = "YOUR_SECRET_KEY_HERE";

var TIMESTAMP_FORMAT = "yyyy-MM-dd HH:mm:ss";
var TIMEZONE         = "Asia/Jerusalem";

// Same base columns as your driver + support for extended rows
var COLUMN_HEADERS = [
  "Timestamp", "EPC", "first_ms", "last_ms", "count", "antenna", "rssi_dbm", "place",
  "comments", "laps", "round", "mode", "station", "evaluator_name", "evaluator_team"
];

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);

    var payload = JSON.parse(e.postData.contents || "{}");

    // Optional auth (works even if key is not used in your script)
    if (API_SECRET_KEY && API_SECRET_KEY !== "YOUR_SECRET_KEY_HERE") {
      if (payload.key !== API_SECRET_KEY) {
        return buildResponse(false, "Unauthorized");
      }
    }

    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = getOrCreateSheet(ss, "תוצאות");

    // 1) Your exact working single-row format
    //    { place, epc, first_ms, antenna, rssi, round, ... }
    if (!payload.rows && payload.epc) {
      ensureSimpleHeaders_(sheet);

      var firstMs = Number(payload.first_ms || 0);
      var epc = String(payload.epc || "");
      var roundNum = Number(payload.round || 0);
      var maxRound = getMaxRoundNumeric_(sheet);

      // Ignore stale rows from older rounds to prevent round divider chaos
      if (maxRound > 0 && roundNum > 0 && roundNum < maxRound) {
        return buildResponse(true, "Skipped stale round row");
      }

      // Upsert by (round + EPC): one participant row per round
      var existingRow = findSimpleRowByEpcRound_(sheet, epc, roundNum);
      if (existingRow > 0) {
        updateSimpleRow_(sheet, existingRow, payload);
        return buildResponse(true, "Updated existing row");
      }

      // Prevent duplicate inserts (same participant reading synced again)
      if (isDuplicateSimpleRow_(sheet, epc, firstMs, roundNum)) {
        return buildResponse(true, "Skipped duplicate row");
      }

      if (roundNum > maxRound) {
        appendRoundDividerIfNeeded_(sheet, roundNum);
      }

      var totalSec = Math.floor(firstMs / 1000);
      var minutes = Math.floor(totalSec / 60);
      var seconds = totalSec % 60;
      var timeStr = minutes + ":" + ("0" + seconds).slice(-2);

      var station = String(payload.station || "");
      var evaluatorName = String(payload.evaluator_name || "");
      var evaluatorTeam = String(payload.evaluator_team || "");
      var comments = String(payload.comments || "");

      sheet.appendRow([
        Number(payload.place || 0),
        epc,
        firstMs,
        timeStr,
        Number(payload.antenna || 0),
        Number(payload.rssi || 0),
        roundNum,
        Utilities.formatDate(new Date(), TIMEZONE, TIMESTAMP_FORMAT),
        station,
        evaluatorName,
        evaluatorTeam,
        comments
      ]);

      return buildResponse(true, "Written 1 row to 'תוצאות'");
    }

    // 2) Backward-compatible batch format
    //    { device, rows: [[...]], round, mode }
    var rows = payload.rows || [];
    var round = payload.round || "";
    var mode = payload.mode || "";
    if (!rows.length) return buildResponse(false, "Missing payload data");

    ensureExtendedHeaders_(sheet);

    var timestamp = Utilities.formatDate(new Date(), TIMEZONE, TIMESTAMP_FORMAT);
    var station = String(payload.station || payload.evaluator_team || "");
    var evaluatorName = String(payload.evaluator_name || "");
    var evaluatorTeam = String(payload.evaluator_team || "");
    var dataToWrite = rows.map(function(row) {
      var epc = row[0] || "";
      var firstMsv = row[1] || 0;
      var lastMs = row[2] || 0;
      var count = row[3] || 1;
      var antenna = row[4] || 0;
      var rssi = row[5] || 0;
      var place = row[6] || 0;
      var comments = Array.isArray(row[7]) ? row[7].join(", ") : (row[7] || "");
      var laps = row[8] || "";
      return [timestamp, epc, firstMsv, lastMs, count, antenna, rssi, place, comments, laps, round, mode, station, evaluatorName, evaluatorTeam];
    });

    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, dataToWrite.length, dataToWrite[0].length).setValues(dataToWrite);
    return buildResponse(true, "Written " + dataToWrite.length + " rows to 'תוצאות'");

  } catch (err) {
    return buildResponse(false, "Error: " + err.message);
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
  }
}

function doGet(e) {
  return buildResponse(true, "RFID Web Driver is alive");
}

function getOrCreateSheet(spreadsheet, sheetName) {
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }
  return sheet;
}

function ensureSimpleHeaders_(sheet) {
  var headers = ["מקום", "EPC", "זמן (ms)", "זמן (mm:ss)", "אנטנה", "RSSI", "סבב", "תאריך", "תחנה", "מעריך", "צוות מעריך", "הערות"];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, 12)
         .setFontWeight("bold")
         .setBackground("#4a86e8")
         .setFontColor("white");
    sheet.setFrozenRows(1);
    return;
  }

  // שדרוג שורת כותרות קיימת (בקבצים ישנים בלי תחנה/מעריך)
  var existing = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  var needsUpgrade = false;
  for (var i = 0; i < headers.length; i++) {
    if (String(existing[i] || "") !== headers[i]) { needsUpgrade = true; break; }
  }
  if (needsUpgrade) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}

function ensureExtendedHeaders_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMN_HEADERS);
    sheet.getRange(1, 1, 1, COLUMN_HEADERS.length)
         .setFontWeight("bold")
         .setBackground("#4A90D9")
         .setFontColor("#FFFFFF");
    sheet.setFrozenRows(1);
    return;
  }

  // שדרוג כותרות קיימות גם בגיליון ישן
  var existing = sheet.getRange(1, 1, 1, COLUMN_HEADERS.length).getValues()[0];
  var needsUpgrade = false;
  for (var i = 0; i < COLUMN_HEADERS.length; i++) {
    if (String(existing[i] || "") !== String(COLUMN_HEADERS[i] || "")) { needsUpgrade = true; break; }
  }
  if (needsUpgrade) {
    sheet.getRange(1, 1, 1, COLUMN_HEADERS.length).setValues([COLUMN_HEADERS]);
  }
}

function appendRoundDividerIfNeeded_(sheet, round) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;
  var lastRound = sheet.getRange(lastRow, 7).getValue();
  if (String(lastRound) !== String(round)) {
    sheet.appendRow(["--- סבב " + round + " ---", "", "", "", "", "", "", ""]);
    sheet.getRange(sheet.getLastRow(), 1, 1, 8)
         .setBackground("#d9ead3")
         .setFontWeight("bold");
  }
}

function getMaxRoundNumeric_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;
  var vals = sheet.getRange(2, 7, lastRow - 1, 1).getValues();
  var maxRound = 0;
  for (var i = 0; i < vals.length; i++) {
    var n = Number(vals[i][0] || 0);
    if (n > maxRound) maxRound = n;
  }
  return maxRound;
}

function findSimpleRowByEpcRound_(sheet, epc, round) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return -1;
  var lookback = 1200;
  var startRow = Math.max(2, lastRow - lookback + 1);
  var rowCount = lastRow - startRow + 1;
  if (rowCount <= 0) return -1;

  // Read EPC (col 2) + round (col 7)
  var vals = sheet.getRange(startRow, 2, rowCount, 6).getValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    var rowEpc = String(vals[i][0] || "");
    var rowRound = Number(vals[i][5] || 0);
    if (rowEpc === epc && rowRound === round) {
      return startRow + i;
    }
  }
  return -1;
}

function updateSimpleRow_(sheet, rowIndex, payload) {
  // Read all 12 columns (not just 8!)
  var oldVals = sheet.getRange(rowIndex, 1, 1, 12).getValues()[0];

  var oldPlace = Number(oldVals[0] || 0);
  var oldFirst = Number(oldVals[2] || 0);
  var oldAnt   = Number(oldVals[4] || 0);
  var oldRssi  = Number(oldVals[5] || 0);

  var newPlace = Number(payload.place || 0);
  var newFirst = Number(payload.first_ms || 0);
  var newAnt   = Number(payload.antenna || 0);
  var newRssi  = Number(payload.rssi || 0);
  var roundNum = Number(payload.round || 0);

  // Keep earliest first_ms
  var bestFirst = oldFirst;
  if (bestFirst <= 0 || (newFirst > 0 && newFirst < bestFirst)) {
    bestFirst = newFirst;
  }
  var totalSec = Math.floor(bestFirst / 1000);
  var minutes  = Math.floor(totalSec / 60);
  var seconds  = totalSec % 60;
  var timeStr  = minutes + ":" + ("0" + seconds).slice(-2);

  var place   = (newPlace > 0) ? newPlace : oldPlace;
  var antenna = (newAnt !== 0) ? newAnt : oldAnt;
  var rssi    = (newRssi !== 0) ? newRssi : oldRssi;

  var station       = String(payload.station       || oldVals[8]  || "");
  var evaluatorName = String(payload.evaluator_name || oldVals[9]  || "");
  var evaluatorTeam = String(payload.evaluator_team || oldVals[10] || "");

  // Merge comments: combine old + new, deduplicate, pipe-separated
  var oldComments = String(oldVals[11] || "");
  var newComments = String(payload.comments || "");
  var merged = oldComments;
  if (newComments) {
    var oldArr = oldComments ? oldComments.split("|").map(function(s){ return s.trim(); }) : [];
    var newArr = newComments.split("|").map(function(s){ return s.trim(); });
    newArr.forEach(function(tag) {
      if (tag && oldArr.indexOf(tag) === -1) oldArr.push(tag);
    });
    merged = oldArr.join("|");
  }

  sheet.getRange(rowIndex, 1, 1, 12).setValues([[
    place,
    String(payload.epc || oldVals[1] || ""),
    bestFirst,
    timeStr,
    antenna,
    rssi,
    roundNum,
    Utilities.formatDate(new Date(), TIMEZONE, TIMESTAMP_FORMAT),
    station,
    evaluatorName,
    evaluatorTeam,
    merged
  ]]);
}

function isDuplicateSimpleRow_(sheet, epc, firstMs, round) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false;

  // Search only recent rows for performance
  var lookback = 400;
  var startRow = Math.max(2, lastRow - lookback + 1);
  var rowCount = lastRow - startRow + 1;
  if (rowCount <= 0) return false;

  var values = sheet.getRange(startRow, 1, rowCount, 8).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    var row = values[i];
    var rowEpc = String(row[1] || "");
    var rowFirstMs = Number(row[2] || 0);
    var rowRound = Number(row[6] || 0);

    if (rowEpc === epc && rowFirstMs === firstMs && rowRound === round) {
      return true;
    }
  }
  return false;
}

function buildResponse(success, message) {
  var result = JSON.stringify({ success: success, message: message });
  return ContentService.createTextOutput(result)
                       .setMimeType(ContentService.MimeType.JSON);
}
