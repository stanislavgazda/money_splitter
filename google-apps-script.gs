/**
 * Money Splitter – Google Sheets backend (v3: password via Script Properties)
 * Paste this into Extensions → Apps Script of your Google Sheet.
 *
 * 1. Set the password OUTSIDE the code (so this file is safe to keep in a
 *    public git repo): in the Apps Script editor go to
 *    Project Settings (⚙️) → Script Properties → Add script property:
 *      Property: TOKEN      Value: <your family password>
 * 2. Deploy → Manage deployments → edit (pencil) → Version: New version → Deploy.
 *    (This keeps the same /exec URL.)
 *
 * Changing the password later = just edit the script property; no redeploy needed.
 */
function getToken_() {
  return PropertiesService.getScriptProperties().getProperty('TOKEN');
}

var SHEET_NAME = 'Ledger';
var SETTINGS_SHEET = 'Settings';
var QUOTES_SHEET = 'Výroky';
var HEADERS = ['ID', 'Kind', 'Date', 'From / Payer', 'To / Meal', 'Total', 'Details', 'Poznámka', 'Účtenka', 'JSON'];
var NEW_COLS = ['Poznámka', 'Účtenka'];

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

/* Sheets created before Poznámka/Účtenka existed are widened in place, so the
   JSON column keeps its data and old rows stay readable. Only ever called from
   the write path, which holds the script lock – two concurrent migrations would
   insert the columns twice. Reads don't need it: colIndex_ handles both layouts. */
function migrateColumns_(sh) {
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var jsonAt = head.indexOf('JSON');
  if (jsonAt < 0) return; // unrecognised layout – don't touch it
  for (var i = 0; i < NEW_COLS.length; i++) {
    if (head.indexOf(NEW_COLS[i]) >= 0) continue;
    sh.insertColumnBefore(jsonAt + 1);
    sh.getRange(1, jsonAt + 1).setValue(NEW_COLS[i]);
    jsonAt++;
    head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  }
}

/* 0-based index of a column, looked up by header name (never hardcode it:
   the JSON column moves when new columns are added). */
function colIndex_(sh, name) {
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  return head.indexOf(name);
}

/* 1-based sheet row holding this entry id, or -1. */
function rowOfId_(sh, id) {
  if (sh.getLastRow() < 2) return -1;
  var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function getSettingsSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SETTINGS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SETTINGS_SHEET);
    sh.getRange(1, 2).setValue('App settings (JSON in A1) – edit via the app, not here');
  }
  return sh;
}

function readSettings_() {
  try {
    var v = getSettingsSheet_().getRange(1, 1).getValue();
    if (v) return JSON.parse(v);
  } catch (err) { /* malformed – ignore */ }
  return null;
}

/* ---------- babine výroky ----------
 * One quote per row in column A of the "Výroky" sheet, so anyone can add or
 * fix one straight in the spreadsheet without touching the app. Column B is
 * only a note about when it was added – the app never reads it.
 */
function getQuotesSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(QUOTES_SHEET);
  if (!sh) {
    sh = ss.insertSheet(QUOTES_SHEET);
    sh.appendRow(['Výrok', 'Pridané']);
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 520);
    sh.getRange(1, 4).setValue('Sem píšte babine výroky – jeden na riadok do stĺpca A. Aplikácia každý deň ukáže jeden.');
  }
  return sh;
}

function readQuotes_() {
  var sh;
  // doGet has no lock, so two first-ever reads could race on insertSheet;
  // losing that race must not fail the whole sync.
  try { sh = getQuotesSheet_(); }
  catch (err) { sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(QUOTES_SHEET); }
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var t = String(vals[i][0] == null ? '' : vals[i][0]).trim();
    if (t) out.push(t);
  }
  return out;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function authorized_(token) {
  var t = getToken_();
  // If TOKEN property is not set, refuse everything (fail closed).
  return !!t && typeof token === 'string' && token === t;
}

