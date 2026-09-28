import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import DayCell from '../components/DayCell';
import DayEditor from '../components/DayEditor';
import {
  getDaysInMonth,
  getLeadingBlanks,
  getMonthName,
  getWeekdayName,
  formatDate,
  formatShortDate,
  getPayRange,
  getPayLedger,
  getPaySummary,
  getWeekSummary,
  countExpectedDays,
  isSameMonth,
} from '../utils/dateUtils';

/** A shortfall the bank could not cover, or the surplus it has built up. */
function bankState(uncovered, deposit) {
  if (uncovered > 0.05) return { text: `${uncovered.toFixed(1)}h under`, tone: 'under' };
  if (deposit > 0.05) return { text: `+${deposit.toFixed(1)}h over`, tone: 'over' };
  return { text: 'on target', tone: 'even' };
}

export default function CalendarScreen({ workDays, settings, onSaveWorkDay }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [editorVisible, setEditorVisible] = useState(false);
  const [selectedDay, setSelectedDay] = useState(null);

  const daysInMonth = getDaysInMonth(year, month);
  // Grid starts on Monday, so shift the Sunday-based offset by one.
  const leadingBlanks = getLeadingBlanks(year, month);

  // The pay cycle runs payday to payday, so a displayed calendar month can span
  // two of them. Walk each cycle once and index the records by date.
  const monthRecords = useMemo(() => {
    const cache = new Map();
    const records = {};
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const { start } = getPayRange(date, settings?.salaryDay);
      const cacheKey = formatDate(start.getFullYear(), start.getMonth(), start.getDate());
      if (!cache.has(cacheKey)) {
        cache.set(cacheKey, getPayLedger(workDays, settings, date).byKey);
      }
      records[d] = cache.get(cacheKey)[formatDate(year, month, d)] || null;
    }
    return records;
  }, [workDays, settings, year, month, daysInMonth]);

  const changeMonth = (delta) => {
    const next = new Date(year, month + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
  };

  const goToToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
  };

  const getWorkValue = (day) => workDays[formatDate(year, month, day)];

  const handleDayPress = (y, m, d) => {
    setSelectedDay({ year: y, month: m, day: d });
    setEditorVisible(true);
  };

  const handleSave = (y, m, d, value) => {
    onSaveWorkDay(formatDate(y, m, d), value);
    setEditorVisible(false);
    setSelectedDay(null);
  };

  const closeEditor = () => {
    setEditorVisible(false);
    setSelectedDay(null);
  };

  // How many days in the displayed month carry hours, for the logged ratio.
  // The money figures come from the pay cycle instead, since that is the period
  // the hour bank is measured over.
  const pastMonth = !isSameMonth(today, year, month);
  let monthLogged = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if (!pastMonth && d > today.getDate()) break;
    if (Number.isFinite(parseFloat(getWorkValue(d)))) monthLogged++;
  }
  const monthExpectedDays = countExpectedDays(settings, year, month);

  // Current week and current pay cycle, both read from the same ledger.
  const week = getWeekSummary(
    workDays,
    settings,
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const pay = getPaySummary(workDays, settings, today);
  const weekState = bankState(week.uncovered, week.deposit);
  const payState = bankState(pay.uncovered, pay.deposit);

  const cells = [];
  for (let i = 0; i < leadingBlanks; i++) {
    cells.push(<View key={`empty-${i}`} style={styles.cell} />);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(
      <DayCell
        key={d}
        year={year}
        month={month}
        day={d}
        workValue={getWorkValue(d)}
        record={monthRecords[d]}
        onPress={handleDayPress}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.navButton} hitSlop={8}>
          <Text style={styles.navText}>{'<'}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={goToToday} style={styles.headerCenter}>
          <Text style={styles.monthTitle}>
            {getMonthName(month)} {year}
          </Text>
          <Text style={styles.todayLink}>
            {isSameMonth(today, year, month) ? 'Today' : 'Go to today'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => changeMonth(1)} style={styles.navButton} hitSlop={8}>
          <Text style={styles.navText}>{'>'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.weekRow}>
        {[1, 2, 3, 4, 5, 6, 0].map((weekday) => (
          <View key={weekday} style={styles.weekdayCell}>
            <Text style={styles.weekdayText}>{getWeekdayName(weekday)}</Text>
          </View>
        ))}
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={styles.grid}>{cells}</View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>This week</Text>
          <Row label="Worked" value={`${week.worked.toFixed(1)}h`} />
          <Row label="Weekday target" value={`${week.demand.toFixed(1)}h`} />
          {week.deposit > 0.05 ? (
            <Row label="Banked (extra + weekend)" value={`+${week.deposit.toFixed(1)}h`} tone="over" />
          ) : null}
          {week.covered > 0.05 ? (
            <Row label="Covered shortfalls" value={`${week.covered.toFixed(1)}h`} />
          ) : null}
          <Row
            label="Position"
            value={weekState.text}
            tone={weekState.tone}
            emphasis
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Work month {formatShortDate(pay.start)} – {formatShortDate(pay.end)}
          </Text>
          <Row label="Days logged" value={`${monthLogged}/${monthExpectedDays}`} />
          <Row label="Worked" value={`${pay.worked.toFixed(1)}h`} />
          <Row label="Weekday target" value={`${pay.demand.toFixed(1)}h`} />
          {pay.deposit > 0.05 ? (
            <Row label="Banked (extra + weekend)" value={`+${pay.deposit.toFixed(1)}h`} tone="over" />
          ) : null}
          {pay.covered > 0.05 ? (
            <Row label="Covered shortfalls" value={`${pay.covered.toFixed(1)}h`} />
          ) : null}
          <Row
            label="Position"
            value={payState.text}
            tone={payState.tone}
            emphasis
          />
          <Row label="Bank left" value={`${pay.closing.toFixed(1)}h`} />
          <Text style={styles.cardNote}>
            Banked hours cover shortfalls anywhere in this work month, up to the pay day.
            Nothing carries into the next one.
          </Text>
        </View>

        <View style={styles.legend}>
          <Legend color="#c8e6c9" label="Banked hours" />
          <Legend color="#fff3e0" label="Shortfall covered by bank" />
          <Legend color="#ffcdd2" label="Under, bank empty" />
          <Legend color="#e3f2fd" label="Today" />
        </View>
      </ScrollView>

      <DayEditor
        visible={editorVisible}
        year={selectedDay ? selectedDay.year : year}
        month={selectedDay ? selectedDay.month : month}
        day={selectedDay ? selectedDay.day : 1}
        workValue={selectedDay ? getWorkValue(selectedDay.day) : undefined}
        record={
          selectedDay
            ? monthRecords[selectedDay.day] || null
            : null
        }
        onSave={handleSave}
        onClose={closeEditor}
        workDays={workDays}
        settings={settings}
      />
    </View>
  );
}

