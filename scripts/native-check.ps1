$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')))
$taskJdk = 'D:/Program Files/Java/jdk-17.0.2'
if ($env:PAPER_JAVA_HOME) { $taskJdk = $env:PAPER_JAVA_HOME }
$taskJson = '.toolchain/json-test.jar'
if (-not (Test-Path -LiteralPath $taskJson)) {
  Invoke-WebRequest -Uri 'https://repo1.maven.org/maven2/org/json/json/20240303/json-20240303.jar' -OutFile $taskJson
}
if ((Get-FileHash -LiteralPath $taskJson -Algorithm SHA256).Hash.ToLower() -ne '3cf6cd6892e32e2b4c1c39e0f52f5248a2f5b37646fdfbb79a66b46b618414ed') { throw 'Test JSON dependency checksum mismatch' }
& "$PSScriptRoot/download-lara-sdk.ps1"
$taskLara = @('.toolchain/lara/lara-sdk-1.12.0.jar','.toolchain/lara/gson-2.11.0.jar')
$taskClassPath = (@($taskJson) + $taskLara) -join [IO.Path]::PathSeparator
$taskOut = 'build/native-check'
New-Item -ItemType Directory -Force $taskOut | Out-Null
$taskSources = @(Get-ChildItem tests/native -Recurse -Filter '*.java' | ForEach-Object { $_.FullName })
$taskSources += @('android/src/org/paperassistant/mobile/Library.java','android/src/org/paperassistant/mobile/StorageArea.java','android/src/org/paperassistant/mobile/GraphTask.java','android/src/org/paperassistant/mobile/TranslationProtocol.java','android/src/org/paperassistant/mobile/LaraSupport.java')
& "$taskJdk/bin/javac.exe" -encoding UTF-8 --release 8 -classpath $taskClassPath -d $taskOut @taskSources
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& "$taskJdk/bin/java.exe" -cp "$taskOut;$taskJson" org.paperassistant.mobile.StorageChecks $taskOut
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& "$taskJdk/bin/java.exe" -cp ((@($taskOut,$taskJson) + $taskLara) -join [IO.Path]::PathSeparator) org.paperassistant.mobile.TranslationChecks $taskOut
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node scripts/check-translation-signatures.mjs
exit $LASTEXITCODE
