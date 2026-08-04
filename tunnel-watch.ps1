# Auto-watcher for the localhost.run tunnel.
# Every ~10s it checks the current URL from tunnel.log. If it fails twice (503/timeout) -
# kills the zombie ssh + feeder, starts a fresh tunnel, extracts the new URL and writes it to .env.
# The battle-pass button reads .env on every profile render, so no bot restart is needed.
$ErrorActionPreference = 'SilentlyContinue'
$dir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$log   = Join-Path $dir 'tunnel.log'
$bat   = Join-Path $dir 'tunnel-start.bat'
$envF  = Join-Path $dir '.env'
$watch = Join-Path $dir 'tunnel-watch.log'

function Log($msg) {
  Add-Content -Path $watch -Encoding UTF8 -Value ("{0}  {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg)
}

function Get-UrlFromLog {
  if (Test-Path $log) {
    $c = Get-Content $log -Raw
    $m = [regex]::Match($c, 'https://[a-z0-9]+\.lhr\.life')
    if ($m.Success) { return $m.Value }
  }
  return ''
}

function Set-EnvUrl($url) {
  if (-not (Test-Path $envF)) { return }
  $env = Get-Content $envF -Raw
  if ($env -match 'BATTLEPASS_URL=') {
    $env = [regex]::Replace($env, 'BATTLEPASS_URL=.*', "BATTLEPASS_URL=$url")
  } else {
    $env = $env + "`nBATTLEPASS_URL=$url`n"
  }
  Set-Content -Path $envF -Value $env -Encoding ASCII -NoNewline
  Log "URL in .env -> $url"
}

function Restart-Tunnel {
  Log 'Killing zombie and starting fresh tunnel...'
  Stop-Process -Name ssh -Force
  Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'powershell.exe' -and $_.CommandLine -match 'Start-Sleep -Seconds 2000000'
  } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Remove-Item $log -Force
  Start-Sleep -Milliseconds 600
  Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = "cmd.exe /c `"$bat`"" } | Out-Null
  Log 'Tunnel started, waiting for URL...'
}

Log 'Watcher started.'
$failures = 0
while ($true) {
  $url = Get-UrlFromLog
  if ($url) {
    $code = curl.exe -s -o NUL -w '%{http_code}' -m 10 $url
    if ($code -eq '200') {
      if ($failures -ge 1) { Log "Tunnel alive again: $url" }
      $failures = 0
      Start-Sleep -Seconds 20
      continue
    }
    $failures++
    Log "Check: HTTP $code (fail=$failures) url=$url"
  } else {
    if ($failures -lt 2) {
      $failures++
      Log "URL not in log yet (fail=$failures)"
    }
  }

  if ($failures -ge 2) {
    Restart-Tunnel
    Start-Sleep -Seconds 15
    $url = Get-UrlFromLog
    if ($url) {
      Set-EnvUrl $url
      $failures = 0
      Log "New URL: $url"
    }
  }
  Start-Sleep -Seconds 10
}
