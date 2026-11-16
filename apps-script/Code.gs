/**
 * JCREMC Operation Round-Up — private site backend
 * Paste into the tracking Sheet: Extensions → Apps Script → Code.gs
 *
 * - Every request must carry the passcode (stored in Script Properties, never in code).
 * - Set it from the Sheet menu: ORU Site → Set passcode…
 * - 10 wrong tries locks the site for 15 minutes.
 * - Only CURRENT_TAB can be written to, and only its "Amount Funded" / "Notes" cells.
 */

const CURRENT_TAB = '2026 October';      // ← change each cycle (e.g. '2027 April')
const BOARD_TAB = 'ORU Advisory Board';
const CYCLE_RE = /^\d{4} (April|October)$/;
const MAX_TRIES = 10;
const LOCK_MINUTES = 15;

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ORU Site')
    .addItem('Set passcode…', 'promptPasscode')
    .addToUi();
}

function promptPasscode() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('ORU site passcode', 'Enter the passcode for the private site:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const p = r.getResponseText().trim();
  if (p.length < 4) { ui.alert('Use at least 4 characters.'); return; }
  PropertiesService.getScriptProperties().setProperty('PASSCODE', p);
  CacheService.getScriptCache().removeAll(['fails', 'lock']);
  ui.alert('Passcode saved.');
}

function doGet() {
  return json_({ ok: true, service: 'jcremc-oru' });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Bad request' }); }

  const gate = checkPasscode_(body.passcode);
  if (gate) return json_(gate);

  try {
    if (body.action === 'data') return json_({ ok: true, data: readAll_() });
    if (body.action === 'decide') return json_(decide_(body));
    return json_({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function checkPasscode_(given) {
  const real = PropertiesService.getScriptProperties().getProperty('PASSCODE');
  if (!real) return { ok: false, error: 'Passcode not set yet. In the Sheet: ORU Site → Set passcode…' };
  const cache = CacheService.getScriptCache();
  if (cache.get('lock')) return { ok: false, locked: true, error: 'Too many wrong tries. Try again in ' + LOCK_MINUTES + ' minutes.' };
  if (String(given || '') !== real) {
    const n = Number(cache.get('fails') || 0) + 1;
    cache.put('fails', String(n), LOCK_MINUTES * 60);
    if (n >= MAX_TRIES) { cache.put('lock', '1', LOCK_MINUTES * 60); cache.remove('fails'); }
    return { ok: false, auth: false, error: 'Wrong passcode' };
  }
  cache.remove('fails');
  return null;
}

function readAll_() {
  const ss = SpreadsheetApp.getActive();
  const tabs = {};
  ss.getSheets().forEach(function (sh) {
    const name = sh.getName();
    if (name !== BOARD_TAB && !CYCLE_RE.test(name)) return;
    tabs[name] = sh.getDataRange().getDisplayValues();
  });
  return { tabs: tabs, currentTab: CURRENT_TAB, boardTab: BOARD_TAB, fetchedAt: new Date().toISOString() };
}

function decide_(b) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = SpreadsheetApp.getActive().getSheetByName(CURRENT_TAB);
    if (!sh) throw new Error('Current cycle tab "' + CURRENT_TAB + '" not found');
    const lastCol = sh.getLastColumn();
    const head = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(function (h) { return String(h).trim().toLowerCase(); });
    const cOrg = head.indexOf('organization') + 1;
    const cAmt = head.indexOf('amount funded') + 1;
    const cNote = head.indexOf('notes') + 1;
    if (!cOrg || !cAmt) throw new Error('Could not find Organization / Amount Funded columns');

    const row = Number(b.row);
    if (!(row >= 2)) throw new Error('Bad row');
    // Row must sit above the "Total Requested Funds" line.
    const colA = sh.getRange(1, 1, sh.getLastRow(), 1).getDisplayValues();
    for (let i = 1; i < colA.length; i++) {
      if (/^total/i.test(String(colA[i][0]).trim())) { if (row > i) throw new Error('Not an application row'); break; }
    }
    const org = String(sh.getRange(row, cOrg).getDisplayValue()).trim();
    if (org !== String(b.org || '').trim()) throw new Error('The sheet changed under you — refresh and try again.');

    const cell = sh.getRange(row, cAmt);
    if (b.amount === null || b.amount === '' || b.amount === undefined) {
      cell.clearContent();
    } else {
      const a = Number(b.amount);
      if (!isFinite(a) || a < 0) throw new Error('Bad amount');
      cell.setValue(Math.round(a * 100) / 100).setNumberFormat('$#,##0.00');
    }
    if (cNote && typeof b.note === 'string') sh.getRange(row, cNote).setValue(b.note);
    SpreadsheetApp.flush();
    return { ok: true, tab: CURRENT_TAB, values: sh.getDataRange().getDisplayValues() };
  } finally {
    lock.releaseLock();
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
