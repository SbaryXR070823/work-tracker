# CI setup

Builds run on GitHub Actions instead of EAS Build. Android and iOS are separate
workflows; each can be triggered on a `v*` tag or manually from the Actions tab.

**EAS Update is untouched.** `app.json` still carries the project id and
`updates.url`, so any binary built here can still receive OTA JS updates without
a rebuild.

## What was changed locally

| Change | Why |
| --- | --- |
| `android/app/build.gradle` reads its version and signing config from properties | Raw Gradle does not manage versioning; every build used to be version 1 |
| `android/app/build.gradle` signs `release` with a real keystore | It was signing releases with the debug key, which cannot be used for a real release |
| `.gitignore` excludes `ios/`, the keystore, and all `*.p8` / `*.mobilepprovision` | Nothing secret may reach a public repository |
| Duplicate `android.permission.*` entries removed from `app.json` | `INTERNET` and the two storage permissions were each listed twice |

`android/` **is** committed, on purpose: it holds the Gradle edits above, and
committing it keeps local builds working without a prebuild step. Only its build
output is ignored.

## Android secrets

Encode the keystore as base64. On this machine:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('D:\work-tracker\android\release.keystore')) |
  Set-Clipboard
```

Add these under **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the base64 string above |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `worktracker` |
| `ANDROID_KEY_PASSWORD` | same as the keystore password |

> **Back up the keystore and its password somewhere you will still find them in
> five years.** Play Store and TestFlight identify an app by the signing key. Lose
> it and you cannot ship another update to the app you have already published —
> you would have to publish a new package name and lose the install. A copy lives
> in `android/keystore.properties`, but that file is gitignored and this is the
> only machine it is on.

## iOS — what your friend has to do once

All of this happens in their Apple Developer account. Nothing is shared as a
password; you get a key and a certificate instead.

**1. Register the bundle id.** Developer portal → Identifiers → `+` → App IDs →
Explicit → `com.worktracker.app`. If that id is already taken, change
`ios.bundleIdentifier` in `app.json` first and register the new one.

**2. Create the App Store Connect record.** App Store Connect → My Apps → `+` →
iOS. Name it "Work Tracker", pick the bundle id from step 1, and set a SKU such
as `worktracker-ios-1`. This does not go to review and does not need screenshots.

**3. Create a distribution certificate.** Keys → Certificates → `+` →
**Apple Distribution**. Download it, then in Keychain Access export it as a
`.p12` with a password you choose:

```bash
# on their Mac
openssl pkcs12 -export -out dist.p12 -inkey "Certificate_<name>.key" \
  -in "Certificate_<name>.pem" -passout pass:<your-password>
```

`openssl pkcs12 -export` against a plain `.cer` will not work on its own; the
private key has to come out of the login keychain. Doing it through Xcode's
**Keychain Access → My Certificates → Export** is the reliable route.

**4. Create the provisioning profile.** Profiles → `+` → **App Store**. Pick the
certificate and the bundle id, name it (the name is what CI matches on, so keep
it simple like `WorkTrackerAppStore`), and download it.

**5. Create the API key.** Users & Access → Integrations → Team Keys → `+`,
role **App Manager**, then download the `.p8` file. It is offered once.

**6. Add you as a user.** Users & Access → `+` → invite the Apple ID you will
use on your iPhone, with the **App Manager** role. Internal TestFlight builds are
only installable by someone who is a user on the team.

Then encode the certificate and add the iOS secrets:

```bash
base64 -i dist.p12 | pbcopy     # the .p12
```

| Secret | Value |
| --- | --- |
| `APPLE_TEAM_ID` | from Keys → Membership, 10 characters |
| `APPLE_DISTRIBUTION_CERT_P12_BASE64` | base64 of the `.p12` |
| `APPLE_DISTRIBUTION_CERT_PASSWORD` | the password you set in step 3 |
| `APPLE_DISTRIBUTION_CERT_NAME` | e.g. `Apple Distribution: Name (TEAMID)` — must match exactly |
| `APPLE_PROVISIONING_PROFILE_NAME` | the name from step 4 |
| `APP_STORE_CONNECT_KEY_ID` | from the `.p8` filename, `AuthKey_XXXX.p8` |
| `APP_STORE_CONNECT_ISSUER_ID` | shown on the Team Keys page |
| `APP_STORE_CONNECT_KEY_P8` | the entire contents of the `.p8`, pasted as-is |

## Running it

```powershell
cd D:\work-tracker
git tag v1.0.1
git push origin v1.0.1        # triggers both workflows
```

Or use **Actions → Android / iOS → Run workflow** to build one without a tag.
The version shown in the app comes from the workflow's `versionName` input; the
internal version number is the GitHub run number, which increments every run and
so never collides with something TestFlight has already seen.

## If the iOS build fails

The archive step is the fragile one, and it was the part that could not be tested
from Windows. In rough order of likelihood:

- **`no matching key found`** — the `set-key-partition-list` step did not apply.
  It is present and must not be removed.
- **`No profiles for 'com.worktracker.app' were found`** — the provisioning
  profile name does not match `APPLE_PROVISIONING_PROFILE_NAME` exactly.
- **`Signing for ... requires a development team`** — `APPLE_TEAM_ID` is wrong or
  missing, or the certificate name in `APPLE_DISTRIBUTION_CERT_NAME` does not
  match what is in the keychain. `security find-identity -v -p codesigning` in the
  certificate step prints the exact names to copy.
- **Export succeeds but upload hangs** — that means the API key is wrong. Upload
  with an Apple ID and a password cannot work here, because 2FA has no screen to
  type into.
