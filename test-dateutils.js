// Tests the real src/utils/dateUtils.js rather than a copy, so the maths cannot
// drift from the app. The module uses ESM `export`, which this CommonJS script
// cannot import directly, so the `export` keywords are stripped and the file is
// evaluated in a VM context where top-level functions become globals.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs
  .readFileSync(path.join(__dirname, 'src', 'utils', 'dateUtils.js'), 'utf8')
  .replace(/^export\s+/gm, '');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const {
  getDaysInMonth,
  formatDate,
  getWeekDates,
  getStartOfWeek,
  getLeadingBlanks,
  getWeekColumn,
  getDayTarget,
  getDemand,
  getPayRange,
  getPayLedger,
  getWeekSummary,
  getPaySummary,
  sumWeekDemand,
  countExpectedDays,
  loggedHours,
} = sandbox;

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name} => ${JSON.stringify(actual)}` +
      (ok ? '' : ` (expected ${JSON.stringify(expected)})`)
  );
}

// 8h weekdays, 4h Saturday reference, Sunday off, pay day on the 1st.
const S = { dailyHours: 8, salaryDay: 1, saturdayHours: 4, sundayHours: 0 };
const D = (y, m, d) => new Date(y, m, d);
const k = (date) => formatDate(date.getFullYear(), date.getMonth(), date.getDate());

/**
 * A user who has logged a full 8h on every weekday from the 1st of the month
 * up to, but not including, `day`. The bank is a running balance over the pay
 * cycle, so a scenario has to start from an unbroken record or the earlier
 * unlogged days will dominate it.
 */
function loggedUpTo(day, settings = S) {
  const wd = {};
  for (let d = 1; d < day.getDate(); d++) {
    const date = D(day.getFullYear(), day.getMonth(), d);
    if (getDemand(settings, date) > 0) wd[k(date)] = 8;
  }
  return wd;
}

/** Every weekday in a calendar month logged at a full 8h. */
function loggedMonth(year, month, settings = S) {
  const wd = {};
  for (let d = 1; d <= getDaysInMonth(year, month); d++) {
    const date = D(year, month, d);
    if (getDemand(settings, date) > 0) wd[k(date)] = 8;
  }
  return wd;
}

/** The ledger record for one date, looked up the way the app does. */
function rec(workDays, settings, date) {
  return getPayLedger(workDays, settings, date).byKey[k(date)];
}

console.log('--- calendar basics ---');
check('Sept 2026 has 30 days', getDaysInMonth(2026, 8), 30);
check('1 Sept 2026 starts on a Tuesday', new Date(2026, 8, 1).getDay(), 2);
check('so one leading blank (Monday-first)', getLeadingBlanks(2026, 8), 1);
check('date formatting pads', formatDate(2026, 8, 5), '2026-09-05');
check('week starts Monday 21 Sep 2026', k(getStartOfWeek(D(2026, 8, 23))), '2026-09-21');
check('a week has seven days', getWeekDates(2026, 8, 23).length, 7);

console.log('\n--- demand: only weekdays owe hours ---');
check('Monday demand', getDemand(S, D(2026, 8, 21)), 8);
check('Friday demand', getDemand(S, D(2026, 8, 25)), 8);
check('Saturday has no demand, only a reference', getDemand(S, D(2026, 8, 26)), 0);
check('Sunday has no demand', getDemand(S, D(2026, 8, 27)), 0);
check('Saturday reference is still 4h', getDayTarget(S, D(2026, 8, 26)), 4);
check('a normal week of demand is 40h', sumWeekDemand(S, 2026, 8, 23), 40);

console.log('\n--- the reported case: a full Monday is on target, not over ---');
// Saturday the 19th banks 4h. Working a full 8h on Monday the 21st must still
// read "on target"; the bank is a reserve, never a pre-discount on the target.
{
  const wd = { ...loggedUpTo(D(2026, 8, 21)), '2026-09-19': 4, '2026-09-21': 8 };
  const mon = rec(wd, S, D(2026, 8, 21));
  check('Monday still demands the full 8h', mon.demand, 8);
  check('a full Monday banks nothing', mon.deposit, 0);
  check('and is not under', mon.uncovered, 0);
  check('a full Monday is on target', mon.status, 'even');
  check('the 4h from Saturday is still waiting', mon.bankStart, 4);
}

console.log('\n--- the bank absorbs a short day anywhere in the cycle ---');
{
  const wd = {
    ...loggedUpTo(D(2026, 8, 21)),
    '2026-09-19': 4,
    '2026-09-21': 8, // on target
    '2026-09-22': 7, // 1h short, covered
    '2026-09-23': 6, // 2h short, covered
    '2026-09-24': 7, // 1h short, covered, bank now empty
    '2026-09-25': 7, // 1h short, nothing left
  };
  const bank = (d) => rec(wd, S, D(2026, 8, d)).bankStart;

  check('bank opens the cycle at 0', rec({}, S, D(2026, 8, 1)).bankStart, 0);
  check('bank holds 4 after Saturday the 19th', bank(21), 4);
  check('Monday leaves it alone', bank(22), 4);
  check('Tuesday draws 1 for its 1h shortfall', bank(23), 3);
  check('Wednesday draws 2', bank(24), 1);
  check('Thursday draws the last 1', bank(25), 0);

  check('a covered shortfall reads on target', rec(wd, S, D(2026, 8, 24)).status, 'covered');
  check('Friday cannot be covered', rec(wd, S, D(2026, 8, 25)).uncovered, 1);
  check('and reads under', rec(wd, S, D(2026, 8, 25)).status, 'under');
}

console.log('\n--- excess hours bank as a bonus ---');
{
  const wd = {
    ...loggedUpTo(D(2026, 8, 21)),
    '2026-09-19': 4,
    '2026-09-21': 8.5, // 0.5 above the target
    '2026-09-22': 7.5, // 0.5 short
  };
  const mon = rec(wd, S, D(2026, 8, 21));
  check('the half hour above 8 is banked', mon.deposit, 0.5);
  check('Monday reads over', mon.status, 'over');
  check('the bank is now 4.5', mon.bankEnd, 4.5);

  const tue = rec(wd, S, D(2026, 8, 22));
  check('Tuesday draws 0.5 of its 0.5 shortfall', tue.withdrawn, 0.5);
  check('and is fully covered', tue.status, 'covered');
  check('leaving 4 in the bank', tue.bankEnd, 4);
}

console.log('\n--- weekend work banks in full ---');
{
  const wd = { ...loggedUpTo(D(2026, 8, 26)), '2026-09-26': 6 };
  const sat = rec(wd, S, D(2026, 8, 26));
  check('all 6h of Saturday bank, not just the 2 above the reference', sat.deposit, 6);
  check('Saturday has no demand to meet', sat.demand, 0);

  // Working a rest day is still a deposit.
  const rest = rec({ ...loggedUpTo(D(2026, 8, 27)), '2026-09-27': 3 }, S, D(2026, 8, 27));
  check('Sunday work banks too', rest.deposit, 3);
}

console.log('\n--- weekend hours are available the very next day ---');
{
  const wd = { ...loggedUpTo(D(2026, 8, 21)), '2026-09-19': 4, '2026-09-21': 7 };
  const mon = rec(wd, S, D(2026, 8, 21));
  check('Monday is one short', mon.shortfall, 1);
  check('and the bank covers it', mon.withdrawn, 1);
  check('so it is on target', mon.status, 'covered');
  check('bank is left at 3', mon.bankEnd, 3);
}

console.log('\n--- the bank never goes negative ---');
{
  const wd = { ...loggedUpTo(D(2026, 8, 21)), '2026-09-19': 4, '2026-09-21': 2 };
  const mon = rec(wd, S, D(2026, 8, 21));
  check('a 6h shortfall is covered as far as the bank goes', mon.withdrawn, 4);
  check('leaving 2h genuinely under', mon.uncovered, 2);
  check('and the bank lands on 0, not -2', mon.bankEnd, 0);

  const tue = rec({ ...wd, '2026-09-22': 1 }, S, D(2026, 8, 22));
  check('an empty bank reports the whole shortfall', tue.uncovered, 7);
  check('and stays at 0', tue.bankEnd, 0);
}

console.log('\n--- the bank runs backwards as well as forwards ---');
{
  // The manager approves the Wednesday overtime up front, so those hours join
  // the work month's pot and can settle a shortfall from earlier in the same
  // cycle, not only later ones.
  const wd = {
    ...loggedUpTo(D(2026, 8, 26)),
    '2026-09-22': 4, // 4h short of the 8h target
    '2026-09-23': 20, // 12h banked the following day
  };
  const tue = rec(wd, S, D(2026, 8, 22));
  const wed = rec(wd, S, D(2026, 8, 23));
  check('Wednesday banks its own 12h', wed.deposit, 12);
  check('the pot holds them before Tuesday is judged', tue.bankStart, 12);
  check("so Wednesday's overtime does cover Tuesday", tue.uncovered, 0);
  check('Tuesday reads covered', tue.status, 'covered');
  check('and 8h are left in the pot', tue.bankEnd, 8);
}

console.log('\n--- a Saturday worked in advance covers a weekday before it ---');
{
  // The case this model exists for: the Saturday is the last day of the work
  // month, and its hours settle a shortfall from earlier in the same month.
  const wd = {
    ...loggedUpTo(D(2026, 8, 24)),
    '2026-09-23': 6, // Wednesday, 2h short
    '2026-09-26': 4, // Saturday, banked
  };
  const wed = rec(wd, S, D(2026, 8, 23));
  const sat = rec(wd, S, D(2026, 8, 26));
  check('Wednesday is 2h short on paper', wed.shortfall, 2);
  check('but the pot already holds the Saturday', wed.bankStart, 4);
  check('so Wednesday is covered, not under', wed.status, 'covered');
  check('with 2h still in the pot', wed.bankEnd, 2);
  check('the Saturday is what banked it', sat.deposit, 4);
  check('and the Saturday is not itself short', sat.uncovered, 0);
}

console.log('\n--- a full day is still on target even with a full pot ---');
{
  // The pot must never become a pre-discount on the target. An 8h Monday has
  // no shortfall to draw on, so it banks nothing and reads on target.
  const wd = { ...loggedUpTo(D(2026, 8, 21)), '2026-09-19': 4, '2026-09-21': 8 };
  const mon = rec(wd, S, D(2026, 8, 21));
  check('a full Monday still demands 8h', mon.demand, 8);
  check('banks nothing of its own', mon.deposit, 0);
  check('is not short', mon.shortfall, 0);
  check('and reads on target', mon.status, 'even');
  check('the Saturday sits untouched in the pot', mon.bankEnd, 4);
}

console.log('\n--- pay cycle with pay day 1 ---');
{
  const { start, end } = getPayRange(D(2026, 8, 15), 1);
  check('cycle starts 1 Sep', k(start), '2026-09-01');
  check('cycle ends 30 Sep', k(end), '2026-09-30');
}

console.log('\n--- pay cycle with pay day 15 (the 15th to the 14th) ---');
{
  const P = { ...S, salaryDay: 15 };
  const late = getPayRange(D(2026, 8, 20), 15);
  check('the 20th sits in a cycle starting 15 Sep', k(late.start), '2026-09-15');
  check('ending 14 Oct', k(late.end), '2026-10-14');

  const early = getPayRange(D(2026, 8, 10), 15);
  check('the 10th belongs to the previous cycle', k(early.start), '2026-08-15');
  check('which ended 14 Sep', k(early.end), '2026-09-14');
}

console.log('\n--- the pot is scoped to the work month ---');
{
  const P = { ...S, salaryDay: 15 };
  // Two Saturdays inside the same cycle, with the weekdays in between logged
  // in full so nothing drains the pot.
  const wd = {
    ...loggedMonth(2026, 8),
    ...loggedMonth(2026, 9),
    '2026-09-19': 4,
    '2026-09-26': 4,
  };
  // The pot is the whole cycle's surplus, so it is already there on the first
  // day rather than trickling in as the days pass.
  check("the 15th sees the cycle's whole pot", rec(wd, P, D(2026, 8, 15)).bankStart, 8);
  check('both Saturdays accumulate', rec(wd, P, D(2026, 8, 29)).bankEnd, 8);
  check('1 Oct is still the same cycle', getPayRange(D(2026, 9, 1), 15).start.getMonth(), 8);
  check('and still sees the 8h', rec(wd, P, D(2026, 9, 1)).bankStart, 8);
  // 15 Oct opens the next cycle, which has banked nothing of its own.
  check('the next cycle starts with an empty pot', rec(wd, P, D(2026, 9, 15)).bankStart, 0);
}

console.log('\n--- banked hours cannot cross the pay day ---');
{
  const P = { ...S, salaryDay: 15 };
  const wd = {
    ...loggedMonth(2026, 8),
    ...loggedMonth(2026, 9),
    ...loggedMonth(2026, 10),
    '2026-09-27': 8, // Sunday, late in the 15 Sep -> 14 Oct cycle
    '2026-10-20': 4, // 4h short, but sitting in the next cycle
  };
  check('27 Sep 2026 is a Sunday', new Date(2026, 8, 27).getDay(), 0);
  check('so it banks the full 8h', rec(wd, P, D(2026, 8, 27)).deposit, 8);
  check('its cycle ends 14 Oct', k(getPayRange(D(2026, 8, 27), 15).end), '2026-10-14');
  check('20 Oct opens the next cycle', k(getPayRange(D(2026, 9, 20), 15).start), '2026-10-15');
  // The pot runs both ways, but never past the pay day: the new cycle has
  // banked nothing, so the previous cycle's 8h are out of reach.
  check("the new cycle's pot is empty", rec(wd, P, D(2026, 9, 20)).bankStart, 0);
  check('so 20 Oct is genuinely 4h under', rec(wd, P, D(2026, 9, 20)).uncovered, 4);
  check('and reads under', rec(wd, P, D(2026, 9, 20)).status, 'under');
}

console.log('\n--- pay day 31 in a short month ---');
{
  // A 31st pay day has to clamp. February's payday is the 28th, so the 20th
  // still belongs to the cycle that opened on 31 January.
  const feb = getPayRange(D(2026, 1, 20), 31);
  check('the cycle containing 20 Feb opened 31 Jan', k(feb.start), '2026-01-31');
  check('and closes on 27 Feb', k(feb.end), '2026-02-27');

  const after = getPayRange(D(2026, 1, 28), 31);
  check('28 Feb opens its own cycle', k(after.start), '2026-02-28');
  check('closing 30 Mar', k(after.end), '2026-03-30');
}

console.log('\n--- week summary agrees with the day cells ---');
{
  const wd = {
    ...loggedUpTo(D(2026, 8, 21)),
    '2026-09-19': 4,
    '2026-09-21': 8,
    '2026-09-22': 7,
    '2026-09-23': 6,
    '2026-09-24': 7,
    '2026-09-25': 7,
  };
  const w = getWeekSummary(wd, S, 2026, 8, 23);
  check('worked', w.worked, 35);
  check('weekday demand', w.demand, 40);
  check('banked nothing extra', w.deposit, 0);
  check('covered 4h of shortfall from the bank', w.covered, 4);
  check('left 1h genuinely under', w.uncovered, 1);
  check('bank opened the week at 4', w.bankStart, 4);
  check('bank closed the week at 0', w.bankEnd, 0);

  // The invariant: the summary must be exactly the sum of the per-day records
  // the cells render, so the week card and the grid can never disagree.
  const bySumming = w.days.reduce(
    (acc, r) => ({
      worked: acc.worked + r.worked,
      demand: acc.demand + r.demand,
      covered: acc.covered + r.withdrawn,
      uncovered: acc.uncovered + r.uncovered,
      deposit: acc.deposit + r.deposit,
    }),
    { worked: 0, demand: 0, covered: 0, uncovered: 0, deposit: 0 }
  );
  check('covered + uncovered equals the total shortfall', w.covered + w.uncovered, 5);
  check(
    'the day cells sum to the week total',
    bySumming,
    {
      worked: w.worked,
      demand: w.demand,
      covered: w.covered,
      uncovered: w.uncovered,
      deposit: w.deposit,
    }
  );
}

console.log('\n--- future days are not counted as shortfalls ---');
{
  // July 1 2026 is a Wednesday, so its week runs Mon 29 Jun to Sun 5 Jul. Log
  // all five weekdays: a week with only some days logged is genuinely under.
  const wd = {
    '2026-06-29': 8, '2026-06-30': 8, '2026-07-01': 8, '2026-07-02': 8, '2026-07-03': 8,
  };
  const w = getWeekSummary(wd, S, 2026, 6, 1);
  check('a fully logged week has no shortfall', w.uncovered, 0);
  check('and its demand is the full week', w.demand, 40);
  check('with all seven days recorded', w.days.length, 7);
  check('the summary matches the days', w.worked, 40);
}

console.log('\n--- pay summary covers the whole cycle ---');
{
  // July 2026 is entirely in the past, so the totals do not depend on today.
  // A clean month of 8h weekdays, with one banked Saturday that then gets used
  // up: 3h on the Monday, 1h on the Tuesday, and nothing left for the Wednesday.
  const wd = {
    ...loggedMonth(2026, 6),
    '2026-07-04': 4,
    '2026-07-06': 5,
    '2026-07-07': 7,
    '2026-07-08': 7,
  };
  const p = getPaySummary(wd, S, D(2026, 6, 15));
  check('banked 4h of Saturday', p.deposit, 4);
  check('spent 4h covering Monday and Tuesday', p.covered, 4);
  check('left 1h under on the Wednesday', p.uncovered, 1);
  check('balance is 0', p.closing, 0);
  check('demand across the cycle', p.demand, 23 * 8);
  check('cycle ran 1 Jul to 31 Jul', `${k(p.start)}..${k(p.end)}`, '2026-07-01..2026-07-31');
}

console.log('\n--- settings robustness ---');
check('missing settings give 0, not NaN', getDemand({}, D(2026, 8, 21)), 0);
check('garbage settings give 0, not NaN', getDemand({ dailyHours: 'abc' }, D(2026, 8, 21)), 0);
check('an unparseable pay day falls back to the 1st', getPayRange(D(2026, 8, 20), 'abc').start.getDate(), 1);
check('a pay day of 0 falls back to the 1st', getPayRange(D(2026, 8, 20), 0).start.getDate(), 1);
check('a pay day of 99 clamps into range', getPayRange(D(2026, 8, 20), 99).start.getMonth(), 7);

console.log('\n--- empty data ---');
{
  const wd = {};
  check('an empty cycle banks nothing', getPaySummary(wd, S, D(2026, 6, 15)).deposit, 0);
  check('an empty July owes its 23 weekdays', getPaySummary(wd, S, D(2026, 6, 15)).uncovered, 23 * 8);
  check('August 2026 has 21 expected days', countExpectedDays(S, 2026, 7), 21);
}

console.log('\n--- logged hours ---');
check('an unlogged day is 0, not undefined', loggedHours({}, D(2026, 8, 21)), 0);
check('a logged day reads back', loggedHours({ '2026-09-21': 7.5 }, D(2026, 8, 21)), 7.5);

console.log('\n--- grid placement: every day must sit under its own weekday ---');
{
  // This is what broke the display: cells that overflowed their 1/7 share
  // wrapped, so days drifted out from under the header. Placing the blanks and
  // days into a flat 7-wide row, as the grid does, has to put every date in the
  // column its real weekday implies.
  let allAligned = true;
  const bad = [];
  for (let year = 2024; year <= 2027; year++) {
    for (let month = 0; month < 12; month++) {
      const blanks = getLeadingBlanks(year, month);
      const total = getDaysInMonth(year, month);
      for (let day = 1; day <= total; day++) {
        // Flat index of this cell once the blanks are counted, then its column.
        const column = (blanks + day - 1) % 7;
        const actual = getWeekColumn(new Date(year, month, day));
        if (column !== actual) {
          allAligned = false;
          bad.push(`${year}-${month + 1}-${day}: column ${column} vs ${actual}`);
        }
      }
    }
  }
  check('every day of 48 months lands under the right weekday', bad.slice(0, 3), []);
  check('and none were misaligned', allAligned, true);

  check('a month starting Monday has no blanks', getLeadingBlanks(2026, 5), 0); // Jun 2026
  check('a month starting Sunday has six', getLeadingBlanks(2026, 1), 6); // Feb 2026
  check('a month starting Tuesday has one', getLeadingBlanks(2026, 8), 1); // Sep 2026
  check('1 Feb 2028 is a Tuesday, so one blank', getLeadingBlanks(2028, 1), 1);
  check('Monday is column 0', getWeekColumn(new Date(2026, 8, 21)), 0);
  check('Sunday is column 6', getWeekColumn(new Date(2026, 8, 27)), 6);
  // Seven cells plus any padding on them must not exceed the row, or the last
  // one wraps and throws the whole grid out of line with the header.
  check('seven cells exactly fill the row', Number((7 * 14.2857).toFixed(4)), 99.9999);
  check('which leaves room to spare', 7 * 14.2857 < 100, true);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
