# Work Tracker

Offline-first work hours tracker for Android and iOS. No backend, no account, no network calls —
everything is stored on the device and travels with you as a JSON backup file.

## Features

- **Calendar view** — whole month at a glance, Monday-first grid
- **Daily logging** — tap any day and enter hours worked; leave it empty to clear the day
- **Weekday target** — the hours a Mon–Fri day owes you. Above it is a bonus, below it draws on the
  bank
- **Hour bank** — one pot of spare hours for the whole work month. Weekend work and any weekday
  overtime go in; a short weekday draws on it, so the bank absorbs a shortfall on *any* day, not a
  chosen one
- **The bank runs both ways** — hours banked anywhere in the work month can cover a shortfall
  *earlier* in that same month, not only later ones. So a Saturday the manager approved in advance
  can settle a short Tuesday, even though the Saturday comes after it
- **The bank is a reserve, never a discount** — a full 8h Monday reads "on target" even with 4h
  waiting in the bank. It is only consulted when a day comes up short
- **Configurable pay day** — the work month runs pay day to pay day, so a pay day of the 15th gives
  a cycle of the 15th to the 14th. The pot holds only hours banked inside that cycle, so nothing
  carries over the pay day in either direction
- **Daily colour coding** — green = banked hours, amber = shortfall covered by the bank,
  red = under with the bank empty, blue = today
- **Summaries** — this week and the current work month, both read from the same ledger as the grid
- **Backup & restore** — export a JSON file and re-import it on any device
- **Clear all data** — one tap, with confirmation

### How a day is judged

Only weekdays carry a demand. First the whole work month is totalled up, then the pot is handed
out against the shortfalls, oldest first:

| Situation | Effect on the pot | The day reads |
| --- | --- | --- |
| Weekday, at or above target | — | on target |
| Weekday, above target by X | **+X** | +X over |
| Weekday, X short, pot has ≥ X | **−X** | on target (covered) |
| Weekday, X short, pot has Y < X | **−Y**, and X−Y is under | X−Y under |
| Weekend or rest day, N hours logged | **+N** (all of it) | +N banked |

The order matters. Settling every day's deposit and shortfall *before* handing any of it out is what
lets the pot run backwards: a Sunday worked in advance is in the pot when the Monday and Tuesday
before it are judged.

Two consequences worth knowing:

- **The pot is closed at the pay day.** It can reach anywhere inside the work month, forwards or
  backwards, but not across the boundary. With a pay day of the 15th, hours banked on 26 September
  can cover 3 October, and nothing banked on 26 September can cover 20 October.
- **An unlogged weekday is an 8h shortfall.** The app cannot tell "did not work" from "did not
  log", so a day you never touch is counted as missed. The pot absorbs these while it lasts

A normal week of demand is `5 × weekday hours` — 40h at the defaults. There is deliberately no
separate "expected hours per week" field: a stored weekly value drifts out of step with the
per-day targets (5 × 8h plus a 4h Saturday is 44h, not 40h) and then the day cells and the
summary cards disagree about whether you are over or under. The weekday total shown in Settings is
derived, and the bank is added on top of it rather than subtracted from it.

## Requirements

