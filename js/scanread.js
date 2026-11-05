/* 스캔본 읽기 — 손으로 쓴 작업일보(사진 · PDF)를 AI 비전으로 읽어 입력 양식 줄로 바꾼다 (v1.3)
 * 화면(scan.js)은 판정하지 않는다. 지시문 · 요청 모양 · 답 읽기 · 검사 · 입력 양식 변환은 전부 여기 두고 test/logic.test.js 로 고정한다.
 * 브라우저(window.Scan)와 node(require) 겸용.
 *
 * 지키는 것
 *   - AI 는 키를 넣고 외부 전송을 확인했을 때만 부른다. 키가 없으면 같은 표를 손으로 넣는다.
 *   - AI 답을 믿지 않는다 — JSON 만 꺼내고, 코드 · 시각 · 날짜를 검사해 틀린 칸은 「확인」으로 올리고, 사람이 고친 뒤에만 집계로 보낸다.
 *   - 읽을 수 없는 칸은 비워 둔다. 지어내지 않는다(지시문에도 적고, 답의 unreadable 을 그대로 보인다).
 *   - 스캔본과 읽은 값은 이 브라우저 밖으로 나가지 않는다(AI 전송 제외). 저장소에는 가짜 예제뿐이다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Scan = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 양식 2종(기획자 2026-11-04 드라이브 공유, 빈 양식) ---------- */
  var FORMS = {
    mach: { id: 'mach', name: '생산작업일보(가공설비)', group: '가공설비',
      codes: [['A', '제관품대기'], ['B', '제관품無'], ['C', '장비고장'], ['D', '티칭수정'], ['E', '계획정지'], ['F', '공정결원'], ['G', '청소'], ['H', '기타']],
      head: '사업부명 · 반명 · 설비명 · 작업자 · 시작시간 · 종료시간 · 작업일자(년 월 일)',
      work: '일 작업 내역 9줄: 순번 · 작업시간(시작~종료) · 기종 · 품명 · 작업명 · 수량 · 타각 · 비고',
      down: '비가동 내역 6줄: 순번 · 범례(A~H) · 시작([시]:[분]) · 종료 · 불량/비가동 내역 · 비고',
      extra: '특이사항(공정 내 설비고장, 에어 · gas 누기, 용접기 이상, 유압 누유 등)' },
    weld: { id: 'weld', name: '자동용접 ROBOT 가동일보', group: '용접설비',
      codes: [['A', '제관품대기'], ['B', '제관품無'], ['C', '장비고장'], ['D', '티칭수정'], ['E', '계획정지'], ['F', '공정결원'], ['G', '청소'], ['H', '기타']],
      head: '제목의 트랙 번호(예: 트랙 3) · 날짜(2026년 월 일 요일) · 가동 시작 시각 · 가동 종료 시각 · 총 가동시간',
      checks: '장비 점검 3항목: TCP(토치 원점 조정) · 노즐 클리너 및 와이어커터 점검 · 가스 체크 및 냉각수 순환기 점검 — 정상/비정상 표시, 점검/수리',
      work: '생산 현황 21줄: NO · Model · Start([시]:[분]) · Closing · 범례(A~H, 비가동일 때만) · Special Note' }
  };
  // 양식의 비가동 범례는 가공 · 용접이 같은 글자 체계(A~H)를 쓴다(2026-11-04 양식). 집계 엔진의 설비군별 코드표와 글자가 다를 수 있어
  // 변환할 때는 「범례 이름」으로 집계 코드표를 다시 찾는다(이름이 같으면 그 코드, 없으면 그대로 두고 확인에 올린다).

  function clean(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  // 시각: 「10:00」 「[10]:[00]」 「1000」 「10시 30분」 「오후 1:30」 → HH:MM, 못 읽으면 null
  function time(v) {
    var s = clean(v).replace(/[\[\]\s]/g, ''); if (!s) return null;
    var pm = /오후|PM/i.test(s); s = s.replace(/오전|오후|AM|PM/gi, '');
    var m = s.match(/^(\d{1,2})[:시](\d{1,2})분?$/) || s.match(/^(\d{1,2})시$/) || s.match(/^(\d{2})(\d{2})$/);
    if (!m) return null;
    var h = +m[1], mi = m[2] != null ? +m[2] : 0;
    if (pm && h < 12) h += 12;
    if (h > 24 || mi > 59) return null;
    return pad2(h) + ':' + pad2(mi);
  }
  function minutes(t) { var m = /^(\d{2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; }
  function date(v) {
    var s = clean(v); if (!s) return null;
    var m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/); if (!m) { m = s.match(/^(\d{4})(\d{2})(\d{2})$/); }
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3]; if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return y + '-' + pad2(mo) + '-' + pad2(d);
  }
  function code(v) { var s = clean(v).toUpperCase().replace(/[^A-H]/g, ''); return s ? s.charAt(0) : ''; }

  /* ---------- AI 지시문 ---------- */
  function prompt(formHint) {
    var f = formHint && FORMS[formHint];
    var sys = [
      '당신은 손으로 기입한 설비 작업일보 스캔본을 읽어 표로 옮기는 보조자입니다.',
      '규칙:',
      '1. 사진에 적힌 것만 옮깁니다. 읽을 수 없거나 비어 있는 칸은 null 로 두고 unreadable 에 어느 칸인지 적습니다. 추측해 채우지 않습니다.',
      '2. 시각은 "HH:MM" 24시간제, 날짜는 "YYYY-MM-DD", 범례 코드는 A~H 한 글자입니다. 빈 줄은 넣지 않습니다.',
      '3. 반드시 JSON 하나만 답합니다. 설명 문장을 붙이지 않습니다.',
      '양식 두 가지: (1) 생산작업일보(가공설비) — ' + FORMS.mach.head + ' / ' + FORMS.mach.work + ' / ' + FORMS.mach.down + ' / ' + FORMS.mach.extra,
      '(2) 자동용접 ROBOT 가동일보 — ' + FORMS.weld.head + ' / ' + FORMS.weld.checks + ' / ' + FORMS.weld.work,
      '비가동 범례: ' + FORMS.mach.codes.map(function (c) { return c[0] + ' ' + c[1]; }).join(', '),
      'JSON 모양: {"pages":[{"form":"mach"|"weld","equipment":"설비명 또는 트랙","worker":"작업자","date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM",' +
      '"work":[{"no":1,"start":"HH:MM","end":"HH:MM","model":"","part":"","job":"","qty":null,"note":""}],' +
      '"downtime":[{"no":1,"code":"A","start":"HH:MM","end":"HH:MM","note":""}],"checks":[{"item":"TCP","status":"정상"|"비정상"|null}],"special":"","unreadable":["칸 설명"],"confidence":"high"|"mid"|"low"}]}'
    ].join('\n');
    var user = (f ? '이 스캔본은 「' + f.name + '」 양식입니다. ' : '이 스캔본이 두 양식 중 어느 것인지 먼저 정하고(form), ') +
      '위 JSON 모양으로 모든 칸을 옮겨 주세요. 비가동 줄은 범례 코드 · 시작 · 종료 · 내역이 핵심입니다. 손글씨가 흐리면 null 로 두고 unreadable 에 적어 주세요. 사진이 여러 장이면 pages 에 장마다 하나씩 넣어 주세요.';
    return { system: sys, user: user };
  }
  var PROVIDERS = { openai: { model: 'gpt-4o-mini', url: 'https://api.openai.com/v1/chat/completions' }, anthropic: { model: 'claude-haiku-5-5', url: 'https://api.anthropic.com/v1/messages' } };
  // files: [{ mime, base64 }] — 사진(jpeg/png/webp). PDF 는 Anthropic 만 문서로 받는다. OpenAI 에 PDF 가 오면 error.
  function request(provider, key, files, pr) {
    var p = PROVIDERS[provider]; if (!p) throw new Error('모르는 제공자: ' + provider);
    if (!files || !files.length) throw new Error('읽을 파일이 없습니다.');
    var pdfs = files.filter(function (f) { return /pdf/i.test(f.mime); });
    if (provider === 'openai') {
      if (pdfs.length) throw new Error('OpenAI 로는 PDF 를 바로 보낼 수 없습니다. 사진(JPG · PNG)으로 올리거나 Anthropic 을 고르세요.');
      return { url: p.url, init: { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: p.model, temperature: 0, max_tokens: 4000, messages: [{ role: 'system', content: pr.system },
          { role: 'user', content: [{ type: 'text', text: pr.user }].concat(files.map(function (f) { return { type: 'image_url', image_url: { url: 'data:' + f.mime + ';base64,' + f.base64, detail: 'high' } }; })) }] }) } };
    }
    return { url: p.url, init: { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: p.model, max_tokens: 4000, system: pr.system, messages: [{ role: 'user', content: files.map(function (f) {
        return /pdf/i.test(f.mime) ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.base64 } } : { type: 'image', source: { type: 'base64', media_type: f.mime, data: f.base64 } };
      }).concat([{ type: 'text', text: pr.user }]) }] }) } };
  }
  function extractText(provider, json) {
    if (!json) return '';
    if (provider === 'openai') return (((json.choices || [])[0] || {}).message || {}).content || '';
    return (json.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join('');
  }
  // AI 답 → pages. JSON 만 꺼낸다. pages 가 없고 page 하나 모양이면 감싼다.
  function parseReply(text) {
    var t = String(text || ''), a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) return { pages: [], error: 'AI 답에서 JSON 을 찾지 못했습니다.' };
    var j; try { j = JSON.parse(t.slice(a, b + 1)); } catch (e) { return { pages: [], error: 'AI 답의 JSON 을 읽지 못했습니다: ' + e.message }; }
    var pages = Array.isArray(j.pages) ? j.pages : (j.form || j.downtime || j.work) ? [j] : [];
    if (!pages.length) return { pages: [], error: 'AI 답에 pages 가 없습니다.' };
    return { pages: pages.map(normalizePage), error: '' };
  }
  function normalizePage(p) {
    p = p || {};
    var form = p.form === 'weld' ? 'weld' : p.form === 'mach' ? 'mach' : (/트랙|로봇|robot|용접/i.test(clean(p.equipment)) ? 'weld' : 'mach');
    var out = { form: form, equipment: clean(p.equipment), worker: clean(p.worker), date: date(p.date) || clean(p.date), start: time(p.start) || clean(p.start), end: time(p.end) || clean(p.end),
      work: [], downtime: [], checks: [], special: clean(p.special), unreadable: Array.isArray(p.unreadable) ? p.unreadable.map(clean).filter(Boolean) : [], confidence: /^(high|mid|low)$/.test(p.confidence) ? p.confidence : '' };
    (Array.isArray(p.work) ? p.work : []).forEach(function (w, i) {
      w = w || {}; var row = { no: w.no != null ? +w.no : i + 1, start: time(w.start) || clean(w.start), end: time(w.end) || clean(w.end), model: clean(w.model), part: clean(w.part), job: clean(w.job), qty: w.qty == null || w.qty === '' ? '' : clean(w.qty), note: clean(w.note), code: code(w.code) };
      if (row.start || row.end || row.model || row.job || row.part) out.work.push(row);
    });
    (Array.isArray(p.downtime) ? p.downtime : []).forEach(function (d, i) {
      d = d || {}; var row = { no: d.no != null ? +d.no : i + 1, code: code(d.code), rawCode: clean(d.code), start: time(d.start) || clean(d.start), end: time(d.end) || clean(d.end), note: clean(d.note) };
      if (row.code || row.rawCode || row.start || row.end || row.note) out.downtime.push(row);
    });
    // 용접 양식: 생산 현황 줄에 범례가 적힌 줄은 비가동이다 — downtime 으로 옮긴다
    if (form === 'weld') out.work.filter(function (w) { return w.code; }).forEach(function (w) { out.downtime.push({ no: w.no, code: w.code, rawCode: w.code, start: w.start, end: w.end, note: w.note || w.model }); });
    out.work = out.work.filter(function (w) { return !(form === 'weld' && w.code); });
    (Array.isArray(p.checks) ? p.checks : []).forEach(function (c) { c = c || {}; if (clean(c.item)) out.checks.push({ item: clean(c.item), status: /비정상/.test(clean(c.status)) ? '비정상' : /정상/.test(clean(c.status)) ? '정상' : '' }); });
    return out;
  }

  /* ---------- 검사 — 집계로 보내기 전 사람이 봐야 할 것 ---------- */
  // settings 는 집계 엔진의 설정(코드표). 없으면 양식 범례로만 검사한다.
  function validate(page, legend) {
    legend = legend || {};
    var issues = [], f = FORMS[page.form] || FORMS.mach;
    var codes = legend[page.form === 'weld' ? 'weld' : 'mach'] || f.codes.map(function (c) { return c[0]; });
    if (!page.equipment) issues.push({ where: '머리', what: '설비명(트랙)이 비어 있습니다' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(page.date || '')) issues.push({ where: '머리', what: '작업일자를 읽지 못했습니다' + (page.date ? ': ' + page.date : '') });
    if (page.start && !/^\d{2}:\d{2}$/.test(page.start)) issues.push({ where: '머리', what: '시작시간을 시각으로 읽지 못했습니다: ' + page.start });
    if (page.end && !/^\d{2}:\d{2}$/.test(page.end)) issues.push({ where: '머리', what: '종료시간을 시각으로 읽지 못했습니다: ' + page.end });
    var spans = [];
    page.downtime.forEach(function (d) {
      var w = '비가동 ' + d.no + '줄';
      if (!d.code) issues.push({ where: w, what: '범례 코드가 없습니다' + (d.rawCode ? '(읽은 값: ' + d.rawCode + ')' : '') });
      else if (codes.indexOf(d.code) < 0) issues.push({ where: w, what: '범례 ' + d.code + ' 은 ' + f.group + ' 코드표에 없습니다' });
      var s = minutes(d.start), e = minutes(d.end);
      if (s == null) issues.push({ where: w, what: '시작 시각을 읽지 못했습니다' + (d.start ? ': ' + d.start : '') });
      if (e == null) issues.push({ where: w, what: '종료 시각을 읽지 못했습니다' + (d.end ? ': ' + d.end : '') });
      if (s != null && e != null) { if (e <= s) issues.push({ where: w, what: '종료가 시작보다 빠르거나 같습니다(' + d.start + '~' + d.end + ')' }); else { spans.forEach(function (x) { if (s < x.e && e > x.s) issues.push({ where: w, what: x.no + '줄(' + x.start + '~' + x.end + ')과 시간이 겹칩니다' }); }); spans.push({ no: d.no, s: s, e: e, start: d.start, end: d.end }); } }
    });
    page.work.forEach(function (r) {
      var w = (page.form === 'weld' ? '생산 ' : '작업 ') + r.no + '줄';
      if (r.start && minutes(r.start) == null) issues.push({ where: w, what: '시작 시각을 읽지 못했습니다: ' + r.start });
      if (r.end && minutes(r.end) == null) issues.push({ where: w, what: '종료 시각을 읽지 못했습니다: ' + r.end });
      if (minutes(r.start) != null && minutes(r.end) != null && minutes(r.end) <= minutes(r.start)) issues.push({ where: w, what: '종료가 시작보다 빠르거나 같습니다' });
    });
    page.unreadable.forEach(function (u) { issues.push({ where: 'AI', what: '읽지 못한 칸: ' + u }); });
    if (page.confidence === 'low') issues.push({ where: 'AI', what: '읽기 확신이 낮습니다 — 원본과 하나씩 대조하세요' });
    if (!page.downtime.length && !page.work.length) issues.push({ where: '전체', what: '읽은 줄이 없습니다' });
    return issues;
  }

  /* ---------- 입력 양식으로 ---------- */
  var FORM_HEAD = ['설비', '설비군', '작업자', '날짜', '근무', '구분', '코드', '시작', '종료', '소요(분)', '내용'];
  function dur(s, e) { var a = minutes(s), b = minutes(e); return a != null && b != null && b > a ? b - a : ''; }
  // codeMap: { mach: {양식 범례 이름 → 집계 코드}, weld: {...} } — 집계 엔진의 코드표 이름으로 맞춘다. 없으면 양식 글자를 그대로.
  function toFormRows(pages, codeMap) {
    var rows = [FORM_HEAD.slice()];
    (pages || []).forEach(function (p) {
      var group = p.form === 'weld' ? '용접' : '가공', legendName = {}; (FORMS[p.form] || FORMS.mach).codes.forEach(function (c) { legendName[c[0]] = c[1]; });
      var map = codeMap && codeMap[p.form] || null;
      var shift = minutes(p.end) != null && minutes(p.end) > 17 * 60 ? '주간+야간' : '주간';
      var any = false;
      p.downtime.forEach(function (d) {
        if (!d.code && !d.rawCode && !d.start && !d.end && !d.note) return;        // 빈 줄(손 입력 틀)
        var c = d.code, name = legendName[c] || '';
        if (map && name && map[name]) c = map[name];
        rows.push([p.equipment, group, p.worker, p.date, shift, '비가동', c, d.start, d.end, dur(d.start, d.end), (name ? name + (d.note ? ' — ' : '') : '') + d.note]); any = true;
      });
      p.work.forEach(function (w) {
        if (!w.start && !w.end) return;
        rows.push([p.equipment, group, p.worker, p.date, shift, '가동', '', w.start, w.end, dur(w.start, w.end), [w.model, w.part, w.job, w.qty ? '수량 ' + w.qty : '', w.note].filter(Boolean).join(' · ')]); any = true;
      });
      if (!any) rows.push([p.equipment, group, p.worker, p.date, shift, '', '', '', '', '', '(읽은 줄 없음)']);
    });
    return rows;
  }
  function blankPage(form) { return { form: form === 'weld' ? 'weld' : 'mach', equipment: '', worker: '', date: '', start: '', end: '', work: [], downtime: [{ no: 1, code: '', rawCode: '', start: '', end: '', note: '' }], checks: [], special: '', unreadable: [], confidence: '' }; }
  function summary(pages) {
    var d = 0, w = 0, mins = 0;
    (pages || []).forEach(function (p) { d += p.downtime.length; w += p.work.length; p.downtime.forEach(function (x) { mins += dur(x.start, x.end) || 0; }); });
    return { pages: (pages || []).length, downtime: d, work: w, downMinutes: mins };
  }

  /* ---------- 예제(가짜 — 실제 일보가 아닙니다) ---------- */
  function sampleReply() {
    return JSON.stringify({ pages: [
      { form: 'mach', equipment: '150NC', worker: '작업자01', date: '2026-11-03', start: '08:00', end: '17:00',
        work: [{ no: 1, start: '08:00', end: '10:00', model: 'DX-예제', part: '붐 브라켓', job: '황삭', qty: 4, note: '' }, { no: 2, start: '11:00', end: '12:00', model: 'DX-예제', part: '붐 브라켓', job: '정삭', qty: 4, note: '' }, { no: 3, start: '13:00', end: '17:00', model: 'DX-예제', part: '암 핀홀', job: '보링', qty: 6, note: '' }],
        downtime: [{ no: 1, code: 'B', start: '10:00', end: '11:00', note: '제관품 입고 대기' }], checks: [], special: '', unreadable: [], confidence: 'high' },
      { form: 'weld', equipment: '트랙 3', worker: '', date: '2026-11-03', start: '08:00', end: '20:00',
        work: [{ no: 1, start: '08:00', end: '09:30', model: 'TRACK-예제', code: '', note: '' }, { no: 2, start: '09:30', end: '10:00', model: '', code: 'D', note: '티칭 보정' }, { no: 3, start: '10:00', end: '12:00', model: 'TRACK-예제', code: '', note: '' }, { no: 4, start: '13:00', end: '13:40', model: '', code: 'C', note: '와이어 송급 불량' }, { no: 5, start: '13:40', end: '20:00', model: 'TRACK-예제', code: '', note: '' }],
        downtime: [], checks: [{ item: 'TCP(토치 원점 조정)', status: '정상' }, { item: '노즐 클리너 및 와이어커터 점검', status: '정상' }, { item: '가스 체크 및 냉각수 순환기 점검', status: '비정상' }], special: '', unreadable: ['생산 현황 6줄 Special Note'], confidence: 'mid' }
    ] });
  }

  return { FORMS: FORMS, FORM_HEAD: FORM_HEAD, PROVIDERS: PROVIDERS, time: time, minutes: minutes, date: date, code: code,
    prompt: prompt, request: request, extractText: extractText, parseReply: parseReply, normalizePage: normalizePage, validate: validate, toFormRows: toFormRows, blankPage: blankPage, summary: summary, sampleReply: sampleReply };
});
