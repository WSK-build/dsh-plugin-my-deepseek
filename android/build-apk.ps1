# Build the My DeepSeek Android app.
# Usage: run build-apk.cmd [-Release] [-SkipWeb]
#   (the default Windows execution policy blocks a .ps1, so the .cmd wrapper
#    launches this script with a Bypass scope for the current process only)
#   Debug   -> android/app/build/outputs/apk/debug/app-debug.apk
#   Release -> android/app/build/outputs/apk/release/app-release.apk
#   -SkipWeb  skip the web build and cap sync, compile the Android project only.
#
# A release build is signed only when all four signing variables are set:
#   MY_DEEPSEEK_KEYSTORE           path to the .jks file
#   MY_DEEPSEEK_KEYSTORE_PASSWORD  store password
#   MY_DEEPSEEK_KEY_ALIAS          key alias
#   MY_DEEPSEEK_KEY_PASSWORD       key password
# Without them the release APK stays unsigned. Signing uses APK Signature
# Scheme v2 + v3 and deliberately skips v1.
#
# Comments here stay ASCII on purpose: Windows PowerShell 5.1 decodes a .ps1
# without a BOM as ANSI, which corrupts non-ASCII comments and can swallow the
# following line.
param(
  [switch]$Release,
  [switch]$SkipWeb
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path $PSScriptRoot -Parent
$androidRoot = Join-Path $PSScriptRoot 'android'

# Artifact names carry the version, matching the CI names my-deepseek-<version>-<kind>.apk.
$version = '0.0.0'
$packageJson = Join-Path $repoRoot 'package.json'
if (Test-Path $packageJson) {
  $version = (Get-Content $packageJson -Raw | ConvertFrom-Json).version
}

if (-not $SkipWeb) {
  Push-Location $repoRoot
  try {
    & node scripts/build-mobile.mjs
    if ($LASTEXITCODE -ne 0) { throw 'web build failed' }

    # Capacitor copies from webDir, so stage the page under android/www first.
    $www = Join-Path $repoRoot 'android\www'
    if (Test-Path $www) { Remove-Item $www -Recurse -Force }
    Copy-Item (Join-Path $repoRoot 'build\mobile\www') $www -Recurse

    Push-Location (Join-Path $repoRoot 'android')
    try {
      & npx cap sync android
      if ($LASTEXITCODE -ne 0) { throw 'capacitor sync failed' }
    } finally {
      Pop-Location
    }
  } finally {
    Pop-Location
  }
}

# Gradle 8 rejects JDK 25; use the JDK 21 shipped with Android Studio.
$jbrCandidates = @(
  (Join-Path $env:USERPROFILE '.jdks\jbr-21.0.11'),
  (Join-Path $env:LOCALAPPDATA 'Programs\Android Studio\jbr'),
  (Join-Path $env:ProgramFiles 'Android\Android Studio\jbr')
)
$jbr = $jbrCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $jbr) {
  throw "no JDK 21 found; install Android Studio or set JAVA_HOME. Looked in: $($jbrCandidates -join '; ')"
}
$env:JAVA_HOME = $jbr
$env:Path = "$jbr\bin;$env:Path"

# cap sync writes the Capacitor default drawable/splash.png back, which clashes
# with the repository's drawable/splash.xml during resource merging.
$res = Join-Path $androidRoot 'app\src\main\res'
Get-ChildItem $res -Recurse -Filter 'splash.png' -ErrorAction SilentlyContinue | Remove-Item -ErrorAction SilentlyContinue

$task = if ($Release) { 'assembleRelease' } else { 'assembleDebug' }

if ($Release) {
  $missing = @(
    'MY_DEEPSEEK_KEYSTORE',
    'MY_DEEPSEEK_KEYSTORE_PASSWORD',
    'MY_DEEPSEEK_KEY_ALIAS',
    'MY_DEEPSEEK_KEY_PASSWORD'
  ) | Where-Object { -not [Environment]::GetEnvironmentVariable($_) }
  if ($missing.Count -gt 0) {
    Write-Warning "signing variables missing; the release APK will not be signed: $($missing -join ', ')"
  }
}

Push-Location $androidRoot
try {
  & .\gradlew.bat $task --console=plain
  $code = $LASTEXITCODE
  if ($code -ne 0) { exit $code }

  if ($Release) {
    $releaseDir = Join-Path $androidRoot 'app\build\outputs\apk\release'
    $unsigned = Join-Path $releaseDir 'app-release-unsigned.apk'
    $signed = Join-Path $releaseDir 'app-release.apk'

    if (-not (Test-Path $unsigned)) {
      throw "release APK not found: $unsigned"
    }

    $missingSigning = @(
      'MY_DEEPSEEK_KEYSTORE',
      'MY_DEEPSEEK_KEYSTORE_PASSWORD',
      'MY_DEEPSEEK_KEY_ALIAS',
      'MY_DEEPSEEK_KEY_PASSWORD'
    ) | Where-Object { -not [Environment]::GetEnvironmentVariable($_) }

    if ($missingSigning.Count -gt 0) {
      Write-Warning "release APK stays UNSIGNED; missing: $($missingSigning -join ', ')"
      $artifact = Join-Path (Join-Path $repoRoot 'build\apk') "my-deepseek-$version-release-unsigned.apk"
      New-Item -ItemType Directory -Path (Split-Path $artifact -Parent) -Force | Out-Null
      Copy-Item $unsigned $artifact -Force
      Write-Host "APK (unsigned): $artifact"
    } else {
      & node (Join-Path $repoRoot 'scripts\sign-apk.mjs') $unsigned $signed
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
      & node (Join-Path $repoRoot 'scripts\verify-apk-signature.mjs') $signed
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

      # Ship the signed APK under build/apk/ with the same name CI uses.
      $artifact = Join-Path (Join-Path $repoRoot 'build\apk') "my-deepseek-$version-release.apk"
      New-Item -ItemType Directory -Path (Split-Path $artifact -Parent) -Force | Out-Null
      Copy-Item $signed $artifact -Force
      if (-not (Test-Path $artifact)) {
        throw "failed to place the APK at $artifact"
      }
      Write-Host "APK: $artifact"
    }
  }
  exit 0
} finally {
  Pop-Location
}
