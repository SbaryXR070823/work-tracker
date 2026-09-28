import React from 'react';
import { Text, StyleSheet, TouchableOpacity, View } from 'react-native';
import { isToday } from '../utils/dateUtils';

// The gap is drawn by an inner view so the outer cell stays exactly 1/7 wide.
// Giving the cell itself a margin overflows the row and wraps the 7th column
// onto the next line, which shifts every cell out from under its weekday header.
const CELL_WIDTH = '14.2857%';

const BACKGROUNDS = {
  // Put hours in the bank, or logged time on a weekend/rest day.
  over: '#c8e6c9',
  // Fell short, but the bank had the hours to cover it.
  covered: '#fff3e0',
  // Fell short with nothing left in the bank.
  under: '#ffcdd2',
  even: '#ffffff',
};

export default function DayCell({ year, month, day, workValue, record, onPress }) {
  const status = record ? record.status : 'even';
  const backgroundColor = isToday(year, month, day) ? '#e3f2fd' : BACKGROUNDS[status];

  const logged = record ? record.worked : 0;
  const hasWork = logged > 0;
  const isFuture = record ? record.future : false;

  // Only the bank's view of the day is worth showing: what it added, or what it
  // could not cover. A covered shortfall reads as on target, told by the colour.
  let caption = null;
  if (status === 'under') caption = `−${record.uncovered.toFixed(1)}`;
  else if (status === 'over') caption = `+${record.deposit.toFixed(1)}`;

  const accessibilityLabel = [
    day,
    hasWork ? `${logged} hours logged` : 'no hours logged',
    status === 'under' ? `${record.uncovered} hours under, bank empty` : '',
    status === 'over' ? `${record.deposit} hours banked` : '',
    status === 'covered' ? 'short but covered by the bank' : '',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <TouchableOpacity
      style={styles.cell}
      onPress={() => onPress(year, month, day)}
      activeOpacity={0.7}
      accessibilityLabel={accessibilityLabel}
    >
      <View style={[styles.inner, { backgroundColor }]}>
        <Text style={[styles.dayText, isToday(year, month, day) && styles.todayText]}>
          {day}
        </Text>
        {hasWork ? (
          <Text style={[styles.workText, isFuture && styles.futureText]}>{logged}h</Text>
        ) : null}
        {caption ? (
          <Text style={[styles.captionText, status === 'under' ? styles.underText : styles.overText]}>
            {caption}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  cell: {
    width: CELL_WIDTH,
    aspectRatio: 1,
    padding: 1,
  },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
  },
  dayText: { fontSize: 13, color: '#333', fontWeight: '600' },
  todayText: { color: '#1976d2' },
  workText: { fontSize: 10, color: '#555', marginTop: 1 },
  futureText: { color: '#aaa' },
  captionText: { fontSize: 9, fontWeight: '700', marginTop: 1 },
  overText: { color: '#2e7d32' },
  underText: { color: '#c62828' },
});
