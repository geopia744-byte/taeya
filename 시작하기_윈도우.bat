@echo off
chcp 65001 > nul
title 후킹 공장
cd /d "%~dp0"

echo.
echo   ===================================
echo      후킹 공장
echo   ===================================
echo.

python --version >nul 2>&1
if errorlevel 1 (
    echo   [!] 파이썬이 설치되어 있지 않습니다.
    echo.
    echo   1. https://www.python.org/downloads/  에 들어가서
    echo   2. 노란색 Download 버튼을 눌러 설치하세요.
    echo   3. 설치 화면 맨 아래 "Add python.exe to PATH" 를 꼭 체크하세요!
    echo   4. 설치가 끝나면 이 파일을 다시 더블클릭하세요.
    echo.
    pause
    exit /b 1
)

echo   준비 중입니다. 잠시만 기다려 주세요...
python -m pip install --quiet --disable-pip-version-check anthropic
if errorlevel 1 (
    echo.
    echo   [!] 준비 중 문제가 생겼습니다. 인터넷 연결을 확인해 주세요.
    echo.
    pause
    exit /b 1
)

echo.
python app.py
echo.
echo   프로그램이 종료되었습니다.
pause