- [Node.js](https://nodejs.org/) 20 or newer
- An [Expo](https://docs.expo.dev/get-started/installation/) account (free) for cloud builds
- Android: a device on Android 6 (API 23) or newer
- iOS: iOS 15.1 or newer
- Expo Go **SDK 57** on the phone, to run the dev server

> **Expo Go must match the project SDK exactly.** Expo Go ships one SDK version per release, so an
> SDK 57 Expo Go cannot open this project and vice versa. If you see "Project is incompatible with
> this version of Expo Go", upgrade the project rather than the app.

## Install & develop

```bash
cd D:\work-tracker
npm install
npm test          # verifies the calendar date maths
npm start         # starts Metro; press a for Android, i for iOS
```

## Build installable apps

Cloud builds produce standalone binaries (no Expo Go needed). This machine has no JDK, so local
Gradle builds are not possible here.

```powershell
cd D:\work-tracker
$env:EAS_NO_VCS = "1"          # this machine has no git installed
eas login
eas build --platform android --profile preview
```

- **Android** finishes non-interactively. The download link appears in the build page on
  <https://expo.dev/accounts/asi0111/projects/work-tracker/builds>.
- **iOS** must be run from a terminal where you can answer prompts, because Apple requires an
  Apple ID plus an app-specific password the first time:

  ```powershell
  eas build --platform ios --profile preview
  ```

  Choose **Ad Hoc** distribution and an Apple team when asked. EAS will register a signing
  certificate and a provisioning profile for you.

## Usage

1. Open the **Settings** tab and set your weekday hours and pay day. The Saturday and Sunday values
   are a reference for what a weekend day normally looks like, not something you owe — every hour
   you log on a weekend banks in full, and can then cover a short weekday anywhere in the same work
   month.
2. Open the **Calendar** tab and tap a day to log hours. Save with an empty field to clear it. The
   editor re-runs the whole work month as you type, so it shows the real outcome, e.g.
   `1.0h short, covered by the bank (3.0h left in the work month)`. When an edit reaches other days
   it says so — working a Saturday can pull a short Wednesday back into the clear, and the editor
   will tell you how much of the month's other shortfalls that rescued.
3. Check **This week** and **Work month** for where you stand. The pot is confined to one work
   month, so a cycle that is fully logged and fully met ends on 0h.
4. Use **Export backup file** regularly and keep the JSON somewhere safe. Use
   **Import backup file** to restore it — this replaces all current data.

## Project structure

```
D:\work-tracker\
├── index.js                     # Entry point — calls registerRootComponent(App)
├── App.js                       # Root component, tab switcher, data loading
├── app.json                     # Expo config (name, icons, permissions, plugins)
├── eas.json                     # EAS build profiles
├── generate-assets.js           # Regenerates the placeholder icon/splash PNGs
├── test-dateutils.js            # Calendar maths checks (npm test)
├── assets\                      # icon.png, adaptive-icon.png, splash.png
└── src\
    ├── components\
    │   ├── DayCell.js           # Colour-coded calendar cell
    │   ├── DayEditor.js         # Per-day entry modal
    │   └── ErrorBoundary.js     # Shows JS errors instead of a silent crash
    ├── screens\
    │   ├── CalendarScreen.js    # Calendar + weekly/monthly summaries
    │   └── SettingsScreen.js    # Targets, backup, clear data
    ├── storage\
    │   └── AsyncStorage.js      # Persistence, export, import
    └── utils\
        ├── dateUtils.js         # Date helpers
        └── errorReporter.js     # Persists the last uncaught error
```

## Tech stack

- React Native 0.86 via Expo SDK 57, on the New Architecture
- React 19
- No navigation library — `App.js` switches between the two screens with plain React state, which
  keeps the native startup surface to a minimum
- `react-native-safe-area-context` for window insets. Android 15+ enforces edge-to-edge, so the app
  draws under the status and navigation bars by design; the tab bar pads itself by `insets.bottom`
  so it clears both the gesture pill and the 3-button bar
- `@react-native-async-storage/async-storage` for local persistence
- `expo-file-system` for writing and reading backup files (its `File.pickFileAsync` also provides
  the import file picker) and `expo-sharing` for the export share sheet

## Troubleshooting

**The app closes immediately on Android.** `package.json` must have `"main": "index.js"`, and
`index.js` must call `registerRootComponent(App)`. If `main` points straight at `App.js` the app
crashes on launch with `Invariant Violation: "main" has not been registered`, because nothing ever
calls `AppRegistry.registerComponent`. It looks like a blank white screen followed by a close.

Otherwise, run it through Expo Go — it shows the real error on screen instead of swallowing it:

```powershell
cd D:\work-tracker
npx expo start
```

Scan the QR with Expo Go (SDK 50). If it works there but not in the installed APK, the fault is in
the native build; if it fails there too, the red screen names the offending line.

For a release build, collect the native log:

```bash
adb logcat -c
adb shell am start -n com.worktracker.app/.MainActivity
adb logcat -d | findstr /I "ReactNativeJS AndroidRuntime expo"
```

The app also stores the last uncaught error and shows it on a red error screen on the next launch,
so if you get a readable message, that is the cause.

**iOS build fails with "couldn't find any credentials suitable for internal distribution".**
Run `eas build --platform ios --profile preview` interactively and sign in when prompted.
