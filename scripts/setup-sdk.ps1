$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $taskRoot
New-Item -ItemType Directory -Force .toolchain | Out-Null
$taskPackages = @(
  @{ File='platform.zip'; URL='https://dl.google.com/android/repository/platform-35_r02.zip'; SHA1='0bb560a90a7a2cbd0dd8348224d518b638fe7949'; Destination='.toolchain/platform' },
  @{ File='build-tools.zip'; URL='https://dl.google.com/android/repository/build-tools_r35_windows.zip'; SHA1='af059bb67cf7786f45ee0db85e2d24985df1b4b6'; Destination='.toolchain/build-tools' },
  @{ File='platform-tools.zip'; URL='https://dl.google.com/android/repository/platform-tools_r37.0.1-win.zip'; SHA1='e03e78b1d80b396f1c3358e31251cb31740e1110'; Destination='.toolchain' }
)
foreach ($taskPackage in $taskPackages) {
  $taskArchive = Join-Path '.toolchain' $taskPackage.File
  if (-not (Test-Path -LiteralPath $taskArchive)) { Invoke-WebRequest -Uri $taskPackage.URL -Headers @{'Accept-Encoding'='identity'} -OutFile $taskArchive }
  if ((Get-FileHash -LiteralPath $taskArchive -Algorithm SHA1).Hash.ToLower() -ne $taskPackage.SHA1) { throw "SDK checksum mismatch: $taskArchive" }
  Expand-Archive -LiteralPath $taskArchive -DestinationPath $taskPackage.Destination -Force
}
Write-Output 'Official Android SDK archives extracted and verified.'
