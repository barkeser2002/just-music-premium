@echo off
REM .venv olustur ve bagimliliklari kur
cd /d "%~dp0"
echo [1/3] Sanal ortam olusturuluyor (.venv)...
py -3.13 -m venv .venv || python -m venv .venv
echo [2/3] pip guncelleniyor...
".venv\Scripts\python.exe" -m pip install --upgrade pip
echo [3/3] Bagimliliklar kuruluyor...
".venv\Scripts\python.exe" -m pip install -r requirements.txt
echo.
echo Kurulum tamam. Calistirmak icin: run.bat   ^|  Derlemek icin: build.bat
pause
