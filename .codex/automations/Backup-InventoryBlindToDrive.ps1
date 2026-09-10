[CmdletBinding()]
param(
    [switch] $DryRun,

    [string] $SourcePath = 'C:\Users\victo\Downloads\InventoryBlindBase\inventoryblind\project',

    [string] $Destination = 'inventoryblind-drive:',

    [string] $RcloneExecutable = 'rclone'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $SourcePath -PathType Container)) {
    throw "Source folder does not exist: $SourcePath"
}

$resolvedSource = (Resolve-Path -LiteralPath $SourcePath).Path
$exclusions = @(
    '/.git/**',
    '/node_modules/**',
    '/dist/**',
    '/.env',
    '/.originkit/**',
    '/supabase/.temp/**',
    '/.claude/worktrees/**',
    '/~/**',
    '**/*.log'
)

$rcloneArguments = @(
    'copy',
    $resolvedSource,
    $Destination,
    '--log-level', 'INFO',
    '--stats', '30s',
    '--stats-one-line',
    '--no-update-modtime',
    '--no-update-dir-modtime'
)

foreach ($exclusion in $exclusions) {
    $rcloneArguments += @('--exclude', $exclusion)
}

if ($DryRun) {
    $rcloneArguments += '--dry-run'
}

$mode = if ($DryRun) { 'DRY-RUN' } else { 'COPY' }
Write-Host "InventoryBlind backup mode: $mode"
Write-Host "Source: $resolvedSource"
Write-Host "Destination: $Destination"
Write-Host 'Safety policy: copy only; no remote or local deletions.'

& $RcloneExecutable @rcloneArguments
$exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int] $LASTEXITCODE }
if ($exitCode -ne 0) {
    throw "rclone copy failed with exit code $exitCode."
}
