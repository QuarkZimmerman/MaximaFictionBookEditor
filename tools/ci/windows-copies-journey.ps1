# Feature 008 (T024, FR-015, PD2): copies of the editor on Windows - the relay through the
# engine's own already-running path, checked with the installed editor:
#   - a second start without a book opens a second window in slot 2;
#   - a start with a book reaches an untouched copy, which opens it; the next book the other
#     untouched copy; with both holding a book the question appears and New window opens a
#     new copy;
#   - the same book again opens nothing new.
#   tools/ci/windows-copies-journey.ps1 -Exe <path to mfbe.exe>
param([Parameter(Mandatory = $true)][string]$Exe)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'cdp-client.ps1')
$books = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests\fixtures\books'

function Wait-Until([scriptblock]$Condition, [int]$Seconds, [string]$What) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (& $Condition) { return }
    Start-Sleep -Milliseconds 500
  }
  throw "copies journey: $What"
}

function Get-PageTitle([int]$Port) {
  try {
    $pages = Invoke-RestMethod "http://127.0.0.1:$Port/json/list" -TimeoutSec 5
    return [string](($pages | Where-Object { $_.type -eq 'page' } | Select-Object -First 1).title)
  } catch { return '' }
}

function Find-CopiesDir {
  foreach ($root in @($env:LOCALAPPDATA, $env:APPDATA)) {
    $found = Get-ChildItem -Path $root -Directory -Recurse -Filter copies -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match 'Maxima' } | Select-Object -First 1
    if ($found) { return $found.FullName }
  }
  return $null
}

function Get-Records([string]$Dir) {
  Get-ChildItem $Dir -Filter *.json | ForEach-Object {
    try { Get-Content $_.FullName -Raw | ConvertFrom-Json } catch { $null }
  } | Where-Object { $_ }
}

function Test-TestId([int]$Port, [string]$TestId) {
  $session = $null
  try {
    $session = Connect-CdpPage -Port $Port -Process $null -TimeoutSeconds 10
    return [bool](Get-CdpValue $session "!!document.querySelector('[data-testid=`"$TestId`"]')")
  } catch { return $false } finally { if ($session) { Disconnect-Cdp $session } }
}

function Start-Relay([string]$Book) {
  $sender = Start-Process $Exe -ArgumentList "`"$Book`"" -PassThru -Wait
  if ($sender.ExitCode -ne 0) { throw "copies journey: the start with $Book ended with $($sender.ExitCode)" }
}

$ports = @(9301, 9302)
try {
  foreach ($port in $ports) {
    $null = Start-Process $Exe -ArgumentList "--remote-debugging-port=$port" -PassThru
    Wait-Until { (Get-PageTitle $port) -match ' - Maxima Fiction Book Editor$' } 120 "the copy on port $port did not start"
  }
  $copies = Find-CopiesDir
  if (-not $copies -or -not (Test-Path (Join-Path $copies '1.json')) -or -not (Test-Path (Join-Path $copies '2.json'))) {
    throw 'copies journey: no records for slots 1 and 2'
  }
  Write-Host "copies journey: two copies run, in slots 1 and 2 ($copies)"

  Start-Relay (Join-Path $books 'notes-6.fb2')
  Wait-Until { ((Get-PageTitle 9301) -like 'notes-6.fb2*') -or ((Get-PageTitle 9302) -like 'notes-6.fb2*') } 30 'the book reached no copy'
  $other = if ((Get-PageTitle 9301) -like 'notes-6.fb2*') { 9302 } else { 9301 }
  Write-Host 'copies journey: the book reached an untouched copy'

  Start-Relay (Join-Path $books 'notes-none.fb2')
  Wait-Until { (Get-PageTitle $other) -like 'notes-none.fb2*' } 30 'the next book did not reach the other untouched copy'
  Write-Host 'copies journey: the next book went to the other untouched copy'

  Start-Relay (Join-Path $books 'fbe-pictures.fb2')
  $script:asking = 0
  Wait-Until {
    foreach ($port in $ports) { if (Test-TestId $port 'open-elsewhere-dialog') { $script:asking = $port; return $true } }
    return $false
  } 30 'no copy asked where to open the book'
  $session = Connect-CdpPage -Port $script:asking -Process $null -TimeoutSeconds 10
  try {
    $null = Get-CdpValue $session "document.querySelector('[data-testid=`"open-elsewhere-dialog-button-new`"]').click(), true"
  } finally { Disconnect-Cdp $session }
  Wait-Until { @(Get-Records $copies | Where-Object { $_.book -and ([string]$_.book.path) -like '*fbe-pictures.fb2' }).Count -gt 0 } 60 'New window opened no copy holding the book'
  Write-Host 'copies journey: the question asked, New window opened a new copy'

  $before = @(Get-ChildItem $copies -Filter *.json).Count
  Start-Relay (Join-Path $books 'notes-6.fb2')
  Start-Sleep -Seconds 3
  if (@(Get-ChildItem $copies -Filter *.json).Count -ne $before) { throw 'copies journey: the open book started another copy' }
  Write-Host 'copies journey: the open book was not opened a second time'
  Write-Host 'copies journey: OK'
} finally {
  Get-Process mfbe -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
