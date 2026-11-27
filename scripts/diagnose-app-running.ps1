# Read-only evidence collector. Does not launch/close apps, change configuration,
# query command lines, extract icons, or write files. Run on the PC hosting Panel.
# Optional report file: powershell -NoProfile -File scripts/diagnose-app-running.ps1 > app-running.json
param([switch]$SaveToDesktop)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$issues = @()
$processes = @()
try {
  $processes = @(Get-CimInstance Win32_Process | ForEach-Object {
    [pscustomobject]@{ pid = [int]$_.ProcessId; name = $_.Name; path = $_.ExecutablePath }
  })
} catch { $issues += 'Process query failed: ' + $_.Exception.Message }
function Get-VersionEvidence($target) {
  if (-not $target -or $target -notmatch '\.exe$') { return $null }
  try {
    $v = (Get-Item -LiteralPath $target -ErrorAction Stop).VersionInfo
    return [pscustomobject]@{ product = $v.ProductName; description = $v.FileDescription }
  } catch { return $null }
}
$shortcuts = @()
try {
  $shell = New-Object -ComObject WScript.Shell
  $dirs = @("$env:ProgramData\Microsoft\Windows\Start Menu\Programs", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs")
  $shortcuts = @(foreach ($dir in $dirs) {
    Get-ChildItem -LiteralPath $dir -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object {
      $s = $shell.CreateShortcut($_.FullName)
      [pscustomobject]@{ name = $_.BaseName; shortcut = $_.FullName; target = $s.TargetPath; args = $s.Arguments; version = (Get-VersionEvidence $s.TargetPath) }
    }
  })
} catch { $issues += 'Shortcut query failed: ' + $_.Exception.Message }
# Only obtain version metadata for paths under a shortcut target's own directory.
$handoff = @($processes | Where-Object {
  $procPath = $_.path
  if ($procPath) {
    $shortcuts | Where-Object {
      if ($_.target -match '\.exe$') {
        $dir = Split-Path -LiteralPath $_.target
        $procPath.StartsWith($dir.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
      }
    } | Select-Object -First 1
  }
} | ForEach-Object { [pscustomobject]@{ path = $_.path; version = (Get-VersionEvidence $_.path) } })
$roots = @('C:\Program Files (x86)\Steam', 'C:\Program Files\Steam', 'D:\Steam', 'D:\SteamLibrary', 'E:\Steam')
$steamRegistryPath = $null
try { $steamRegistryPath = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction Stop).SteamPath } catch {}
if ($steamRegistryPath) { $roots += $steamRegistryPath.Replace('/', '\') }
$libraries = @($roots | Where-Object { Test-Path -LiteralPath $_ -PathType Container } | Select-Object -Unique)
foreach ($root in @($libraries)) {
  $vdf = Join-Path $root 'steamapps\libraryfolders.vdf'
  if (Test-Path -LiteralPath $vdf) {
    $text = [IO.File]::ReadAllText($vdf)
    foreach ($m in [regex]::Matches($text, '"path"\s+"([^"]+)"')) {
      $lib = $m.Groups[1].Value.Replace('\\', '\')
      if (Test-Path -LiteralPath $lib -PathType Container) { $libraries += $lib }
    }
  }
}
$games = @(foreach ($lib in @($libraries | Select-Object -Unique)) {
  $appsDir = Join-Path $lib 'steamapps'
  Get-ChildItem -LiteralPath $appsDir -Filter appmanifest_*.acf -ErrorAction SilentlyContinue | ForEach-Object {
    $text = [IO.File]::ReadAllText($_.FullName)
    $record = [ordered]@{ manifest = $_.FullName }
    foreach ($key in @('appid', 'name', 'StateFlags', 'installdir')) {
      $match = [regex]::Match($text, '"' + $key + '"\s+"([^"]*)"')
      $record[$key] = $(if ($match.Success) { $match.Groups[1].Value } else { $null })
    }
    [pscustomobject]$record
  }
})
$report = [pscustomobject]@{
  sampledAt = [datetime]::Now.ToString('o')
  processQueryAvailable = @($issues | Where-Object { $_ -match '^Process query failed:' }).Count -eq 0
  processes = $processes
  shortcuts = $shortcuts
  handoffMetadata = $handoff
  steamRegistryPath = $steamRegistryPath
  steamLibraries = @($libraries | Select-Object -Unique)
  games = $games
  issues = $issues
} | ConvertTo-Json -Depth 8
if ($SaveToDesktop) {
  $destination = Join-Path ([Environment]::GetFolderPath('Desktop')) ('NERV-app-status-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
  $report | Set-Content -LiteralPath $destination -Encoding UTF8
  Write-Host ('Report saved: ' + $destination)
} else { $report }
