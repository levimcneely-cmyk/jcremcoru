/* JCREMC Operation Round-Up — private advisory board site */
(function () {
  'use strict';

  var CFG = window.ORU_CONFIG || {};
  var CYCLE_RE = /^(\d{4}) (April|October)$/;
  var PASS_KEY = 'oru.pass';

  // ---------- helpers ----------
  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n, cents) {
    if (n == null || isNaN(n)) return '—';
    var c = cents || (Math.round(n * 100) % 100 !== 0);
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: c ? 2 : 0, maximumFractionDigits: 2 });
  }
  function fmtK(n) { return n >= 1000 ? '$' + (Math.round(n / 100) / 10).toString().replace(/\.0$/, '') + 'k' : '$' + Math.round(n); }
  function isMoney(s) { return /^-?\$[\d,]+(\.\d+)?$/.test(String(s || '').trim()); }
  function money(s) {
    var t = String(s == null ? '' : s).trim();
    if (!/^-?\$?[\d,]*\.?\d+$/.test(t)) return null;
    var n = Number(t.replace(/[$,]/g, ''));
    return isFinite(n) ? n : null;
  }
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  // ---------- state ----------
  var S = { pass: store.get(PASS_KEY), data: null, cycles: [], byName: {}, board: null, current: null, groups: [], groupByKey: {}, q: '', sort: null, filter: 'all', cq: '' };
  var memPass = null; // used when "remember" is off

  // ---------- API ----------
  function api(action, extra) {
    var body = Object.assign({ action: action, passcode: S.pass || memPass }, extra || {});
    return fetch(CFG.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.ok && (res.auth === false || res.locked)) { lock(res.error); throw new Error(res.error); }
        if (!res.ok) throw new Error(res.error || 'Request failed');
        return res;
      });
  }

  // ---------- parsing ----------
  function canon(name) {
    var s = ' ' + String(name || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ') + ' ';
    var rules = [
      [/ johnson (county|co) /g, ' jc '], [/ fire (department|dept) /g, ' fd '], [/ volunteer fire (department|dept|fd) /g, ' vfd '],
      [/ volunteer fd /g, ' vfd '], [/ education(al)? foundation /g, ' ef '], [/ department /g, ' dept '],
      [/ senior high( school)? /g, ' high school '], [/ sr high( school)? /g, ' high school '],
      [/ (the|inc|incorporated|corp|corporation) /g, ' '], [/ big brothers (and )?big sisters /g, ' bbbs '], [/ humanrity /g, ' humanity ']
    ];
    for (var k = 0; k < 2; k++) rules.forEach(function (r) { s = s.replace(r[0], r[1]); });
    return s.replace(/\s+/g, ' ').trim();
  }

  function parseCycle(name, values) {
    var m = name.match(CYCLE_RE);
    var head = (values[0] || []).map(function (h) { return String(h).trim(); });
    var low = head.map(function (h) { return h.toLowerCase(); });
    function col() { for (var i = 0; i < arguments.length; i++) { var j = low.indexOf(arguments[i]); if (j >= 0) return j; } return -1; }
    var C = { org: col('organization'), proj: col('project name', 'project'), ref: col('reference', 'lead'), req: col('funds requested'), cost: col('total project cost'), fund: col('amount funded'), notes: col('notes') };

    var items = [], totalIdx = -1, maxCol = head.length - 1;
    for (var i = 1; i < values.length; i++) {
      var r = values[i] || [];
      var a = String(r[0] || '').trim();
      if (/^total/i.test(a)) { totalIdx = i; break; }
      if (!r.some(function (c) { return String(c).trim(); })) continue;
      for (var c = r.length - 1; c > maxCol; c--) if (String(r[c]).trim()) { maxCol = c; break; }
      var funded = money(r[C.fund]);
      var extra = [];
      for (var x = 0; x < r.length; x++) {
        if (x === C.org || x === C.proj || x === C.ref || x === C.req || x === C.cost || x === C.fund) continue;
        var v = String(r[x] || '').trim();
        if (v && (x === C.notes || x >= head.length || !head[x])) extra.push(v);
      }
      items.push({
        row: i + 1, cells: r,
        orgRaw: String(r[C.org] || ''), org: String(r[C.org] || '').trim(),
        project: String(r[C.proj] || '').trim(), ref: String(r[C.ref] || '').trim(),
        requested: money(r[C.req]) || 0, cost: money(r[C.cost]), costRaw: String(r[C.cost] || '').trim(),
        funded: funded, notes: extra.join(' · ')
      });
    }
    var footer = [];
    if (totalIdx > 0) {
      for (var f = totalIdx + 1; f < values.length; f++) {
        var fr = values[f] || [], label = '', li = -1, val = null, rest = [];
        for (var q = 0; q < fr.length; q++) {
          var cv = String(fr[q] || '').trim(); if (!cv) continue;
          if (li < 0 && !isMoney(cv)) { label = cv; li = q; }
          else if (li >= 0 && val === null && isMoney(cv)) val = money(cv);
          else if (li >= 0) rest.push(cv);
        }
        if (label) footer.push({ label: label, value: val, note: rest.join(' ') });
      }
    }
    var cyc = {
      name: name, year: +m[1], month: m[2], season: m[2] === 'April' ? 'Spring' : 'Fall',
      label: (m[2] === 'April' ? 'Spring ' : 'Fall ') + m[1], short: (m[2] === 'April' ? 'Apr ' : 'Oct ') + String(m[1]).slice(2),
      sortKey: +m[1] * 100 + (m[2] === 'April' ? 4 : 10),
      head: head, C: C, maxCol: Math.max(maxCol, head.length - 1), items: items, footer: footer
    };
    var b = footer.filter(function (x) { return /budget/i.test(x.label); })[0];
    cyc.budget = b ? b.value : null;
    recalc(cyc);
    return cyc;
  }

  function recalc(cyc) {
    var req = 0, fund = 0, nF = 0, nP = 0;
    cyc.items.forEach(function (it) {
      req += it.requested || 0;
      if (it.funded > 0) { fund += it.funded; nF++; }
      if (it.funded == null) nP++;
    });
    cyc.requestedSum = req; cyc.fundedSum = Math.round(fund * 100) / 100; cyc.nFunded = nF; cyc.nPending = nP;
    cyc.left = cyc.budget != null ? Math.round((cyc.budget - cyc.fundedSum) * 100) / 100 : null;
  }

  // "Skip" = come back to it at the board discussion. Nothing is written to the Sheet
  // (Amount Funded stays blank); the skip list lives on this device.
  function skipKey(cyc) { return 'oru.skip.' + cyc.name; }
  function itemKey(it) { return it.row + '|' + it.org; }
  function getSkips(cyc) { try { return JSON.parse(store.get(skipKey(cyc)) || '[]'); } catch (e) { return []; } }
  function setSkips(cyc, arr) { store.set(skipKey(cyc), JSON.stringify(arr)); }
  function isSkipped(it, cyc) { return getSkips(cyc).indexOf(itemKey(it)) >= 0; }
  function addSkip(it, cyc) { var a = getSkips(cyc).filter(function (k) { return k !== itemKey(it); }); a.push(itemKey(it)); setSkips(cyc, a); }
  function removeSkip(it, cyc) { setSkips(cyc, getSkips(cyc).filter(function (k) { return k !== itemKey(it); })); }

  function status(it, cyc) {
    if (it.funded == null) return cyc === S.current ? (isSkipped(it, cyc) ? 'discuss' : 'pending') : 'none';
    if (it.funded <= 0) return 'declined';
    if (it.requested && it.funded < it.requested - 0.005) return 'partial';
    return 'full';
  }
  var STATUS_TXT = { discuss: 'Discuss', pending: 'Pending', none: '—', declined: 'Not funded', partial: 'Partial', full: 'Funded' };
  function chip(st) { return '<span class="chip ' + st + '">' + STATUS_TXT[st] + '</span>'; }

  function parseBoard(values) {
    var out = { members: [], positions: [], quote: '' };
    if (!values) return out;
    var hr = -1, hc = -1;
    values.forEach(function (r, i) { if (hr < 0) { var j = r.map(function (c) { return String(c).trim(); }).indexOf('District'); if (j >= 0) { hr = i; hc = j; } } });
    if (hr >= 0) {
      for (var i = hr + 1; i < values.length; i++) {
        var r = values[i] || [];
        if (!String(r[hc] || '').trim()) break;
        out.members.push({ district: String(r[hc]).trim(), name: String(r[hc + 1] || '').trim(), phone: String(r[hc + 2] || '').trim(), email: String(r[hc + 3] || '').trim() });
      }
    }
    var pr = -1;
    values.forEach(function (r, i) { if (pr < 0 && r.some(function (c) { return String(c).trim() === 'Positions'; })) pr = i; });
    if (pr >= 0) {
      for (var p = pr + 1; p < values.length; p++) {
        var cells = (values[p] || []).map(function (c) { return String(c).trim(); }).filter(Boolean);
        if (!cells.length) break;
        out.positions.push({ title: cells[0], name: cells[1] || '' });
      }
    }
    values.forEach(function (r) { r.forEach(function (c) { c = String(c).trim(); if (/^["“]/.test(c) && c.length > 30) out.quote = c.replace(/^["“]|["”]$/g, ''); }); });
    return out;
  }

  function buildGroups() {
    var map = {};
    S.cycles.forEach(function (cyc) {
      cyc.items.forEach(function (it) {
        if (!it.org) return;
        var k = canon(it.org);
        var g = map[k] || (map[k] = { key: k, names: {}, apps: [] });
        g.names[it.org] = (g.names[it.org] || 0) + 1;
        g.apps.push({ cyc: cyc, it: it });
      });
    });
    S.groups = Object.keys(map).map(function (k) {
      var g = map[k];
      g.apps.sort(function (a, b) { return b.cyc.sortKey - a.cyc.sortKey; });
      g.name = g.apps[0].it.org;
      g.alt = Object.keys(g.names).filter(function (n) { return n !== g.name; });
      g.total = 0; g.nFunded = 0; g.pending = false;
      g.apps.forEach(function (a) { if (a.it.funded > 0) { g.total += a.it.funded; g.nFunded++; } if (status(a.it, a.cyc) === 'pending') g.pending = true; });
      g.hay = (k + ' ' + Object.keys(g.names).join(' ').toLowerCase());
      return g;
    });
    S.groupByKey = map;
  }

  function ingest(data) {
    S.data = data;
    S.cycles = Object.keys(data.tabs).filter(function (n) { return CYCLE_RE.test(n); })
      .map(function (n) { return parseCycle(n, data.tabs[n]); })
      .sort(function (a, b) { return b.sortKey - a.sortKey; });
    S.byName = {}; S.cycles.forEach(function (c) { S.byName[c.name] = c; });
    S.current = S.byName[data.currentTab] || null;
    S.board = parseBoard(data.tabs[data.boardTab || 'ORU Advisory Board']);
    buildGroups();
  }

  function replaceCurrent(values) {
    if (!S.current) return;
    S.data.tabs[S.current.name] = values;
    var fresh = parseCycle(S.current.name, values);
    var i = S.cycles.indexOf(S.current);
    S.cycles[i] = fresh; S.byName[fresh.name] = fresh; S.current = fresh;
    buildGroups();
  }

  // ---------- lock / unlock ----------
  function lock(msg) {
    S.pass = null; memPass = null; store.del(PASS_KEY);
    $('#app').hidden = true; $('#lock').hidden = false;
    $('#lockMsg').textContent = msg || '';
    $('#pass').value = '';
    setTimeout(function () { $('#pass').focus(); }, 50);
  }

  function load(showSpin) {
    var btn = $('#refreshBtn');
    if (showSpin) btn.classList.add('spin');
    return api('data').then(function (res) {
      ingest(res.data);
      $('#lock').hidden = true; $('#app').hidden = false;
      route();
    }).finally(function () { btn.classList.remove('spin'); });
  }

  $('#lockForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!CFG.apiUrl) { $('#lockMsg').textContent = 'Backend not connected yet — add the Apps Script URL to config.js.'; return; }
    var p = $('#pass').value.trim(); if (!p) return;
    var btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Unlocking…';
    memPass = p; S.pass = p;
    load().then(function () {
      if ($('#remember').checked) store.set(PASS_KEY, p); else S.pass = null;
    }).catch(function (err) {
      if (!$('#lock').hidden) $('#lockMsg').textContent = err.message === 'Failed to fetch' ? 'Could not reach the Sheet. Check your connection.' : err.message;
    }).finally(function () { btn.disabled = false; btn.textContent = 'Unlock'; });
  });
  $('#lockBtn').addEventListener('click', function () { lock(''); });
  $('#refreshBtn').addEventListener('click', function () { load(true).catch(function (e) { toast(e.message, true); }); });

  // ---------- routing ----------
  function route() {
    if (!S.data) return;
    var h = (location.hash || '#/search').replace(/^#\/?/, '');
    var parts = h.split('/'); var r = parts[0] || 'search';
    $$('[data-r]').forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-r') === r); });
    var pend = S.current ? S.current.nPending : 0;
    $$('[data-pending]').forEach(function (b) { b.textContent = pend ? pend : ''; });
    hideTip();
    var v = $('#view');
    if (r === 'dashboard') renderDashboard(v);
    else if (r === 'cycles') renderCycles(v, decodeURIComponent(parts.slice(1).join('/') || ''));
    else if (r === 'decide') renderDecide(v);
    else renderSearch(v);
  }
  window.addEventListener('hashchange', function () { route(); window.scrollTo(0, 0); });

  // ---------- totals ----------
  function totals() {
    var t = { given: 0, apps: 0, grants: 0, orgsFunded: 0, orgs: S.groups.length };
    S.cycles.forEach(function (c) { t.given += c.fundedSum; t.apps += c.items.length; t.grants += c.nFunded; });
    S.groups.forEach(function (g) { if (g.nFunded) t.orgsFunded++; });
    t.given = Math.round(t.given * 100) / 100;
    return t;
  }

  // ---------- SEARCH (landing) ----------
  function renderSearch(v) {
    var t = totals(), cur = S.current;
    v.innerHTML =
      '<section class="hero">' +
        '<span class="eyebrow">Organization lookup</span>' +
        '<h1>Has this organization been funded?</h1>' +
        '<div class="search-box"><input id="q" type="search" placeholder="Start typing an organization…" autocomplete="off" value="' + esc(S.q) + '" aria-label="Search organizations"></div>' +
        '<p class="hint">Searches every cycle since Fall 2019 · ' + plural(S.groups.length, 'organization') + ' · ' + plural(t.apps, 'application') + '</p>' +
      '</section>' +
      '<div id="results"></div>';
    var input = $('#q');
    input.addEventListener('input', function () { S.q = input.value; drawResults(); });
    if (window.matchMedia('(min-width: 761px)').matches) input.focus();
    drawResults();
  }

  function searchGroups(q) {
    var toks = canon(q).split(' ').filter(Boolean);
    var raw = q.toLowerCase().trim();
    if (!toks.length && !raw) return [];
    return S.groups.map(function (g) {
      var words = g.hay.split(/\s+/);
      var all = toks.every(function (t) { return words.some(function (w) { return w.indexOf(t) === 0; }); });
      var sub = raw && g.hay.indexOf(raw) >= 0;
      if (!all && !sub) return null;
      var score = (g.key.indexOf(canon(q)) === 0 ? 3 : 0) + (sub ? 2 : 0) + (all ? 1 : 0);
      return { g: g, score: score };
    }).filter(Boolean).sort(function (a, b) {
      return b.score - a.score || b.g.apps[0].cyc.sortKey - a.g.apps[0].cyc.sortKey || a.g.name.localeCompare(b.g.name);
    }).map(function (x) { return x.g; });
  }

  function drawResults() {
    var box = $('#results'); if (!box) return;
    var q = S.q.trim();
    if (!q) { box.innerHTML = landingExtras(); return; }
    var hits = searchGroups(q);
    if (!hits.length) { box.innerHTML = '<div class="card empty">No organization matches “' + esc(q) + '”.<br><span class="small">Try one distinctive word — e.g. “habitat”, “ffa”, “fire”.</span></div>'; return; }
    box.innerHTML = '<p class="muted small" style="margin:0 0 10px">' + plural(hits.length, 'match', 'matches') + '</p><div class="results">' + hits.slice(0, 40).map(orgCard).join('') + '</div>';
  }

  function orgCard(g) {
    var cls = g.nFunded ? 'is-funded' : (g.pending ? 'is-pending' : '');
    var headline = g.nFunded ? 'Funded ' + plural(g.nFunded, 'time') : (g.pending ? 'Pending this cycle' : 'Applied, not funded');
    var meta = plural(g.apps.length, 'application') + (g.alt.length ? ' · also listed as ' + g.alt.map(esc).join(', ') : '');
    return '<article class="org ' + cls + '">' +
      '<div class="org-head"><div><h3>' + esc(g.name) + '</h3><div class="org-meta">' + meta + '</div></div>' +
      '<div class="org-total"><b class="num">' + (g.nFunded ? fmt(g.total) : '—') + '</b><span class="small muted">' + headline + '</span></div></div>' +
      '<div class="apps">' + g.apps.map(function (a) {
        var st = status(a.it, a.cyc);
        return '<div class="app"><a class="cyc" href="#/cycles/' + encodeURIComponent(a.cyc.name) + '">' + a.cyc.label + '</a>' +
          '<div class="proj"><b>' + esc(a.it.project || '—') + '</b> <span class="muted small">· asked ' + fmt(a.it.requested) + '</span></div>' +
          '<div class="amt num">' + (a.it.funded > 0 ? '<b>' + fmt(a.it.funded) + '</b> ' : '') + chip(st) + '</div>' +
          (a.it.notes ? '<div class="note">' + esc(a.it.notes) + '</div>' : '') + '</div>';
      }).join('') + '</div></article>';
  }

  function landingExtras() {
    var t = totals(), cur = S.current;
    var html = '<div class="tiles">' +
      tile('Total given to date', fmt(t.given), 'across ' + plural(S.cycles.length, 'cycle'), true) +
      tile('Organizations funded', t.orgsFunded, 'of ' + t.orgs + ' that applied') +
      tile('Grants awarded', t.grants, plural(t.apps, 'application') + ' reviewed') + '</div>';
    if (cur) {
      var decided = cur.items.length - cur.nPending;
      html += '<div class="cta"><div><span class="eyebrow">Current cycle</span><h3>' + cur.label + ' · ' + plural(cur.items.length, 'application') + '</h3>' +
        '<div class="small muted">' + decided + ' decided · ' + fmt(cur.fundedSum) + ' awarded' + (cur.budget != null ? ' of ' + fmt(cur.budget) + ' budget' : '') + '</div></div>' +
        '<a class="btn btn-green" href="#/decide">' + (cur.nPending ? 'Decide ' + cur.nPending + ' left →' : 'Review decisions →') + '</a></div>';
    }
    return html;
  }

  function tile(label, value, sub, hero) {
    return '<div class="tile' + (hero ? ' hero-tile' : '') + '"><div class="label">' + label + '</div><div class="value num">' + value + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';
  }

  // ---------- DASHBOARD ----------
  function renderDashboard(v) {
    var t = totals();
    var chron = S.cycles.slice().reverse();
    var avg = t.grants ? t.given / t.grants : 0;
    var rate = t.apps ? Math.round(t.grants / t.apps * 100) : 0;
    var html =
      '<section class="section"><div class="section-head"><h2>Totals funded</h2><span class="muted small">Since Fall 2019</span></div>' +
      '<div class="tiles">' +
        tile('Total given to date', fmt(t.given), 'across ' + plural(S.cycles.length, 'cycle'), true) +
        tile('Grants awarded', t.grants, rate + '% of ' + t.apps + ' applications') +
        tile('Organizations funded', t.orgsFunded, 'of ' + t.orgs + ' that applied') +
        tile('Average grant', fmt(Math.round(avg)), 'per funded application') +
      '</div></section>' +

      '<section class="section card"><div class="section-head"><h3>Requested vs. funded by cycle</h3>' +
        '<div class="legend"><span><i style="background:var(--gray-l)"></i>Requested</span><span><i style="background:var(--green)"></i>Funded</span></div></div>' +
        chartHtml(chron) + '</section>' +

      '<section class="section"><div class="section-head"><h2>Committee</h2><span class="muted small">From the ORU Advisory Board tab</span></div>' +
      '<div class="two">' + boardHtml() + '</div></section>' +

      '<section class="section card"><div class="section-head"><h3>Top recipients</h3><span class="muted small">Total funded, all cycles</span></div>' + topHtml() + '</section>';
    v.innerHTML = html;
    wireChart(v);
  }

  function niceMax(n) {
    var p = Math.pow(10, Math.floor(Math.log10(n || 1))), f = n / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }

  function chartHtml(cycles) {
    var max = niceMax(Math.max.apply(null, cycles.map(function (c) { return Math.max(c.requestedSum, c.fundedSum); }).concat([1])));
    var ticks = [0, .25, .5, .75, 1];
    var grid = '<div class="grid">' + ticks.map(function (f) {
      return '<div class="gl' + (f === 0 ? ' base' : '') + '" style="bottom:' + (f * 100) + '%"><span>' + fmtK(max * f) + '</span></div>';
    }).join('') + '</div>';
    var cols = '<div class="cols">' + cycles.map(function (c, i) {
      return '<div class="col' + (c === S.current ? ' current' : '') + '" data-i="' + i + '" tabindex="0">' +
        '<div class="bar req" style="height:' + (c.requestedSum / max * 100) + '%"></div>' +
        '<div class="bar fund" style="height:' + (c.fundedSum / max * 100) + '%"></div>' +
        '<div class="xl">' + c.short.replace(' ', '<br>') + '</div></div>';
    }).join('') + '</div>';
    S._chart = cycles;
    return '<div class="chart" role="img" aria-label="Requested versus funded dollars per cycle">' + grid + cols + '</div>' +
      '<p class="small muted" style="margin:10px 0 0">Tap a cycle for details · ' + (S.current ? S.current.label + ' (striped) is in progress' : '') + '</p>';
  }

  function wireChart(v) {
    $$('.chart .col', v).forEach(function (col) {
      var c = S._chart[+col.getAttribute('data-i')];
      var html = '<b>' + c.label + '</b><br>Requested ' + fmt(c.requestedSum) + '<br>Funded ' + fmt(c.fundedSum) +
        '<br>' + c.nFunded + ' of ' + c.items.length + ' funded' + (c.budget != null ? '<br>Budget ' + fmt(c.budget) : '');
      function show(e) { showTip(html, col); }
      col.addEventListener('mouseenter', show);
      col.addEventListener('focus', show);
      col.addEventListener('mouseleave', hideTip);
      col.addEventListener('blur', hideTip);
      col.addEventListener('click', function () {
        if (window.matchMedia('(hover: hover)').matches) location.hash = '#/cycles/' + encodeURIComponent(c.name); else show();
      });
    });
  }

  function showTip(html, el) {
    var tip = $('#tip'); tip.innerHTML = html; tip.hidden = false;
    var r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    var x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    var y = r.top - h - 8; if (y < 70) y = r.top + 40;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  function hideTip() { var t = $('#tip'); if (t) t.hidden = true; }
  window.addEventListener('scroll', hideTip, { passive: true });

  function firstName(n) { return String(n || '').trim().split(/\s+/)[0].toLowerCase(); }

  function boardHtml() {
    var b = S.board, cur = S.current;
    function load(name) {
      if (!cur || !name || /^open$/i.test(name)) return '';
      var full = name.toLowerCase(), fn = firstName(name);
      var n = cur.items.filter(function (it) { var r = it.ref.toLowerCase(); return r === full || r === fn || r.split(/\s+/)[0] === fn; }).length;
      return n ? plural(n, 'app') + '<br>' + cur.short : '';
    }
    var members = b.members.map(function (m) {
      var open = /^open$/i.test(m.name) || !m.name;
      var d = /^\d+$/.test(m.district) ? 'Dist ' + m.district : m.district;
      return '<div class="member' + (open ? ' open' : '') + '"><div class="d">' + esc(d) + '</div>' +
        '<div class="who">' + (open ? 'Open seat' : '<b>' + esc(m.name) + '</b><div class="contact">' +
          (m.phone ? '<a href="tel:' + esc(m.phone.replace(/[^\d+]/g, '')) + '">' + esc(m.phone) + '</a>' : '') +
          (m.phone && m.email ? ' · ' : '') + (m.email ? '<a href="mailto:' + esc(m.email) + '">' + esc(m.email) + '</a>' : '') + '</div>') +
        '</div><div class="load">' + load(m.name) + '</div></div>';
    }).join('');
    var seats = b.members.length, filled = b.members.filter(function (m) { return m.name && !/^open$/i.test(m.name); }).length;
    var pos = b.positions.map(function (p) {
      var vac = !p.name || /^vacant$/i.test(p.name);
      return '<div class="pos"><span>' + esc(p.title) + '</span>' + (vac ? '<span class="vacant">Vacant</span>' : '<b>' + esc(p.name) + '</b>') + '</div>';
    }).join('');
    return '<div class="card"><div class="section-head" style="margin-bottom:4px"><h3>Representatives</h3><span class="small muted">' + filled + ' of ' + seats + ' seats filled</span></div>' +
      '<div class="board">' + (members || '<p class="muted">No members found.</p>') + '</div></div>' +
      '<div class="card"><h3 style="margin-bottom:6px">Officers</h3><div class="positions">' + (pos || '<p class="muted">—</p>') + '</div>' +
      (b.quote ? '<blockquote>“' + esc(b.quote) + '”</blockquote>' : '') + '</div>';
  }

  function topHtml() {
    var top = S.groups.filter(function (g) { return g.total > 0; }).sort(function (a, b) { return b.total - a.total; }).slice(0, 10);
    if (!top.length) return '<p class="muted">No grants yet.</p>';
    var max = top[0].total;
    return '<div class="hbars">' + top.map(function (g) {
      return '<div class="hbar"><a class="name" href="#/search" data-q="' + esc(g.name) + '" title="' + esc(g.name) + '">' + esc(g.name) + '</a>' +
        '<div class="track"><div class="fill" style="width:' + (g.total / max * 100) + '%"></div></div><div class="v">' + fmt(g.total) + '</div></div>';
    }).join('') + '</div>';
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-q]');
    if (a) { S.q = a.getAttribute('data-q'); }
  });

  // ---------- CYCLES ----------
  function renderCycles(v, name) {
    var cyc = S.byName[name] || S.current || S.cycles[0];
    if (!cyc) { v.innerHTML = '<div class="card empty">No cycle tabs found.</div>'; return; }
    if (S._cycName !== cyc.name) { S._cycName = cyc.name; S.sort = null; S.cq = ''; S.filter = 'all'; }
    var pick = '<div class="cycle-pick">' + S.cycles.map(function (c) {
      return '<a href="#/cycles/' + encodeURIComponent(c.name) + '" class="' + (c === cyc ? 'on ' : '') + (c === S.current ? 'cur' : '') + '">' + c.label + '</a>';
    }).join('') + '</div>';
    var isCur = cyc === S.current;
    var tiles = '<div class="tiles">' +
      tile('Requested', fmt(cyc.requestedSum), plural(cyc.items.length, 'application')) +
      tile('Funded', fmt(cyc.fundedSum), cyc.nFunded + ' of ' + cyc.items.length + ' funded' + (isCur && cyc.nPending ? ' · ' + cyc.nPending + ' pending' : ''), true) +
      (cyc.budget != null ? tile('Budget', fmt(cyc.budget), cyc.left != null ? (cyc.left < 0 ? 'Over by ' + fmt(-cyc.left) : fmt(cyc.left) + ' left') : '') : '') +
      '</div>';
    v.innerHTML = pick +
      '<div class="section-head"><h2>' + cyc.label + ' <span class="muted small" style="font-weight:400">· “' + esc(cyc.name) + '” tab</span></h2>' +
      (isCur ? '<a class="btn btn-green btn-sm" href="#/decide">Open decision deck →</a>' : '') + '</div>' +
      tiles +
      '<div class="tools"><input type="search" id="cq" placeholder="Filter this cycle…" value="' + esc(S.cq) + '">' +
      '<div class="seg" id="seg">' + [['all', 'All'], ['funded', 'Funded'], ['not', 'Not funded']].concat(isCur ? [['pending', 'Pending']] : []).map(function (s) {
        return '<button data-f="' + s[0] + '" class="' + (S.filter === s[0] ? 'on' : '') + '">' + s[1] + '</button>';
      }).join('') + '</div></div>' +
      '<div class="table-wrap" id="tw"></div>';
    $('#cq').addEventListener('input', function (e) { S.cq = e.target.value; drawTable(cyc); });
    $$('#seg button').forEach(function (b) { b.addEventListener('click', function () { S.filter = b.getAttribute('data-f'); $$('#seg button').forEach(function (x) { x.classList.toggle('on', x === b); }); drawTable(cyc); }); });
    drawTable(cyc);
  }

  function drawTable(cyc) {
    var C = cyc.C, cols = [];
    for (var i = 0; i <= cyc.maxCol; i++) cols.push(i);
    var moneyCols = [C.req, C.cost, C.fund];
    var headLabel = function (i) { return cyc.head[i] || (i > C.notes ? 'More notes' : ''); };
    var rows = cyc.items.filter(function (it) {
      var st = status(it, cyc);
      if (S.filter === 'funded' && !(it.funded > 0)) return false;
      if (S.filter === 'not' && st !== 'declined') return false;
      if (S.filter === 'pending' && st !== 'pending' && st !== 'discuss') return false;
      if (S.cq) { var q = S.cq.toLowerCase(); if ((it.cells.join(' ').toLowerCase()).indexOf(q) < 0) return false; }
      return true;
    });
    if (S.sort) {
      var sc = S.sort.col, dir = S.sort.dir;
      rows = rows.slice().sort(function (a, b) {
        var x = a.cells[sc] || '', y = b.cells[sc] || '';
        if (moneyCols.indexOf(sc) >= 0) { x = money(x); y = money(y); x = x == null ? -1 : x; y = y == null ? -1 : y; return (x - y) * dir; }
        return String(x).localeCompare(String(y)) * dir;
      });
    }
    var th = cols.map(function (i) {
      var arrow = S.sort && S.sort.col === i ? (S.sort.dir > 0 ? ' ▲' : ' ▼') : '';
      return '<th data-c="' + i + '" class="' + (moneyCols.indexOf(i) >= 0 ? 'r' : '') + '">' + esc(headLabel(i)) + '<span class="arr">' + arrow + '</span></th>';
    }).join('');
    var body = rows.map(function (it) {
      var st = status(it, cyc);
      return '<tr class="' + st + '">' + cols.map(function (i) {
        var v = String(it.cells[i] == null ? '' : it.cells[i]).trim();
        if (i === C.fund) return '<td class="r num">' + (v ? esc(v) : (st === 'pending' || st === 'discuss' ? chip(st) : '')) + '</td>';
        if (moneyCols.indexOf(i) >= 0) return '<td class="r num">' + esc(v) + '</td>';
        if (i === C.notes || i > C.notes) return '<td class="note">' + esc(v) + '</td>';
        return '<td>' + esc(v) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    if (!rows.length) body = '<tr><td colspan="' + cols.length + '" class="muted" style="text-align:center;padding:24px">Nothing matches.</td></tr>';
    var foot = '<tr>' + cols.map(function (i) {
      if (i === 0) return '<td>Total Requested Funds</td>';
      if (i === C.req) return '<td class="r num">' + fmt(cyc.requestedSum, true) + '</td>';
      if (i === C.fund) return '<td class="r num">' + fmt(cyc.fundedSum, true) + '</td>';
      return '<td></td>';
    }).join('') + '</tr>';
    var labelCol = Math.max(0, C.fund - 1);
    cyc.footer.forEach(function (f) {
      var val = f.value;
      if (cyc === S.current && /left to fund/i.test(f.label) && cyc.left != null) val = cyc.left;
      if (cyc === S.current && /given to date|to date/i.test(f.label)) val = totals().given;
      foot += '<tr>' + cols.map(function (i) {
        if (i === labelCol) return '<td class="r">' + esc(f.label) + '</td>';
        if (i === C.fund) return '<td class="r num">' + (val != null ? fmt(val, true) : '') + '</td>';
        if (i === C.fund + 1 && f.note) return '<td class="note">' + esc(f.note) + '</td>';
        if (i === 0) return '<td></td>';
        return '<td></td>';
      }).join('') + '</tr>';
    });
    $('#tw').innerHTML = '<table class="sheet-t"><thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody><tfoot>' + foot + '</tfoot></table>';
    $$('#tw th').forEach(function (h) {
      h.addEventListener('click', function () {
        var c = +h.getAttribute('data-c');
        if (S.sort && S.sort.col === c) S.sort = S.sort.dir > 0 ? { col: c, dir: -1 } : null;
        else S.sort = { col: c, dir: moneyCols.indexOf(c) >= 0 ? -1 : 1 };
        drawTable(cyc);
      });
    });
  }

  // ---------- DECIDE (current cycle) ----------
  function renderDecide(v) {
    var cyc = S.current;
    if (!cyc) { v.innerHTML = '<div class="card empty">No current cycle is set. Update CURRENT_TAB in the Apps Script.</div>'; return; }
    var pending = cyc.items.filter(function (it) { return it.funded == null; });
    var decided = cyc.items.filter(function (it) { return it.funded != null; });
    var keys = getSkips(cyc);
    var fresh = pending.filter(function (it) { return keys.indexOf(itemKey(it)) < 0; });
    var skipped = keys.map(function (k) { return pending.filter(function (it) { return itemKey(it) === k; })[0]; }).filter(Boolean);
    var it = null;
    if (S.focusRow) { it = pending.filter(function (x) { return x.row === S.focusRow; })[0] || null; S.focusRow = null; }
    it = it || fresh[0] || skipped[0];
    var discussing = it && isSkipped(it, cyc);
    var html = '<div class="section-head"><h2>' + cyc.label + ' decisions</h2><span class="sync" id="sync"></span></div>' + budgetHtml(cyc);
    if (it) {
      html += '<div class="deck-count"><span>' + (discussing ? '<b style="color:var(--warn)">Board discussion</b> · ' + plural(skipped.length, 'skipped app') : decided.length + ' decided') + '</span><span>' +
        (discussing ? '' : fresh.length + ' to review' + (skipped.length ? ' · ' + skipped.length + ' to discuss' : '')) + '</span></div>' + cardHtml(it, cyc, discussing);
    } else {
      html += '<div class="card done"><div class="big">✓</div><h3>All ' + cyc.items.length + ' applications decided</h3>' +
        '<p class="muted">' + cyc.nFunded + ' funded · ' + fmt(cyc.fundedSum) + ' awarded' + (cyc.left != null ? ' · ' + (cyc.left < 0 ? fmt(-cyc.left) + ' over budget' : fmt(cyc.left) + ' left') : '') + '</p>' +
        '<a class="btn btn-outline" href="#/cycles/' + encodeURIComponent(cyc.name) + '">See the full sheet</a></div>';
    }
    if (skipped.length) {
      html += '<section class="decided"><div class="section-head"><h3>Discuss at board meeting (' + skipped.length + ')</h3><span class="small muted">Left blank in the Sheet</span></div><div class="card" style="padding:4px 4px">' +
        skipped.map(function (d) {
          return '<div class="drow"><div class="o"><b>' + esc(d.org) + '</b><div>' + esc(d.project) + ' · ' + esc(d.ref) + '</div></div>' +
            '<div class="num" style="text-align:right"><b>' + fmt(d.requested) + '</b><br>' + chip('discuss') + '</div>' +
            '<button class="btn btn-ghost btn-sm" data-open="' + d.row + '">Open</button></div>';
        }).join('') + '</div></section>';
    }
    if (decided.length) {
      html += '<section class="decided"><div class="section-head"><h3>Decided (' + decided.length + ')</h3><span class="small muted">Tap Change to send one back to the deck</span></div><div class="card" style="padding:4px 4px">' +
        decided.slice().reverse().map(function (d) {
          var st = status(d, cyc);
          return '<div class="drow"><div class="o"><b>' + esc(d.org) + '</b><div>' + esc(d.project) + ' · asked ' + fmt(d.requested) + '</div></div>' +
            '<div class="num" style="text-align:right">' + (d.funded > 0 ? '<b>' + fmt(d.funded) + '</b><br>' : '') + chip(st) + '</div>' +
            '<button class="btn btn-ghost btn-sm" data-undo="' + d.row + '">Change</button></div>';
        }).join('') + '</div></section>';
    }
    v.innerHTML = html;
    setSync();
    if (it) {
      $('#bFund').addEventListener('click', function () { decide(it, it.requested); });
      $('#bPart').addEventListener('click', function () { openPartial(it); });
      $('#bSkip').addEventListener('click', function () {
        addSkip(it, cyc);
        var row = it.row, org = it.org;
        route(); window.scrollTo(0, 0);
        toast('Saved for board discussion · ' + org, false, function () {
          var x = S.current.items.filter(function (y) { return y.row === row; })[0];
          if (x) { removeSkip(x, S.current); S.focusRow = row; route(); }
        });
      });
      var dec = $('#bDecline');
      if (dec) dec.addEventListener('click', function () { decide(it, 0); });
    }
    $$('[data-open]', v).forEach(function (b) {
      b.addEventListener('click', function () { S.focusRow = +b.getAttribute('data-open'); route(); window.scrollTo(0, 0); });
    });
    $$('[data-undo]', v).forEach(function (b) {
      b.addEventListener('click', function () {
        var d = cyc.items.filter(function (x) { return x.row === +b.getAttribute('data-undo'); })[0];
        if (d) decide(d, null, undefined, true);
      });
    });
  }

  function budgetHtml(cyc) {
    var b = cyc.budget, over = b != null && cyc.left < 0;
    var pct = b ? Math.min(100, cyc.fundedSum / b * 100) : 0;
    return '<div class="budget"><div class="budget-row">' +
      '<div><div class="label">Budget</div><div class="value num">' + (b != null ? fmt(b) : '—') + '</div></div>' +
      '<div><div class="label">Awarded</div><div class="value num">' + fmt(cyc.fundedSum) + '</div></div>' +
      '<div><div class="label">' + (over ? 'Over by' : 'Left') + '</div><div class="value num' + (over ? ' over' : '') + '">' + (b != null ? fmt(Math.abs(cyc.left)) : '—') + '</div></div>' +
      '</div><div class="meter' + (over ? ' over' : '') + '"><div style="width:' + (over ? 100 : pct) + '%"></div></div></div>';
  }

  function cardHtml(it, cyc, discussing) {
    var share = it.cost ? Math.round(it.requested / it.cost * 100) : null;
    var g = S.groupByKey[canon(it.org)];
    var past = g ? g.apps.filter(function (a) { return a.cyc !== cyc; }) : [];
    var hist;
    if (!past.length) hist = '<div class="h">First-time applicant</div>';
    else {
      var nf = past.filter(function (a) { return a.it.funded > 0; });
      var tot = nf.reduce(function (s, a) { return s + a.it.funded; }, 0);
      hist = '<div class="h">' + (nf.length ? 'Funded ' + plural(nf.length, 'time') + ' before · ' + fmt(tot) : 'Applied ' + plural(past.length, 'time') + ' before, never funded') + '</div>' +
        '<div class="chips">' + past.slice(0, 6).map(function (a) {
          return '<span class="' + (a.it.funded > 0 ? 'f' : '') + '">' + a.cyc.short + ' · ' + (a.it.funded > 0 ? fmt(a.it.funded) : (a.it.funded === 0 ? 'not funded' : '—')) + '</span>';
        }).join('') + (past.length > 6 ? '<span>+' + (past.length - 6) + ' more</span>' : '') + '</div>';
    }
    var overNote = cyc.left != null && it.requested > cyc.left ? '<small>exceeds ' + fmt(Math.max(0, cyc.left)) + ' left</small>' : '';
    return '<article class="dcard">' +
      '<div class="dcard-top' + (discussing ? ' discuss' : '') + '"><h2>' + esc(it.org) + '</h2><div class="proj">' + esc(it.project) + '</div>' +
      (it.ref ? '<div class="ref">Reference: ' + esc(it.ref) + '</div>' : '') + '</div>' +
      '<div class="dfacts"><div><div class="label">Requested</div><div class="value num">' + fmt(it.requested) + '</div></div>' +
      '<div><div class="label">Project cost</div><div class="value num">' + (it.cost != null ? fmt(it.cost) : esc(it.costRaw || '—')) + '</div>' +
      (share != null ? '<div class="small muted">' + (share > 100 ? 'asks more than total cost' : share + '% of project') + '</div>' : '') + '</div></div>' +
      (it.notes ? '<div class="dhist"><div class="h">Notes</div>' + esc(it.notes) + '</div>' : '') +
      '<div class="dhist">' + hist + '</div>' +
      '<div class="dactions">' +
        '<button class="btn btn-fund" id="bFund">Fund ' + fmt(it.requested) + overNote + '</button>' +
        '<button class="btn btn-outline" id="bPart">Partially fund</button>' +
        '<button class="btn btn-ghost" id="bSkip">' + (discussing ? 'Skip again<small>keep for discussion</small>' : 'Skip<small>discuss at board meeting</small>') + '</button>' +
        '<button class="btn-link" id="bDecline" type="button">Not funding this one ($0)</button>' +
      '</div></article>';
  }

  function openPartial(it) {
    var sh = $('#sheet');
    var half = Math.round(it.requested / 2);
    var quick = [1000, 2500, half].filter(function (x, i, arr) { return x > 0 && x < it.requested && arr.indexOf(x) === i; }).sort(function (a, b) { return a - b; });
    sh.innerHTML = '<form class="sheet-panel" id="pform"><h3>Partially fund</h3><div class="muted small">' + esc(it.org) + ' · asked ' + fmt(it.requested) +
      (S.current.left != null ? ' · ' + fmt(Math.max(0, S.current.left)) + ' left in budget' : '') + '</div>' +
      '<div class="money-in"><span>$</span><input id="pamt" inputmode="decimal" placeholder="0" autocomplete="off" aria-label="Amount to fund"></div>' +
      '<div class="quick">' + quick.map(function (q) { return '<button type="button" data-v="' + q + '">' + fmt(q) + '</button>'; }).join('') + '</div>' +
      '<textarea id="pnote" placeholder="What it covers (optional — saved to Notes)">' + esc(it.notes && it.notes.indexOf(' · ') < 0 ? it.notes : '') + '</textarea>' +
      '<p class="err-msg" id="perr"></p>' +
      '<div class="sheet-actions"><button type="button" class="btn btn-ghost" id="pcancel">Cancel</button><button class="btn btn-blue" type="submit">Save</button></div></form>';
    sh.hidden = false; $('#toast').hidden = true;
    var inp = $('#pamt');
    setTimeout(function () { inp.focus(); }, 60);
    $$('.quick button', sh).forEach(function (b) { b.addEventListener('click', function () { inp.value = b.getAttribute('data-v'); inp.focus(); }); });
    function close() { sh.hidden = true; sh.innerHTML = ''; }
    $('#pcancel').addEventListener('click', close);
    sh.addEventListener('click', function (e) { if (e.target === sh) close(); }, { once: true });
    $('#pform').addEventListener('submit', function (e) {
      e.preventDefault();
      var a = Number(String(inp.value).replace(/[$,\s]/g, ''));
      if (!isFinite(a) || a <= 0) { $('#perr').textContent = 'Enter an amount greater than $0.'; return; }
      if (a > it.requested) { $('#perr').textContent = 'That’s more than the ' + fmt(it.requested) + ' requested — use Fund instead.'; return; }
      a = Math.round(a * 100) / 100;
      var note = $('#pnote').value.trim();
      close();
      decide(it, a, note || undefined);
    });
  }

  // Writes go out one at a time so the Sheet sees them in order.
  var queue = Promise.resolve(), inflight = 0, lastErr = '';
  function setSync() {
    var s = $('#sync'); if (!s) return;
    s.className = 'sync' + (lastErr ? ' err' : '');
    s.textContent = inflight ? 'Saving to Sheet…' : (lastErr ? 'Last save failed' : 'Saved to Sheet');
  }

  function decide(it, amount, note, isUndo) {
    var cyc = S.current;
    var row = it.row;
    it = cyc.items.filter(function (x) { return x.row === row; })[0] || it; // objects are rebuilt after each save
    var prev = it.funded, prevNotes = it.notes, prevCell = it.cells[cyc.C.fund];
    var wasSkipped = isSkipped(it, cyc);
    if (amount != null) removeSkip(it, cyc);
    it.funded = amount;
    if (typeof note === 'string') it.notes = note;
    it.cells[cyc.C.fund] = amount == null ? '' : fmt(amount, true);
    recalc(cyc); buildGroups();
    route();
    if (!isUndo) {
      var msg = amount > 0 ? (amount < it.requested ? 'Partial ' + fmt(amount) + ' · ' : 'Funded ' + fmt(amount) + ' · ') + it.org : 'Not funded · ' + it.org;
      toast(msg, false, function () { if (wasSkipped) addSkip(it, cyc); S.focusRow = it.row; decide(it, prev, undefined, true); });
    }
    inflight++; lastErr = ''; setSync();
    var payload = { row: it.row, org: it.orgRaw, amount: amount };
    if (typeof note === 'string') payload.note = note;
    queue = queue.then(function () {
      return api('decide', payload).then(function (res) {
        inflight--;
        if (!inflight && res.values) {
          var onDecide = /decide/.test(location.hash) && $('#sheet').hidden;
          replaceCurrent(res.values);
          if (onDecide || !/decide/.test(location.hash)) route();
        }
        setSync();
      }).catch(function (err) {
        inflight--; lastErr = err.message;
        it.funded = prev; it.notes = prevNotes; it.cells[cyc.C.fund] = prevCell;
        recalc(cyc); buildGroups(); route();
        toast('Couldn’t save ' + it.org + ': ' + err.message, true);
        setSync();
      });
    });
  }

  // ---------- toast ----------
  var toastT;
  function toast(msg, isErr, undo) {
    var t = $('#toast');
    t.className = 'toast' + (isErr ? ' err' : '');
    t.innerHTML = '<span>' + esc(msg) + '</span>' + (undo ? '<button type="button">Undo</button>' : '');
    t.hidden = false;
    if (undo) t.querySelector('button').addEventListener('click', function () { t.hidden = true; undo(); });
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.hidden = true; }, isErr ? 6000 : 4500);
  }

  // ---------- boot ----------
  $('#yr').textContent = new Date().getFullYear();
  if (S.pass && CFG.apiUrl) {
    load().catch(function (e) { lock(e.message === 'Failed to fetch' ? 'Could not reach the Sheet. Check your connection.' : e.message); });
  } else {
    lock(CFG.apiUrl ? '' : 'Backend not connected yet — add the Apps Script URL to config.js.');
  }
})();
