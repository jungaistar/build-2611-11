/* 브라우저에 실제로 띄워 화면이 그려지는지 본다 — node test/smoke.browser.js
 * 규칙 테스트가 다 통과해도 app.js 오타 하나면 빈 화면이 된다. playwright 가 없으면 건너뛴다. */
'use strict';
var http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
var chromium;
try { chromium = require('playwright').chromium; }
catch (e) { console.log('playwright 가 없어 화면 연기 테스트를 건너뜁니다.'); process.exit(0); }
var XLSX = require('../lib/xlsx.full.min.js');
var ROOT = path.join(__dirname, '..');
var Scan_sample = require('../js/scanread.js').sampleReply();
var MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
var srv = http.createServer(function (q, s) {
  var p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, function (e, b) { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); s.end(b); });
});
var passed = 0, failed = 0, v12;
function ok(c, label, d) { if (c) passed++; else { failed++; console.log('  X ' + label + (d ? '  ' + d : '')); } }
var count = function (pg, sel) { return pg.$$eval(sel, function (t) { return t.length; }); };
srv.listen(0, async function () {
  var base = 'http://127.0.0.1:' + srv.address().port + '/';
  var br = await chromium.launch(); var ctx = await br.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  var pg = await ctx.newPage();
  var errs = []; pg.on('pageerror', function (e) { errs.push(e.message); });
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-smoke-'));
  async function save(btn, name) { var d = await Promise.all([pg.waitForEvent('download'), pg.click(btn)]); var f = path.join(tmp, name || d[0].suggestedFilename()); await d[0].saveAs(f); return { file: f, name: d[0].suggestedFilename() }; }
  try {
    await pg.goto(base);
    ok(await pg.isHidden('#s-dash'), '처음에는 대시보드가 숨어 있다');
    await pg.click('#btn-sample');
    await pg.waitForSelector('#kpi .kpi', { timeout: 5000 });
    ok(await count(pg, '#files .sheets li') === 8, '예제 시트 8장이 형식과 함께 보인다');
    ok(/작업자별 작업일보/.test(await pg.textContent('#files')) && /수리/.test(await pg.textContent('#files')), '시트 형식 자동 판별 표시');
    ok(await count(pg, '#kpi .kpi') === 4, 'KPI 카드 4개(계획 · 가동 · 비가동 · 가동률)');
    var util1 = await pg.textContent('#kpi .kpi:nth-child(4) b');
    ok(/^\d+\.\d%$/.test(util1), '가동률 숫자', util1);
    ok(await count(pg, '#bar-chart rect.bar') === 6, '설비별 가동률 막대 6개');
    ok(await count(pg, '#bar-chart rect.bar.lo') >= 1, '목표 미달 설비는 다른 색');
    var np = await count(pg, '#pareto rect.bar');
    ok(np >= 6 && await count(pg, '#pareto circle.cum') === np, '파레토 막대와 누적 점', np);
    ok((await pg.textContent('#pareto-tbl tbody tr:first-child td:nth-child(2)')).trim() === '제관품無' && /가공 A · 용접 B/.test(await pg.textContent('#pareto-tbl tbody tr:first-child')), '파레토 1위 제관품無(가공 A · 용접 B 합산)');
    ok(/티칭수정/.test(await pg.textContent('#pareto-tbl')) && /용접 D/.test(await pg.textContent('#pareto-tbl')), '로봇 사유는 용접 코드표(티칭수정 · 용접 D)');
    ok(/용접설비/.test(await pg.textContent('#by-tbl')) && /가공설비/.test(await pg.textContent('#by-tbl')), '설비별 표에 설비군');
    ok(/가공 B · 용접 C/.test(await pg.textContent('#matrix thead')), '설비×사유 표 머리에 군별 코드 출처');
    ok(await count(pg, '#trend circle.pt') === 21, '일별 추이 21일');
    ok(await count(pg, '#matrix tbody tr') === 6, '설비 × 사유 표 6줄');
    ok(await count(pg, '#issues .lv.warn') >= 5, '확인할 것(겹침 · 누락 · 소요 · 코드 없음 · 수리 총시간)');
    ok(/겹칩니다/.test(await pg.textContent('#issues')) && /기록 없는 시간/.test(await pg.textContent('#issues')), '겹침 · 누락 문장');
    // 작업자별 보기
    await pg.selectOption('#kind', 'worker');
    ok(await count(pg, '#bar-chart rect.bar') === 6 && await count(pg, '#trend circle.pt') === 5, '작업자별 보기 6명 · 5일');
    ok(/작업자별 가동률/.test(await pg.textContent('#bar-title')), '작업자 보기 제목');
    await pg.selectOption('#kind', 'equip');
    // 기준을 바꾸면 다시 계산된다
    await pg.click('#set-box summary');
    await pg.fill('#set-breakMin', '0'); await pg.dispatchEvent('#set-breakMin', 'change');
    ok(/480분/.test(await pg.textContent('#shift-info')), '휴식 0 이면 주간 계획 480분');
    await pg.click('#btn-defset');
    ok(/540분 − 점심 등 휴게 60분 − 쉬는 시간 20분 = 460분/.test(await pg.textContent('#plan-formula')), '가동률 기준 식(8to5 = 460분)이 화면에');
    ok(await count(pg, '#codes tbody tr') === 7 && await count(pg, '#codes-weld tbody tr') === 8, '코드표 가공 7 · 용접 8');
    ok(await count(pg, '#group-tbl select') === 12, '설비군 표에 설비 6 · 작업자 6');
    // v1.2 기획자 설비 목록 불러오기 → 30대가 군과 함께 표에 더해진다 → 지우면 원래대로
    await pg.click('#btn-planner-equip');
    ok(await count(pg, '#group-tbl select') === 42 && /30대 중 30대를 등록/.test(await pg.textContent('#group-status')), '기획자 설비 목록 30대 등록(설비 6 · 작업자 6 + 30)', await pg.textContent('#group-status'));
    ok(await pg.$eval('#group-tbl select[data-eq="MAIN 1호기"]', function (s) { return s.value; }) === 'weld' && await pg.$eval('#group-tbl select[data-eq="5호 밀링"]', function (s) { return s.value; }) === 'mach', 'MAIN 1호기 = 용접 · 5호 밀링 = 가공');
    await pg.click('#btn-planner-equip');
    ok(await count(pg, '#group-tbl select') === 42 && /30대 중 0대를 등록/.test(await pg.textContent('#group-status')), '두 번 눌러도 덮어쓰지 않는다');
    await pg.click('#btn-groups-clear');
    ok(await count(pg, '#group-tbl select') === 12, '직접 고른 설비군을 지우면 표가 원래대로');
    var jig0 = await pg.textContent('#pareto-tbl');
    await pg.selectOption('#group-tbl select[data-eq="NC-02"]', 'weld');
    var jig1 = await pg.textContent('#pareto-tbl');
    ok(jig0 !== jig1 && /용접설비/.test(await pg.textContent('#by-tbl tbody tr:nth-child(6)')), '설비군을 바꾸면 그 코드표로 다시 읽는다');
    await pg.selectOption('#group-tbl select[data-eq="NC-02"]', '');
    ok(await pg.textContent('#pareto-tbl') === jig0, '자동으로 되돌리면 원래대로');
    await pg.fill('#set-breakMin', '0'); await pg.dispatchEvent('#set-breakMin', 'change');
    var util2 = await pg.textContent('#kpi .kpi:nth-child(4) b');
    ok(util2 !== util1, '기준을 바꾸면 가동률이 다시 계산된다', util1 + ' → ' + util2);
    await pg.click('#btn-defset');
    ok(await pg.textContent('#kpi .kpi:nth-child(4) b') === util1, '기본값으로 되돌리면 원래 가동률');
    await pg.fill('#codes tbody tr:first-child td:nth-child(2) input', '자재대기'); await pg.dispatchEvent('#codes tbody tr:first-child td:nth-child(2) input', 'change');
    ok(/자재대기/.test(await pg.textContent('#pareto-tbl')), '사유 코드 이름을 고치면 표에 반영');
    await pg.click('#btn-defcode');
    // 보고서
    ok(await count(pg, '#summary li') >= 5, '규칙 요약 문장 5줄 이상');
    var pv = await pg.$eval('#preview', function (f) { return f.srcdoc; });
    ok(/설비 운영실적 보고/.test(pv) && /<svg/.test(pv), '보고서 미리보기(제목 · 그림)');
    var h = await save('#btn-html');
    ok(/설비운영실적_2026-10\.html$/.test(h.name) && /비가동 사유 파레토/.test(fs.readFileSync(h.file, 'utf8')), '보고서 HTML 저장', h.name);
    await pg.click('#ai-box summary'); await pg.click('#ai-run');
    ok(/API 키를 넣어 주세요/.test(await pg.textContent('#ai-out')), '키 없이 AI 를 누르면 안내만(보내지 않음)');
    var x = await save('#btn-export');
    var wb = XLSX.read(fs.readFileSync(x.file));
    ok(['요약', '설비별', '사유별', '일별', '설비x사유', '가동률양식_2026-10', '확인할것', '수리이력', '기준'].every(function (n) { return wb.SheetNames.indexOf(n) >= 0; }), '엑셀 시트 구성', wb.SheetNames.join(','));
    // 양식 내려받기 → 머리글 확인
    var t = await save('#btn-template');
    var tw = XLSX.read(fs.readFileSync(t.file));
    var head = XLSX.utils.sheet_to_json(tw.Sheets['비가동일보'], { header: 1 })[0];
    ok(head.join(',') === '설비,설비군,작업자,날짜,근무,구분,코드,시작,종료,소요(분),내용' && tw.SheetNames.indexOf('범례') >= 0, '빈 입력 양식(머리글 · 설비군 · 범례)');
    ok(XLSX.utils.sheet_to_json(tw.Sheets['범례'], { header: 1 }).some(function (r) { return r[0] === '용접설비' && r[2] === '티칭수정'; }), '범례에 용접 코드표');
    var lgRows = XLSX.utils.sheet_to_json(tw.Sheets['범례'], { header: 1 });
    ok(lgRows.some(function (r) { return r[0] === 'MAIN 1호기' && r[1] === '용접설비'; }) && lgRows.some(function (r) { return r[0] === '호리젠탈' && r[1] === '가공설비'; }) && lgRows.filter(function (r) { return /호기$|^호리젠탈$|NC|MCT|밀링/.test(String(r[0])) && /설비$/.test(String(r[1])); }).length === 30, '범례에 기획자 설비 목록 30대');
    // 내보낸 가동률 양식과 samples 의 파일을 다시 올리면 형식을 알아본다
    await pg.click('#btn-reset');
    ok(await pg.isHidden('#s-dash'), '자료를 비우면 대시보드도 숨는다');
    await pg.setInputFiles('#file', path.join(ROOT, 'samples', '설비가동률_예제(가짜데이터).xlsx'));
    await pg.waitForSelector('#kpi .kpi', { timeout: 5000 });
    ok(/설비 가동률/.test(await pg.textContent('#files')), '가동률 시트 판별');
    ok(await pg.textContent('#kpi .kpi:nth-child(4) b') === util1, '가동률 양식을 다시 읽어도 같은 가동률', await pg.textContent('#kpi .kpi:nth-child(4) b'));
    await pg.click('#btn-reset');
    await pg.setInputFiles('#file', [path.join(ROOT, 'samples', '비가동일보_예제(가짜데이터).xlsx'), path.join(ROOT, 'samples', '작업일보_예제(가짜데이터).xlsx')]);
    await pg.waitForFunction(function () { return document.querySelectorAll('#files > li').length === 2; }, null, { timeout: 5000 });
    await pg.waitForSelector('#kpi .kpi');
    ok(/비가동 일보/.test(await pg.textContent('#files')) && await count(pg, '#kind option') === 2, '여러 파일 올리기(입력 양식 + 작업일보)');
    // 형식을 사람이 바꾸면 그대로 따른다
    await pg.selectOption('#files .sheets li:has-text("비가동일보") select', 'skip');
    ok(await count(pg, '#kind option') === 1, '시트를 「읽지 않음」으로 바꾸면 빠진다');
    // 좁은 화면에서 가로 넘침이 없다
    await pg.setViewportSize({ width: 360, height: 800 });
    await pg.goto(base); await pg.click('#btn-sample'); await pg.waitForSelector('#kpi .kpi');
    await pg.waitForTimeout(1200); // 예제 단추가 대시보드로 부드럽게 굴러가는 동안 누르면 요소가 움직여 클릭이 늦어진다
    await pg.click('#set-box summary');
    var over = await pg.evaluate(function () { return document.documentElement.scrollWidth - document.documentElement.clientWidth; });
    ok(over <= 0, '360px 에서 가로 넘침 없음', over);
    await pg.goto(base + 'guide.html');
    ok(/인정시간/.test(await pg.textContent('main')) && /기획자 설비 목록\(2026-11\)/.test(await pg.textContent('main')) && /CHASSIS/.test(await pg.textContent('main')), '사용법 페이지(기획자 설비 목록 포함)');

    /* ===================== v1.3 스캔본 읽기 ===================== */
    var v12 = passed + failed;
    await pg.goto(base + 'scan.html');
    ok(await pg.isHidden('#s-pages') && await pg.isDisabled('#btn-sc-run'), '처음엔 읽은 장이 없고 읽기 단추가 꺼져 있다');
    await pg.click('#btn-sc-sample');
    await pg.waitForSelector('.page', { timeout: 5000 });
    ok(await pg.$$eval('.page', function (t) { return t.length; }) === 2, '예제 답 2장');
    ok(/확인할 것이 없습니다/.test(await pg.textContent('.page[data-p="0"]')) && /읽지 못한 칸/.test(await pg.textContent('.page[data-p="1"]')), '1장 이상 없음 · 2장 못 읽은 칸 알림');
    ok(/입력 양식 9줄/.test(await pg.textContent('#sc-preview')), '입력 양식 미리보기 9줄', await pg.textContent('#sc-preview'));
    // 범례를 코드표에 없는 글자로 고치면 확인할 것
    await pg.fill('.page[data-p="0"] input.code[data-k="code"]', 'Q'); await pg.dispatchEvent('.page[data-p="0"] input.code[data-k="code"]', 'change');
    ok(/범례 코드가 없습니다/.test(await pg.textContent('.page[data-p="0"]')), '코드 칸을 지우면 확인할 것이 생긴다');
    await pg.fill('.page[data-p="0"] input.code[data-k="code"]', 'B'); await pg.dispatchEvent('.page[data-p="0"] input.code[data-k="code"]', 'change');
    ok(/확인할 것이 없습니다/.test(await pg.textContent('.page[data-p="0"]')), '다시 B 로 고치면 없어진다');
    await pg.click('[data-dt-add="0"]');
    ok(await pg.$$eval('.page[data-p="0"] table.dt tbody tr', function (t) { return t.length; }) >= 2, '비가동 줄 더하기');
    await pg.click('.page[data-p="0"] [data-dt-del="1"]');
    // 손으로 입력
    await pg.click('#btn-sc-manual-w');
    ok(await pg.$$eval('.page', function (t) { return t.length; }) === 3 && /용접 ROBOT 가동일보/.test(await pg.textContent('.page[data-p="2"] h3')), '손으로 입력(용접) 장 추가');
    await pg.click('.page[data-p="2"] [data-del-page="2"]');
    ok(await pg.$$eval('.page', function (t) { return t.length; }) === 2, '장 빼기');
    // 가짜 OpenAI 응답으로 AI 읽기 흐름
    await pg.route('https://api.openai.com/**', function (r) { r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: Scan_sample } }] }) }); });
    await pg.setInputFiles('#sc-file', { name: 'scan1.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') });
    await pg.waitForSelector('#sc-thumbs img', { timeout: 5000 });
    ok(await pg.isDisabled('#btn-sc-run'), '키 · 확인 전에는 읽기 단추가 꺼져 있다');
    await pg.fill('#sc-key', 'test-key'); await pg.check('#sc-agree');
    ok(!(await pg.isDisabled('#btn-sc-run')), '키와 확인이 있으면 켜진다');
    await pg.click('#btn-sc-run');
    await pg.waitForFunction(function () { return /읽었습니다/.test(document.getElementById('sc-msg').textContent); }, null, { timeout: 5000 });
    ok(await pg.$$eval('.page', function (t) { return t.length; }) === 4, 'AI 답(가짜)을 읽어 2장 더 생긴다');
    ok(!!(await pg.$('.page[data-p="2"] .orig img')), '원본 사진이 읽은 값 옆에 보인다');
    // 집계로 보내기 → index.html#scan
    await pg.click('#btn-sc-send');
    await pg.waitForFunction(function () { return /스캔본에서 읽은/.test((document.getElementById('data-status') || document.body).textContent); }, null, { timeout: 8000 });
    ok(/스캔본에서 읽은 18줄/.test(await pg.textContent('body')), '집계 화면에 18줄이 파일처럼 올라간다', (await pg.textContent('#data-status') || '').slice(0, 80));
    ok(/스캔본 읽은 값/.test(await pg.textContent('#files')), '자료 목록에 스캔본 파일');
    ok(await pg.$$eval('#files select', function (t) { return t.some(function (x) { return x.value === 'form'; }); }), '시트 형식이 입력 양식으로 판별');
    ok(await pg.evaluate(function () { return !localStorage.getItem('build-2611-11.scan'); }), '넘긴 뒤 임시 저장은 지운다');
    await pg.goto(base + 'scan.html');
    await pg.setViewportSize({ width: 360, height: 800 });
    await pg.click('#btn-sc-sample'); await pg.waitForSelector('.page', { timeout: 5000 });
    var ovs = await pg.evaluate(function () { return document.documentElement.scrollWidth - document.documentElement.clientWidth; });
    ok(ovs <= 0, '360px 스캔본 화면 가로 넘침 없음', ovs);
    await pg.setViewportSize({ width: 1280, height: 900 });
    await pg.goto(base + 'guide.html');
    ok(/스캔본 읽기/.test(await pg.textContent('main')), '사용법에 스캔본 절');
    await pg.evaluate(function () { localStorage.clear(); });
  } catch (e) { failed++; console.log('  X 예외: ' + e.message); }
  ok(!errs.length, '페이지 오류 없음', errs.join(' | '));
  await br.close(); srv.close();
  if (typeof v12 !== 'undefined') console.log('v1.0~1.2 ' + v12 + ' · v1.3 ' + (passed + failed - v12) + '개 검사');
  console.log('\n화면 통과 ' + passed + ' · 실패 ' + failed);
  process.exit(failed ? 1 : 0);
});
