/* 화면 — 판정 · 계산은 downtime.js 가 한다. 여기서는 읽고, 그리고, 고른 값을 넘길 뿐이다. */
(function () {
  'use strict';
  var D = window.Downtime;
  var $ = function (id) { return document.getElementById(id); };
  var esc = D.esc;
  var LS_SET = 'build-2611-11.settings', LS_AI = 'build-2611-11.ai';
  var state = { files: [], res: null, kind: '', month: '', ai: null, sample: false };
  var KIND = { equip: '설비', worker: '작업자' };

  /* ---------- 기준 ---------- */
  var SET_KEYS = ['start', 'dayEnd', 'nightEnd', 'breakMin', 'rests', 'basis', 'target', 'separateRest'];
  function loadSettings() { try { return JSON.parse(localStorage.getItem(LS_SET) || 'null') || {}; } catch (e) { return {}; } }
  var saved = loadSettings();
  var equipGroups = {}; // 설비 · 작업자 이름 → mach | weld (자동 판정을 바꾼 것만)
  function fillSettings(s) {
    var S = D.normSettings(s);
    SET_KEYS.forEach(function (k) { var el = $('set-' + k); if (el.type === 'checkbox') el.checked = !!S[k]; else el.value = S[k]; });
    $('codes').querySelector('tbody').innerHTML = S.codes.map(codeRow).join('');
    $('codes-weld').querySelector('tbody').innerHTML = S.weldCodes.map(codeRow).join('');
    equipGroups = S.equipGroups;
    shiftInfo();
  }
  function codeRow(c) {
    return '<tr><td><input value="' + esc(c.code) + '" maxlength="3" aria-label="코드"></td><td><input value="' + esc(c.label) + '" aria-label="이름"></td>' +
      '<td><input value="' + esc(c.desc) + '" aria-label="설명"></td><td><button class="x" type="button">빼기</button></td></tr>';
  }
  function readSettings() {
    var o = {};
    SET_KEYS.forEach(function (k) { var el = $('set-' + k); o[k] = el.type === 'checkbox' ? el.checked : el.value; });
    var rows = function (id) { return Array.prototype.map.call($(id).querySelectorAll('tbody tr'), function (tr) {
      var i = tr.querySelectorAll('input'); return { code: i[0].value, label: i[1].value, desc: i[2].value };
    }); };
    o.codes = rows('codes'); o.weldCodes = rows('codes-weld'); o.equipGroups = equipGroups;
    return o;
  }
  function settings() { return D.normSettings(readSettings()); }
  function shiftInfo() {
    var S = settings(), a = D.shiftInfo('day', S), b = D.shiftInfo('night', S);
    $('shift-info').innerHTML = '<div class="tablewrap"><table><thead><tr><th>근무 형태</th><th>시간</th><th>휴게</th><th>인정시간</th><th>계획</th></tr></thead><tbody>' +
      [['주간', a], ['주간+야간', b]].map(function (r) {
        return '<tr><td>' + r[0] + '</td><td>' + D.fmtTime(r[1].start) + ' ~ ' + D.fmtTime(r[1].end) + '</td><td class="num">' + r[1].restMin + '분</td><td class="num">' + r[1].recognized + '분 (' + D.round(r[1].recognized / 60, 2) + 'h)</td><td class="num"><b>' + r[1].plan + '분</b> <span class="calc">계산</span></td></tr>';
      }).join('') + '</tbody></table></div><p class="sub" id="plan-formula">가동률 = 가동 시간 ÷ 계획 시간. 계획 시간은 1일 작업시간에서 점심 60분 · 쉬는 시간 20분(오전 · 오후 각 10분)을 뺍니다 — <b>' + esc(D.planFormula(S)) + '</b></p>' + (S.errors.length ? '<div class="warn">' + S.errors.map(esc).join('<br>') + '</div>' : '');
  }
  function onSettings() {
    shiftInfo();
    try { localStorage.setItem(LS_SET, JSON.stringify(readSettings())); } catch (e) { /* 저장 실패는 무시 */ }
    if (state.files.length) compute();
  }
  $('s-set').addEventListener('change', function (e) { if (e.target.matches('input,select')) onSettings(); });
  ['codes', 'codes-weld'].forEach(function (id) {
    $(id).addEventListener('click', function (e) { if (e.target.classList.contains('x')) { e.target.closest('tr').remove(); onSettings(); } });
  });
  $('btn-addcode').addEventListener('click', function () { $('codes').querySelector('tbody').insertAdjacentHTML('beforeend', codeRow({ code: '', label: '', desc: '' })); });
  $('btn-addcode-weld').addEventListener('click', function () { $('codes-weld').querySelector('tbody').insertAdjacentHTML('beforeend', codeRow({ code: '', label: '', desc: '' })); });
  $('btn-defcode').addEventListener('click', function () {
    $('codes').querySelector('tbody').innerHTML = D.DEFAULT_CODES.map(codeRow).join('');
    $('codes-weld').querySelector('tbody').innerHTML = D.DEFAULT_WELD_CODES.map(codeRow).join(''); onSettings();
  });
  $('btn-defset').addEventListener('click', function () { var cur = readSettings(); fillSettings({ codes: cur.codes, weldCodes: cur.weldCodes, equipGroups: cur.equipGroups }); onSettings(); });
  // 설비군 표: 읽은 자료의 설비 · 작업자마다 자동 판정 + 직접 고르기
  function renderGroups() {
    var S = settings(), names = [];
    if (state.res) Object.keys(state.res.kinds).forEach(function (k) { state.res.kinds[k].bySubject.forEach(function (s) { if (names.indexOf(s.subject) < 0) names.push(s.subject); }); });
    Object.keys(equipGroups).forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); });
    // 이름 판정이 「확인 필요」(가공 · 용접 낱말 둘 다)인 줄은 표시하고 맨 위로 — 사용자가 고르게
    var amb = names.filter(function (n) { return !equipGroups[n] && !D.judgeName(n).sure; });
    $('group-tbl').innerHTML = names.length ? (amb.length ? '<div class="warn" id="group-amb">확인 필요 ' + amb.length + '건 — 이름에 가공 · 용접 낱말이 둘 다 있어 설비군을 정하지 못했습니다(지금은 가공설비로 셉니다). 아래에서 골라 주세요: ' + amb.map(esc).join(' · ') + '</div>' : '') +
      '<div class="tablewrap"><table><thead><tr><th>설비 · 작업자</th><th>이름으로 판정</th><th>설비군</th></tr></thead><tbody>' + names.map(function (n) {
      var j = D.judgeName(n), cur = equipGroups[n] || '', ambig = !cur && !j.sure;
      var autoText = j.sure ? D.GROUP_NAME[j.group] : '확인 필요';
      return '<tr' + (ambig ? ' class="amb"' : '') + '><td>' + esc(n) + '</td><td>' + (j.sure ? D.GROUP_NAME[j.group] + ' <small class="sub">' + esc(j.why) + '</small>' : '<b class="lo">확인 필요</b> <small class="sub">' + esc(j.why) + ' — 가공으로 셈</small>') + '</td><td><select data-eq="' + esc(n) + '" aria-label="' + esc(n) + ' 설비군">' +
        '<option value=""' + (cur ? '' : ' selected') + '>자동(' + autoText + ')</option>' +
        D.GROUP_IDS.map(function (g) { return '<option value="' + g + '"' + (cur === g ? ' selected' : '') + '>' + D.GROUP_NAME[g] + '</option>'; }).join('') + '</select></td></tr>';
    }).join('') + '</tbody></table></div>' : '<p class="sub">자료를 올리거나 「기획자 설비 목록 불러오기」를 누르면 설비 · 작업자 목록이 여기에 나옵니다.</p>';
    void S;
  }
  $('group-tbl').addEventListener('change', function (e) {
    var sel = e.target.closest('select[data-eq]'); if (!sel) return;
    e.stopPropagation();
    if (sel.value) equipGroups[sel.dataset.eq] = sel.value; else delete equipGroups[sel.dataset.eq];
    onSettings(); renderGroups();
  });
  // 기획자 설비 목록(2026-11) 30대를 군과 함께 한 번에 등록 — 이미 있는 이름은 덮어쓰지 않는다
  $('btn-planner-equip').addEventListener('click', function () {
    var r = D.withPlannerEquip(equipGroups);
    equipGroups = r.equipGroups;
    $('group-status').textContent = '기획자 설비 목록(' + D.PLANNER_EQUIP_DATE + ') ' + r.total + '대 중 ' + r.added + '대를 등록했습니다' + (r.added < r.total ? '(이미 있던 ' + (r.total - r.added) + '대는 그대로)' : '') + '.';
    onSettings(); renderGroups();
  });
  $('btn-groups-clear').addEventListener('click', function () {
    var n = Object.keys(equipGroups).length;
    equipGroups = {};
    $('group-status').textContent = n ? '직접 고른 설비군 ' + n + '개를 지웠습니다 — 전부 이름으로 다시 판정합니다.' : '직접 고른 설비군이 없습니다.';
    onSettings(); renderGroups();
  });

  /* ---------- 읽기 ---------- */
  function readFile(f) {
    var rd = new FileReader();
    rd.onload = function (e) {
      try {
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        var sheets = wb.SheetNames.map(function (n) {
          var aoa = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' });
          var det = D.detectSheet(aoa, n);
          return { name: n, aoa: aoa, det: det, type: det.type };
        });
        if (state.sample) { state.files = []; state.sample = false; }
        state.files.push({ name: f.name, sheets: sheets });
        renderFiles(); compute();
      } catch (err) { status('<div class="warn">' + esc(f.name) + ' 을 읽지 못했습니다: ' + esc(err.message) + '</div>'); }
    };
    rd.readAsArrayBuffer(f);
  }
  function addFiles(list) { Array.prototype.forEach.call(list, readFile); }
  $('file').addEventListener('change', function (e) { addFiles(e.target.files); e.target.value = ''; });
  var drop = $('drop');
  ['dragover', 'dragenter'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function () { drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { e.preventDefault(); addFiles(e.dataTransfer.files); });

  var TYPE_OPTS = Object.keys(D.TYPES);
  function renderFiles() {
    $('files').innerHTML = state.files.map(function (f, fi) {
      return '<li><span class="fname">' + esc(f.name) + '</span><button class="x" data-f="' + fi + '">빼기</button><ul class="sheets">' +
        f.sheets.map(function (s, si) {
          return '<li><span>시트 <b>' + esc(s.name) + '</b></span><select data-f="' + fi + '" data-s="' + si + '" aria-label="시트 형식">' +
            TYPE_OPTS.map(function (t) { return '<option value="' + t + '"' + (s.type === t ? ' selected' : '') + '>' + esc(D.TYPES[t]) + '</option>'; }).join('') + '</select>' +
            '<span class="why">' + (s.type === s.det.type ? '자동 판별 — ' + esc(s.det.why) : '직접 고름') + '</span><span class="cnt" data-cnt="' + fi + '-' + si + '"></span></li>';
        }).join('') + '</ul></li>';
    }).join('');
  }
  $('files').addEventListener('change', function (e) {
    var s = e.target.closest('select'); if (!s) return;
    state.files[+s.dataset.f].sheets[+s.dataset.s].type = s.value; renderFiles(); compute();
  });
  $('files').addEventListener('click', function (e) {
    var b = e.target.closest('.x'); if (!b) return;
    state.files.splice(+b.dataset.f, 1); renderFiles();
    if (state.files.length) compute(); else clearResult();
  });
  function status(h) { $('data-status').innerHTML = h; }
  function clearResult() { state.res = null; $('s-dash').hidden = true; $('s-report').hidden = true; status(''); }

  /* ---------- 계산 ---------- */
  function compute() {
    var S = settings(), parts = [], counts = {};
    state.files.forEach(function (f, fi) {
      f.sheets.forEach(function (s, si) {
        if (s.type === 'skip') return;
        var p = D.parseSheet(s.aoa, s.type, { file: f.name, sheet: s.name }, S);
        counts[fi + '-' + si] = p.records.length ? p.records.length + '줄' : p.days.length ? p.days.length + '일' : p.repairs.length ? p.repairs.length + '건' : '읽은 줄 없음';
        parts.push(p);
      });
    });
    Object.keys(counts).forEach(function (k) { var el = document.querySelector('[data-cnt="' + k + '"]'); if (el) el.textContent = '· ' + counts[k]; });
    var input = D.merge(parts);
    var res = D.analyze(input, S, { month: state.month });
    if (state.month && res.months.indexOf(state.month) < 0) { state.month = ''; res = D.analyze(input, S); }
    var kinds = Object.keys(res.kinds);
    if (!kinds.length) {
      state.res = null; $('s-dash').hidden = true; $('s-report').hidden = true;
      return status('<div class="warn">집계할 기록을 찾지 못했습니다. 시트 형식을 확인하거나 「빈 입력 양식」 머리글(설비 · 날짜 · 시작 · 종료 …)을 맞춰 주세요.' +
        (input.repairs.length ? ' 수리 이력만으로는 가동률을 낼 수 없습니다.' : '') + '</div>');
    }
    state.res = res; state.ai = null;
    if (kinds.indexOf(state.kind) < 0) state.kind = kinds[0];
    var warns = res.issues.filter(function (x) { return x.level === 'warn'; }).length;
    status('<div class="ok">기록 ' + input.records.length + '줄 · 하루 합계 ' + input.days.length + '건 · 수리 이력 ' + input.repairs.length + '건을 읽었습니다.' +
      (warns ? ' 확인할 것 ' + warns + '건이 있습니다(대시보드 아래).' : '') + '</div>');
    render();
    $('s-dash').hidden = false; $('s-report').hidden = false;
  }
  $('kind').addEventListener('change', function () { state.kind = $('kind').value; state.ai = null; render(); });
  $('month').addEventListener('change', function () { state.month = $('month').value; compute(); });

  /* ---------- 그리기 ---------- */
  var h1 = function (m) { return D.fmtH(m); };
  function render() {
    var res = state.res, S = res.settings, A = res.kinds[state.kind], T = A.totals, U = KIND[state.kind];
    $('kind').innerHTML = Object.keys(res.kinds).map(function (k) { return '<option value="' + k + '"' + (k === state.kind ? ' selected' : '') + '>' + KIND[k] + '별</option>'; }).join('');
    $('month').innerHTML = '<option value="">전체</option>' + res.months.map(function (m) { return '<option value="' + m + '"' + (m === state.month ? ' selected' : '') + '>' + m + '</option>'; }).join('');
    $('basis-note').textContent = '계획 시간: ' + D.basisText(S) + ' · 8to5 = ' + D.planFormula(S).replace(/^.*근무 /, '') + ' · 목표 ' + S.target + '%';
    var lo = T.util != null && T.util * 100 < S.target;
    $('kpi').innerHTML = '<div class="kpis">' +
      '<div class="kpi"><b>' + h1(T.plan) + '<small>h</small></b>계획 시간<span class="k-sub">' + U + ' ' + T.subjects + (state.kind === 'equip' ? '대' : '명') + ' · ' + T.dates + '일</span></div>' +
      '<div class="kpi"><b>' + h1(T.run) + '<small>h</small></b>가동 시간' + (T.runCalc ? '<span class="k-sub">' + T.runCalc + '일은 계획 − 비가동</span>' : '') + '</div>' +
      '<div class="kpi"><b>' + h1(T.down) + '<small>h</small></b>비가동 시간' + (T.restCut ? '<span class="k-sub">휴게와 겹친 ' + T.restCut + '분은 뺐습니다</span>' : '') + '</div>' +
      '<div class="kpi ' + (lo ? 'lo' : 'main') + '"><b>' + D.pct(T.util) + '</b>가동률<span class="k-sub">가동 ÷ 계획 · 목표 ' + S.target + '%</span></div></div>';
    $('bar-title').textContent = U + '별 가동률';
    $('by-title').textContent = U + '별';
    $('matrix-title').textContent = U + ' × 사유 비가동(시간)';
    $('bar-chart').innerHTML = barChart(A.bySubject, S.target) + '<div class="legend"><span class="lg">가동률</span><span class="lg l-lo">목표 미달</span><span class="lg l-tgt">목표 ' + S.target + '%</span></div>';
    $('pareto').innerHTML = paretoChart(A.pareto) + '<div class="legend"><span class="lg">비가동 시간</span><span class="lg l-cum">누적 %</span></div>';
    $('trend').innerHTML = trendChart(A.byDate, S.target) + '<div class="legend"><span class="lg l-util">일별 가동률</span><span class="lg l-tgt">목표 ' + S.target + '%</span></div>';
    $('pareto-tbl').innerHTML = '<table><thead><tr><th>순위</th><th>사유</th><th>코드(설비군)</th><th>건수</th><th>시간(h)</th><th>비율</th><th>누적</th></tr></thead><tbody>' +
      A.pareto.map(function (p, i) { return '<tr><td class="num">' + (i + 1) + '</td><td><b>' + esc(p.label) + '</b></td><td>' + esc(p.code) + '</td><td class="num">' + p.count + '</td><td class="num">' + h1(p.min) + '</td><td class="num">' + D.pct(p.pct) + '</td><td class="num">' + D.pct(p.cum) + '</td></tr>'; }).join('') +
      (A.pareto.length ? '' : '<tr><td colspan="7">비가동 기록이 없습니다.</td></tr>') + '</tbody></table>';
    $('by-tbl').innerHTML = '<table><thead><tr><th>' + U + '</th><th>설비군</th><th>일수</th><th>계획(h)</th><th>가동(h)</th><th>비가동(h)</th><th>가동률</th><th>주 사유</th></tr></thead><tbody>' +
      A.bySubject.map(function (s) {
        var l = s.util != null && s.util * 100 < S.target;
        return '<tr><td>' + esc(s.subject) + '</td><td>' + (D.GROUP_NAME[s.group] || '') + '</td><td class="num">' + s.days + '</td><td class="num">' + h1(s.plan) + '</td><td class="num">' + h1(s.run) + '</td><td class="num">' + h1(s.down) +
          '</td><td class="num' + (l ? ' lo' : '') + '">' + D.pct(s.util) + '</td><td>' + (s.top ? esc(s.top.label) + ' <small class="sub">' + esc(s.top.code) + '</small>' : '-') + '</td></tr>';
      }).join('') + '</tbody></table>';
    var max = 0; A.matrix.forEach(function (r) { r.cells.forEach(function (v) { if (v > max) max = v; }); });
    $('matrix').innerHTML = '<table><thead><tr><th>' + U + '</th>' + A.codeCols.map(function (c) { return '<th title="' + esc(c.from) + '">' + esc(c.label) + '<br><small class="sub">' + esc(c.from) + '</small></th>'; }).join('') + '<th>합계</th></tr></thead><tbody>' +
      A.matrix.map(function (r) {
        return '<tr><td>' + esc(r.subject) + '</td>' + r.cells.map(function (v) { return '<td class="num" style="background:rgba(200,52,31,' + (max ? D.round(v / max * 0.45, 3) : 0) + ')">' + (v ? h1(v) : '') + '</td>'; }).join('') + '<td class="num"><b>' + h1(r.total) + '</b></td></tr>';
      }).join('') + '</tbody></table>';
    $('month-wrap').hidden = A.byMonth.length < 2;
    $('by-month').innerHTML = '<table><thead><tr><th>월</th><th>계획(h)</th><th>가동(h)</th><th>비가동(h)</th><th>가동률</th></tr></thead><tbody>' +
      A.byMonth.map(function (m) { return '<tr><td>' + m.month + '</td><td class="num">' + h1(m.plan) + '</td><td class="num">' + h1(m.run) + '</td><td class="num">' + h1(m.down) + '</td><td class="num">' + D.pct(m.util) + '</td></tr>'; }).join('') + '</tbody></table>';
    var iss = res.issues;
    $('issue-count').textContent = '확인 ' + iss.filter(function (x) { return x.level === 'warn'; }).length + '건 · 참고 ' + iss.filter(function (x) { return x.level !== 'warn'; }).length + '건';
    $('issues').innerHTML = iss.length ? '<ul class="issues">' + iss.slice().sort(function (a, b) { return (a.level === 'warn' ? 0 : 1) - (b.level === 'warn' ? 0 : 1); }).slice(0, 200).map(function (x) {
      return '<li><span class="lv ' + x.level + '">' + (x.level === 'warn' ? '확인' : '참고') + '</span><span class="wh">' + esc(x.where) + '</span><span class="tx">' + esc(x.text) + '</span></li>';
    }).join('') + '</ul>' : '<div class="ok">기록에서 걸리는 것이 없습니다.</div>';
    $('days').innerHTML = '<table><thead><tr><th>날짜</th><th>' + U + '</th><th>근무</th><th>계획(분)</th><th>가동(분)</th><th>비가동(분)</th><th>가동률</th><th>사유(분)</th></tr></thead><tbody>' +
      A.days.map(function (d) {
        var cs = Object.keys(d.codes).filter(function (c) { return d.codes[c] > 0; }).map(function (c) { return D.keyName(c) + ' ' + D.keyLabel(c, S) + ' ' + D.round(d.codes[c], 1); }).join(' · ');
        return '<tr><td>' + d.date + ' (' + D.weekday(d.date) + ')</td><td>' + esc(d.subject) + '</td><td>' + D.shiftName(d.shift) + '</td><td class="num">' + d.plan + (d.planSrc === 'shift' && S.basis === 'recorded' && d.src === 'summary' ? '<span class="calc">근무 형태</span>' : '') +
          '</td><td class="num">' + D.round(d.run, 1) + (d.runSrc === 'calc' ? '<span class="calc">계산</span>' : '') + '</td><td class="num">' + D.round(d.down, 1) + '</td><td class="num">' + D.pct(D.util(d.run, d.plan)) + '</td><td>' + esc(cs) + (d.est ? '<span class="calc">추정</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table>';
    renderReport();
    renderGroups();
  }

  /* ---------- SVG ---------- */
  function svg(w, h, body, label) { return '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(label) + '" xmlns="http://www.w3.org/2000/svg" font-family="Pretendard,Apple SD Gothic Neo,Malgun Gothic,sans-serif">' + body + '</svg>'; }
  function barChart(rows, target) {
    var W = 640, L = 118, R = 56, rowH = 30, top = 22, H = top + rows.length * rowH + 26;
    var maxU = Math.max(1, Math.max.apply(null, rows.map(function (r) { return r.util || 0; })));
    var x = function (u) { return L + (W - L - R) * u / maxU; };
    var b = '';
    [0, 0.25, 0.5, 0.75, 1].forEach(function (t) { b += '<line class="grid" x1="' + x(t) + '" x2="' + x(t) + '" y1="' + (top - 6) + '" y2="' + (H - 20) + '"/><text class="ax" x="' + x(t) + '" y="' + (H - 6) + '" text-anchor="middle">' + Math.round(t * 100) + '%</text>'; });
    rows.forEach(function (r, i) {
      var y = top + i * rowH, u = r.util || 0, lo = r.util != null && r.util * 100 < target;
      b += '<text class="axt" x="' + (L - 8) + '" y="' + (y + 18) + '" text-anchor="end">' + esc(r.subject.length > 10 ? r.subject.slice(0, 10) + '…' : r.subject) + '</text>' +
        '<rect class="bar' + (lo ? ' lo' : '') + '" x="' + L + '" y="' + (y + 5) + '" width="' + Math.max(0, x(u) - L).toFixed(1) + '" height="' + (rowH - 10) + '" rx="3"><title>' + esc(r.subject) + ' ' + D.pct(r.util) + '</title></rect>' +
        '<text class="val" x="' + (x(u) + 5).toFixed(1) + '" y="' + (y + 19) + '">' + D.pct(r.util) + '</text>';
    });
    b += '<line class="tgt" x1="' + x(target / 100) + '" x2="' + x(target / 100) + '" y1="' + (top - 10) + '" y2="' + (H - 20) + '"/>';
    return svg(W, H, b, '가동률 막대 그래프');
  }
  // 「가공 B · 용접 C」 → 「가B·용C」(막대 아래 좁은 자리용)
  function shortFrom(p) { return (p.keys || []).map(function (k) { var i = k.indexOf(':'); return (k.slice(0, i) === 'weld' ? '용' : '가') + k.slice(i + 1); }).join('·'); }
  function niceMax(v) { if (v <= 0) return 1; var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
  function paretoChart(P) {
    var W = 640, H = 300, L = 50, R = 46, T = 18, B = 40;
    if (!P.length) return svg(W, 80, '<text class="axt" x="20" y="44">비가동 기록이 없습니다.</text>', '파레토');
    var maxH = niceMax(P[0].min / 60), bw = (W - L - R) / P.length;
    var y = function (hr) { return H - B - (H - T - B) * hr / maxH; }, yc = function (c) { return H - B - (H - T - B) * c; };
    var b = '';
    [0, 0.25, 0.5, 0.75, 1].forEach(function (t) {
      b += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + yc(t) + '" y2="' + yc(t) + '"/><text class="ax" x="' + (L - 6) + '" y="' + (yc(t) + 4) + '" text-anchor="end">' + D.round(maxH * t, 1) + '</text>' +
        '<text class="ax" x="' + (W - R + 6) + '" y="' + (yc(t) + 4) + '">' + Math.round(t * 100) + '%</text>';
    });
    b += '<text class="ax" x="' + L + '" y="12">시간(h)</text><text class="ax" x="' + (W - R) + '" y="12" text-anchor="end">누적</text>';
    var pts = [];
    P.forEach(function (p, i) {
      var cx = L + bw * i + bw / 2, hr = p.min / 60;
      b += '<rect class="bar" x="' + (L + bw * i + bw * 0.15).toFixed(1) + '" y="' + y(hr).toFixed(1) + '" width="' + (bw * 0.7).toFixed(1) + '" height="' + (H - B - y(hr)).toFixed(1) + '" rx="2"><title>' + esc(p.code + ' ' + p.label) + ' ' + D.fmtH(p.min) + 'h · ' + D.pct(p.pct) + '</title></rect>' +
        '<text class="axt" x="' + cx + '" y="' + (H - B + 16) + '" text-anchor="middle">' + esc(p.label.length > 5 ? p.label.slice(0, 5) : p.label) + '</text><text class="ax" x="' + cx + '" y="' + (H - B + 30) + '" text-anchor="middle">' + esc(shortFrom(p)) + '</text>';
      pts.push([cx, yc(p.cum)]);
    });
    b += '<polyline class="l-cum" points="' + pts.map(function (q) { return q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join(' ') + '"/>' +
      pts.map(function (q, i) { return '<circle class="cum" cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="3.5"><title>누적 ' + D.pct(P[i].cum) + '</title></circle>'; }).join('');
    return svg(W, H, b, '비가동 사유 파레토');
  }
  function trendChart(rows, target) {
    var W = 860, H = 250, L = 46, R = 16, T = 16, B = 34;
    var us = rows.filter(function (r) { return r.util != null; });
    if (!us.length) return svg(W, 80, '<text class="axt" x="20" y="44">가동률을 계산할 날이 없습니다.</text>', '일별 추이');
    var lo = Math.min(target / 100, Math.min.apply(null, us.map(function (r) { return r.util; })));
    var hi = Math.max(1, Math.max.apply(null, us.map(function (r) { return r.util; })));
    lo = Math.max(0, Math.floor(lo * 10 - 0.5) / 10); hi = Math.ceil(hi * 10) / 10;
    var n = rows.length, x = function (i) { return n === 1 ? (L + W - R) / 2 : L + (W - L - R) * i / (n - 1); }, y = function (u) { return H - B - (H - T - B) * (u - lo) / (hi - lo); };
    var b = '';
    var st = hi - lo > 0.3 ? 0.1 : 0.05;
    for (var u = lo; u <= hi + 1e-9; u += st) { b += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(u) + '" y2="' + y(u) + '"/><text class="ax" x="' + (L - 6) + '" y="' + (y(u) + 4) + '" text-anchor="end">' + Math.round(u * 100) + '%</text>'; }
    var step = Math.max(1, Math.ceil(n / 12));
    rows.forEach(function (r, i) { if (i % step === 0 || i === n - 1) b += '<text class="ax" x="' + x(i) + '" y="' + (H - B + 16) + '" text-anchor="middle">' + r.date.slice(5).replace('-', '.') + '</text>'; });
    b += '<line class="tgt" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(target / 100) + '" y2="' + y(target / 100) + '"/>';
    var pts = rows.map(function (r, i) { return r.util == null ? null : [x(i), y(r.util), r]; }).filter(Boolean);
    b += '<polyline class="l-util" points="' + pts.map(function (q) { return q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join(' ') + '"/>';
    b += pts.map(function (q) { return '<circle class="pt' + (q[2].util * 100 < target ? ' lo' : '') + '" cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="4"><title>' + q[2].date + ' ' + D.pct(q[2].util) + ' · 비가동 ' + D.fmtH(q[2].down) + 'h</title></circle>'; }).join('');
    return svg(W, H, b, '일별 가동률 추이');
  }

  /* ---------- 보고서 ---------- */
  function charts() {
    var A = state.res.kinds[state.kind], S = state.res.settings;
    return { bar: barChart(A.bySubject, S.target), pareto: paretoChart(A.pareto), trend: trendChart(A.byDate, S.target) };
  }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function reportHtml() {
    return D.reportHtml(state.res, state.kind, { charts: charts(), team: $('team').value.trim(), made: today(), sample: state.sample, aiLines: state.ai && state.ai.use ? state.ai.lines : null });
  }
  function renderReport() {
    var L = D.summaryLines(state.res, state.kind);
    $('summary').innerHTML = '<h4>요약 — 규칙으로 만든 문장입니다</h4><ul>' + L.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>';
    $('ai-out').innerHTML = state.ai ? '<div class="ai-draft"><span class="tag">AI 초안 — 검토 필요</span><ul>' + state.ai.lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>' +
      '<label class="chk" style="display:flex;gap:6px;align-items:center;margin-top:8px;font-size:13.5px"><input type="checkbox" id="ai-use"' + (state.ai.use ? ' checked' : '') + '> 보고서에 AI 문장을 씁니다</label></div>' : '';
    $('preview').srcdoc = reportHtml();
  }
  document.addEventListener('change', function (e) { if (e.target.id === 'ai-use' && state.ai) { state.ai.use = e.target.checked; $('preview').srcdoc = reportHtml(); } });
  $('team').addEventListener('input', function () { if (state.res) $('preview').srcdoc = reportHtml(); });
  function download(name, blob) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function stamp() { var A = state.res.kinds[state.kind]; return A.period.from.slice(0, 7) === A.period.to.slice(0, 7) ? A.period.from.slice(0, 7) : A.period.from + '_' + A.period.to; }
  $('btn-print').addEventListener('click', function () {
    var fr = $('print-frame');
    fr.onload = function () { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { /* 인쇄 창을 열 수 없는 환경 */ } fr.onload = null; };
    fr.srcdoc = reportHtml();
  });
  $('btn-html').addEventListener('click', function () {
    download((state.kind === 'equip' ? '설비운영실적_' : '작업자가동현황_') + stamp() + '.html', new Blob([reportHtml()], { type: 'text/html;charset=utf-8' }));
  });
  function book(obj) {
    var wb = XLSX.utils.book_new();
    Object.keys(obj).forEach(function (n) {
      var ws = XLSX.utils.aoa_to_sheet(obj[n]);
      var w = []; obj[n].slice(0, 60).forEach(function (r) { (r || []).forEach(function (c, i) { var l = String(c == null ? '' : c).length; w[i] = Math.min(48, Math.max(w[i] || 6, l + 2)); }); });
      ws['!cols'] = w.map(function (x) { return { wch: x || 8 }; });
      XLSX.utils.book_append_sheet(wb, ws, n);
    });
    return wb;
  }
  $('btn-export').addEventListener('click', function () {
    var sh = D.sheets(state.res);
    if (state.ai) sh['요약'] = sh['요약'].concat([[], ['AI 초안 — 검토 필요']], state.ai.lines.map(function (l) { return ['AI 요약', l]; }));
    XLSX.writeFile(book(sh), '설비비가동집계_' + stamp() + '.xlsx');
  });

  /* ---------- 양식 · 예제 ---------- */
  $('btn-template').addEventListener('click', function () { XLSX.writeFile(book(D.templateSheets(settings())), '비가동일보_입력양식.xlsx'); });
  $('btn-sample-file').addEventListener('click', function () {
    var s = D.sample(); XLSX.writeFile(book({ '비가동일보': s.sheets[0].aoa, '범례': D.legendRows(settings()) }), '비가동일보_예제(가짜데이터).xlsx');
  });
  $('btn-sample').addEventListener('click', function () {
    var s = D.sample();
    state.files = [{ name: '예제(가짜 데이터)', sheets: s.sheets.map(function (x) { var det = D.detectSheet(x.aoa, x.name); return { name: x.name, aoa: x.aoa, det: det, type: det.type }; }) }];
    state.sample = true; state.month = ''; state.kind = 'equip';
    renderFiles(); compute();
    $('s-dash').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('btn-reset').addEventListener('click', function () { state.files = []; state.sample = false; renderFiles(); clearResult(); });

  /* ---------- AI (선택) ---------- */
  try { var ai = JSON.parse(localStorage.getItem(LS_AI) || 'null'); if (ai) { $('ai-provider').value = ai.provider; $('ai-key').value = ai.key; } } catch (e) { /* 저장값 없음 */ }
  $('ai-forget').addEventListener('click', function () { localStorage.removeItem(LS_AI); $('ai-key').value = ''; });
  $('ai-run').addEventListener('click', function () {
    var provider = $('ai-provider').value, key = $('ai-key').value.trim(), out = $('ai-out');
    if (!state.res) return;
    if (!key) { out.innerHTML = '<div class="warn">API 키를 넣어 주세요. 키가 없어도 위의 규칙 요약과 보고서는 그대로 쓸 수 있습니다.</div>'; return; }
    if (!window.confirm('요약 문장과 ' + KIND[state.kind] + '별 가동률 · 사유 집계가 ' + (provider === 'openai' ? 'OpenAI' : 'Anthropic') +
      ' 로 전송됩니다.\n사내 자료를 외부 AI 로 보내도 되는지 확인하셨나요?')) return;
    try { localStorage.setItem(LS_AI, JSON.stringify({ provider: provider, key: key })); } catch (e) { /* 저장 실패는 무시 */ }
    var rq = D.aiRequest(provider, key, D.aiPrompt(state.res, state.kind));
    out.innerHTML = '<div class="note">AI 에 요청하는 중입니다…</div>';
    fetch(rq.url, rq.init).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error((j.error && (j.error.message || j.error.type)) || r.status); return j; }); })
      .then(function (j) { var lines = D.aiLines(provider, j); if (!lines.length) throw new Error('빈 응답'); state.ai = { lines: lines, use: false }; renderReport(); })
      .catch(function (err) { out.innerHTML = '<div class="warn">AI 요청이 실패했습니다: ' + esc(err.message) + '. 규칙 요약은 그대로 쓸 수 있습니다.</div>'; });
  });

  fillSettings(saved);
  renderGroups();
  // (v1.3) 스캔본 읽기 화면에서 보낸 입력 양식 줄 — index.html#scan 으로 오면 파일처럼 올려 바로 집계한다
  (function loadScan() {
    if (location.hash !== '#scan') return;
    var j = null; try { j = JSON.parse(localStorage.getItem('build-2611-11.scan') || 'null'); } catch (e) { j = null; }
    if (!j || !j.aoa) return;
    var det = D.detectSheet(j.aoa, '비가동일보');
    if (state.sample) { state.files = []; state.sample = false; }
    state.files.push({ name: j.name || '스캔본 읽은 값', sheets: [{ name: '비가동일보', aoa: j.aoa, det: det, type: det.type }] });
    renderFiles(); compute();
    status('<div class="' + (j.issues ? 'warn' : 'ok') + '">스캔본에서 읽은 ' + (j.aoa.length - 1) + '줄을 올렸습니다' + (j.issues ? ' — 스캔본 화면에서 「확인할 것」 ' + j.issues + '건이 남아 있었습니다. 집계에서 빠지거나 미분류로 센 줄이 있는지 「확인할 것」을 보세요.' : '.') + '</div>');
    localStorage.removeItem('build-2611-11.scan');
    history.replaceState(null, '', location.pathname);
  })();
})();
