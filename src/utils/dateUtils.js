// Date utility helpers. Months are 0-indexed everywhere, matching Date#getMonth.

export function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

export function formatDate(year, month, day) {
  const m = String(month + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

export function getMonthName(month) {
  return [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ][month];
}

/** Short form for the compact pay-cycle labels, e.g. "14 Oct". */
export function formatShortDate(date) {
  return `${date.getDate()} ${getMonthName(date.getMonth()).slice(0, 3)}`;
}

export function getWeekdayName(dayIndex) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayIndex];
}

/** Coerce anything to a finite number, falling back when absent or unparseable. */
export function toNumber(value, fallback = 0) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Round to 2dp so repeated float arithmetic cannot accumulate visible drift. */
export function round2(value) {
  return Math.round(value * 100) / 100;
}

/** Saturday or Sunday. */
export function isWeekendDay(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * The "normal" amount for a day: weekdays share `dailyHours`; Saturday and
 * Sunday have their own values so a normal weekend can be shorter.
 *
 * On a weekend this is a reference, not an obligation. See getDemand.
 */
export function getDayTarget(settings, date) {
  const day = date.getDay();
  if (day === 6) return toNumber(settings?.saturdayHours);
  if (day === 0) return toNumber(settings?.sundayHours);
  return toNumber(settings?.dailyHours);
}

/**
 * The hours a day actually owes. Only weekdays carry a demand; the weekend
 * values are the amount you would normally put in, and anything you log there
 * is a deposit rather than something you still owe.
 */
export function getDemand(settings, date) {
  if (isWeekendDay(date)) return 0;
  return toNumber(settings?.dailyHours);
}

/** True when the day carries a mandatory demand, i.e. it is not a rest day. */
export function isExpectedDay(settings, date) {
  return getDemand(settings, date) > 0;
}

/** Hours logged on a given date, or 0. */
export function loggedHours(workDays, date) {
  return toNumber(workDays[formatDate(date.getFullYear(), date.getMonth(), date.getDate())]);
}

// --- pay cycle -------------------------------------------------------------
//
// The work month runs from one payday to the day before the next, so a salary
// day of the 15th gives a cycle of 15th -> 14th. The hour bank is scoped to the
// cycle: it opens at zero on the payday and its closing balance is the
// surplus or deficit for that period.

function clampPayday(salaryDay) {
  return Math.min(31, Math.max(1, Math.round(toNumber(salaryDay, 1))));
}

/** The payday falling in the given month, clamped to that month's length. */
export function getPayday(year, month, salaryDay) {
  return new Date(year, month, Math.min(clampPayday(salaryDay), getDaysInMonth(year, month)));
}

/** Start and inclusive end of the pay cycle containing `date`. */
export function getPayRange(date, salaryDay) {
  const sd = clampPayday(salaryDay);
  const thisPay = getPayday(date.getFullYear(), date.getMonth(), sd);
  const start = date.getDate() >= thisPay.getDate()
    ? thisPay
    : getPayday(date.getFullYear(), date.getMonth() - 1, sd);

  const next = getPayday(start.getFullYear(), start.getMonth() + 1, sd);
  const end = new Date(next);
  end.setDate(end.getDate() - 1);

  return { start, end };
}

// --- the hour bank ---------------------------------------------------------

/**
 * Walk the pay cycle containing `date` and return a record per day.
 *
 * The bank is one pot for the whole working month, which is what makes hours
 * worked "in advance" worth anything: a Sunday the manager has approved banks
 * 4h that can offset a shortfall earlier in the same cycle just as well as a
 * later one. The pot is still scoped to the cycle, so hours earned in one
 * working month can never pay for a shortfall in the next. A salary day of the
 * 15th gives a closed 15th -> 14th window and nothing leaks across it.
 *
 * The rules, in order of importance:
 *
 *  - Only weekdays carry a demand. Coming in above it is a deposit.
 *  - Falling short of a weekday's demand draws on the pot. If the pot covers the
 *    shortfall the day is still on target; only the part it cannot cover is
 *    reported as under. The bank is a reserve, never a pre-discount, so a full
 *    8h Monday stays "on target" rather than reading as over.
 *  - Hours logged on a weekend or a rest day are a deposit in full.
 *
 * The two passes matter. Settling every day's deposit and shortfall before
 * handing any of it out is what lets the pot run backwards as well as forwards.
 *
 * When the pot cannot cover every shortfall, the earlier days get first call to
 * it, so a day's verdict never rests on a day that has not happened yet.
 */
export function getPayLedger(workDays, settings, date, { from } = {}) {
  const { start, end } = getPayRange(date, settings?.salaryDay);
  // A week can begin before the payday, so allow the walk to start earlier;
  // those extra days are context for the week's own figures only.
  const walkStart = from && from < start ? new Date(from) : start;
  const now = new Date();

  // Pass 1: settle what each day owes or puts in, with no bank involved.
  const raw = [];
  for (let d = new Date(walkStart); d <= end; d.setDate(d.getDate() + 1)) {
    const worked = loggedHours(workDays, d);
    const demand = getDemand(settings, d);
    const weekend = isWeekendDay(d);
    let deposit = 0;
    let shortfall = 0;
    if (weekend) {
      deposit = worked;
    } else if (worked >= demand) {
      deposit = worked - demand;
    } else {
      shortfall = demand - worked;
    }
    raw.push({
      date: new Date(d),
      worked,
      demand,
      weekend,
      deposit: round2(deposit),
      shortfall: round2(shortfall),
    });
  }

  // Pass 2: the pot is everything the cycle banks, and it is available from the
  // first day. Shortfalls draw it down oldest first.
  let bank = round2(raw.reduce((total, r) => total + r.deposit, 0));

  const days = [];
  const byKey = {};
  let totalWorked = 0;
  let totalDemand = 0;
  let totalDeposit = 0;
  let totalCovered = 0;
  let totalUncovered = 0;

  for (const r of raw) {
    const bankStart = bank;
    let withdrawn = 0;
    let uncovered = 0;
    if (r.shortfall > 0) {
      withdrawn = Math.min(bank, r.shortfall);
      uncovered = round2(r.shortfall - withdrawn);
      bank = round2(bank - withdrawn);
    }

    totalWorked += r.worked;
    totalDemand += r.demand;
    totalDeposit += r.deposit;
    totalCovered += withdrawn;
    totalUncovered += uncovered;

    const d = r.date;
    const key = formatDate(d.getFullYear(), d.getMonth(), d.getDate());
    const record = {
      key,
      date: new Date(d),
      dayOfMonth: d.getDate(),
      worked: r.worked,
      demand: r.demand,
      reference: getDayTarget(settings, d),
      weekend: r.weekend,
      future: d > now,
      deposit: r.deposit,
      withdrawn: round2(withdrawn),
      shortfall: r.shortfall,
      uncovered,
      bankStart: round2(bankStart),
      bankEnd: round2(bank),
      status:
        uncovered > 0 ? 'under' : r.deposit > 0 ? 'over' : r.shortfall > 0 ? 'covered' : 'even',
    };
    days.push(record);
    byKey[key] = record;
  }

  return {
    start,
    end,
    days,
    byKey,
    closing: round2(bank),
    totalWorked: round2(totalWorked),
    totalDemand: round2(totalDemand),
    totalDeposit: round2(totalDeposit),
    totalCovered: round2(totalCovered),
    totalUncovered: round2(totalUncovered),
  };
}

/**
 * The week's figures, taken from the same ledger the day cells use so the two
 * can never disagree. `bankStart` is what the bank held at the start of the
 * week, which is what the previous weekend and the week's earlier days left it.
 *
 * Days that have not happened yet are left out of the totals: a week seen on its
 * Monday should not report the four unlogged days still to come as a shortfall.
 */
export function getWeekSummary(workDays, settings, year, month, day) {
  const date = new Date(year, month, day);
  const weekStart = getStartOfWeek(date);
  const ledger = getPayLedger(workDays, settings, date, { from: weekStart });
  const keys = new Set(getWeekDates(year, month, day).map(formatKey));

  const weekDays = ledger.days.filter((r) => keys.has(r.key));
  const elapsed = weekDays.filter((r) => !r.future);
  const sum = (pick) => round2(elapsed.reduce((total, r) => total + pick(r), 0));

  return {
    start: weekStart,
    end: weekDays.length ? weekDays[weekDays.length - 1].date : weekStart,
    days: weekDays,
    elapsedDays: elapsed.length,
    worked: sum((r) => r.worked),
    demand: sum((r) => r.demand),
    deposit: sum((r) => r.deposit),
    covered: sum((r) => r.withdrawn),
    uncovered: sum((r) => r.uncovered),
    bankStart: elapsed.length ? elapsed[0].bankStart : 0,
    bankEnd: elapsed.length ? elapsed[elapsed.length - 1].bankEnd : 0,
  };
}

/** Hours a normal full week of weekdays is expected to cover. */
export function sumWeekDemand(settings, year, month, day) {
  return round2(
    getWeekDates(year, month, day).reduce((total, d) => total + getDemand(settings, d), 0)
  );
}

/**
 * The hour bank at the end of the pay cycle containing `date`, plus the
 * underlying totals. This is the "did I make it this period" figure.
 */
export function getPaySummary(workDays, settings, date) {
  const ledger = getPayLedger(workDays, settings, date);
  const now = new Date();
  // Future days in the cycle have not happened yet, so they are not counted.
  const elapsed = ledger.days.filter((r) => !r.future);
  const sum = (pick) => round2(elapsed.reduce((total, r) => total + pick(r), 0));

  return {
    start: ledger.start,
    end: ledger.end,
    isCurrent: now >= ledger.start && now <= ledger.end,
    worked: sum((r) => r.worked),
    demand: sum((r) => r.demand),
    deposit: sum((r) => r.deposit),
    covered: sum((r) => r.withdrawn),
    uncovered: sum((r) => r.uncovered),
    // The bank as it stands at the end of the elapsed days.
    closing: elapsed.length ? elapsed[elapsed.length - 1].bankEnd : 0,
  };
}

/** How many days in a month carry a mandatory demand, for the "days logged" ratio. */
export function countExpectedDays(settings, year, month, { upToDay } = {}) {
  const lastDay = upToDay ?? (isSameMonth(new Date(), year, month) ? new Date().getDate() : getDaysInMonth(year, month));
  let count = 0;
  for (let day = 1; day <= lastDay; day++) {
    if (isExpectedDay(settings, new Date(year, month, day))) count++;
  }
  return count;
}

export function isToday(year, month, day) {
  const now = new Date();
  return (
    now.getFullYear() === year && now.getMonth() === month && now.getDate() === day
  );
}

export function isSameMonth(a, year, month) {
  return a.getFullYear() === year && a.getMonth() === month;
}

/** Monday-based start of the week containing the given date. */
export function getStartOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return d;
}

/**
 * How many blank cells sit before the 1st of the month in a Monday-first grid.
 * getDay is Sunday-based, so shift it into a Monday-based index first.
 */
export function getLeadingBlanks(year, month) {
  return (new Date(year, month, 1).getDay() + 6) % 7;
}

/** Zero-based Monday-first column a date belongs to, 0 = Monday .. 6 = Sunday. */
export function getWeekColumn(date) {
  return (date.getDay() + 6) % 7;
}

/** The seven dates of the week containing the given date, Monday first. */
export function getWeekDates(year, month, day) {
  const start = getStartOfWeek(new Date(year, month, day));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function formatKey(date) {
  return formatDate(date.getFullYear(), date.getMonth(), date.getDate());
}
