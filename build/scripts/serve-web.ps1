<#
.SYNOPSIS
    Serve the Web/H5 build locally for browser verification.

.DESCRIPTION
    Starts a local static server for build/web-desktop using the verified Python
    from T002 (C:\Python313\python.exe). Use this together with playwright-cli
    (msedge) to verify the StartMenu renders and the START button navigates.

.PARAMETER Port
    HTTP port. Default 8123 (matches plan.md section 4).

.PARAMETER Python
    Path to python.exe. Default C:\Python313\python.exe (verified in T002).

.EXAMPLE
    .\build\scripts\serve-web.ps1
    Serves build/web-desktop at http://127.0.0.1:8123/

.EXAMPLE
    .\build\scripts\serve-web.ps1 -Port 9000
#>
[CmdletBinding()]
param(
    [int]$Port = 8123,
    [string]$Python = 'C:\Python313\python.exe'
)

$ErrorActionPreference = 'Stop'

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$webDir = Join-Path $repoRoot 'build\web-desktop'

if (-not (Test-Path $webDir)) {
    throw "Web build not found: $webDir . Build web-desktop in the Cocos Creator Build panel first."
}
if (-not (Test-Path $Python)) {
    throw "Python not found: $Python . Pass -Python with a valid python.exe path."
}

Write-Host "[serve-web] Serving $webDir at http://127.0.0.1:$Port/"
Write-Host '[serve-web] Press Ctrl+C to stop.'
& $Python -m http.server $Port --directory $webDir
