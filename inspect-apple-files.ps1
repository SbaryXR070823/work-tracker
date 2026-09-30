# inspect-apple-files.ps1
#
# Looks at the Apple signing files you were sent and reports what is in them,
# without printing any secret and without uploading anything. The files are
# never read out loud; only structural facts are shown.
#
#   .\inspect-apple-files.ps1
#   .\inspect-apple-files.ps1 -p12 'C:\path\to\dist.p12' -p8 'C:\path\to\AuthKey_X.p8' -profile 'C:\path\to\x.mobileprovision'
#
# For each file it answers: is this the right kind of file, and does it contain
# the part the build actually needs?

[CmdletBinding()]
param(
  [string]$P12,
  [string]$P8,
  [string]$Profile
)

$ErrorActionPreference = 'Continue'

function Get-Keytool {
  $c = @()
  if ($env:JAVA_HOME) { $c += (Join-Path $env:JAVA_HOME 'bin\keytool.exe') }
  $c += Get-ChildItem 'C:\Program Files\Microsoft' -Directory -Filter 'jdk-*' -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName 'bin\keytool.exe' }
  foreach ($x in $c) { if ($x -and (Test-Path $x)) { return $x } }
  return $null
}

# Scans raw bytes for a DER-encoded object header. Every ASN.1 structure starts
# with 0x30, so this is only a weak "is this DER at all" signal.
function Test-Der([byte[]]$b) { return ($b.Length -gt 2 -and $b[0] -eq 0x30) }

# True when the bytes contain a PKCS#8 privateKeyInfo OID, which means the file
# carries an unencrypted private key blob somewhere inside it.
function Test-HasPkcs8Oid([byte[]]$b) {
  $oid = [byte[]](0x06,0x09,0x2A,0x86,0x48,0x86,0xF7,0x0D,0x01,0x07,0x01)
  for ($i = 0; $i -lt $b.Length - $oid.Length; $i++) {
    if ($b[$i] -ne $oid[0] -or $b[$i+1] -ne $oid[1]) { continue }
    $ok = $true
    for ($j = 2; $j -lt $oid.Length; $j++) { if ($b[$i+$j] -ne $oid[$j]) { $ok = $false; break } }
    if ($ok) { return $true }
  }
  return $false
}

# A certificate-only file keeps its subject readable as plain text, because DER
# stores the distinguished name as visible strings. A p12 wraps everything in
# encrypted or ASN.1-wrapped blobs, so the subject is not plainly readable.
function Test-SubjectReadable([byte[]]$b) {
  $s = [Text.Encoding]::ASCII.GetString($b)
  return ($s -match 'Apple Distribution' -or $s -match 'iPhone Distribution' -or
          $s -match 'Apple Development' -or $s -match 'CN=')
}

Write-Host ''
Write-Host 'Apple signing file check' -ForegroundColor Cyan
Write-Host 'No secret is printed and nothing is uploaded.' -ForegroundColor DarkGray
Write-Host ''

if (-not $P12) { $P12 = (Read-Host 'path to the .p12 (Enter to skip)').Trim().Trim('"') }
if (-not $P8)  { $P8  = (Read-Host 'path to the .p8 (Enter to skip)').Trim().Trim('"') }
if (-not $Profile) { $Profile = (Read-Host 'path to the .mobileprovision (Enter to skip)').Trim().Trim('"') }

$ok = $true

