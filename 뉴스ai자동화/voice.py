# -*- coding: utf-8 -*-
"""음성 만들기

두 가지 엔진을 쓴다.

  win     윈도우에 원래 들어 있는 목소리.
          가입·열쇠·카드 아무것도 필요 없고 인터넷도 안 쓴다.
          대신 목소리가 좀 딱딱하다.

  google  구글 Cloud Text-to-Speech.
          열쇠가 필요하지만 월 400만 자까지 공짜고 상업 이용이 허락돼 있다.
          대본 한 편이 4,500자쯤이니 한 달에 890편까지 공짜다.

목소리 목록은 외워 두지 않는다. 엔진에게 직접 물어서 가져온다.
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request

윈도우 = os.name == 'nt'


# ── 윈도우 내장 목소리 ────────────────────────────
def _파워셸(명령):
    """윈도우 파워셸을 조용히 돌린다."""
    p = subprocess.run(
        ['powershell', '-NoProfile', '-NonInteractive', '-Command', 명령],
        capture_output=True, timeout=60,
        creationflags=(subprocess.CREATE_NO_WINDOW if 윈도우 else 0),
    )
    if p.returncode != 0:
        raise RuntimeError((p.stderr or b'').decode('utf-8', 'replace')[:400])
    return (p.stdout or b'').decode('utf-8', 'replace')


def 윈도우목소리():
    """이 컴퓨터에 깔린 목소리를 물어본다."""
    if not 윈도우:
        return []
    # Gender 와 Culture 를 그냥 내보내면 ConvertTo-Json 이
    # 열거형을 숫자로(여성=2) 바꿔 버려서 성별이 "알 수 없음" 으로 뜬다.
    # 그래서 파워셸 쪽에서 미리 글자로 바꿔서 받는다.
    명령 = (
        "Add-Type -AssemblyName System.Speech; "
        "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
        "$s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo } | "
        "Select-Object Name, "
        "@{n='Gender';e={[string]$_.Gender}}, "
        "@{n='Culture';e={[string]$_.Culture}} "
        "| ConvertTo-Json -Compress"
    )
    try:
        글 = _파워셸(명령).strip()
    except Exception:
        return []
    if not 글:
        return []
    표 = json.loads(글)
    if isinstance(표, dict):
        표 = [표]
    모음 = []
    for v in 표:
        이름 = v.get('Name', '')
        나라 = str(v.get('Culture', ''))
        # 혹시라도 숫자로 오면(윈도우 판에 따라 다르다) 숫자도 알아듣는다
        성 = v.get('Gender', '')
        표 = {'Male': '남성', 'Female': '여성', 'Neutral': '중성',
              1: '남성', 2: '여성', 3: '중성',
              '1': '남성', '2': '여성', '3': '중성'}
        모음.append({
            'id': 이름,
            '이름': 이름,
            '성별': 표.get(성, '알 수 없음'),
            '언어': 나라,
            '한국어': 나라.lower().startswith('ko'),
            '종류': '한국어' if 나라.lower().startswith('ko') else 나라,
        })
    모음.sort(key=lambda x: (not x['한국어'], x['이름']))
    return 모음


def 윈도우말하기(글, 목소리, 속도, 저장할곳):
    """윈도우 목소리로 wav 파일을 만든다.

    파워셸의 Rate 는 -10 에서 10 까지다. 1.0배가 0 이 되도록 맞춘다.
    """
    rate = max(-10, min(10, int(round((속도 - 1.0) * 10))))
    안전글 = 글.replace("'", "''")
    명령 = (
        "Add-Type -AssemblyName System.Speech; "
        "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
        + (f"$s.SelectVoice('{목소리}'); " if 목소리 else "")
        + f"$s.Rate = {rate}; "
        f"$s.SetOutputToWaveFile('{저장할곳}'); "
        f"$s.Speak('{안전글}'); "
        "$s.Dispose()"
    )
    _파워셸(명령)
    return 저장할곳


# ── 구글 Cloud Text-to-Speech ─────────────────────
구글목소리주소 = 'https://texttospeech.googleapis.com/v1/voices?languageCode=ko-KR&key=%s'
구글만들기주소 = 'https://texttospeech.googleapis.com/v1/text:synthesize?key=%s'


def 열쇠다듬기(열쇠):
    """열쇠에 섞여 들어온 공백·따옴표를 떼고, 주소에 넣어도 안전하게 만든다."""
    글 = (열쇠 or '').strip().strip('"').strip("'")
    if not 글:
        raise RuntimeError('구글 열쇠가 비어 있어')
    if any(ord(ㄱ) > 127 for ㄱ in 글):
        raise RuntimeError('열쇠에 한글이나 특수문자가 섞여 있어. '
                           '구글 콘솔에서 받은 영문·숫자 열쇠를 그대로 붙여 넣어줘')
    return urllib.parse.quote(글, safe='')


def 구글목소리(열쇠):
    """구글에게 한국어 목소리 목록을 물어본다."""
    열쇠 = 열쇠다듬기(열쇠)
    req = urllib.request.Request(구글목소리주소 % 열쇠)
    with urllib.request.urlopen(req, timeout=30) as r:
        표 = json.load(r)
    모음 = []
    for v in 표.get('voices', []):
        이름 = v.get('name', '')
        성 = v.get('ssmlGender', '')
        모음.append({
            'id': 이름,
            '이름': 이름,
            '성별': {'MALE': '남성', 'FEMALE': '여성'}.get(성, '중성'),
            '언어': 'ko-KR',
            '한국어': True,
            '종류': 종류이름(이름),
        })
    # 좋은 것이 위로 오게
    순서 = {'Chirp3 HD': 0, 'Neural2': 1, 'Wavenet': 2, 'Standard': 3}
    모음.sort(key=lambda x: (순서.get(x.get('종류', ''), 9), x['성별'], x['이름']))
    return 모음


def 종류이름(이름):
    for 표시, 글 in (('Chirp3-HD', 'Chirp3 HD'), ('Neural2', 'Neural2'),
                     ('Wavenet', 'Wavenet'), ('Standard', 'Standard')):
        if 표시.lower() in 이름.lower():
            return 글
    return ''


def 구글말하기(글, 목소리, 속도, 저장할곳, 열쇠):
    """구글로 mp3 파일을 만든다. 속도는 0.25~4.0 을 받는다."""
    열쇠 = 열쇠다듬기(열쇠)
    몸 = {
        'input': {'text': 글},
        'voice': {'languageCode': 'ko-KR', 'name': 목소리},
        'audioConfig': {
            'audioEncoding': 'MP3',
            'speakingRate': max(0.25, min(4.0, float(속도))),
        },
    }
    req = urllib.request.Request(
        구글만들기주소 % 열쇠,
        data=json.dumps(몸).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        답 = json.load(r)
    소리 = 답.get('audioContent')
    if not 소리:
        raise RuntimeError('구글이 소리를 주지 않았어: ' + str(답)[:300])
    import base64
    with open(저장할곳, 'wb') as f:
        f.write(base64.b64decode(소리))
    return 저장할곳


# ── 공통 ──────────────────────────────────────────
def 목소리목록(엔진, 열쇠=''):
    if 엔진 == 'google':
        if not 열쇠:
            return [], '구글 열쇠가 없어'
        try:
            return 구글목소리(열쇠), None
        except Exception as e:
            return [], 까닭(e)
    목록 = 윈도우목소리()
    if not 목록:
        return [], ('윈도우가 아니라서 내장 목소리를 못 써'
                    if not 윈도우 else '깔린 목소리를 찾지 못했어')
    return 목록, None


def 까닭(e):
    글 = str(e)
    if 'API_KEY_INVALID' in 글 or '400' in 글:
        return '열쇠가 틀렸거나 Text-to-Speech API 가 안 켜져 있어'
    if '403' in 글:
        return '열쇠에 권한이 없어. 구글 콘솔에서 Text-to-Speech API 를 켜줘'
    if '429' in 글:
        return '한도를 넘었어. 잠시 뒤 다시'
    return 글[:200]


def 한문장(글, 엔진, 목소리, 속도, 저장할곳, 열쇠=''):
    if 엔진 == 'google':
        return 구글말하기(글, 목소리, 속도, 저장할곳, 열쇠)
    return 윈도우말하기(글, 목소리, 속도, 저장할곳)


def 길이재기(파일):
    """소리 파일이 몇 초인지 잰다. ffprobe 가 있으면 쓰고, 없으면 wav 머리를 읽는다."""
    try:
        import shutil
        ff = shutil.which('ffprobe')
        if ff:
            p = subprocess.run(
                [ff, '-v', 'error', '-show_entries', 'format=duration',
                 '-of', 'default=noprint_wrappers=1:nokey=1', 파일],
                capture_output=True, timeout=30,
                creationflags=(subprocess.CREATE_NO_WINDOW if 윈도우 else 0),
            )
            글 = (p.stdout or b'').decode().strip()
            if 글:
                return round(float(글), 3)
    except Exception:
        pass
    try:
        import wave
        with wave.open(파일, 'rb') as w:
            return round(w.getnframes() / float(w.getframerate()), 3)
    except Exception:
        return None


if __name__ == '__main__':
    엔진 = sys.argv[1] if len(sys.argv) > 1 else 'win'
    열쇠 = sys.argv[2] if len(sys.argv) > 2 else ''
    목록, 왜 = 목소리목록(엔진, 열쇠)
    print('엔진:', 엔진, '· 찾은 목소리:', len(목록), ('· ' + 왜) if 왜 else '')
    for v in 목록[:20]:
        print('  ', v['성별'], v['이름'], v.get('종류', ''))
