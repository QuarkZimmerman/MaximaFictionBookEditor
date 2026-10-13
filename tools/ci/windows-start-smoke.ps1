# Starts the Windows editor (installed or unpacked) and waits until its window shows the editor
# interface, read over the DevTools protocol (page title), then stops it with all its processes.
# Fails when the editor exits early, when the interface does not appear in time, or when
# Chromium reports that its sandboxed helper processes cannot read the program folder.
param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [int]$TimeoutSeconds = 120,
    [int]$Port = 9333
)
$ErrorActionPreference = 'Stop'
$cefLog = Join-Path $env:LOCALAPPDATA 'Maxima Fiction Book Editor\logs\cef-debug.log'
Remove-Item $cefLog -Force -ErrorAction SilentlyContinue

Write-Host "Starting $Exe"
$proc = Start-Process -FilePath $Exe -ArgumentList "--remote-debugging-port=$Port" -PassThru
try {
    $title = $null
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while (-not $title -and (Get-Date) -lt $deadline) {
        if ($proc.HasExited) { throw "mfbe.exe exited early (exit code $($proc.ExitCode))" }
        try {
            $pages = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 5
            $page = $pages | Where-Object { $_.type -eq 'page' -and $_.title -like 'Maxima Fiction Book Editor*' } |
                Select-Object -First 1
            if ($page) { $title = $page.title }
        } catch {
            # The DevTools endpoint is not up yet.
        }
        if (-not $title) { Start-Sleep -Seconds 1 }
    }
    if (-not $title) { throw "the editor interface did not appear within $TimeoutSeconds s" }
    Write-Host "Interface shown: '$title'"
    if (Test-Path $cefLog) {
        $denied = Select-String -Path $cefLog -Pattern 'Sandbox cannot access executable', 'Network service crashed'
        if ($denied) {
            $denied | ForEach-Object { Write-Host $_.Line }
            throw "Chromium's sandboxed helper processes cannot read the program folder"
        }
    }
} catch {
    if (Test-Path $cefLog) {
        Write-Host '----- cef-debug.log (last 40 lines) -----'
        Get-Content $cefLog -Tail 40 | ForEach-Object { Write-Host $_ }
    }
    throw
} finally {
    & taskkill.exe /PID $proc.Id /T /F 2>&1 | Out-Null
    # taskkill only requests the end: wait until no process runs from the editor's folder, so its
    # files are released (uninstall, deleting the folder).
    $folder = Split-Path -Parent $Exe
    $stopDeadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $stopDeadline -and
           (Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($folder, [StringComparison]::OrdinalIgnoreCase) })) {
        Start-Sleep -Milliseconds 500
    }
}
