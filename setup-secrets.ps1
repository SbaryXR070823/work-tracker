# setup-secrets.ps1
#
# Sets every GitHub Actions secret the two workflows need, in one pass.
#
# Nothing you type here is sent to me, to a log file, or to any place other than
# the GitHub repository's encrypted secret store. Run it in your own terminal.
#
#   .\setup-secrets.ps1            # both platforms
#   .\setup-secrets.ps1 -Platform android
#   .\setup-secrets.ps1 -Platform ios
#   .\setup-secrets.ps1 -DryRun    # show what it would do, change nothing
#
# The script derives the Team ID and the certificate name from your .p12, and the
# Key ID from your .p8 filename, so you only have to supply the things only a
# human knows.

[CmdletBinding()]
param(
  [ValidateSet('android', 'ios', 'both')]
  [string]$Platform = 'both',

  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- helpers ----

function Write-Step {
  param([string]$Message, [string]$Status = '')
  if ($Status) { Write-Host "  $Message  $Status" -ForegroundColor DarkGray }
  else { Write-Host "  $Message" }
}

function Write-Fail {
  param([string]$Message)
  Write-Host "  FAILED: $Message" -ForegroundColor Red
  throw $Message
}

# Reads a password without echoing it. gh needs the plain value, so it is
# converted back in memory and the SecureString is dropped.
function Read-Secret {
  param([string]$Prompt)
  $secure = Read-Host $Prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Get-Keytool {
  # Use JAVA_HOME if it is set and valid, otherwise the JDK installed on this PC.
  $candidates = @()
  if ($env:JAVA_HOME) { $candidates += (Join-Path $env:JAVA_HOME 'bin\keytool.exe') }
  $candidates += Get-ChildItem 'C:\Program Files\Microsoft' -Directory -Filter 'jdk-*' -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName 'bin\keytool.exe' }
  $candidates += Join-Path $env:LOCALAPPDATA 'Android\Sdk\cmdline-tools\latest\bin\keytool.exe'
  foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
  return $null
}

function Set-GhSecret {
  param([string]$Name, [string]$Value, [string]$FromFile)
  if ($DryRun) {
    if ($FromFile) { Write-Step "$Name  <- $(Split-Path $FromFile -Leaf)" }
    else { Write-Step "$Name  <- (typed value, $($Value.Length) chars)" }
    return
  }
  if ($FromFile) {
    # --file sends the file's bytes, which is the only safe way to pass a
    # multi-line private key through PowerShell.
    gh secret set $Name --file $FromFile --repo $Repo 2>&1 | Out-Null
  } elseif ($Value) {
    # --body is required here. Without it gh reads from stdin and blocks.
    gh secret set $Name --body $Value --repo $Repo 2>&1 | Out-Null
  } else {
    # PowerShell drops an empty string argument, so '--body $Value' arrives at
    # gh as two arguments and it fails with 'accepts at most 1 arg(s)'. An
    # empty secret is legitimate here, because a pkcs12 can be exported without
    # a password, so the value is piped instead.
    '' | gh secret set $Name --repo $Repo 2>&1 | Out-Null
  }
  if ($LASTEXITCODE -ne 0) { Write-Fail "gh secret set $Name returned $LASTEXITCODE" }
  Write-Step $Name
}

# ------------------------------------------------------------------ setup ----

Set-Location $PSScriptRoot

$Repo = 'SbaryXR070823/work-tracker'
$store = Join-Path $PSScriptRoot 'android\keystore.properties'

Write-Host ''
Write-Host 'Setup secrets' -ForegroundColor Cyan
if ($DryRun) { Write-Host 'DRY RUN: nothing will be changed' -ForegroundColor Yellow }
Write-Host ''

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw 'git is not on PATH in this shell. Open a new PowerShell window and try again.'
}
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw 'gh is not on PATH in this shell. Open a new PowerShell window and try again.'
}

