$ErrorActionPreference = 'Stop'

$scriptUnderTest = Join-Path $PSScriptRoot '..\Backup-InventoryBlindToDrive.ps1'
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("inventoryblind-backup-test-" + [guid]::NewGuid())
$sourcePath = Join-Path $tempRoot 'source'
$fakeRclone = Join-Path $tempRoot 'fake-rclone.ps1'
$capturePath = Join-Path $tempRoot 'arguments.txt'

function Assert-True {
    param(
        [Parameter(Mandatory)]
        [bool] $Condition,

        [Parameter(Mandatory)]
        [string] $Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

try {
    New-Item -ItemType Directory -Force -Path $sourcePath | Out-Null
    @'
[System.IO.File]::WriteAllLines($env:INVENTORYBLIND_TEST_CAPTURE, [string[]]$args)
'@ | Set-Content -LiteralPath $fakeRclone -Encoding utf8

    $env:INVENTORYBLIND_TEST_CAPTURE = $capturePath

    & $scriptUnderTest `
        -DryRun `
        -SourcePath $sourcePath `
        -Destination 'inventoryblind-drive:' `
        -RcloneExecutable $fakeRclone

    $arguments = [System.IO.File]::ReadAllLines($capturePath)
    Assert-True ($arguments[0] -eq 'copy') 'The backup must invoke rclone copy.'
    Assert-True ($arguments -contains '--dry-run') 'Dry-run mode must pass --dry-run to rclone.'

    $destructiveVerbs = @('sync', 'move', 'delete', 'deletefile', 'purge')
    foreach ($verb in $destructiveVerbs) {
        Assert-True ($arguments -notcontains $verb) "The backup must never invoke the destructive verb '$verb'."
    }

    $requiredExclusions = @(
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
    foreach ($exclusion in $requiredExclusions) {
        Assert-True ($arguments -contains $exclusion) "Missing required exclusion: $exclusion"
    }

    Assert-True ($arguments -contains '--no-update-modtime') 'Identical files must not trigger remote modification-time updates.'
    Assert-True ($arguments -contains '--no-update-dir-modtime') 'Existing directories must not trigger remote modification-time updates.'

    Remove-Item -LiteralPath $capturePath -Force

    & $scriptUnderTest `
        -SourcePath $sourcePath `
        -Destination 'inventoryblind-drive:' `
        -RcloneExecutable $fakeRclone

    $arguments = [System.IO.File]::ReadAllLines($capturePath)
    Assert-True ($arguments[0] -eq 'copy') 'A real backup run must still invoke rclone copy.'
    Assert-True ($arguments -notcontains '--dry-run') 'A real backup run must omit --dry-run.'

    $missingSource = Join-Path $tempRoot 'missing'
    $didThrow = $false
    try {
        & $scriptUnderTest `
            -SourcePath $missingSource `
            -Destination 'inventoryblind-drive:' `
            -RcloneExecutable $fakeRclone
    }
    catch {
        $didThrow = $true
    }
    Assert-True $didThrow 'The backup must refuse to run when the source folder does not exist.'

    Write-Host 'PASS: backup command is copy-only, supports dry-run, excludes unsafe paths, and validates its source.'
}
finally {
    Remove-Item Env:INVENTORYBLIND_TEST_CAPTURE -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
