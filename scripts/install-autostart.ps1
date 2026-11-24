# ============================================================================
# NERV Panel 开机自启安装脚本
#
# 作用：在当前用户的「启动」文件夹里创建一个指向 NERV-Panel.vbs 的快捷方式，
#       让 Windows 登录后自动在后台拉起面板服务（无黑窗）。
#
# 原理：
#   1. Windows 登录时会执行
#      %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup 目录下的所有快捷方式。
#   2. 快捷方式指向 NERV-Panel.vbs，它用 WScript.Shell.Run(cmd, 0, False) 隐藏窗口
#      启动 start.bat。
#   3. start.bat 里 `node server\index.js` 退出码非 0 时会在 5 秒后自动重启，
#      最多连续 20 次，实现「崩溃自动拉起」。
#
# 用法（在项目根目录用 PowerShell 运行）：
#   .\scripts\install-autostart.ps1            # 安装
#   .\scripts\install-autostart.ps1 -Remove    # 卸载
#
# 不需要管理员权限（只写当前用户的启动目录）。
# ============================================================================

[CmdletBinding()]
param(
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'

# 项目根目录 = 本脚本所在目录的上一级
$root = Split-Path -Parent $PSScriptRoot
$vbs = Join-Path $root 'NERV-Panel.vbs'
$bat = Join-Path $root 'start.bat'

$startupDir = [Environment]::GetFolderPath('Startup')
$lnkPath = Join-Path $startupDir 'NERV Panel.lnk'

if ($Remove) {
    if (Test-Path $lnkPath) {
        Remove-Item $lnkPath -Force
        Write-Host "已移除开机自启：$lnkPath" -ForegroundColor Yellow
    }
    else {
        Write-Host "未找到开机自启快捷方式，无需移除。" -ForegroundColor Yellow
    }
    exit 0
}

if (-not (Test-Path $vbs)) {
    throw "未找到 NERV-Panel.vbs（$vbs），请确认项目文件完整。"
}
if (-not (Test-Path $bat)) {
    throw "未找到 start.bat（$bat），请确认项目文件完整。"
}

$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath = $vbs
$lnk.WorkingDirectory = $root
$lnk.WindowStyle = 7          # 7 = 最小化，VBS 自身会把 cmd 窗口隐藏
$lnk.Description = 'NERV Panel 局域网监控面板服务'
$lnk.Save()

Write-Host ""
Write-Host "已安装开机自启：" -ForegroundColor Green
Write-Host "  快捷方式  $lnkPath"
Write-Host "  指向      $vbs"
Write-Host "  工作目录  $root"
Write-Host ""
Write-Host "下次登录 Windows 时，面板服务会自动在后台启动。" -ForegroundColor Green
Write-Host "如需立即启动，直接双击 NERV-Panel.vbs（无窗口）或 start.bat（带窗口）。"
Write-Host "如需卸载，运行： .\scripts\install-autostart.ps1 -Remove"
Write-Host ""
