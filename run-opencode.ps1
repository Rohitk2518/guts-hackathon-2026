<#
.SYNOPSIS
    Launcher script for OpenCode using NVIDIA Nemotron API.
#>

param(
    [string]$ApiKey = ""
)

function Save-NvidiaKey([string]$Key) {
    if (-not $Key) { return }
    $Key = $Key.Trim()
    $env:NVIDIA_API_KEY = $Key
    [System.Environment]::SetEnvironmentVariable('NVIDIA_API_KEY', $Key, 'User')
    
    $authObj = @{
        "type" = "api"
        "key"  = $Key
    }
    
    $paths = @(
        "$env:USERPROFILE\.local\share\opencode\auth.json",
        "$env:USERPROFILE\.opencode\auth.json",
        "d:\GUTS\.opencode\auth.json"
    )
    
    foreach ($p in $paths) {
        $parent = Split-Path $p
        if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        $existing = @{}
        if (Test-Path $p) {
            try { $existing = Get-Content $p -Raw | ConvertFrom-Json -AsHashtable } catch {}
        }
        $existing['nvidia'] = $authObj
        $existing | ConvertTo-Json | Set-Content $p -Encoding UTF8 -Force
    }
    
    Write-Host "[OK] NVIDIA API Key registered in OpenCode auth store!" -ForegroundColor Green
}

# 1. If passed via param
if ($ApiKey) {
    Save-NvidiaKey $ApiKey
}

# 2. Check environment / user variable
if (-not $env:NVIDIA_API_KEY) {
    $userEnvKey = [System.Environment]::GetEnvironmentVariable('NVIDIA_API_KEY', 'User')
    if ($userEnvKey) {
        $env:NVIDIA_API_KEY = $userEnvKey
        Save-NvidiaKey $userEnvKey
    }
}

Write-Host ""
Write-Host "Starting OpenCode with NVIDIA Nemotron..." -ForegroundColor Cyan
Write-Host "Model: nvidia/nvidia/nemotron-3.5-super-vl-120b-a12b" -ForegroundColor DarkGray
Write-Host ""

opencode
