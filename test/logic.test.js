/* 계산 규칙 고정 — node test/logic.test.js
 * 숫자가 틀리면 안 되는 도구다. 시간 읽기 · 구간 글자 · 휴게 분리 · 가동률 · 파레토 · 코드 뽑기 · 검사 · 형식 판별을
 * 손으로 셀 수 있는 값과 대조한다. */
'use strict';
var D = require('../js/downtime.js');
var passed = 0, failed = 0;
function ok(c, label, detail) { if (c) passed++; else { failed++; console.log('  X ' + label + (detail ? '\n      ' + detail : '')); } }
function eq(g, w, label) { ok(JSON.stringify(g) === JSON.stringify(w), label, '기대: ' + JSON.stringify(w) + '  실제: ' + JSON.stringify(g)); }
function near(g, w, tol, label) { ok(g != null && Math.abs(g - w) <= tol, label, '기대: ' + w + ' ± ' + tol + '  실제: ' + g); }
var S = D.normSettings();
function run(sheets) { // [{name, aoa, type?}] → analyze 결과
  var inp = D.merge(sheets.map(function (s) { return D.parseSheet(s.aoa, s.type || '', { file: 't', sheet: s.name || 's' }, S); }));
  return { inp: inp, res: D.analyze(inp, S) };
}
function has(issues, re) { return issues.some(function (x) { return re.test(x.text); }); }

// 시간 읽기
eq(D.parseTime(0.3333333).min, 480, '엑셀 시간값 0.3333 = 08:00');
eq(D.parseTime(0.5).min, 720, '0.5 = 12:00');
eq(D.parseTime(20 / 24).min, 1200, '20:00 시간값');
eq(D.parseTime('8:05').min, 485, 'H:MM 글자');
eq(D.parseTime('17:30:00').min, 1050, 'HH:MM:SS 글자');
eq(D.parseTime('오후 1:30').min, 810, '오후 표기');
eq(D.parseTime('0830').min, 510, '0830 네 자리');
eq(D.parseTime('9시 15분').min, 555, '「9시 15분」');
eq(D.parseTime(46321.75).min, 1080, '날짜+시각 일련값은 시각만');
eq(D.parseTime('').why, '빈 칸', '빈 칸');
eq(D.parseTime('25:00').ok, false, '25시는 범위 밖');
eq(D.parseTime('점심').ok, false, '글자는 시간이 아님');

// 날짜
eq(D.parseDate(46296), '2026-10-01', '엑셀 날짜 일련번호');
eq(D.isoToSerial('2026-10-01'), 46296, '날짜 → 일련번호');
eq(D.parseDate('2026.10.05'), '2026-10-05', '점 구분 날짜');
eq(D.parseDate('10/7', 2026), '2026-10-07', '연도 없는 날짜는 기준 연도');
eq(D.parseDate('10월 8일', 2026), '2026-10-08', '「10월 8일」');
eq(D.parseDate('2026-02-30'), null, '없는 날짜는 null');

// 구간 글자
var r1 = D.parseRange('10.01 11:00 ~ 11:30', 2026);
eq([r1.ok, r1.minutes, r1.segments[0].startDate], [true, 30, '2026-10-01'], '「10.01 11:00 ~ 11:30」 = 30분');
eq(D.parseRange('10.01 23:00 ~ 10.02 01:30', 2026).minutes, 150, '날짜를 넘는 구간');
eq(D.parseRange('22:00~02:00').minutes, 240, '날짜 없이 자정을 넘으면 +1일');
var r2 = D.parseRange('10.20 13:00 ~ 14:50, 10.21 08:00 ~ 08:30', 2026);
eq([r2.segments.length, r2.minutes], [2, 140], '구간 여러 개는 합');
eq(D.parseRange('수리 중').ok, false, '구간이 없는 글자');

// 기준 · 근무 형태
eq([D.shiftInfo('day', S).recognized, D.shiftInfo('day', S).plan], [480, 460], '주간 인정 8h(480) · 계획 460(휴식 20 제외)');
eq([D.shiftInfo('night', S).recognized, D.shiftInfo('night', S).plan], [630, 610], '주간+야간 인정 10.5h(630) · 계획 610');
eq(D.shiftInfo('day', D.normSettings({ breakMin: 0 })).plan, 480, '휴식 제외 0 이면 계획 = 인정시간');
eq(D.parseRests('12:00-13:00, 17:00-17:30').list, [[720, 780], [1020, 1050]], '휴게 구간 글자');
ok(D.normSettings({ rests: '12:00-11:00' }).errors.length === 1, '거꾸로 된 휴게 구간은 오류');
eq([D.shiftOf('주간+야간'), D.shiftOf('주간'), D.shiftOf('')], ['night', 'day', null], '근무 형태 글자');

// 코드 · 구분
eq([D.normCode('a'), D.normCode('B.장비고장'), D.normCode('제관품무'), D.normCode('지그 교체'), D.normCode(''), D.normCode('Z')], ['A', 'B', 'A', 'C', '', null], '코드 정규화(소문자 · 이름 · 無/무)');
eq([D.normClass('비가동'), D.normClass('가동'), D.normClass('점심'), D.normClass('', 'A'), D.normClass(''), D.normClass('출장')], ['down', 'run', 'rest', 'down', 'run', null], '구분 정규화');
eq(D.extractCodes('150NC: C').pairs, [{ equip: '150NC', code: 'C' }], '「150NC: C」');
eq(D.extractCodes('MCT: A 135NC: A').pairs, [{ equip: 'MCT', code: 'A' }, { equip: '135NC', code: 'A' }], '「MCT: A 135NC: A」 두 묶음');
eq(D.extractCodes('NC-01: A,B').pairs.map(function (p) { return p.code; }), ['A', 'B'], '한 설비에 코드 여러 개');
eq(D.extractCodes('NC-01：장비고장').pairs[0].code, 'B', '전각 콜론 · 사유 이름');
eq(D.extractCodes('C').pairs, [{ equip: '', code: 'C' }], '설비 없이 코드만');
eq(D.extractCodes('NC-01: X').unknown, ['X'], '표에 없는 코드는 따로');

