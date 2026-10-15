# -*- coding: utf-8 -*-
"""영상 만들기 — 그림 + 길이 + 자막 + 소리 를 mp4 하나로.

하는 일
  1. 컷마다 그림을 그 길이만큼 늘려 1920x1080 영상 토막으로 만든다
     (정지 화면은 보기 싫으므로 천천히 밀고 당긴다 — 켄 번스)
  2. 토막들을 이어 붙인다
  3. 자막을 화면에 굽는다 (ASS 자막, 참고자료 스펙 그대로)
  4. 나레이션 소리를 얹는다

자막 스펙 (사용자가 준 참고자료 「볼케이노_자막_스펙」 값 그대로)
  반투명 어두운 박스 rgba(28,28,28,.55) 안에 흰 글씨
  Pretendard SemiBold 56px (ASS 환산 77)
  화면 바닥에서 80px 위, 항상 한 줄
  0.25초 동안 아래에서 올라오며 나타남
"""

import json
import os
import re
import shutil
import subprocess

가로, 세로, 초당 = 1920, 1080, 30
윈도우 = os.name == 'nt'


def _돌리기(명령, 분=30):
    p = subprocess.run(
        명령, capture_output=True, timeout=분 * 60,
        creationflags=(subprocess.CREATE_NO_WINDOW if 윈도우 else 0),
    )
    if p.returncode:
        raise RuntimeError((p.stderr or b'').decode('utf-8', 'replace')[-1200:])
    return p