function doGet(e) {
  try {
    if (!e || !e.parameter || !authorized_(e.parameter.token)) {
      return json_({ ok: false, error: 'unauthorized' });
    }
    var sh = getSheet_();
    var entries = [];
    if (sh.getLastRow() > 1) {
      var jc = colIndex_(sh, 'JSON');
      var rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
      for (var i = 0; i < rows.length; i++) {
        try {
          var en = JSON.parse(rows[i][jc]);
          if (en && en.id) entries.push(en);
        } catch (err) { /* skip malformed row */ }
      }
    }
    return json_({ ok: true, entries: entries, settings: readSettings_(), quotes: readQuotes_() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad request' });
  }
  if (!authorized_(body.token)) {
    return json_({ ok: false, error: 'unauthorized' });
  }

  // Bill scanning does not touch the sheet – handled before taking the lock
  if (body.action === 'scanBill' && body.image) {
    try {
      return json_(scanBill_(body.image, body.mime || 'image/jpeg'));
    } catch (err) {
      // e.g. missing UrlFetchApp permission – always answer with JSON so the
      // app shows the real error instead of a CORS "Failed to fetch"
      return json_({ ok: false, error: String(err) });
    }
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = getSheet_();

    if (body.action === 'add' && body.entry && body.entry.id) {
      migrateColumns_(sh);
      var en = body.entry;

      // Writing an entry is idempotent: the client retries whenever a response
      // is lost (dropped connection, network switch), and the row may already
      // have been written by the attempt whose reply never arrived. Answer ok
      // so the retry clears from the queue instead of piling up more rows.
      // This must come before the photo upload, or the retry orphans a second
      // Drive file even though its row is rejected.
      if (rowOfId_(sh, en.id) > 0) {
        return json_({ ok: true, duplicate: true });
      }

      // The photo travels as base64 but is never stored in the sheet – it goes
      // to Drive and only its id/url stay in the entry, so syncs stay small.
      var photoB64 = en.photoB64, photoMime = en.photoMime;
      delete en.photoB64; delete en.photoMime;
      if (photoB64) {
        try {
          var p = savePhoto_(photoB64, photoMime, 'ucet-' + (en.date || '') + '-' + en.id + '.jpg');
          en.photoId = p.id;
          en.photoUrl = p.url;
        } catch (err) { /* keep the entry even if Drive refuses */ }
      }

      var from = '', to = '', total = '', details = '';
      if (en.kind === 'meal') {
        from = en.payer || '';
        to = en.desc || '';
        total = en.total;
        var parts = [];
        var shares = en.shares || {};
        for (var f in shares) parts.push(f + ': ' + shares[f]);
        details = parts.join(', ');
      } else if (en.kind === 'settlement') {
        from = en.from || '';
        to = en.to || '';
        total = en.amount;
        details = 'settlement';
      }
      sh.appendRow([en.id, en.kind, en.date || '', from, to, total, details,
                    en.note || '', '', JSON.stringify(en)]);

      if (en.photoUrl) {
        var pc = colIndex_(sh, 'Účtenka');
        if (pc >= 0) {
          sh.getRange(sh.getLastRow(), pc + 1)
            .setFormula('=HYPERLINK("' + en.photoUrl + '","📷 účtenka")');
        }
      }
      return json_({ ok: true });
    }

    if (body.action === 'delete' && body.id) {
      if (sh.getLastRow() > 1) {
        var jcd = colIndex_(sh, 'JSON');
        var rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
        for (var i = rows.length - 1; i >= 0; i--) {
          if (String(rows[i][0]) === String(body.id)) {
            trashPhoto_(rows[i][jcd]);
            sh.deleteRow(i + 2);
          }
        }
      }
      return json_({ ok: true });
    }

    if (body.action === 'addQuote' && body.text) {
      var qt = String(body.text).trim().slice(0, 500);
      // Adding is idempotent: the client retries a lost reply, and the quote
      // may already be in the sheet from the attempt whose answer never came.
      if (qt && readQuotes_().indexOf(qt) < 0) {
        getQuotesSheet_().appendRow([qt, Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')]);
      }
      return json_({ ok: true, quotes: readQuotes_() });
    }

    // No longer reachable from the app – the Výroky sheet is where výroky get
    // removed now. Kept so any request still queued on a phone drains instead
    // of coming back 'unknown action' and wedging that phone's queue.
    if (body.action === 'deleteQuote' && body.text) {
      var dq = String(body.text).trim();
      var qsh = getQuotesSheet_();
      if (qsh.getLastRow() > 1) {
        var qrows = qsh.getRange(2, 1, qsh.getLastRow() - 1, 1).getValues();
        for (var qi = qrows.length - 1; qi >= 0; qi--) {
          if (String(qrows[qi][0]).trim() === dq) { qsh.deleteRow(qi + 2); break; }
        }
      }
      return json_({ ok: true, quotes: readQuotes_() });
    }

    if (body.action === 'saveSettings' && body.settings) {
      var current = readSettings_();
      // Only overwrite if incoming settings are newer (multi-device safety)
      if (!current || (body.settings.updatedAt || 0) >= (current.updatedAt || 0)) {
        var s = getSettingsSheet_();
        s.getRange(1, 1).setValue(JSON.stringify(body.settings));
        s.getRange(2, 1).setValue('Updated: ' + new Date().toISOString());
      }
      return json_({ ok: true });
    }

    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- receipt photos in Drive ----------
 * Photos are kept in one folder of the sheet owner's Drive. The entry stores
 * only the file id + url, so the ledger that every device downloads stays tiny.
 * Files are shared "anyone with the link" so the link works from the app and
 * straight from the sheet; the link itself is unguessable.
 */
var PHOTO_FOLDER = 'Komu koľko – účtenky';

function getPhotoFolder_() {
  var it = DriveApp.getFoldersByName(PHOTO_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_FOLDER);
}

function savePhoto_(base64, mimeType, name) {
  var blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType || 'image/jpeg', name);
  var file = getPhotoFolder_().createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) { /* workspace policy may forbid link sharing – file still exists */ }
  return { id: file.getId(), url: 'https://drive.google.com/file/d/' + file.getId() + '/view' };
}

function trashPhoto_(jsonText) {
  try {
    var en = JSON.parse(jsonText);
    if (en && en.photoId) DriveApp.getFileById(en.photoId).setTrashed(true);
  } catch (err) { /* no photo, or already gone */ }
}

/* ---------- bill scanning via Gemini vision ----------
 * Requires a (free) API key from https://aistudio.google.com/apikey
 * stored as Script Property GEMINI_API_KEY (Project Settings → Script Properties).
 * The key never leaves the server side, so this file stays safe for a public repo.
 */
var GEMINI_MODEL = 'gemini-3.5-flash'; // 2.5-flash was retired for new users in July 2026

function scanBill_(imageBase64, mimeType) {
  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) return { ok: false, error: 'GEMINI_API_KEY script property is not set' };

  var prompt =
    'You are given a photo of a store or restaurant receipt (likely Slovak). ' +
    'Extract the purchased items and return ONLY valid JSON, no markdown, of the form ' +
    '{"items":[{"name":"...","price":1.23}],"total":12.34}. Rules: ' +
    '1) Expand quantities into individual unit items: a line like "3x Kofola 4.50" or ' +
    '"Kofola 3 ks à 1,50" must produce three separate items named "Kofola", each with the UNIT price. ' +
    '2) "price" is the unit price in euros as a number with dot decimal. ' +
    '3) Include discount/refund lines as items with a negative price. ' +
    '4) Skip non-purchase lines (VAT summaries, card payment, change, loyalty points). ' +
    '5) "total" is the grand total printed on the receipt, or null if unreadable. ' +
    '6) Keep item names short, in the original language.';

  var payload = {
    contents: [{ parts: [
      { inline_data: { mime_type: mimeType, data: imageBase64 } },
      { text: prompt }
    ]}],
    generationConfig: { response_mime_type: 'application/json', temperature: 0 }
  };

  var resp = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + key,
    { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true }
  );
  if (resp.getResponseCode() !== 200) {
    return { ok: false, error: 'Gemini HTTP ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 200) };
  }
  try {
    var data = JSON.parse(resp.getContentText());
    var text = data.candidates[0].content.parts[0].text;
    var parsed = JSON.parse(text);
    var items = [];
    (parsed.items || []).forEach(function (it) {
      if (it && it.name != null && typeof it.price === 'number' && isFinite(it.price)) {
        items.push({ name: String(it.name).slice(0, 80), price: Math.round(it.price * 100) / 100 });
      }
    });
    if (!items.length) return { ok: false, error: 'Na účte sa nepodarilo rozpoznať žiadne položky' };
    var total = (typeof parsed.total === 'number' && isFinite(parsed.total))
      ? Math.round(parsed.total * 100) / 100 : null;
    return { ok: true, items: items, total: total };
  } catch (err) {
    return { ok: false, error: 'response parse: ' + String(err) };
  }
}

/**
 * Manual test – Run this ONCE in the editor after pasting new code:
 * it forces the authorization prompt for "connect to an external service"
 * (UrlFetchApp) and verifies the GEMINI_API_KEY. Check View → Logs:
 * 200 + model list = everything works.
 */
function testGemini() {
  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) { Logger.log('GEMINI_API_KEY script property is not set'); return; }
  var resp = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models?key=' + key,
    { muteHttpExceptions: true });
  Logger.log(resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 300));
}

/**
 * Manual test – Run this ONCE after pasting the photo version: it triggers the
 * Drive authorization prompt and creates the receipts folder. Without it the
 * first photo upload fails silently and the entry is saved without a receipt.
 */
function testDrive() {
  Logger.log('Folder ready: ' + getPhotoFolder_().getUrl());
}