# ------------------------------------------------------------------ the p12 --
if ($P12) {
  Write-Host 'CERTIFICATE (.p12)' -ForegroundColor Cyan
  if (-not (Test-Path $P12)) {
    Write-Host "  not found: $P12`n" -ForegroundColor Red; $ok = $false
  } else {
    $bytes = [IO.File]::ReadAllBytes((Resolve-Path $P12).Path)
    $name  = Split-Path $P12 -Leaf
    "  file    {0}  {1} bytes" -f $name, $bytes.Length | Write-Host
    "  format  {0}" -f $(if (Test-Der $bytes) { 'DER container, looks like a real pkcs12' } else { 'NOT DER, this is probably a text file such as PEM' }) | Write-Host

    $subjectReadable = Test-SubjectReadable $bytes
    $hasKey          = Test-HasPkcs8Oid $bytes

    "  subject readable as plain text : {0}" -f $subjectReadable | Write-Host
    "  contains a PKCS#8 key blob     : {0}" -f $hasKey | Write-Host

    if ($subjectReadable -and -not $hasKey) {
      Write-Host ''
      Write-Host '  This is a CERTIFICATE ONLY, not a pkcs12. It has no private' -ForegroundColor Red
      Write-Host '  key, so no build can be signed with it. Your friend exported' -ForegroundColor Red
      Write-Host '  the wrong thing, or it was renamed from a .cer.' -ForegroundColor Red
      $ok = $false
    } elseif (-not $hasKey) {
      Write-Host ''
      Write-Host '  No private key blob found. Either the key is there but the file' -ForegroundColor Yellow
      Write-Host '  is not a pkcs12, or the key is genuinely missing.' -ForegroundColor Yellow
    } else {
      Write-Host '  looks like a real pkcs12 containing a private key' -ForegroundColor Green
    }

    # If the subject is not readable, the name must come from the portal.
    if ($subjectReadable) {
      $s = [Text.Encoding]::ASCII.GetString($bytes)
      $m = [regex]::Match($s, 'CN=([^,]+)')
      if ($m.Success) {
        Write-Host ''
        Write-Host '  APPLE_DISTRIBUTION_CERT_NAME' -ForegroundColor Yellow
        Write-Host "    $($m.Groups[1].Value.Trim())" -ForegroundColor White
        $t = [regex]::Match($m.Groups[1].Value, '\(([A-Z0-9]{10})\)')
        if ($t.Success) {
          Write-Host '  APPLE_TEAM_ID' -ForegroundColor Yellow
          Write-Host "    $($t.Groups[1].Value)" -ForegroundColor White
        }
      }
    } else {
      Write-Host ''
      Write-Host '  The name is encrypted inside the pkcs12, so read these two from' -ForegroundColor DarkGray
      Write-Host '  the portal instead: Keys > Certificates for the cert name,' -ForegroundColor DarkGray
      Write-Host '  Keys > Membership for the Team ID.' -ForegroundColor DarkGray
    }

    # Try the real password if there is one.
    $kt = Get-Keytool
    if ($kt) {
      Write-Host ''
      $pw = Read-Host '  password for this .p12 (press Enter if it has none)' -AsSecureString
      $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw)
      $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
      if ($plain) {
        $listing = (& $kt -list -v -keystore $P12 -storetype PKCS12 -storepass $plain 2>&1) -join "`n"
        if ($listing -match 'Owner:\s*(.+)') {
          $owner = $Matches[1].Trim()
          Write-Host "  password ACCEPTED. Subject:" -ForegroundColor Green
          Write-Host "    $owner" -ForegroundColor White
          $cn = ([regex]::Match($owner, 'CN=([^,]+)')).Groups[1].Value.Trim()
          $tm = [regex]::Match($cn, '\(([A-Z0-9]{10})\)').Groups[1].Value
          Write-Host '  APPLE_DISTRIBUTION_CERT_NAME' -ForegroundColor Yellow
          Write-Host "    $cn" -ForegroundColor White
          if ($tm) {
            Write-Host '  APPLE_TEAM_ID' -ForegroundColor Yellow
            Write-Host "    $tm" -ForegroundColor White
          }
        } else {
          Write-Host '  that password did NOT open the file.' -ForegroundColor Red
          $ok = $false
        }
      } else {
        Write-Host '  no password given, so the subject stays encrypted.' -ForegroundColor DarkGray
        Write-Host '  An empty password cannot be tested on Windows: keytool hides the' -ForegroundColor DarkGray
        Write-Host '  certificate when it cannot verify the file.' -ForegroundColor DarkGray
        Write-Host '  The build may still work, because macOS handles this case.' -ForegroundColor DarkGray
      }
    }
  }
  Write-Host ''
}

