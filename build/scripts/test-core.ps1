<#
.SYNOPSIS
    Compile core + tests with Cocos' bundled tsc, then run node:test.

.DESCRIPTION
    Zero npm dependencies. Uses the TypeScript bundled with the local Cocos
    Creator install to compile assets/core/**/*.ts and tests/core/**/*.ts into
    temp/test-build (git-ignored), then runs the compiled .test.js files with
    Node's built-in test runner. The compiler keeps type checking strict.

.PARAMETER CocosRoot
    Path to the Cocos Creator install. Default: C:\ProgramData\cocos\editors\Creator\3.8.8

.EXAMPLE
    .\build\scripts\test-core.ps1
#>
[CmdletBinding()]
param(
    [string]$CocosRoot = 'C:\ProgramData\cocos\editors\Creator\3.8.8'
)

$ErrorActionPreference = 'Stop'

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$tsc = Join-Path $CocosRoot 'resources\app.asar.unpacked\node_modules\typescript\lib\tsc.js'
$outDir = Join-Path $repoRoot 'temp\test-build'

if (-not (Test-Path $tsc)) {
    throw "tsc.js not found: $tsc . Pass -CocosRoot with a valid Cocos install."
}

$coreFiles = @(Get-ChildItem -Path (Join-Path $repoRoot 'assets\core') -Filter '*.ts' -File)
$testFiles = @(Get-ChildItem -Path (Join-Path $repoRoot 'tests\core') -Filter '*.test.ts' -File -Recurse)
if ($testFiles.Count -eq 0) {
    throw 'No test files found under tests/core/.'
}

if (Test-Path $outDir) {
    Remove-Item $outDir -Recurse -Force
}
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$sources = @($coreFiles + $testFiles | ForEach-Object { $_.FullName })
Write-Host "[test-core] compiling $($sources.Count) TS files with strict type checking ..."
& node $tsc --noEmitOnError --strict --skipLibCheck --target ES2019 --module CommonJS --moduleResolution node --outDir $outDir @sources
if ($LASTEXITCODE -ne 0) {
    throw "TypeScript compilation failed (exit $LASTEXITCODE)."
}

$compiledTests = @(Get-ChildItem -Path $outDir -Filter '*.test.js' -File -Recurse)
Write-Host "[test-core] running $($compiledTests.Count) test file(s) with node --test ..."
& node --test $compiledTests.FullName
if ($LASTEXITCODE -ne 0) {
    throw "Tests failed (exit $LASTEXITCODE)."
}

Write-Host '[test-core] ALL TESTS PASSED'
