@echo off
title 이미지 AI 자동화
cd /d "%~dp0"

echo.
echo   ==============================
echo      이 미 지  A I  자 동 화
echo   ==============================
echo.

set PY=python
python --version >nul 2>&1
if not errorlevel 1 goto HAVEPY
set PY=py
py --version >nul 2>&1
if not errorlevel 1 goto HAVEPY
goto NOPYTHON

:HAVEPY
echo   준비 중입니다. 잠시만 기다려 주세요...
%PY% -m pip install --quiet --disable-pip-version-check anthropic
if errorlevel 1 goto NOINSTALL

rem 영상 자막 지우기에 필요한 부품. 이건 실패해도 그냥 넘어간다 -
rem 영상 기능만 못 쓸 뿐, 사진 기능은 그대로 돌아간다.
%PY% -m pip install --quiet --disable-pip-version-check opencv-python-headless imageio-ffmpeg

echo.
%PY% app.py
echo.
echo   프로그램이 종료되었습니다.
pause
exit /b 0

:NOPYTHON
echo   [!] 파이썬이 설치되어 있지 않습니다.
echo.
echo   1. 아래 주소에서 파이썬을 받아 설치하세요.
echo.
echo        https://www.python.org/downloads/
echo.
echo   2. 설치 화면 맨 아래에 있는
echo        Add python.exe to PATH
echo      를 꼭 체크하세요. 이걸 빼먹으면 또 이 화면이 나옵니다.
echo.
echo   3. 설치가 끝나면 이 파일을 다시 더블클릭하세요.
echo.
pause
exit /b 1

:NOINSTALL
echo.
echo   [!] 준비 중 문제가 생겼습니다.
echo       인터넷 연결을 확인한 뒤 다시 해보세요.
echo.
pause
exit /b 1
