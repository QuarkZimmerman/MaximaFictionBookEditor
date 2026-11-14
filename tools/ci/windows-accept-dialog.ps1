# Accepts the visible window titled exactly -Title (the editor's native Save dialog) with its
# default button, as Return does: the proposed file name is kept. UI Automation finds the window
# and the button (the dialog's IDOK, automation id 1) and invokes it, so nothing depends on which
# window has the keyboard focus. A dialog owned by the editor's window is that window's child in
# the UI Automation tree, not the desktop's (CI on 3d6ab1d found no top-level "Export as PDF"), so
# every top-level window's subtree is searched. Used by tools/shell-smoke-pdf.mjs on Windows.
param(
    [Parameter(Mandatory = $true)] [string]$Title,
    [int]$TimeoutSeconds = 30
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$element = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]
$windowType = New-Object System.Windows.Automation.PropertyCondition($element::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
$titled = New-Object System.Windows.Automation.PropertyCondition($element::NameProperty, $Title)
$byTitle = [System.Windows.Automation.AndCondition]::new([System.Windows.Automation.Condition[]]@($titled, $windowType))
$byDefault = New-Object System.Windows.Automation.PropertyCondition($element::AutomationIdProperty, '1')
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
    foreach ($top in $element::RootElement.FindAll($scope::Children, $windowType)) {
        $window = $top.FindFirst($scope::Subtree, $byTitle)
        if (-not $window) { continue }
        $button = $window.FindFirst($scope::Descendants, $byDefault)
        if ($button) {
            $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
            Write-Host "windows-accept-dialog: '$Title' accepted ('$($button.Current.Name)', in '$($top.Current.Name)')"
            exit 0
        }
    }
    Start-Sleep -Milliseconds 200
}
# What is there instead, for the log: the top-level windows and the windows they hold.
foreach ($top in $element::RootElement.FindAll($scope::Children, $windowType)) {
    Write-Host "windows-accept-dialog: window '$($top.Current.Name)' ($($top.Current.ClassName), process $($top.Current.ProcessId))"
    foreach ($inner in $top.FindAll($scope::Children, $windowType)) {
        Write-Host "windows-accept-dialog:   holds '$($inner.Current.Name)' ($($inner.Current.ClassName))"
    }
}
throw "no window titled '$Title' with a default button within $TimeoutSeconds s"
