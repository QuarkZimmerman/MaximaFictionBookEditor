# Accepts the visible top-level window titled exactly -Title (the editor's native Save dialog) with
# its default button, as Return does: the proposed file name is kept. UI Automation finds the
# window and the button (the dialog's IDOK, automation id 1) and invokes it, so nothing depends on
# which window has the keyboard focus. Used by tools/shell-smoke-pdf.mjs on Windows.
param(
    [Parameter(Mandatory = $true)] [string]$Title,
    [int]$TimeoutSeconds = 30
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$element = [System.Windows.Automation.AutomationElement]
$byTitle = New-Object System.Windows.Automation.PropertyCondition($element::NameProperty, $Title)
$byDefault = New-Object System.Windows.Automation.PropertyCondition($element::AutomationIdProperty, '1')
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
    $window = $element::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $byTitle)
    if ($window) {
        $button = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $byDefault)
        if ($button) {
            $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
            Write-Host "windows-accept-dialog: '$Title' accepted ('$($button.Current.Name)')"
            exit 0
        }
    }
    Start-Sleep -Milliseconds 200
}
throw "no window titled '$Title' with a default button within $TimeoutSeconds s"
