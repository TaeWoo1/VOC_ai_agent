<#
.SYNOPSIS
  Install the SellerOps 로컬 도우미 (local agent) for the current Windows user — no admin, no terminal.

.DESCRIPTION
  Per-user install. Copies the packaged payload into the install root (SellerOps\app), ensures the durable
  data root (SellerOps\Agent) that survives updates, records the one-time guided-import consent, and creates a
  Startup-folder shortcut so the agent auto-starts at each login. Nothing here requires Administrator.

  Path layout (mirrors collector/src/runtime/packaging-plan.ts and runtime-paths.ts):
    install root : %LOCALAPPDATA%\SellerOps\app      (CODE — replaced wholesale on update)
    data root    : %LOCALAPPDATA%\SellerOps\Agent    (PROFILES / PAIRING / SETTINGS — never touched by update)

  This script is authored to match the tested plan; validate it on the target Windows device (that device
  check is the final, human step).

.PARAMETER PayloadDir
  Folder holding the packaged agent (node.exe + the collector app + node_modules incl. tsx & Playwright).
  Defaults to '.\payload' next to this script.

.PARAMETER NoConsent
  Skip the guided-import consent prompt (import stays disabled until consent is recorded later).
#>
[CmdletBinding()]
param(
  [string]$PayloadDir = (Join-Path $PSScriptRoot 'payload'),
  [switch]$NoConsent
)
$ErrorActionPreference = 'Stop'

$Vendor      = 'SellerOps'
$InstallRoot = Join-Path $env:LOCALAPPDATA (Join-Path $Vendor 'app')
$DataRoot    = Join-Path $env:LOCALAPPDATA (Join-Path $Vendor 'Agent')
$ConfigDir   = Join-Path $DataRoot 'config'
$StartupLnk  = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\SellerOps 로컬 도우미.lnk'

Write-Host 'SellerOps 로컬 도우미 설치를 시작합니다…'

if (-not (Test-Path $PayloadDir)) {
  throw "패키지 폴더를 찾을 수 없어요: $PayloadDir"
}

# 1) Data root FIRST (so config/consent can be written), then the install root.
New-Item -ItemType Directory -Force -Path $DataRoot, $ConfigDir,
  (Join-Path $DataRoot 'profiles'), (Join-Path $DataRoot 'logs'),
  (Join-Path $DataRoot 'run'), (Join-Path $DataRoot 'diagnostics'),
  (Join-Path $DataRoot 'downloads') | Out-Null

# 2) Install root: replace the code wholesale (data root is a SIBLING, so this never touches profiles).
if (Test-Path $InstallRoot) { Remove-Item -Recurse -Force $InstallRoot }
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
Copy-Item -Recurse -Force (Join-Path $PayloadDir '*') $InstallRoot

# 3) One-time guided-import consent (replaces the dev CLI flags). Human-attended import only — the agent still
#    never logs in / clicks export; the seller does. Fail-closed: absent this file, import stays off.
$ConsentPath = Join-Path $ConfigDir 'import-consent.json'
if (-not $NoConsent -and -not (Test-Path $ConsentPath)) {
  Write-Host ''
  Write-Host '과거 리뷰 가져오기 동의' -ForegroundColor Cyan
  Write-Host '  · 판매자가 직접 NAVER에 로그인하고, 내보내기/다운로드 버튼도 직접 누릅니다.'
  Write-Host '  · 도우미는 화면을 안내하고 결과 파일만 처리합니다 (자동 로그인·자동 클릭 없음).'
  $answer = Read-Host '과거 리뷰 가져오기를 사용하시겠어요? (y/N)'
  if ($answer -match '^(y|yes|예)$') {
    $consent = [ordered]@{
      importEnabled   = $true
      acceptedAt      = (Get-Date).ToUniversalTime().ToString('o')
      acceptedVersion = '0.0.1-poc'
    }
    ($consent | ConvertTo-Json) | Set-Content -Path $ConsentPath -Encoding UTF8
    Write-Host '동의를 기록했어요.'
  } else {
    Write-Host '지금은 사용하지 않도록 설정했어요. 나중에 설정에서 켤 수 있어요.'
  }
}

# 4) Config template (the operator fills in the URLs/origins). Never contains a credential.
$EnvExample = Join-Path $ConfigDir 'agent.env.json'
if (-not (Test-Path $EnvExample)) {
  Copy-Item -Force (Join-Path $PSScriptRoot 'agent.env.example.json') $EnvExample
  Write-Host "설정 파일을 만들었어요. 값을 채워주세요: $EnvExample" -ForegroundColor Yellow
}

# 5) Auto-start at login: a Startup-folder shortcut to the hidden launcher (per-user, no admin, no service —
#    a headed Chrome the seller logs into must run in their interactive session, which a service is not).
$Launcher = Join-Path $InstallRoot 'packaging\windows\run-agent.vbs'
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($StartupLnk)
$Shortcut.TargetPath       = 'wscript.exe'
$Shortcut.Arguments        = '"' + $Launcher + '"'
$Shortcut.WorkingDirectory = $InstallRoot
$Shortcut.Description       = 'SellerOps 로컬 도우미'
$Shortcut.Save()

Write-Host ''
Write-Host '설치가 끝났어요. 다음 로그인부터 자동으로 실행됩니다.' -ForegroundColor Green
Write-Host "지금 바로 실행하려면: wscript `"$Launcher`""
