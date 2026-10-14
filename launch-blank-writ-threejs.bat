@echo off
setlocal
cd /d "%~dp0"
rem Blank Writ (three.js): the browser build. Starts the little static server (serve.py, port from the register:
rem python ports.py get blank-writ-threejs) and opens the game. Close the server window to stop it.
where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found on PATH.
  pause
  exit /b 1
)
echo Launching Blank Writ (three.js).
echo   Click a card to play it, End Term, choose in the events. Settings: language (English / Chinese), music and effects volume.
python "C:\Dev\Prototypes\ports.py" run blank-writ-threejs --path /index.html --ping /index.html -- python "%cd%\serve.py" {port}
if errorlevel 1 pause
