@echo off
REM Tek klasor exe uret (dist\JustMusic\JustMusic.exe)
cd /d "%~dp0"
".venv\Scripts\python.exe" build.py %*
echo.
echo Cikti: dist\JustMusic\JustMusic.exe
pause