Push-Location $PSScriptRoot
try {
  $root = (& git rev-parse --show-toplevel 2>$null)
} finally {
  Pop-Location
}
if (-not $root) { throw "Run this from inside the repository at D:\work-tracker" }

Set-Location $root

$account = (gh api user --jq .login 2>$null)
if (-not $account) { throw 'gh is not authenticated. Run: gh auth login' }
Write-Step "repository  $Repo"
Write-Step "signed in as $account"
Write-Host ''

# ----------------------------------------------------------------- android ---

if ($Platform -in 'android', 'both') {
  Write-Host 'ANDROID' -ForegroundColor Cyan

  $ks = Join-Path $root 'android\release.keystore'
  if (-not (Test-Path $ks)) { Write-Fail "release keystore not found at $ks" }
  Write-Step 'release.keystore found'

  $alias = $null; $password = $null
  if (Test-Path $store) {
    $props = Get-Content $store -Raw
    $alias = [regex]::Match($props, 'releaseKeyAlias=(\S+)').Groups[1].Value
    $password = [regex]::Match($props, 'releaseStorePassword=(\S+)').Groups[1].Value
    Write-Step 'credentials read from android\keystore.properties' 'no typing needed'
  } else {
    Write-Host '  android\keystore.properties not found, so the values will be asked for.' -ForegroundColor Yellow
    $alias = Read-Host '  Keystore alias'
    $password = Read-Secret '  Keystore password'
  }
  if (-not $alias -or -not $password) { Write-Fail 'alias or password is empty' }

  $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($ks))

  Set-GhSecret 'ANDROID_KEYSTORE_BASE64'   $b64
  Set-GhSecret 'ANDROID_KEYSTORE_PASSWORD' $password
  Set-GhSecret 'ANDROID_KEY_ALIAS'         $alias
  Set-GhSecret 'ANDROID_KEY_PASSWORD'      $password
  Write-Host ''
}

# --------------------------------------------------------------------- ios ---

