# Pure ASCII for Windows PowerShell 5.1. JSONL commands on stdin; no shell eval.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  Add-Type -Path (Join-Path $PSScriptRoot 'audio-core.cs') -ReferencedAssemblies System.Drawing
  while ($null -ne ($line = [Console]::ReadLine())) {
    $request = $null
    try {
      if ($line.Length -gt 4096) { throw 'INVALID_REQUEST' }
      $request = $line | ConvertFrom-Json
      if ($request.requestId -isnot [string] -or $request.requestId -notmatch '^r[0-9]+$') { throw 'INVALID_REQUEST' }
      if ($request.operation -notin @('snapshot', 'volume', 'mute', 'devices', 'device')) { throw 'INVALID_OPERATION' }
      if ($request.operation -eq 'device') {
        if ($request.id -isnot [string] -or $request.id -cnotmatch '\Adevice:[a-f0-9]{64}\z' -or $request.flow -cnotin @('output', 'input')) { throw 'INVALID_DEVICE' }
      }
      if ($request.operation -in @('volume', 'mute')) {
        if ($request.id -isnot [string] -or $request.id -cnotmatch '^(master|session):[a-f0-9]{64}$') { throw 'INVALID_SESSION' }
        if ($request.operation -eq 'volume') {
          if (($request.volume -isnot [int] -and $request.volume -isnot [long] -and $request.volume -isnot [double] -and $request.volume -isnot [decimal]) -or [double]::IsNaN([double]$request.volume) -or [double]::IsInfinity([double]$request.volume) -or $request.volume -lt 0 -or $request.volume -gt 100) { throw 'INVALID_VOLUME' }
        }
        if ($request.operation -eq 'mute' -and $request.muted -isnot [bool]) { throw 'INVALID_MUTE' }
      }
      if ($request.operation -eq 'devices') {
        $result = [NervAudio.Core]::Devices()
      } elseif ($request.operation -eq 'device') {
        $result = [NervAudio.Core]::SetDevice([string]$request.id, [string]$request.flow)
      } else {
        $result = [NervAudio.Core]::Execute([string]$request.id, $request.operation, [double]$request.volume, [bool]$request.muted)
      }
      $response = @{ requestId = $request.requestId; result = $result }
    } catch {
      $response = @{ requestId = $(if ($null -ne $request) { $request.requestId } else { '' }); result = @{ ok = $false; error = 'AUDIO_REQUEST_FAILED'; message = $_.Exception.Message } }
    }
    [Console]::Out.WriteLine(($response | ConvertTo-Json -Compress -Depth 8))
    [Console]::Out.Flush()
  }
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
