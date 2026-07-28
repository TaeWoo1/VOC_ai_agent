<#
.SYNOPSIS
  Update the SellerOps 로컬 도우미 in place, preserving the seller's login and settings.

.DESCRIPTION
  Replaces the install root (code) with a new payload. The data root (profiles, pairing, settings) is a
  SIBLING directory and is never touched, so the NAVER login and the SellerOps pairing survive the update —
  the seller does not re-log-in or re-pair.

  SAFETY INVARIANT (mirrors planUpdate in collector/src/runtime/packaging-plan.ts): the data root must NOT be
  nested under the install root. This script asserts it and ABORTS if it ever fails, rather than risk wiping
  the login.
#>
[CmdletBinding()]
param(
  [string]$PayloadDir = (Join-Path $PSScriptRoot 'payload')
)
$ErrorActionPreference = 'Stop'

$Vendor      = 'SellerOps'
$InstallRoot = Join-Path $env:LOCALAPPDATA (Join-Path $Vendor 'app')
$DataRoot    = Join-Path $env:LOCALAPPDATA (Join-Path $Vendor 'Agent')

if (-not (Test-Path $PayloadDir)) { throw "새 패키지 폴더를 찾을 수 없어요: $PayloadDir" }

# Assert the update-safety invariant before deleting anything.
$installFull = [System.IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$dataFull    = [System.IO.Path]::GetFullPath($DataRoot).TrimEnd('\')
if ($dataFull.StartsWith($installFull + '\', [StringComparison]::OrdinalIgnoreCase) -or $dataFull -eq $installFull) {
  throw "업데이트를 중단했어요: 데이터 폴더가 설치 폴더 아래에 있어요. 로그인/설정이 지워질 수 있어 진행하지 않습니다."
}

Write-Host '기존 도우미를 종료하는 중… (실행 중이면 창을 닫아주세요)'
# We do NOT kill by name here — the agent's single-instance lock lets the new build take over a stale lock on
# next start. If a live agent is running, ask the seller to close it; we never pattern-match other processes.

Write-Host '새 버전으로 교체하는 중…'
if (Test-Path $InstallRoot) { Remove-Item -Recurse -Force $InstallRoot }
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
Copy-Item -Recurse -Force (Join-Path $PayloadDir '*') $InstallRoot

Write-Host '업데이트가 끝났어요. 로그인과 설정은 그대로 유지됩니다.' -ForegroundColor Green
Write-Host '다음 로그인에 자동으로 새 버전이 실행돼요. 지금 실행하려면 로그인 도우미를 다시 시작하세요.'
