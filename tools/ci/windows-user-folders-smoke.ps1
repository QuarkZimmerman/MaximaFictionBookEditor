# Feature 015 (FR-001, FR-006): the user's genre file, script and template are in effect in the
# Windows editor. Puts the fixtures of tests\fixtures\user-folders into -DataRoot (the installed
# editor's %APPDATA%\Maxima Fiction Book Editor, or a portable copy's user folder), starts the editor
# with DevTools and runs tools\user-folders-check.mjs; every process of the editor is then ended.
param(
    [Parameter(Mandatory = $true)] [string]$Exe,
    [Parameter(Mandatory = $true)] [string]$DataRoot,
    [int]$Port = 9335,
    [int]$TimeoutSeconds = 120
)
$ErrorActionPreference = 'Stop'
$Exe = (Resolve-Path -LiteralPath $Exe).Path
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$fixtures = Join-Path $root 'tests\fixtures\user-folders'
New-Item -ItemType Directory -Force -Path (Join-Path $DataRoot 'genres'), (Join-Path $DataRoot 'scripts') | Out-Null
Copy-Item -LiteralPath (Join-Path $fixtures 'my.genres.tsv'), (Join-Path $fixtures 'genres.txt') -Destination (Join-Path $DataRoot 'genres') -Force
Copy-Item -LiteralPath (Join-Path $fixtures 'my-test-script') -Destination (Join-Path $DataRoot 'scripts') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $fixtures 'blank.fb2') -Destination $DataRoot -Force

function Get-EditorProcesses {
    @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -ieq $Exe) })
}
Write-Host "Starting $Exe with the user items in $DataRoot"
$proc = Start-Process -FilePath $Exe -ArgumentList "--remote-debugging-port=$Port" -PassThru
try {
    $shown = $false
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while (-not $shown -and (Get-Date) -lt $deadline) {
        if ($proc.HasExited) { throw ("mfbe.exe exited early (exit code 0x{0:X8})" -f $proc.ExitCode) }
        try {
            $pages = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 5
            $shown = [bool]($pages | Where-Object { $_.type -eq 'page' -and $_.title -like '* - Maxima Fiction Book Editor' })
        } catch {
            # The DevTools endpoint is not up yet.
        }
        if (-not $shown) { Start-Sleep -Seconds 1 }
    }
    if (-not $shown) { throw "the editor interface did not appear within $TimeoutSeconds s" }
    $ErrorActionPreference = 'Continue'
    & node (Join-Path $root 'tools\user-folders-check.mjs') $Port 2>&1 | ForEach-Object { Write-Host $_ }
    $checkExit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($checkExit -ne 0) { throw "the user's genre file, script or template is not in effect (exit $checkExit)" }
    Write-Host "The user's genre file, script and template are in effect"
} finally {
    Get-EditorProcesses | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
