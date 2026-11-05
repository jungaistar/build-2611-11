/* 스캔본 읽기 화면 — 지시문 · 답 읽기 · 검사 · 변환은 scanread.js 가 한다. 여기서는 파일을 보여 주고, 고친 값을 들고, 집계 화면으로 넘길 뿐이다. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var S = window.Scan, D = window.Downtime;
  var LS_AI = 'build-2611-11.ai', LS_SCAN = 'build-2611-11.scan', LS_SET = 'build-2611-11.settings';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var state = { files: [], pages: [] };            // files: { name, mime, base64, url } · pages: { page, src(파일 이름), issues }
  function msg(id, html, cls) { $(id).innerHTML = html ? '<div class="' + (cls || 'note') + '">' + html + '</div>' : ''; }
  function settings() { try { return D.normSettings(JSON.parse(localStorage.getItem(LS_SET) || 'null') || {}); } catch (e) { return D.normSettings({}); } }
  // 집계 엔진 코드표(설정 반영) — 범례 글자 목록과 「이름 → 코드」 표
  function legend() { var st = settings(); return { mach: st.codes.map(function (c) { return c.code; }), weld: st.weldCodes.map(function (c) { return c.code; }) }; }
  function codeMap() { var st = settings(), m = { mach: {}, weld: {} }; st.codes.forEach(function (c) { m.mach[c.label] = c.code; }); st.weldCodes.forEach(function (c) { m.weld[c.label] = c.code; }); return m; }

  /* ---------- 1. 파일 ---------- */
  function addFiles(list) {
    Array.prototype.forEach.call(list, function (f) {
      var rd = new FileReader();
      rd.onload = function (e) {
        var b64 = String(e.target.result).split(',')[1] || '';
        state.files.push({ name: f.name, mime: f.type || (/\.pdf$/i.test(f.name) ? 'application/pdf' : 'image/jpeg'), base64: b64, url: e.target.result });
        renderThumbs();
      };
      rd.readAsDataURL(f);
    });
  }
  function renderThumbs() {
    $('sc-thumbs').innerHTML = state.files.map(function (f, i) {
      return '<figure class="thumb">' + (/pdf/i.test(f.mime) ? '<div class="pdfbox">PDF</div>' : '<img src="' + f.url + '" alt="' + esc(f.name) + '">') + '<figcaption>' + esc(f.name) + ' <button class="x" data-rm="' + i + '" type="button">빼기</button></figcaption></figure>';
    }).join('');
    syncRun();
  }
  function syncRun() { $('btn-sc-run').disabled = !(state.files.length && $('sc-agree').checked && $('sc-key').value.trim()); }

  /* ---------- 2. AI ---------- */
  function run() {
    var provider = $('sc-provider').value, key = $('sc-key').value.trim();
    try { localStorage.setItem(LS_AI, JSON.stringify({ provider: provider, key: key })); } catch (e) { /* 무시 */ }
    var rq;
    try { rq = S.request(provider, key, state.files.map(function (f) { return { mime: f.mime, base64: f.base64 }; }), S.prompt($('sc-form').value)); }
    catch (err) { msg('sc-msg', esc(err.message), 'warn'); return; }
    $('btn-sc-run').disabled = true; msg('sc-msg', 'AI 가 ' + state.files.length + '장을 읽는 중입니다… (장수와 해상도에 따라 10~60초)', 'note');
    fetch(rq.url, rq.init)
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error((j.error && (j.error.message || j.error.type)) || ('HTTP ' + r.status)); return j; }); })
      .then(function (j) { usePages(S.parseReply(S.extractText(provider, j)), state.files.map(function (f) { return f.name; }).join(', ')); })
      .catch(function (err) { msg('sc-msg', 'AI 읽기가 실패했습니다: ' + esc(err.message) + ' — 「손으로 입력」으로 같은 표를 채울 수 있습니다.', 'warn'); })
      .then(syncRun);
  }
  function usePages(r, src) {
    if (r.error) { msg('sc-msg', esc(r.error), 'warn'); return; }
    r.pages.forEach(function (p) { state.pages.push({ page: p, src: src }); });
    var sm = S.summary(r.pages);
    msg('sc-msg', '읽었습니다 — 일보 ' + sm.pages + '장 · 비가동 ' + sm.downtime + '줄 · 작업 ' + sm.work + '줄. 아래 3 에서 원본과 대조해 주세요.', 'ok');
    renderPages();
  }

  /* ---------- 3. 확인 · 수정 ---------- */
  function renderPages() {
    var lg = legend();
    $('s-pages').hidden = !state.pages.length; $('s-send').hidden = !state.pages.length;
    $('sc-count').textContent = state.pages.length + '장';
    $('sc-pages').innerHTML = state.pages.map(function (e, pi) {
      var p = e.page, F = S.FORMS[p.form], issues = S.validate(p, lg); e.issues = issues;
      var img = state.files.filter(function (f) { return e.src.indexOf(f.name) >= 0 && !/pdf/i.test(f.mime); })[0];
      var h = '<div class="page" data-p="' + pi + '"><div class="page-h"><h3>' + (pi + 1) + '. ' + esc(F.name) + '</h3><span class="sub">' + esc(e.src) + '</span>' + (p.confidence ? '<span class="tag' + (p.confidence === 'low' ? ' bad-t' : '') + '">AI 확신 ' + esc(p.confidence) + '</span>' : '') + '<button class="x" data-del-page="' + pi + '" type="button">이 장 빼기</button></div>';
      h += '<div class="page-body">' + (img ? '<div class="orig"><img src="' + img.url + '" alt="원본"></div>' : '') + '<div class="vals">';
      h += '<div class="fgrid">' + [['equipment', '설비명 · 트랙'], ['worker', '작업자'], ['date', '작업일자'], ['start', '시작시간'], ['end', '종료시간']].map(function (f) {
        return '<label>' + f[1] + '<input type="text" data-pf="' + f[0] + '" value="' + esc(p[f[0]]) + '" placeholder="' + (f[0] === 'date' ? '2026-11-03' : f[0] === 'start' || f[0] === 'end' ? '08:00' : '') + '"></label>';
      }).join('') + '<label>양식<select data-pf="form"><option value="mach"' + (p.form === 'mach' ? ' selected' : '') + '>생산작업일보(가공)</option><option value="weld"' + (p.form === 'weld' ? ' selected' : '') + '>용접 ROBOT 가동일보</option></select></label></div>';
      h += '<h4>비가동 내역 <small class="sub">범례 ' + F.codes.map(function (c) { return c[0] + ' ' + c[1]; }).join(' · ') + '</small></h4>';
      h += '<div class="tablewrap"><table class="dt"><thead><tr><th>순번</th><th>범례</th><th>시작</th><th>종료</th><th>내역</th><th></th></tr></thead><tbody>' + p.downtime.map(function (d, di) {
        return '<tr><td>' + d.no + '</td><td><input class="code" data-dt="' + di + '" data-k="code" value="' + esc(d.code || d.rawCode) + '" maxlength="2"></td><td><input class="tm" data-dt="' + di + '" data-k="start" value="' + esc(d.start) + '"></td><td><input class="tm" data-dt="' + di + '" data-k="end" value="' + esc(d.end) + '"></td><td><input class="wide" data-dt="' + di + '" data-k="note" value="' + esc(d.note) + '"></td><td><button class="x" data-dt-del="' + di + '" type="button">빼기</button></td></tr>';
      }).join('') + '</tbody></table></div><div class="btnrow"><button class="btn sm" data-dt-add="' + pi + '" type="button">비가동 줄 더하기</button></div>';
      h += '<details class="box"><summary>' + (p.form === 'weld' ? '생산 현황' : '일 작업 내역') + ' ' + p.work.length + '줄(가동 시간으로 보냄)</summary><div class="tablewrap"><table class="dt"><thead><tr><th>순번</th><th>시작</th><th>종료</th><th>' + (p.form === 'weld' ? 'Model' : '기종 · 품명 · 작업명') + '</th><th>수량</th><th>비고</th><th></th></tr></thead><tbody>' + p.work.map(function (w, wi) {
        return '<tr><td>' + w.no + '</td><td><input class="tm" data-wk="' + wi + '" data-k="start" value="' + esc(w.start) + '"></td><td><input class="tm" data-wk="' + wi + '" data-k="end" value="' + esc(w.end) + '"></td><td><input class="wide" data-wk="' + wi + '" data-k="job" value="' + esc([w.model, w.part, w.job].filter(Boolean).join(' · ')) + '"></td><td><input class="code" data-wk="' + wi + '" data-k="qty" value="' + esc(w.qty) + '"></td><td><input data-wk="' + wi + '" data-k="note" value="' + esc(w.note) + '"></td><td><button class="x" data-wk-del="' + wi + '" type="button">빼기</button></td></tr>';
      }).join('') + '</tbody></table></div><div class="btnrow"><button class="btn sm" data-wk-add="' + pi + '" type="button">작업 줄 더하기</button></div></details>';
      if (p.checks.length) h += '<p class="sub">장비 점검: ' + p.checks.map(function (c) { return esc(c.item) + ' ' + (c.status || '(미표시)'); }).join(' · ') + '</p>';
      if (p.special) h += '<p class="sub">특이사항: ' + esc(p.special) + '</p>';
      h += issues.length ? '<div class="warn"><b>확인할 것 ' + issues.length + '건</b><ul>' + issues.map(function (x) { return '<li>' + esc(x.where) + ' — ' + esc(x.what) + '</li>'; }).join('') + '</ul></div>' : '<div class="ok">확인할 것이 없습니다.</div>';
      h += '</div></div></div>';
      return h;
    }).join('');
    renderPreview();
  }
  function renderPreview() {
    var rows = S.toFormRows(state.pages.map(function (e) { return e.page; }), codeMap()), sm = S.summary(state.pages.map(function (e) { return e.page; }));
    $('sc-preview').innerHTML = '<p class="sub">입력 양식 ' + (rows.length - 1) + '줄(비가동 ' + sm.downtime + ' · 가동 ' + sm.work + ') · 비가동 합계 ' + sm.downMinutes + '분</p><div class="tablewrap small"><table><thead><tr>' + rows[0].map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.slice(1, 40).map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' + (rows.length > 41 ? '<p class="sub">… 외 ' + (rows.length - 41) + '줄</p>' : '');
  }
  function pageAt(el) { var box = el.closest('.page'); return state.pages[+box.dataset.p]; }
  function onEdit(e) {
    var t = e.target, pe = pageAt(t); if (!pe) return; var p = pe.page;
    if (t.dataset.pf) { p[t.dataset.pf] = t.dataset.pf === 'form' ? t.value : (t.dataset.pf === 'date' ? (S.date(t.value) || t.value.trim()) : (t.dataset.pf === 'start' || t.dataset.pf === 'end') ? (S.time(t.value) || t.value.trim()) : t.value.trim()); }
    else if (t.dataset.dt != null) { var d = p.downtime[+t.dataset.dt], k = t.dataset.k; d[k] = k === 'code' ? S.code(t.value) : (k === 'start' || k === 'end') ? (S.time(t.value) || t.value.trim()) : t.value.trim(); if (k === 'code') d.rawCode = t.value.trim(); }
    else if (t.dataset.wk != null) { var w = p.work[+t.dataset.wk], kk = t.dataset.k; if (kk === 'job') { w.model = ''; w.part = ''; w.job = t.value.trim(); } else w[kk] = (kk === 'start' || kk === 'end') ? (S.time(t.value) || t.value.trim()) : t.value.trim(); }
    else return;
    renderPages();
  }
  function onClick(e) {
    var t = e.target;
    if (t.dataset.delPage != null) { state.pages.splice(+t.dataset.delPage, 1); renderPages(); return; }
    var pe = pageAt(t); if (!pe) return; var p = pe.page;
    if (t.dataset.dtDel != null) p.downtime.splice(+t.dataset.dtDel, 1);
    else if (t.dataset.dtAdd != null) p.downtime.push({ no: p.downtime.length + 1, code: '', rawCode: '', start: '', end: '', note: '' });
    else if (t.dataset.wkDel != null) p.work.splice(+t.dataset.wkDel, 1);
    else if (t.dataset.wkAdd != null) p.work.push({ no: p.work.length + 1, start: '', end: '', model: '', part: '', job: '', qty: '', note: '', code: '' });
    else return;
    renderPages();
  }

  /* ---------- 4. 보내기 ---------- */
  function rows() { return S.toFormRows(state.pages.map(function (e) { return e.page; }), codeMap()); }
  function send() {
    var r = rows(); if (r.length < 2) { msg('sc-send-msg', '보낼 줄이 없습니다.', 'warn'); return; }
    var open = state.pages.reduce(function (n, e) { return n + (e.issues || []).length; }, 0);
    try { localStorage.setItem(LS_SCAN, JSON.stringify({ at: new Date().toISOString(), name: '스캔본 읽은 값(' + state.pages.length + '장)', aoa: r, issues: open })); }
    catch (e) { msg('sc-send-msg', '브라우저 저장에 실패했습니다. 엑셀로 내려받아 집계 화면에 올려 주세요.', 'warn'); return; }
    location.href = 'index.html#scan';
  }
  function xlsx() {
    var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows()), '비가동일보');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(D.legendRows(settings())), '범례');
    XLSX.writeFile(wb, '비가동일보_스캔본읽기_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  }

  /* ---------- 이벤트 ---------- */
  var drop = $('sc-drop');
  ['dragover', 'dragenter'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { addFiles(e.dataTransfer.files); });
  $('sc-file').addEventListener('change', function () { addFiles(this.files); this.value = ''; });
  $('sc-thumbs').addEventListener('click', function (e) { if (e.target.dataset.rm != null) { state.files.splice(+e.target.dataset.rm, 1); renderThumbs(); } });
  $('btn-sc-sample').addEventListener('click', function () { usePages(S.parseReply(S.sampleReply()), '예제(가짜 일보)'); });
  $('btn-sc-manual').addEventListener('click', function () { state.pages.push({ page: S.blankPage('mach'), src: '손으로 입력' }); renderPages(); });
  $('btn-sc-manual-w').addEventListener('click', function () { state.pages.push({ page: S.blankPage('weld'), src: '손으로 입력' }); renderPages(); });
  $('btn-sc-clear').addEventListener('click', function () { state.files = []; state.pages = []; renderThumbs(); renderPages(); msg('sc-msg', ''); });
  try { var ai = JSON.parse(localStorage.getItem(LS_AI) || 'null'); if (ai) { $('sc-provider').value = ai.provider; $('sc-key').value = ai.key; } } catch (e) { /* 없음 */ }
  $('sc-forget').addEventListener('click', function () { localStorage.removeItem(LS_AI); $('sc-key').value = ''; syncRun(); });
  ['input', 'change'].forEach(function (t) { $('sc-key').addEventListener(t, syncRun); $('sc-agree').addEventListener(t, syncRun); });
  $('btn-sc-run').addEventListener('click', run);
  $('sc-pages').addEventListener('change', onEdit);
  $('sc-pages').addEventListener('click', onClick);
  $('btn-sc-send').addEventListener('click', send);
  $('btn-sc-xlsx').addEventListener('click', xlsx);
  syncRun();
})();
