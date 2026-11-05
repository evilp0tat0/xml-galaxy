@echo off
rem Double-click to start XML Galaxy: runs a small local server and opens the browser.
rem Close this window to stop it.
title XML Galaxy
cd /d "%~dp0"
set PORT=8080

rem Python (the "py" launcher, then "python"; the Microsoft Store stub fails the check)
py -3 -c "import sys" >nul 2>nul && (set "SERVER=py -3 -m http.server %PORT%" & goto serve)
python -c "import sys" >nul 2>nul && (set "SERVER=python -m http.server %PORT%" & goto serve)
rem Node.js
where npx >nul 2>nul && (set "SERVER=npx --yes http-server -p %PORT% -c-1 ." & goto serve)

rem Neither found: open the page straight from disk. Your own files still work.
echo Python or Node.js was not found, so the page opens straight from disk.
echo Your own XML files work; the bundled examples need Python or Node.js.
start "" "%~dp0index.html"
timeout /t 8 >nul
exit /b

:serve
echo XML Galaxy: http://localhost:%PORT%/
echo Keep this window open while you use it. Close it to stop.
echo.
rem Open the browser after a short wait so the server is ready first.
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:%PORT%/"
call %SERVER%
