<#
.SYNOPSIS
    Starts, stops and inspects the local monitoring stack (Prometheus + Alertmanager).

.DESCRIPTION
    The Monitoring stage of the pipeline assumes Prometheus is on :9090 and
    Alertmanager on :9093. Both ship as standalone Windows executables, so no
    container runtime is involved; this script just runs them against the configs
    in ops/ and keeps their data directories out of the repository.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File ops\monitoring.ps1 -Action start
    powershell -ExecutionPolicy Bypass -File ops\monitoring.ps1 -Action status
    powershell -ExecutionPolicy Bypass -File ops\monitoring.ps1 -Action stop
#>

param(
    [ValidateSet('start', 'stop', 'status', 'restart')]
    [string]$Action = 'status'
)

$ErrorActionPreference = 'Stop'

$repoRoot     = Split-Path -Parent $PSScriptRoot
$opsRoot      = Join-Path $repoRoot 'ops'
$binRoot      = Join-Path $opsRoot 'bin'

$prometheusExe   = Get-ChildItem -Path $binRoot -Filter 'prometheus.exe'   -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
$alertmanagerExe = Get-ChildItem -Path $binRoot -Filter 'alertmanager.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1

function Assert-Binaries {
    if (-not $prometheusExe)   { throw "prometheus.exe not found under $binRoot. See ops/README.md for the download step." }
    if (-not $alertmanagerExe) { throw "alertmanager.exe not found under $binRoot. See ops/README.md for the download step." }
}

function Start-Stack {
    Assert-Binaries

    $promData = Join-Path $opsRoot 'prometheus\data'
    $amData   = Join-Path $opsRoot 'alertmanager\data'
    New-Item -ItemType Directory -Force -Path $promData, $amData | Out-Null

    $smtpPasswordFile = Join-Path $opsRoot 'alertmanager\smtp-password.txt'
    if (-not (Test-Path $smtpPasswordFile)) {
        Write-Warning "ops\alertmanager\smtp-password.txt is missing. Alerts will fire and route, but the email notification will fail SMTP authentication. Create the file containing only your Gmail app password."
    }

    if (Get-Process prometheus -ErrorAction SilentlyContinue) {
        Write-Host 'Prometheus is already running.'
    } else {
        Start-Process -FilePath $prometheusExe.FullName -WindowStyle Hidden -WorkingDirectory $opsRoot -ArgumentList @(
            "--config.file=$(Join-Path $opsRoot 'prometheus\prometheus.yml')",
            "--storage.tsdb.path=$promData",
            '--storage.tsdb.retention.time=7d',
            '--web.listen-address=:9090',
            '--web.enable-lifecycle'
        )
        Write-Host 'Prometheus starting on http://localhost:9090'
    }

    if (Get-Process alertmanager -ErrorAction SilentlyContinue) {
        Write-Host 'Alertmanager is already running.'
    } else {
        # Run from the alertmanager config directory so smtp_auth_password_file
        # resolves relative to the config rather than to the caller's location.
        Start-Process -FilePath $alertmanagerExe.FullName -WindowStyle Hidden -WorkingDirectory (Join-Path $opsRoot 'alertmanager') -ArgumentList @(
            "--config.file=alertmanager.yml",
            "--storage.path=$amData",
            '--web.listen-address=:9093'
        )
        Write-Host 'Alertmanager starting on http://localhost:9093'
    }

    Start-Sleep -Seconds 4
    Get-Status
}

function Stop-Stack {
    foreach ($name in 'prometheus', 'alertmanager') {
        $processes = Get-Process $name -ErrorAction SilentlyContinue
        if ($processes) {
            $processes | Stop-Process -Force
            Write-Host "Stopped $name."
        } else {
            Write-Host "$name was not running."
        }
    }
}

function Test-Endpoint($name, $url) {
    try {
        $response = Invoke-WebRequest -Uri $url -TimeoutSec 5 -UseBasicParsing
        Write-Host ("  {0,-14} UP    ({1})" -f $name, $url) -ForegroundColor Green
        return $true
    } catch {
        Write-Host ("  {0,-14} DOWN  ({1})" -f $name, $url) -ForegroundColor Red
        return $false
    }
}

function Get-Status {
    Write-Host "`nMonitoring stack:"
    Test-Endpoint 'Prometheus'   'http://localhost:9090/-/healthy'   | Out-Null
    Test-Endpoint 'Alertmanager' 'http://localhost:9093/-/healthy'   | Out-Null

    Write-Host "`nScrape targets:"
    try {
        $targets = (Invoke-RestMethod 'http://localhost:9090/api/v1/targets?state=active' -TimeoutSec 5).data.activeTargets
        foreach ($target in $targets) {
            $colour = if ($target.health -eq 'up') { 'Green' } else { 'Red' }
            Write-Host ("  {0,-28} {1,-6} {2}" -f $target.labels.instance, $target.health.ToUpper(), $target.labels.job) -ForegroundColor $colour
        }
    } catch {
        Write-Host '  (Prometheus is not answering)' -ForegroundColor DarkGray
    }

    Write-Host "`nApplication instances:"
    foreach ($instance in @(@{ n = 'staging'; p = 3001 }, @{ n = 'production'; p = 3000 })) {
        Test-Endpoint $instance.n "http://localhost:$($instance.p)/health" | Out-Null
    }
    Write-Host ''
}

switch ($Action) {
    'start'   { Start-Stack }
    'stop'    { Stop-Stack }
    'restart' { Stop-Stack; Start-Sleep -Seconds 2; Start-Stack }
    'status'  { Get-Status }
}
