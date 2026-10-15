@echo off
title 뉴스 AI 자동화
cd /d "%~dp0"

set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY ( where python >nul 2>&1 && set "PY=python" )
if not defined PY ( where python3 >nul 2>&1 && set "PY=python3" )

if not defined PY (
  echo.
  echo   파이썬이 없어.
  echo   ------------------------------------------------
  echo   이 주소에서 받아서 깔아줘. 3분이면 돼.
  echo.
  echo       https://www.python.org/downloads/
  echo.
  echo   깔 때 첫 화면 맨 아래 "Add python.exe to PATH" 에
  echo   반드시 체크해야 해. 안 하면 또 이 글이 나와.
  echo.
  echo   다 깔았으면 이 파일을 다시 두 번 눌러줘.
  echo.
  pause
  exit /b 1
)

%PY% "server.py"

echo.
echo   멈췄어. 아무 키나 누르면 창이 닫혀.
pause >nul
