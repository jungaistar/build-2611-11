/* 설비 비가동 집계 · 가동률 — 계산 엔진 (브라우저 + node 겸용)
 * 화면(app.js)은 판정하지 않는다. 형식 판별 · 읽기 · 시간 계산 · 검사 · 집계 · 보고서 문장은 전부 여기에 둔다.
 * 시트는 2차원 배열(AOA: 행 × 칸)로 받는다 — 엑셀이든 예제든 같은 길로 읽기 위해서다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Downtime = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 기준(설정) ---------- */
  // 사유 코드는 설비군마다 다르다(기획자 답, v1.1). 같은 글자가 군마다 뜻이 다르므로
  // 집계 키는 늘 「군:코드」(mach:B · weld:C)이고, 화면 · 보고서에는 이름(라벨)으로 보인다.
  var DEFAULT_CODES = [
    { code: 'A', label: '제관품無', desc: '제관품 입고 대기' },
    { code: 'B', label: '장비고장', desc: '설비 고장 · 수리' },
    { code: 'C', label: '지그교체', desc: '지그 · 치구 교체' },
    { code: 'D', label: '계획정지', desc: '예방보전 등 계획된 정지' },
    { code: 'E', label: '공정결원', desc: '작업자 결원' },
    { code: 'F', label: '청소', desc: '설비 · 주변 청소' },
    { code: 'G', label: '기타', desc: '그 밖의 사유' }
  ];
  var DEFAULT_WELD_CODES = [
    { code: 'A', label: '제관품대기', desc: '제관품 대기' },
    { code: 'B', label: '제관품無', desc: '제관품 없음' },
    { code: 'C', label: '장비고장', desc: '로봇 · 용접기 고장 · 수리' },
    { code: 'D', label: '티칭수정', desc: '로봇 티칭 수정' },
    { code: 'E', label: '계획정지', desc: '예방보전 등 계획된 정지' },
    { code: 'F', label: '공정결원', desc: '작업자 결원' },
    { code: 'G', label: '청소', desc: '설비 · 주변 청소' },
    { code: 'H', label: '기타', desc: '그 밖의 사유' }
  ];
  var GROUP_IDS = ['mach', 'weld'];
  var GROUP_NAME = { mach: '가공설비', weld: '용접설비' };
  var GROUP_SHORT = { mach: '가공', weld: '용접' };
  // 설비 이름으로 설비군을 알아본다. 화면에서 설비마다 바꿀 수 있다(equipGroups).
  // 용접: 로봇 · 제조사 낱말 + 기획자 용접 라인 이름 8개(v1.2, 부록 C — MAIN · BOOM · TRACK · SUB · CHASSIS · ARM · BUCKET · BLADE, 「N호기」 유무 무관)
  // 가공: NC · CNC · MCT · 밀링 · 호리젠탈 · 머시닝 · 선반(v1.2). 둘 다 있으면 「확인 필요」 — 가공으로 세되 확인할 것에 올리고 사용자가 고른다.
  var WELD_RE = /로봇|ROB|용접|WELD|ABB|KOBE|코베|야스카와|YASKAWA|FANUC|화낙|OTC|파나소닉|PANASONIC/i;
  var WELD_LINES = ['MAIN', 'BOOM', 'TRACK', 'SUB', 'CHASSIS', 'ARM', 'BUCKET', 'BLADE'];
  // 영문 낱말은 앞뒤에 다른 영문자가 없을 때만(ARM 이 WARM 에, SUB 이 SUBSTATION 에 걸리지 않게). 띄어쓰기 · 대소문자는 무시.
  var WELD_LINE_RE = new RegExp('(^|[^A-Za-z])(' + WELD_LINES.join('|') + ')(?![A-Za-z])', 'i');
  var MACH_RE = /(^|[^A-Za-z])(NC|CNC|MCT|MILLING|HORIZONTAL|MACHINING|LATHE)(?![A-Za-z])|밀링|호리젠탈|머시닝|선반/i;
  var MACH_WORDS = 'NC · CNC · MCT · 밀링 · 호리젠탈 · 머시닝 · 선반';
  var WELD_WORDS = '로봇 · 용접 · ABB · KOBE · 야스카와 · FANUC · OTC · 파나소닉 또는 ' + WELD_LINES.join(' · ') + '(N호기)';
  // 기획자 설비 목록(2026-11, 부록 C) — 가공 10대 · 용접 20대. 화면 단추 · 범례 시트에서 쓴다. 실제 설비 라인 이름일 뿐 개인정보 · 실적 값이 아니다.
  var PLANNER_EQUIP_DATE = '2026-11';
  var PLANNER_EQUIP = [
    ['호리젠탈', 'mach'], ['135 NC', 'mach'], ['150NC', 'mach'], ['130NC(1호기)', 'mach'], ['130NC(2호기)', 'mach'], ['130NC(3호기)', 'mach'], ['MCT', 'mach'], ['5호 밀링', 'mach'], ['110NC', 'mach'], ['130NC(4호기)', 'mach'],
    ['MAIN 1호기', 'weld'], ['MAIN 2호기', 'weld'], ['BOOM 1호기', 'weld'], ['BOOM 2호기', 'weld'], ['TRACK 1호기', 'weld'], ['TRACK 2호기', 'weld'], ['TRACK 3호기', 'weld'], ['TRACK 4호기', 'weld'], ['TRACK 5호기', 'weld'],
    ['SUB 1호기', 'weld'], ['SUB 2호기', 'weld'], ['SUB 3호기', 'weld'], ['CHASSIS 1호기', 'weld'], ['CHASSIS 2호기', 'weld'], ['ARM 1호기', 'weld'], ['ARM 2호기', 'weld'], ['BUCKET 1호기', 'weld'], ['BUCKET 2호기', 'weld'], ['BLADE 1호기', 'weld'], ['BLADE 2호기', 'weld']
  ].map(function (p) { return { name: p[0], group: p[1] }; });
  var DEFAULTS = {
    codes: DEFAULT_CODES,       // 가공설비 코드표(옛 이름 그대로)
    weldCodes: DEFAULT_WELD_CODES, // 용접설비 코드표
    equipGroups: {},            // 설비 · 작업자 이름 → mach | weld (자동 판정을 바꾼 것만)
    start: '08:00',       // 근무 시작
    dayEnd: '17:00',      // 주간 종료
    nightEnd: '20:00',    // 주간+야간 종료
    rests: '12:00-13:00, 17:00-17:30', // 정해진 휴게(인정시간에서 뺀다)
    breakMin: 20,         // 오전 · 오후 쉬는 시간(각 10분) — 계획 시간에서 뺀다. 8to5 = 540 − 60 − 20 = 460분
    basis: 'recorded',    // recorded: 기록된 계획 시간 우선 · shift: 근무 형태 기준(인정시간 − 쉬는 시간)
    separateRest: true,   // 가동 · 비가동 기록이 휴게 구간과 겹치면 그만큼 뺀다
    target: 85            // 목표 가동률(%)
  };
  var UNKNOWN = '?';

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function cleanCodes(list, def, name, errors) {
    var out = (Array.isArray(list) ? list : def).map(function (c) {
      return { code: String(c.code || '').trim().toUpperCase(), label: String(c.label || '').trim(), desc: String(c.desc || '').trim() };
    }).filter(function (c) { return c.code; });
    var seen = {};
    out = out.filter(function (c) { if (seen[c.code]) { errors.push(name + ' 사유 코드 ' + c.code + ' 가 두 번 있습니다 — 첫 줄만 씁니다'); return false; } seen[c.code] = 1; return true; });
    if (!out.length) { errors.push(name + ' 사유 코드가 비어 기본값을 씁니다'); out = clone(def); }
    return out;
  }
  function normSettings(s) {
    s = s || {};
    var o = clone(DEFAULTS), errors = [];
    Object.keys(s).forEach(function (k) { if (s[k] !== undefined && s[k] !== null) o[k] = s[k]; });
    o.codes = cleanCodes(o.codes, DEFAULT_CODES, '가공설비', errors);
    o.weldCodes = cleanCodes(o.weldCodes, DEFAULT_WELD_CODES, '용접설비', errors);
    o.groups = { mach: { id: 'mach', name: GROUP_NAME.mach, short: GROUP_SHORT.mach, codes: o.codes }, weld: { id: 'weld', name: GROUP_NAME.weld, short: GROUP_SHORT.weld, codes: o.weldCodes } };
    var eg = {}; Object.keys(o.equipGroups || {}).forEach(function (k) { if (GROUP_IDS.indexOf(o.equipGroups[k]) >= 0) eg[k] = o.equipGroups[k]; });
    o.equipGroups = eg;
    function tm(k) { var t = parseTime(o[k]); if (!t.ok) { errors.push(k + ' 시각을 읽지 못해 기본값을 씁니다'); t = parseTime(DEFAULTS[k]); } return t.min; }
    o.startMin = tm('start'); o.dayEndMin = tm('dayEnd'); o.nightEndMin = tm('nightEnd');
    if (o.dayEndMin <= o.startMin) { errors.push('주간 종료가 시작보다 빠릅니다 — 기본값을 씁니다'); o.startMin = 480; o.dayEndMin = 1020; }
    if (o.nightEndMin < o.dayEndMin) { errors.push('야간 종료가 주간 종료보다 빠릅니다 — 주간 종료로 맞춥니다'); o.nightEndMin = o.dayEndMin; }
    var rr = parseRests(o.rests);
    rr.errors.forEach(function (e) { errors.push(e); });
    o.restList = rr.list;
    o.breakMin = Math.max(0, Number(o.breakMin) || 0);
    o.target = Math.min(100, Math.max(0, Number(o.target) || 0));
    o.basis = o.basis === 'shift' ? 'shift' : 'recorded';
    o.separateRest = o.separateRest !== false;
    o.errors = errors;
    return o;
  }
  // 이름 판정: { group, sure, why }. 용접 낱말만 → weld, 가공 낱말만 → mach, 둘 다 → sure:false(확인 필요, 가공으로 셈), 둘 다 없음 → mach(그 밖).
  function judgeName(name) {
    var t = String(name || '').replace(/\s+/g, '');
    var w = WELD_RE.test(t) || WELD_LINE_RE.test(t), m = MACH_RE.test(t);
    if (w && m) return { group: 'mach', sure: false, why: '가공 · 용접 낱말이 둘 다 있음' };
    if (w) return { group: 'weld', sure: true, why: '용접 낱말' };
    if (m) return { group: 'mach', sure: true, why: '가공 낱말' };
    return { group: 'mach', sure: true, why: '해당 낱말 없음 → 가공' };
  }
  // 설비군: 화면에서 고친 값 → 이름 자동 판정 → 가공
  function autoGroup(name) { return judgeName(name).group; }
  function groupOf(name, S) { return (S && S.equipGroups && S.equipGroups[name]) || autoGroup(name); }
  // 화면 · 확인할 것용: 어디서 정해졌는지까지. src: setting(기준 설정) · name(이름) · ambiguous(확인 필요)
  function judgeGroup(name, S) {
    if (S && S.equipGroups && S.equipGroups[name]) return { group: S.equipGroups[name], src: 'setting', sure: true, why: '기준 설정에서 고름' };
    var j = judgeName(name);
    return { group: j.group, src: j.sure ? 'name' : 'ambiguous', sure: j.sure, why: j.why };
  }
  // 기획자 설비 목록을 설비군 표에 더한다 — 이미 있는 이름은 덮어쓰지 않는다. 더한 수를 함께 돌려준다.
  function withPlannerEquip(equipGroups) {
    var out = {}, added = 0;
    Object.keys(equipGroups || {}).forEach(function (k) { out[k] = equipGroups[k]; });
    PLANNER_EQUIP.forEach(function (e) { if (!out[e.name]) { out[e.name] = e.group; added++; } });
    return { equipGroups: out, added: added, total: PLANNER_EQUIP.length };
  }
  function groupFromText(v) {
    var t = String(v == null ? '' : v).replace(/\s+/g, '');
    if (!t) return null;
    if (/용접|weld|로봇/i.test(t)) return 'weld';
    if (/가공|mach|NC|MCT/i.test(t)) return 'mach';
    return null;
  }
  function codesOf(group, S) { return S && S.groups ? S.groups[group] ? S.groups[group].codes : S.groups.mach.codes : DEFAULT_CODES; }
  function keyOf(group, code) { return group + ':' + code; }
  function splitKey(key) { var i = String(key).indexOf(':'); return i < 0 ? { group: 'mach', code: String(key) } : { group: key.slice(0, i), code: key.slice(i + 1) }; }
  // 키 → 이름(라벨). 「weld:C」 → 장비고장
  function keyLabel(key, S) {
    var k = splitKey(key);
    if (k.code === UNKNOWN) return '미분류';
    var c = codesOf(k.group, S).filter(function (x) { return x.code === k.code; })[0];
    return c ? c.label : k.code;
  }
  // 키 → 어느 군 코드인지. 「weld:C」 → 용접 C
  function keyName(key) { var k = splitKey(key); return (GROUP_SHORT[k.group] || k.group) + ' ' + k.code; }
  function codeLabel(key, S) { return keyLabel(key, S); }
  // 「12:00-13:00, 17:00-17:30」 → [[720,780],[1020,1050]]
  function parseRests(text) {
    var list = [], errors = [];
    String(text || '').split(/[,\n;]+/).forEach(function (seg) {
      seg = seg.trim(); if (!seg) return;
      var m = seg.match(/^(.+?)\s*[~∼〜～-]\s*(.+)$/);
      var a = m && parseTime(m[1]), b = m && parseTime(m[2]);
      if (!a || !a.ok || !b || !b.ok || b.min <= a.min) { errors.push('휴게 구간 「' + seg + '」 을 읽지 못했습니다'); return; }
      list.push([a.min, b.min]);
    });
    list.sort(function (x, y) { return x[0] - y[0]; });
    return { list: list, errors: errors };
  }

  /* ---------- 근무 형태 ---------- */
  function shiftOf(v) {
    var s = String(v == null ? '' : v).replace(/\s+/g, '');
    if (!s) return null;
    if (/야간|연장|잔업|night/i.test(s)) return 'night';
    if (/주간|day/i.test(s)) return 'day';
    return null;
  }
  function overlapMin(a1, a2, b1, b2) { return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1)); }
  // 근무 형태 하나의 시간 틀: 인정시간 = 시작~종료 − 휴게, 계획 = 인정시간 − 휴식(오전 · 오후)
  function shiftInfo(shift, S) {
    var start = S.startMin, end = shift === 'night' ? S.nightEndMin : S.dayEndMin;
    var rests = S.restList.map(function (r) { return [Math.max(r[0], start), Math.min(r[1], end)]; }).filter(function (r) { return r[1] > r[0]; });
    var restMin = rests.reduce(function (s, r) { return s + r[1] - r[0]; }, 0);
    var recognized = end - start - restMin;
    return { shift: shift, start: start, end: end, rests: rests, restMin: restMin, recognized: recognized, plan: Math.max(0, recognized - S.breakMin) };
  }
  function shiftName(sh) { return sh === 'night' ? '주간+야간' : '주간'; }

  /* ---------- 값 읽기 ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtTime(min) { if (min == null || !isFinite(min)) return ''; min = Math.round(min); var d = min >= 1440 && min % 1440 !== 0 ? '+1 ' : ''; var m = min >= 1440 && min % 1440 !== 0 ? min - 1440 : min; return d + pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function numTime(n) {
    if (!isFinite(n) || n < 0) return { ok: false, why: '시간이 아님' };
    if (n <= 1) return { ok: true, min: Math.round(n * 1440) };          // 엑셀 시간값(하루의 분수)
    if (n > 20000) return { ok: true, min: Math.round((n - Math.floor(n)) * 1440) }; // 날짜+시각
    if (Number.isInteger(n) && n >= 100 && n <= 2400 && n % 100 < 60) return { ok: true, min: Math.floor(n / 100) * 60 + n % 100 }; // 0830
    if (n <= 24) return { ok: true, min: Math.round(n * 60) };           // 시 단위 숫자 8.5 = 8:30
    return { ok: false, why: '시간 범위 밖' };
  }
  function parseTime(v) {
    if (v == null || v === '') return { ok: false, why: '빈 칸' };
    if (v instanceof Date) return isNaN(v.getTime()) ? { ok: false, why: '시간이 아님' } : { ok: true, min: v.getHours() * 60 + v.getMinutes() };
    if (typeof v === 'number') return numTime(v);
    var s = String(v).trim();
    if (!s) return { ok: false, why: '빈 칸' };
    var pm = /오후|pm/i.test(s), am = /오전|am/i.test(s);
    s = s.replace(/오전|오후|am|pm/ig, '').trim();
    var m = s.match(/^(\d{1,2})\s*[:：]\s*(\d{2})(?:\s*[:：]\s*\d{2})?$/) || s.match(/^(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?$/);
    var h, mi;
    if (m) { h = +m[1]; mi = +(m[2] || 0); }
    else if (/^\d{3,4}$/.test(s)) { h = Math.floor(+s / 100); mi = +s % 100; }
    else if (/^\d+(\.\d+)?$/.test(s)) return numTime(+s);
    else return { ok: false, why: '시간이 아님' };
    if (pm && h < 12) h += 12;
    if (am && h === 12) h = 0;
    if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return { ok: false, why: '시간 범위 밖' };
    return { ok: true, min: h * 60 + mi };
  }
  function ymd(y, m, d) {
    y = +y; m = +m; d = +d;
    if (y < 100) y += 2000;
    var t = new Date(Date.UTC(y, m - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
    return y + '-' + pad(m) + '-' + pad(d);
  }
  function serialToISO(n) { return new Date(Math.round((Math.floor(n) - 25569) * 86400000)).toISOString().slice(0, 10); }
  function isoToSerial(iso) { var p = iso.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000 + 25569; }
  function isSerial(v) { return typeof v === 'number' && v >= 30000 && v < 80000; }
  function parseDate(v, defYear) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isSerial(v) ? serialToISO(v) : null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : ymd(v.getFullYear(), v.getMonth() + 1, v.getDate());
    var s = String(v).trim();
    var m = s.match(/(\d{4})\s*[-.\/년]\s*(\d{1,2})\s*[-.\/월]\s*(\d{1,2})/);
    if (m) return ymd(m[1], m[2], m[3]);
    m = s.match(/^(\d{1,2})\s*[-.\/월]\s*(\d{1,2})\s*일?\s*(?:\(.\))?\.?$/);
    if (m) return defYear ? ymd(defYear, m[1], m[2]) : null;
    if (/^\d{5}(\.\d+)?$/.test(s)) return isSerial(+s) ? serialToISO(+s) : null;
    return null;
  }
  function dayDiff(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
  function weekday(iso) { return '일월화수목금토'.charAt(new Date(iso + 'T00:00:00Z').getUTCDay()); }
  // 「10.01 11:00 ~ 11:30」 「10.01 23:00 ~ 10.02 01:00」 「11:00~11:30, 13:00~13:20」
  var DATE_PART = '(\\d{4}[.\\/-]\\d{1,2}[.\\/-]\\d{1,2}|\\d{1,2}[.\\/-]\\d{1,2})';
  var RANGE_RE = new RegExp('(?:' + DATE_PART + '\\s+)?(\\d{1,2}:\\d{2})\\s*[~∼〜～-]\\s*(?:' + DATE_PART + '\\s+)?(\\d{1,2}:\\d{2})', 'g');
  function parseRange(text, defYear) {
    var s = String(text == null ? '' : text), segs = [], last = null, m;
    RANGE_RE.lastIndex = 0;
    while ((m = RANGE_RE.exec(s))) {
      var sd = m[1] ? parseDate(m[1], defYear) : last;
      var ed = m[3] ? parseDate(m[3], sd ? +sd.slice(0, 4) : defYear) : sd;
      var st = parseTime(m[2]).min, et = parseTime(m[4]).min;
      var min = et - st + (sd && ed ? dayDiff(sd, ed) * 1440 : 0);
      if (!m[3] && min < 0) min += 1440; // 날짜 없이 끝이 더 이르면 자정을 넘긴 것
      segs.push({ startDate: sd, start: st, endDate: ed, end: et, min: min });
      last = ed || sd;
    }
    return { ok: segs.length > 0, segments: segs, minutes: segs.reduce(function (a, g) { return a + g.min; }, 0) };
  }
  function num(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).replace(/[,\s원]/g, '').replace(/%$/, '');
    return /^-?\d+(\.\d+)?$/.test(s) ? +s : null;
  }

  /* ---------- 코드 · 구분 ---------- */
  function hz(s) { return String(s == null ? '' : s).replace(/\s+/g, '').replace(/無/g, '무').toLowerCase(); }
  // 「a」 「B」 「B.장비고장」 「장비고장」 → 코드. 표에 없으면 null, 빈 칸이면 ''.
  function normCode(v, codes) {
    codes = codes || DEFAULT_CODES;
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    var up = s.toUpperCase();
    var byLen = codes.slice().sort(function (a, b) { return b.code.length - a.code.length; });
    for (var i = 0; i < byLen.length; i++) {
      var C = byLen[i].code.toUpperCase();
      if (up === C) return byLen[i].code;
      if (up.indexOf(C) === 0 && /[\s.\-:)·_,(]/.test(up.charAt(C.length))) return byLen[i].code;
    }
    var h = hz(s);
    for (var j = 0; j < codes.length; j++) { var lab = hz(codes[j].label); if (lab && (h === lab || h.indexOf(lab) >= 0)) return codes[j].code; }
    return null;
  }
  // 구분 글자 → run · down · rest. 비우면 코드가 있으면 비가동, 없으면 가동.
  function normClass(v, code) {
    var s = String(v == null ? '' : v).replace(/\s+/g, '');
    if (!s) return code ? 'down' : 'run';
    if (/비가동|정지|대기|고장|비작업|down/i.test(s)) return 'down';
    if (/휴게|휴식|점심|식사|중식|석식|rest|break/i.test(s)) return 'rest';
    if (/가동|작업|생산|정상|run/i.test(s)) return 'run';
    return null;
  }
  // 「비가동 내역」 글자에서 설비:코드 묶음을 뽑는다. 「MCT: A 135NC: A」 → [{MCT,A},{135NC,A}]
  // codes 는 코드표 배열, 또는 설비 이름 → 코드표 함수(설비군마다 코드표가 다르다)
  function extractCodes(text, codes) {
    var s = String(text == null ? '' : text).trim(), pairs = [], unknown = [], seen = {};
    if (!s) return { pairs: pairs, unknown: unknown };
    var re = /([^\s:：,;\/]+)\s*[:：]\s*/g, marks = [], m;
    while ((m = re.exec(s))) marks.push({ name: m[1], at: m.index, after: re.lastIndex });
    function take(body, equip) {
      body.split(/[\s,，\/·+&]+/).filter(Boolean).forEach(function (t) {
        var c = normCode(t, typeof codes === 'function' ? codes(equip) : codes);
        if (!c) { unknown.push(t); return; }
        var k = equip + '|' + c; if (seen[k]) return; seen[k] = 1;
        pairs.push({ equip: equip, code: c });
      });
    }
    if (!marks.length) take(s, '');
    else {
      take(s.slice(0, marks[0].at), '');
      marks.forEach(function (mk, i) { take(s.slice(mk.after, i + 1 < marks.length ? marks[i + 1].at : s.length), mk.name); });
    }
    return { pairs: pairs, unknown: unknown };
  }

  /* ---------- 형식 판별 ---------- */
  var TYPES = {
    form: '비가동 일보(입력 양식)',
    diary: '작업자별 작업일보',
    daily: '일일 집계',
    util: '설비 가동률',
    repair: '수리 · 비가동 이력',
    skip: '읽지 않음'
  };
  // 머리글 낱말: 공백과 괄호 속 단위를 지운다. 「소요(분)」 → 「소요」, 「구분(설비)」 → 「구분」
  function nh(v) { return String(v == null ? '' : v).replace(/\s+/g, '').replace(/[(（][^)）]*[)）]/g, ''); }
  var COLS = {
    equip: /^(설비|설비명|장비|장비명|호기)$/,
    group: /^(설비군|설비구분|군)$/,
    worker: /^(작업자|작업자명|성명|이름)$/,
    date: /^(날짜|일자|작업일|작업일자)$/,
    shift: /^(근무|근무형태|작업계획)$/,
    cls: /^구분$/,
    code: /^(코드|사유코드|비가동코드)$/,
    item: /^항목$/,
    start: /^(시작|시작시간|시작시각)$/,
    end: /^(종료|종료시간|종료시각)$/,
    min: /^(소요|소요시간|소요분)$/,
    note: /내용|사유|비고/,
    no: /^(번호|no|NO|No)$/
  };
  function headerMap(row, keys) {
    var map = {};
    row.forEach(function (c, i) {
      var h = nh(c); if (!h) return;
      keys.forEach(function (k) { if (map[k] == null && COLS[k].test(h)) map[k] = i; });
    });
    return map;
  }
  var UTIL_LABELS = { '작업계획': 'shift', '계획시간': 'plan', '주간': 'day', '야간': 'night', '가동시간': 'run', '비가동시간': 'down', '가동률': 'rate', '비가동내역': 'note' };
  function detectSheet(aoa, name) {
    var best = { type: 'skip', score: 0, why: '알아볼 머리글이 없습니다' };
    function cand(type, score, why) { if (score > best.score) best = { type: type, score: score, why: why }; }
    var utilRows = 0, dateHeads = 0;
    (aoa || []).slice(0, 60).forEach(function (row) {
      row = row || [];
      var hs = row.map(nh), has = function (re) { return hs.some(function (h) { return re.test(h); }); };
      if (has(/^(일자|날짜)$/) && has(COLS.worker) && has(/^인정시간/) && has(/^비가동$/)) cand('daily', 6, '일자 · 작업자명 · 인정시간 · 비가동 머리글');
      if (has(/^고장부위$/) || (has(/^시작일자$/) && has(/^완료일자$/))) cand('repair', 5, '고장부위 · 시작일자 · 완료일자 머리글');
      if (has(COLS.equip) && has(COLS.date) && has(COLS.start) && has(COLS.end)) cand('form', 4, '설비 · 날짜 · 시작 · 종료 머리글');
      if (has(COLS.cls) && has(COLS.start) && has(COLS.end) && !has(COLS.equip)) cand('diary', has(COLS.min) ? 3 : 2, '구분 · 시작시간 · 종료시간 머리글(날짜는 블록 위 줄)');
      if (UTIL_LABELS[nh(row[0])]) utilRows++;
      if (row.filter(isSerial).length >= 5) dateHeads++;
    });
    if (utilRows >= 3) cand('util', 4 + (dateHeads ? 1 : 0), '계획 시간 · 가동 시간 · 가동률 줄' + (dateHeads ? ' + 날짜 머리줄' : ''));
    best.label = TYPES[best.type];
    best.sheet = name || '';
    return best;
  }

  /* ---------- 시트 읽기 ---------- */
  function blank(row) { return !row || row.every(function (c) { return c == null || String(c).trim() === ''; }); }
  function cell(row, i) { return i == null ? '' : (row[i] == null ? '' : row[i]); }
  function yearHint(aoa) {
    for (var i = 0; i < Math.min(aoa.length, 200); i++) {
      var row = aoa[i] || [];
      for (var j = 0; j < row.length; j++) { var d = isSerial(row[j]) ? serialToISO(row[j]) : (typeof row[j] === 'string' ? parseDate(row[j]) : null); if (d) return +d.slice(0, 4); }
    }
    return new Date().getFullYear();
  }
  function emptyInput() { return { records: [], days: [], repairs: [], issues: [] }; }
  function issue(list, level, where, text) { list.push({ level: level, where: where, text: text }); }

  function makeRecord(o, ctx, S, out) {
    var where = ctx.label + ' ' + o.row + '행';
    var who = o.equip || o.worker || '';
    var date = parseDate(o.dateV, ctx.year);
    if (!date) { issue(out.issues, 'warn', where, '날짜를 읽지 못해 뺐습니다(' + o.dateV + ')'); return null; }
    if (!who) { issue(out.issues, 'warn', where, '설비 · 작업자가 비어 뺐습니다'); return null; }
    var st = parseTime(o.startV), et = parseTime(o.endV);
    if (!st.ok || !et.ok) { issue(out.issues, 'warn', where, '시작 · 종료 시간을 읽지 못해 뺐습니다(' + o.startV + ' ~ ' + o.endV + ')'); return null; }
    // 설비군: 양식의 「설비군」 칸 → 화면에서 고친 값 → 이름 자동 판정. 코드는 그 군의 코드표로 읽는다.
    var groupSrc = groupFromText(o.groupV) ? 'form' : 'auto';
    var group = groupFromText(o.groupV) || groupOf(who, S);
    var code = normCode(o.codeV, codesOf(group, S)), cls = normClass(o.clsV, code);
    if (cls === null) { issue(out.issues, 'warn', where, '구분 「' + o.clsV + '」 을 알 수 없어 뺐습니다(가동 · 비가동 · 휴게)'); return null; }
    if (cls === 'down') {
      if (code === null) { issue(out.issues, 'warn', where, '코드 「' + o.codeV + '」 가 ' + GROUP_NAME[group] + ' 사유 코드 표에 없습니다 — 미분류로 셉니다'); code = UNKNOWN; }
      else if (code === '') { issue(out.issues, 'warn', where, '비가동인데 코드가 비었습니다 — 미분류로 셉니다'); code = UNKNOWN; }
      code = keyOf(group, code);
    } else code = '';
    var start = st.min, end = et.min;
    if (end < start) { end += 1440; issue(out.issues, 'info', where, '종료가 시작보다 일러 다음 날로 봤습니다(' + fmtTime(st.min) + ' ~ ' + fmtTime(et.min) + ')'); }
    var minRec = num(o.minV);
    var r = {
      kind: o.equip ? 'equip' : 'worker', subject: who, group: group, groupSrc: groupSrc, equip: o.equip || '', worker: o.worker || '', date: date,
      shift: o.shiftV == null ? '' : String(o.shiftV), cls: cls, code: code, item: String(o.item == null ? '' : o.item), note: String(o.note == null ? '' : o.note),
      start: start, end: end, minRec: minRec, src: where
    };
    out.records.push(r);
    return r;
  }

  // 입력 양식: 설비 | 작업자 | 날짜 | 근무 | 구분 | 코드 | 시작 | 종료 | 소요(분) | 내용 — 설비 · 날짜가 비면 윗줄을 잇는다
  function parseForm(aoa, ctx, S, out) {
    var cols = null, lastEquip = '', lastWorker = '', lastDate = '', lastGroup = '';
    aoa.forEach(function (row, i) {
      row = row || [];
      var hm = headerMap(row, ['equip', 'group', 'worker', 'date', 'shift', 'cls', 'code', 'item', 'start', 'end', 'min', 'note']);
      if (hm.equip != null && hm.date != null && hm.start != null && hm.end != null) { cols = hm; return; }
      if (!cols || blank(row)) return;
      var st = cell(row, cols.start), en = cell(row, cols.end);
      if (st === '' && en === '' && cell(row, cols.code) === '' && cell(row, cols.cls) === '') return;
      var eq = String(cell(row, cols.equip)).trim(), wk = String(cell(row, cols.worker)).trim(), dt = cell(row, cols.date);
      var gv = cell(row, cols.group);
      if (eq) { lastEquip = eq; lastGroup = gv; } else if (!wk) { eq = lastEquip; if (gv === '') gv = lastGroup; }
      if (wk) lastWorker = wk;
      if (dt !== '') lastDate = dt; else dt = lastDate;
      makeRecord({ row: i + 1, equip: eq, groupV: gv, worker: eq ? wk : (wk || lastWorker), dateV: dt, shiftV: cell(row, cols.shift), clsV: cell(row, cols.cls),
        codeV: cell(row, cols.code), startV: st, endV: en, minV: cell(row, cols.min), item: cell(row, cols.item), note: cell(row, cols.note) }, ctx, S, out);
    });
  }

  // 작업자별 작업일보: 날짜 줄 → 머리글(번호 | 구분 | 코드 | 항목 | 시작시간 | 종료시간 | 소요(분) | 작업내용/비가동 사유) → 내용 줄
  function parseDiary(aoa, ctx, S, out) {
    var cols = null, date = null, worker = ctx.sheet || '작업자';
    aoa.forEach(function (row, i) {
      row = row || [];
      if (blank(row)) return;
      var hm = headerMap(row, ['no', 'cls', 'code', 'item', 'start', 'end', 'min', 'note']);
      if (hm.cls != null && hm.start != null && hm.end != null) { cols = hm; return; }
      for (var j = 0; j + 1 < row.length; j++) {
        if (COLS.worker.test(nh(row[j])) && String(row[j + 1] == null ? '' : row[j + 1]).trim() && !isSerial(row[j + 1])) worker = String(row[j + 1]).trim();
      }
      var hasTime = cols && cell(row, cols.start) !== '' && parseTime(cell(row, cols.start)).ok && !isSerial(cell(row, cols.start));
      if (!hasTime) {
        for (var k = 0; k < row.length; k++) {
          var d = isSerial(row[k]) ? serialToISO(row[k]) : (typeof row[k] === 'string' && /\d{4}\s*[-.\/년]|월\s*\d{1,2}\s*일/.test(row[k]) ? parseDate(row[k], ctx.year) : null);
          if (d) { date = d; return; }
        }
      }
      if (!cols) return;
      var clsV = cell(row, cols.cls);
      if (/합계|소계|^계$/.test(nh(clsV)) || /합계|소계/.test(nh(cell(row, cols.no)))) return;
      if (cell(row, cols.start) === '' && cell(row, cols.end) === '' && clsV === '') return;
      if (!date) { issue(out.issues, 'warn', ctx.label + ' ' + (i + 1) + '행', '날짜 줄을 찾지 못해 뺐습니다'); return; }
      makeRecord({ row: i + 1, equip: '', worker: worker, dateV: date, shiftV: '', clsV: clsV, codeV: cell(row, cols.code),
        startV: cell(row, cols.start), endV: cell(row, cols.end), minV: cell(row, cols.min), item: cell(row, cols.item), note: cell(row, cols.note) }, ctx, S, out);
    });
  }

  // 일일 집계: 일자 | 작업자명 | 시작 | 종료 | 인정시간(h) | 가동(분) | 휴게(분) | 비가동(분) | A(분) … G(분)
  function parseDaily(aoa, ctx, S, out) {
    var cols = null, codeCols = {};
    aoa.forEach(function (row, i) {
      row = row || [];
      var hs = row.map(nh);
      var at = function (re) { for (var j = 0; j < hs.length; j++) if (re.test(hs[j])) return j; return null; };
      if (at(/^(일자|날짜)$/) != null && at(/^인정시간/) != null && at(/^비가동$/) != null) {
        cols = { date: at(/^(일자|날짜)$/), worker: at(COLS.worker), start: at(COLS.start), end: at(COLS.end), rec: at(/^인정시간/), run: at(/^가동$/), rest: at(/^휴게$/), down: at(/^비가동$/) };
        codeCols = {};
        hs.forEach(function (h, j) { if (/^[A-Za-z]{1,3}$/.test(h)) codeCols[h.toUpperCase()] = j; }); // 글자 뜻은 줄마다 작업자의 설비군으로
        return;
      }
      if (!cols || blank(row)) return;
      var where = ctx.label + ' ' + (i + 1) + '행';
      var date = parseDate(cell(row, cols.date), ctx.year), who = String(cell(row, cols.worker)).trim();
      if (!date || !who) { if (!/합계|소계|계/.test(hs.join(''))) issue(out.issues, 'warn', where, '일자 · 작업자명을 읽지 못해 뺐습니다'); return; }
      var rec = num(cell(row, cols.rec)), et = parseTime(cell(row, cols.end));
      var codes = {}, any = false, grp = groupOf(who, S), valid = codesOf(grp, S).map(function (c) { return c.code; });
      Object.keys(codeCols).forEach(function (c) {
        var v = num(cell(row, codeCols[c])); if (!v) return;
        var key = keyOf(grp, valid.indexOf(c) >= 0 ? c : UNKNOWN);
        if (valid.indexOf(c) < 0) issue(out.issues, 'warn', where, c + '(분) 칸은 ' + GROUP_NAME[grp] + ' 사유 코드 표에 없습니다 — 미분류로 셉니다');
        codes[key] = (codes[key] || 0) + v; any = true;
      });
      var down = num(cell(row, cols.down));
      if (any && down != null) {
        var sum = Object.keys(codes).reduce(function (s, c) { return s + codes[c]; }, 0);
        if (Math.abs(sum - down) > 1) issue(out.issues, 'warn', where, '코드별 비가동 합 ' + sum + '분 ↔ 비가동 ' + down + '분이 다릅니다');
      }
      out.days.push({ kind: 'worker', subject: who, group: grp, date: date, plan: rec == null ? null : (rec <= 24 ? rec * 60 : rec), planLabel: '인정시간',
        shiftText: et.ok && et.min > S.dayEndMin + 30 ? '주간+야간' : '', run: num(cell(row, cols.run)), rest: num(cell(row, cols.rest)), down: down,
        codes: any ? codes : null, pairs: null, rateRec: null, src: where });
    });
  }

  // 설비 가동률: 블록마다 「설비명 | 날짜1..날짜31 | 총 가동률」 머리줄 + 작업 계획 · 계획 시간 · 주간 · 야간 · 가동 시간 · 비가동 시간 · 가동률 · 비가동 내역 줄
  function parseUtil(aoa, ctx, S, out) {
    var block = null, title = '', nBlock = 0;
    function flush() {
      if (!block) return;
      block.dates.forEach(function (d, j) {
        if (!d) return;
        var g = function (k) { return block.rows[k] ? block.rows[k][j] : ''; };
        var plan = num(g('plan')), run = num(g('run')), down = num(g('down')), day = num(g('day')), night = num(g('night'));
        var note = String(g('note') == null ? '' : g('note')).trim(), shiftText = String(g('shift') == null ? '' : g('shift')).trim();
        if (plan == null && day != null) plan = day + (night || 0);
        if (!plan && !run && !down && !note && !shiftText) return; // 근무 없는 날
        var bg = groupOf(block.name, S);
        var ex = extractCodes(note, function (eq) { return codesOf(eq ? groupOf(eq, S) : bg, S); });
        ex.pairs.forEach(function (p) { p.key = keyOf(p.equip ? groupOf(p.equip, S) : bg, p.code); });
        if (ex.unknown.length) issue(out.issues, 'warn', block.label + ' ' + d, '비가동 내역 「' + ex.unknown.join(' ') + '」 은 사유 코드 표에 없습니다');
        var rate = num(g('rate'));
        if (rate != null && rate > 1.5) rate = rate / 100;
        out.days.push({ kind: 'equip', subject: block.name, group: bg, date: d, plan: plan, planLabel: '계획 시간', shiftText: shiftText || (night ? '주간+야간' : ''),
          run: run, rest: null, down: down, codes: null, pairs: ex.pairs, note: note, rateRec: rate, src: block.label + ' ' + d });
      });
      block = null;
    }
    aoa.forEach(function (row, i) {
      row = row || [];
      var serials = row.filter(isSerial).length;
      if (serials >= 5) {
        flush(); nBlock++;
        var first = String(row[0] == null ? '' : row[0]).trim();
        var name = first && !/^(설비명?|구분|장비명?)$/.test(nh(first)) ? first : (title || '설비군 ' + nBlock);
        block = { name: name, label: ctx.label + ' ' + (i + 1) + '행(' + name + ')', dates: row.map(function (c) { return isSerial(c) ? serialToISO(c) : null; }), rows: {} };
        return;
      }
      var key = UTIL_LABELS[nh(row[0])];
      if (block && key) { block.rows[key] = row; return; }
      if (!block || blank(row)) {
        var t = String(row[0] == null ? '' : row[0]).trim();
        if (t && !/^※/.test(t) && row.slice(1).every(function (c) { return c == null || c === ''; })) title = t;
        if (blank(row)) flush();
      }
    });
    flush();
  }

  // 수리 · 비가동 이력
  function parseRepair(aoa, ctx, S, out) {
    var cols = null;
    aoa.forEach(function (row, i) {
      row = row || [];
      var hs = row.map(nh);
      var at = function (re) { for (var j = 0; j < hs.length; j++) if (re.test(hs[j])) return j; return null; };
      if (at(/^고장부위$/) != null || (at(/^시작일자$/) != null && at(/^완료일자$/) != null)) {
        var eqc = null;
        row.forEach(function (c, j) { if (eqc == null && /설비|장비|호기/.test(String(c))) eqc = j; });
        cols = { no: at(/^(no|번호)$/i), sd: at(/^시작일자$/), ed: at(/^완료일자$/), equip: eqc != null ? eqc : at(/^구분$/), part: at(/^고장부위$/),
          range: at(/^비가동시간$/), total: at(/^비가동총시간$/), repair: at(/^수리/), support: at(/지원/), cause: at(/현상|원인/), action: at(/조치/),
          vendor: at(/^거래처$/), cost: at(/^비용/), status: at(/진행|현황/), note: at(/^비고$/) };
        return;
      }
      if (!cols || blank(row)) return;
      var where = ctx.label + ' ' + (i + 1) + '행';
      var sd = parseDate(cell(row, cols.sd), ctx.year), ed = parseDate(cell(row, cols.ed), ctx.year);
      var rangeText = String(cell(row, cols.range)).trim();
      var pr = parseRange(rangeText, sd ? +sd.slice(0, 4) : ctx.year);
      var total = num(cell(row, cols.total)), rep = num(cell(row, cols.repair));
      var equip = String(cell(row, cols.equip)).trim();
      if (!equip && !sd && !rangeText) return;
      var hr = pr.ok ? pr.minutes / 60 : null;
      if (rangeText && !pr.ok) issue(out.issues, 'warn', where, '비가동 시간 「' + rangeText + '」 을 읽지 못했습니다(예: 10.01 11:00 ~ 11:30)');
      if (hr != null && total != null && Math.abs(hr - total) > 0.05) issue(out.issues, 'warn', where, '비가동 총시간 기록 ' + round(total, 2) + 'h ↔ 구간으로 계산 ' + round(hr, 2) + 'h');
      if (rep != null && (total != null ? total : hr) != null && rep > (total != null ? total : hr) + 0.01) issue(out.issues, 'info', where, '수리 소요시간이 비가동 총시간보다 깁니다');
      out.repairs.push({ no: cell(row, cols.no), startDate: sd || (pr.segments[0] && pr.segments[0].startDate) || '', endDate: ed || '', equip: equip,
        part: String(cell(row, cols.part)), range: rangeText, rangeHr: hr, totalHr: total, downHr: hr != null ? hr : total, repairHr: rep,
        support: String(cell(row, cols.support)), cause: String(cell(row, cols.cause)), action: String(cell(row, cols.action)), vendor: String(cell(row, cols.vendor)),
        cost: num(cell(row, cols.cost)), status: String(cell(row, cols.status)), note: String(cell(row, cols.note)), src: where });
    });
  }

  var PARSERS = { form: parseForm, diary: parseDiary, daily: parseDaily, util: parseUtil, repair: parseRepair };
  // 시트 하나를 형식대로 읽는다. 형식을 비우면 판별 결과를 쓴다.
  function parseSheet(aoa, type, ctx, settings) {
    var S = settings && settings.restList ? settings : normSettings(settings);
    ctx = ctx || {};
    ctx.sheet = ctx.sheet || '';
    ctx.label = ctx.label || ((ctx.file ? ctx.file + ' · ' : '') + (ctx.sheet || '시트'));
    ctx.year = ctx.year || yearHint(aoa || []);
    type = type || detectSheet(aoa, ctx.sheet).type;
    var out = emptyInput();
    if (PARSERS[type]) PARSERS[type](aoa || [], ctx, S, out);
    out.type = type;
    return out;
  }
  function merge(list) {
    var o = emptyInput();
    list.forEach(function (x) { ['records', 'days', 'repairs', 'issues'].forEach(function (k) { o[k] = o[k].concat(x[k] || []); }); });
    return o;
  }

  /* ---------- 하루 계산 ---------- */
  function round(v, d) { var p = Math.pow(10, d || 0); return Math.round(v * p) / p; }
  function util(run, plan) { return plan > 0 ? run / plan : null; }
  function unionLen(iv, lo, hi) {
    var xs = iv.map(function (a) { return [Math.max(a[0], lo), Math.min(a[1], hi)]; }).filter(function (a) { return a[1] > a[0]; }).sort(function (a, b) { return a[0] - b[0]; });
    var len = 0, cs = null, ce = null;
    xs.forEach(function (a) { if (ce == null || a[0] > ce) { if (ce != null) len += ce - cs; cs = a[0]; ce = a[1]; } else ce = Math.max(ce, a[1]); });
    if (ce != null) len += ce - cs;
    return len;
  }
  // 구간 기록(작업일보 · 입력 양식) 하루치 → 계획 · 가동 · 비가동 · 휴게 · 사유별
  function dayFromRecords(list, S, issues) {
    var f = list[0], where = f.subject + ' · ' + f.date;
    var explicit = null;
    list.forEach(function (r) { if (!explicit) explicit = shiftOf(r.shift); });
    var maxEnd = Math.max.apply(null, list.map(function (r) { return r.end; }));
    var shift = explicit || (maxEnd > S.dayEndMin + 30 ? 'night' : 'day');
    var sh = shiftInfo(shift, S);
    var run = 0, down = 0, rest = 0, restCut = 0, codes = {}, counts = {};
    list.forEach(function (r) {
      var raw = r.end - r.start, cut = 0;
      if (r.cls !== 'rest' && S.separateRest) S.restList.forEach(function (w) { cut += overlapMin(r.start, r.end, w[0], w[1]); });
      r.raw = raw; r.restCut = cut; r.min = raw - cut;
      if (r.minRec != null && Math.abs(r.minRec - raw) > 1 && Math.abs(r.minRec - r.min) > 1)
        issue(issues, 'warn', where, '소요 기록 ' + r.minRec + '분 ↔ 시간으로 계산 ' + raw + '분(' + fmtTime(r.start) + ' ~ ' + fmtTime(r.end) + ') — 계산한 값을 씁니다 · ' + r.src);
      restCut += cut;
      if (r.cls === 'run') run += r.min;
      else if (r.cls === 'down') { down += r.min; codes[r.code] = (codes[r.code] || 0) + r.min; counts[r.code] = (counts[r.code] || 0) + 1; }
      else rest += raw;
    });
    // 겹침: 휴게를 뺀 기록끼리
    var work = list.filter(function (r) { return r.cls !== 'rest'; }).sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    var prev = null, overlaps = 0;
    work.forEach(function (r) {
      if (prev && r.start < prev.end) {
        overlaps++;
        issue(issues, 'warn', where, fmtTime(prev.start) + '~' + fmtTime(prev.end) + ' 과 ' + fmtTime(r.start) + '~' + fmtTime(r.end) + ' 이 ' + (Math.min(prev.end, r.end) - r.start) + '분 겹칩니다 · ' + r.src);
      }
      if (!prev || r.end > prev.end) prev = r;
    });
    var hasRun = list.some(function (r) { return r.cls === 'run'; });
    var runSrc = 'recorded';
    if (!hasRun) { run = Math.max(0, sh.plan - down); runSrc = 'calc'; }
    // 누락: 가동까지 적은 날만 본다. 기록 없는 시간이 휴식(오전 · 오후)보다 길면 확인할 것.
    var gap = 0;
    if (hasRun) {
      var iv = list.map(function (r) { return [r.start, r.end]; }).concat(sh.rests);
      gap = sh.end - sh.start - unionLen(iv, sh.start, sh.end);
      if (gap > S.breakMin) issue(issues, 'warn', where, '기록 없는 시간이 ' + gap + '분입니다(쉬는 시간 ' + S.breakMin + '분을 넘음) — 빠진 줄이 없는지 확인해 주세요');
    }
    if (run > sh.plan && sh.plan > 0) issue(issues, 'info', where, '가동 ' + run + '분이 계획 ' + sh.plan + '분보다 깁니다');
    return { kind: f.kind, subject: f.subject, date: f.date, shift: shift, plan: sh.plan, planSrc: 'shift', run: run, runSrc: runSrc, down: down, rest: rest,
      restCut: restCut, codes: codes, counts: counts, est: false, gap: gap, overlaps: overlaps, src: 'records', n: list.length, group: f.group || groupOf(f.subject, S),
      groupSrc: list.every(function (r) { return r.groupSrc === 'form'; }) ? 'form' : 'auto' };
  }
  // 하루 합계 기록(일일 집계 · 설비 가동률) → 같은 모양
  function dayFromSummary(d, S, issues) {
    var where = d.subject + ' · ' + d.date, grp = d.group || groupOf(d.subject, S), unk = keyOf(grp, UNKNOWN);
    var shift = shiftOf(d.shiftText) || 'day', sh = shiftInfo(shift, S);
    var plan, planSrc;
    if (S.basis === 'recorded' && d.plan != null) { plan = d.plan; planSrc = 'recorded'; } else { plan = sh.plan; planSrc = 'shift'; }
    var codes = {}, counts = {}, est = false;
    var down = d.down;
    if (d.codes) { Object.keys(d.codes).forEach(function (c) { codes[c] = d.codes[c]; counts[c] = 1; }); if (down == null) down = Object.keys(codes).reduce(function (s, c) { return s + codes[c]; }, 0); }
    if (down == null) down = 0;
    if (!d.codes && down > 0) {
      var ps = d.pairs || [];
      if (ps.length) {
        // 비가동 내역에는 분이 없다 — 묶음 수로 똑같이 나눈다(추정)
        var share = down / ps.length;
        ps.forEach(function (p) { var k = p.key || keyOf(grp, p.code); codes[k] = (codes[k] || 0) + share; counts[k] = (counts[k] || 0) + 1; });
        est = ps.length > 1 || false;
      } else { codes[unk] = down; counts[unk] = 1; issue(issues, 'info', where, '비가동 ' + down + '분의 내역(코드)이 없어 미분류로 셉니다'); }
    }
    var run = d.run, runSrc = 'recorded';
    if (run == null) { run = Math.max(0, plan - down); runSrc = 'calc'; }
    if (d.rateRec != null && plan > 0 && Math.abs(d.rateRec - run / plan) > 0.005)
      issue(issues, 'info', where, '기록된 가동률 ' + round(d.rateRec * 100, 1) + '% ↔ 가동/계획 ' + round(run / plan * 100, 1) + '%');
    if (plan > 0 && run + down > plan + 1 && planSrc === 'recorded') issue(issues, 'info', where, '가동 + 비가동 ' + (run + down) + '분이 계획 ' + plan + '분보다 깁니다');
    return { kind: d.kind, subject: d.subject, date: d.date, shift: shift, plan: plan, planSrc: planSrc, run: run, runSrc: runSrc, down: down, rest: d.rest || 0,
      restCut: 0, codes: codes, counts: counts, est: est, gap: 0, overlaps: 0, src: 'summary', n: 1, group: grp };
  }

  /* ---------- 집계 ---------- */
  function natCmp(a, b) { return String(a).localeCompare(String(b), 'ko', { numeric: true }); }
  // 키 순서: 가공 A~G → 가공 미분류 → 용접 A~H → 용접 미분류
  function keyOrder(S) {
    var o = {}, n = 0;
    GROUP_IDS.forEach(function (g) { codesOf(g, S).forEach(function (c) { o[keyOf(g, c.code)] = n++; }); o[keyOf(g, UNKNOWN)] = 900 + n++; });
    return o;
  }
  function ordOf(ord, k) { return ord[k] == null ? 500 : ord[k]; }
  // 같은 이름(라벨)의 키를 하나로 묶는다 — 가공 B 장비고장 + 용접 C 장비고장. 無/무 · 띄어쓰기는 같게 본다.
  function mergeByLabel(keys, S) {
    var ord = keyOrder(S), m = {}, out = [];
    keys.slice().sort(function (a, b) { return ordOf(ord, a) - ordOf(ord, b); }).forEach(function (k) {
      var lab = keyLabel(k, S), id = hz(lab);
      if (!m[id]) { m[id] = { id: id, label: lab, keys: [], first: ordOf(ord, k) }; out.push(m[id]); }
      m[id].keys.push(k);
    });
    out.forEach(function (x) { x.from = x.keys.map(keyName).join(' · '); });
    return out;
  }
  // 파레토: 키(군:코드)로 모은 분을 이름으로 합쳐 큰 순으로. code 칸에는 어느 군 코드에서 왔는지(가공 B · 용접 C).
  function pareto(codes, S, counts) {
    var keys = Object.keys(codes).filter(function (k) { return codes[k] > 0; });
    var items = mergeByLabel(keys, S).map(function (x) {
      return { code: x.from, label: x.label, keys: x.keys, first: x.first,
        min: x.keys.reduce(function (a, k) { return a + codes[k]; }, 0), count: x.keys.reduce(function (a, k) { return a + (counts ? counts[k] || 0 : 0); }, 0) };
    });
    var total = items.reduce(function (a, x) { return a + x.min; }, 0);
    if (!total) return [];
    items.sort(function (a, b) { return b.min - a.min || a.first - b.first; });
    var cum = 0;
    return items.map(function (x, i) { cum += x.min; x.pct = x.min / total; x.cum = i === items.length - 1 ? 1 : cum / total; delete x.first; return x; });
  }
  function addTo(acc, d) {
    acc.plan += d.plan; acc.run += d.run; acc.down += d.down; acc.rest += d.rest; acc.days++;
    Object.keys(d.codes).forEach(function (c) { acc.codes[c] = (acc.codes[c] || 0) + d.codes[c]; });
    Object.keys(d.counts).forEach(function (c) { acc.counts[c] = (acc.counts[c] || 0) + d.counts[c]; });
    if (d.est) acc.est = true;
    if (d.planSrc === 'shift') acc.planShift++;
    if (d.runSrc === 'calc') acc.runCalc++;
  }
  function acc0(extra) { var o = { plan: 0, run: 0, down: 0, rest: 0, days: 0, codes: {}, counts: {}, est: false, planShift: 0, runCalc: 0 }; Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; }); return o; }
  function finish(a, S) { a.util = util(a.run, a.plan); a.pareto = pareto(a.codes, S, a.counts); a.top = a.pareto[0] || null; return a; }
  function groupBy(days, keyFn, S, extraFn) {
    var m = {}, order = [];
    days.forEach(function (d) { var k = keyFn(d); if (!m[k]) { m[k] = acc0(extraFn ? extraFn(k, d) : {}); order.push(k); } addTo(m[k], d); });
    return order.map(function (k) { return finish(m[k], S); });
  }
  function aggregate(days, S) {
    days.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : natCmp(a.subject, b.subject); });
    var tot = acc0({});
    days.forEach(function (d) { addTo(tot, d); });
    finish(tot, S);
    var dates = {}, subs = {};
    days.forEach(function (d) { dates[d.date] = 1; subs[d.subject] = 1; });
    tot.dates = Object.keys(dates).length; tot.subjects = Object.keys(subs).length;
    tot.restCut = days.reduce(function (s, d) { return s + (d.restCut || 0); }, 0);
    var bySubject = groupBy(days, function (d) { return d.subject; }, S, function (k, d) { return { subject: k, group: d.group }; }).sort(function (a, b) { return natCmp(a.subject, b.subject); });
    var byDate = groupBy(days, function (d) { return d.date; }, S, function (k) { return { date: k }; });
    var byMonth = groupBy(days, function (d) { return d.date.slice(0, 7); }, S, function (k) { return { month: k }; });
    var cols = codeColumns(tot.codes, days, S);
    var matrix = bySubject.map(function (s) { return { subject: s.subject, group: s.group, cells: cols.map(function (c) { return c.keys.reduce(function (a, k) { return a + (s.codes[k] || 0); }, 0); }), total: s.down }; });
    var keyCols = Object.keys(tot.codes).filter(function (k) { return tot.codes[k] > 0; });
    var ko = keyOrder(S); keyCols.sort(function (a, b) { return ordOf(ko, a) - ordOf(ko, b); });
    var from = days.length ? days[0].date : '', to = days.length ? days[days.length - 1].date : '';
    return { totals: tot, bySubject: bySubject, byDate: byDate, byMonth: byMonth, pareto: tot.pareto, codeCols: cols, keyCols: keyCols, matrix: matrix, days: days, period: { from: from, to: to } };
  }
  // 설비×사유 표의 열: 자료에 있는 설비군의 코드표를 이름으로 합친 것(+ 미분류). 열마다 keys 로 원래 군:코드를 안다.
  function codeColumns(codes, days, S) {
    var gs = {}; days.forEach(function (d) { gs[d.group || 'mach'] = 1; });
    var keys = [];
    GROUP_IDS.forEach(function (g) { if (gs[g]) codesOf(g, S).forEach(function (c) { keys.push(keyOf(g, c.code)); }); });
    Object.keys(codes).forEach(function (k) { if (keys.indexOf(k) < 0 && codes[k] > 0) keys.push(k); });
    return mergeByLabel(keys, S);
  }
  function summarizeRepairs(reps) {
    var m = {}, order = [];
    reps.forEach(function (r) {
      var k = r.equip || '(설비 없음)';
      if (!m[k]) { m[k] = { equip: k, n: 0, downHr: 0, repairHr: 0, cost: 0 }; order.push(k); }
      m[k].n++; m[k].downHr += r.downHr || 0; m[k].repairHr += r.repairHr || 0; m[k].cost += r.cost || 0;
    });
    var by = order.map(function (k) { return m[k]; }).sort(function (a, b) { return b.downHr - a.downHr || natCmp(a.equip, b.equip); });
    return { list: reps, byEquip: by, n: reps.length,
      downHr: by.reduce(function (s, x) { return s + x.downHr; }, 0), repairHr: by.reduce(function (s, x) { return s + x.repairHr; }, 0), cost: by.reduce(function (s, x) { return s + x.cost; }, 0) };
  }
  // 전체 계산: 입력(읽은 기록) + 기준 → 대상(설비 · 작업자)별 집계
  function analyze(input, settings, opt) {
    var S = settings && settings.restList ? settings : normSettings(settings);
    opt = opt || {};
    input = input || emptyInput();
    var issues = (input.issues || []).slice();
    S.errors.forEach(function (e) { issue(issues, 'warn', '기준 설정', e); });
    var months = {};
    (input.records || []).forEach(function (r) { months[r.date.slice(0, 7)] = 1; });
    (input.days || []).forEach(function (d) { months[d.date.slice(0, 7)] = 1; });
    var inMonth = function (date) { return !opt.month || date.slice(0, 7) === opt.month; };
    var groups = {}, gOrder = [];
    (input.records || []).forEach(function (r) {
      if (!inMonth(r.date)) return;
      var k = r.kind + '|' + r.subject + '|' + r.date;
      if (!groups[k]) { groups[k] = []; gOrder.push(k); }
      groups[k].push(r);
    });
    var dayRows = [], byKey = {};
    gOrder.forEach(function (k) { var d = dayFromRecords(groups[k], S, issues); byKey[k] = d; dayRows.push(d); });
    (input.days || []).forEach(function (d) {
      if (!inMonth(d.date)) return;
      var k = d.kind + '|' + d.subject + '|' + d.date;
      if (byKey[k]) {
        // 같은 날을 작업일보와 일일 집계로 두 번 받으면 작업일보를 쓰고 집계는 대조만 한다(두 번 세지 않는다)
        if (d.down != null && Math.abs(d.down - byKey[k].down) > 1) issue(issues, 'warn', d.subject + ' · ' + d.date, '일일 집계 비가동 ' + d.down + '분 ↔ 작업일보 ' + byKey[k].down + '분 · ' + d.src);
        return;
      }
      var row = dayFromSummary(d, S, issues); byKey[k] = row; dayRows.push(row);
    });
    // 이름에 가공 · 용접 낱말이 둘 다 있어 설비군을 정하지 못한 대상(양식의 설비군 칸 · 기준 설정으로 정해진 것은 제외) — 가공으로 세고 확인할 것에 올린다
    var ambSeen = {};
    dayRows.forEach(function (d) {
      if (d.groupSrc === 'form' || ambSeen[d.subject]) return;
      var j = judgeGroup(d.subject, S);
      if (j.src !== 'ambiguous') return;
      ambSeen[d.subject] = 1;
      issue(issues, 'warn', d.subject, '이름에 가공 · 용접 낱말이 둘 다 있어 설비군을 정하지 못했습니다 — 지금은 가공설비로 셉니다. 기준 설정 → 설비군에서 골라 주세요');
    });
    var kinds = {};
    ['equip', 'worker'].forEach(function (kd) { var ds = dayRows.filter(function (d) { return d.kind === kd; }); if (ds.length) kinds[kd] = aggregate(ds, S); });
    var reps = (input.repairs || []).filter(function (r) { return !r.startDate || inMonth(r.startDate); });
    return { settings: S, kinds: kinds, repairs: summarizeRepairs(reps), issues: issues, months: Object.keys(months).sort(), month: opt.month || '' };
  }

  /* ---------- 글자 ---------- */
  function fmtH(min) { return (min == null ? '-' : round(min / 60, 1).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })); }
  function pct(v, d) { return v == null ? '-' : round(v * 100, d == null ? 1 : d).toFixed(d == null ? 1 : d) + '%'; }
  function won(v) { return Math.round(v || 0).toLocaleString('ko-KR'); }
  function md(iso) { return iso ? iso.slice(5).replace('-', '.') : ''; }
  var KIND_WORD = { equip: { unit: '설비', count: '대' }, worker: { unit: '작업자', count: '명' } };
  // 파레토 항목 이름: 「장비고장(가공 B · 용접 C)」 — 이름으로 합치되 어느 군 코드에서 왔는지 남긴다
  function codeName(p) { return p.label + '(' + p.code + ')'; }
  // 계획 시간 식(기획자 기준): 8to5 = 540 − 점심 60 − 쉬는 시간 20 = 460분
  function planFormula(S) {
    var d = shiftInfo('day', S);
    return fmtTime(d.start) + '~' + fmtTime(d.end) + ' 근무 ' + (d.end - d.start) + '분 − 점심 등 휴게 ' + d.restMin + '분 − 쉬는 시간 ' + S.breakMin + '분 = ' + d.plan + '분';
  }
  // 규칙으로 만드는 요약 문장 — AI 없이도 보고서가 선다
  function summaryLines(res, kind) {
    var A = res.kinds[kind]; if (!A) return [];
    var S = res.settings, T = A.totals, W = KIND_WORD[kind], L = [];
    L.push(A.period.from + ' ~ ' + A.period.to + ' 동안 ' + W.unit + ' ' + T.subjects + W.count + ' · ' + T.dates + '일 기준 가동률은 ' + pct(T.util) +
      '입니다(계획 ' + fmtH(T.plan) + '시간 중 가동 ' + fmtH(T.run) + '시간).');
    var P = A.pareto;
    if (!P.length) L.push('비가동 기록이 없습니다.');
    else if (P.length === 1) L.push('비가동은 모두 ' + fmtH(T.down) + '시간이며 사유는 ' + codeName(P[0]) + ' 하나입니다.');
    else L.push('비가동은 모두 ' + fmtH(T.down) + '시간이며, 상위 사유는 ' + codeName(P[0]) + ' ' + pct(P[0].pct) + ' · ' + codeName(P[1]) + ' ' + pct(P[1].pct) +
      ' 로 두 사유가 ' + pct(P[1].cum) + '를 차지합니다.');
    var withU = A.bySubject.filter(function (s) { return s.util != null; });
    var below = withU.filter(function (s) { return s.util * 100 < S.target; }).sort(function (a, b) { return a.util - b.util; });
    if (withU.length) {
      if (below.length) L.push('목표 가동률 ' + S.target + '%에 못 미친 ' + W.unit + '는 ' + below.slice(0, 3).map(function (s) {
        return s.subject + '(' + pct(s.util) + (s.top ? ', 주 사유 ' + codeName(s.top) + ' ' + fmtH(s.top.min) + '시간' : '') + ')';
      }).join(' · ') + (below.length > 3 ? ' 외 ' + (below.length - 3) + W.count : '') + '입니다.');
      else L.push('모든 ' + W.unit + '가 목표 가동률 ' + S.target + '% 이상입니다.');
      var best = withU.slice().sort(function (a, b) { return b.util - a.util; })[0];
      if (withU.length > 1) L.push('가동률이 가장 높은 ' + W.unit + '는 ' + best.subject + '(' + pct(best.util) + ')입니다.');
    }
    var dd = A.byDate.filter(function (d) { return d.util != null; });
    if (dd.length > 1) {
      var worst = dd.slice().sort(function (a, b) { return a.util - b.util || (a.date < b.date ? -1 : 1); })[0];
      L.push('일별로는 ' + md(worst.date) + '(' + weekday(worst.date) + ') 가동률이 ' + pct(worst.util) + '로 가장 낮았습니다(비가동 ' + fmtH(worst.down) + '시간' +
        (worst.top ? ', 주 사유 ' + codeName(worst.top) : '') + ').');
    }
    if (kind === 'equip' && res.repairs.n) L.push('수리 이력은 ' + res.repairs.n + '건 · 비가동 ' + round(res.repairs.downHr, 1) + '시간 · 수리비 ' + won(res.repairs.cost) + '원입니다.');
    var warns = res.issues.filter(function (x) { return x.level === 'warn'; }).length;
    if (warns) L.push('기록에서 확인할 것 ' + warns + '건이 있어 수치가 바뀔 수 있습니다.');
    if (A.totals.est) L.push('한 칸에 사유가 여럿인 날은 비가동 시간을 사유 수로 똑같이 나눴습니다(추정).');
    return L;
  }
  function basisText(S) { return S.basis === 'recorded' ? '기록된 계획 시간(없으면 근무 형태 기준)' : '근무 형태 기준(인정시간 − 쉬는 시간 ' + S.breakMin + '분)'; }

  /* ---------- 보고서(인쇄용 HTML) ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function reportHtml(res, kind, opts) {
    opts = opts || {};
    var A = res.kinds[kind]; if (!A) return '';
    var S = res.settings, T = A.totals, W = KIND_WORD[kind];
    var ym = A.period.from.slice(0, 7) === A.period.to.slice(0, 7) ? A.period.from.slice(0, 4) + '년 ' + (+A.period.from.slice(5, 7)) + '월 ' : '';
    var title = ym + (kind === 'equip' ? '설비 운영실적 보고' : '작업자 가동 현황 보고');
    var lines = opts.aiLines && opts.aiLines.length ? opts.aiLines : summaryLines(res, kind);
    var ch = opts.charts || {};
    var h = ['<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>' + esc(title) + '</title><style>',
      'body{font-family:"Pretendard","Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#152232;margin:24px;font-size:13px;line-height:1.6;word-break:keep-all;overflow-wrap:break-word}',
      'h1{font-size:21px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px;border-bottom:2px solid #154b6e;padding-bottom:4px}',
      '.meta{color:#5b6b7b;font-size:12px}table{border-collapse:collapse;width:100%;margin:6px 0;font-size:12px}th,td{border:1px solid #c9d3dc;padding:4px 7px;text-align:left}',
      'th{background:#eef2f6}td.n{text-align:right;font-variant-numeric:tabular-nums}.kpi td{font-size:15px;font-weight:700;text-align:center}.kpi th{text-align:center}',
      '.lo{color:#c8341f;font-weight:700}.tag{display:inline-block;font-size:10.5px;font-weight:700;background:#7a5bb8;color:#fff;border-radius:3px;padding:0 6px}',
      'svg{max-width:100%;height:auto}.fig{margin:6px 0}.fig svg{width:100%;max-width:720px;display:block;border:1px solid #dde4ea;border-radius:8px}',
      // 그림은 화면과 같은 SVG 다 — 이 문서는 화면 CSS 를 모르므로 그림 규칙을 함께 싣는다
      'svg .grid{stroke:#e6ebf0}svg .ax{font-size:11px;fill:#5b6b7b}svg .axt{font-size:12px;fill:#152232}svg .val{font-size:11px;fill:#152232}',
      'svg .bar{fill:#154b6e}svg .bar.lo{fill:#c8341f}svg .tgt{stroke:#d9822b;stroke-width:1.6;stroke-dasharray:5 4}',
      'svg .l-cum{fill:none;stroke:#d9822b;stroke-width:2.2}svg .cum{fill:#d9822b}svg .l-util{fill:none;stroke:#0b6e99;stroke-width:2.2}',
      'svg .pt{fill:#0b6e99;stroke:#fff;stroke-width:1}svg .pt.lo{fill:#c8341f}.foot{margin-top:24px;color:#5b6b7b;font-size:11.5px;border-top:1px solid #c9d3dc;padding-top:8px}',
      '@media print{body{margin:12mm}h2{break-after:avoid}table,.fig{break-inside:avoid}}</style></head><body>'];
    h.push('<h1>' + esc(title) + '</h1><div class="meta">기간 ' + esc(A.period.from) + ' ~ ' + esc(A.period.to) + ' · ' + W.unit + ' ' + T.subjects + W.count + ' · ' + T.dates + '일 · 계획 시간 기준: ' +
      esc(basisText(S)) + (opts.team ? ' · ' + esc(opts.team) : '') + (opts.made ? ' · 작성 ' + esc(opts.made) : '') + '</div>');
    h.push('<h2>1. 요약</h2>' + (opts.aiLines && opts.aiLines.length ? '<p><span class="tag">AI 초안 — 검토 필요</span></p>' : '') + '<ul>' + lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>');
    h.push('<h2>2. 핵심 지표</h2><table class="kpi"><tr><th>계획 시간</th><th>가동 시간</th><th>비가동 시간</th><th>가동률</th><th>목표</th></tr><tr><td>' + fmtH(T.plan) + 'h</td><td>' +
      fmtH(T.run) + 'h</td><td>' + fmtH(T.down) + 'h</td><td' + (T.util != null && T.util * 100 < S.target ? ' class="lo"' : '') + '>' + pct(T.util) + '</td><td>' + S.target + '%</td></tr></table>');
    h.push('<h2>3. ' + W.unit + '별 가동률</h2>' + (ch.bar ? '<div class="fig">' + ch.bar + '</div>' : '') +
      '<table><tr><th>' + W.unit + '</th><th>일수</th><th>계획(h)</th><th>가동(h)</th><th>비가동(h)</th><th>가동률</th><th>주 사유</th></tr>' +
      A.bySubject.map(function (s) {
        return '<tr><td>' + esc(s.subject) + '</td><td class="n">' + s.days + '</td><td class="n">' + fmtH(s.plan) + '</td><td class="n">' + fmtH(s.run) + '</td><td class="n">' + fmtH(s.down) +
          '</td><td class="n' + (s.util != null && s.util * 100 < S.target ? ' lo' : '') + '">' + pct(s.util) + '</td><td>' + (s.top ? esc(codeName(s.top)) : '-') + '</td></tr>';
      }).join('') + '</table>');
    h.push('<h2>4. 비가동 사유 파레토</h2>' + (ch.pareto ? '<div class="fig">' + ch.pareto + '</div>' : '') +
      '<table><tr><th>순위</th><th>사유</th><th>코드(설비군)</th><th>건수</th><th>시간(h)</th><th>비율</th><th>누적</th></tr>' +
      A.pareto.map(function (p, i) { return '<tr><td class="n">' + (i + 1) + '</td><td>' + esc(p.label) + '</td><td>' + esc(p.code) + '</td><td class="n">' + p.count + '</td><td class="n">' + fmtH(p.min) + '</td><td class="n">' + pct(p.pct) + '</td><td class="n">' + pct(p.cum) + '</td></tr>'; }).join('') +
      (A.pareto.length ? '' : '<tr><td colspan="7">비가동 기록이 없습니다.</td></tr>') + '</table>');
    h.push('<h2>5. 일별 추이</h2>' + (ch.trend ? '<div class="fig">' + ch.trend + '</div>' : '') +
      (A.byMonth.length > 1 ? '<table><tr><th>월</th><th>계획(h)</th><th>가동(h)</th><th>비가동(h)</th><th>가동률</th></tr>' + A.byMonth.map(function (m) { return '<tr><td>' + m.month + '</td><td class="n">' + fmtH(m.plan) + '</td><td class="n">' + fmtH(m.run) + '</td><td class="n">' + fmtH(m.down) + '</td><td class="n">' + pct(m.util) + '</td></tr>'; }).join('') + '</table>' : ''));
    h.push('<h2>6. ' + W.unit + ' × 사유 비가동(h)</h2><table><tr><th>' + W.unit + '</th>' + A.codeCols.map(function (c) { return '<th>' + esc(c.label) + '<br><small>' + esc(c.from) + '</small></th>'; }).join('') + '<th>합계</th></tr>' +
      A.matrix.map(function (r) { return '<tr><td>' + esc(r.subject) + '</td>' + r.cells.map(function (v) { return '<td class="n">' + (v ? fmtH(v) : '') + '</td>'; }).join('') + '<td class="n"><b>' + fmtH(r.total) + '</b></td></tr>'; }).join('') + '</table>');
    var n = 7;
    if (kind === 'equip' && res.repairs.n) {
      h.push('<h2>' + (n++) + '. 수리 이력</h2><table><tr><th>설비</th><th>건수</th><th>비가동(h)</th><th>수리(h)</th><th>비용(원)</th></tr>' +
        res.repairs.byEquip.map(function (r) { return '<tr><td>' + esc(r.equip) + '</td><td class="n">' + r.n + '</td><td class="n">' + round(r.downHr, 1) + '</td><td class="n">' + round(r.repairHr, 1) + '</td><td class="n">' + won(r.cost) + '</td></tr>'; }).join('') + '</table>' +
        '<table><tr><th>시작</th><th>설비</th><th>고장부위</th><th>비가동 구간</th><th>현상/원인</th><th>조치</th><th>진행</th></tr>' +
        res.repairs.list.map(function (r) { return '<tr><td>' + esc(r.startDate) + '</td><td>' + esc(r.equip) + '</td><td>' + esc(r.part) + '</td><td>' + esc(r.range) + '</td><td>' + esc(r.cause) + '</td><td>' + esc(r.action) + '</td><td>' + esc(r.status) + '</td></tr>'; }).join('') + '</table>');
    }
    var warns = res.issues.filter(function (x) { return x.level === 'warn'; });
    if (warns.length) h.push('<h2>' + (n++) + '. 확인할 것(' + warns.length + '건)</h2><ul>' + warns.slice(0, 30).map(function (x) { return '<li>' + esc(x.where) + ' — ' + esc(x.text) + '</li>'; }).join('') + (warns.length > 30 ? '<li>외 ' + (warns.length - 30) + '건은 엑셀 「확인할것」 시트에 있습니다.</li>' : '') + '</ul>');
    h.push('<div class="foot">가동률 = 가동 시간 ÷ 계획 시간(계획 0 이면 계산하지 않음). 인정시간 = 근무 시작~종료 − 휴게(' + esc(S.rests) + '), 계획 = 인정시간 − 오전·오후 쉬는 시간 ' + S.breakMin + '분(' + esc(planFormula(S)) + '). 사유 코드는 설비군마다 다릅니다 — 가공설비 ' + S.codes.map(function (c) { return c.code + ' ' + c.label; }).join(' · ') +
      ' / 용접설비 ' + S.weldCodes.map(function (c) { return c.code + ' ' + c.label; }).join(' · ') + '. 같은 이름의 사유는 합쳐 보이고 괄호에 어느 군 코드인지 적었습니다.' +
      (T.runCalc ? ' 가동을 적지 않은 ' + T.runCalc + '일은 가동 = 계획 − 비가동으로 계산했습니다.' : '') + (T.planShift && S.basis === 'recorded' ? ' 계획 시간이 기록되지 않은 ' + T.planShift + '일은 근무 형태 기준으로 계산했습니다.' : '') +
      (opts.sample ? ' 예제 데이터는 실제 사내 데이터가 아닙니다.' : '') + ' 이 보고서는 규칙으로 자동 작성했으니 제출 전 내용을 확인해 주세요.</div></body></html>');
    return h.join('');
  }

  /* ---------- 엑셀 시트 ---------- */
  function h1(min) { return round(min / 60, 2); }
  function p1(v) { return v == null ? '' : round(v * 100, 1); }
  function sheets(res) {
    var S = res.settings, out = {};
    var kinds = Object.keys(res.kinds);
    var sum = [['항목', '값']];
    kinds.forEach(function (k) {
      var A = res.kinds[k], T = A.totals, W = KIND_WORD[k];
      sum.push([W.unit + ' 기간', A.period.from + ' ~ ' + A.period.to], [W.unit + ' 수', T.subjects], ['근무일', T.dates], ['계획 시간(h)', h1(T.plan)], ['가동 시간(h)', h1(T.run)],
        ['비가동 시간(h)', h1(T.down)], ['가동률(%)', p1(T.util)], []);
    });
    sum.push(['계획 시간 기준', basisText(S)], ['목표 가동률(%)', S.target], []);
    if (res.kinds.equip) summaryLines(res, 'equip').forEach(function (l) { sum.push(['요약', l]); });
    if (res.kinds.worker) summaryLines(res, 'worker').forEach(function (l) { sum.push(['요약(작업자)', l]); });
    out['요약'] = sum;
    kinds.forEach(function (k) {
      var A = res.kinds[k], W = KIND_WORD[k], tag = k === 'equip' ? '' : '(작업자)';
      out[W.unit + '별'] = [[W.unit, '일수', '계획(h)', '가동(h)', '비가동(h)', '가동률(%)', '주 사유', '주 사유(h)']].concat(A.bySubject.map(function (s) {
        return [s.subject, s.days, h1(s.plan), h1(s.run), h1(s.down), p1(s.util), s.top ? codeName(s.top) : '', s.top ? h1(s.top.min) : ''];
      }));
      out['사유별' + tag] = [['순위', '사유', '코드(설비군)', '건수', '비가동(h)', '비율(%)', '누적(%)']].concat(A.pareto.map(function (p, i) { return [i + 1, p.label, p.code, p.count, h1(p.min), p1(p.pct), p1(p.cum)]; }));
      out['일별' + tag] = [['날짜', '요일', '계획(h)', '가동(h)', '비가동(h)', '가동률(%)']].concat(A.byDate.map(function (d) { return [d.date, weekday(d.date), h1(d.plan), h1(d.run), h1(d.down), p1(d.util)]; }));
      out['월별' + tag] = [['월', '계획(h)', '가동(h)', '비가동(h)', '가동률(%)']].concat(A.byMonth.map(function (m) { return [m.month, h1(m.plan), h1(m.run), h1(m.down), p1(m.util)]; }));
      out[W.unit + 'x사유'] = [[W.unit, '설비군'].concat(A.codeCols.map(function (c) { return c.label + ' [' + c.from + '](h)'; }), ['합계(h)'])].concat(A.matrix.map(function (r) { return [r.subject, GROUP_NAME[r.group] || ''].concat(r.cells.map(h1), [h1(r.total)]); }));
      out['일자별상세' + tag] = [['날짜', W.unit, '근무', '계획(분)', '계획 출처', '가동(분)', '가동 출처', '비가동(분)', '휴게(분)', '휴게 분리(분)', '기록 없는 시간(분)', '설비군'].concat(A.keyCols.map(function (k) { return keyName(k) + ' ' + keyLabel(k, S) + '(분)'; }), ['사유 추정'])]
        .concat(A.days.map(function (d) {
          return [d.date, d.subject, shiftName(d.shift), d.plan, d.planSrc === 'recorded' ? '기록' : '근무 형태', round(d.run, 1), d.runSrc === 'calc' ? '계산(계획−비가동)' : '기록', round(d.down, 1), d.rest, d.restCut, d.gap, GROUP_NAME[d.group] || '']
            .concat(A.keyCols.map(function (k) { return d.codes[k] ? round(d.codes[k], 1) : ''; }), [d.est ? '추정' : '']);
        }));
    });
    if (res.kinds.equip) res.kinds.equip.byMonth.forEach(function (m) { out['가동률양식_' + m.month] = toUtilSheet(res.kinds.equip, m.month, S); });
    out['확인할것'] = [['수준', '어디', '내용']].concat(res.issues.map(function (x) { return [x.level === 'warn' ? '확인' : '참고', x.where, x.text]; }));
    if (res.repairs.n) out['수리이력'] = [['시작일자', '완료일자', '설비', '고장부위', '비가동 구간', '비가동(h, 구간 계산)', '비가동 총시간(h, 기록)', '수리 소요(h)', '현상/원인', '조치내용', '거래처', '비용(원)', '진행현황']]
      .concat(res.repairs.list.map(function (r) { return [r.startDate, r.endDate, r.equip, r.part, r.range, r.rangeHr == null ? '' : round(r.rangeHr, 2), r.totalHr == null ? '' : r.totalHr, r.repairHr == null ? '' : r.repairHr, r.cause, r.action, r.vendor, r.cost == null ? '' : r.cost, r.status]; }));
    out['기준'] = [['항목', '값'], ['근무 시작', S.start], ['주간 종료', S.dayEnd], ['주간+야간 종료', S.nightEnd], ['휴게 구간', S.rests], ['오전·오후 쉬는 시간 제외(분)', S.breakMin], ['8to5 계획 시간 식', planFormula(S)],
      ['주간 인정시간(분)', shiftInfo('day', S).recognized], ['주간 계획(분)', shiftInfo('day', S).plan], ['주간+야간 인정시간(분)', shiftInfo('night', S).recognized], ['주간+야간 계획(분)', shiftInfo('night', S).plan],
      ['계획 시간 기준', basisText(S)], ['휴게 분리', S.separateRest ? '예' : '아니오'], ['목표 가동률(%)', S.target], []]
      .concat([['설비군', '코드', '이름', '설명']], S.codes.map(function (c) { return ['가공설비', c.code, c.label, c.desc]; }), S.weldCodes.map(function (c) { return ['용접설비', c.code, c.label, c.desc]; }),
        [[], ['설비군을 직접 고친 설비 · 작업자', '설비군']], Object.keys(S.equipGroups).map(function (k) { return [k, GROUP_NAME[S.equipGroups[k]]]; }));
    return out;
  }
  // 회사 「설비 가동률」 시트와 같은 모양으로 한 달을 내보낸다(다시 올리면 같은 값으로 읽힌다)
  function toUtilSheet(A, month, S) {
    var y = +month.slice(0, 4), mo = +month.slice(5, 7), last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    var dates = []; for (var d = 1; d <= last; d++) dates.push(y + '-' + pad(mo) + '-' + pad(d));
    var rows = [[month.replace('-', '년 ') + '월 설비 가동률'], ['※ 오전/오후 휴식시간(각 ' + round(S.breakMin / 2, 1) + '분) 제외'], []];
    A.bySubject.forEach(function (s) {
      var by = {}; A.days.forEach(function (x) { if (x.subject === s.subject && x.date.slice(0, 7) === month) by[x.date] = x; });
      var ds = Object.keys(by); if (!ds.length) return;
      var sp = 0, sr = 0; ds.forEach(function (k) { sp += by[k].plan; sr += by[k].run; });
      var g = function (f) { return dates.map(function (dt) { return by[dt] ? f(by[dt]) : ''; }); };
      rows.push([s.subject].concat(dates.map(isoToSerial), ['총 가동률']));
      rows.push(['작업 계획'].concat(g(function (x) { return shiftName(x.shift); })));
      rows.push(['계획 시간(분)'].concat(g(function (x) { return x.plan; }), [sp]));
      rows.push(['주간(분)'].concat(g(function (x) { return x.shift === 'night' ? shiftInfo('day', S).plan : x.plan; })));
      rows.push(['야간(분)'].concat(g(function (x) { return x.shift === 'night' ? x.plan - shiftInfo('day', S).plan : 0; })));
      rows.push(['가동 시간'].concat(g(function (x) { return round(x.run, 1); }), [round(sr, 1)]));
      rows.push(['비가동 시간'].concat(g(function (x) { return round(x.down, 1); }), [round(sp - sr, 1)]));
      rows.push(['가동률'].concat(g(function (x) { return x.plan > 0 ? round(x.run / x.plan, 4) : ''; }), [sp > 0 ? round(sr / sp, 4) : '']));
      rows.push(['비가동 내역'].concat(g(function (x) { var cs = Object.keys(x.codes).filter(function (k) { return x.codes[k] > 0 && splitKey(k).code !== UNKNOWN; }).map(function (k) { return splitKey(k).code; }); return cs.length ? s.subject + ': ' + cs.join(' ') : ''; })));
      rows.push([]);
    });
    return rows;
  }

  /* ---------- 입력 양식 ---------- */
  var FORM_HEAD = ['설비', '설비군', '작업자', '날짜', '근무', '구분', '코드', '시작', '종료', '소요(분)', '내용'];
  function legendRows(S) {
    S = S && S.restList ? S : normSettings(S);
    return [['설비군', '사유 코드', '이름', '설명']].concat(S.codes.map(function (c) { return ['가공설비', c.code, c.label, c.desc]; }),
      S.weldCodes.map(function (c) { return ['용접설비', c.code, c.label, c.desc]; }), [[],
      ['칸', '쓰는 법'],
      ['설비', '설비 이름(예: NC-01). 위 줄과 같으면 비워도 됩니다.'],
      ['설비군', '선택. 가공 또는 용접. 비우면 설비 이름으로 판단합니다(' + WELD_WORDS + ' → 용접, ' + MACH_WORDS + ' → 가공, 둘 다 있으면 확인 필요, 그 밖 → 가공). 아래 기획자 설비 목록의 이름을 그대로 쓰면 저절로 맞습니다.'],
      ['작업자', '선택. 설비를 비우고 작업자만 적으면 작업자별로 집계합니다.'],
      ['날짜', '2026-10-01 처럼. 위 줄과 같으면 비워도 됩니다.'],
      ['근무', '주간 또는 주간+야간. 비우면 마지막 종료 시각으로 판단합니다.'],
      ['구분', '가동 · 비가동 · 휴게. 비우면 코드가 있으면 비가동, 없으면 가동으로 봅니다.'],
      ['코드', '비가동일 때 그 설비군의 사유 코드를 적습니다(가공 A~G · 용접 A~H — 같은 글자라도 뜻이 다릅니다).'],
      ['시작 · 종료', '08:00 처럼 24시간제. 엑셀 시간 서식도 됩니다.'],
      ['소요(분)', '선택. 적으면 시작~종료로 계산한 값과 대조합니다.'],
      ['가동 줄', '비가동만 적어도 됩니다. 그러면 가동 = 계획 − 비가동으로 계산합니다.'],
      [], ['가동률 기준', '가동 시간 ÷ 계획 시간. ' + planFormula(S) + '(점심 60분 · 쉬는 시간 오전 · 오후 각 10분 제외)'],
      [], ['근무 형태', '시작', '종료', '휴게', '인정시간(분)', '계획(분)'],
      ['주간', S.start, S.dayEnd, shiftInfo('day', S).restMin, shiftInfo('day', S).recognized, shiftInfo('day', S).plan],
      ['주간+야간', S.start, S.nightEnd, shiftInfo('night', S).restMin, shiftInfo('night', S).recognized, shiftInfo('night', S).plan],
      [], ['기획자 설비 목록(' + PLANNER_EQUIP_DATE + ')', '설비군', '「설비」 칸에 이 이름을 그대로 적으면 설비군이 저절로 맞습니다']],
      PLANNER_EQUIP.map(function (e) { return [e.name, GROUP_NAME[e.group]]; }));
  }
  function templateSheets(settings) { return { '비가동일보': [FORM_HEAD.slice()], '범례': legendRows(settings) }; }

  /* ---------- 예제(가짜 데이터) ---------- */
  function rng(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  var SAMPLE_EQUIP = [
    { name: 'NC-01', night: 0.3, ev: [['A', 0.45, 30, 90], ['C', 0.25, 20, 40], ['E', 0.06, 60, 120], ['G', 0.05, 15, 30]] },
    { name: 'NC-02', night: 0.3, ev: [['A', 0.7, 40, 120], ['C', 0.25, 20, 40], ['E', 0.08, 60, 120], ['G', 0.04, 15, 30]] },
    { name: 'MCT-H', night: 0.35, ev: [['A', 0.4, 30, 90], ['C', 0.3, 20, 45], ['G', 0.06, 15, 40]] },
    // 용접로봇은 용접설비 코드표(A 제관품대기 · B 제관품無 · C 장비고장 · D 티칭수정 · E 계획정지 · F 공정결원 · G 청소 · H 기타)
    { name: '용접로봇-01', night: 0.2, ev: [['D', 0.55, 20, 50], ['A', 0.35, 30, 80], ['B', 0.15, 30, 90], ['F', 0.05, 60, 90]] },
    { name: '용접로봇-02', night: 0.2, ev: [['D', 0.4, 20, 45], ['A', 0.3, 30, 80], ['B', 0.12, 30, 90], ['F', 0.1, 60, 120], ['H', 0.04, 15, 30]] },
    { name: '2공장-NC', night: 0.15, ev: [['A', 0.3, 30, 70], ['E', 0.15, 60, 150], ['G', 0.08, 15, 40]] }
  ];
  var SAMPLE_REPAIRS = [
    { equip: 'NC-01', date: '2026-10-22', s: '08:10', e: '09:40', part: '유압 유닛', cause: '유압 저하 알람', action: '필터 교체 · 유압 조정', vendor: '가상정비', cost: 180000, rep: 1.2 },
    { equip: 'MCT-H', date: '2026-10-07', s: '10:20', e: '11:50', part: '주축', cause: '주축 과열 알람', action: '냉각 팬 교체', vendor: '가상정비', cost: 350000, rep: 1.3 },
    { equip: 'MCT-H', date: '2026-10-20', s: '13:00', e: '14:50', part: 'ATC', cause: '공구 교환 중 정지', action: '그리퍼 조정', vendor: '가상정비', cost: 420000, rep: 1.6 },
    { equip: '용접로봇-01', date: '2026-10-13', s: '15:20', e: '16:50', part: '토치 케이블', cause: '아크 불안정', action: '케이블 교체', vendor: '가상로봇서비스', cost: 260000, rep: 1.0 },
    { equip: '용접로봇-02', date: '2026-10-27', s: '10:15', e: '11:45', part: '와이어 송급장치', cause: '와이어 걸림', action: '롤러 교체', vendor: '가상로봇서비스', cost: 150000, rep: 1.2 }
  ];
  var PM_DAY = { 'NC-01': '2026-10-16', 'NC-02': '2026-10-23', 'MCT-H': '2026-10-30', '용접로봇-01': '2026-10-02', '용접로봇-02': '2026-10-19', '2공장-NC': '2026-10-26' };
  function workdays(month, holidays) {
    var y = +month.slice(0, 4), m = +month.slice(5, 7), last = new Date(Date.UTC(y, m, 0)).getUTCDate(), out = [];
    for (var d = 1; d <= last; d++) { var iso = y + '-' + pad(m) + '-' + pad(d), w = new Date(iso + 'T00:00:00Z').getUTCDay(); if (w > 0 && w < 6 && holidays.indexOf(iso) < 0) out.push(iso); }
    return out;
  }
  // 근무 구간(휴게 · 오전 · 오후 휴식 사이)에 비가동을 놓고 나머지를 가동으로 채운다
  function dayTimeline(rnd, night, evs, fixed) {
    var wins = [[480, 600], [610, 720], [780, 900], [910, 1020]];
    if (night) wins.push([1050, 1200]);
    var placed = (fixed || []).slice();
    function free(s, e) { return wins.some(function (w) { return s >= w[0] && e <= w[1]; }) && placed.every(function (p) { return e <= p.s || s >= p.e; }); }
    evs.forEach(function (ev) {
      if (ev.end) { var w = wins[wins.length - 1], s0 = w[1] - ev.dur; if (free(s0, w[1])) placed.push({ code: ev.code, s: s0, e: w[1], note: ev.note }); return; }
      for (var t = 0; t < 25; t++) {
        var w2 = wins[Math.floor(rnd() * wins.length)], span = w2[1] - w2[0] - ev.dur;
        if (span < 0) continue;
        var s = w2[0] + Math.round(rnd() * span / 5) * 5;
        if (free(s, s + ev.dur)) { placed.push({ code: ev.code, s: s, e: s + ev.dur, note: ev.note }); return; }
      }
    });
    placed.sort(function (a, b) { return a.s - b.s; });
    var segs = [];
    wins.forEach(function (w) {
      var cur = w[0];
      placed.filter(function (p) { return p.s >= w[0] && p.e <= w[1]; }).forEach(function (p) { if (p.s > cur) segs.push({ cls: 'run', s: cur, e: p.s }); segs.push({ cls: 'down', code: p.code, s: p.s, e: p.e, note: p.note }); cur = p.e; });
      if (cur < w[1]) segs.push({ cls: 'run', s: cur, e: w[1] });
    });
    return segs;
  }
  var NOTE = { A: '제관품 입고 대기', B: '설비 고장', C: '지그 교체', D: '예방보전', E: '작업자 결원', F: '마감 청소', G: '자재 확인' };
  var NOTE_W = { A: '제관품 대기', B: '제관품 없음', C: '로봇 고장', D: '티칭 수정', E: '예방보전', F: '작업자 결원', G: '마감 청소', H: '자재 확인' };
  // 설비군마다 같은 사유의 글자가 다르다: 고장 · 계획정지 · 청소
  var SAMPLE_CODE = { mach: { fault: 'B', pm: 'D', clean: 'F', note: NOTE }, weld: { fault: 'C', pm: 'E', clean: 'G', note: NOTE_W } };
  function pickEvents(rnd, prof, extra, g) {
    var C = SAMPLE_CODE[g || 'mach'], evs = (extra || []).slice();
    prof.forEach(function (p) { if (rnd() < p[1]) evs.push({ code: p[0], dur: Math.round((p[2] + rnd() * (p[3] - p[2])) / 5) * 5, note: C.note[p[0]] }); });
    if (rnd() < 0.4) evs.push({ code: C.clean, dur: 10 + Math.round(rnd()) * 5, end: true, note: C.note[C.clean] });
    return evs;
  }
  function sample() {
    var rnd = rng(2611), month = '2026-10', holidays = ['2026-10-09'];
    var days = workdays(month, holidays);
    // 1) 설비 6대 · 10월 근무일 — 입력 양식 모양
    var form = [FORM_HEAD.slice()];
    SAMPLE_EQUIP.forEach(function (eq) {
      var grp = autoGroup(eq.name), C = SAMPLE_CODE[grp];
      days.forEach(function (d) {
        var night = rnd() < eq.night;
        var fixed = SAMPLE_REPAIRS.filter(function (r) { return r.equip === eq.name && r.date === d; }).map(function (r) { return { code: C.fault, s: parseTime(r.s).min, e: parseTime(r.e).min, note: r.cause }; });
        var extra = PM_DAY[eq.name] === d ? [{ code: C.pm, dur: 120, note: C.note[C.pm] }] : [];
        var segs = dayTimeline(rnd, night, pickEvents(rnd, eq.ev, extra, grp), fixed);
        segs.forEach(function (g, i) {
          // 설비군 칸은 비워 둔다 — 설비 이름으로 판정되는 것을 보여 주기 위해
          form.push([i === 0 ? eq.name : '', '', '', i === 0 ? d : '', i === 0 ? (night ? '주간+야간' : '주간') : '', g.cls === 'run' ? '가동' : '비가동', g.code || '',
            fmtTime(g.s), fmtTime(g.e), g.cls === 'down' ? g.e - g.s : '', g.cls === 'run' ? '정상 가동' : g.note || C.note[g.code]]);
        });
      });
    });
    // 일부러 넣은 기록 실수 4건 — 「확인할 것」 이 잡는지 보여 주기 위해
    // 칸 번호: 0 설비 · 1 설비군 · 2 작업자 · 3 날짜 · 4 근무 · 5 구분 · 6 코드 · 7 시작 · 8 종료 · 9 소요 · 10 내용
    function rowsOf(name, date) { var out = [], cur = '', curD = ''; form.forEach(function (r, i) { if (i === 0) return; if (r[0]) cur = r[0]; if (r[3]) curD = r[3]; if (cur === name && curD === date) out.push(i); }); return out; }
    var ix = rowsOf('NC-02', '2026-10-15'); form.splice(ix[ix.length - 1] + 1, 0, ['', '', '', '', '', '비가동', 'G', '09:00', '09:20', 20, '중복 기록 의심']);
    ix = rowsOf('MCT-H', '2026-10-21'); var gapRow = ix.filter(function (i) { return form[i][5] === '가동' && parseTime(form[i][7]).min >= 780; })[0];
    if (gapRow != null) form.splice(gapRow, 1);
    ix = rowsOf('용접로봇-01', '2026-10-08'); var dr = ix.filter(function (i) { return form[i][5] === '비가동'; })[0]; if (dr != null) form[dr][9] = form[dr][9] + 10;
    ix = rowsOf('2공장-NC', '2026-10-22'); var dr2 = ix.filter(function (i) { return form[i][5] === '비가동'; })[0]; if (dr2 != null) form[dr2][6] = '';
    // 2) 작업자 6명 · 작업일보 5일 — 작업자마다 시트, 날짜 블록, 시간은 엑셀 시간값
    var diaryDays = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'];
    var ITEMS = ['프레임 가공', '암 용접', '버킷 용접', '후처리 용접', '보스 가공', '브래킷 제관'];
    var WPROF = [['A', 0.35, 20, 60], ['C', 0.35, 15, 40], ['E', 0.05, 30, 60], ['G', 0.08, 10, 30]];
    var sheetsOut = [{ name: '비가동일보', aoa: form }];
    for (var w = 1; w <= 6; w++) {
      var nm = '작업자' + pad(w), aoa = [[nm + ' 생산작업일보'], []];
      diaryDays.forEach(function (d) {
        var night = rnd() < 0.3, segs = dayTimeline(rnd, night, pickEvents(rnd, WPROF));
        var rests = [[600, 610, '오전 휴식'], [720, 780, '점심'], [900, 910, '오후 휴식']].concat(night ? [[1020, 1050, '저녁']] : []);
        var all = segs.map(function (g) { return { cls: g.cls, code: g.code, s: g.s, e: g.e, note: g.note }; }).concat(rests.map(function (r) { return { cls: 'rest', s: r[0], e: r[1], note: r[2] }; }));
        all.sort(function (a, b) { return a.s - b.s; });
        aoa.push(['작업일자', isoToSerial(d), '', '작업자', nm]);
        aoa.push(['번호', '구분', '코드', '항목', '시작시간', '종료시간', '소요(분)', '작업내용/비가동 사유']);
        var item = ITEMS[(w + diaryDays.indexOf(d)) % ITEMS.length];
        all.forEach(function (g, i) {
          aoa.push([i + 1, g.cls === 'run' ? '가동' : g.cls === 'down' ? '비가동' : '휴게', g.code || '', g.cls === 'rest' ? '' : item,
            round(g.s / 1440, 6), round(g.e / 1440, 6), g.e - g.s, g.cls === 'run' ? item + ' 작업' : g.note || '']);
        });
        aoa.push([]);
      });
      sheetsOut.push({ name: nm, aoa: aoa });
    }
    // 작업자03 10-28 의 한 줄 소요를 틀리게 적는다
    var s3 = sheetsOut[3].aoa, inBlock = false;
    for (var r = 0; r < s3.length; r++) {
      if (s3[r][0] === '작업일자') inBlock = s3[r][1] === isoToSerial('2026-10-28');
      else if (inBlock && s3[r][1] === '가동') { s3[r][6] = s3[r][6] + 15; break; }
    }
    // 3) 수리 · 비가동 이력 — 설비 비가동 B 와 같은 시각
    var rep = [['NO', '시작일자', '완료일자', '구분(설비)', '고장부위', '비가동 시간', '비가동 총시간(hr)', '수리 소요시간(hr)', '생산팀 지원', '현상/원인', '조치내용', '거래처', '비용(원)', '진행현황', '비고']];
    SAMPLE_REPAIRS.forEach(function (x, i) {
      var hr = (parseTime(x.e).min - parseTime(x.s).min) / 60;
      rep.push([i + 1, isoToSerial(x.date), isoToSerial(x.date), x.equip, x.part, x.date.slice(5).replace('-', '.') + ' ' + x.s + ' ~ ' + x.e, i === 2 ? round(hr + 0.5, 2) : round(hr, 2), x.rep, '1명', x.cause, x.action, x.vendor, x.cost, '완료', '']);
    });
    sheetsOut.push({ name: '수리이력', aoa: rep });
    return { sheets: sheetsOut, month: month, workdays: days, note: '예제 데이터는 실제 사내 데이터가 아닙니다(설비 · 작업자 · 수리 이력 모두 만든 값).' };
  }

  /* ---------- AI (선택) ---------- */
  var AI = {
    openai: { model: 'gpt-4o-mini', url: 'https://api.openai.com/v1/chat/completions' },
    anthropic: { model: 'claude-haiku-5-5', url: 'https://api.anthropic.com/v1/messages' }
  };
  function aiPrompt(res, kind) {
    var A = res.kinds[kind];
    var system = '당신은 생산기술팀의 월간 설비 운영실적 보고서 「요약」 문장을 다듬는 편집자입니다. ' +
      '주어진 사실만 쓰고 숫자 · 날짜 · 설비 이름 · 사유를 바꾸거나 새로 만들지 마세요. 원인 추정이나 대책을 지어내지 마세요. ' +
      '보고서 문체로 한 줄에 한 항목, 4~7줄, 각 줄은 「- 」로 시작합니다. 머리말 · 맺음말 없이 줄만 출력하세요.';
    var facts = summaryLines(res, kind).map(function (l) { return '- ' + l; }).join('\n') + '\n\n[대상별]\n' +
      A.bySubject.map(function (s) { return '- ' + s.subject + ': 가동률 ' + pct(s.util) + ', 비가동 ' + fmtH(s.down) + '시간' + (s.top ? ', 주 사유 ' + codeName(s.top) : ''); }).join('\n') +
      '\n\n[사유 파레토]\n' + A.pareto.map(function (p) { return '- ' + codeName(p) + ' ' + fmtH(p.min) + '시간 (' + pct(p.pct) + ', 누적 ' + pct(p.cum) + ')'; }).join('\n');
    return { system: system, user: '다음 규칙 기반 요약을 다듬어 주세요.\n\n' + facts };
  }
  function aiRequest(provider, key, prompt) {
    var p = AI[provider];
    if (!p) throw new Error('알 수 없는 제공자: ' + provider);
    if (provider === 'openai') return { url: p.url, init: { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: p.model, temperature: 0.2, messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }] }) } };
    return { url: p.url, init: { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: p.model, max_tokens: 1024, system: prompt.system, messages: [{ role: 'user', content: prompt.user }] }) } };
  }
  function aiLines(provider, json) {
    var t = '';
    if (provider === 'openai') t = json && json.choices && json.choices[0] && json.choices[0].message ? json.choices[0].message.content : '';
    else t = json && json.content ? json.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n') : '';
    return String(t || '').split(/\r?\n/).map(function (l) { return l.replace(/^\s*[-*•·]\s*|^\s*\d+[.)]\s*/, '').trim(); }).filter(Boolean);
  }

  return {
    DEFAULTS: DEFAULTS, DEFAULT_CODES: DEFAULT_CODES, DEFAULT_WELD_CODES: DEFAULT_WELD_CODES, GROUP_NAME: GROUP_NAME, GROUP_IDS: GROUP_IDS,
    autoGroup: autoGroup, judgeName: judgeName, judgeGroup: judgeGroup, withPlannerEquip: withPlannerEquip, PLANNER_EQUIP: PLANNER_EQUIP, PLANNER_EQUIP_DATE: PLANNER_EQUIP_DATE,
    MACH_WORDS: MACH_WORDS, WELD_WORDS: WELD_WORDS, groupOf: groupOf, keyOf: keyOf, keyLabel: keyLabel, keyName: keyName, planFormula: planFormula, codeName: codeName, TYPES: TYPES, FORM_HEAD: FORM_HEAD, UNKNOWN: UNKNOWN, AI: AI,
    normSettings: normSettings, parseRests: parseRests, shiftInfo: shiftInfo, shiftOf: shiftOf, shiftName: shiftName, codeLabel: codeLabel,
    parseTime: parseTime, parseDate: parseDate, parseRange: parseRange, fmtTime: fmtTime, serialToISO: serialToISO, isoToSerial: isoToSerial, weekday: weekday,
    normCode: normCode, normClass: normClass, extractCodes: extractCodes, overlapMin: overlapMin, unionLen: unionLen,
    detectSheet: detectSheet, parseSheet: parseSheet, merge: merge, analyze: analyze, pareto: pareto, util: util,
    summaryLines: summaryLines, reportHtml: reportHtml, sheets: sheets, toUtilSheet: toUtilSheet, templateSheets: templateSheets, legendRows: legendRows,
    sample: sample, fmtH: fmtH, pct: pct, won: won, round: round, esc: esc, basisText: basisText,
    aiPrompt: aiPrompt, aiRequest: aiRequest, aiLines: aiLines
  };
});
