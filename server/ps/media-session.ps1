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

# WinRT IAsyncOperation<T> -> Task<T> bridge.
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq "AsTask" -and
  $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation``1"
})[0]

function Await($op, $t) {
  $m = $asTaskGeneric.MakeGenericMethod($t)
  $task = $m.Invoke($null, @($op))
  $null = $task.Wait(4000)
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

# Read the album-art thumbnail from SMTC media properties.
# Returns @{ hash; b64; mime }; on missing/invalid returns @{ hash=""; b64=$null; mime=$null }.
function Read-Thumbnail($props) {
  $none = @{ hash = ""; b64 = $null; mime = $null }
  try {
    if ($null -eq $props -or $null -eq $props.Thumbnail) { return $none }
    $stream = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    if ($null -eq $stream) { return $none }
    $size = $stream.Size
    if ($size -lt 1) { return $none }
    # Cap 256KB: larger covers are dropped so a 1.5s sample frame is never
    # dragged down by a huge base64 payload.
    if ($size -gt 262144) { return $none }
    $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
    $loaded = Await ($reader.LoadAsync($size)) ([uint32])
    $bytes = New-Object byte[] $loaded
    $reader.ReadBytes($bytes)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hash = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace("-", "").ToLowerInvariant()
    $sha.Dispose()
    return @{
      hash = $hash
      b64  = [Convert]::ToBase64String($bytes)
      mime = $stream.ContentType
    }
  } catch {
    return $none
  }
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
    available = $false
    thumbHash = ""
  }
  try {
    $cur = $mgr.GetCurrentSession()
    if ($null -ne $cur) {
      $res.available = $true
      $res.app = $cur.SourceAppUserModelId
      try {
        $p = Await ($cur.TryGetMediaPropertiesAsync()) $propsType
        if ($null -ne $p) {
          if (-not [string]::IsNullOrWhiteSpace($p.Title)) { $res.title = $p.Title }
          if (-not [string]::IsNullOrWhiteSpace($p.Artist)) { $res.artist = $p.Artist }
          $th = Read-Thumbnail $p
          $res.thumbHash = $th.hash
          # Carry the base64 only when the hash changed; otherwise Node reuses its cache.
          if ($th.hash -ne "" -and $th.hash -ne $script:lastThumbHash) {
            $res.thumbnail = $th.b64
            $res.thumbnailMime = $th.mime
          }
          if ($th.hash -ne $script:lastThumbHash) { $script:lastThumbHash = $th.hash }
        }
      } catch {
        $res.propsError = $_.Exception.Message
      }
      try {
        $info = $cur.GetPlaybackInfo()
        # GlobalSystemMediaTransportControlsSessionPlaybackStatus: 4 = Playing
        $res.isPlaying = ($info.PlaybackStatus -eq 4)
        $res.playbackStatus = [int]$info.PlaybackStatus
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
    $cur = $mgr.GetCurrentSession()
    if ($null -eq $cur) {
      $res.message = "NO_SESSION"
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
