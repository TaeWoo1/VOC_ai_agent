<#
.SYNOPSIS
  Uninstall the SellerOps 로컬 도우미. Keeps the seller's login/profiles by default.

.DESCRIPTION
  Removes the install root (code) and the Startup-folder auto-start shortcut. The data root (profiles,
  pairing, settings) is KEPT unless -RemoveData is passed — so an accidental uninstall/reinstall does not
  force a NAVER re-login. Mirrors planUninstall in collector/src/runtime/packaging-plan.ts.

.PARAMETER RemoveData
  Also delete the data root (profiles, pairing, settings). Irreversible — the seller will have to log in and
  pair again after a reinstall.
#>
[CmdletBinding()]
param(
  [switch]$RemoveData
)
$ErrorActionPreference = 'Stop'

$Vendor      = 'SellerOps'
$InstallRoot = Join-Path $env:LOCALAPPDATA (Join-Path $Vendor 'app')
$DataRoot    = Join-Path $env:LOCALAPPDATA (Join-Path $Vendor 'Agent')
$StartupLnk  = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\SellerOps 로컬 도우미.lnk'

Write-Host '실행 중이면 도우미 창을 먼저 닫아주세요.'

if (Test-Path $StartupLnk) { Remove-Item -Force $StartupLnk;  Write-Host '자동 시작을 해제했어요.' }
if (Test-Path $InstallRoot) { Remove-Item -Recurse -Force $InstallRoot; Write-Host '프로그램을 삭제했어요.' }

if ($RemoveData) {
  if (Test-Path $DataRoot) { Remove-Item -Recurse -Force $DataRoot }
  Write-Host '로그인/설정도 삭제했어요. 다시 설치하면 로그인과 연결을 새로 해야 해요.' -ForegroundColor Yellow
} else {
  Write-Host "로그인/설정은 그대로 두었어요: $DataRoot" -ForegroundColor Green
  Write-Host '완전히 지우려면: .\uninstall.ps1 -RemoveData'
}
