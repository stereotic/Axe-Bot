# Auto-watcher for the cloudflared quick tunnel.
# Keeps one cloudflared process alive and writes the current trycloudflare URL to .env.
# The battle-pass button reads .env on every profile render, so no bot restart is needed.
$ErrorActionPreference = 'SilentlyContinue'
$dir     = Split-Path -Parent $MyInvocation.MyCommand.Path
$envF    = Join-Path $dir '.env'
$outLog  = Join-Path $dir 'cloudflared.log'
$errLog  = Join-Path $dir 'cloudflared.err.log'
$watch   = Join-Path $dir 'cloudflare-watch.log'
$cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
if (-not (Test-Path $cloudflared)) { $cloudflared = 'cloudflared' }

function Log($msg) {
  Add-Content -Path $watch -Encoding UTF8 -Value ("{0}  {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg)
}

function Get-Url {
  foreach ($f in @($outLog, $errLog)) {
    if (Test-Path $f) {
      $c = Get-Content $f -Raw
      $m = [regex]::Match($c, 'https://[a-z0-9-]+\.trycloudflare\.com')
      if ($m.Success) { return $m.Value }
    }
  }
  return ''
}

function Set-EnvUrl($url) {
  if (-not (Test-Path $envF)) { return }
  $env = Get-Content $envF -Raw
  if ($env -match 'BATTLEPASS_URL=https://(?![a-z0-9-]+\.trycloudflare\.com)\S+') {
    Log 'Permanent BATTLEPASS_URL configured; quick-tunnel URL was not written.'
    return
  }
  if ($env -match 'BATTLEPASS_URL=') {
    $env = [regex]::Replace($env, 'BATTLEPASS_URL=.*', "BATTLEPASS_URL=$url")
  } else {
    $env = $env + "`nBATTLEPASS_URL=$url`n"
  }
  Set-Content -Path $envF -Value $env -Encoding ASCII -NoNewline
  Log "URL in .env -> $url"
}

function Ensure-Tunnel {
  if (Get-Process cloudflared -ErrorAction SilentlyContinue) { return }
  Log 'cloudflared not running, starting fresh tunnel...'
  Remove-Item $outLog,$errLog -Force
  $p = Start-Process -FilePath $cloudflared `
    -ArgumentList 'tunnel','--url','http://localhost:8081' `
    -WorkingDirectory $dir `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog `
    -WindowStyle Hidden -PassThru
  for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 2
    if ($p.HasExited) { break }
    $u = Get-Url
    if ($u) {
      Set-EnvUrl $u
      Log "New URL: $u"
      return
    }
  }
  Log 'Tunnel did not produce a URL.'
}

Log 'Watcher started.'
while ($true) {
  if (-not (Get-Process cloudflared -ErrorAction SilentlyContinue)) {
    Ensure-Tunnel | Out-Null
  } else {
    $url = Get-Url
    if ($url) {
      $code = curl.exe -s -o NUL -w '%{http_code}' -m 10 $url
      if ($code -ne '200') {
        Log "Check: HTTP $code, restarting cloudflared..."
        Stop-Process -Name cloudflared -Force
        Ensure-Tunnel | Out-Null
      }
    }
  }
  Start-Sleep -Seconds 15
}