if ($Platform -in 'ios', 'both') {
  Write-Host 'iOS' -ForegroundColor Cyan

  # --- the .p12 ------------------------------------------------------------
  Write-Host ''
  Write-Host '  The .p12 is your distribution certificate. Point at the file,' -ForegroundColor DarkGray
  Write-Host '  or press Enter and paste the path.' -ForegroundColor DarkGray
  $p12 = (Read-Host '  path to the .p12').Trim().Trim('"')
  if (-not $p12) { Write-Fail 'no .p12 given' }
  if (-not (Test-Path $p12)) { Write-Fail "not found: $p12" }
  $p12 = (Resolve-Path $p12).Path
  Write-Step "$(Split-Path $p12 -Leaf)  $([math]::Round((Get-Item $p12).Length/1KB,1)) KB"

  $pw12 = Read-Secret '  password for that .p12 (press Enter if it has none)'
  Write-Host ''

  # --- read the certificate to get the team id and the cert name ------------
  # A pkcs12 with an empty password cannot be read on Windows at all: keytool
  # refuses to display a certificate it cannot integrity-check, and openssl
  # reports "Mac verify error". Neither can rewrite it with a real password.
  # In that case the two names are asked for instead. The build itself runs on
  # macOS, where security import can still handle an empty password.
  $owner = $null
  if ($pw12) {
    $keytool = Get-Keytool
    if ($keytool) {
      $listing = (& $keytool -list -v -keystore $p12 -storetype PKCS12 -storepass $pw12 2>&1) -join "`n"
      if ($listing -notmatch 'Owner:') {
        Write-Fail 'that password did not open the .p12'
      }
      $owner = ([regex]::Match($listing, '(?m)^\s*Owner:\s*(.+)$')).Groups[1].Value.Trim()
      Write-Step 'certificate subject'
      Write-Host "    $owner" -ForegroundColor DarkGray
    }
  } else {
    Write-Host '  No password given. A pkcs12 with an empty password cannot be read on' -ForegroundColor Yellow
    Write-Host '  Windows, so the certificate name and team id will be asked for.' -ForegroundColor Yellow
    Write-Host '  This is fine: the build runs on macOS, where security import can' -ForegroundColor DarkGray
    Write-Host '  still open it.' -ForegroundColor DarkGray
  }

  if ($owner) {
    $cn = ([regex]::Match($owner, 'CN=([^,]+)')).Groups[1].Value.Trim()
    $team = ([regex]::Match($cn, '\(([A-Z0-9]{10})\)')).Groups[1].Value
    if (-not $team) {
      Write-Host '    no team id in that subject, so it will be asked for.' -ForegroundColor Yellow
      $team = (Read-Host '  Team ID (Keys > Membership)').Trim()
    }
    $certName = $cn
  } else {
    $certName = (Read-Host '  certificate name, exactly as the portal shows it (Keys > Certificates)').Trim()
    $team    = (Read-Host '  Team ID (Keys > Membership)').Trim()
    if (-not $certName) { Write-Fail 'certificate name is empty' }
  }

  if ($team -notmatch '^[A-Z0-9]{10}$') { Write-Fail "team id looks wrong: $team" }
  Write-Step "team id           $team"

  if ($certName -notmatch 'Apple Distribution|iPhone Distribution') {
    Write-Host '    that does not look like an Apple Distribution certificate.' -ForegroundColor Yellow
    Write-Host '    the archive step will fail with a signing error if it is not.' -ForegroundColor Yellow
  }
  Write-Step "cert name         $certName"

  # --- the .p8 -------------------------------------------------------------
  Write-Host ''
  Write-Host '  The .p8 is the App Store Connect API key, named AuthKey_XXXX.p8.' -ForegroundColor DarkGray
  $p8 = (Read-Host '  path to the .p8').Trim().Trim('"')
  if (-not $p8) { Write-Fail 'no .p8 given' }
  if (-not (Test-Path $p8)) { Write-Fail "not found: $p8" }
  $p8 = (Resolve-Path $p8).Path
  $keyId = [IO.Path]::GetFileNameWithoutExtension($p8) -replace '^AuthKey_', ''
  if ($keyId -notmatch '^[A-Z0-9]{10}$') {
    Write-Host "    could not read a key id from that filename (got '$keyId')." -ForegroundColor Yellow
    $keyId = (Read-Host '  Key ID (from the Team Keys page)').Trim()
  }
  if ($keyId -notmatch '^[A-Z0-9]{10}$') { Write-Fail "key id looks wrong: $keyId" }
  Write-Step "key id            $keyId"
  $p8text = [IO.File]::ReadAllText($p8)
  if ($p8text -notmatch 'BEGIN PRIVATE KEY') {
    Write-Host '    that file does not look like a .p8 private key.' -ForegroundColor Yellow
  }

  # --- the two values only a human can supply ------------------------------
  Write-Host ''
  $issuer = (Read-Host '  Issuer ID (the long uuid on the Team Keys page)').Trim()
  if ($issuer -notmatch '^[a-f0-9-]{36}$') { Write-Host "    that does not look like an issuer id: $issuer" -ForegroundColor Yellow }
  $profile = (Read-Host '  provisioning profile name (exactly as on the Developer portal)').Trim()
  if (-not $profile) { Write-Fail 'profile name is empty' }
  Write-Step "profile name      $profile"
  Write-Step "issuer id         $issuer"

  # --- the .mobileprovision -------------------------------------------------
  # xcodebuild cannot download a profile without App Store Connect API
  # credentials, so the profile is installed from a secret instead. Without it
  # the archive step fails with "No profiles for 'com.worktracker.app' were
  # found", which is the single most likely first-run failure.
  Write-Host ''
  Write-Host '  The .mobileprovision is the profile your friend downloaded.' -ForegroundColor DarkGray
  $pp = (Read-Host '  path to the .mobileprovision').Trim().Trim('"')
  if (-not $pp) { Write-Fail 'no .mobileprovision given' }
  if (-not (Test-Path $pp)) { Write-Fail "not found: $pp" }
  $pp = (Resolve-Path $pp).Path
  Write-Step "$(Split-Path $pp -Leaf)  $([math]::Round((Get-Item $pp).Length/1KB,1)) KB"

  # --- set them ------------------------------------------------------------
  Write-Host ''
  $p12b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($p12))
  $ppb64  = [Convert]::ToBase64String([IO.File]::ReadAllBytes($pp))
  Set-GhSecret 'APPLE_TEAM_ID'                      $team
  Set-GhSecret 'APPLE_DISTRIBUTION_CERT_PASSWORD'   $pw12
  Set-GhSecret 'APPLE_DISTRIBUTION_CERT_NAME'       $certName
  Set-GhSecret 'APPLE_PROVISIONING_PROFILE_NAME'    $profile
  Set-GhSecret 'APP_STORE_CONNECT_KEY_ID'           $keyId
  Set-GhSecret 'APP_STORE_CONNECT_ISSUER_ID'        $issuer
  Set-GhSecret 'APPLE_DISTRIBUTION_CERT_P12_BASE64' $p12b64
  Set-GhSecret 'APPLE_PROVISIONING_PROFILE_BASE64' $ppb64

  Set-GhSecret 'APP_STORE_CONNECT_KEY_P8' '' $p8
  Write-Host ''
}

