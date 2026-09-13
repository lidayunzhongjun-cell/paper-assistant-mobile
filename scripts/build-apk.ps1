$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $taskRoot
$taskJdk = 'D:/Program Files/Java/jdk-17.0.2'
if ($env:PAPER_JAVA_HOME) { $taskJdk = $env:PAPER_JAVA_HOME }
$taskBuildTools = Join-Path $taskRoot '.toolchain/build-tools/android-15'
$taskPlatform = Get-ChildItem -LiteralPath (Join-Path $taskRoot '.toolchain/platform') -Recurse -Filter android.jar | Select-Object -First 1
if (-not $taskPlatform) { throw 'Android platform android.jar missing. See README.' }
$taskAndroid = $taskPlatform.FullName
$taskVersion = (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version
$taskBuild = Join-Path $taskRoot 'build'
New-Item -ItemType Directory -Force "$taskBuild/generated","$taskBuild/classes","$taskBuild/dex",(Join-Path $taskRoot 'dist'),(Join-Path $taskRoot '.signing') | Out-Null
function Invoke-Checked([string]$exe, [string[]]$arguments) {
  & $exe @arguments
  if ($LASTEXITCODE -ne 0) { throw "Build tool failed: $exe ($LASTEXITCODE)" }
}
Invoke-Checked 'node' @('scripts/build-web.mjs')
& "$PSScriptRoot/download-lara-sdk.ps1"
if ($LASTEXITCODE -ne 0) { throw 'Unable to prepare Lara SDK dependencies' }
$taskLibraries = @((Join-Path $taskRoot '.toolchain/lara/lara-sdk-1.12.0.jar'),(Join-Path $taskRoot '.toolchain/lara/gson-2.11.0.jar'))
Invoke-Checked "$taskBuildTools/aapt2.exe" @('compile','--dir','android/res','-o',"$taskBuild/resources.zip")
Invoke-Checked "$taskBuildTools/aapt2.exe" @('link','-o',"$taskBuild/unsigned.apk",'--manifest','android/AndroidManifest.xml','-I',$taskAndroid,'--java',"$taskBuild/generated",'--min-sdk-version','26','--target-sdk-version','35',"$taskBuild/resources.zip")
$taskJava = @(Get-ChildItem android/src -Recurse -Filter '*.java' | ForEach-Object { $_.FullName }) + @(Get-ChildItem "$taskBuild/generated" -Recurse -Filter '*.java' | ForEach-Object { $_.FullName })
$taskClassPath = (@($taskAndroid) + $taskLibraries) -join [IO.Path]::PathSeparator
$taskArgs = @('-encoding','UTF-8','--release','8','-classpath',$taskClassPath,'-d',"$taskBuild/classes") + $taskJava
Invoke-Checked "$taskJdk/bin/javac.exe" $taskArgs
$taskClasses = @(Get-ChildItem "$taskBuild/classes" -Recurse -Filter '*.class' | ForEach-Object { $_.FullName })
Invoke-Checked "$taskJdk/bin/java.exe" (@('-cp',"$taskBuildTools/lib/d8.jar",'com.android.tools.r8.D8','--release','--min-api','26','--lib',$taskAndroid,'--output',"$taskBuild/dex") + $taskClasses + $taskLibraries)
Invoke-Checked 'node' @('scripts/apk-content.mjs')
Invoke-Checked "$taskBuildTools/zipalign.exe" @('-f','-p','4',"$taskBuild/unsigned.apk","$taskBuild/aligned.apk")
Invoke-Checked 'node' @('scripts/check-apk.mjs',"$taskBuild/aligned.apk")
$taskKey = Join-Path $taskRoot '.signing/paper-assistant-release.jks'
$taskPass = Join-Path $taskRoot '.signing/password.txt'
if (-not (Test-Path -LiteralPath $taskKey)) {
  $taskRandom = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($taskRandom)
  [IO.File]::WriteAllText($taskPass, [Convert]::ToBase64String($taskRandom))
  Invoke-Checked "$taskJdk/bin/keytool.exe" @('-genkeypair','-keystore',$taskKey,'-storetype','JKS','-storepass:file',$taskPass,'-keypass:file',$taskPass,'-alias','paperassistant','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Paper Assistant, OU=Independent Development, O=Paper Assistant, C=CN')
}
$taskOutput = Join-Path $taskRoot "dist/paper-assistant-$taskVersion-android.apk"
Invoke-Checked "$taskJdk/bin/java.exe" @('-jar',"$taskBuildTools/lib/apksigner.jar",'sign','--ks',$taskKey,'--ks-key-alias','paperassistant','--ks-pass',"file:$taskPass",'--out',$taskOutput,"$taskBuild/aligned.apk")
Invoke-Checked "$taskJdk/bin/java.exe" @('-jar',"$taskBuildTools/lib/apksigner.jar",'verify','--verbose','--print-certs',$taskOutput)
Invoke-Checked "$taskBuildTools/zipalign.exe" @('-c','4',$taskOutput)
Invoke-Checked 'node' @('scripts/check-apk.mjs',$taskOutput)
$taskHash = (Get-FileHash -LiteralPath $taskOutput -Algorithm SHA256).Hash.ToLower()
[IO.File]::WriteAllText((Join-Path $taskRoot 'dist/SHA256.txt'), "$taskHash  paper-assistant-$taskVersion-android.apk`n")
Write-Output "Signed APK: $taskOutput"
