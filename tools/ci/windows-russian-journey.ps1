# Russian-environment journey of the Windows editor (feature 002). A standard user with a Cyrillic
# name, Russian regional formats and Russian display language starts the editor with a book whose
# name and folder have Cyrillic letters as the command-line argument, as Explorer starts it for an
# opened book. The release build has no test hooks: the run uses the command line, the DevTools
# protocol (cdp-client.ps1) and files only, and fails unless
#   - the window title shows the book's name and the interface is Russian (the editor takes its
#     language from the user's regional format, GetUserDefaultLocaleName);
#   - Save (F2, the original editor's key; Ctrl+S has no command) rewrites the book in place;
#   - View > Status Bar, chosen with the Russian accelerators (Alt+В, С), hides the status bar and
#     settings.json records it;
#   - File > Exit (F10, Down, В) ends the editor with exit code 0, and after a restart the status
#     bar is still hidden;
#   - "Restart now?" restarts the editor (feature 003 US3): after the interface language is
#     switched to English in Settings and Yes answered, the editor ends with exit code 0 and a new
#     mfbe.exe process - started with --wait-for-exit <old pid>, --window-geometry and the book -
#     comes up with the book open and the interface English; File > Exit (F10, Down, X) ends it;
#   - recent.json lists the book's path byte for byte in UTF-8;
#   - no folder appeared under C:\Users or C:\ or next to the book, the installed copy wrote
#     nothing into its program folder (a portable copy may write into its own), and the profile
#     holds no folder of the editor's other than the installed copy's two in AppData.
#
# -Exe runs an installed copy, which keeps settings.json and recent.json in the user's profile;
# -Zip unpacks the portable ZIP into the user's Downloads folder and runs that copy, which keeps
# all of its data in its `user` folder. Each call starts without editor data in the profile, as
# at a first start.
param(
    [string]$Exe = '',
    [string]$Zip = '',
    [string]$Book = 'tests/fixtures/books/modern-utf8.fb2',
    [int]$TimeoutSeconds = 120
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-users.ps1')
. (Join-Path $PSScriptRoot 'cdp-client.ps1')

if ([string]::IsNullOrEmpty($Exe) -eq [string]::IsNullOrEmpty($Zip)) { throw 'give either -Exe or -Zip' }

function Text([int[]]$Codes) { -join [char[]]$Codes }

# "Читатель" (reader), "Мои книги" (my books), "Современная книга" (the fixture's book title).
$userName = Text 0x0427, 0x0438, 0x0442, 0x0430, 0x0442, 0x0435, 0x043B, 0x044C
$booksFolderName = Text 0x041C, 0x043E, 0x0438, 0x0020, 0x043A, 0x043D, 0x0438, 0x0433, 0x0438
$bookTitle = (Text 0x0421, 0x043E, 0x0432, 0x0440, 0x0435, 0x043C, 0x0435, 0x043D, 0x043D, 0x0430, 0x044F) + ' ' +
    (Text 0x043A, 0x043D, 0x0438, 0x0433, 0x0430)
$bookName = "$bookTitle.fb2"
$appName = 'Maxima Fiction Book Editor'
# Keys of the Russian keyboard layout that type the interface's accelerators (ui/src/i18n/ru.json):
# В of "&Вид" (View) and "&Выход" (File > Exit), С of "&Строка состояния" (View > Status Bar).
$keyVe = @{ key = (Text 0x0432); code = 'KeyD'; windowsVirtualKeyCode = 0x44 }
$keyEs = @{ key = (Text 0x0441); code = 'KeyC'; windowsVirtualKeyCode = 0x43 }
# X of "E&xit" (File > Exit) in the English interface (ui/src/i18n/en.json), after the restart.
$keyX = @{ key = 'x'; code = 'KeyX'; windowsVirtualKeyCode = 0x58 }
$keyF2 = @{ key = 'F2'; code = 'F2'; windowsVirtualKeyCode = 0x71 }
$keyF10 = @{ key = 'F10'; code = 'F10'; windowsVirtualKeyCode = 0x79 }
$keyDown = @{ key = 'ArrowDown'; code = 'ArrowDown'; windowsVirtualKeyCode = 0x28 }
$temp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$script:cdp = $null
$script:editor = $null

# What the page shows when a wait gives up: open dialogs, the focused element, the status text.
function Describe-Page {
    try {
        Get-CdpValue $script:cdp @'
(() => { const ids = [...document.querySelectorAll('[data-testid^="dialog-"][role="dialog"], [role="dialog"], [role="alertdialog"]')].map((d) => d.getAttribute('data-testid') + ': ' + (d.textContent || '').trim().slice(0, 160)); return 'dialogs: ' + JSON.stringify(ids) + '; active: ' + (document.activeElement && (document.activeElement.getAttribute('data-testid') || document.activeElement.tagName)) + '; status: ' + ((document.querySelector('[data-testid="status-message"]') || {}).textContent || '') + '; lang: ' + document.documentElement.lang; })()
'@
    } catch { "page not reachable: $($_.Exception.Message)" }
}

# Polls $Condition until it returns true. Fails after $Seconds, naming the last error the
# condition raised, and at once when the editor has ended.
function Wait-Until([string]$What, [scriptblock]$Condition, [int]$Seconds = 30) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    $lastError = ''
    while ($true) {
        try {
            if (& $Condition) { return }
        } catch {
            $lastError = " ($($_.Exception.Message))"
        }
        if ($script:editor -and $script:editor.HasExited) {
            throw ('the editor ended (exit code 0x{0:X8}) while waiting for {1}' -f $script:editor.ExitCode, $What)
        }
        if ((Get-Date) -gt $deadline) {
            Write-Host "journey: $(Describe-Page)"
            throw "timed out after $Seconds s waiting for $What$lastError"
        }
        Start-Sleep -Milliseconds 250
    }
}

