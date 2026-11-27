; NERV Panel: elevated installation provisions a fixed runtime and Private-only rule.
#define MyAppName "NERV Panel"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "NERV"
#define MyAppExeName "NERV Panel.exe"

[Setup]
AppId={{8E1D2C3A-5F4B-4A6E-9C7D-2F3E4A5B6C7D}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName=D:\NERV panel
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=NERV Panel 安装版
SetupIconFile=NERV-Panel.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
AppMutex=Global\NERV_Panel_Desktop_Launcher_Mutex,NERV_Panel_Desktop_Launcher_Mutex

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "在桌面创建快捷方式"; GroupDescription: "附加任务："; Flags: unchecked

[InstallDelete]
; Runtime contains only shipped code. Remove obsolete dependencies/assets on upgrade.
Type: filesandordirs; Name: "{app}\runtime"

[Files]
Source: "..\dist\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\build\bundle\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "firewall.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "立即启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent runasoriginaluser

[Code]
function InitializeUninstall(): Boolean;
begin
  Result := not (CheckForMutexes('Global\NERV_Panel_Desktop_Launcher_Mutex') or
                 CheckForMutexes('NERV_Panel_Desktop_Launcher_Mutex'));
  if not Result then
    MsgBox('请先从托盘退出 NERV Panel，再运行卸载。', mbError, MB_OK);
end;

procedure UpdateFirewall(Mode: String);
var
  ResultCode: Integer;
  LogDirectory, LogFile, Parameters: String;
begin
  LogDirectory := ExpandConstant('{commonappdata}\NERV Panel');
  if not ForceDirectories(LogDirectory) then
    RaiseException('无法创建安装日志目录：' + LogDirectory);
  LogFile := LogDirectory + '\firewall-' + Mode + '.log';
  Parameters := '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
    ExpandConstant('{app}\firewall.ps1') + '" -Mode ' + Mode +
    ' -AppDirectory "' + ExpandConstant('{app}') + '" -LogPath "' + LogFile + '"';
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      Parameters, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    RaiseException('无法启动防火墙配置程序。日志：' + LogFile);
  if ResultCode <> 0 then
    RaiseException('防火墙配置失败（退出码 ' + IntToStr(ResultCode) + '）。日志：' + LogFile);
  Log('Firewall ' + Mode + ' succeeded. Log: ' + LogFile);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    UpdateFirewall('Install');
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  // Remove the owned rule while the helper still exists; failure stops uninstall visibly.
  if CurUninstallStep = usUninstall then
    UpdateFirewall('Uninstall');
end;

// No deletion of LocalAppData NERV_Panel: configuration, data and logs survive.