// 가동률 · 파레토
eq(D.util(400, 0), null, '계획 0 이면 가동률 계산 안 함');
eq(D.util(414, 460), 0.9, '가동률 = 가동 ÷ 계획');
var P = D.pareto({ 'mach:A': 60, 'mach:B': 30, 'mach:C': 10, 'mach:D': 0 }, S);
eq(P.map(function (p) { return p.label + ' ' + p.code; }), ['제관품無 가공 A', '장비고장 가공 B', '지그교체 가공 C'], '파레토는 큰 순 · 0 은 뺀다(키는 군:코드, 표시는 이름)');
eq(P.map(function (p) { return D.round(p.cum, 3); }), [0.6, 0.9, 1], '누적 비율 · 마지막은 100%');
eq(D.pareto({ 'mach:C': 20, 'mach:A': 20 }, S).map(function (p) { return p.label; }), ['제관품無', '지그교체'], '같은 시간이면 코드 순');
eq(D.pareto({}, S), [], '비가동이 없으면 빈 파레토');

// 형식 판별
// 설비군 칸이 없는 옛 양식(v1.0)도 그대로 읽는다
var FORM = [['설비', '작업자', '날짜', '근무', '구분', '코드', '시작', '종료', '소요(분)', '내용']];
eq(D.detectSheet(FORM).type, 'form', '입력 양식 머리글 → 비가동 일보');
eq(D.detectSheet([['작업일자', 46296], ['번호', '구분', '코드', '항목', '시작시간', '종료시간', '소요(분)', '작업내용/비가동 사유']]).type, 'diary', '작업일보 머리글');
eq(D.detectSheet([['일자', '작업자명', '시작', '종료', '인정시간(h)', '가동(분)', '휴게(분)', '비가동(분)', 'A(분)']]).type, 'daily', '일일 집계 머리글');
eq(D.detectSheet([['NO', '시작일자', '완료일자', '구분(설비)', '고장부위', '비가동 시간']]).type, 'repair', '수리 이력 머리글');
eq(D.detectSheet([['NC 가공', 46296, 46297, 46298, 46299, 46300], ['계획 시간(분)'], ['가동 시간'], ['비가동 시간'], ['가동률']]).type, 'util', '설비 가동률 블록');
eq(D.detectSheet([['메모'], ['아무 내용']]).type, 'skip', '모르는 시트는 읽지 않음');

// 입력 양식: 휴게 분리 · 비가동만 적은 날 · 윗줄 잇기
var t1 = run([{ aoa: FORM.concat([
  ['NC-01', '', '2026-10-05', '', '비가동', 'A', '11:30', '13:30', '', '입고 대기'], // 점심 60분과 겹친다
  ['', '', '', '', '비가동', 'F', '16:40', '17:00', '', '청소']]) }]);
var d1 = t1.res.kinds.equip.days[0];
eq([d1.down, d1.codes['mach:A'], d1.restCut], [80, 60, 60], '휴게와 겹친 60분은 비가동에서 뺀다');
eq([d1.plan, d1.run, d1.runSrc], [460, 380, 'calc'], '가동을 안 적으면 가동 = 계획 − 비가동');
eq(t1.inp.records[1].subject + ' ' + t1.inp.records[1].date, 'NC-01 2026-10-05', '설비 · 날짜가 비면 윗줄을 잇는다');
var t1b = D.analyze(t1.inp, D.normSettings({ separateRest: false }));
eq(t1b.kinds.equip.days[0].down, 140, '휴게 분리를 끄면 적힌 그대로');

// 검사: 겹침 · 누락 · 소요 불일치 · 코드 없음
var t2 = run([{ aoa: FORM.concat([
  ['R-1', '', '2026-10-06', '주간', '가동', '', '08:00', '10:00', '', ''],
  ['', '', '', '', '비가동', 'C', '09:40', '10:20', 30, '지그'],     // 20분 겹침 · 소요 30 ↔ 40
  ['', '', '', '', '가동', '', '10:20', '12:00', '', ''],
  ['', '', '', '', '가동', '', '13:00', '15:00', '', ''],           // 15:00~17:00 기록 없음
  ['', '', '', '', '비가동', '', '16:50', '17:00', '', '']])}]);  // 코드 없음
var is2 = t2.res.issues;
ok(has(is2, /20분 겹칩니다/), '구간 겹침 검출', JSON.stringify(is2));
ok(has(is2, /소요 기록 30분 ↔ 시간으로 계산 40분/), '소요 불일치 검출');
ok(has(is2, /기록 없는 시간이 110분/), '누락(기록 없는 시간) 검출');
ok(has(is2, /코드가 비었습니다/) && t2.res.kinds.equip.days[0].codes['mach:?'] === 10, '코드 없는 비가동은 미분류');
var t3 = run([{ aoa: FORM.concat([
  ['R-2', '', '2026-10-06', '', '가동', '', '08:00', '10:00', '', ''], ['', '', '', '', '가동', '', '10:10', '12:00', '', ''],
  ['', '', '', '', '가동', '', '13:00', '15:00', '', ''], ['', '', '', '', '가동', '', '15:10', '17:00', '', '']]) }]);
ok(!t3.res.issues.length, '휴식 20분 안의 빈 시간은 누락이 아니다', JSON.stringify(t3.res.issues));
eq([t3.res.kinds.equip.days[0].run, D.round(t3.res.kinds.equip.totals.util, 4)], [460, 1], '빈틈없이 적은 주간 = 가동률 100%');
var t4 = run([{ aoa: FORM.concat([['R-3', '', '2026-10-07', '', '가동', '', '08:00', '20:00', '', '']]) }]);
eq([t4.res.kinds.equip.days[0].shift, t4.res.kinds.equip.days[0].plan, t4.res.kinds.equip.days[0].run], ['night', 610, 630], '20:00 종료는 주간+야간 · 휴게 90분 분리');
ok(has(t4.res.issues, /계획 610분보다 깁니다/), '가동이 계획보다 길면 참고로 알린다');
var t5 = run([{ aoa: FORM.concat([['R-4', '', '날짜?', '', '비가동', 'A', '08:00', '09:00', '', ''], ['R-4', '', '2026-10-07', '', '휴무', 'A', '08:00', '09:00', '', '']]) }]);
ok(has(t5.inp.issues, /날짜를 읽지 못해/) && has(t5.inp.issues, /구분 「휴무」/) && !t5.inp.records.length, '읽지 못한 줄은 사유와 함께 뺀다');

