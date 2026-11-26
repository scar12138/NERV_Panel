param(
    [Parameter(Mandatory = $true)][ValidateSet('Install', 'Uninstall')][string]$Mode,
    [Parameter(Mandatory = $true)][string]$AppDirectory,
    [Parameter(Mandatory = $true)][string]$LogPath
)
$ErrorActionPreference = 'Stop'
try {
    $app = [IO.Path]::GetFullPath($AppDirectory).TrimEnd('\')
    $program = [IO.Path]::Combine($app, 'runtime', 'node.exe')
    # Installation path is part of identity: another installation is never removed.
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $id = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($app.ToLowerInvariant()))).Replace('-', '') }
    finally { $hasher.Dispose() }
    $name = 'NERV-Panel-Runtime-' + $id
    $policy = New-Object -ComObject HNetCfg.FwPolicy2
    # Only our exact application-owned rule names are eligible for replacement.
    $ownedNames = @($name, 'NERV-Panel-Server')
    foreach ($owned in $ownedNames) {
        while (@($policy.Rules | Where-Object { $_.Name -eq $owned }).Count -gt 0) {
            $policy.Rules.Remove($owned)
        }
    }
    if ($Mode -eq 'Install') {
        if (-not (Test-Path -LiteralPath $program -PathType Leaf)) { throw "Missing installed runtime: $program" }
        $rule = New-Object -ComObject HNetCfg.FWRule
        $rule.Name = $name
        $rule.Description = 'NERV Panel installed runtime; inbound TCP on Private networks only.'
        $rule.Grouping = 'NERV Panel'
        $rule.ApplicationName = $program
        $rule.Direction = 1
        $rule.Action = 1
        $rule.Protocol = 6
        $rule.Profiles = 2
        $rule.Enabled = $true
        $rule.EdgeTraversal = $false
        $policy.Rules.Add($rule)
        $saved = @($policy.Rules | Where-Object { $_.Name -eq $name })
        if ($saved.Count -ne 1 -or $saved[0].Profiles -ne 2 -or $saved[0].ApplicationName -ne $program -or
            $saved[0].Direction -ne 1 -or $saved[0].Action -ne 1 -or $saved[0].Protocol -ne 6 -or -not $saved[0].Enabled) {
            throw 'Firewall rule verification failed.'
        }
    }
    "$(Get-Date -Format o) $Mode OK; program=$program; profile=Private; rule=$name" | Out-File -LiteralPath $LogPath -Encoding utf8
    exit 0
} catch {
    "$(Get-Date -Format o) $Mode FAILED: $($_.Exception.Message)" | Out-File -LiteralPath $LogPath -Encoding utf8
    exit 1
}
