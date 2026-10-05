// Verify cost.js pure math + cost-excel workbook build (node).
const fs = require('fs');

// --- stub browser globals so cost.js loads (it calls init on load) ---
const els = {};
function fakeEl() {
  return {
    value: '', innerHTML: '', textContent: '', className: '',
    clientWidth: 480, width: 0, height: 0,
    addEventListener() {}, querySelector() { return { textContent: '' }; },
    getContext() { return new Proxy({}, { get: () => () => ({}) , set: () => true }); },
    classList: { add() {}, remove() {} },
  };
}
global.document = {
  readyState: 'complete',
  querySelector: (s) => (els[s] = els[s] || fakeEl()),
  querySelectorAll: () => [],
  getElementById: (s) => (els['#' + s] = els['#' + s] || fakeEl()),
  addEventListener() {},
  createElement: () => fakeEl(),
};
global.window = global;
global.addEventListener = () => {};
global.removeEventListener = () => {};
global.localStorage = { getItem: () => null, setItem: () => {} };
global.alert = () => {};

require('./js/cost.js');
const E = global.window.CostEVM;
if (!E) { console.error('FAIL: CostEVM not exposed'); process.exit(1); }

// 1) PDF worked example
const v = E.variances(100, 80, 90);
console.log('variances:', JSON.stringify(v));
const ok1 = v.cv === -10 && v.sv === -20 &&
  Math.abs(v.cpi - 0.8889) < 0.001 && Math.abs(v.spi - 0.8) < 0.001 &&
  v.budgetLabel === 'Over budget' && v.schedLabel === 'Behind';
console.log(ok1 ? 'PASS variances (PDF example)' : 'FAIL variances');

// 2) EAC variants: BAC=600, EV=80, AC=90, CPI=0.8889, SPI=0.8
const e = E.eacVariants(600, 80, 90, 80 / 90, 0.8);
console.log('eac:', JSON.stringify(e));
const ok2 = Math.abs(e.typical - 675) < 0.01 && e.atypical === 610 &&
  Math.abs(e.composite - (90 + 520 / ((80 / 90) * 0.8))) < 0.01;
console.log(ok2 ? 'PASS eacVariants' : 'FAIL eacVariants');

// 3) Division by zero guards
const z = E.variances(0, 0, 0);
console.log((z.cpi === null && z.spi === null) ? 'PASS div-zero guards' : 'FAIL div-zero');

// 4) Regression sanity: perfect line y = 2x -> next = 2*(n+1)
const r = E.linreg([2, 4, 6, 8]);
console.log('linreg:', JSON.stringify(r));
console.log(Math.abs(r.slope - 2) < 1e-9 && Math.abs(r.pred - 10) < 1e-9 ? 'PASS linreg' : 'FAIL linreg');

// 5) Anomaly detection: one clear outlier among steady sprints
const rows = [
  { name: 'S1', pv: 100, ev: 95, ac: 96, cv: -1, sv: -5, cpi: 0.99, spi: 0.95 },
  { name: 'S2', pv: 200, ev: 192, ac: 194, cv: -2, sv: -8, cpi: 0.99, spi: 0.96 },
  { name: 'S3', pv: 300, ev: 200, ac: 340, cv: -140, sv: -100, cpi: 0.59, spi: 0.67 },
];
const an = E.anomalyScores(rows);
console.log('anomalies:', JSON.stringify(an.map(a => ({ n: a.name, s: +a.score.toFixed(2), l: a.level }))));
console.log(an[2].flagged && !an[0].flagged ? 'PASS anomalyScores' : 'FAIL anomalyScores');

// 6) Excel workbook builds (same-realm browser pattern, like test-excel.cjs)
global.window.ExcelJS = require('C:/Users/krypt/Documents/dev/node_modules/exceljs');
new Function(fs.readFileSync('./js/cost-excel.js', 'utf8'))();
const CostExcel = global.window.CostExcel;
const c = E.computeFor(
  [{ name: 'Sprint 1', pv: 100, ev: 80, ac: 90 }, { name: 'Sprint 2', pv: 180, ev: 150, ac: 170 }],
  600, 'typical');
const wb = CostExcel.buildWorkbook({ projectName: 'Test', bac: 600 }, c);
const names = wb.worksheets.map(w => w.name);
console.log('sheets:', names.join(','));
console.log(names.join() === 'Report,EVM Table,Forecast,Anomalies,About' ? 'PASS workbook sheets' : 'FAIL sheets');
wb.xlsx.writeBuffer().then(b => console.log('PASS xlsx bytes=' + b.length)).catch(err => { console.error('FAIL xlsx', err.message); process.exit(1); });

// 7) Gemini AI layer: same LS key + prompt carries the live snapshot
new Function(fs.readFileSync('./js/cost-ai.js', 'utf8'))();
const AI = global.window.CostAI;
console.log(AI && typeof AI.generateInsights === 'function' ? 'PASS CostAI exposed' : 'FAIL CostAI');
try {
  const k = fs.readFileSync('./js/cost-ai.js', 'utf8').match(/LS_KEY = '([^']+)'/)[1];
  console.log(k === 'cf_gemini_key' ? 'PASS same key (cf_gemini_key)' : 'FAIL key=' + k);
} catch (e) { console.error('FAIL key check'); process.exit(1); }
const snap = E.computeFor(
  [{ name: 'Sprint 1', pv: 100, ev: 80, ac: 90 }],
  600, 'typical');
const prompt = AI.buildInsightPrompt({ projectName: 'Test', bac: 600, eacMethod: 'typical', sprints: [], computed: snap });
const must = ['CV=-10', 'SV=-20', 'BAC=600', 'Predictive outlook', 'Risk flags', 'Recommended actions', 'Traditional + AI'];
console.log(must.every(s => prompt.includes(s)) ? 'PASS prompt content' : 'FAIL prompt: ' + must.filter(s => !prompt.includes(s)).join(','));
// init must be a safe no-op under stubs (no #ai-gen element)
console.log('PASS ai init no-op');

// 8) Sprint dataset generation: prompt + normalization + setSprints
const sp = AI.buildSprintPrompt('Campus food app, testing late', 6, 600, 'struggling');
console.log(sp.includes('Campus food app') && sp.includes('Sprints to generate: 6') && sp.includes('600') && sp.includes('Struggling project') ? 'PASS sprint prompt' : 'FAIL sprint prompt: ' + sp);
const norm = AI.normalizeSprints({ sprints: [
  { name: '', pv: -5, ev: 80.456, ac: '90' },
  { pv: 180, ev: 150, ac: 170 },
] }, 6);
console.log(JSON.stringify(norm));
console.log(norm.length === 2 && norm[0].name === 'Sprint 1' && norm[0].pv === 0 && norm[0].ev === 80.5 && norm[0].ac === 90 && norm[1].name === 'Sprint 2' ? 'PASS normalizeSprints' : 'FAIL normalizeSprints');
let threw = false;
try { AI.normalizeSprints({ sprints: [] }, 6); } catch (e) { threw = true; }
console.log(threw ? 'PASS normalize empty throws' : 'FAIL normalize empty');
E.setSprints([{ name: 'S1', pv: 50, ev: 45, ac: 55 }], 500);
const snap2 = E.getSnapshot();
console.log(snap2.sprints.length === 1 && snap2.bac === 500 && snap2.computed.summary.cv === -10 ? 'PASS setSprints' : 'FAIL setSprints');
