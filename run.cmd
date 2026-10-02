@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer first.
  pause
  exit /b 1
)
if not exist node_modules call npm.cmd ci
if errorlevel 1 exit /b 1
call npm.cmd run build
if errorlevel 1 exit /b 1
echo Open http://127.0.0.1:4310 in your browser.
call npm.cmd start