// 작업일보(작업자마다 시트 · 날짜 블록 · 시간값)
var DIARY = [['작업자01 생산작업일보'], ['작업일자', 46296, '', '작업자', '작업자01'],
  ['번호', '구분', '코드', '항목', '시작시간', '종료시간', '소요(분)', '작업내용/비가동 사유'],
  [1, '가동', '', '프레임 가공', 480 / 1440, 600 / 1440, 120, ''], [2, '휴게', '', '', 600 / 1440, 610 / 1440, 10, '오전 휴식'],
  [3, '비가동', 'A', '', 610 / 1440, 670 / 1440, 60, '제관품 입고 대기'], [4, '가동', '', '', 670 / 1440, 720 / 1440, 50, ''],
  [5, '휴게', '', '', 720 / 1440, 780 / 1440, 60, '점심'], [6, '가동', '', '', 780 / 1440, 1020 / 1440, 240, ''], [], ['', '합계', '', '', '', '', 540, ''],
  ['작업일자', '2026-10-02'], ['번호', '구분', '코드', '항목', '시작시간', '종료시간', '소요(분)', '작업내용/비가동 사유'],
  [1, '가동', '', '', 480 / 1440, 1020 / 1440, 540, '']];
var t6 = run([{ name: '작업자01', aoa: DIARY }]);
var W = t6.res.kinds.worker;
eq(W.days.map(function (d) { return d.date; }), ['2026-10-01', '2026-10-02'], '날짜 블록마다 다른 날');
eq([W.days[0].run, W.days[0].down, W.days[0].rest, W.days[0].codes['mach:A']], [410, 60, 70, 60], '작업일보 하루 — 가동 · 비가동 · 휴게(분리)');
eq(W.days[1].run, 480, '휴게를 안 적어도 휴게 구간은 뺀다(540 − 60)');
eq(W.bySubject[0].subject, '작업자01', '작업자 이름은 「작업자」 칸에서');
ok(!t6.inp.records.some(function (r) { return /합계/.test(r.cls); }) && t6.inp.records.length === 7, '합계 줄은 기록이 아니다');

// 일일 집계 — 작업일보와 같은 날이면 두 번 세지 않고 대조만
var DAILY = [['일자', '작업자명', '시작', '종료', '인정시간(h)', '가동(분)', '휴게(분)', '비가동(분)', 'A(분)', 'B(분)'],
  [46296, '작업자01', 0.3333, 17 / 24, 8, 410, 70, 70, 70, ''], [46297, '작업자09', 0.3333, 20 / 24, 10.5, 600, 90, 30, 10, 10]];
var t7 = run([{ name: '작업자01', aoa: DIARY }, { name: '일일집계', aoa: DAILY }]);
var W7 = t7.res.kinds.worker;
eq(W7.days.length, 3, '작업일보 2일 + 일일 집계만 있는 1일');
ok(has(t7.res.issues, /일일 집계 비가동 70분 ↔ 작업일보 60분/), '같은 날 두 자료가 다르면 확인할 것');
ok(has(t7.inp.issues, /코드별 비가동 합 20분 ↔ 비가동 30분/), '일일 집계 코드 합 불일치');
var w9 = W7.days.filter(function (d) { return d.subject === '작업자09'; })[0];
eq([w9.plan, w9.planSrc, w9.shift], [630, 'recorded', 'night'], '일일 집계 계획 = 인정시간(10.5h) 기록값');
var t7s = D.analyze(t7.inp, D.normSettings({ basis: 'shift' }));
eq(t7s.kinds.worker.days.filter(function (d) { return d.subject === '작업자09'; })[0].plan, 610, '근무 형태 기준이면 인정시간 − 휴식');

// 설비 가동률 시트(블록 · 비가동 내역)
var UTIL = [['NC 가공'], ['설비명', 46296, 46297, 46298, 46299, 46300, '총 가동률'],
  ['작업 계획', '주간', '주간+야간', '휴무', '', '주간'], ['계획 시간(분)', 460, 610, 0, '', 460], ['주간(분)', 460, 460, 0, '', 460], ['야간(분)', 0, 150, 0, '', 0],
  ['가동 시간', 400, 610, 0, '', 460], ['비가동 시간', 60, 0, 0, '', 0], ['가동률', 0.8696, 1, '', '', 0.5], ['비가동 내역', 'MCT: A 135NC: C', '', '', '', ''],
  ['※ 오전/오후 휴식시간(각 10분) 제외']];
