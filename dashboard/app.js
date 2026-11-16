// Token Launch Radar — page logic. Everything renders from window.BOARD_DATA (data.js, written by
// main.ts from the same board as board.json). No fetch, no network: the page works from file://.
(function () {
  'use strict';
  var D = window.BOARD_DATA;
  if (!D) return;
  var rows = D.rows;

  // ---------- formatting ----------
  function usd(n) {
    if (n >= 1e9) return '$' + trim((n / 1e9).toFixed(2)) + 'B';
    if (n >= 1e6) return '$' + trim((n / 1e6).toFixed(1)) + 'M';
    if (n >= 1e3) return '$' + trim((n / 1e3).toFixed(1)) + 'K';
    return '$' + n;
  }
  function trim(s) { return s.replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1'); }
  function fullUsd(n) { return '$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function pct(v) {
    if (v === null || v === undefined) return '<span class="slug">n/a</span>';
    var cls = v > 0 ? 'pos' : v < 0 ? 'neg' : '';
    return '<span class="' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '%</span>';
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days < 90) return days + 'd';
    if (days < 730) return Math.round(days / 30.4) + ' mo';
    return (days / 365.25).toFixed(1) + ' yrs';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- header ----------
  var stats = document.getElementById('stats');
  function stat(value, label, cls) {
    return '<div class="stat' + (cls ? ' ' + cls : '') + '"><b>' + value + '</b><span>' + label + '</span></div>';
  }
  stats.innerHTML =
    stat(D.tracked, 'protocols tracked') +
    stat(D.tokened, 'already tokened') +
    stat(D.ranked, 'pre-token ranked') +
    stat(D.watchlist_size, 'on the watchlist', 'amber') +
    stat(usd(rows.length ? rows[0].implied_value_usd : 0), 'top implied value');
  document.getElementById('model-line').textContent =
    'implied = TVL x family multiple x momentum(7d, clamped) x maturity(age) x breadth(chains)';
  document.getElementById('foot-note').textContent =
    'Snapshot as of ' + D.as_of + ' · floor for the house watchlist: ' + fullUsd(D.floor_usd) +
    ' · ' + D.set_aside + ' no-token records set aside as wrapped/staked/bridged products, versioned pools or exchanges.';

  // ---------- filters ----------
  var catSel = document.getElementById('f-category');
  var chainSel = document.getElementById('f-chain');
  D.categories.forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; catSel.appendChild(o);
  });
  D.chains.forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; chainSel.appendChild(o);
  });
  var q = document.getElementById('q');
  var tvlSel = document.getElementById('f-tvl');
  var watchBox = document.getElementById('f-watch');

  // ---------- table ----------
  var COLUMNS = [
    { key: 'rank', label: 'Rank', num: false },
    { key: 'name', label: 'Protocol', num: false },
    { key: 'category', label: 'Category', num: false },
    { key: 'chains', label: 'Chains', num: false },
    { key: 'tvl_usd', label: 'TVL', num: true },
    { key: 'change_7d', label: '7d', num: true },
    { key: 'age_days', label: 'Age', num: true },
    { key: 'implied_value_usd', label: 'Implied value', num: true }
  ];
  var sortKey = 'rank';
  var sortDir = 1;
  var headRow = document.getElementById('head-row');
  var tbody = document.getElementById('rows');
  var countEl = document.getElementById('count');
  var emptyEl = document.getElementById('empty');

  function renderHead() {
    headRow.innerHTML = COLUMNS.map(function (c) {
      var arrow = sortKey === c.key ? ' <span class="dir">' + (sortDir === 1 ? '▲' : '▼') + '</span>' : '';
      return '<th data-key="' + c.key + '"' + (c.num ? ' class="num"' : '') + '>' + c.label + arrow + '</th>';
    }).join('');
    Array.prototype.forEach.call(headRow.children, function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-key');
        if (sortKey === k) { sortDir = -sortDir; } else { sortKey = k; sortDir = k === 'name' || k === 'category' ? 1 : -1; if (k === 'rank') sortDir = 1; }
        render();
      });
    });
  }

  function filtered() {
    var text = q.value.trim().toLowerCase();
    var cat = catSel.value;
    var chain = chainSel.value;
    var minTvl = Number(tvlSel.value);
    var list = rows.filter(function (r) {
      if (cat && (r.category || 'Uncategorised') !== cat) return false;
      if (chain && r.chains.indexOf(chain) === -1) return false;
      if (r.tvl_usd < minTvl) return false;
      if (watchBox.checked && !r.watchlist) return false;
      if (text && r.name.toLowerCase().indexOf(text) === -1 && r.slug.indexOf(text) === -1) return false;
      return true;
    });
    list.sort(function (a, b) {
      var va = a[sortKey], vb = b[sortKey];
      if (sortKey === 'chains') { va = a.chains.length; vb = b.chains.length; }
      if (va === null || va === undefined) va = -Infinity;
      if (vb === null || vb === undefined) vb = -Infinity;
      if (typeof va === 'string') return sortDir * (va < vb ? -1 : va > vb ? 1 : a.rank - b.rank);
      return sortDir * (va - vb) || (a.rank - b.rank);
    });
    return list;
  }

  function rowHtml(r) {
    return '<tr data-slug="' + esc(r.slug) + '">' +
      '<td class="rank">#' + r.rank + '</td>' +
      '<td><span class="pname">' + esc(r.name) + (r.watchlist ? '<span class="mark" title="On the house watchlist">◆ watchlist</span>' : '') + '</span><br><span class="slug">' + esc(r.slug) + '</span></td>' +
      '<td class="cat">' + esc(r.category || '—') + '</td>' +
      '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
      '<td class="num">' + usd(r.tvl_usd) + '</td>' +
      '<td class="num">' + pct(r.change_7d) + '</td>' +
      '<td class="num">' + ageLabel(r.age_days) + '</td>' +
      '<td class="implied">' + usd(r.implied_value_usd) + '</td></tr>';
  }

  function render() {
    renderHead();
    var list = filtered();
    tbody.innerHTML = list.map(rowHtml).join('');
    emptyEl.hidden = list.length !== 0;
    countEl.textContent = 'showing ' + list.length + ' of ' + rows.length;
    Array.prototype.forEach.call(tbody.children, function (tr) {
      tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-slug')); });
    });
  }

  // ---------- detail ----------
  var boardView = document.getElementById('board-view');
  var detail = document.getElementById('detail-view');
  function bySlug(slug) {
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) return rows[i];
    return null;
  }
  function cell(label, value) {
    return '<div class="d-cell"><span>' + label + '</span><b>' + value + '</b></div>';
  }
  function openDetail(slug) {
    var r = bySlug(slug);
    if (!r) return;
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    detail.innerHTML =
      '<button class="back" id="d-back">← Back to the board</button>' +
      '<div class="d-head"><h2>' + esc(r.name) + '</h2>' +
      '<span class="badge">rank #' + r.rank + ' of ' + rows.length + '</span>' +
      (r.watchlist ? '<span class="badge watch">◆ house watchlist</span>' : '') +
      '<span class="badge">' + esc(r.family) + '</span>' +
      '<span class="d-implied">' + fullUsd(r.implied_value_usd) + '</span></div>' +
      '<div class="d-grid">' +
      cell('TVL', fullUsd(r.tvl_usd)) +
      cell('7d change', r.change_7d === null ? 'not reported' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(2) + '%') +
      cell('Category', esc(r.category || 'none named')) +
      cell('Chains', r.chains.length + ' — ' + esc(r.chains.join(', '))) +
      cell('Tracked since', r.listed_at || 'not reported') +
      cell('Age, no token', ageLabel(r.age_days) + (r.age_days !== null ? ' (' + r.age_days + ' days)' : '')) +
      '</div>' +
      '<div class="formula">implied = TVL <b>' + fullUsd(r.tvl_usd) + '</b> × family <b>' + r.multiple.toFixed(2) + '</b> (' + esc(r.family) + ')' +
      ' × momentum <b>' + r.momentum.toFixed(3) + '</b> × maturity <b>' + r.maturity.toFixed(3) + '</b> × breadth <b>' + r.breadth.toFixed(2) + '</b>' +
      ' = <b>' + fullUsd(r.implied_value_usd) + '</b></div>' +
      '<h3>Farm plan — ' + r.farm_steps.length + ' steps</h3>' +
      '<ol class="plan">' + steps + '</ol>' +
      '<p class="slug">Protocol records no token in the snapshot (no CoinGecko id, no symbol). Implied value is this board\'s model claim, not a forecast of a launch.</p>';
    boardView.hidden = true;
    detail.hidden = false;
    document.getElementById('d-back').addEventListener('click', closeDetail);
    window.scrollTo(0, 0);
  }
  function closeDetail() {
    detail.hidden = true;
    boardView.hidden = false;
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !detail.hidden) closeDetail(); });

  [q, catSel, chainSel, tvlSel, watchBox].forEach(function (el) {
    el.addEventListener('input', render);
    el.addEventListener('change', render);
  });
  render();
})();
