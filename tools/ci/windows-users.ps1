# Standard local users for the Windows CI checks, and the editor started as one of them.
# Dot-sourced by windows-start-smoke.ps1 and windows-russian-journey.ps1.

# Names of the folders directly under C:\Users.
function Get-UserFolders {
    @(Get-ChildItem -LiteralPath 'C:\Users' -Force -Directory | ForEach-Object { $_.Name })
}

# Creates the standard (non-administrator) local user $name, or gives an existing one a new
# password, and returns its credential and real profile folder.
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
    # A first logon creates the user's real profile folder. The working directory is one every
    # user can read (the job's folder may not be).
    Start-Process -FilePath "$env:WINDIR\System32\cmd.exe" -ArgumentList '/c', 'exit' -Credential $credential `
        -LoadUserProfile -WorkingDirectory $env:WINDIR -Wait
    $sid = (Get-LocalUser -Name $name).SID.Value
    $profileDir = (Get-CimInstance Win32_UserProfile | Where-Object { $_.SID -eq $sid }).LocalPath
    if (-not $profileDir) { throw "no profile folder was created for $name" }
    [pscustomobject]@{ Credential = $credential; Profile = $profileDir; Sid = $sid }
}

# Starts $FilePath as the user of New-StandardUser with the user's profile loaded. A process
# started with other credentials inherits this environment: it gets the user's own folders.
# (-WindowStyle cannot be combined with -Credential.)
function Start-ProcessAsUser {
    param(
        [Parameter(Mandatory = $true)]$Account,
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string]$ArgumentList = '',
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$StandardOutput,
        [Parameter(Mandatory = $true)][string]$StandardError,
        [switch]$Wait
    )
    $options = @{
        FilePath               = $FilePath
        Credential             = $Account.Credential
        LoadUserProfile        = $true
        WorkingDirectory       = $WorkingDirectory
        RedirectStandardOutput = $StandardOutput
        RedirectStandardError  = $StandardError
        PassThru               = $true
        Wait                   = $Wait
    }
    if ($ArgumentList) { $options.ArgumentList = $ArgumentList }
    $saved = @{}
    $environment = @{
        USERPROFILE  = $Account.Profile
        APPDATA      = Join-Path $Account.Profile 'AppData\Roaming'
        LOCALAPPDATA = Join-Path $Account.Profile 'AppData\Local'
        TEMP         = Join-Path $Account.Profile 'AppData\Local\Temp'
        TMP          = Join-Path $Account.Profile 'AppData\Local\Temp'
    }
    foreach ($key in $environment.Keys) {
        $saved[$key] = [Environment]::GetEnvironmentVariable($key)
        [Environment]::SetEnvironmentVariable($key, $environment[$key])
    }
    try {
        Start-Process @options
    } finally {
        foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key]) }
    }
}

# Prints the Windows Error Reporting events about the editor since $Since, then the last lines of
# the $Outputs files, of a debug.log next to the program and of the editor's logs in the profile
# and in a portable copy's `user` folder.
function Show-EditorLogs([string]$Exe, [string]$ProfileDir, [string[]]$Outputs, [datetime]$Since) {
    Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $Since } -ErrorAction SilentlyContinue |
        Where-Object { $_.Id -in 1000, 1001, 1026 -and $_.Message -match 'mfbe' } |
        ForEach-Object { Write-Host ("Windows Error Reporting {0}: {1}" -f $_.Id, ($_.Message -replace "`r?`n", ' | ')) }
    $logs = @($Outputs) + (Join-Path (Split-Path -Parent $Exe) 'debug.log')
    $folders = @('AppData\Local', 'AppData\Roaming') | ForEach-Object { Join-Path $ProfileDir "$_\Maxima Fiction Book Editor" }
    foreach ($folder in @($folders) + (Join-Path (Split-Path -Parent $Exe) 'user')) {
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

# Ends the editor started as $Process with all its processes, then waits until no process runs
# from the program's folder: taskkill only requests the end, and the folder's files must be
# released (uninstall, deleting the folder).
function Stop-Editor([System.Diagnostics.Process]$Process, [string]$Exe) {
    & taskkill.exe /PID $Process.Id /T /F 2>&1 | Out-Null
    # The editor may have ended on its own (File > Exit): taskkill's failure is not the caller's.
    $global:LASTEXITCODE = 0
    $folder = Split-Path -Parent $Exe
    $stopDeadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $stopDeadline -and
           (Get-Process -IncludeUserName -ErrorAction SilentlyContinue |
               Where-Object { $_.Path -and $_.Path.StartsWith($folder, [StringComparison]::OrdinalIgnoreCase) })) {
        Start-Sleep -Milliseconds 500
    }
}
