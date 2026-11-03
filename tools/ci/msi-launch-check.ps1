# Feature 008 (T059, FR-064): the built MSI's last page offers to launch the editor - the
# checkbox of MfbeExitDlg bound to MFBE_LAUNCH_EDITOR (default 1), Finish's DoAction under its
# condition, the custom action starting the editor through Explorer, and MfbeExitDlg as the
# success exit dialog. Reads the MSI tables through the WindowsInstaller.Installer COM object.
#   tools/ci/msi-launch-check.ps1 -Msi <path to the .msi>
param([Parameter(Mandatory = $true)][string]$Msi)
$ErrorActionPreference = 'Stop'
$installer = New-Object -ComObject WindowsInstaller.Installer
$db = $installer.GetType().InvokeMember('OpenDatabase', 'InvokeMethod', $null, $installer, @($Msi, 0))

function Query([string]$sql) {
  $view = $db.GetType().InvokeMember('OpenView', 'InvokeMethod', $null, $db, @($sql))
  $view.GetType().InvokeMember('Execute', 'InvokeMethod', $null, $view, $null) | Out-Null
  $rows = @()
  while ($true) {
    $record = $view.GetType().InvokeMember('Fetch', 'InvokeMethod', $null, $view, $null)
    if ($null -eq $record) { break }
    $count = $record.GetType().InvokeMember('FieldCount', 'GetProperty', $null, $record, $null)
    $fields = @()
    for ($i = 1; $i -le $count; $i++) {
      $fields += $record.GetType().InvokeMember('StringData', 'GetProperty', $null, $record, @($i))
    }
    $rows += , $fields
  }
  $view.GetType().InvokeMember('Close', 'InvokeMethod', $null, $view, $null) | Out-Null
  return , $rows
}

$problems = @()
$control = Query "SELECT ``Type``, ``Property`` FROM ``Control`` WHERE ``Dialog_`` = 'MfbeExitDlg' AND ``Control`` = 'LaunchCheckBox'"
if ($control.Count -ne 1 -or $control[0][0] -ne 'CheckBox' -or $control[0][1] -ne 'MFBE_LAUNCH_EDITOR') {
  $problems += 'MfbeExitDlg has no LaunchCheckBox bound to MFBE_LAUNCH_EDITOR'
}
$property = Query "SELECT ``Value`` FROM ``Property`` WHERE ``Property`` = 'MFBE_LAUNCH_EDITOR'"
if ($property.Count -ne 1 -or $property[0][0] -ne '1') {
  $problems += 'MFBE_LAUNCH_EDITOR does not default to 1 (ticked)'
}
$event = Query "SELECT ``Argument``, ``Condition`` FROM ``ControlEvent`` WHERE ``Dialog_`` = 'MfbeExitDlg' AND ``Control_`` = 'Finish' AND ``Event`` = 'DoAction'"
if ($event.Count -ne 1 -or $event[0][0] -ne 'MfbeLaunchEditor' -or $event[0][1] -notmatch 'MFBE_LAUNCH_EDITOR' -or $event[0][1] -notmatch 'REMOVE') {
  $problems += 'Finish does not start MfbeLaunchEditor under MFBE_LAUNCH_EDITOR and NOT REMOVE'
}
$action = Query "SELECT ``Target`` FROM ``CustomAction`` WHERE ``Action`` = 'MfbeLaunchEditor'"
if ($action.Count -ne 1 -or $action[0][0] -notmatch 'explorer\.exe' -or $action[0][0] -notmatch 'mfbe\.exe') {
  $problems += 'MfbeLaunchEditor does not start mfbe.exe through Explorer'
}
$show = Query "SELECT ``Sequence`` FROM ``InstallUISequence`` WHERE ``Action`` = 'MfbeExitDlg'"
if ($show.Count -ne 1 -or $show[0][0] -ne '-1') {
  $problems += 'MfbeExitDlg is not the dialog shown on success (InstallUISequence -1)'
}
if ($problems.Count -gt 0) {
  $problems | ForEach-Object { Write-Output "msi-launch-check: $_" }
  exit 1
}
Write-Output "msi-launch-check: OK ($Msi)"
