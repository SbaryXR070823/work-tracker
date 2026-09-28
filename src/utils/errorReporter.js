import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_ERROR_KEY = 'last_crash';

function describe(error) {
  if (!error) return { message: 'Unknown error', stack: '' };
  if (typeof error === 'string') return { message: error, stack: '' };
  return {
    message: String(error.message || error),
    stack: String(error.stack || ''),
  };
}

export async function saveLastError(error, isFatal) {
  try {
    const { message, stack } = describe(error);
    await AsyncStorage.setItem(
      LAST_ERROR_KEY,
      JSON.stringify({ message, stack, isFatal: !!isFatal, time: new Date().toISOString() })
    );
  } catch (e) {
    // Nothing we can do if storage itself is broken.
  }
}

export async function loadLastError() {
  try {
    const raw = await AsyncStorage.getItem(LAST_ERROR_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export async function clearLastError() {
  try {
    await AsyncStorage.removeItem(LAST_ERROR_KEY);
  } catch (e) {}
}

/**
 * In a release build an uncaught JS error tears the app down with no visible
 * message, so persist it before handing control back to the default handler.
 */
export function installErrorReporter() {
  const ErrorUtils = global.ErrorUtils;
  if (!ErrorUtils || ErrorUtils.__workTrackerInstalled) return;
  ErrorUtils.__workTrackerInstalled = true;

  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    saveLastError(error, isFatal);
    if (previous) previous(error, isFatal);
  });
}
