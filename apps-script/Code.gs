/**
 * JCREMC Operation Round-Up — private site backend
 * Paste into the tracking Sheet: Extensions → Apps Script → Code.gs
 *
 * - Every request must carry the passcode (stored in Script Properties, never in code).
 * - Set it from the Sheet menu: ORU Site → Set passcode…
 * - 10 wrong tries locks the site for 15 minutes.
 * - Reads application files from the shared Drive folders (needs Drive permission the first time).
 * - Writes allowed: CURRENT_TAB "Amount Funded", the "Notes" cell on any cycle tab, and the committee rows on BOARD_TAB.
 */

const CURRENT_TAB = '2026 October';      // ← change each cycle (e.g. '2027 April')
const BOARD_TAB = 'ORU Advisory Board';
const CYCLE_RE = /^\d{4} (April|October)$/;
const MAX_TRIES = 10;
// Application files live in shared Drive folders named like "JCREMC ORU Grant Applications Fall 2026"
// (one subfolder per organization). They're found by name; pin a tab to a folder ID here if a name doesn't match.
const DOC_FOLDERS = {
  // '2024 April': 'folderIdHere',
};
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
    if (body.action === 'board') return json_(board_(body));
    if (body.action === 'note') return json_(note_(body));
    if (body.action === 'docs') return json_(docs_(body));
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

/** List application files for one cycle: [{ name: org folder name, url, files: [{name,url,mime,size}] }] */
function docs_(b) {
  const tab = String(b.tab || '');
  const m = tab.match(CYCLE_RE);
  if (!m) throw new Error('Not a cycle tab');
  const cache = CacheService.getScriptCache(), ck = 'docs:' + tab;
  const hit = !b.fresh && cache.get(ck);
  if (hit) return JSON.parse(hit);
  const folder = DOC_FOLDERS[tab] ? DriveApp.getFolderById(DOC_FOLDERS[tab]) : findDocFolder_(tab.slice(0, 4), m[1]);
  let out;
  if (!folder) {
    out = { ok: true, tab: tab, folder: null, orgs: [] };
  } else {
    const orgs = [], loose = [];
    const subs = folder.getFolders();
    while (subs.hasNext()) {
      const f = subs.next(), files = [], it = f.getFiles();
      while (it.hasNext()) files.push(fileInfo_(it.next()));
      orgs.push({ name: f.getName(), url: f.getUrl(), files: files });
    }
    const fi = folder.getFiles();
    while (fi.hasNext()) loose.push(fileInfo_(fi.next()));
    out = { ok: true, tab: tab, folder: { name: folder.getName(), url: folder.getUrl() }, orgs: orgs, loose: loose };
  }
  const str = JSON.stringify(out);
  if (str.length < 95000) cache.put(ck, str, 600);
  return out;
}

function fileInfo_(x) {
  return { name: x.getName(), url: x.getUrl(), mime: x.getMimeType(), size: x.getSize() };
}

function findDocFolder_(year, month) {
  const season = month === 'April' ? 'Spring' : 'Fall';
  const mm = month === 'April' ? '0?4' : '10';
  const bySeason = new RegExp('\\b' + season + '\\s+' + year + '\\b', 'i');
  const byNum = new RegExp('\\b' + mm + '\\s*/\\s*' + year + '\\b');
  const it = DriveApp.searchFolders("title contains 'ORU Grant Applications' and trashed = false");
  while (it.hasNext()) {
    const f = it.next(), n = f.getName();
    if (bySeason.test(n) || byNum.test(n)) return f;
  }
  return null;
}

/** Save the Notes cell for one application row on any cycle tab. */
function note_(b) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const tab = String(b.tab || '');
    if (!CYCLE_RE.test(tab)) throw new Error('Not a cycle tab');
    const sh = SpreadsheetApp.getActive().getSheetByName(tab);
    if (!sh) throw new Error('Tab "' + tab + '" not found');
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(function (h) { return String(h).trim().toLowerCase(); });
    const cOrg = head.indexOf('organization') + 1, cNote = head.indexOf('notes') + 1;
    if (!cOrg || !cNote) throw new Error('No Notes column on this tab');
    const row = Number(b.row);
    if (!(row >= 2)) throw new Error('Bad row');
    const colA = sh.getRange(1, 1, sh.getLastRow(), 1).getDisplayValues();
    for (let i = 1; i < colA.length; i++) {
      if (/^total/i.test(String(colA[i][0]).trim())) { if (row > i) throw new Error('Not an application row'); break; }
    }
    if (String(sh.getRange(row, cOrg).getDisplayValue()).trim() !== String(b.org || '').trim()) throw new Error('The sheet changed under you — refresh and try again.');
    sh.getRange(row, cNote).setValue(String(b.note == null ? '' : b.note).slice(0, 2000));
    SpreadsheetApp.flush();
    return { ok: true, tab: tab, values: sh.getDataRange().getDisplayValues() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Edit the committee on the ORU Advisory Board tab.
 * kind: 'member' (District | Representative | Phone | Email) or 'position' (Title | Name)
 * op:   'edit' | 'add' (inserts a row after `row`) | 'remove' (deletes `row`)
 * `old` must match what's in the sheet now (name for members, title for positions) so stale edits are rejected.
 */
function board_(b) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = SpreadsheetApp.getActive().getSheetByName(BOARD_TAB);
    if (!sh) throw new Error('Tab "' + BOARD_TAB + '" not found');
    const row = Number(b.row), col = Number(b.col);
    if (!(row >= 1) || !(col >= 1)) throw new Error('Bad row');
    const width = b.kind === 'member' ? 4 : b.kind === 'position' ? 2 : 0;
    if (!width) throw new Error('Bad kind');
    // members: check the name cell (col+1); positions: check the title cell (col)
    const checkCol = b.kind === 'member' ? col + 1 : col;
    const now = String(sh.getRange(row, checkCol).getDisplayValue()).trim();
    if (now !== String(b.old || '').trim()) throw new Error('The sheet changed under you — refresh and try again.');
    // the anchor row must be inside the right block
    const label = String(sh.getRange(row, col).getDisplayValue()).trim();
    if (!label || label === 'District' || label === 'Positions') throw new Error('Not a committee row');

    if (b.op === 'remove') {
      sh.deleteRow(row);
    } else {
      const vals = (b.values || []).slice(0, width).map(function (v) { return String(v == null ? '' : v).trim().slice(0, 200); });
      while (vals.length < width) vals.push('');
      if (!vals[0]) throw new Error('First field is required');
      let target = row;
      if (b.op === 'add') { sh.insertRowAfter(row); target = row + 1; }
      else if (b.op !== 'edit') throw new Error('Bad op');
      // keep things like "1" or phone numbers as plain text
      sh.getRange(target, col, 1, width).setNumberFormat('@').setValues([vals]);
    }
    SpreadsheetApp.flush();
    return { ok: true, values: sh.getDataRange().getDisplayValues() };
  } finally {
    lock.releaseLock();
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
