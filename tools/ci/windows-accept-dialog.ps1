# Accepts the window titled exactly -Title (the editor's native Save dialog) as a click on its Save
# button does: the dialog gets WM_COMMAND with IDOK, the id of its default button, and the proposed
# file name is kept. The window is found by its class and title through the Win32 API, so nothing
# depends on which window has the keyboard focus or on how UI Automation presents the dialog (CI on
# 3d6ab1d, 60a1a6b and 7526837: its tree held no top-level window of that title, then no Button with
# the id 1, and the window could not take the focus). The call ends once the dialog has closed; when
# it does not, the dialog's child windows are listed. Used by tools/shell-smoke-pdf.mjs on Windows.
param(
    [Parameter(Mandatory = $true)] [string]$Title,
    [int]$TimeoutSeconds = 30
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class MfbeDialogs {
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindowW(string className, string title);
    [DllImport("user32.dll")]
    public static extern bool PostMessageW(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")]
    public static extern IntPtr GetDlgItem(IntPtr dialog, int id);
    [DllImport("user32.dll")]
    public static extern int GetDlgCtrlID(IntPtr window);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassNameW(IntPtr window, StringBuilder name, int size);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextW(IntPtr window, StringBuilder text, int size);
    public delegate bool EnumProc(IntPtr window, IntPtr data);
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumProc callback, IntPtr data);
    [DllImport("user32.dll")]
    public static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr data);

    static string Describe(IntPtr window) {
        StringBuilder name = new StringBuilder(256);
        StringBuilder text = new StringBuilder(256);
        GetClassNameW(window, name, name.Capacity);
        GetWindowTextW(window, text, text.Capacity);
        return string.Format("id {0}, class {1}, text '{2}'", GetDlgCtrlID(window), name, text);
    }

    public static string Children(IntPtr parent) {
        StringBuilder all = new StringBuilder();
        EnumChildWindows(parent, (window, data) => { all.AppendLine("  " + Describe(window)); return true; }, IntPtr.Zero);
        return all.ToString();
    }

    public static string VisibleTopLevel() {
        StringBuilder all = new StringBuilder();
        EnumWindows((window, data) => {
            if (IsWindowVisible(window)) all.AppendLine("  " + Describe(window));
            return true;
        }, IntPtr.Zero);
        return all.ToString();
    }
}
'@
$WM_COMMAND = 0x0111
$IDOK = 1
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
    $dialog = [MfbeDialogs]::FindWindowW('#32770', $Title)
    if ($dialog -ne [IntPtr]::Zero) {
        # As a click on the default button: BN_CLICKED (0) from IDOK, the button's own window if any.
        $ok = [MfbeDialogs]::GetDlgItem($dialog, $IDOK)
        [void][MfbeDialogs]::PostMessageW($dialog, $WM_COMMAND, [IntPtr]$IDOK, $ok)
        $closing = (Get-Date).AddSeconds(15)
        while ([MfbeDialogs]::IsWindow($dialog) -and (Get-Date) -lt $closing) { Start-Sleep -Milliseconds 200 }
        if (-not [MfbeDialogs]::IsWindow($dialog)) {
            Write-Host "windows-accept-dialog: '$Title' accepted (its default button $(if ($ok -ne [IntPtr]::Zero) { 'found' } else { 'not found' }))"
            exit 0
        }
        Write-Host "windows-accept-dialog: '$Title' is still open 15 s after IDOK; its child windows:"
        Write-Host ([MfbeDialogs]::Children($dialog))
        throw "the dialog '$Title' did not close"
    }
    Start-Sleep -Milliseconds 200
}
Write-Host "windows-accept-dialog: no dialog titled '$Title'; the visible top-level windows:"
Write-Host ([MfbeDialogs]::VisibleTopLevel())
throw "no dialog titled '$Title' within $TimeoutSeconds s"
