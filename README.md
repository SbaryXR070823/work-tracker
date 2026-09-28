# Work Tracker

Offline-first work hours tracker for Android and iOS. No backend, no account, no network
calls. All data is stored on the device and moves between devices as a JSON backup file.

## Features

- **Calendar view** showing the whole month at a glance in a Monday-first grid
- **Daily logging**: tap any day and enter hours worked, or save an empty field to clear the day
- **Weekday target**: the hours a Monday to Friday day owes you. Hours above it are a bonus,
  hours below it draw on the bank
- **Hour bank**: a single pot of spare hours covering the whole work month
- **Two-way bank**: hours banked anywhere in the work month can settle a shortfall earlier in
  that same month, not only later ones. A Saturday worked in advance can cover a short Tuesday
  that came before it
- **The bank is a reserve, not a discount**: a full 8h Monday reads "on target" even with 4h
  waiting in the bank. The pot is only consulted when a day comes up short
- **Configurable pay day**: the work month runs pay day to pay day, so a pay day of the 15th
  gives a cycle from the 15th to the 14th. The pot holds only hours banked inside that cycle
- **Daily colour coding**: green for banked hours, amber for a shortfall covered by the bank,
  red for under with an empty bank, blue for today
- **Summaries** for the current week and work month, read from the same ledger as the grid
- **Backup and restore** by exporting and re-importing a JSON file
- **Clear all data** in one tap, behind a confirmation

## The bank model

Only weekdays carry a demand. The whole work month is totalled first, then the pot is handed
out against the shortfalls in date order.

| Situation | Effect on the pot | The day reads |
| --- | --- | --- |
| Weekday, at or above target | no change | on target |
| Weekday, above target by X | +X | +X over |
| Weekday, X short, pot has at least X | -X | on target (covered) |
| Weekday, X short, pot has Y less than X | -Y, and X-Y is under | X-Y under |
| Weekend or rest day, N hours logged | +N | +N banked |

Settling every deposit and shortfall before handing any of it out is what lets the pot run
backwards. A Sunday worked in advance is already in the pot when the Monday and Tuesday before
it are judged.

Two consequences follow from this:

- **The pot is closed at the pay day.** It reaches anywhere inside the work month, forwards or
  backwards, but never across the boundary. With a pay day of the 15th, hours banked on
  26 September cover 3 October, and nothing banked on 26 September covers 20 October.
- **An unlogged weekday counts as an 8h shortfall.** The app cannot distinguish "did not work"
  from "did not log", so an untouched day is treated as missed. The pot absorbs these while it
  lasts.

A normal week of demand is five times the weekday target, which is 40h at the defaults. There
is deliberately no separate "expected hours per week" field. A stored weekly value drifts out
of step with the per-day targets, since 5 x 8h plus a 4h Saturday is 44h rather than 40h, and
the day cells and the summary cards then disagree about whether you are over or under. The
weekday total shown in Settings is derived from the per-day target, and the bank is added on
top of it rather than subtracted from it.

When the pot cannot cover every shortfall, earlier days in the cycle are settled first.

## Requirements

