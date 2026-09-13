$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskDirectory = Join-Path $taskRoot '.toolchain/lara'
New-Item -ItemType Directory -Force $taskDirectory | Out-Null

function Get-VerifiedDependency([string]$name,[string]$url,[string]$sha256) {
  $target = Join-Path $taskDirectory $name
  if ((Test-Path -LiteralPath $target) -and (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLower() -eq $sha256) { return }
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
  Invoke-WebRequest -Uri $url -OutFile $target
  if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLower() -ne $sha256) {
    Remove-Item -LiteralPath $target -Force
    throw "Dependency checksum mismatch: $name"
  }
}

Get-VerifiedDependency 'lara-sdk-1.12.0.jar' 'https://repo.maven.apache.org/maven2/com/translated/lara/lara-sdk/1.12.0/lara-sdk-1.12.0.jar' '4f25765001639f4410486836566f8f368ce98c6cf2bfedd5a5a198e9843e5ec7'
Get-VerifiedDependency 'gson-2.11.0.jar' 'https://repo.maven.apache.org/maven2/com/google/code/gson/gson/2.11.0/gson-2.11.0.jar' '57928d6e5a6edeb2abd3770a8f95ba44dce45f3b23b7a9dc2b309c581552a78b'
