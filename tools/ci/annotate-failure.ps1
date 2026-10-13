# PowerShell twin of annotate-failure.sh (Windows runners).
param([string]$Log, [string]$Title = "step failed")
if (-not $Log -or -not (Test-Path $Log)) { Write-Output "::error title=$Title::no log captured"; exit 0 }
$lines = Get-Content $Log
$hits = $lines | Select-String -Pattern "error|fatal|failed|exception|not found|denied" -CaseSensitive:$false | Select-Object -Last 25 | ForEach-Object { $_.Line }
$tail = $lines | Select-Object -Last 30
$text = (($hits + @("----- tail -----") + $tail) | ForEach-Object { if ($_.Length -gt 400) { $_.Substring(0, 400) } else { $_ } }) -join "`n"
if ($text.Length -gt 3800) { $text = $text.Substring(0, 3800) }
$text = $text.Replace("%", "%25").Replace("`r", "").Replace("`n", "%0A")
Write-Output "::error title=$Title::$text"
