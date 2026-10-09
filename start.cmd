@echo off
rem ============================================================
rem  Double-click this file to start the game.
rem
rem  Why not just double-click index.html? Because the app uses
rem  ES Modules, which browsers refuse to execute from file://
rem  (the origin is "null", so the module fetch fails CORS).
rem  The page would load but stay empty. See README.md.
rem
rem  This launcher starts a tiny local server and opens the
rem  browser at the right address.
rem
rem  (Kept ASCII-only on purpose: cmd.exe decodes .cmd files with
rem   the OEM code page, so non-ASCII here would be garbled.
rem   The Chinese guidance is printed by serve.js instead.)
rem ============================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js not found.
  echo   Please install Node.js first, then double-click this file again.
  echo.
  pause
  exit /b 1
)

node "tools\serve.js" --open

echo.
echo   Server stopped. Press any key to close this window.
pause >nul
endlocal
