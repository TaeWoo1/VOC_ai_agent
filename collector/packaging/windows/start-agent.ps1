<#
.SYNOPSIS
  Launch the SellerOps 로컬 도우미 in production (pilot) mode.

.DESCRIPTION
  Sets the production/pilot environment, loads the operator-supplied config (agent.env.json — never a
  credential), then starts the agent. The single-instance lock inside the agent means a second launch (a
  double-click, or a login item firing while one is already up) exits cleanly rather than fighting for the
  bridge port and the Chrome profile.

  Invoked hidden by run-agent.vbs (no console window). Uses the bundled Node runtime + tsx from the payload.
#>
$ErrorActionPreference = 'Stop'

$Vendor      = 'SellerOps'
$InstallRoot = Join-Path $env:LOCALAPPDATA (Join-Path $Vendor 'app')
$DataRoot    = Join-Path $env:LOCALAPPDATA (Join-Path $Vendor 'Agent')
$ConfigDir   = Join-Path $DataRoot 'config'

# Pilot runtime: production mode + the explicit pilot flag. This is what makes the agent take the
# single-instance lock, relocate profiles/pairing onto the data root, and admit import via recorded consent
# (no dev CLI flag). The Windows approval presenter (native dialog) is what lets pairing complete.
$env:NODE_ENV               = 'production'
$env:SELLEROPS_PILOT_RUNTIME = '1'
# Real installed Chrome (ADR: not the bundled Chromium) for the mainstream fingerprint NAVER expects.
if (-not $env:COLLECTOR_BROWSER_CHANNEL) { $env:COLLECTOR_BROWSER_CHANNEL = 'chrome' }

# Load operator config (URLs / origins). Each becomes an environment variable if not already set.
$EnvFile = Join-Path $ConfigDir 'agent.env.json'
if (Test-Path $EnvFile) {
  $cfg = Get-Content -Raw $EnvFile | ConvertFrom-Json
  foreach ($prop in $cfg.PSObject.Properties) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($prop.Name))) {
      Set-Item -Path ("Env:" + $prop.Name) -Value ([string]$prop.Value)
    }
  }
}

$NodeExe = Join-Path $InstallRoot 'node.exe'
$TsxCli  = Join-Path $InstallRoot 'node_modules\tsx\dist\cli.mjs'
$Entry   = Join-Path $InstallRoot 'src\cli\local-agent.ts'

if (-not (Test-Path $NodeExe)) { throw "Node 런타임을 찾을 수 없어요: $NodeExe" }

# The agent stays resident (bridge + browser). Its own SIGINT/SIGTERM handlers do the clean shutdown; the
# single-instance lock is released on exit.
& $NodeExe $TsxCli $Entry
