# Starts the Windows editor (installed or unpacked) and waits until its window shows the editor
# interface, read over the DevTools protocol (page title ending with the editor's name, e.g.
# "Untitled - Maxima Fiction Book Editor"), then stops it with all its processes.
# Fails when the editor exits early, when the interface does not appear in time, or when
# Chromium reports that its sandboxed helper processes cannot read the program folder.
#
# -AsUser <name> runs the editor as a standard (non-administrator) local user with that name,
# created on first use, whose profile folder Windows creates at a first logon - as on a user's
# own machine, where nothing can be created directly under C:\Users (feature 002: on Russian
# Windows the editor ended at start-up for users with Cyrillic names). The run also fails when a
# folder appears directly under C:\Users other than the users' profiles (a path mis-converted
# through the legacy code page creates a sibling such as C:\Users\PÃ¶be). Build non-ASCII names
# from character codes, e.g. "Pr$([char]0x00F6)be".
#
# A portable copy (a `user` folder next to the program) must keep its browser profile in that
# folder and leave the profile without the editor's folders; an installed copy must create its
# data folder in the profile.
#
# -Shortcut <file.lnk> (instead of -Exe; feature 003, the installer's desktop shortcut) starts
# the editor through the shortcut as a double-click does - the shell resolves the .lnk - after
# checking that its target exists; the target is then the program for every other check. The
# shell may hand back no process object for a .lnk, so the started mfbe.exe is looked up by its
# path, and the interface counts as shown also when the window's title carries a document name
# ("Untitled - Maxima Fiction Book Editor"), in case the DevTools argument is not passed on.
param(
    [string]$Exe = '',
    [string]$Shortcut = '',
    [string]$AsUser = '',
    [int]$TimeoutSeconds = 120,
    [int]$Port = 9333
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-users.ps1')

if ([string]::IsNullOrEmpty($Exe) -eq [string]::IsNullOrEmpty($Shortcut)) { throw 'give either -Exe or -Shortcut' }
if ($Shortcut) {
    if ($AsUser) { throw '-Shortcut cannot be combined with -AsUser' }
    if (-not (Test-Path -LiteralPath $Shortcut)) { throw "shortcut not found: $Shortcut" }
    $link = (New-Object -ComObject WScript.Shell).CreateShortcut($Shortcut)
    Write-Host "Shortcut $Shortcut -> '$($link.TargetPath)' (arguments '$($link.Arguments)', start in '$($link.WorkingDirectory)', icon '$($link.IconLocation)')"
    if (-not $link.TargetPath -or -not (Test-Path -LiteralPath $link.TargetPath)) { throw "the shortcut's target does not exist: '$($link.TargetPath)'" }
    $Exe = $link.TargetPath
}

$usersBefore = Get-UserFolders
$account = $null
$profileDir = $env:USERPROFILE
if ($AsUser) {
    Write-Host "Preparing the standard user '$AsUser'"
    $account = New-StandardUser $AsUser
    $profileDir = $account.Profile
    Write-Host "Profile folder: $profileDir"
}
$portableData = Join-Path (Split-Path -Parent $Exe) 'user'
$portable = Test-Path -LiteralPath $portableData
$profileFolders = @('AppData\Roaming', 'AppData\Local') |
    ForEach-Object { Join-Path $profileDir "$_\Maxima Fiction Book Editor" }
$logFolder = if ($portable) { Join-Path $portableData 'logs' } else { Join-Path $profileFolders[1] 'logs' }
$cefLog = Join-Path $logFolder 'cef-debug.log'
Remove-Item -LiteralPath $cefLog -Force -ErrorAction SilentlyContinue
if ($portable) {
    # Runs of the installed copy left the editor's folders in the profile.
    $profileFolders | ForEach-Object { Remove-Item -LiteralPath $_ -Recurse -Force -ErrorAction SilentlyContinue }
}
$stamp = Get-Date -Format 'HHmmss'
$stdout = Join-Path $env:RUNNER_TEMP "mfbe-stdout-$stamp.txt"
$stderr = Join-Path $env:RUNNER_TEMP "mfbe-stderr-$stamp.txt"
if (-not $env:RUNNER_TEMP) { $stdout = Join-Path $env:TEMP "mfbe-stdout-$stamp.txt"; $stderr = Join-Path $env:TEMP "mfbe-stderr-$stamp.txt" }
$since = (Get-Date).AddSeconds(-1)

Write-Host "Starting $(if ($Shortcut) { "$Shortcut (-> $Exe)" } else { $Exe })$(if ($AsUser) { " as $AsUser" })"
if ($account) {
    $proc = Start-ProcessAsUser -Account $account -FilePath $Exe -ArgumentList "--remote-debugging-port=$Port" `
        -WorkingDirectory (Split-Path -Parent $Exe) -StandardOutput $stdout -StandardError $stderr
} elseif ($Shortcut) {
    # Through the shell, as a double-click; the argument is appended to the shortcut's own.
    $started = Start-Process -FilePath $Shortcut -ArgumentList "--remote-debugging-port=$Port" -PassThru
    # The shell's own process object is not necessarily the editor: take the first mfbe.exe
    # started from the shortcut's target (the browser process; its helpers start later).
    $proc = $null
    $findDeadline = (Get-Date).AddSeconds(30)
    while (-not $proc -and (Get-Date) -lt $findDeadline) {
        $candidates = @(Get-Process -Name mfbe -ErrorAction SilentlyContinue | ForEach-Object {
            # A helper process may end between the listing and the look-up of its start time.
            try { if ($_.Path -eq $Exe -and $_.StartTime -ge $since) { [pscustomobject]@{ Process = $_; Started = $_.StartTime } } } catch { }
        })
        $proc = ($candidates | Sort-Object Started | Select-Object -First 1).Process
        if (-not $proc) { Start-Sleep -Milliseconds 500 }
    }
    if (-not $proc) {
        if ($started -and $started.HasExited) { throw ("the shortcut's process exited early (exit code 0x{0:X8})" -f $started.ExitCode) }
        throw "no mfbe.exe was started from $Shortcut within 30 s"
    }
} else {
    $proc = Start-Process -FilePath $Exe -ArgumentList "--remote-debugging-port=$Port" -PassThru
}
try {
    $title = $null
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while (-not $title -and (Get-Date) -lt $deadline) {
        if ($proc.HasExited) { throw ("mfbe.exe exited early (exit code 0x{0:X8})" -f $proc.ExitCode) }
        try {
            $pages = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 5
            $page = $pages | Where-Object { $_.type -eq 'page' -and $_.title -like '*Maxima Fiction Book Editor' } |
                Select-Object -First 1
            if ($page) { $title = $page.title }
        } catch {
            # The DevTools endpoint is not up yet.
        }
        if (-not $title -and $Shortcut) {
            # The window takes the page's title once the interface is loaded ("<document> - Maxima
            # Fiction Book Editor"); before that it shows the bare product name.
            $proc.Refresh()
            if ($proc.MainWindowTitle -like '* - Maxima Fiction Book Editor') { $title = $proc.MainWindowTitle }
        }
        if (-not $title) { Start-Sleep -Seconds 1 }
    }
    if (-not $title) { throw "the editor interface did not appear within $TimeoutSeconds s" }
    Write-Host "Interface shown: '$title'"
    if (Test-Path -LiteralPath $cefLog) {
        $denied = Select-String -LiteralPath $cefLog -Pattern 'Sandbox cannot access executable', 'Network service crashed'
        if ($denied) {
            $denied | ForEach-Object { Write-Host $_.Line }
            throw "Chromium's sandboxed helper processes cannot read the program folder"
        }
    }
    # The editor keeps its files in the user's own folders and creates no folder elsewhere.
    $allowed = @($usersBefore) + @(Split-Path -Leaf $profileDir)
    $unexpected = @(Get-UserFolders | Where-Object { $_ -notin $allowed })
    if ($unexpected.Count -gt 0) {
        throw "folders appeared under C:\Users: $($unexpected -join ', ')"
    }
    if ($portable) {
        if (-not (Test-Path -LiteralPath (Join-Path $portableData 'cef'))) {
            throw "the portable copy did not keep its browser profile in $portableData"
        }
        $written = @($profileFolders | Where-Object { Test-Path -LiteralPath $_ })
        if ($written.Count -gt 0) { throw "the portable copy wrote into the user's profile: $($written -join ', ')" }
    } elseif (-not (Test-Path -LiteralPath $profileFolders[0])) {
        throw "the editor's data folder was not created in the user's profile ($($profileFolders[0]))"
    }
} catch {
    Show-EditorLogs $Exe $profileDir @($stdout, $stderr) $since
    throw
} finally {
    Stop-Editor $proc $Exe
}
