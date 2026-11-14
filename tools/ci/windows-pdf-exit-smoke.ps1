# Feature 014 (requester, rc.4 and rc.5): after a PDF export, closing the editor must end every one
# of its processes. Starts the editor on a copy of -Book with DevTools, exports the book through
# File > Export > Export as PDF... - the native Save dialog accepted with its proposal (beside the
# copy), the pages printed by the editor's own print service in its hidden browser - then File >
# Exit (tools/shell-smoke-pdf.mjs does both), and requires every process running the editor's
# executable to have ended within 20 s. Found by the executable each process runs, not by a name.
# The close must also go as designed: neither safety net - the print browser's close time limit,
# the shutdown watchdog - may have acted (each writes a warning to the errors log). A failure lists
# the processes left with their command lines and shows the editor's errors log and the browser
# engine's log; the processes are then ended.
param(
    [Parameter(Mandatory = $true)] [string]$Exe,
    [Parameter(Mandatory = $true)] [string]$Book,
    [int]$Port = 9334,
    [int]$TimeoutSeconds = 120
)
$ErrorActionPreference = 'Stop'
$Exe = (Resolve-Path -LiteralPath $Exe).Path
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$temp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$work = Join-Path $temp "mfbe-pdf-exit-$(Get-Date -Format 'HHmmss')"
New-Item -ItemType Directory -Path $work | Out-Null
$copy = Join-Path $work (Split-Path -Leaf $Book)
Copy-Item -LiteralPath $Book -Destination $copy

$portableData = Join-Path (Split-Path -Parent $Exe) 'user'
$logFolder = if (Test-Path -LiteralPath $portableData) { Join-Path $portableData 'logs' } else { Join-Path $env:LOCALAPPDATA 'Maxima Fiction Book Editor\logs' }
$errorsLog = Join-Path $logFolder 'mfbe-errors.log'
$cefLog = Join-Path $logFolder 'cef-debug.log'
$errorsBefore = if (Test-Path -LiteralPath $errorsLog) { @(Get-Content -LiteralPath $errorsLog).Count } else { 0 }

function Get-EditorProcesses {
    @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -ieq $Exe) })
}
function Show-Logs {
    if (Test-Path -LiteralPath $errorsLog) {
        Write-Host "--- $errorsLog (new entries)"
        Get-Content -LiteralPath $errorsLog | Select-Object -Skip $errorsBefore | ForEach-Object { Write-Host $_ }
    }
    if (Test-Path -LiteralPath $cefLog) {
        Write-Host "--- $cefLog (last 60 lines)"
        Get-Content -LiteralPath $cefLog -Tail 60 | ForEach-Object { Write-Host $_ }
    }
}

if ((Get-EditorProcesses).Count -gt 0) { throw "processes of $Exe are running before the smoke" }
Write-Host "Starting $Exe on $copy"
$proc = Start-Process -FilePath $Exe -ArgumentList "--remote-debugging-port=$Port", "`"$copy`"" -PassThru
try {
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($copy)
    $shown = $false
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while (-not $shown -and (Get-Date) -lt $deadline) {
        if ($proc.HasExited) { throw ("mfbe.exe exited early (exit code 0x{0:X8})" -f $proc.ExitCode) }
        try {
            $pages = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 5
            # "<book> - Maxima Fiction Book Editor" once the book is shown (the bare product name
            # while the interface loads, "Untitled - ..." before the book has loaded).
            $shown = [bool]($pages | Where-Object { $_.type -eq 'page' -and $_.title -like '* - Maxima Fiction Book Editor' -and $_.title -notlike 'Untitled - *' })
        } catch {
            # The DevTools endpoint is not up yet.
        }
        if (-not $shown) { Start-Sleep -Seconds 1 }
    }
    if (-not $shown) { throw "the editor did not show the book within $TimeoutSeconds s" }
    Write-Host "The editor shows the book; exporting it as PDF"
    # The helper's notes go to stderr, its result (the PDF's path) is its last line on stdout.
    $ErrorActionPreference = 'Continue'
    $output = & node (Join-Path $root 'tools\shell-smoke-pdf.mjs') $Port $work 2>&1
    $exportExit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    $output | ForEach-Object { Write-Host $_ }
    if ($exportExit -ne 0) { throw "the PDF export through the editor failed (exit $exportExit)" }
    $pdf = "$($output | Where-Object { $_ -is [string] } | Select-Object -Last 1)".Trim()
    if (-not $pdf -or -not (Test-Path -LiteralPath $pdf) -or (Get-Item -LiteralPath $pdf).Length -eq 0) { throw "no PDF written (last line: '$pdf')" }
    Write-Host "Printed $pdf ($((Get-Item -LiteralPath $pdf).Length) bytes); waiting for every process of the editor to end"
    $deadline = (Get-Date).AddSeconds(20)
    $left = Get-EditorProcesses
    while ($left.Count -gt 0 -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 250
        $left = Get-EditorProcesses
    }
    if ($left.Count -gt 0) {
        $left | ForEach-Object { Write-Host "left running: $($_.ProcessId) $($_.CommandLine)" }
        Show-Logs
        throw "$($left.Count) processes of $Exe still running 20 s after File > Exit following a PDF export"
    }
    $closing = @()
    if (Test-Path -LiteralPath $errorsLog) {
        $closing = @(Get-Content -LiteralPath $errorsLog | Select-Object -Skip $errorsBefore | Where-Object { $_ -match 'shell\.(printBrowserClose|shutdownTimeout)' })
    }
    if ($closing.Count -gt 0) {
        Show-Logs
        throw "the editor ended, but its close needed its safety net: $($closing -join ' | ')"
    }
    Write-Host "The editor and all its processes ended after File > Exit following a PDF export"
} finally {
    Get-EditorProcesses | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
