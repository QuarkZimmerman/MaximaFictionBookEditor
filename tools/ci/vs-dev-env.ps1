# Feature 013 (FR-005; contracts/internal.md section 2): the Microsoft C++ compiler's environment for the
# steps that follow, without Node.js - the job ilammy/msvc-dev-cmd@v1 did, a Node.js 20 action with no
# newer release. Finds Visual Studio with vswhere (preinstalled on GitHub's Windows images), runs its
# VsDevCmd.bat for 64-bit, and hands every variable it set or changed to the following steps: through
# $GITHUB_ENV, and the new PATH entries through $GITHUB_PATH.
param([ValidateSet('x64')][string]$Arch = 'x64')
$ErrorActionPreference = 'Stop'

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere)) { throw "vswhere.exe not found at $vswhere" }
$vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if ($LASTEXITCODE -ne 0 -or -not $vs) { throw 'no Visual Studio with the C++ x64 tools' }
$devCmd = Join-Path $vs 'Common7\Tools\VsDevCmd.bat'
if (-not (Test-Path $devCmd)) { throw "VsDevCmd.bat not found at $devCmd" }

# The environment before, and the one VsDevCmd.bat leaves (`set` prints NAME=value lines). PowerShell's
# hashtables compare names without regard to case, as Windows does (Path, PATH).
$before = @{}
foreach ($item in Get-ChildItem env:) { $before[$item.Name] = $item.Value }
$output = & cmd.exe /d /s /c "`"$devCmd`" -arch=amd64 -host_arch=amd64 -no_logo >nul && set"
if ($LASTEXITCODE -ne 0) { throw "VsDevCmd.bat failed (exit $LASTEXITCODE)" }
$after = @{}
foreach ($line in $output) {
  $i = $line.IndexOf('=')
  if ($i -gt 0) { $after[$line.Substring(0, $i)] = $line.Substring($i + 1) }
}
if (-not $after.ContainsKey('VCToolsInstallDir')) { throw 'VsDevCmd.bat set no compiler environment' }

# Every new or changed variable but PATH, in the multi-line form (a value may hold any character).
$delimiter = "MFBE_ENV_$([guid]::NewGuid().ToString('N'))"
$envLines = [System.Collections.Generic.List[string]]::new()
foreach ($name in $after.Keys) {
  if ($name -ieq 'Path') { continue }
  if ($before.ContainsKey($name) -and $before[$name] -ceq $after[$name]) { continue }
  $envLines.Add("$name<<$delimiter")
  $envLines.Add($after[$name])
  $envLines.Add($delimiter)
}
# The PATH entries VsDevCmd.bat added. $GITHUB_PATH puts each line it reads in front of the ones read
# before it, so they are written last first and keep VsDevCmd's order, all ahead of the old PATH.
$oldPath = @(($before['Path'] -split ';') | Where-Object { $_ })
$newEntries = @(($after['Path'] -split ';') | Where-Object { $_ -and ($oldPath -notcontains $_) })
[array]::Reverse($newEntries)

Add-Content -Path $env:GITHUB_ENV -Value $envLines -Encoding utf8
Add-Content -Path $env:GITHUB_PATH -Value $newEntries -Encoding utf8
Write-Output ("vs-dev-env: Visual Studio at $vs; {0} variables set or changed, {1} PATH entries added" -f ($envLines.Count / 3), $newEntries.Count)
