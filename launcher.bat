@echo off
chcp 65001 >nul
title AXE TEAM Bot Launcher
echo ========================================
echo    AXE TEAM Bot System
echo ========================================
echo.
echo [1] Zapustit osnovnoy bot (bot.js)
echo [2] Zapustit sistemu profitov (profit_system.js)
echo [3] Zapustit oba bota
echo [4] Vyhod
echo.
set /p choice="Vybor (1-4): "

if "%choice%"=="1" (
    echo.
    echo Zapusk osnovnogo bota...
    node bot.js
    pause
)
if "%choice%"=="2" (
    echo.
    echo Zapusk sistemy profitov...
    node profit_system.js
    pause
)
if "%choice%"=="3" (
    echo.
    echo Zapusk oboih botov...
    start "AXE Bot" cmd /k "node bot.js"
    timeout /t 2 /nobreak >nul
    start "Profit System" cmd /k "node profit_system.js"
    echo.
    echo Oba bota zapusheny!
    pause
)
if "%choice%"=="4" (
    exit
)
