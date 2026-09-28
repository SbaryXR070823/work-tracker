import React, { useState, useEffect, useCallback } from 'react';
import { Text, View, StyleSheet, StatusBar, TouchableOpacity } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import CalendarScreen from './src/screens/CalendarScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ErrorBoundary from './src/components/ErrorBoundary';
import { installErrorReporter } from './src/utils/errorReporter';
import {
  loadWorkDays,
  loadSettings,
  saveWorkDays,
  saveSettings,
  clearAll,
} from './src/storage/AsyncStorage';

installErrorReporter();

const TABS = [
  { key: 'calendar', label: 'Calendar', icon: '📅' },
  { key: 'settings', label: 'Settings', icon: '⚙️' },
];

const DEFAULT_SETTINGS = {
  dailyHours: 8,
  // The work month runs payday to payday, so 15 means the 15th to the 14th.
  salaryDay: 1,
  saturdayHours: 4,
  sundayHours: 0,
  // Retired: the weekly figure is derived from the per-day targets, and the
  // hour bank is a running balance. Kept only so older backups still import.
  weeklyHours: 40,
  weeklyDays: 5,
};

// Android 15+ enforces edge-to-edge, so the app draws under the status and navigation bars.
// The tab bar must reserve room for whichever the user has: gesture pill or 3-button bar.
function TabBar({ active, onChange, bottomInset }) {
  return (
    <View style={[styles.tabBar, { paddingBottom: Math.max(bottomInset, 6) }]}>
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, isActive && styles.tabActive]}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={tab.label}
          >
            <Text style={[styles.tabIcon, isActive && styles.tabTextActive]}>{tab.icon}</Text>
            <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Root() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState('calendar');
  const [workDays, setWorkDays] = useState({});
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const [storedWorkDays, storedSettings] = await Promise.all([
        loadWorkDays(),
        loadSettings(),
      ]);
      setWorkDays(storedWorkDays || {});
      setSettings({ ...DEFAULT_SETTINGS, ...(storedSettings || {}) });
      setLoaded(true);
    })();
  }, []);

  const handleSaveWorkDay = useCallback((dateKey, value) => {
    setWorkDays((prev) => {
      const next = { ...prev };
      if (value === null || value === undefined || value === '') {
        delete next[dateKey];
      } else {
        next[dateKey] = value;
      }
      saveWorkDays(next);
      return next;
    });
  }, []);

  const handleSaveSettings = useCallback((newSettings) => {
    const merged = { ...DEFAULT_SETTINGS, ...newSettings };
    setSettings(merged);
    saveSettings(merged);
  }, []);

  const handleReplaceData = useCallback(({ workDays: nextWorkDays, settings: nextSettings }) => {
    setWorkDays(nextWorkDays);
    setSettings({ ...DEFAULT_SETTINGS, ...nextSettings });
  }, []);

  const handleClearData = useCallback(async () => {
    await clearAll();
    setWorkDays({});
    setSettings(DEFAULT_SETTINGS);
  }, []);

  if (!loaded) {
    return (
      <View
        style={[
          styles.loading,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        <StatusBar barStyle="dark-content" />
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <View style={[styles.body, { paddingTop: insets.top }]}>
        {tab === 'calendar' ? (
          <CalendarScreen
            workDays={workDays}
            settings={settings}
            onSaveWorkDay={handleSaveWorkDay}
          />
        ) : (
          <SettingsScreen
            settings={settings}
            workDays={workDays}
            onSaveSettings={handleSaveSettings}
            onReplaceData={handleReplaceData}
            onClearData={handleClearData}
          />
        )}
      </View>
      <TabBar active={tab} onChange={setTab} bottomInset={insets.bottom} />
    </View>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <Root />
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#fafafa',
  },
  body: {
    flex: 1,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fafafa',
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  tabActive: {
    backgroundColor: '#f5f9ff',
  },
  tabIcon: {
    fontSize: 20,
  },
  tabText: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  tabTextActive: {
    color: '#1976d2',
    fontWeight: '700',
  },
});
