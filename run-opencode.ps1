<#
.SYNOPSIS
    Launcher script for OpenCode using NVIDIA Nemotron API.
#>

param(
    [string]$ApiKey = ""
)

# 1. Check or set the NVIDIA API Key
if (-not $env:NVIDIA_API_KEY -and $ApiKey) {
    $env:NVIDIA_API_KEY = $ApiKey
    [System.Environment]::SetEnvironmentVariable('NVIDIA_API_KEY', $ApiKey, 'User')
    Write-Host "[OK] NVIDIA_API_KEY saved to user environment." -ForegroundColor Green
}

if (-not $env:NVIDIA_API_KEY) {
    $userEnvKey = [System.Environment]::GetEnvironmentVariable('NVIDIA_API_KEY', 'User')
    if ($userEnvKey) {
        $env:NVIDIA_API_KEY = $userEnvKey
    } else {
        Write-Host ""
        Write-Host "==========================================================" -ForegroundColor Cyan
        Write-Host " NVIDIA Nemotron API Key Setup" -ForegroundColor Yellow
        Write-Host "==========================================================" -ForegroundColor Cyan
        Write-Host "You need a free NVIDIA API key from: https://build.nvidia.com"
        Write-Host ""
        $inputKey = Read-Host "Paste your NVIDIA API Key (starts with nvapi-)"
        if ($inputKey) {
            $env:NVIDIA_API_KEY = $inputKey.Trim()
            [System.Environment]::SetEnvironmentVariable('NVIDIA_API_KEY', $env:NVIDIA_API_KEY, 'User')
            Write-Host "[OK] Saved NVIDIA_API_KEY permanently to your user environment!" -ForegroundColor Green
        } else {
            Write-Warning "No API key entered. OpenCode might not be able to call the model."
        }
    }
}

Write-Host ""
Write-Host "Starting OpenCode with NVIDIA Nemotron..." -ForegroundColor Cyan
Write-Host "Default model: nvidia/nvidia/llama-3.1-nemotron-70b-instruct" -ForegroundColor DarkGray
Write-Host ""

opencode
