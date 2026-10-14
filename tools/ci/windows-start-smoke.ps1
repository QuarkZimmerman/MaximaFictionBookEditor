# Starts the Windows editor (installed or unpacked) and waits until its window shows the editor
# interface, read over the DevTools protocol (page title), then stops it with all its processes.
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
param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [string]$AsUser = '',
    [int]$TimeoutSeconds = 120,
    [int]$Port = 9333
)
$ErrorActionPreference = 'Stop'

function Get-UserFolders {
    @(Get-ChildItem -LiteralPath 'C:\Users' -Force -Directory | ForEach-Object { $_.Name })
}

function New-StandardUser([string]$name) {
    $secret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 20 | ForEach-Object { [char]$_ }) + '!a1'
    $password = ConvertTo-SecureString $secret -AsPlainText -Force
    if (Get-LocalUser -Name $name -ErrorAction SilentlyContinue) {
        Set-LocalUser -Name $name -Password $password
    } else {
        New-LocalUser -Name $name -Password $password -PasswordNeverExpires | Out-Null
    }
    Add-LocalGroupMember -Group 'Users' -Member $name -ErrorAction SilentlyContinue
    $credential = New-Object System.Management.Automation.PSCredential(".\$name", $password)
    # A first logon creates the user's real profile folder.
    Start-Process -FilePath "$env:WINDIR\System32\cmd.exe" -ArgumentList '/c', 'exit' -Credential $credential `
        -LoadUserProfile -Wait
    $sid = (Get-LocalUser -Name $name).SID.Value
    $profileDir = (Get-CimInstance Win32_UserProfile | Where-Object { $_.SID -eq $sid }).LocalPath
    if (-not $profileDir) { throw "no profile folder was created for $name" }
    [pscustomobject]@{ Credential = $credential; Profile = $profileDir; Sid = $sid }
}

function Show-Logs([string]$profileDir, [string]$stdout, [string]$stderr, [datetime]$since) {
    Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $since } -ErrorAction SilentlyContinue |
        Where-Object { $_.Id -in 1000, 1001, 1026 -and $_.Message -match 'mfbe' } |
        ForEach-Object { Write-Host ("Windows Error Reporting {0}: {1}" -f $_.Id, ($_.Message -replace "`r?`n", ' | ')) }
    $logs = @($stdout, $stderr, (Join-Path (Split-Path -Parent $Exe) 'debug.log'))
    foreach ($base in @('AppData\Local', 'AppData\Roaming')) {
        $folder = Join-Path $profileDir "$base\Maxima Fiction Book Editor"
        if (Test-Path -LiteralPath $folder) {
            $logs += @(Get-ChildItem -LiteralPath $folder -Recurse -Filter '*.log' -ErrorAction SilentlyContinue |
                ForEach-Object { $_.FullName })
        }
    }
    foreach ($log in $logs) {
        if ($log -and (Test-Path -LiteralPath $log)) {
            Write-Host "----- $log (last 40 lines) -----"
            Get-Content -LiteralPath $log -Tail 40 | ForEach-Object { Write-Host "    $_" }
        }
    }
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
$cefLog = Join-Path $profileDir 'AppData\Local\Maxima Fiction Book Editor\logs\cef-debug.log'
Remove-Item -LiteralPath $cefLog -Force -ErrorAction SilentlyContinue
$stamp = Get-Date -Format 'HHmmss'
$stdout = Join-Path $env:RUNNER_TEMP "mfbe-stdout-$stamp.txt"
$stderr = Join-Path $env:RUNNER_TEMP "mfbe-stderr-$stamp.txt"
if (-not $env:RUNNER_TEMP) { $stdout = Join-Path $env:TEMP "mfbe-stdout-$stamp.txt"; $stderr = Join-Path $env:TEMP "mfbe-stderr-$stamp.txt" }
$since = (Get-Date).AddSeconds(-1)

Write-Host "Starting $Exe$(if ($AsUser) { " as $AsUser" })"
if ($account) {
    # A process started with other credentials inherits this environment: give it the user's
    # own folders. (-WindowStyle cannot be combined with -Credential.)
    $saved = @{}
    $environment = @{
        USERPROFILE  = $profileDir
        APPDATA      = Join-Path $profileDir 'AppData\Roaming'
        LOCALAPPDATA = Join-Path $profileDir 'AppData\Local'
        TEMP         = Join-Path $profileDir 'AppData\Local\Temp'
        TMP          = Join-Path $profileDir 'AppData\Local\Temp'
    }
    foreach ($key in $environment.Keys) {
        $saved[$key] = [Environment]::GetEnvironmentVariable($key)
        [Environment]::SetEnvironmentVariable($key, $environment[$key])
    }
    try {
        $proc = Start-Process -FilePath $Exe -ArgumentList "--remote-debugging-port=$Port" `
            -Credential $account.Credential -LoadUserProfile -WorkingDirectory (Split-Path -Parent $Exe) `
            -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    } finally {
        foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key]) }
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
    $dataFolder = Join-Path $profileDir 'AppData\Roaming\Maxima Fiction Book Editor'
    if (-not (Test-Path -LiteralPath $dataFolder)) {
        throw "the editor's data folder was not created in the user's profile ($dataFolder)"
    }
} catch {
    Show-Logs $profileDir $stdout $stderr $since
    throw
} finally {
    & taskkill.exe /PID $proc.Id /T /F 2>&1 | Out-Null
    # taskkill only requests the end: wait until no process runs from the editor's folder, so its
    # files are released (uninstall, deleting the folder).
    $folder = Split-Path -Parent $Exe
    $stopDeadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $stopDeadline -and
           (Get-Process -IncludeUserName -ErrorAction SilentlyContinue |
               Where-Object { $_.Path -and $_.Path.StartsWith($folder, [StringComparison]::OrdinalIgnoreCase) })) {
        Start-Sleep -Milliseconds 500
    }
}
