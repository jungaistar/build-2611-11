/* samples/ 의 엑셀을 다시 만든다 — node tools/make-samples.js
 * 전부 엔진의 sample() 이 만든 가짜 데이터다. 실제 사내 데이터를 여기에 넣지 않는다. */
'use strict';
var fs = require('fs'), path = require('path');
var XLSX = require('../lib/xlsx.full.min.js');
var D = require('../js/downtime.js');
var OUT = path.join(__dirname, '..', 'samples');
fs.mkdirSync(OUT, { recursive: true });
var S = D.normSettings();
function save(name, obj) {
  var wb = XLSX.utils.book_new();
  Object.keys(obj).forEach(function (n) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(obj[n]), n); });
  fs.writeFileSync(path.join(OUT, name), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  console.log('  ' + name + ' — 시트 ' + Object.keys(obj).join(', '));
}
var s = D.sample();
save('비가동일보_빈양식.xlsx', D.templateSheets(S));
save('비가동일보_예제(가짜데이터).xlsx', { '비가동일보': s.sheets[0].aoa, '범례': D.legendRows(S) });
var diary = {}; s.sheets.slice(1, 7).forEach(function (x) { diary[x.name] = x.aoa; });
save('작업일보_예제(가짜데이터).xlsx', diary);
save('수리이력_예제(가짜데이터).xlsx', { '수리이력': s.sheets[7].aoa });
var inp = D.merge(s.sheets.map(function (x) { return D.parseSheet(x.aoa, '', { sheet: x.name }, S); }));
var res = D.analyze(inp, S);
save('설비가동률_예제(가짜데이터).xlsx', { '가동률_2026-10': D.toUtilSheet(res.kinds.equip, '2026-10', S) });
