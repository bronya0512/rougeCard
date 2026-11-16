<#
.SYNOPSIS
    Restore the tracked build-task configuration into the local Cocos profile.

.DESCRIPTION
    Cocos Creator stores Build panel tasks in profiles/v2/packages/builder.json,
    which is git-ignored (local state). A fresh checkout therefore has no build
    tasks, so builds cannot be reproduced. This script copies the tracked
    template build/config/builder.json.template back into the local profile.

    The template contains no machine-specific absolute paths; scene references
    use stable db:// URLs and asset UUIDs.

    NOTE: Cocos must be CLOSED when running this script. If the editor is open,
    it may overwrite the file from its in-memory state on exit. After restoring,
    open the editor and verify the three tasks (web-desktop / wechatgame /
    windows) appear in the Build panel with StartMenu as the start scene.

.PARAMETER Force
    Overwrite an existing local builder.json without prompting.

.EXAMPLE
    .\build\scripts\setup-build-config.ps1 -Force
#>
[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$template = Join-Path $repoRoot 'build\config\builder.json.template'
$target = Join-Path $repoRoot 'profiles\v2\packages\builder.json'

if (-not (Test-Path $template)) {
    throw "Template not found: $template"
}

$editor = Get-Process -Name CocosCreator,Creator -ErrorAction SilentlyContinue
if ($editor) {
    Write-Warning '[setup] Cocos Creator appears to be running. Close it before restoring, or the editor may overwrite builder.json on exit.'
}

if (Test-Path $target) {
    if (-not $Force) {
        $answer = Read-Host "Local builder.json already exists. Overwrite? [y/N]"
        if ($answer -notmatch '^[yY]') {
            Write-Host '[setup] Aborted, no changes made.'
            return
        }
    }
    Copy-Item $target "$target.bak" -Force
    Write-Host "[setup] Backed up existing config to: $target.bak"
}

$dir = Split-Path -Parent $target
if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
}
Copy-Item $template $target -Force
Write-Host "[setup] Restored build config: $template -> $target"
Write-Host '[setup] Now open Cocos Creator and verify the 3 build tasks in the Build panel.'
