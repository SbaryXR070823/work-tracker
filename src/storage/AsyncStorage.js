import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  WORK_DAYS: 'work_days',
  SETTINGS: 'settings',
};

export async function saveWorkDays(workDays) {
  try {
    await AsyncStorage.setItem(KEYS.WORK_DAYS, JSON.stringify(workDays));
  } catch (e) {
    console.error('Failed to save work days:', e);
  }
}

export async function loadWorkDays() {
  try {
    const data = await AsyncStorage.getItem(KEYS.WORK_DAYS);
    return data ? JSON.parse(data) : {};
  } catch (e) {
    console.error('Failed to load work days:', e);
    return {};
  }
}

export async function saveSettings(settings) {
  try {
    await AsyncStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

export async function loadSettings() {
  try {
    const data = await AsyncStorage.getItem(KEYS.SETTINGS);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    console.error('Failed to load settings:', e);
    return null;
  }
}

export async function clearAll() {
  try {
    await AsyncStorage.multiRemove([KEYS.WORK_DAYS, KEYS.SETTINGS]);
    return true;
  } catch (e) {
    console.error('Failed to clear data:', e);
    return false;
  }
}

export async function exportData(workDays, settings) {
  return JSON.stringify(
    {
      app: 'work-tracker',
      version: 1,
      exportedAt: new Date().toISOString(),
      workDays,
      settings,
    },
    null,
    2
  );
}

/**
 * Validates and applies a backup payload. Returns the parsed data so the caller
 * can push it into React state without waiting for a reload.
 */
export async function importData(jsonString) {
  let data;
  try {
    data = JSON.parse(jsonString);
  } catch (e) {
    return { success: false, error: 'That file is not valid JSON.' };
  }

  if (!data || typeof data !== 'object' || typeof data.workDays !== 'object' || data.workDays === null) {
    return { success: false, error: 'That file is not a Work Tracker backup.' };
  }

  const workDays = {};
  for (const [key, value] of Object.entries(data.workDays)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    const num = parseFloat(value);
    if (!Number.isNaN(num)) workDays[key] = num;
  }

  // `|| fallback` would turn a deliberate 0 into the default, so weekend days
  // (which are legitimately 0 = rest day) are checked for presence instead.
  const settings = {
    dailyHours: parseFloat(data.settings?.dailyHours) || 8,
    // Clamped to a real calendar day, since a cycle start of 0 or 40 is
    // meaningless and February is shorter than most payday choices.
    salaryDay: Math.min(
      31,
      Math.max(1, parseInt(data.settings?.salaryDay, 10) || 1)
    ),
    saturdayHours:
      data.settings?.saturdayHours === undefined
        ? 4
        : Math.max(0, parseFloat(data.settings.saturdayHours) || 0),
    sundayHours:
      data.settings?.sundayHours === undefined
        ? 0
        : Math.max(0, parseFloat(data.settings.sundayHours) || 0),
    // Retired, carried through untouched so an old backup round-trips cleanly.
    weeklyHours: parseFloat(data.settings?.weeklyHours) || 40,
    weeklyDays: parseInt(data.settings?.weeklyDays, 10) || 5,
  };

  await saveWorkDays(workDays);
  await saveSettings(settings);

  return { success: true, data: { workDays, settings } };
}
