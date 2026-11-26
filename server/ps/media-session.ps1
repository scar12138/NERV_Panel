# NERV Panel - Windows SMTC media session bridge
# Reads the current Global System Media Transport Controls session and sends
# transport commands through it. Emits one JSON object per line (JSONL) so the
# Node side never has to guess the console encoding.
#
# Modes (pass with -Mode):
#   snapshot : print one snapshot and exit
#   loop     : print a snapshot every -PollMs milliseconds until killed
#   control  : send one transport command (-Action prev|playPause|next), print
#              the result and exit
#
# IMPORTANT: keep this file pure ASCII. Windows PowerShell 5.1 reads scripts
# without a BOM using the ANSI code page, which mangles non-ASCII characters.

param(
  [string]$Mode = "snapshot",
  [string]$Action = "",
  [string]$ExpectedApp = "",
  [double]$Position = -1,
  [int]$PollMs = 1500
)

$ErrorActionPreference = "Stop"

# Output JSON as UTF-8 so Chinese titles/artists survive the pipe to Node.
# Windows PowerShell 5.1 defaults [Console]::Out to the ANSI/GBK code page,
# which garbles UTF-8 text. Force UTF-8 with no BOM.
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch { }

Add-Type -AssemblyName System.Runtime.WindowsRuntime
# OS metadata only: no developer SDK is required in packaged installations.
$thumbnailCompiler = New-Object System.CodeDom.Compiler.CompilerParameters
$runtimeDirectory = [System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
foreach ($assembly in @('System.Runtime.WindowsRuntime.dll', 'System.Runtime.dll', 'System.Drawing.dll')) {
  [void]$thumbnailCompiler.ReferencedAssemblies.Add((Join-Path $runtimeDirectory $assembly))
}
foreach ($metadata in @('Windows.Storage.winmd', 'Windows.Foundation.winmd')) {
  [void]$thumbnailCompiler.ReferencedAssemblies.Add((Join-Path $env:WINDIR ('System32/WinMetadata/' + $metadata)))
}
Add-Type -CompilerParameters $thumbnailCompiler -TypeDefinition ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'media-thumbnail.cs')))

# WinRT IAsyncOperation<T> -> Task<T> bridge.
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq "AsTask" -and
  $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation``1"
})[0]

function Await($op, $t) {
  $m = $asTaskGeneric.MakeGenericMethod($t)
  $task = $m.Invoke($null, @($op))
  if (-not $task.Wait(4000)) { throw "WinRT operation timed out" }
  return $task.Result
}