- [Node.js](https://nodejs.org/) 20 or newer
- Android: a device on Android 6 (API 23) or newer
- iOS: iOS 15.1 or newer
- For the dev server only, Expo Go **SDK 57** on the phone

Expo Go must match the project SDK exactly. Expo Go ships one SDK version per release, so an
SDK 57 Expo Go cannot open this project, and the reverse also holds. If you see "Project is
incompatible with this version of Expo Go", upgrade the project rather than the app.

## Install and develop

```bash
git clone https://github.com/SbaryXR070823/work-tracker
cd work-tracker
npm install
npm test
npm start
```

`npm test` runs the calendar date checks. `npm start` starts Metro; press `a` for Android or
`i` for iOS.

## Usage

1. Open the **Settings** tab and set your weekday hours and pay day. The Saturday and Sunday
   values describe what a weekend day normally looks like. They are not owed hours: every hour
   logged on a weekend banks in full and can cover a short weekday anywhere in the same work
   month.
2. Open the **Calendar** tab and tap a day to log hours. Save an empty field to clear the day.
   The editor re-runs the whole work month as you type, so it shows the real outcome, for
   example `1.0h short, covered by the bank (3.0h left in the work month)`. When an edit
   reaches other days it says so, and reports how much of the month's other shortfalls were
   rescued.
3. Check **This week** and **Work month** for where you stand. The pot is confined to one work
   month, so a cycle that is fully logged and fully met ends on 0h.
4. Use **Export backup file** regularly and keep the JSON somewhere safe. **Import backup
   file** restores it, and replaces all current data.

## Project structure

```
work-tracker/
├── index.js                     Entry point, calls registerRootComponent(App)
├── App.js                       Root component, tab switcher, data loading
├── app.json                     Expo config: name, icons, permissions, plugins
├── eas.json                     EAS build profiles
├── generate-assets.js           Regenerates the placeholder icon and splash PNGs
├── test-dateutils.js            Calendar date checks, run by npm test
├── assets/                      icon.png, adaptive-icon.png, splash.png
├── src/
│   ├── components/
│   │   ├── DayCell.js           Colour-coded calendar cell
│   │   ├── DayEditor.js         Per-day entry modal
│   │   └── ErrorBoundary.js     Shows JS errors instead of a silent crash
│   ├── screens/
│   │   ├── CalendarScreen.js    Calendar plus weekly and monthly summaries
│   │   └── SettingsScreen.js    Targets, backup, clear data
│   ├── storage/
│   │   └── AsyncStorage.js      Persistence, export, import
│   └── utils/
│       ├── dateUtils.js         Date helpers and the pay ledger
│       └── errorReporter.js     Persists the last uncaught error
```

## Tech stack

- React Native 0.86 via Expo SDK 57, on the New Architecture
- React 19
- No navigation library. `App.js` switches between the two screens with plain React state,
  which keeps the native startup surface small
- `react-native-safe-area-context` for window insets. Android 15 and newer enforce edge to
  edge, so the app draws under the status and navigation bars by design. The tab bar pads
  itself by `insets.bottom` to clear both the gesture pill and the 3-button bar
- `@react-native-async-storage/async-storage` for local persistence
- `expo-file-system` for reading and writing backup files, and `expo-sharing` for the export
  share sheet

## Builds

Release builds run on GitHub Actions from the workflows in `.github/workflows`. Android
produces an APK artifact; iOS requires an Apple Developer account and uploads to TestFlight
through the App Store Connect API.

Every value the workflows need is supplied as a repository secret, so nothing sensitive is
stored in the repository. Local release builds read the same credentials from a
gitignored properties file in `android/`.

`build-apk.ps1` builds Android locally, which is faster than CI and needs no secrets:

```powershell
.\build-apk.ps1 -Variant release          # about 17 seconds
.\build-apk.ps1 -Variant release -Install # build, then install over USB
```

EAS Update remains configured through the project id and `updates.url` in `app.json`, so a
built binary can receive OTA JavaScript updates without a rebuild.

## Troubleshooting

**The app closes immediately on Android.** `package.json` must have `"main": "index.js"`, and
`index.js` must call `registerRootComponent(App)`. If `main` points straight at `App.js`, the
app crashes on launch with `Invariant Violation: "main" has not been registered`, because
nothing ever calls `AppRegistry.registerComponent`. It presents as a blank white screen
followed by a close.

Otherwise run it through Expo Go, which shows the real error on screen instead of swallowing
it. If it works there but not in the installed APK, the fault is in the native build. If it
fails there too, the red screen names the offending line.

For a release build, collect the native log:

```bash
adb logcat -c
adb shell am start -n com.worktracker.app/.MainActivity
adb logcat -d | findstr /I "ReactNativeJS AndroidRuntime expo"
```

The app also stores the last uncaught error and shows it on a red error screen on the next
launch, so a readable message there is the cause.