var t8 = run([{ aoa: UTIL }]);
var E = t8.res.kinds.equip;
eq(E.bySubject[0].subject, 'NC 가공', '머리줄이 「설비명」 이면 위 제목 줄이 설비군 이름');
eq(E.days.map(function (d) { return d.date; }), ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05'], '근무 없는 날(빈 칸)은 뺀다');
eq([E.days[0].codes['mach:A'], E.days[0].codes['mach:C'], E.days[0].est], [30, 30, true], '비가동 내역 묶음 2개 → 반씩 나눔(추정)');
eq(E.days[2].plan === 0 && D.util(E.days[2].run, E.days[2].plan) === null, true, '계획 0 인 날은 가동률 빈칸');
near(E.totals.util, 1470 / 1530, 1e-9, '총 가동률 = 가동 합 ÷ 계획 합');
ok(has(t8.res.issues, /기록된 가동률 50%/), '기록된 가동률이 계산과 다르면 참고로 알린다');

// 수리 이력
var REP = [['NO', '시작일자', '완료일자', '구분(설비)', '고장부위', '비가동 시간', '비가동 총시간(hr)', '수리 소요시간(hr)', '생산팀 지원', '현상/원인', '조치내용', '거래처', '비용(원)', '진행현황', '비고'],
  [1, 46296, 46296, 'MCT-H', '주축', '10.01 11:00 ~ 11:30', 0.5, 0.4, '1명', '알람', '교체', '가상정비', '350,000', '완료', ''],
  [2, 46297, 46298, 'MCT-H', 'ATC', '10.02 16:00 ~ 10.03 09:00', 3, 2, '', '', '', '', 100000, '진행', '']];
var t9 = run([{ aoa: REP }]);
eq([t9.res.repairs.n, t9.res.repairs.byEquip[0].cost, D.round(t9.res.repairs.downHr, 2)], [2, 450000, 17.5], '수리 이력 합계(구간 계산 우선 · 비용 쉼표)');
ok(has(t9.res.issues, /기록 3h ↔ 구간으로 계산 17h/), '총시간 기록과 구간 계산이 다르면 확인할 것');

// 예제 전체 — 같은 경로로 읽는다
var s = D.sample();
var det = s.sheets.map(function (x) { return D.detectSheet(x.aoa, x.name).type; });
eq(det, ['form', 'diary', 'diary', 'diary', 'diary', 'diary', 'diary', 'repair'], '예제 시트 형식 자동 판별');
var all = run(s.sheets.map(function (x) { return { name: x.name, aoa: x.aoa }; }));
var EQ = all.res.kinds.equip, WK = all.res.kinds.worker;
eq([EQ.totals.subjects, EQ.totals.dates, WK.totals.subjects, WK.totals.dates], [6, 21, 6, 5], '예제: 설비 6대 × 10월 근무일 21일 · 작업자 6명 × 5일');
eq([EQ.pareto[0].label, EQ.pareto[0].code], ['제관품無', '가공 A · 용접 B'], '예제 파레토 1위는 제관품無(가공 A · 용접 B 합산)');
ok(EQ.totals.util > 0.8 && EQ.totals.util < 0.95, '예제 가동률이 현실적인 범위', EQ.totals.util);
eq(EQ.bySubject.reduce(function (a, x) { return a + x.down; }, 0), EQ.totals.down, '설비별 비가동 합 = 전체 비가동');
eq(EQ.matrix.reduce(function (a, r) { return a + r.cells.reduce(function (b, v) { return b + v; }, 0); }, 0), EQ.totals.down, '설비×사유 표 합 = 전체 비가동');
eq(EQ.byDate.reduce(function (a, x) { return a + x.plan; }, 0), EQ.totals.plan, '일별 계획 합 = 전체 계획');
var wn = all.res.issues.filter(function (x) { return x.level === 'warn'; }).map(function (x) { return x.text; }).join('\n');
ok(/겹칩니다/.test(wn) && /기록 없는 시간/.test(wn) && /소요 기록/.test(wn) && /코드가 비었습니다/.test(wn) && /총시간 기록/.test(wn), '예제에 넣은 기록 실수 5종을 모두 잡는다', wn);
var B = EQ.pareto.filter(function (p) { return p.label === '장비고장'; })[0];
eq(B.min, s.sheets[7].aoa.slice(1).reduce(function (a, r) { return a + D.parseRange(r[5], 2026).minutes; }, 0), '예제 장비고장(B) 시간 = 수리 이력 구간 합');
eq(D.sample().sheets[0].aoa.length, s.sheets[0].aoa.length, '예제는 시드 고정 — 다시 만들어도 같다');


// v1.1 — 설비군별 사유 코드(기획자 답: 가공 A~G · 용접 A~H)
eq(['용접로봇-01', 'ROB-3', 'ABB 2호', 'KOBE-1', '야스카와 L', 'NC-01', 'MCT-H', '2공장-NC'].map(D.autoGroup), ['weld', 'weld', 'weld', 'weld', 'weld', 'mach', 'mach', 'mach'], '설비 이름으로 설비군 판정');
eq(D.groupOf('NC-01', D.normSettings({ equipGroups: { 'NC-01': 'weld' } })), 'weld', '화면에서 고친 설비군이 이름 판정보다 먼저');
eq(S.weldCodes.map(function (c) { return c.code + c.label; }).join(' '), 'A제관품대기 B제관품無 C장비고장 D티칭수정 E계획정지 F공정결원 G청소 H기타', '용접설비 코드표 A~H');
eq(S.codes.map(function (c) { return c.code + c.label; }).join(' '), 'A제관품無 B장비고장 C지그교체 D계획정지 E공정결원 F청소 G기타', '가공설비 코드표 A~G');
var NEWF = [D.FORM_HEAD];
var g1 = run([{ aoa: NEWF.concat([
  ['NC-01', '', '', '2026-10-05', '', '비가동', 'C', '09:00', '09:20', '', ''],       // 가공 C = 지그교체
  ['용접로봇-01', '', '', '2026-10-05', '', '비가동', 'C', '09:00', '09:30', '', ''], // 용접 C = 장비고장
  ['', '', '', '', '', '비가동', 'D', '10:30', '10:40', '', ''],                      // 용접 D = 티칭수정(윗줄 설비 잇기)
  ['NC-02', '', '', '2026-10-05', '', '비가동', 'B', '13:00', '13:40', '', ''],       // 가공 B = 장비고장
  ['NC-09', '용접', '', '2026-10-05', '', '비가동', 'D', '14:00', '14:15', '', ''],   // 설비군 칸이 이름 판정보다 먼저
  ['NC-03', '', '', '2026-10-05', '', '비가동', 'H', '15:00', '15:05', '', '']])}]); // 가공에는 H 가 없다
var G = g1.res.kinds.equip, byLab = {};
G.pareto.forEach(function (p) { byLab[p.label] = p; });
eq(g1.inp.records.map(function (r) { return r.code; }), ['mach:C', 'weld:C', 'weld:D', 'mach:B', 'weld:D', 'mach:?'], '집계 키는 군:코드');
eq(byLab['지그교체'] && byLab['지그교체'].min, 20, '용접 C 는 지그교체로 세지 않는다(가공 C 20분만)');
eq(byLab['장비고장'] && [byLab['장비고장'].min, byLab['장비고장'].code], [70, '가공 B · 용접 C'], '장비고장은 가공 B + 용접 C 를 합치고 출처를 보인다');
eq(byLab['티칭수정'] && byLab['티칭수정'].min, 25, '용접 D 티칭수정(윗줄 설비 잇기 · 설비군 칸)');
ok(has(g1.inp.issues, /H」 가 가공설비 사유 코드 표에 없습니다/), '그 군 코드표에 없는 글자는 미분류 + 확인할 것');
var g3 = run([{ aoa: NEWF.concat([['ABB-2', '', '', '2026-10-06', '', '비가동', 'H', '09:00', '09:10', '', ''], ['', '', '', '', '', '비가동', '티칭 수정', '10:00', '10:20', '', '']]) }]);
eq(g3.inp.records.map(function (r) { return r.code; }).concat(g3.inp.issues.length), ['weld:H', 'weld:D', 0], '용접설비는 용접 코드표로 읽는다(H · 사유 이름)');
var jig = G.codeCols.filter(function (c) { return c.label === '지그교체'; })[0], brk = G.codeCols.filter(function (c) { return c.label === '장비고장'; })[0];
var robotRow = G.matrix.filter(function (r) { return r.subject === '용접로봇-01'; })[0];
eq([robotRow.cells[G.codeCols.indexOf(jig)], robotRow.cells[G.codeCols.indexOf(brk)]], [0, 30], '설비×사유 표: 로봇의 C 는 장비고장 열에');
eq(D.analyze(g1.inp, D.normSettings({ equipGroups: { 'NC-01': 'weld' } })).kinds.equip.pareto.filter(function (p) { return p.label === '지그교체'; }).length, 1, '설정만 바꿔서는 이미 읽은 기록의 군이 바뀌지 않는다(다시 읽어야 한다)');
var g2 = D.merge([D.parseSheet(NEWF.concat([['NC-01', '', '', '2026-10-05', '', '비가동', 'C', '09:00', '09:20', '', '']]), 'form', {}, D.normSettings({ equipGroups: { 'NC-01': 'weld' } }))]);
eq(g2.records[0].code, 'weld:C', '설비군을 용접으로 고친 뒤 다시 읽으면 C = 장비고장');
var gu = run([{ aoa: [['용접로봇-01', 46296, 46297, 46298, 46299, 46300], ['계획 시간(분)', 460], ['가동 시간', 420], ['비가동 시간', 40], ['가동률', ''], ['비가동 내역', '용접로봇-01: D']] }]);
eq(Object.keys(gu.res.kinds.equip.days[0].codes), ['weld:D'], '가동률 시트의 로봇 블록 「D」 는 티칭수정');
eq(D.planFormula(S), '08:00~17:00 근무 540분 − 점심 등 휴게 60분 − 쉬는 시간 20분 = 460분', '가동률 기준 식(8to5 = 460분)');
eq(D.shiftInfo('day', D.normSettings({ breakMin: 30 })).plan, 450, '쉬는 시간을 바꾸면 계획도 바뀐다');
// 예제: 로봇은 용접 코드표를 쓴다
var robots = EQ.bySubject.filter(function (x) { return x.group === 'weld'; }).map(function (x) { return x.subject; });
eq(robots, ['용접로봇-01', '용접로봇-02'], '예제 로봇 2대는 용접설비');
ok(EQ.pareto.some(function (p) { return p.label === '티칭수정' && p.code === '용접 D' && p.min > 0; }), '예제에 티칭수정(용접 D)');
ok(all.inp.records.filter(function (r) { return r.group === 'weld' && r.code; }).every(function (r) { return /^weld:/.test(r.code); }) &&
   EQ.matrix.filter(function (r) { return r.group === 'weld'; }).every(function (r) { return r.cells[EQ.codeCols.indexOf(EQ.codeCols.filter(function (c) { return c.label === '지그교체'; })[0])] === 0; }), '예제 로봇에는 지그교체가 없다');

// 가동률 양식으로 내보낸 뒤 다시 읽으면 같은 값
var us = D.toUtilSheet(EQ, '2026-10', S);
eq(D.detectSheet(us).type, 'util', '내보낸 가동률 양식은 설비 가동률로 판별');
var back = D.analyze(D.parseSheet(us, 'util', { sheet: '가동률' }, S), S).kinds.equip;
eq([back.totals.plan, D.round(back.totals.run, 1), D.round(back.totals.down, 1)], [EQ.totals.plan, D.round(EQ.totals.run, 1), D.round(EQ.totals.down, 1)], '가동률 양식 왕복: 계획 · 가동 · 비가동 합이 같다');
eq(back.bySubject.map(function (x) { return D.round(x.util, 4); }), EQ.bySubject.map(function (x) { return D.round(x.util, 4); }), '가동률 양식 왕복: 설비별 가동률이 같다');

// 문장 · 보고서 · 엑셀 · 양식
var L = D.summaryLines(all.res, 'equip');
ok(L.length >= 5 && /가동률은 \d+\.\d%/.test(L[0]) && /상위 사유는 제관품無\(가공 A · 용접 B\)/.test(L[1]), '규칙 요약 문장', L.join(' / '));
ok(/목표 가동률 85%에 못 미친 설비는 NC-02/.test(L.join('\n')), '목표 미달 설비를 이름으로 짚는다', L.join(' / '));
var html = D.reportHtml(all.res, 'equip', { charts: { bar: '<svg id="b"></svg>' } });
ok(/2026년 10월 설비 운영실적 보고/.test(html) && /<svg id="b">/.test(html) && /확인할 것\(\d+건\)/.test(html), '보고서 HTML(제목 · 그림 · 확인할 것)');
ok(/svg \.bar\{fill:/.test(html) && /svg \.l-cum\{fill:none/.test(html), '보고서는 화면 CSS 없이도 그림 색을 갖는다(그림 규칙 동봉)');
ok(/AI 초안 — 검토 필요/.test(D.reportHtml(all.res, 'equip', { aiLines: ['- 가'] })) && !/AI 초안/.test(html), 'AI 문장을 쓸 때만 「AI 초안」 표시');
ok(D.reportHtml(all.res, 'equip', { team: '<b>x</b>' }).indexOf('<b>x</b>') < 0, '보고서 글자는 이스케이프');
ok(html.indexOf('540분 − 점심 등 휴게 60분 − 쉬는 시간 20분 = 460분') >= 0 && /티칭수정/.test(html) && /가공 B · 용접 C/.test(html), '보고서에 460분 식 · 설비군별 코드 출처');
var sh = D.sheets(all.res);
['요약', '설비별', '사유별', '일별', '월별', '설비x사유', '일자별상세', '가동률양식_2026-10', '확인할것', '수리이력', '기준', '작업자별', '사유별(작업자)'].forEach(function (n) { ok(Array.isArray(sh[n]) && sh[n].length > 1, '엑셀 시트 ' + n); });
ok(sh['일자별상세'][0].indexOf('용접 D 티칭수정(분)') >= 0 && sh['일자별상세'][0].indexOf('가공 C 지그교체(분)') >= 0, '엑셀 일자별상세 열 키는 군+코드');
ok(sh['기준'].some(function (r) { return r[0] === '용접설비' && r[1] === 'H'; }), '엑셀 기준 시트에 용접 코드표');
ok(Object.keys(sh).every(function (n) { return n.length <= 31 && !/[\\\/?*\[\]:]/.test(n); }), '시트 이름은 31자 이내 · 금지 글자 없음');
var tp = D.templateSheets(S);
eq(tp['비가동일보'][0], D.FORM_HEAD, '빈 양식 머리글');
ok(tp['범례'].some(function (r) { return r[0] === '가공설비' && r[1] === 'A' && r[2] === '제관품無'; }) && tp['범례'].some(function (r) { return r[0] === '용접설비' && r[1] === 'D' && r[2] === '티칭수정'; }), '범례 시트에 설비군별 사유 코드');
ok(tp['범례'].some(function (r) { return /460분/.test(r.join(' ')); }), '범례에 가동률 기준 식(460분)');
var custom = D.normSettings({ codes: [{ code: 'A', label: '자재대기' }, { code: 'H', label: '정전' }] });
eq(D.templateSheets(custom)['범례'].slice(1, 3).map(function (r) { return r[1]; }), ['A', 'H'], '고친 사유 코드 표가 양식에 반영');
eq(D.normCode('정전', custom.codes), 'H', '고친 코드 표로 읽는다');

// AI 요청 모양(보내지는 않는다)
var rq = D.aiRequest('anthropic', 'k', D.aiPrompt(all.res, 'equip'));
var body = JSON.parse(rq.init.body);
ok(rq.init.headers['x-api-key'] === 'k' && rq.init.headers['anthropic-dangerous-direct-browser-access'] === 'true' && body.model === 'claude-haiku-5-5', 'Anthropic 요청 머리');
ok(JSON.parse(D.aiRequest('openai', 'k', { system: 's', user: 'u' }).init.body).model === 'gpt-4o-mini', 'OpenAI 모델');
eq(D.aiLines('openai', { choices: [{ message: { content: '- 가\n2) 나\n\n' } }] }), ['가', '나'], 'AI 응답에서 줄만 뽑기');

// v1.2 — 기획자 실제 설비 이름(부록 C)으로 설비군 판정. 설비 라인 이름일 뿐 개인정보 · 실데이터가 아니다.
var MACH10 = ['호리젠탈', '135 NC', '150NC', '130NC(1호기)', '130NC(2호기)', '130NC(3호기)', 'MCT', '5호 밀링', '110NC', '130NC(4호기)'];
var WELD20 = ['MAIN 1호기', 'MAIN 2호기', 'BOOM 1호기', 'BOOM 2호기', 'TRACK 1호기', 'TRACK 2호기', 'TRACK 3호기', 'TRACK 4호기', 'TRACK 5호기', 'SUB 1호기', 'SUB 2호기', 'SUB 3호기',
  'CHASSIS 1호기', 'CHASSIS 2호기', 'ARM 1호기', 'ARM 2호기', 'BUCKET 1호기', 'BUCKET 2호기', 'BLADE 1호기', 'BLADE 2호기'];
eq(MACH10.map(D.autoGroup), MACH10.map(function () { return 'mach'; }), '기획자 가공설비 10대 → 가공');
eq(WELD20.map(D.autoGroup), WELD20.map(function () { return 'weld'; }), '기획자 용접설비 20대 → 용접(MAIN · BOOM · TRACK · SUB · CHASSIS · ARM · BUCKET · BLADE)');
ok(MACH10.concat(WELD20).every(function (n) { return D.judgeName(n).sure; }), '30대 전부 확인 필요 없이 판정');
eq(['main1호기', 'Boom 2', 'TRACK5', 'sub 3 호기', 'chassis-1', 'Arm2호기', 'BUCKET_1', 'blade 2호기'].map(D.autoGroup), ['weld', 'weld', 'weld', 'weld', 'weld', 'weld', 'weld', 'weld'], '대소문자 · 띄어쓰기 · 「호기」 유무 무관');
eq(['WARM-1', 'SUBSTATION', 'CHARM', 'TRACKER'].map(D.autoGroup), ['mach', 'mach', 'mach', 'mach'], '영문 낱말 속에 든 ARM · SUB · TRACK 은 걸리지 않는다');
eq(['CNC 선반', '머시닝센터 2', 'NC-01', 'MCT-H', '2공장-NC', 'FANUC R-2000'].map(D.autoGroup), ['mach', 'mach', 'mach', 'mach', 'mach', 'weld'], '가공 낱말 명시(CNC · 선반 · 머시닝) · FANUC 에는 NC 가 없다');
var jm = D.judgeName('NC 용접기'), jm2 = D.judgeName('MAIN 1호기 MCT');
eq([jm.group, jm.sure, jm2.group, jm2.sure], ['mach', false, 'mach', false], '가공 · 용접 낱말이 둘 다 있으면 확인 필요(가공으로 셈)');
eq(D.judgeGroup('NC 용접기', D.normSettings({ equipGroups: { 'NC 용접기': 'weld' } })).src, 'setting', '확인 필요라도 기준 설정에서 고르면 그 값');
var amb = run([{ aoa: NEWF.concat([['NC 용접기', '', '', '2026-10-05', '', '비가동', 'C', '09:00', '09:20', '', ''], ['MAIN 1호기', '', '', '2026-10-05', '', '비가동', 'C', '09:00', '09:20', '', '']]) }]);
ok(amb.res.issues.filter(function (x) { return x.level === 'warn' && /설비군을 정하지 못했습니다/.test(x.text) && x.where === 'NC 용접기'; }).length === 1, '확인 필요 설비는 확인할 것에 한 번(이름과 함께)', JSON.stringify(amb.res.issues));
eq(amb.inp.records.map(function (r) { return r.code; }), ['mach:C', 'weld:C'], '확인 필요는 가공으로 세고 MAIN 1호기는 용접 C(장비고장)');
var amb2 = run([{ aoa: NEWF.concat([['NC 용접기', '용접', '', '2026-10-05', '', '비가동', 'C', '09:00', '09:20', '', '']]) }]);
ok(!has(amb2.res.issues, /설비군을 정하지 못했습니다/) && amb2.inp.records[0].code === 'weld:C', '양식의 설비군 칸으로 정해지면 확인 필요가 아니다');
var amb3 = D.analyze(amb.inp, D.normSettings({ equipGroups: { 'NC 용접기': 'weld' } }));
ok(!has(amb3.issues, /설비군을 정하지 못했습니다/), '기준 설정에서 고르면 확인할 것에서 빠진다');
eq(D.PLANNER_EQUIP.length + ':' + D.PLANNER_EQUIP.filter(function (e) { return e.group === 'mach'; }).length + ':' + D.PLANNER_EQUIP.filter(function (e) { return e.group === 'weld'; }).length, '30:10:20', '기획자 설비 목록 가공 10 · 용접 20');
eq(D.PLANNER_EQUIP.map(function (e) { return e.name; }), MACH10.concat(WELD20), '기획자 설비 목록 이름이 댓글 순서 그대로');
var wp = D.withPlannerEquip({ 'MCT': 'weld', 'NC-01': 'mach' });
eq([wp.added, wp.total, wp.equipGroups['MCT'], wp.equipGroups['MAIN 1호기'], Object.keys(wp.equipGroups).length], [29, 30, 'weld', 'weld', 31], '불러오기는 이미 있는 이름을 덮어쓰지 않는다(MCT 는 고른 값 그대로)');
eq(D.withPlannerEquip(wp.equipGroups).added, 0, '두 번 눌러도 더 늘지 않는다');
var lg = D.legendRows(S), lgi = lg.findIndex(function (r) { return /^기획자 설비 목록\(2026-11\)/.test(String(r[0])); });
ok(lgi > 0 && lg.slice(lgi + 1, lgi + 31).map(function (r) { return r[0] + '=' + r[1]; }).join(',') === D.PLANNER_EQUIP.map(function (e) { return e.name + '=' + D.GROUP_NAME[e.group]; }).join(','), '범례 시트에 기획자 설비 목록 30대와 설비군');
ok(/MAIN · BOOM · TRACK/.test(lg.filter(function (r) { return r[0] === '설비군'; }).map(function (r) { return r[1]; }).join('')) && /NC · CNC · MCT/.test(lg.filter(function (r) { return r[0] === '설비군'; }).map(function (r) { return r[1]; }).join('')), '범례 설비군 설명에 새 판정 낱말');
eq(['용접로봇-01', '용접로봇-02'].map(D.autoGroup), ['weld', 'weld'], '예제 용접로봇-01/02 는 여전히 용접');
eq(EQ.bySubject.filter(function (x) { return x.group === 'weld'; }).map(function (x) { return x.subject; }), ['용접로봇-01', '용접로봇-02'], '예제 설비군 판정이 v1.1 과 같다');


/* ===================== v1.3 — 스캔본 읽기(js/scanread.js) ===================== */
var v12 = passed + failed;
var S = require('../js/scanread.js');
function hasS(t, sub, label) { ok(String(t).indexOf(sub) >= 0, label, '「' + sub + '」 없음: ' + String(t).slice(0, 160)); }
// 값 읽기
eq([S.time('[10]:[00]'), S.time('1030'), S.time('오후 1:30'), S.time('8시'), S.time('25:00'), S.time('')], ['10:00', '10:30', '13:30', '08:00', null, null], '시각 읽기(괄호 · 네 자리 · 오후 · 시)');
eq([S.date('2026년 11월 3일'), S.date('2026-11-03'), S.date('20261103'), S.date('11월 3일')], ['2026-11-03', '2026-11-03', '2026-11-03', null], '날짜 읽기');
eq([S.code(' b '), S.code('C)'), S.code('z'), S.code('')], ['B', 'C', '', ''], '범례 글자');
// 지시문 · 요청 모양
var pr = S.prompt('');
hasS(pr.system, 'null 로 두고', '지시문: 못 읽은 칸은 null'); hasS(pr.system, 'JSON 하나만', '지시문: JSON 만'); hasS(pr.user, '어느 것인지 먼저 정하고', '양식 자동 판단'); hasS(S.prompt('weld').user, '자동용접 ROBOT 가동일보', '양식 힌트');
var rq = S.request('openai', 'k', [{ mime: 'image/jpeg', base64: 'AAAA' }], pr), body = JSON.parse(rq.init.body);
eq([body.model, body.messages[1].content.length, body.messages[1].content[1].type], ['gpt-4o-mini', 2, 'image_url'], 'OpenAI 요청: 사진은 image_url');
ok(/^Bearer k$/.test(rq.init.headers.Authorization), 'OpenAI 키 헤더');
var rqa = S.request('anthropic', 'k', [{ mime: 'application/pdf', base64: 'AAAA' }, { mime: 'image/png', base64: 'BBBB' }], pr), ba = JSON.parse(rqa.init.body);
eq([ba.model, ba.messages[0].content.map(function (c) { return c.type; })], ['claude-haiku-5-5', ['document', 'image', 'text']], 'Anthropic 요청: PDF 는 document · 사진은 image');
var thrown = ''; try { S.request('openai', 'k', [{ mime: 'application/pdf', base64: 'A' }], pr); } catch (e) { thrown = e.message; } hasS(thrown, 'PDF', 'OpenAI 에 PDF 는 거절');
thrown = ''; try { S.request('openai', 'k', [], pr); } catch (e) { thrown = e.message; } hasS(thrown, '파일이 없습니다', '파일 없으면 거절');
eq(S.extractText('openai', { choices: [{ message: { content: 'x' } }] }), 'x', 'OpenAI 답 글'); eq(S.extractText('anthropic', { content: [{ type: 'text', text: 'y' }] }), 'y', 'Anthropic 답 글');
// 답 읽기
eq(S.parseReply('그냥 글').error, 'AI 답에서 JSON 을 찾지 못했습니다.', 'JSON 없음'); eq(S.parseReply('{"a":1,}').error.indexOf('읽지 못했습니다') >= 0, true, '깨진 JSON'); eq(S.parseReply('{"x":1}').error, 'AI 답에 pages 가 없습니다.', 'pages 없음');
var one = S.parseReply('설명 {"form":"mach","equipment":"150NC","date":"2026년 11월 3일","downtime":[{"no":1,"code":"b","start":"[10]:[00]","end":"1100","note":"대기"}]} 끝');
eq([one.error, one.pages.length, one.pages[0].date, one.pages[0].downtime[0].code, one.pages[0].downtime[0].start, one.pages[0].downtime[0].end], ['', 1, '2026-11-03', 'B', '10:00', '11:00'], '한 장 모양도 pages 로 · 값 정리');
var r = S.parseReply(S.sampleReply());
eq([r.error, r.pages.length, r.pages[0].form, r.pages[1].form], ['', 2, 'mach', 'weld'], '예제 답 2장');
eq([r.pages[1].downtime.length, r.pages[1].work.length, r.pages[1].downtime.map(function (d) { return d.code; })], [2, 3, ['D', 'C']], '용접: 범례 적힌 생산 줄은 비가동으로 옮긴다');
eq(S.normalizePage({ equipment: '트랙 2', downtime: [] }).form, 'weld', 'form 없으면 설비 이름(트랙)으로 용접');
eq(S.normalizePage({ form: 'weld', checks: [{ item: 'TCP', status: '비정상(수리)' }] }).checks[0].status, '비정상', '점검 상태');
// 검사
var bad = S.normalizePage({ form: 'mach', equipment: '', date: '11월 3일', start: '8시', end: '다섯시', downtime: [{ no: 1, code: 'H', start: '10:00', end: '09:00' }, { no: 2, code: 'B', start: '10:00', end: '11:00' }, { no: 3, code: 'B', start: '10:30', end: '11:30', note: '' }, { no: 4, code: '', start: '', end: '11:00' }], unreadable: ['특이사항'], confidence: 'low' });
var iss = S.validate(bad, { mach: ['A', 'B'] }).map(function (x) { return x.what; }).join(' / ');
hasS(iss, '설비명(트랙)이 비어', '검사: 설비 없음'); hasS(iss, '작업일자를 읽지 못했습니다: 11월 3일', '검사: 날짜'); hasS(iss, '종료시간을 시각으로 읽지 못했습니다: 다섯시', '검사: 종료시간');
hasS(iss, '범례 H 은 가공설비 코드표에 없습니다', '검사: 코드표에 없는 범례'); hasS(iss, '종료가 시작보다 빠르거나', '검사: 역순'); hasS(iss, '2줄(10:00~11:00)과 시간이 겹칩니다', '검사: 겹침'); hasS(iss, '범례 코드가 없습니다', '검사: 코드 없음'); hasS(iss, '시작 시각을 읽지 못했습니다', '검사: 시각 없음');
hasS(iss, '읽지 못한 칸: 특이사항', '검사: AI 가 못 읽은 칸'); hasS(iss, '확신이 낮습니다', '검사: 확신 낮음');
eq(S.validate(r.pages[0], { mach: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] }).length, 0, '예제 1장은 확인할 것 없음');
eq(S.validate(S.blankPage('mach')).length, 5, '빈 장은 설비 · 날짜 · 코드 · 시작 · 종료 확인');
// 입력 양식으로
var rows = S.toFormRows(r.pages, { mach: { '제관품無': 'A', '장비고장': 'B' }, weld: { '장비고장': 'C', '티칭수정': 'D' } });
eq(rows[0], S.FORM_HEAD, '입력 양식 머리글'); eq(rows.length, 1 + 4 + 5, '가공 4줄(비가동 1 · 가동 3) + 용접 5줄(비가동 2 · 가동 3)');
eq(rows[1].slice(0, 10), ['150NC', '가공', '작업자01', '2026-11-03', '주간', '비가동', 'A', '10:00', '11:00', 60], '가공 비가동: 범례 이름(제관품無)으로 집계 코드 A 로 바꿈 · 소요 60');
hasS(rows[1][10], '제관품無 — 제관품 입고 대기', '내용에 범례 이름 + 내역'); eq(rows[2][5], '가동', '작업 줄은 가동');
eq([rows[5][0], rows[5][4], rows[5][6], rows[6][6]], ['트랙 3', '주간+야간', 'D', 'C'], '용접: 20:00 종료는 주간+야간 · 코드 D · C');
eq(S.toFormRows([S.blankPage('weld')]).length, 2, '빈 장은 안내 한 줄'); hasS(S.toFormRows([S.blankPage('weld')])[1][10], '읽은 줄 없음', '빈 장 안내');
eq(S.toFormRows(r.pages)[1][6], 'B', '코드표 없으면 양식 글자 그대로');
eq(S.summary(r.pages), { pages: 2, downtime: 3, work: 6, downMinutes: 130 }, '요약: 비가동 60+30+40 = 130분');
// 집계 엔진이 그대로 읽는다
var det = D.detectSheet(rows, '비가동일보'); eq(det.type, 'form', '변환한 줄을 집계 엔진이 입력 양식으로 판별');

console.log('v1.0~1.2 ' + v12 + ' · v1.3 ' + (passed + failed - v12) + '개 검사');

console.log('\n계산 통과 ' + passed + ' · 실패 ' + failed);
process.exit(failed ? 1 : 0);
