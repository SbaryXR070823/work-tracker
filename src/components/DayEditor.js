import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  StyleSheet,
} from 'react-native';
import {
  formatDate,
  getMonthName,
  getPayLedger,
  getWeekdayName,
  round2,
} from '../utils/dateUtils';

export default function DayEditor({
  visible,
  year,
  month,
  day,
  workValue,
  record,
  workDays,
  settings,
  onSave,
  onClose,
}) {
  const [value, setValue] = useState('');

  useEffect(() => {
    const parsed = parseFloat(workValue);
    setValue(Number.isFinite(parsed) ? String(parsed) : '');
  }, [workValue, visible, year, month, day]);

  const parsed = parseFloat(value.replace(',', '.'));
  const hasValue = Number.isFinite(parsed);

  const demand = record ? record.demand : 0;
  const reference = record ? record.reference : 0;
  const weekend = record ? record.weekend : false;

  // Preview what the typed value does. The bank is one pot for the whole
  // working month, so saving a weekend can change the verdict on a weekday
  // earlier in the cycle. Re-running the ledger with the edit in place is the
  // only honest way to preview that; the old bankStart arithmetic could not see
  // it and would quietly disagree with the calendar.
  const preview = useMemo(() => {
    if (!record || !hasValue) return null;
    const key = formatDate(year, month, day);
    const date = new Date(year, month, day);
    const before = getPayLedger(workDays, settings, date);
    const after = getPayLedger({ ...workDays, [key]: parsed }, settings, date);
    const edited = after.byKey[key];
    if (!edited) return null;

    // How much of this cycle's *other* shortfalls the edit puts back in the
    // clear. Only worth mentioning when the pot is what moved.
    let rescued = 0;
    for (const b of before.days) {
      if (b.key === key) continue;
      const a = after.byKey[b.key];
      if (a && b.uncovered > a.uncovered) rescued += b.uncovered - a.uncovered;
    }
    return { record: edited, rescued: round2(rescued) };
  }, [record, hasValue, parsed, workDays, settings, year, month, day]);

  const effect = preview ? preview.record : null;
  const rescued = preview ? preview.rescued : 0;

  const subtitle = !record
    ? 'No target set'
    : weekend
      ? reference > 0
        ? `Weekend — a normal ${getWeekdayName(record.date.getDay())} is ${reference}h`
        : 'Rest day — every hour here is banked'
      : demand > 0
        ? `Target: ${demand}h`
        : 'Rest day — no target';

  const handleSave = () => {
    onSave(year, month, day, hasValue ? parsed : null);
  };

  const footer = () => {
    if (!effect) {
      return <Text style={styles.hint}>Leave empty and save to clear this day.</Text>;
    }
    // The pot runs both ways, so say so when an edit reaches other days.
    const spill =
      rescued > 0.05 ? (
        <Text style={styles.spill}>
          {rescued.toFixed(1)}h of shortfalls elsewhere in this work month come back into the clear
        </Text>
      ) : null;

    if (effect.uncovered > 0) {
      return (
        <>
          <Text style={[styles.diffText, styles.under]}>
            {effect.uncovered.toFixed(1)}h under — the bank does not have the rest
          </Text>
          {spill}
        </>
      );
    }
    if (effect.shortfall > 0) {
      return (
        <>
          <Text style={[styles.diffText, styles.covered]}>
            {effect.shortfall.toFixed(1)}h short, covered by the bank ({effect.bankEnd.toFixed(1)}h
            left in the work month)
          </Text>
          {spill}
        </>
      );
    }
    return (
      <>
        <Text style={[styles.diffText, effect.deposit > 0.05 ? styles.over : styles.even]}>
          {effect.deposit > 0.05
            ? `+${effect.deposit.toFixed(1)}h into the work month bank`
            : 'On target, nothing banked'}
        </Text>
        {spill}
      </>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <Text style={styles.title}>
            {getMonthName(month)} {day}, {year}
          </Text>
          <Text style={styles.subtitle}>{subtitle}</Text>

          <TextInput
            style={styles.input}
            placeholder="Hours worked (e.g. 7.5)"
            keyboardType="decimal-pad"
            value={value}
            onChangeText={setValue}
            autoFocus
            selectTextOnFocus
          />

          {footer()}

          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
              <Text style={styles.saveText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  dialog: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    elevation: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#333',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 18,
    textAlign: 'center',
    color: '#111',
    marginBottom: 12,
  },
  diffText: {
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
  },
  hint: {
    textAlign: 'center',
    fontSize: 12,
    color: '#888',
    marginBottom: 16,
  },
  spill: {
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 17,
    color: '#5a6b7d',
    marginTop: -10,
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  over: { color: '#2e7d32' },
  under: { color: '#c62828' },
  covered: { color: '#b26a00' },
  even: { color: '#666' },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cancelButton: {
    flex: 1,
    padding: 12,
    marginRight: 8,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
  },
  cancelText: { fontSize: 16, color: '#666' },
  saveButton: {
    flex: 1,
    padding: 12,
    marginLeft: 8,
    borderRadius: 8,
    backgroundColor: '#1976d2',
    alignItems: 'center',
  },
  saveText: { fontSize: 16, color: '#fff', fontWeight: '600' },
});
