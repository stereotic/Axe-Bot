@echo off
powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2000000" | "C:\Windows\System32\OpenSSH\ssh.exe" -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -R 80:localhost:8081 nokey@localhost.run > "%~dp0tunnel.log" 2>&1
