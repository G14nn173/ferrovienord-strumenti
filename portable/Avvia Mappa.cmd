@echo off
title FERROVIENORD - Mappa interattiva V1
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
if errorlevel 1 (
  echo.
  echo Impossibile avviare la mappa.
  echo Verifica che PowerShell sia disponibile e riprova.
  pause
)