# ------------------------------------------------------------------- the p8 --
if ($P8) {
  Write-Host 'API KEY (.p8)' -ForegroundColor Cyan
  if (-not (Test-Path $P8)) {
    Write-Host "  not found: $P8`n" -ForegroundColor Red; $ok = $false
  } else {
    $text = [IO.File]::ReadAllText((Resolve-Path $P8).Path)
    $id = [IO.Path]::GetFileNameWithoutExtension($P8) -replace '^AuthKey_', ''
    "  file    $(Split-Path $P8 -Leaf)" | Write-Host
    "  APP_STORE_CONNECT_KEY_ID : {0}" -f $id | Write-Host
    if ($id -match '^[A-Z0-9]{10}$') { Write-Host '    format is right' }
    else { Write-Host '    this does not look like a key id, check the filename' -ForegroundColor Red; $ok = $false }

    if ($text -match 'BEGIN PRIVATE KEY') {
      Write-Host '  contains a PEM private key' -ForegroundColor Green
      "  key length                : $($text.Length) chars" | Write-Host
    } else {
      Write-Host '  NO PEM private key found in this file' -ForegroundColor Red
      $ok = $false
    }
  }
  Write-Host ''
}

# --------------------------------------------------------------- the profile --
if ($Profile) {
  Write-Host 'PROFILE (.mobileprovision)' -ForegroundColor Cyan
  if (-not (Test-Path $Profile)) {
    Write-Host "  not found: $Profile`n" -ForegroundColor Red; $ok = $false
  } else {
    $bytes = [IO.File]::ReadAllBytes((Resolve-Path $Profile).Path)
    $s = [Text.Encoding]::ASCII.GetString($bytes)
    "  file    $(Split-Path $Profile -Leaf)  $($bytes.Length) bytes" | Write-Host
    if (-not (Test-Der $bytes)) {
      Write-Host '  NOT DER, this is not a provisioning profile' -ForegroundColor Red
      $ok = $false
    } else {
      $name = [regex]::Match($s, '<key>Name</key>\s*<string>([^<]+)</string>').Groups[1].Value
      $uuid = [regex]::Match($s, '<key>UUID</key>\s*<string>([^<]+)</string>').Groups[1].Value
      $appId = [regex]::Match($s, '<key>application-identifier</key>\s*<string>([^<]+)</string>').Groups[1].Value
      $team = [regex]::Match($s, '<key>TeamIdentifier</key>\s*<array>\s*<string>([^<]+)</string>').Groups[1].Value
      $expires = [regex]::Match($s, '<key>ExpirationDate</key>\s*<date>([^<]+)</date>').Groups[1].Value

      if ($name)  { Write-Host "  APPLE_PROVISIONING_PROFILE_NAME : $name" -ForegroundColor Yellow }
      else { Write-Host '  could not read the profile Name' -ForegroundColor Red; $ok = $false }
      if ($uuid)  { "  UUID                             : $uuid" | Write-Host }
      if ($team)  { Write-Host "  Team ID in the profile           : $team" -ForegroundColor Yellow }
      if ($appId) { "  app id it covers                 : $appId" | Write-Host }
      if ($expires) {
        $d = [DateTime]::Parse($expires)
        "  expires                          : $($d.ToString('dd MMM yyyy'))" | Write-Host
        if ($d -lt (Get-Date)) {
          Write-Host '  EXPIRED, ask for a new one' -ForegroundColor Red
          $ok = $false
        } elseif ($d -lt (Get-Date).AddDays(14)) {
          Write-Host '  expires in under two weeks' -ForegroundColor Yellow
        }
      }
      if ($appId -and $appId -notmatch 'com\.worktracker\.app') {
        Write-Host '  this profile is for a DIFFERENT bundle id' -ForegroundColor Red
        $ok = $false
      }
    }
  }
  Write-Host ''
}

Write-Host 'RESULT' -ForegroundColor Cyan
if ($ok) { Write-Host '  everything checks out' -ForegroundColor Green }
else { Write-Host '  something above needs fixing before a build can work' -ForegroundColor Red }
Write-Host ''