function Row({ label, value, tone, emphasis }) {
  return (
    <View style={[styles.row, emphasis && styles.rowEmphasis]}>
      <Text style={[styles.rowLabel, emphasis && styles.rowLabelEmphasis]}>{label}</Text>
      <Text style={[styles.rowValue, tone === 'over' && styles.over, tone === 'under' && styles.under]}>
        {value}
      </Text>
    </View>
  );
}

function Legend({ color, label }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fafafa' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: '#fff',
    elevation: 2,
  },
  navButton: {
    padding: 8,
    width: 48,
    alignItems: 'center',
  },
  navText: { fontSize: 24, color: '#1976d2', fontWeight: '700' },
  headerCenter: { alignItems: 'center' },
  monthTitle: { fontSize: 19, fontWeight: '700', color: '#333' },
  todayLink: { fontSize: 12, color: '#1976d2', marginTop: 2 },
  weekRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingBottom: 4,
  },
  weekdayCell: { width: '14.2857%', alignItems: 'center', paddingVertical: 6 },
  weekdayText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
  },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: '#fff',
  },
  // Exactly 1/7 of the row, matching both the weekday header and DayCell, so a
  // day can never drift out from under its column.
  cell: {
    width: '14.2857%',
    aspectRatio: 1,
  },
  card: {
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginBottom: 10,
  },
  cardNote: {
    fontSize: 12,
    lineHeight: 17,
    color: '#777',
    marginTop: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  rowEmphasis: {
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    marginTop: 6,
    paddingTop: 8,
  },
  rowLabel: { fontSize: 14, color: '#666' },
  rowLabelEmphasis: { fontSize: 15, fontWeight: '700', color: '#333' },
  rowValue: { fontSize: 14, fontWeight: '600', color: '#333' },
  over: { color: '#2e7d32' },
  under: { color: '#c62828' },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginTop: 20,
    paddingHorizontal: 16,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 8 },
  legendSwatch: { width: 12, height: 12, borderRadius: 2, marginRight: 5 },
  legendText: { fontSize: 11, color: '#666' },
});
