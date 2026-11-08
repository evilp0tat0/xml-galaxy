@echo off
rem XML viewer: double-click to open the app in your browser.
title XML viewer
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
if errorlevel 1 (
  echo.
  echo The local server could not start, so the page opens straight from disk.
  echo Your own files work this way; only the built-in examples need the server.
  start "" "%~dp0index.html"
  pause
)
