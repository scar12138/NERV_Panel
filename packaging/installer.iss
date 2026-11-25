; NERV Panel 安装版（Inno Setup 6 脚本）
; 产物：NERV Panel 安装版.exe —— 把免安装 exe 装进 Program Files，建开始菜单/桌面快捷方式，
;       并带卸载程序。应用自身的数据与配置仍存在 %LOCALAPPDATA%\NERV_Panel（安装/卸载都不碰）。

#define MyAppName "NERV Panel"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "NERV"
#define MyAppExeName "NERV Panel.exe"

[Setup]
AppId={{8E1D2C3A-5F4B-4A6E-9C7D-2F3E4A5B6C7D}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\NERV Panel
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
PrivilegesRequired=lowest
; 免安装 exe 体积约 140MB，装完允许直接运行
[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "在桌面创建快捷方式"; GroupDescription: "附加任务："; Flags: unchecked

[Files]
Source: "..\dist\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "立即启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; 应用的自持数据在 %LOCALAPPDATA%\NERV_Panel（config/日志等），卸载时保留（用户数据不删）。
; 仅删除安装目录 CACHE 类残留：无