def 시각(초):
    """ASS 가 쓰는 0:00:00.00 모양으로."""
    초 = max(0.0, float(초))
    시 = int(초 // 3600)
    분 = int((초 % 3600) // 60)
    남 = 초 % 60
    return '%d:%02d:%05.2f' % (시, 분, 남)


def 자막글(글, 최대=22):
    """한 줄이 길면 쉼표나 띄어쓰기에서 나눈다. 필요하면 여러 줄로.

    두세 낱말씩 토막 내지 않는다. 그러면 읽기가 더 어렵다.
    한 줄은 반드시 최대 글자 안에 들어와야 한다.
    1920 폭에 56px 글자면 22자쯤이 한계다. 넘으면 화면 밖으로 나간다.
    """
    글 = (글 or '').strip()
    if not 글:
        return []
    if len(글) <= 최대:
        return [글]

    조각, 남은 = [], 글
    while len(남은) > 최대:
        # 자를 자리를 뒤에서부터 찾는다: 쉼표 → 띄어쓰기 → 그냥 끊기
        칸 = 남은.rfind(',', 0, 최대 + 1)
        if 칸 > 최대 // 3:
            조각.append(남은[:칸 + 1].strip())
            남은 = 남은[칸 + 1:].strip()
            continue
        칸 = 남은.rfind(' ', 0, 최대 + 1)
        if 칸 > 최대 // 3:
            조각.append(남은[:칸].strip())
            남은 = 남은[칸:].strip()
            continue
        조각.append(남은[:최대].strip())
        남은 = 남은[최대:].strip()
    if 남은:
        조각.append(남은)
    return [x for x in 조각 if x]


def ass만들기(줄들, 저장할곳, 최대글자=22):
    """자막 파일을 쓴다.

    줄들: [{'시작':초, '끝':초, '글':'...'}, ...]
    """
    머리 = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {가로}
PlayResY: {세로}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,Pretendard SemiBold,56,&H00FFFFFF,&H00FFFFFF,&H73282828,&H00000000,0,0,0,0,100,100,-0.5,0,3,12,0,2,60,60,80,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    몸 = []
    for r in 줄들:
        조각 = 자막글(r['글'], 최대글자)
        if not 조각:
            continue
        길이 = max(0.4, float(r['끝']) - float(r['시작']))
        몫 = 길이 / len(조각)
        for i, 글 in enumerate(조각):
            a = float(r['시작']) + 몫 * i
            b = a + 몫
            안전 = 글.replace('\\', '').replace('{', '(').replace('}', ')')
            몸.append('Dialogue: 0,%s,%s,Sub,,0,0,0,,{\\fad(250,0)}%s'
                      % (시각(a), 시각(b), 안전))
    with open(저장할곳, 'w', encoding='utf-8') as f:
        f.write(머리 + '\n'.join(몸) + '\n')
    return 저장할곳


def 컷토막(그림, 초, 저장할곳, 움직임='in'):
    """그림 한 장을 그 길이만큼 영상 토막으로.

    정지 화면은 쓰지 않는다. 천천히 밀고 당긴다.
    줌은 1.08배를 넘기지 않는다. 더 키우면 화질이 뭉개진다.
    """
    칸수 = max(2, int(round(초 * 초당)))
    # 큰 판에 그린 뒤 줄여야 줌이 떨릴 때 계단이 안 생긴다
    배 = 2
    if 움직임 == 'out':
        z = "'if(eq(on,0),1.08,max(zoom-0.0008,1.0))'"
    else:
        z = "'min(zoom+0.0008,1.08)'"
    거르기 = (
        "scale=%d:%d:force_original_aspect_ratio=increase,"
        "crop=%d:%d,scale=%d:%d,"
        "zoompan=z=%s:d=%d:s=%dx%d:fps=%d,"
        "format=yuv420p"
        % (가로 * 배, 세로 * 배, 가로 * 배, 세로 * 배,
           가로 * 배, 세로 * 배, z, 칸수, 가로, 세로, 초당)
    )
    _돌리기(['ffmpeg', '-y', '-loop', '1', '-i', 그림,
            '-vf', 거르기, '-t', '%.3f' % 초,
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
            '-pix_fmt', 'yuv420p', '-r', str(초당), 저장할곳])
    return 저장할곳


def 빈토막(초, 저장할곳, 글=''):
    """그림이 없는 컷을 위한 어두운 바탕."""
    _돌리기(['ffmpeg', '-y', '-f', 'lavfi',
            '-i', 'color=c=0x0d1218:s=%dx%d:r=%d' % (가로, 세로, 초당),
            '-t', '%.3f' % 초, '-c:v', 'libx264', '-preset', 'veryfast',
            '-crf', '20', '-pix_fmt', 'yuv420p', 저장할곳])
    return 저장할곳


def 이어붙이기(토막들, 저장할곳, 작업칸):
    """영상 토막들을 하나로 잇는다."""
    목록 = os.path.join(작업칸, '목록.txt')
    with open(목록, 'w', encoding='utf-8') as f:
        for t in 토막들:
            f.write("file '%s'\n" % os.path.abspath(t).replace('\\', '/'))
    _돌리기(['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', 목록,
            '-c', 'copy', 저장할곳], 분=60)
    return 저장할곳


def 자막굽기(영상, 자막, 저장할곳):
    """자막을 화면에 구워 넣는다. 따로 켜고 끌 수 없게 박힌다."""
    길 = os.path.abspath(자막).replace('\\', '/')
    if 윈도우:                       # C:\ 의 콜론을 ffmpeg 가 싫어한다
        길 = 길.replace(':', '\\:')
    _돌리기(['ffmpeg', '-y', '-i', 영상, '-vf', "ass='%s'" % 길,
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
            '-pix_fmt', 'yuv420p', '-c:a', 'copy', 저장할곳], 분=90)
    return 저장할곳


def 소리얹기(영상, 소리, 저장할곳):
    """나레이션을 얹는다. 영상 길이에 맞춰 자른다."""
    _돌리기(['ffmpeg', '-y', '-i', 영상, '-i', 소리,
            '-map', '0:v:0', '-map', '1:a:0',
            '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
            '-shortest', '-movflags', '+faststart', 저장할곳], 분=60)
    return 저장할곳


def 길이재기(파일):
    ff = shutil.which('ffprobe')
    if not ff:
        return None
    try:
        p = subprocess.run(
            [ff, '-v', 'error', '-show_entries', 'format=duration',
             '-of', 'default=noprint_wrappers=1:nokey=1', 파일],
            capture_output=True, timeout=60,
            creationflags=(subprocess.CREATE_NO_WINDOW if 윈도우 else 0))
        글 = (p.stdout or b'').decode().strip()
        return round(float(글), 3) if 글 else None
    except Exception:
        return None
