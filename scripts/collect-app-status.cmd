@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0diagnose-app-running.ps1" -SaveToDesktop
echo.
pause
