<#
  Builds the Android APK locally, no EAS build and no build quota involved.

  Examples
    .\build-apk.ps1                          # debug APK (needs Metro running)
    .\build-apk.ps1 -Variant release         # standalone APK, JS bundled in
    .\build-apk.ps1 -Variant release -Install # ...and install over USB

  Notes
    Debug builds load JavaScript from the Metro dev server, so the phone must be
    able to reach it. Over USB, `adb reverse` handles that for you (see -Install).
    Release builds embed the JS bundle, so they run completely on their own.
#>
[CmdletBinding()]
param(
  [ValidateSet('debug', 'release')]
  [string] $Variant = 'debug',

  # Your Samsung A34 is arm64. Building every ABI is roughly 4x slower for no gain.
  [string] $Abi = 'arm64-v8a',

  [switch] $Install
)

$ErrorActionPreference = 'Continue'
$projectRoot = $PSScriptRoot
$androidDir = Join-Path $projectRoot 'android'

# --- Locate the JDK ------------------------------------------------------------
# JAVA_HOME was set at install time; fall back to searching Program Files so this
# keeps working if you move or reinstall the JDK.
$jdk = $env:JAVA_HOME
if (-not $jdk -or -not (Test-Path (Join-Path $jdk 'bin\java.exe'))) {
  $jdk = Get-ChildItem 'C:\Program Files\Microsoft' -Directory -ErrorAction SilentlyContinue |
    Where-Object Name -match '^jdk-.*hotspot$' |
    Sort-Object Name -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $jdk) { throw 'No JDK found. Install one: winget install Microsoft.OpenJDK.21' }

# --- Locate the Android SDK ----------------------------------------------------
$sdk = $env:ANDROID_HOME
if (-not $sdk -or -not (Test-Path (Join-Path $sdk 'cmdline-tools'))) {
  $sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
}
if (-not (Test-Path (Join-Path $sdk 'cmdline-tools'))) {
  throw "No Android SDK at $sdk. Run: sdkmanager ""platform-tools"" ""platforms;android-35"" ""build-tools;35.0.0"" ""cmake;3.22.1"" ""ndk;27.1.12297006"""
}

$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:Path = "$jdk\bin;$sdk\platform-tools;$sdk\cmdline-tools\latest\bin;$env:Path"

# expo-constants warns and falls back to a partial config when NODE_ENV is unset.
if ($Variant -eq 'release') { $env:NODE_ENV = 'production' }

Write-Host "JDK  : $jdk" -ForegroundColor DarkGray
Write-Host "SDK  : $sdk" -ForegroundColor DarkGray
Write-Host "Build: $Variant ($Abi)" -ForegroundColor DarkGray
Write-Host ''

# --- Build ---------------------------------------------------------------------
$task = if ($Variant -eq 'debug') { 'assembleDebug' } else { 'assembleRelease' }
Push-Location $androidDir
try {
  & .\gradlew.bat $task "-PreactNativeArchitectures=$Abi"
  if ($LASTEXITCODE -ne 0) { throw "gradle $task failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

# --- Locate the APK ------------------------------------------------------------
$apk = Join-Path $androidDir "app\build\outputs\apk\$Variant\app-$Variant.apk"
if (-not (Test-Path $apk)) {
  $apk = (Get-ChildItem (Join-Path $androidDir 'app\build\outputs\apk') -Recurse -Filter '*.apk' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
}
if (-not $apk) { throw 'Build reported success but no APK was found.' }

$sizeMb = [math]::Round((Get-Item $apk).Length / 1MB, 2)
Write-Host ''
Write-Host "APK: $apk ($sizeMb MB)" -ForegroundColor Green

# --- Optional install ----------------------------------------------------------
if ($Install) {
  $adb = Join-Path $sdk 'platform-tools\adb.exe'
  $devices = & $adb devices | Select-Object -Skip 1 | Where-Object { $_ -match '\sdevice$' }
  if (-not $devices) {
    Write-Warning 'No device seen by adb. Plug in the phone over USB and enable Developer options -> USB debugging.'
  } else {
    # Lets the device reach the Metro dev server on this PC over USB, which
    # matters because this PC is on Ethernet and the phone is on Wi-Fi.
    & $adb reverse tcp:8081 tcp:8081 | Out-Null
    & $adb install -r -d $apk
    Write-Host "Installed. If this is a debug build, run 'npx expo start' to serve the JS." -ForegroundColor Green
  }
}
