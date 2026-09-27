// Check 1: does the user's actual availability text parse into a gate?
// Check 2: do schedule dates land on weekends? (working days = 5)
var fs = require('fs');

// --- extract parseAvailability from app.js (it's inside an IIFE; eval the function body via regex) ---
var src = fs.readFileSync('./js/app.js', 'utf8');
var m = src.match(/function parseAvailability\(text, wd\) \{[\s\S]*?\n  \}/);
if (!m) { console.log('FAIL: parseAvailability not found'); process.exit(1); }
var parseAvailability = new Function(m[0] + '; return parseAvailability;')();

var fails = 0;
function check(label, cond, extra) {
  if (cond) console.log('PASS  ' + label);
  else { fails++; console.log('FAIL  ' + label + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}

// Their exact inputs (from the screenshots)
var inputs = [
  'out of 3 devs 1 of the dev is only available after the 3rd week',
  'Backend dev available from day 10',
  'QA engineer — from day 20 (after 4 weeks)',
  'Local Vector Database Specialist available after 3 weeks'
];
inputs.forEach(function (t, i) {
  var g = parseAvailability(t);
  console.log('  input[' + i + '] "' + t + '" → ' + JSON.stringify(g));
});
var theirInput = parseAvailability(inputs[0]);
check('user\'s free-form sentence produces a gate', theirInput.length > 0, theirInput);
check('gate ≈ 15 working days (3rd week)', theirInput.length > 0 && theirInput[0].days === 15, theirInput);
var formatted = parseAvailability(inputs[1]);
check('formatted "from day 10" parses', formatted.length === 1 && formatted[0].days === 10, formatted);

// --- weekend check: 2026-09-27 is a Sunday; project runs 50 working days, wd=5 ---
var mb = { exports: {} };
new Function('module', 'exports', fs.readFileSync('./js/schedule.js', 'utf8'))(mb, mb.exports);
var SL = mb.exports;

var weekendStart = new Date(Date.UTC(2026, 8, 27)).getUTCDay(); // 0=Sun
console.log('  2026-09-27 weekday:', ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][weekendStart]);
check('their chosen start date is a weekend day (known input issue)', weekendStart === 0 || weekendStart === 6);

// Dates from computeCPM for their schedule
var schedule = {
  projectName: 'OBOD', plannedStart: '2026-09-27', workingDaysPerWeek: 5,
  activities: [
    { id: 'A101', durationDays: 9, isMilestone: false },
    { id: 'A103', durationDays: 11, isMilestone: false, earliestStart: 15 },
    { id: 'A109', durationDays: 0, isMilestone: true }
  ],
  dependencies: [
    { from: 'A101', to: 'A103', type: 'FS', lagDays: 0, leadDays: 0 },
    { from: 'A103', to: 'A109', type: 'FS', lagDays: 0, leadDays: 0 }
  ]
};
var cpm = SL.computeCPM(schedule);
['A101', 'A103', 'A109'].forEach(function (id) {
  var st = new Date(cpm.map[id].startDate), en = new Date(cpm.map[id].endDate);
  var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  console.log('  ' + id + ' ' + cpm.map[id].startDate + '(' + days[st.getUTCDay()] + ') → ' + cpm.map[id].endDate + '(' + days[en.getUTCDay()] + ')');
});
// Their screenshot: A101 27-Sep→09-Oct, A103 18-Oct→02-Nov, A109 06-Dec
var a101Start = cpm.map.A101.startDate;
check('start dates skip weekends when wd=5 (A101 starts Monday 28-Sep, not Sunday 27-Sep)',
  new Date(a101Start).getUTCDay() !== 0 && new Date(a101Start).getUTCDay() !== 6, a101Start);
var allWeekdays = true;
Object.keys(cpm.map).forEach(function (id) {
  [cpm.map[id].startDate, cpm.map[id].endDate].forEach(function (d) {
    var w = new Date(d).getUTCDay();
    if (w === 0 || w === 6) allWeekdays = false;
  });
});
check('no activity start/end lands on Sat/Sun', allWeekdays);

console.log('\n' + (fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'));
process.exit(fails ? 1 : 0);
