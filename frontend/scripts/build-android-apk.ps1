$ErrorActionPreference = 'Stop'

$frontendDir = Split-Path -Parent $PSScriptRoot
$jdkRoot = Join-Path $frontendDir '.tools\jdk21'
$jdkArchive = Join-Path $frontendDir '.tools\temurin-jdk21.zip'
$androidSdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { 'C:\Android\Sdk' }

if (-not (Test-Path $androidSdk)) {
    throw "Android SDK not found at $androidSdk"
}

$jdkHome = Get-ChildItem $jdkRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName 'bin\jlink.exe') } |
    Select-Object -First 1 -ExpandProperty FullName

if (-not $jdkHome) {
    New-Item -ItemType Directory -Force -Path (Split-Path $jdkArchive -Parent) | Out-Null
    Invoke-WebRequest `
        -Uri 'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse' `
        -OutFile $jdkArchive
    Expand-Archive -LiteralPath $jdkArchive -DestinationPath $jdkRoot -Force

    $jdkHome = Get-ChildItem $jdkRoot -Directory |
        Where-Object { Test-Path (Join-Path $_.FullName 'bin\jlink.exe') } |
        Select-Object -First 1 -ExpandProperty FullName
}

if (-not $jdkHome) {
    throw 'A complete JDK 21 could not be prepared.'
}

$localProperties = "sdk.dir=$($androidSdk.Replace('\', '\\').Replace(':', '\:'))"
Set-Content -LiteralPath (Join-Path $frontendDir 'android\local.properties') -Value $localProperties -Encoding ASCII

$env:JAVA_HOME = $jdkHome
$env:ANDROID_HOME = $androidSdk
$env:PATH = "$jdkHome\bin;$androidSdk\platform-tools;$env:PATH"

Push-Location $frontendDir
try {
    npm run android:sync
    Push-Location (Join-Path $frontendDir 'android')
    try {
        .\gradlew.bat assembleDebug
    }
    finally {
        Pop-Location
    }

    $distDir = Join-Path $frontendDir 'dist'
    New-Item -ItemType Directory -Force -Path $distDir | Out-Null
    Copy-Item `
        -LiteralPath (Join-Path $frontendDir 'android\app\build\outputs\apk\debug\app-debug.apk') `
        -Destination (Join-Path $distDir 'vox-bridge-nexus-debug.apk') `
        -Force
}
finally {
    Pop-Location
}
