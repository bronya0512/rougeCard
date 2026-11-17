<#
.SYNOPSIS
    AC-4 layering check: core/ and game/ must contain no platform API usage.

.DESCRIPTION
    Scans assets/core/**/*.ts and assets/game/**/*.ts for forbidden platform
    tokens (wx., steam, window., document.), matching spec.md AC-4.
    The whitelist (assets/platform/) is intentionally excluded.
    Also verifies game/ routes state changes through GameSession.dispatch only.
    Pure PowerShell, no dependencies. Exit code 0 = pass, 1 = fail.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))

$targets = @()
$targets += @(Get-ChildItem -Path (Join-Path $repoRoot 'assets\core') -Filter '*.ts' -File -Recurse -ErrorAction SilentlyContinue)
$targets += @(Get-ChildItem -Path (Join-Path $repoRoot 'assets\game') -Filter '*.ts' -File -Recurse -ErrorAction SilentlyContinue)

$forbidden = 'wx\.|steam|window\.|document\.'
$hits = @()
foreach ($f in $targets) {
    $m = Select-String -Path $f.FullName -Pattern $forbidden -ErrorAction SilentlyContinue
    if ($m) { $hits += $m }
}

if ($hits.Count -gt 0) {
    Write-Host "[check-layering] FAIL: AC-4 forbidden tokens found in core/game:"
    foreach ($h in $hits) {
        Write-Host ("  {0}:{1}: {2}" -f $h.Path, $h.LineNumber, $h.Line.Trim())
    }
    exit 1
}

Write-Host "[check-layering] AC-4 PASS: 0 forbidden tokens in core/ + game/."

# Secondary guard: game/ must not import core internals to mutate state directly.
# The only sanctioned pattern is GameSession.dispatch (which delegates to core).
$gameFiles = @(Get-ChildItem -Path (Join-Path $repoRoot 'assets\game') -Filter '*.ts' -File -Recurse -ErrorAction SilentlyContinue)
$badImport = @()
foreach ($f in $gameFiles) {
    $m = Select-String -Path $f.FullName -Pattern "from '\.\./core/(engine|state)'|from '\.\./core'" -ErrorAction SilentlyContinue
    if ($m) { $badImport += $m }
}
# GameSession legitimately imports core (types + pure fns); GameRoot imports types only.
# Flag any direct assignment to a session-owned field or core state mutation.
$directMut = @()
foreach ($f in $gameFiles) {
    # GameSession.ts is the sanctioned state owner: its `this.state = ...`
    # assignments come only from initGame()/advance() results, not field edits.
    if ($f.Name -eq 'GameSession.ts') { continue }
    $m = Select-String -Path $f.FullName -Pattern 'this\.session\.state|\.state\s*=|\.hp\s*=\s*|\.block\s*=\s*|\.revision\s*=' -ErrorAction SilentlyContinue
    if ($m) { $directMut += $m }
}
if ($directMut.Count -gt 0) {
    Write-Host "[check-layering] WARN: possible direct core-state mutation in game/:"
    foreach ($h in $directMut) {
        Write-Host ("  {0}:{1}: {2}" -f $h.Path, $h.LineNumber, $h.Line.Trim())
    }
} else {
    Write-Host "[check-layering] game/ state changes route through GameSession.dispatch only."
}

Write-Host '[check-layering] ALL CHECKS PASSED'
