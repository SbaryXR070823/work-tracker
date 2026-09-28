import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { exportData, importData } from '../storage/AsyncStorage';
import { sumWeekDemand } from '../utils/dateUtils';

// Loaded on demand so these native modules are not initialised during startup.
const getFileSystem = () => require('expo-file-system');
const getSharing = () => require('expo-sharing');

function toNumber(text, fallback) {
  const value = parseFloat(String(text).replace(',', '.'));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export default function SettingsScreen({
  settings,
  workDays,
  onSaveSettings,
  onReplaceData,
  onClearData,
}) {

  const [dailyHours, setDailyHours] = useState(String(settings?.dailyHours ?? 8));
  const [salaryDay, setSalaryDay] = useState(String(settings?.salaryDay ?? 1));
  const [saturdayHours, setSaturdayHours] = useState(String(settings?.saturdayHours ?? 4));
  const [sundayHours, setSundayHours] = useState(String(settings?.sundayHours ?? 0));
  const [busy, setBusy] = useState(false);

  // Live preview of the weekday demand for a normal week, so the user can see
  // the consequence of a change before saving it.
  const now = new Date();
  const weeklyTargetTotal = sumWeekDemand(
    { dailyHours: toNumber(dailyHours, settings?.dailyHours ?? 8) },
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  const handleSave = () => {
    const next = {
      dailyHours: toNumber(dailyHours, settings?.dailyHours ?? 8),
      // A pay day outside 1-31 is meaningless, and February is shorter than most
      // choices, so clamp to a day that exists in every month.
      salaryDay: Math.min(31, Math.max(1, Math.round(toNumber(salaryDay, settings?.salaryDay ?? 1)))),
      saturdayHours: toNumber(saturdayHours, settings?.saturdayHours ?? 4),
      sundayHours: toNumber(sundayHours, settings?.sundayHours ?? 0),
      // Retired settings, kept only so older backups still round-trip intact.
      // Nothing reads them: the weekday demand is per-day and the bank is a
      // running balance.
      weeklyHours: settings?.weeklyHours ?? 40,
      weeklyDays: settings?.weeklyDays ?? 5,
    };
    onSaveSettings(next);
    setDailyHours(String(next.dailyHours));
    setSalaryDay(String(next.salaryDay));
    setSaturdayHours(String(next.saturdayHours));
    setSundayHours(String(next.sundayHours));
    Alert.alert('Saved', 'Settings have been saved.');
  };

  const handleExport = async () => {
    setBusy(true);
    try {
      const { File, Paths } = getFileSystem();
      const json = await exportData(workDays, settings);
      const fileName = `work-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;

      const file = new File(Paths.document, fileName);
      if (file.exists) file.delete();
      file.create();
      file.write(json);

      const Sharing = getSharing();
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/json',
          dialogTitle: 'Save or share your backup',
          UTI: 'public.json',
        });
      } else {
        Alert.alert('Backup saved', file.uri);
      }
    } catch (e) {
      Alert.alert('Export failed', e?.message || 'Could not create the backup file.');
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    setBusy(true);
    try {
      const { File } = getFileSystem();

      const picked = await File.pickFileAsync({
        mimeTypes: ['application/json', 'text/plain', '*/*'],
      });

      if (picked.canceled || !picked.result) {
        setBusy(false);
        return;
      }

      const json = await picked.result.text();

      const result = await importData(json);
      if (!result.success) throw new Error(result.error);

      onReplaceData(result.data);
      const days = Object.keys(result.data.workDays).length;
      Alert.alert('Import complete', `Restored ${days} logged day${days === 1 ? '' : 's'}.`);
    } catch (e) {
      Alert.alert('Import failed', e?.message || 'Could not read the backup file.');
    } finally {
      setBusy(false);
    }
  };

  const handleClearData = () => {
    Alert.alert(
      'Clear all data',
      'This permanently deletes every logged day and resets your settings. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: async () => {
            await onClearData();
            setDailyHours('8');
            setSalaryDay('1');
            setSaturdayHours('4');
            setSundayHours('0');
            Alert.alert('Data cleared', 'All work history has been deleted.');
          },
        },
      ]
    );
  };

  const loggedDays = Object.keys(workDays || {}).length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Work schedule</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Expected hours per weekday (Mon–Fri)</Text>
        <TextInput
          style={styles.input}
          keyboardType="decimal-pad"
          value={dailyHours}
          onChangeText={setDailyHours}
          placeholder="8"
        />
        <Text style={styles.hint}>
          This is what a weekday owes you. Come in above it and the extra banks; fall short of it
          and the bank covers you, until the bank runs out.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Pay day</Text>
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          value={salaryDay}
          onChangeText={setSalaryDay}
          placeholder="1"
        />
        <Text style={styles.hint}>
          The work month runs from your pay day to the day before the next one, so 15 gives a
          cycle of the 15th to the 14th. Everything banked inside one work month is a single
          pot that any day in that same month can draw on, in either direction. Nothing
          carries past the pay day, and whatever is left at the end is your surplus.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Normal Saturday hours</Text>
        <TextInput
          style={styles.input}
          keyboardType="decimal-pad"
          value={saturdayHours}
          onChangeText={setSaturdayHours}
          placeholder="4"
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Normal Sunday hours</Text>
        <TextInput
          style={styles.input}
          keyboardType="decimal-pad"
          value={sundayHours}
          onChangeText={setSundayHours}
          placeholder="0"
        />
        <Text style={styles.hint}>
          A reference for what a weekend day normally looks like, not something you owe. Every
          hour you log on a Saturday or Sunday goes into the work month bank in full. Working
          one in advance is what makes it useful: those hours can then cover a short weekday
          earlier in the same work month just as well as a later one.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Weekday target per week</Text>
        <Text style={styles.computedValue}>
          {weeklyTargetTotal.toFixed(1).replace(/\.0$/, '')}h
        </Text>
        <Text style={styles.hint}>
          Five times the weekday target above, so the calendar and the summaries can never
          disagree. The bank is added on top of this, not subtracted from it.
        </Text>
      </View>

      <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={busy}>
        <Text style={styles.saveButtonText}>Save settings</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Backup &amp; restore</Text>
      <Text style={styles.hint}>
        {loggedDays} day{loggedDays === 1 ? '' : 's'} logged. Backups are plain JSON files you can
        keep anywhere.
      </Text>

      <TouchableOpacity style={styles.backupButton} onPress={handleExport} disabled={busy}>
        <Text style={styles.backupButtonText}>Export backup file</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.backupButton} onPress={handleImport} disabled={busy}>
        <Text style={styles.backupButtonText}>Import backup file</Text>
      </TouchableOpacity>

      {busy ? <ActivityIndicator style={styles.spinner} /> : null}

      <Text style={styles.sectionTitle}>Danger zone</Text>

      <TouchableOpacity style={styles.dangerButton} onPress={handleClearData} disabled={busy}>
        <Text style={styles.dangerButtonText}>Clear all data</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fafafa',
  },
  content: {
    padding: 16,
    paddingBottom: 48,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginTop: 8,
    marginBottom: 12,
  },
  hint: {
    fontSize: 13,
    color: '#666',
    marginBottom: 12,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    elevation: 1,
  },
  label: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  computedValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1976d2',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#111',
  },
  saveButton: {
    backgroundColor: '#1976d2',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 8,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  backupButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
    elevation: 1,
    borderWidth: 1,
    borderColor: '#1976d2',
  },
  backupButtonText: {
    color: '#1976d2',
    fontSize: 16,
    fontWeight: '600',
  },
  spinner: {
    marginBottom: 12,
  },
  dangerButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#c62828',
  },
  dangerButtonText: {
    color: '#c62828',
    fontSize: 16,
    fontWeight: '600',
  },
});