function Emit($obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 4
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

function Get-Manager() {
  $mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  return Await ($mgrType::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
}

$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]

# Last emitted thumbnail hash (only meaningful across frames in loop mode).
# The base64 payload rides along only when the hash changes, so we don't push
# a multi-hundred-KB cover through the JSONL stream every 1.5 seconds.
$script:lastThumbHash = ""
# Title+artist of the track the cached hash belongs to; lets the 1.5s loop skip
# re-reading (and re-hashing) the whole cover when nothing changed.
$script:lastThumbKey = ""

# Read the album-art thumbnail from SMTC media properties.
# Returns @{ hash; b64; mime }; on missing/invalid returns @{ hash=""; b64=$null; mime=$null }.
function Read-Thumbnail($props) {
  $none = @{ hash = ""; b64 = $null; mime = $null }
  try {
    if ($null -eq $props -or $null -eq $props.Thumbnail) { return $none }
    # Typed C# owns stream/reader/image disposal and normalizes to a small JPEG.
    $thumbnail = [NervMedia.ThumbnailReader]::Read($props.Thumbnail)
    return @{ hash = $thumbnail.hash; b64 = $thumbnail.b64; mime = $thumbnail.mime }
  } catch {
    return $none
  }
}

# Prefer the manager-selected session when it is playing, otherwise the first
# playing session, then fall back to the manager selection or any idle session.
function Select-Session($mgr) {
  $current = $mgr.GetCurrentSession()
  if ($null -ne $current) {
    try { if ($current.GetPlaybackInfo().PlaybackStatus -eq 4) { return $current } } catch { }
  }
  $all = @($mgr.GetSessions())
  foreach ($session in $all) {
    try { if ($session.GetPlaybackInfo().PlaybackStatus -eq 4) { return $session } } catch { }
  }
  if ($null -ne $current) { return $current }
  if ($all.Count -gt 0) { return $all[0] }
  return $null
}

$script:appNames = @{}
function App-Name([string]$appId) {
  if ($script:appNames.ContainsKey($appId)) { return $script:appNames[$appId] }
  $name = $null
  try {
    $app = Get-StartApps | Where-Object { $_.AppID -ceq $appId } | Select-Object -First 1
    if ($null -ne $app) { $name = $app.Name }
  } catch { }
  if ([string]::IsNullOrWhiteSpace($name)) {
    try {
      $processName = [IO.Path]::GetFileNameWithoutExtension($appId)
      $process = Get-Process -Name $processName -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($null -ne $process) { $name = $process.MainModule.FileVersionInfo.FileDescription }
    } catch { }
  }
  if ([string]::IsNullOrWhiteSpace($name)) {
    $name = ($appId -split '!')[-1]
    $name = [IO.Path]::GetFileNameWithoutExtension($name)
    if ([string]::IsNullOrWhiteSpace($name)) { $name = $appId }
  }
  if ($script:appNames.Count -gt 128) { $script:appNames.Clear() }
  $script:appNames[$appId] = $name
  return $name
}

# One snapshot of the current session. Missing fields stay $null; nothing here
# invents a title or artist.
function Snapshot($mgr) {
  $res = @{
    ok        = $true
    title     = $null
    artist    = $null
    isPlaying = $false
    app       = $null
    appName   = $null
    available = $false
    thumbHash = ""
    position = 0
    duration = 0
    startTime = 0
    endTime = 0
    canSeek = $false
    canPlay = $false
    canPause = $false
    canNext = $false
    canPrevious = $false
    playbackStatus = 0
    sampledAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  }
  try {
    $cur = Select-Session $mgr
    if ($null -ne $cur) {
      $res.available = $true
      $res.app = $cur.SourceAppUserModelId
      $res.appName = App-Name $res.app
      try {
        $p = Await ($cur.TryGetMediaPropertiesAsync()) $propsType
        if ($null -ne $p) {
          if (-not [string]::IsNullOrWhiteSpace($p.Title)) { $res.title = $p.Title }
          if (-not [string]::IsNullOrWhiteSpace($p.Artist)) { $res.artist = $p.Artist }
          $key = [string]$res.app + "|" + [string]$p.Title + "|" + [string]$p.Artist
          if ($key -eq $script:lastThumbKey -and $script:lastThumbHash -ne "") {
            # Same track: reuse the cached hash and skip reading the image again.
            $res.thumbHash = $script:lastThumbHash
          } else {
            $th = Read-Thumbnail $p
            $res.thumbHash = $th.hash
            # Carry the base64 only when the hash changed; otherwise Node reuses its cache.
            if ($th.hash -ne "" -and $th.hash -ne $script:lastThumbHash) {
              $res.thumbnail = $th.b64
              $res.thumbnailMime = $th.mime
            }
            if ($th.hash -ne $script:lastThumbHash) { $script:lastThumbHash = $th.hash }
            $script:lastThumbKey = $key
          }
        }
      } catch {
        $res.propsError = $_.Exception.Message
      }
      try {
        $info = $cur.GetPlaybackInfo()
        # GlobalSystemMediaTransportControlsSessionPlaybackStatus: 4 = Playing
        $res.isPlaying = ($info.PlaybackStatus -eq 4)
        $res.playbackStatus = [int]$info.PlaybackStatus
        $res.canSeek = [bool]$info.Controls.IsPlaybackPositionEnabled
        $res.canPlay = [bool]$info.Controls.IsPlayEnabled
        $res.canPause = [bool]$info.Controls.IsPauseEnabled
        $res.canNext = [bool]$info.Controls.IsNextEnabled
        $res.canPrevious = [bool]$info.Controls.IsPreviousEnabled
        $timeline = $cur.GetTimelineProperties()
        $res.startTime = [double]$timeline.StartTime.TotalSeconds
        $res.endTime = [double]$timeline.EndTime.TotalSeconds
        $res.duration = [Math]::Max(0, $res.endTime - $res.startTime)
        $res.position = [Math]::Max(0, [Math]::Min($res.duration, $timeline.Position.TotalSeconds - $res.startTime))
      } catch {
        $res.playbackError = $_.Exception.Message
      }
    }
  } catch {
    $res.ok = $false
    $res.error = $_.Exception.Message
  }
  return $res
}

function Control($mgr, $act) {
  $res = @{ ok = $false; action = $act; message = "" }
  try {
    $cur = Select-Session $mgr
    if ($null -eq $cur) {
      $res.message = "NO_SESSION"
      return $res
    }
    if ([string]::IsNullOrWhiteSpace($ExpectedApp) -or $cur.SourceAppUserModelId -cne $ExpectedApp) {
      $res.message = "SESSION_CHANGED"
      return $res
    }
    switch ($act) {
      "prev" {
        $ok = Await ($cur.TrySkipPreviousAsync()) ([bool])
        $res.ok = [bool]$ok
        if (-not $ok) { $res.message = "SESSION_REFUSED" }
      }
      "next" {
        $ok = Await ($cur.TrySkipNextAsync()) ([bool])
        $res.ok = [bool]$ok
        if (-not $ok) { $res.message = "SESSION_REFUSED" }
      }
      "play" {
        # True play (start playback, no toggle)
        $ok = Await ($cur.TryPlayAsync()) ([bool])
        $res.ok = [bool]$ok
        if (-not $ok) { $res.message = "SESSION_REFUSED" }
      }
      "pause" {
        $ok = Await ($cur.TryPauseAsync()) ([bool])
        $res.ok = [bool]$ok
        if (-not $ok) { $res.message = "SESSION_REFUSED" }
      }
      "playPause" {
        $ok = Await ($cur.TryTogglePlayPauseAsync()) ([bool])
        $res.ok = [bool]$ok
        if (-not $ok) { $res.message = "SESSION_REFUSED" }
      }
      "seek" {
        $info = $cur.GetPlaybackInfo()
        $timeline = $cur.GetTimelineProperties()
        $duration = ($timeline.EndTime - $timeline.StartTime).TotalSeconds
        if (-not $info.Controls.IsPlaybackPositionEnabled) { $res.message = "SEEK_UNAVAILABLE"; return $res }
        if ([double]::IsNaN($Position) -or [double]::IsInfinity($Position) -or $Position -lt 0 -or $Position -gt $duration) { $res.message = "INVALID_POSITION"; return $res }
        $ticks = [int64]($timeline.StartTime.Ticks + $Position * [TimeSpan]::TicksPerSecond)
        $ok = Await ($cur.TryChangePlaybackPositionAsync($ticks)) ([bool])
        $res.ok = [bool]$ok
        if (-not $ok) { $res.message = "SESSION_REFUSED" }
      }
      default { $res.message = "UNKNOWN_ACTION" }
    }
  } catch {
    $res.ok = $false
    $res.message = $_.Exception.Message
  }
  return $res
}

try {
  $mgr = Get-Manager
} catch {
  Emit @{ ok = $false; error = "MANAGER_UNAVAILABLE"; message = $_.Exception.Message }
  exit 1
}

switch ($Mode) {
  "control" {
    $r = Control $mgr $Action
    Emit $r
  }
  "loop" {
    if ($PollMs -lt 300) { $PollMs = 300 }
    while ($true) {
      $snap = Snapshot $mgr
      $snap.kind = "snapshot"
      Emit $snap
      Start-Sleep -Milliseconds $PollMs
    }
  }
  default {
    $snap = Snapshot $mgr
    Emit $snap
  }
}
