# NERV Panel - network byte counters
# Prints one JSON line per second with the cumulative received / sent byte count
# of every network adapter. The Node side turns consecutive samples into a rate.
#
# Keep this file pure ASCII: Windows PowerShell 5.1 reads BOM-less scripts using
# the ANSI code page, which would mangle non-ASCII characters.

$ErrorActionPreference = "Continue"

function Emit($obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 5
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

while ($true) {
  try {
    $stats = Get-NetAdapterStatistics -ErrorAction Stop
    $list = @()
    foreach ($s in $stats) {
      $list += @{
        n  = $s.Name
        rx = [double]$s.ReceivedBytes
        tx = [double]$s.SentBytes
      }
    }
    $ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    Emit @{ ts = $ts; adapters = $list }
  } catch {
    Emit @{ error = $_.Exception.Message }
  }
  Start-Sleep -Milliseconds 1000
}
