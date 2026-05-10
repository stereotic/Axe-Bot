@echo off
echo Starting AXE TEAM Bot System...
echo.
echo Starting Main Bot...
start "AXE Bot" cmd /k "node bot.js"
timeout /t 2 /nobreak >nul
echo Starting Profit System...
start "Profit System" cmd /k "node profit_system.js"
echo.
echo Both bots are running!
echo Close this window to keep bots running.
pause