# ------------------------------------------------------------------ verify ---

Write-Host 'VERIFY' -ForegroundColor Cyan
if ($DryRun) {
  Write-Step 'skipped, dry run'
} else {
  $rows = gh secret list --repo $Repo 2>&1 | Where-Object { $_ -match '\S' }
  $names = $rows | ForEach-Object { ($_ -split '\s+')[0] } | Sort-Object
  Write-Step "$($names.Count) secrets on $Repo"
  $names | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

  $expect = @('ANDROID_KEY_ALIAS','ANDROID_KEY_PASSWORD','ANDROID_KEYSTORE_BASE64','ANDROID_KEYSTORE_PASSWORD')
  if ($Platform -in 'ios','both') {
    $expect += @('APPLE_DISTRIBUTION_CERT_NAME','APPLE_DISTRIBUTION_CERT_P12_BASE64','APPLE_DISTRIBUTION_CERT_PASSWORD',
                 'APPLE_PROVISIONING_PROFILE_BASE64','APPLE_PROVISIONING_PROFILE_NAME','APPLE_TEAM_ID',
                 'APP_STORE_CONNECT_ISSUER_ID','APP_STORE_CONNECT_KEY_ID','APP_STORE_CONNECT_KEY_P8')
  }
  $missing = $expect | Where-Object { $_ -notin $names }
  if ($missing) {
    Write-Host "  missing: $($missing -join ', ')" -ForegroundColor Red
  } else {
    Write-Step 'all expected secrets are present'
  }
}

Write-Host ''
Write-Host 'Next' -ForegroundColor Cyan
if ($Platform -in 'ios', 'both') {
  # The first run is expected to fail at the archive step, so start without the
  # upload. That keeps a half-signed build out of TestFlight and gives a
  # readable log of the archive itself.
  Write-Host '  gh workflow run ios.yml     -f versionName=1.0.1 -f upload=false'
  Write-Host '  gh run watch'
  Write-Host '  gh run view --log-failed'
  Write-Host ''
  Write-Host 'Once the archive and export are green:' -ForegroundColor DarkGray
  Write-Host '  gh workflow run ios.yml -f versionName=1.0.1 -f upload=true' -ForegroundColor DarkGray
}
if ($Platform -in 'android', 'both') {
  Write-Host '  gh workflow run android.yml -f versionName=1.0.1'
}
Write-Host ''
Write-Host 'The first iOS run is expected to fail. The archive step has never' -ForegroundColor Yellow
Write-Host 'been executed anywhere, so treat it as a diagnostic, not a test.' -ForegroundColor Yellow
Write-Host ''
