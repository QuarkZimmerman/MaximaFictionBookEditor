# Minimal client of the Chromium DevTools protocol (CDP) for the CI checks of the desktop editor
# started with --remote-debugging-port: one WebSocket to the editor's page, one command at a time.
# Release builds have no test hooks, so the checks read the page and send input through it.
# Dot-sourced by the scripts that use it (pwsh 7).

# Connects to the editor's page, the interface the core serves on 127.0.0.1. Fails when $Process
# ends first or no page appears within $TimeoutSeconds.
function Connect-CdpPage([int]$Port, [System.Diagnostics.Process]$Process, [int]$TimeoutSeconds = 120) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($Process -and $Process.HasExited) {
            throw ('the editor exited early (exit code 0x{0:X8})' -f $Process.ExitCode)
        }
        $page = $null
        try {
            $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 5
            $page = $targets | Where-Object {
                $_.type -eq 'page' -and $_.url -like 'http://127.0.0.1:*' -and $_.webSocketDebuggerUrl
            } | Select-Object -First 1
        } catch {
            # The DevTools endpoint is not up yet.
        }
        if ($page) {
            $socket = [System.Net.WebSockets.ClientWebSocket]::new()
            $socket.ConnectAsync([uri]$page.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
            return [pscustomobject]@{ Socket = $socket; LastId = 0 }
        }
        Start-Sleep -Seconds 1
    }
    throw "no editor page on the DevTools port $Port within $TimeoutSeconds s"
}

function Disconnect-Cdp($Session) {
    if ($Session) { $Session.Socket.Dispose() }
}

# One whole message from the page as text.
function Receive-CdpMessage([System.Net.WebSockets.ClientWebSocket]$Socket, [TimeSpan]$Timeout) {
    if ($Timeout -le [TimeSpan]::Zero) { throw 'no answer from the page in time' }
    $buffer = [byte[]]::new(65536)
    $stream = [IO.MemoryStream]::new()
    $cancel = [Threading.CancellationTokenSource]::new($Timeout)
    try {
        do {
            $received = $Socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), $cancel.Token).GetAwaiter().GetResult()
            if ($received.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
                throw 'the page closed the DevTools connection'
            }
            $stream.Write($buffer, 0, $received.Count)
        } while (-not $received.EndOfMessage)
    } finally {
        $cancel.Dispose()
    }
    [Text.Encoding]::UTF8.GetString($stream.ToArray())
}

# Sends the command $Method and returns its result; events arriving meanwhile are skipped. The
# message is ASCII (non-ASCII text as \u escapes), the answers are read as UTF-8.
function Invoke-Cdp($Session, [string]$Method, [hashtable]$Params = @{}, [int]$TimeoutSeconds = 30) {
    $Session.LastId += 1
    $id = $Session.LastId
    $message = ConvertTo-Json -InputObject @{ id = $id; method = $Method; params = $Params } -Depth 10 -Compress `
        -EscapeHandling EscapeNonAscii
    $bytes = [Text.Encoding]::UTF8.GetBytes($message)
    $Session.Socket.SendAsync([ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text,
        $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ($true) {
        try {
            $text = Receive-CdpMessage $Session.Socket ($deadline - (Get-Date))
        } catch {
            throw "${Method}: $($_.Exception.Message)"
        }
        # A hashtable keeps keys that differ only in case apart (event payloads may have them).
        $reply = ConvertFrom-Json -InputObject $text -AsHashtable
        if ($reply.id -eq $id) {
            if ($reply.error) { throw "$Method failed: $($reply.error.message)" }
            return $reply.result
        }
    }
}

# Value of the JavaScript expression $Expression in the page.
function Get-CdpValue($Session, [string]$Expression) {
    $result = Invoke-Cdp $Session 'Runtime.evaluate' @{ expression = $Expression; returnByValue = $true }
    if ($result.exceptionDetails) { throw "the page could not evaluate: $Expression" }
    $result.result.value
}

# Presses and releases a key in the page as the keyboard does: $Key holds the key's key, code and
# windowsVirtualKeyCode; $Modifiers is the CDP bit field (1 Alt, 2 Ctrl, 4 Meta, 8 Shift). No
# text is sent, as for keys pressed with Alt or Ctrl, so a letter types nothing.
function Send-CdpKey($Session, [hashtable]$Key, [int]$Modifiers = 0) {
    foreach ($type in 'rawKeyDown', 'keyUp') {
        $params = @{ type = $type; modifiers = $Modifiers; nativeVirtualKeyCode = $Key.windowsVirtualKeyCode } + $Key
        $null = Invoke-Cdp $Session 'Input.dispatchKeyEvent' $params
    }
}
