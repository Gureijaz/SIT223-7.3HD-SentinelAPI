<#
.SYNOPSIS
    Creates the Sentinel API pipeline job and its credentials in a local Jenkins.

.DESCRIPTION
    Everything this script does can also be done through the Jenkins UI; it exists
    so the setup is repeatable and so nothing is mistyped. You supply your own
    Jenkins API token and secrets — they are read interactively as secure strings,
    are never written to disk, and never leave localhost.

    Generate a Jenkins API token at:
      http://localhost:8080/user/<your-username>/security  →  Add new token

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File jenkins\setup-jenkins.ps1 -JenkinsUser gurei
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$JenkinsUser,

    [string]$JenkinsUrl = 'http://localhost:8080',

    [string]$JobName = 'sentinel-api-pipeline',

    [switch]$SkipCredentials
)

$ErrorActionPreference = 'Stop'

$configPath = Join-Path $PSScriptRoot 'sentinel-api-pipeline.xml'
if (-not (Test-Path $configPath)) { throw "Job definition not found at $configPath" }

Write-Host "Jenkins: $JenkinsUrl  (user: $JenkinsUser)`n"

$apiToken = Read-Host -Prompt 'Jenkins API token' -AsSecureString
$plainToken = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($apiToken))

$authHeader = @{
    Authorization = 'Basic ' + [Convert]::ToBase64String(
        [Text.Encoding]::ASCII.GetBytes("${JenkinsUser}:${plainToken}"))
}

function Get-Crumb {
    $response = Invoke-RestMethod -Uri "$JenkinsUrl/crumbIssuer/api/json" -Headers $authHeader -SessionVariable script:session
    return @{ $response.crumbRequestField = $response.crumb }
}

$crumb = Get-Crumb
$headers = $authHeader + $crumb

# ── Credentials ────────────────────────────────────────────────────────────
# Three secret-text credentials the Jenkinsfile binds by id. Each is prompted
# for and posted straight to the local Jenkins credential store.
if (-not $SkipCredentials) {
    $credentialSpecs = @(
        @{ Id = 'sonarcloud-token';     Prompt = 'SonarCloud token (My Account -> Security -> Generate Token)' },
        @{ Id = 'github-token';         Prompt = 'GitHub personal access token with repo scope' },
        @{ Id = 'sentinel-jwt-secret';  Prompt = 'JWT signing secret for the deployed app (any long random string)' }
    )

    foreach ($spec in $credentialSpecs) {
        Write-Host "`nCredential '$($spec.Id)'"
        $secure = Read-Host -Prompt "  $($spec.Prompt) (blank to skip)" -AsSecureString
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))

        if ([string]::IsNullOrWhiteSpace($plain)) {
            Write-Host '  skipped' -ForegroundColor DarkGray
            continue
        }

        $payload = @{
            '' = '0'
            credentials = @{
                scope       = 'GLOBAL'
                id          = $spec.Id
                secret      = $plain
                description = "Sentinel API pipeline - $($spec.Id)"
                '$class'    = 'org.jenkinsci.plugins.plaincredentials.impl.StringCredentialsImpl'
            }
        } | ConvertTo-Json -Depth 5 -Compress

        try {
            Invoke-RestMethod -Method Post `
                -Uri "$JenkinsUrl/credentials/store/system/domain/_/createCredentials" `
                -Headers $headers -WebSession $script:session `
                -Body @{ json = $payload } | Out-Null
            Write-Host "  created" -ForegroundColor Green
        } catch {
            Write-Host "  could not create (it may already exist): $($_.Exception.Message)" -ForegroundColor Yellow
        }

        Remove-Variable plain -ErrorAction SilentlyContinue
    }
}

# ── Job ────────────────────────────────────────────────────────────────────
$configXml = Get-Content -Path $configPath -Raw

$jobExists = $false
try {
    Invoke-RestMethod -Uri "$JenkinsUrl/job/$JobName/api/json" -Headers $authHeader -WebSession $script:session | Out-Null
    $jobExists = $true
} catch {
    $jobExists = $false
}

if ($jobExists) {
    Write-Host "`nUpdating existing job '$JobName' ..."
    Invoke-RestMethod -Method Post -Uri "$JenkinsUrl/job/$JobName/config.xml" `
        -Headers $headers -WebSession $script:session `
        -ContentType 'application/xml' -Body $configXml | Out-Null
} else {
    Write-Host "`nCreating job '$JobName' ..."
    Invoke-RestMethod -Method Post -Uri "$JenkinsUrl/createItem?name=$JobName" `
        -Headers $headers -WebSession $script:session `
        -ContentType 'application/xml' -Body $configXml | Out-Null
}

Write-Host "Done. Job: $JenkinsUrl/job/$JobName/" -ForegroundColor Green
Write-Host "Trigger a build from there, or with: $JenkinsUrl/job/$JobName/build?delay=0sec"

Remove-Variable plainToken -ErrorAction SilentlyContinue
