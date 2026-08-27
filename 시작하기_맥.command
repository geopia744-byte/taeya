#!/bin/bash
cd "$(dirname "$0")"

echo ""
echo "  ==================================="
echo "     이미지 AI 자동화"
echo "  ==================================="
echo ""

if ! command -v python3 >/dev/null 2>&1; then
  echo "  [!] 파이썬이 없습니다."
  echo "      https://www.python.org/downloads/ 에서 설치한 뒤 다시 실행해 주세요."
  echo ""
  read -n 1 -s -r -p "  아무 키나 누르면 닫힙니다"
  exit 1
fi

echo "  준비 중입니다. 잠시만 기다려 주세요..."
python3 -m pip install --quiet --disable-pip-version-check anthropic || {
  echo "  [!] 준비 중 문제가 생겼습니다. 인터넷 연결을 확인해 주세요."
  read -n 1 -s -r -p "  아무 키나 누르면 닫힙니다"
  exit 1
}

echo ""
python3 app.py
echo ""
read -n 1 -s -r -p "  아무 키나 누르면 닫힙니다"
