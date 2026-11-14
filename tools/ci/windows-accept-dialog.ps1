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
# The default button is the Button with the dialog's IDOK as its automation id: other parts of the
# dialog (items of its folder and navigation views) may carry the id 1 too (CI on 60a1a6b found one
# that has no Invoke pattern).
$idOk = New-Object System.Windows.Automation.PropertyCondition($element::AutomationIdProperty, '1')
$isButton = New-Object System.Windows.Automation.PropertyCondition($element::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$byDefault = [System.Windows.Automation.AndCondition]::new([System.Windows.Automation.Condition[]]@($idOk, $isButton))
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$seen = $null
while ((Get-Date) -lt $deadline) {
    foreach ($top in $element::RootElement.FindAll($scope::Children, $windowType)) {
        $window = $top.FindFirst($scope::Subtree, $byTitle)
        if (-not $window) { continue }
        if (-not $seen) { $seen = Get-Date }
        $ok = $window.FindFirst($scope::Descendants, $byDefault)
        if ($ok) {
            $ok.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
            Write-Host "windows-accept-dialog: '$Title' accepted with '$($ok.Current.Name)' (in '$($top.Current.Name)')"
            exit 0
        }
        if (((Get-Date) - $seen).TotalSeconds -gt 5) {
            # No such button after 5 s: Return to the dialog, as a user would press it.
            Write-Host "windows-accept-dialog: '$Title' has no button with the id 1; pressing Return in it"
            $window.SetFocus()
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
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
