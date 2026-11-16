<#
.SYNOPSIS
    Launch the Windows native build and ensure it can find its resources.

.DESCRIPTION
    The Cocos Creator 3.8 windows exe only reads the "data" directory next to the exe.
    It does NOT read the "Resources" folder produced by cmake copy_resource, which is a
    stale copy (its settings.json still has launchScene = Placeholder). Therefore, before
    launching the exe, a "data" junction/link must exist next to the exe pointing at
    build/windows/data.

    This script is idempotent: it creates the data junction if missing, then starts
    rougeCard.exe. After a rebuild, just run this script again; no manual link needed.

.PARAMETER NoLaunch
    Only create/repair the data link, do not launch the exe. Useful for build preparation.

.EXAMPLE
    .\build\scripts\run-windows.ps1
    Ensure the data link, then launch the game.

.EXAMPLE
    .\build\scripts\run-windows.ps1 -NoLaunch
    Only create the data link, do not launch.
#>
[CmdletBinding()]
param(
    [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'

# Repo root = two levels up from build/scripts
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$buildDir = Join-Path $repoRoot 'build\windows'
$releaseDir = Join-Path $buildDir 'proj\Release'
$exePath = Join-Path $releaseDir 'rougeCard.exe'
$linkPath = Join-Path $releaseDir 'data'
$targetPath = Join-Path $buildDir 'data'

if (-not (Test-Path $exePath)) {
    throw "exe not found: $exePath . Run the windows build in the Cocos Creator Build panel first."
}
if (-not (Test-Path $targetPath)) {
    throw "resource dir not found: $targetPath . Build is incomplete."
}

# Idempotent data junction creation
if (-not (Test-Path $linkPath)) {
    New-Item -ItemType Junction -Path $linkPath -Target $targetPath | Out-Null
    Write-Host "[run-windows] data link created: $linkPath -> $targetPath"
} else {
    $item = Get-Item -Force $linkPath -ErrorAction SilentlyContinue
    if ($item -and $item.LinkType -eq 'Junction' -and $item.Target -contains $targetPath) {
        Write-Host "[run-windows] data link already present, skip: $linkPath"
    } else {
        Write-Warning "[run-windows] $linkPath exists but is not a junction to $targetPath ; check manually."
    }
}

if ($NoLaunch) {
    Write-Host '[run-windows] -NoLaunch specified, not starting exe.'
    return
}

Write-Host "[run-windows] starting: $exePath"
Start-Process -FilePath $exePath -WorkingDirectory $releaseDir
