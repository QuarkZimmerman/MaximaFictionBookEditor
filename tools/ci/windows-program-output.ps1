# Prints what the windowed mfbe.exe writes for its command-line arguments (default --version),
# for the package smokes of the CI and release workflows (feature 006: `mfbe --version` names the
# version label and the build id).
#
# Started from a console, mfbe.exe attaches to that console and writes there
# (attachParentConsole, app/src/main.cpp). A workflow step's console has no window and is not
# part of the log, so `& mfbe.exe --version` shows nothing in a step and its output cannot be
# captured. pythonw.exe has no console at all: a program it starts finds no console to attach
# to and keeps the output pipe it was given. This script starts the program that way, prints
# the captured output and exits with the program's exit code.
#
#   tools/ci/windows-program-output.ps1 -Exe <path of mfbe.exe> [-Arguments <arg>, ...]
param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [string[]]$Arguments = @('--version')
)
$ErrorActionPreference = 'Stop'

$pythonw = (Get-Command pythonw.exe -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $pythonw) {
    $python = (Get-Command python.exe -ErrorAction Stop | Select-Object -First 1).Source
    $pythonw = Join-Path (Split-Path -Parent $python) 'pythonw.exe'
}
if (-not (Test-Path -LiteralPath $pythonw)) { throw "pythonw.exe not found (looked for $pythonw)" }
if (-not (Test-Path -LiteralPath $Exe)) { throw "program not found: $Exe" }

$work = Join-Path ([System.IO.Path]::GetTempPath()) ("mfbe-output-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
$runner = Join-Path $work 'run.py'
$output = Join-Path $work 'output.txt'
# pythonw.exe shows no error either: a failure to run the program goes into the output too.
Set-Content -LiteralPath $runner -Encoding ascii -Value @'
import subprocess
import sys
import traceback

try:
    result = subprocess.run(sys.argv[2:], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, timeout=120)
    output, code = result.stdout, result.returncode
except Exception:
    output, code = traceback.format_exc().encode("utf-8", "replace"), 125
with open(sys.argv[1], "wb") as captured:
    captured.write(output)
sys.exit(code)
'@
# Every argument quoted for the command line pythonw.exe parses (none ends with a backslash).
$commandLine = (@($runner, $output, $Exe) + $Arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
$process = Start-Process -FilePath $pythonw -ArgumentList $commandLine -Wait -PassThru
$text = ''
if (Test-Path -LiteralPath $output) { $text = [System.IO.File]::ReadAllText($output) }
Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
Write-Output $text.TrimEnd()
exit $process.ExitCode