function Test-Element([string]$TestId) {
    [bool](Get-CdpValue $script:cdp "!!document.querySelector('[data-testid=`"$TestId`"]')")
}

function Get-FocusedTestId {
    Get-CdpValue $script:cdp 'document.activeElement && document.activeElement.getAttribute("data-testid")'
}

# Parsed JSON file, or nothing while it is missing.
function Read-Json([string]$Path) {
    if (Test-Path -LiteralPath $Path) { Get-Content -LiteralPath $Path -Raw -Encoding utf8 | ConvertFrom-Json }
}

# True when $Data holds $Part byte for byte.
function Test-Bytes([byte[]]$Data, [byte[]]$Part) {
    $latin1 = [Text.Encoding]::Latin1
    $latin1.GetString($Data).Contains($latin1.GetString($Part), [StringComparison]::Ordinal)
}

# Paths below $Folder, relative to it.
function Get-Entries([string]$Folder, [switch]$Recurse) {
    @(Get-ChildItem -LiteralPath $Folder -Force -Recurse:$Recurse | ForEach-Object { $_.FullName.Substring($Folder.Length) })
}

# A free loopback port for the editor's DevTools endpoint: each start gets its own, as a port the
# previous editor closed may still be held.
function Get-FreePort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { $listener.LocalEndpoint.Port } finally { $listener.Stop() }
}

# Russian display language and regional format for the user, set as the user (both live in the
# user's own registry), each in a logon of its own, then shown by a new process of the user. The
# display language override comes first: changing the user's language list can put the regional
# format back. The regional format is set with Set-Culture and, where that leaves the user's
# setting unchanged, written where Windows keeps it (Control Panel\International: LocaleName,
# Locale). The display language takes effect only where Windows has the Russian language pack;
# the editor does not read it.
function Set-RussianEnvironment {
    $powershell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $commands = @(
        @'
try { Set-WinUILanguageOverride -Language ru-RU } catch { "Set-WinUILanguageOverride: $($_.Exception.Message)" }
'@,
        @'
$key = 'HKCU:\Control Panel\International'
"regional format at logon: $((Get-ItemProperty $key).LocaleName)"
Set-Culture ru-RU
"regional format after Set-Culture: $((Get-ItemProperty $key).LocaleName)"
if ((Get-ItemProperty $key).LocaleName -ne 'ru-RU') {
    Set-ItemProperty $key -Name LocaleName -Value 'ru-RU'
    Set-ItemProperty $key -Name Locale -Value '00000419'
    "regional format written into the registry: $((Get-ItemProperty $key).LocaleName)"
}
'@,
        @'
"regional format $((Get-Culture).Name) (registry $((Get-ItemProperty 'HKCU:\Control Panel\International').LocaleName)), display language override $(Get-WinUILanguageOverride)"
if ((Get-Culture).Name -ne 'ru-RU') { exit 3 }
'@
    )
    # Each step runs from a script file in the user's temporary folder: a command line started with
    # other credentials holds at most 1024 characters.
    $userTemp = Join-Path $account.Profile 'AppData\Local\Temp'
    New-Item -ItemType Directory -Force -Path $userTemp | Out-Null
    foreach ($command in $commands) {
        $stamp = Get-Date -Format 'HHmmssfff'
        $script = Join-Path $userTemp "mfbe-journey-$stamp.ps1"
        Set-Content -LiteralPath $script -Encoding utf8BOM `
            -Value "`$ErrorActionPreference = 'Stop'; `$ProgressPreference = 'SilentlyContinue'`n$command"
        $outputs = @((Join-Path $temp "mfbe-journey-culture-$stamp-out.txt"), (Join-Path $temp "mfbe-journey-culture-$stamp-err.txt"))
        try {
            $shell = Start-ProcessAsUser -Account $account -FilePath $powershell `
                -ArgumentList "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$script`"" `
                -WorkingDirectory $account.Profile -StandardOutput $outputs[0] -StandardError $outputs[1] -Wait
        } finally {
            Remove-Item -LiteralPath $script -Force -ErrorAction SilentlyContinue
        }
        Get-Content -LiteralPath $outputs | ForEach-Object { Write-Host "  $_" }
        if ($shell.ExitCode -eq 3) { throw "a new process of $userName does not have the ru-RU regional format" }
        if ($shell.ExitCode -ne 0) { throw "Windows PowerShell as $userName ended with exit code $($shell.ExitCode)" }
    }
}

# The interface is Russian: the shell handed Chromium the Russian locale (navigator.languages) and
# the interface chose Russian (<html lang>).
function Assert-RussianInterface {
    try {
        Wait-Until 'the Russian interface' {
            Get-CdpValue $script:cdp 'navigator.languages[0] === "ru" && document.documentElement.lang === "ru"'
        } 15
    } catch {
        $reason = $_
        try {
            $found = Get-CdpValue $script:cdp '"navigator.languages " + navigator.languages.join(",") + ", <html lang> " + document.documentElement.lang'
        } catch {
            throw $reason
        }
        throw "the interface is not Russian ($found); the editor follows the user's regional format (Set-Culture)"
    }
}

# On a failure: the DevTools targets (a native message box is a page of its own), the dialogs open
# in the page and the focused element.
function Show-PageState([int]$Port) {
    try {
        $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 5
        $targets | ForEach-Object { Write-Host "DevTools target: $($_.type) '$($_.title)'" }
    } catch {
        Write-Host 'DevTools targets: none'
    }
    try {
        Write-Host "Page title: $(Get-CdpValue $script:cdp 'document.title')"
        Write-Host "Open dialogs: $(Get-CdpValue $script:cdp 'Array.from(document.querySelectorAll("[role=dialog]"), (e) => e.getAttribute("data-testid")).join(", ")')"
        Write-Host "Focused: $(Get-FocusedTestId)"
    } catch {
        Write-Host "Page: unavailable ($($_.Exception.Message))"
    }
}

# Starts the editor as the user with its DevTools port and $Arguments, connects to its page and
# runs $Steps; on a failure prints the page's state and the editor's logs; ends the editor in any
# case.
function Invoke-EditorRun([string]$Label, [string]$Arguments, [scriptblock]$Steps) {
    $port = Get-FreePort
    $script:port = $port  # the restart step reconnects to the same port (the new instance keeps it)
    $stamp = Get-Date -Format 'HHmmssfff'
    $stdout = Join-Path $temp "mfbe-journey-stdout-$stamp.txt"
    $stderr = Join-Path $temp "mfbe-journey-stderr-$stamp.txt"
    $commandLine = "--remote-debugging-port=$port"
    if ($Arguments) { $commandLine += " $Arguments" }
    $since = (Get-Date).AddSeconds(-1)
    Write-Host "${Label}: $Exe $commandLine"
    $script:editor = Start-ProcessAsUser -Account $account -FilePath $Exe -ArgumentList $commandLine `
        -WorkingDirectory (Split-Path -Parent $Exe) -StandardOutput $stdout -StandardError $stderr
    try {
        $script:cdp = Connect-CdpPage -Port $port -Process $script:editor -TimeoutSeconds $TimeoutSeconds
        try {
            # Keys reach the focused element as in the active window, whatever has the desktop's focus.
            $null = Invoke-Cdp $script:cdp 'Emulation.setFocusEmulationEnabled' @{ enabled = $true }
        } catch {
            Write-Host "Focus emulation unavailable: $($_.Exception.Message)"
        }
        & $Steps
    } catch {
        Show-PageState $port
        Show-EditorLogs $Exe $profileDir @($stdout, $stderr) $since
        throw
    } finally {
        Disconnect-Cdp $script:cdp
        $script:cdp = $null
        Stop-Editor $script:editor $Exe
    }
}

# File > Exit from the keyboard: F10 focuses the menu bar (File first), Down opens File, $ExitKey
# (В in the Russian interface, X in the English one) picks Exit. The editor ends on its own, with
# exit code 0.
function Exit-Editor([hashtable]$ExitKey = $keyVe) {
    Send-CdpKey $script:cdp $keyF10
    Wait-Until 'File focused in the menu bar' {
        (Get-CdpValue $script:cdp 'document.activeElement && document.activeElement.getAttribute("data-menu-id")') -ceq 'file'
    }
    Send-CdpKey $script:cdp $keyDown
    Wait-Until 'the File menu open' { (Get-FocusedTestId) -ceq 'menu-file-popup' }
    try {
        Send-CdpKey $script:cdp $ExitKey
    } catch {
        # The window closes while the key is handled: the connection may end before the answer.
        Write-Host "DevTools connection ended with the window: $($_.Exception.Message)"
    }
    if (-not $script:editor.WaitForExit(60000)) { throw 'the editor did not end after File > Exit' }
    if ($script:editor.ExitCode -ne 0) {
        throw ('the editor ended with exit code 0x{0:X8} after File > Exit' -f $script:editor.ExitCode)
    }
}

# Clicks the element with $TestId in the page (menus and dialogs of the interface react to clicks
# as to the mouse).
function Click-Element([string]$TestId) {
    Wait-Until "the element $TestId" { Test-Element $TestId }
    $null = Get-CdpValue $script:cdp "document.querySelector('[data-testid=`"$TestId`"]').click(); true"
}

# Menu bar buttons open their menu on mouse-down (a synthetic click() alone does nothing).
function Press-Element([string]$TestId) {
    Wait-Until "the element $TestId" { Test-Element $TestId }
    $null = Get-CdpValue $script:cdp @"
(() => { const el = document.querySelector('[data-testid="$TestId"]'); for (const type of ['mousedown', 'mouseup', 'click']) { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 })); } return true; })()
"@
}


# "Restart now?" restarts the editor (feature 003 US3, FR-020 to FR-022): Settings > View >
# Language = English, OK, Yes. The running editor ends with exit code 0, and the new process it
# started - mfbe.exe with --wait-for-exit <old pid>, --window-geometry and the book as FILE, never
# --lang - becomes the editor of this run: $script:editor and $script:cdp move over to it, and it
# must show the book with the interface in English.
function Restart-EditorThroughSettings {
    $oldPid = $script:editor.Id
    Wait-Until 'the menu bar' { Test-Element 'menu-tools' }
    Write-Host "journey: before Tools > Settings: $(Describe-Page)"
    Press-Element 'menu-tools'
    Wait-Until 'the Tools menu open' { Test-Element 'menu-tools-settings' }
    Click-Element 'menu-tools-settings'
    Wait-Until 'the Settings dialog' { Test-Element 'dialog-settings' }
    $null = Get-CdpValue $script:cdp @'
(() => { const select = document.querySelector('[data-testid="settings-view-language"]'); select.value = 'en'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()
'@
    Wait-Until 'English chosen in the language list' {
        (Get-CdpValue $script:cdp 'document.querySelector(''[data-testid="settings-view-language"]'').value') -ceq 'en'
    }
    Click-Element 'dialog-settings-button-ok'
    Wait-Until 'the restart prompt' { Test-Element 'dialog-restart-prompt-button-yes' }
    try {
        Click-Element 'dialog-restart-prompt-button-yes'
    } catch {
        # The editor quits while the click is handled: the connection may end before the answer.
        Write-Host "DevTools connection ended with the restart: $($_.Exception.Message)"
    }
    if (-not $script:editor.WaitForExit(60000)) { throw 'the editor did not end after "Restart now?"' }
    if ($script:editor.ExitCode -ne 0) {
        throw ('the editor ended with exit code 0x{0:X8} after "Restart now?"' -f $script:editor.ExitCode)
    }
    Disconnect-Cdp $script:cdp
    $script:cdp = $null
    $script:editor = $null

    # The new instance: the mfbe.exe started with --wait-for-exit <old pid> (Chromium's helper
    # processes are mfbe.exe too, with --type=...).
    $findStarted = {
        Get-CimInstance Win32_Process -Filter "Name = 'mfbe.exe'" |
            Where-Object { $_.CommandLine -like "*--wait-for-exit $oldPid*" -and $_.CommandLine -notlike '*--type=*' } |
            Select-Object -First 1
    }
    Wait-Until "the restarted editor (--wait-for-exit $oldPid)" { [bool](& $findStarted) } 30
    $started = & $findStarted
    Write-Host "Restarted editor: pid $($started.ProcessId): $($started.CommandLine)"
    if ($started.CommandLine -notlike '*--window-geometry *') { throw 'the restarted editor got no --window-geometry' }
    if ($started.CommandLine -notlike "*$bookName*") { throw 'the restarted editor was not given the book' }
    if ($started.CommandLine -like '*--lang*') { throw 'the restarted editor must not inherit --lang' }
    $script:editor = Get-Process -Id $started.ProcessId
    $script:cdp = Connect-CdpPage -Port $script:port -Process $script:editor -TimeoutSeconds $TimeoutSeconds
    try {
        $null = Invoke-Cdp $script:cdp 'Emulation.setFocusEmulationEnabled' @{ enabled = $true }
    } catch {
        Write-Host "Focus emulation unavailable: $($_.Exception.Message)"
    }
    $title = "$bookName - $appName"
    Wait-Until "the window title '$title' after the restart" { (Get-CdpValue $script:cdp 'document.title') -ceq $title } $TimeoutSeconds
    Wait-Until 'the English interface after the restart' {
        (Get-CdpValue $script:cdp 'document.documentElement.lang') -ceq 'en'
    } 15
}

$usersBefore = Get-UserFolders
$rootBefore = @(Get-ChildItem -LiteralPath 'C:\' -Force -Directory | ForEach-Object { $_.Name })
Write-Host "Preparing the standard user '$userName' with Russian regional formats and display language"
$account = New-StandardUser $userName
$profileDir = $account.Profile
Write-Host "Profile folder: $profileDir"
Set-RussianEnvironment

$profileFolders = @((Join-Path $profileDir "AppData\Roaming\$appName"), (Join-Path $profileDir "AppData\Local\$appName"))
foreach ($folder in $profileFolders) {
    if (Test-Path -LiteralPath $folder) { Remove-Item -LiteralPath $folder -Recurse -Force }
}
if ($Zip) {
    # Unpacked into the user's Downloads folder, like a copy the user downloaded.
    $unpacked = Join-Path $profileDir 'Downloads\mfbe-portable'
    if (Test-Path -LiteralPath $unpacked) { Remove-Item -LiteralPath $unpacked -Recurse -Force }
    Expand-Archive -LiteralPath $Zip -DestinationPath $unpacked
    $Exe = (Get-ChildItem -LiteralPath $unpacked -Recurse -Filter mfbe.exe | Select-Object -First 1).FullName
    if (-not $Exe) { throw "bin\mfbe.exe not found in $Zip" }
}
# The installed copy's program folder, which it never writes to.
$programFolder = if (-not $Zip) { Split-Path -Parent (Split-Path -Parent $Exe) }
# Where the copy keeps settings.json and recent.json.
$dataFolder = if ($Zip) { Join-Path (Split-Path -Parent $Exe) 'user' } else { $profileFolders[0] }

$booksFolder = Join-Path $profileDir "Documents\$booksFolderName"
if (Test-Path -LiteralPath $booksFolder) { Remove-Item -LiteralPath $booksFolder -Recurse -Force }
New-Item -ItemType Directory -Path $booksFolder | Out-Null
$bookPath = Join-Path $booksFolder $bookName
Copy-Item -LiteralPath $Book -Destination $bookPath
# A modification time in the past: Save must write the book anew.
$planted = [datetime]::new(2001, 1, 1, 0, 0, 0, [DateTimeKind]::Utc)
(Get-Item -LiteralPath $bookPath).LastWriteTimeUtc = $planted
$documentsFolder = Split-Path -Parent $booksFolder
$documentsBefore = Get-Entries $documentsFolder
$programBefore = @(if ($programFolder) { Get-Entries $programFolder -Recurse })
$settingsFile = Join-Path $dataFolder 'settings.json'
$recentFile = Join-Path $dataFolder 'recent.json'

Invoke-EditorRun 'Start with the book' "`"$bookPath`"" {
    $title = "$bookName - $appName"
    Wait-Until "the window title '$title'" { (Get-CdpValue $script:cdp 'document.title') -ceq $title } $TimeoutSeconds
    Assert-RussianInterface
    Wait-Until 'the status bar' { Test-Element 'statusbar' }

    Send-CdpKey $script:cdp $keyF2
    Wait-Until 'the book saved in place' { (Get-Item -LiteralPath $bookPath).LastWriteTimeUtc -gt $planted }
    if (-not (Test-Bytes ([IO.File]::ReadAllBytes($bookPath)) ([Text.Encoding]::UTF8.GetBytes($bookTitle)))) {
        throw 'the saved book does not hold its title in UTF-8'
    }

    Send-CdpKey $script:cdp $keyVe -Modifiers 1
    Wait-Until 'the View menu open with Status Bar checked' {
        (Get-FocusedTestId) -ceq 'menu-view-popup' -and
        (Get-CdpValue $script:cdp 'document.querySelector(''[data-testid="menu-view-statusBar"]'').getAttribute("aria-checked")') -ceq 'true'
    }
    Send-CdpKey $script:cdp $keyEs
    Wait-Until 'the status bar hidden' { -not (Test-Element 'statusbar') }
    Wait-Until 'the hidden status bar in settings.json' { (Read-Json $settingsFile).session.toolbars.status -eq $false }

    Exit-Editor
}

Invoke-EditorRun 'Restart' '' {
    Wait-Until 'the editor window' { (Get-CdpValue $script:cdp 'document.title') -clike "* - $appName" } $TimeoutSeconds
    Assert-RussianInterface
    Wait-Until 'the status bar hidden after the restart' { -not (Test-Element 'statusbar') }
    Exit-Editor
}

# "Restart now?" (feature 003 US3): the editor restarts itself with the book, in English.
Invoke-EditorRun 'Language change and restart' "`"$bookPath`"" {
    $title = "$bookName - $appName"
    Wait-Until "the window title '$title'" { (Get-CdpValue $script:cdp 'document.title') -ceq $title } $TimeoutSeconds
    Assert-RussianInterface
    Restart-EditorThroughSettings
    Wait-Until 'the status bar still hidden after the restart' { -not (Test-Element 'statusbar') }
    Exit-Editor $keyX
}

if ((Read-Json $settingsFile).session.toolbars.status -ne $false) {
    throw "settings.json does not hold the hidden status bar ($settingsFile)"
}
if ((Read-Json $settingsFile).view.uiLanguage -cne 'en') {
    throw "settings.json does not hold the English interface language chosen before the restart ($settingsFile)"
}
# The shell records the window placement at quit (feature 003 US3, data-model §4).
$placement = (Read-Json $settingsFile).session.windowGeometry
if (-not $placement -or $placement.width -le 0 -or $placement.height -le 0) {
    throw "settings.json does not hold the window placement ($settingsFile)"
}
$recent = Read-Json $recentFile
$first = if ($recent) { @($recent.items)[0].path }
if ($first -cne $bookPath) { throw "recent.json lists '$first' first, not the book '$bookPath'" }
# Byte for byte: the path in UTF-8 as a JSON string (backslashes escaped), not as \u escapes or in
# a legacy code page.
$quotedPath = '"' + $bookPath.Replace('\', '\\') + '"'
if (-not (Test-Bytes ([IO.File]::ReadAllBytes($recentFile)) ([Text.Encoding]::UTF8.GetBytes($quotedPath)))) {
    throw "recent.json does not hold the book's path in UTF-8 ($recentFile)"
}

$allowed = @($usersBefore) + (Split-Path -Leaf $profileDir)
$unexpected = @(Get-UserFolders | Where-Object { $_ -notin $allowed })
if ($unexpected.Count -gt 0) { throw "folders appeared under C:\Users: $($unexpected -join ', ')" }
$unexpected = @(Get-ChildItem -LiteralPath 'C:\' -Force -Directory | ForEach-Object { $_.Name } |
    Where-Object { $_ -notin $rootBefore })
if ($unexpected.Count -gt 0) { throw "folders appeared under C:\: $($unexpected -join ', ')" }
$unexpected = @(Get-Entries $documentsFolder | Where-Object { $_ -notin $documentsBefore })
if ($unexpected.Count -gt 0) { throw "entries appeared next to the book's folder: $($unexpected -join ', ')" }
$inBooks = @(Get-Entries $booksFolder)
if ($inBooks.Count -ne 1 -or $inBooks[0] -cne "\$bookName") { throw "the book's folder holds: $($inBooks -join ', ')" }
if ($programFolder) {
    $unexpected = @(Get-Entries $programFolder -Recurse | Where-Object { $_ -notin $programBefore })
    if ($unexpected.Count -gt 0) { throw "the installed editor wrote into its program folder: $($unexpected -join ', ')" }
}
$allowedFolders = if ($Zip) { @() } else { $profileFolders }
$unexpected = @(Get-ChildItem -LiteralPath $profileDir -Recurse -Force -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq $appName -and $_.FullName -notin $allowedFolders } |
    ForEach-Object { $_.FullName })
if ($unexpected.Count -gt 0) { throw "folders of the editor's outside AppData: $($unexpected -join ', ')" }

Write-Host "Journey passed for $Exe as $userName"
