@echo off
title FERROVIENORD - RDS Mod. 0308
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
if errorlevel 1 (
  echo.
  echo Impossibile avviare l'applicazione.
  echo Verifica che PowerShell sia disponibile e riprova.
  pause
)
