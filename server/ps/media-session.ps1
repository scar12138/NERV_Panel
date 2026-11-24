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
