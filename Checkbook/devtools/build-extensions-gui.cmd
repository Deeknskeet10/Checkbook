@echo off
rem Double-click to open the Build Extensions GUI (PCF versions + build).
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "%~dp0build-extensions-gui.ps1"
