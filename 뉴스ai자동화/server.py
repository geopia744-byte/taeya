# -*- coding: utf-8 -*-
"""뉴스ai자동화 — 작은 서버 (1차)

파이썬에 원래 들어 있는 기능만 쓴다. 따로 설치할 게 없다.
켜면 크롬 창이 저절로 열린다. 검은 창은 닫지 말 것.
"""

import json, os, re, sys, time, uuid, threading, webbrowser, socket, subprocess
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cutter
import voice

여기 = os.path.dirname(os.path.abspath(__file__))
웹 = os.path.join(여기, 'web')
자료 = os.path.join(여기, 'data')
프로젝트칸 = os.path.join(자료, 'projects')

os.makedirs(프로젝트칸, exist_ok=True)


# ── 파일 읽고 쓰기 ────────────────────────────────
def 읽기(경로, 기본):
    try:
        with open(경로, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return 기본


쓰기자물쇠 = threading.Lock()


def 쓰기(경로, 값):
    """여러 요청이 한꺼번에 들어와도 파일이 깨지지 않게 쓴다.

    - 자물쇠로 한 번에 하나만 쓰게 한다
    - 임시 이름을 요청마다 다르게 해서 서로 덮어쓰지 않게 한다
    """
    with 쓰기자물쇠:
        os.makedirs(os.path.dirname(경로), exist_ok=True)
        tmp = '%s.%d.tmp' % (경로, threading.get_ident())
        try:
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(값, f, ensure_ascii=False, indent=2)
            os.replace(tmp, 경로)
        finally:
            if os.path.exists(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass


def 작업들():
    out = []
    for d in sorted(os.listdir(프로젝트칸)):
        p = os.path.join(프로젝트칸, d, 'job.json')
        if os.path.exists(p):
            v = 읽기(p, None)
            if v:
                out.append(v)
    return out


def 작업저장(j):
    쓰기(os.path.join(프로젝트칸, j['id'], 'job.json'), j)


# ── 클로드 코드가 이 PC에 깔려 있나 ──────────────
import shutil, subprocess

클로드길 = None
for 이름 in ('claude', 'claude.cmd', 'claude.exe'):
    찾음 = shutil.which(이름)
    if 찾음:
        클로드길 = 찾음
        break

# 돌고 있는 생성 작업  {작업id: {상태, 글, 오류}}
생성중 = {}
생성자물쇠 = threading.Lock()


import urllib.request, html as _html, re as _re

브라우저인척 = {
    'User-Agent': ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                   '(KHTML, like Gecko) Chrome/124.0 Safari/537.36'),
    'Accept-Language': 'ko-KR,ko;q=0.9',
}


def 기사읽기(주소, 최대글자=12000):
    """뉴스 기사 주소를 열어서 본문 글만 뽑는다.

    클로드 코드에게 주소를 주면 WebFetch 권한을 물어보느라 멈춘다.
    그래서 여기서 먼저 읽어 글로 바꿔 넘긴다.
    """
    주소 = (주소 or '').strip()
    if not 주소.startswith('http'):
        return None, '주소가 아니야'
    try:
        req = urllib.request.Request(주소, headers=브라우저인척)
        with urllib.request.urlopen(req, timeout=25) as r:
            원본 = r.read()
        글 = 원본.decode('utf-8', 'replace')
    except Exception as e:
        return None, str(e)[:200]

    # 네이버 뉴스는 본문 칸이 정해져 있다
    본문 = None
    for 패턴 in (r'<div[^>]+id="dic_area"[^>]*>(.*?)</div>',
                r'<article[^>]*>(.*?)</article>',
                r'<div[^>]+id="newsct_article"[^>]*>(.*?)</div>'):
        m = _re.search(패턴, 글, _re.S | _re.I)
        if m:
            본문 = m.group(1)
            break
    덩어리 = 본문 or 글

    제목 = ''
    m = _re.search(r'<title[^>]*>(.*?)</title>', 글, _re.S | _re.I)
    if m:
        제목 = _html.unescape(_re.sub(r'<[^>]+>', '', m.group(1))).strip()

    덩어리 = _re.sub(r'<(script|style|noscript)[^>]*>.*?</\1>', ' ', 덩어리, flags=_re.S | _re.I)
    덩어리 = _re.sub(r'<br\s*/?>|</p>|</div>', '\n', 덩어리, flags=_re.I)
    덩어리 = _re.sub(r'<[^>]+>', ' ', 덩어리)
    덩어리 = _html.unescape(덩어리)
    덩어리 = _re.sub(r'[ \t ]+', ' ', 덩어리)
    덩어리 = _re.sub(r'\n\s*\n\s*\n+', '\n\n', 덩어리).strip()

    if len(덩어리) < 150:
        return None, '본문을 찾지 못했어 (글이 너무 짧음)'
    return {'제목': 제목, '본문': 덩어리[:최대글자]}, None


def 기사붙이기(질문, 주소들):
    """질문에 기사 본문을 끼워 넣는다. 못 읽은 주소는 그대로 남긴다."""
    모음, 못읽음 = [], []
    for u in [x.strip() for x in (주소들 or '').splitlines() if x.strip()][:3]:
        글, 왜 = 기사읽기(u)
        if 글:
            모음.append('■ %s\n%s\n\n%s' % (글['제목'] or u, u, 글['본문']))
        else:
            못읽음.append('%s  (%s)' % (u, 왜))
    if not 모음 and not 못읽음:
        return 질문
    덧 = ''
    if 모음:
        덧 += ('\n\n[기사 본문 — 아래 글을 바탕으로 써라. 따로 인터넷을 뒤질 필요 없다]\n'
               + '\n\n────────\n\n'.join(모음))
    if 못읽음:
        덧 += '\n\n[못 읽은 주소 — 내용을 모르니 추측하지 말 것]\n' + '\n'.join(못읽음)
    return 질문 + 덧


def 음성대조(jid, 대본):
    """만들어 둔 음성이 대본을 전부 덮고 있는지 글자 단위로 맞춰 본다.

    "대본 어디까지 음성으로 만든 거야?" 라는 물음에
    말이 아니라 숫자로 답하기 위한 것이다.

    띄어쓰기와 줄바꿈은 빼고 센다. 소리로는 안 나는 것들이라
    넣고 세면 괜히 안 맞는 것처럼 보인다.
    """
    칸 = os.path.join(프로젝트칸, jid or '', '음성')
    표 = 읽기(os.path.join(칸, '목록.json'), None)
    if not isinstance(표, list) or not 표:
        return {'있음': False}

    def 알맹이(글):
        return re.sub(r'\s', '', 글 or '')

    대본알 = 알맹이(대본)
    음성알 = 알맹이(''.join(x.get('글', '') for x in 표))

    줄 = []
    for x in 표:
        이름 = x.get('파일', '')
        있 = os.path.exists(os.path.join(칸, 이름)) if 이름 else False
        줄.append({
            '번호': x.get('번호'),
            '글': x.get('글', ''),
            '초': x.get('초') or 0,
            '파일': 이름,
            '파일있음': 있,
            '글자': len(알맹이(x.get('글', ''))),
        })

    없는파일 = [r['번호'] for r in 줄 if not r['파일있음']]
    빈것 = [r['번호'] for r in 줄 if not r['초']]

    return {
        '있음': True,
        '줄': 줄,
        '문장수': len(줄),
        '전체초': round(sum(r['초'] for r in 줄), 2),
        '대본글자': len(대본알),
        '음성글자': len(음성알),
        '덮은비율': (round(len(음성알) / len(대본알) * 100, 1)
                    if 대본알 else 0),
        '똑같음': 대본알 == 음성알,
        '없는파일': 없는파일,
        '빈것': 빈것,
        '폴더': os.path.abspath(칸),
    }


def 잰길이(jid, 대본):
    """이미 만들어 둔 음성이 있으면 문장마다 실제 길이를 가져온다.

    컷을 나눌 때 글자 수로 어림잡는 것보다 이쪽이 정확하다.
    말이 빠른 문장과 느린 문장이 섞여 있어도 그림이 어긋나지 않는다.

    대본이 음성을 만든 뒤에 고쳐졌으면 길이가 안 맞으므로 쓰지 않는다.
    (문장 수가 다르면 어림짐작으로 돌아간다)
    """
    if not jid:
        return None, False
    표 = 읽기(os.path.join(프로젝트칸, jid, '음성', '목록.json'), None)
    if not isinstance(표, list) or not 표:
        return None, False
    지금문장 = cutter.문장나누기(대본 or '')
    if len(지금문장) != len(표):
        return None, False
    길이 = []
    for x in 표:
        초 = x.get('초')
        if not isinstance(초, (int, float)) or 초 <= 0:
            return None, False
        길이.append(float(초))
    return 길이, True


# 돌고 있는 음성 작업
음성중 = {}

# 돌고 있는 프롬프트 작업
프롬프트중 = {}


def 프롬프트질문(컷들, 화풍영문, 인물):
    """컷 전부를 한 번에 보내는 질문을 만든다.

    컷마다 따로 물으면 인물과 배경이 컷마다 달라진다.
    (3번 컷의 회장과 17번 컷의 회장이 다른 사람이 된다)
    한 번에 보내야 앞뒤를 보고 같은 사람으로 그려 준다.
    """
    줄 = '\n'.join('%d. %s' % (c['번호'], c['대본']) for c in 컷들)
    return f"""되묻지 마라. 아래 지시만으로 바로 답해라.

너는 유튜브 롱폼 영상의 장면을 설계한다.
대본이 {len(컷들)}개의 컷으로 나뉘어 있다. 컷 하나에 그림 한 장이 들어간다.

[가장 중요한 것]
그림은 그 컷의 대본을 **설명해야** 한다. 분위기만 비슷해서는 안 된다.
컷마다 스스로 이렇게 점검해라.

    "소리를 끄고 이 그림만 봐도, 이 컷이 무슨 말을 하는지 알 수 있나?"

알 수 없으면 그 프롬프트는 틀린 것이다. 다시 짜라.

[컷마다 이 차례대로 생각하라]
 1. 이 컷이 말하려는 것은 **딱 한 가지**다. 그게 뭔지 먼저 정한다.
 2. 그 한 가지를 보여 줄 **주인공 하나**를 정한다.
 3. 그 주인공을 어떤 화면으로 잡을지 정한다.
    (wide establishing shot / medium shot / close-up / overhead view 중 하나를 반드시 적는다)

[반드시 지킬 것]

1) 주인공은 하나다.
   두 가지를 한 화면에 욱여넣으면 둘 다 안 보인다.
   나쁜 예: 금고도 보여주고 아파트 단지도 보여주고 도시 야경도 보여준다
   좋은 예: 금고 하나를 꽉 차게 잡는다

2) 대본에 없는 것을 넣지 마라.
   특히 **사람을 멋대로 넣지 마라.** 대본이 사람을 말하지 않으면 사람은 없다.
   국기, 상표, 특정 나라 건물도 대본이 말하지 않으면 넣지 마라.

3) 부정어를 쓰지 마라. 영어에 no, without, avoid, not 을 적지 마라.
   그림 AI 는 「~하지 마」를 못 알아듣고 오히려 그것을 그린다.
   실제로 "no people" 이라고 적었더니 사람이 화면 주인공으로 나왔다.
   빼고 싶으면 그 말을 아예 쓰지 말고, 대신 **있는 것만** 적어라.
   나쁜 예: a vault, no people, no text
   좋은 예: an empty vault interior, silent and still

4) 크기를 견주는 대본은 **한 화면에 나란히** 놓아라.
   "A가 B만큼이다" 는 A와 B가 같이 보이고 크기 차이가 느껴져야 뜻이 산다.
   나쁜 예: 돈을 그리고 배경에 아파트를 깐다
   좋은 예: 왼쪽에 돈더미, 오른쪽에 같은 높이로 쌓인 아파트 모형,
            둘이 저울 양쪽처럼 마주 보게

5) 추상적인 말은 **눈에 보이는 물건**으로 바꿔라.
   지분 10퍼센트 → 원그래프 모양으로 자른 건물 모형의 한 조각
   부채 부담 → 어깨에 얹힌 거대한 쇳덩이
   전력 수요 급증 → 바늘이 끝까지 올라간 계기판

6) 글자는 그림에 넣지 마라. 자막을 따로 얹는다.
   그러니 숫자를 그대로 쓰지 말고 **양으로** 보여라.
   (3조 7000억 원 → 사람 키를 훌쩍 넘는 돈더미)

7) 실존 인물의 얼굴을 그리지 마라. 직책과 차림으로 적어라.
   (예: a Korean executive in a dark suit)
   대본이 사람을 말할 때만 넣는다.

8) 같은 사람이 여러 컷에 나오면 생김새·옷차림을 똑같이 유지하라.

9) 영문 프롬프트에 화풍이나 화면비를 적지 마라. 내가 따로 붙인다.
   장면의 내용만 영어로 적어라. 30~60단어가 알맞다.

[답 모양]
컷 {len(컷들)}개 전부에 대해 빠짐없이 한 줄씩 써라. 건너뛰지 마라.
한 줄은 반드시 이 모양이다. 앞뒤에 다른 말을 붙이지 마라.

    번호 | 장면 묘사 | 영문 프롬프트

장면 묘사는 한국어 한 문장으로,
**이 그림을 보면 시청자가 무엇을 알게 되는지**까지 적어라.
{인물}
[대본 컷]
{줄}
"""


def 프롬프트만들기(jid, d):
    """컷 전부의 장면 묘사와 영문 프롬프트를 한 번에 받아온다."""
    def 상태(**kw):
        with 생성자물쇠:
            프롬프트중.setdefault(jid, {}).update(kw)

    상태(상태='도는중', 오류='', 단계='장면 설계 중', 시작=time.time(), 한것=0)
    try:
        컷들 = d.get('cuts') or []
        if not 컷들:
            상태(상태='실패', 오류='컷이 없어. 먼저 스토리보드를 만들어줘')
            return
        상태(전체=len(컷들))
        질문 = 프롬프트질문(컷들, d.get('styleEn', ''), d.get('charLine', ''))

        칸 = os.path.join(프로젝트칸, jid, '진단')
        os.makedirs(칸, exist_ok=True)
        with open(os.path.join(칸, '프롬프트_보낸질문.txt'), 'w',
                  encoding='utf-8') as f:
            f.write(질문)

        답 = 클로드한번(질문, 분=20)

        with open(os.path.join(칸, '프롬프트_받은답.txt'), 'w',
                  encoding='utf-8') as f:
            f.write(답 or '')

        줄들 = []
        for 줄 in (답 or '').splitlines():
            줄 = 줄.strip()
            if 줄.count('|') < 2:
                continue
            쪽 = [x.strip() for x in 줄.split('|')]
            번호 = re.sub(r'[^0-9]', '', 쪽[0])
            if not 번호:
                continue
            줄들.append({'번호': int(번호), '묘사': 쪽[1], '원문': 쪽[2]})

        if not 줄들:
            상태(상태='실패',
                 오류='클로드 답에서 「번호 | 묘사 | 영문」 줄을 못 찾았어. '
                      '진단 폴더의 프롬프트_받은답.txt 를 봐줘')
            return

        줄들.sort(key=lambda x: x['번호'])
        있는번호 = {x['번호'] for x in 줄들}
        빠진 = [c['번호'] for c in 컷들 if c['번호'] not in 있는번호]
        상태(상태='끝', 줄=줄들, 한것=len(줄들), 빠진=빠진)
    except Exception as e:
        상태(상태='실패', 오류=str(e)[:400])


def 음성만들기(jid, d):
    """대본을 문장으로 쪼개고 하나씩 소리로 만든다.

    문장마다 실제 길이를 재서 돌려준다. 그 길이가 있어야
    스토리보드에서 12~13초씩 정확하게 묶을 수 있다.
    """
    def 상태(**kw):
        with 생성자물쇠:
            음성중.setdefault(jid, {}).update(kw)

    상태(상태='도는중', 한것=0, 전체=0, 오류='', 지금='')
    try:
        글 = (d.get('script') or '').strip()
        문장 = cutter.문장나누기(글)
        if not 문장:
            상태(상태='실패', 오류='대본이 비어 있어')
            return

        칸 = os.path.join(프로젝트칸, jid, '음성')
        os.makedirs(칸, exist_ok=True)
        for 옛 in os.listdir(칸):
            try:
                os.remove(os.path.join(칸, 옛))
            except OSError:
                pass

        엔진 = d.get('engine', 'win')
        끝 = '.mp3' if 엔진 == 'google' else '.wav'
        상태(전체=len(문장))

        결과 = []
        for i, s in enumerate(문장, 1):
            with 생성자물쇠:
                if 음성중.get(jid, {}).get('멈춰'):
                    상태(상태='멈춤')
                    return
            이름 = '%04d%s' % (i, 끝)
            파일 = os.path.join(칸, 이름)
            상태(한것=i - 1, 지금=s['글'][:40])
            voice.한문장(s['글'], 엔진, d.get('voice', ''),
                        float(d.get('rate', 1.0)), 파일, d.get('key', ''))
            초 = voice.길이재기(파일) or cutter.읽는시간(s['글'])
            결과.append({'번호': i, '글': s['글'], '파일': 이름, '초': 초})

        쓰기(os.path.join(프로젝트칸, jid, '음성', '목록.json'), 결과)
        상태(상태='끝', 한것=len(문장), 목록=결과,
             전체초=round(sum(x['초'] for x in 결과), 2))
    except Exception as e:
        상태(상태='실패', 오류=voice.까닭(e))


def 클로드한번(질문, 분=30):
    """클로드를 한 번 불러 글을 받아온다.

    질문을 명령줄에 붙이면 안 된다.
    윈도우에서 claude 는 .cmd 배치 파일이라 cmd.exe 를 거치는데,
    cmd.exe 는 명령줄을 8,191자에서 잘라 버린다.
    기사 본문이 들어간 질문은 그걸 쉽게 넘어서 뒷부분이 통째로 날아가고,
    반쪽짜리 질문을 받은 클로드가 "뭘 쓸까요?" 하고 되묻게 된다.
    그래서 질문은 표준입력으로 흘려 넣는다. 길이 제한이 없다.
    """
    p = subprocess.run(
        [클로드길, '-p', '--allowedTools', 'WebFetch,WebSearch'],
        input=질문.encode('utf-8'),
        capture_output=True, timeout=분 * 60,
        creationflags=(subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0),
    )
    나온글 = (p.stdout or b'').decode('utf-8', 'replace').strip()
    에러 = (p.stderr or b'').decode('utf-8', 'replace').strip()
    if not 나온글:
        raise RuntimeError(에러[:600] or ('끝난 값 %d' % p.returncode))
    return 나온글


def 토막내서쓰기(작업id, 질문, 목표자, 상태):
    """긴 대본은 한 번에 못 받는다. 차례를 먼저 잡고 토막 내서 이어 쓴다.

    클로드 한 번에 안전하게 받을 수 있는 양을 6,000자쯤으로 본다.
    """
    토막수 = max(2, -(-목표자 // 6000))
    상태(단계='차례 잡는 중 (전체 %d토막)' % 토막수)

    차례질문 = (질문 + '\n\n[지금은 대본을 쓰지 마라]\n'
                '위 구조와 기사를 바탕으로, 대본을 %d개 토막으로 나눌 차례표만 써라.\n'
                '한 줄에 하나씩, 이 모양으로만 출력해라. 설명은 쓰지 마라.\n'
                '번호. 소제목 | 이 토막에서 다룰 내용 한 문장 | 목표 글자수\n'
                '전체 글자수의 합이 %d자가 되게 나눠라.' % (토막수, 목표자))
    차례 = 클로드한번(차례질문, 분=15)

    줄 = [l.strip() for l in 차례.splitlines() if '|' in l]
    if len(줄) < 2:
        raise RuntimeError('차례표를 제대로 못 받았어:\n' + 차례[:400])

    모은글 = []
    for i, l in enumerate(줄, 1):
        상태(단계='대본 쓰는 중 (%d/%d토막)' % (i, len(줄)), 글='\n\n'.join(모은글))
        앞부분 = ('\n\n[바로 앞 토막의 끝부분 — 자연스럽게 이어 써라]\n...'
                  + 모은글[-1][-400:]) if 모은글 else ''
        토막질문 = (질문
                    + '\n\n[전체 차례표]\n' + 차례
                    + 앞부분
                    + '\n\n[지금 쓸 것]\n' + l
                    + '\n\n이 토막만 써라. 소제목이나 번호를 쓰지 마라. 본문만 출력해라.'
                      '\n인사말이나 마무리 인사를 넣지 마라.'
                    + ('\n이 토막이 마지막이다. 여운을 남기는 한 문장으로 끝내라.'
                       if i == len(줄) else
                       '\n이 토막은 마지막이 아니다. 다음 토막으로 넘어가는 한 문장으로 끝내라.'))
        모은글.append(다듬기서버(클로드한번(토막질문, 분=20)))

    return '\n\n'.join(모은글)


def 다듬기서버(t):
    t = (t or '').strip()
    t = _re.sub(r'^```[a-z]*\s*', '', t, flags=_re.I)
    t = _re.sub(r'```\s*$', '', t)
    t = _re.sub(r'^(네[,.]?\s*|알겠습니다[,.]?\s*|여기\s*있습니다[.:]?\s*)', '', t)
    return t.strip()


def 클로드부르기(작업id, 질문, 목표자=0):
    """대본을 받아온다. 길면 토막 내서 이어 쓴다."""
    def 상태(**kw):
        with 생성자물쇠:
            생성중.setdefault(작업id, {}).update(kw)

    상태(상태='도는중', 글='', 오류='')
    try:
        if 목표자 >= 9000:
            글 = 토막내서쓰기(작업id, 질문, 목표자, 상태)
        else:
            상태(단계='대본 쓰는 중')
            글 = 다듬기서버(클로드한번(질문, 분=30))
        if not 글:
            상태(상태='실패', 오류='클로드가 아무 글도 주지 않았어.')
        else:
            상태(상태='끝', 글=글)
    except subprocess.TimeoutExpired:
        상태(상태='실패', 오류='시간을 넘겨서 멈췄어.')
    except Exception as e:
        상태(상태='실패', 오류=str(e)[:800])


# ── 요청 처리 ─────────────────────────────────────
class 손(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=웹, **kw)

    def log_message(self, *a):
        pass  # 검은 창을 조용하게

    def end_headers(self):
        # 프로그램을 새로 깔았는데 브라우저가 옛 화면을 기억하면 안 된다
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()

    def _json(self, obj, code=200):
        b = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(b)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(b)

    def _body(self):
        n = int(self.headers.get('Content-Length') or 0)
        if not n:
            return {}
        return json.loads(self.rfile.read(n).decode('utf-8'))

    # 화면 파일 주기
    def do_GET(self):
        if self.path.startswith('/api/'):
            if self.path.startswith('/api/listen'):
                from urllib.parse import urlparse, parse_qs
                이름 = (parse_qs(urlparse(self.path).query).get('f') or [''])[0]
                이름 = os.path.basename(이름)
                파일 = os.path.join(자료, '_미리듣기', 이름)
                if not os.path.exists(파일):
                    return self._json({'error': '없어'}, 404)
                b = open(파일, 'rb').read()
                self.send_response(200)
                self.send_header('Content-Type',
                                 'audio/mpeg' if 이름.endswith('.mp3') else 'audio/wav')
                self.send_header('Content-Length', str(len(b)))
                self.end_headers()
                self.wfile.write(b)
                return

            if self.path.startswith('/api/voicefile'):
                from urllib.parse import urlparse, parse_qs
                q = parse_qs(urlparse(self.path).query)
                jid = os.path.basename((q.get('id') or [''])[0])
                이름 = os.path.basename((q.get('f') or [''])[0])
                파일 = os.path.join(프로젝트칸, jid, '음성', 이름)
                if not os.path.exists(파일):
                    return self._json({'error': '없어'}, 404)
                b = open(파일, 'rb').read()
                self.send_response(200)
                self.send_header('Content-Type',
                                 'audio/mpeg' if 이름.endswith('.mp3') else 'audio/wav')
                self.send_header('Content-Length', str(len(b)))
                self.end_headers()
                self.wfile.write(b)
                return

            if self.path == '/api/jobs':
                항목 = 읽기(os.path.join(자료, 'items.json'), {})
                return self._json({'jobs': 작업들(),
                                   'samples': 읽기(os.path.join(자료, 'style_samples.json'), {}),
                                   'myStyles': 항목.get('style', []),
                                   'chars': 항목.get('char', []),
                                   'claude': bool(클로드길)})
            return self._json({'error': '모르는 길'}, 404)
        return super().do_GET()

    # 자료 받기
    def do_POST(self):
        if not self.path.startswith('/api/'):
            return self._json({'error': '모르는 길'}, 404)
        길 = self.path[5:]
        try:
            d = self._body()

            if 길 in ('article/fetch', 'article/peek'):
                글, 왜 = 기사읽기(d.get('url', ''))
                if 글:
                    return self._json({'ok': True, '제목': 글['제목'],
                                       '글자수': len(글['본문']),
                                       '본문': 글['본문']})
                return self._json({'ok': False, 'why': 왜})

            if 길 == 'script/start':
                if not 클로드길:
                    return self._json({'ok': False, 'why': '클로드 코드가 이 컴퓨터에 없어'})
                jid = d['id']
                with 생성자물쇠:
                    돌고있나 = 생성중.get(jid, {}).get('상태') == '도는중'
                if 돌고있나:
                    return self._json({'ok': True, '이미': True})
                def 진단남기기(이름, 글):
                    """주고받은 것을 파일로 남긴다. 잘못되면 이걸 보면 된다."""
                    try:
                        칸 = os.path.join(프로젝트칸, jid, '진단')
                        os.makedirs(칸, exist_ok=True)
                        with open(os.path.join(칸, 이름), 'w', encoding='utf-8') as f:
                            f.write(글)
                    except Exception:
                        pass

                def 준비하고부르기():
                    with 생성자물쇠:
                        생성중[jid] = {'상태': '도는중', '글': '', '오류': '',
                                      '시작': time.time(), '단계': '기사 읽는 중'}
                    질문 = 기사붙이기(d['prompt'], d.get('urls', ''))
                    진단남기기('보낸질문.txt',
                               '길이: %d자\n클로드: %s\n%s\n\n%s'
                               % (len(질문), 클로드길, '─' * 50, 질문))
                    with 생성자물쇠:
                        생성중[jid]['단계'] = '대본 쓰는 중 (질문 %d자)' % len(질문)
                    클로드부르기(jid, 질문, int(d.get('chars') or 0))
                    with 생성자물쇠:
                        끝 = 생성중.get(jid, {})
                    진단남기기('받은답.txt',
                               '상태: %s\n오류: %s\n%s\n\n%s'
                               % (끝.get('상태'), 끝.get('오류', ''), '─' * 50, 끝.get('글', '')))

                threading.Thread(target=준비하고부르기, daemon=True).start()
                return self._json({'ok': True})

            if 길 == 'script/status':
                with 생성자물쇠:
                    st = dict(생성중.get(d['id'], {'상태': '없음'}))
                if st.get('시작'):
                    st['지난초'] = int(time.time() - st.pop('시작'))
                return self._json(st)

            if 길 == 'prompt/start':
                if not 클로드길:
                    return self._json({'ok': False,
                                       'why': '클로드 코드가 이 컴퓨터에 없어'})
                jid = d['id']
                with 생성자물쇠:
                    if 프롬프트중.get(jid, {}).get('상태') == '도는중':
                        return self._json({'ok': True, '이미': True})
                threading.Thread(target=프롬프트만들기, args=(jid, d),
                                 daemon=True).start()
                return self._json({'ok': True})

            if 길 == 'prompt/status':
                with 생성자물쇠:
                    st = dict(프롬프트중.get(d['id'], {'상태': '없음'}))
                if st.get('시작'):
                    st['지난초'] = int(time.time() - st.pop('시작'))
                return self._json(st)

            if 길 == 'voices':
                목록, 왜 = voice.목소리목록(d.get('engine', 'win'), d.get('key', ''))
                return self._json({'voices': 목록, 'why': 왜,
                                   'windows': voice.윈도우})

            if 길 == 'voice/preview':
                칸 = os.path.join(자료, '_미리듣기')
                os.makedirs(칸, exist_ok=True)
                끝 = '.mp3' if d.get('engine') == 'google' else '.wav'
                파일 = os.path.join(칸, 'preview' + 끝)
                try:
                    voice.한문장(d.get('text') or '안녕하세요. 뉴스 AI 자동화입니다.',
                                d.get('engine', 'win'), d.get('voice', ''),
                                float(d.get('rate', 1.0)), 파일, d.get('key', ''))
                except Exception as e:
                    return self._json({'ok': False, 'why': voice.까닭(e)})
                return self._json({'ok': True,
                                   'url': '/api/listen?f=preview' + 끝,
                                   '초': voice.길이재기(파일)})

            if 길 == 'voice/start':
                jid = d['id']
                with 생성자물쇠:
                    if 음성중.get(jid, {}).get('상태') == '도는중':
                        return self._json({'ok': True, '이미': True})
                threading.Thread(target=음성만들기, args=(jid, d), daemon=True).start()
                return self._json({'ok': True})

            if 길 == 'voice/status':
                with 생성자물쇠:
                    return self._json(dict(음성중.get(d['id'], {'상태': '없음'})))

            if 길 == 'voice/list':
                return self._json(음성대조(d.get('id'), d.get('script', '')))

            if 길 == 'folder/open':
                칸 = os.path.join(프로젝트칸, d['id'], '음성')
                if not os.path.isdir(칸):
                    return self._json({'ok': False, 'why': '아직 음성 폴더가 없어'})
                try:
                    if os.name == 'nt':
                        os.startfile(칸)          # noqa: S606
                    else:
                        subprocess.Popen(['xdg-open', 칸])
                    return self._json({'ok': True, '곳': os.path.abspath(칸)})
                except Exception as e:
                    return self._json({'ok': False, 'why': str(e)[:200],
                                       '곳': os.path.abspath(칸)})

            if 길 == 'cut':
                글 = d.get('script', '')
                길이, 잰것 = 잰길이(d.get('id'), 글)
                컷 = cutter.컷나누기(
                    글,
                    목표초=float(d.get('target') or cutter.기본초),
                    후킹목표=float(d.get('hook') or cutter.후킹초),
                    문장길이=길이,
                    강조목표=float(d.get('emph') or 0) or None,
                    마무리목표=float(d.get('endl') or 0) or None,
                )
                if d.get('skipCta'):
                    컷 = cutter.CTA빼기(컷)
                return self._json({'요약': cutter.요약(컷), '컷': 컷,
                                   '잰것': 잰것})

            if 길 == 'style/sample':
                파일 = os.path.join(자료, 'style_samples.json')
                표 = 읽기(파일, {})
                if d.get('data'):
                    표[d['id']] = d['data']
                else:
                    표.pop(d['id'], None)
                쓰기(파일, 표)
                return self._json({'ok': True})

            if 길 == 'item/save':
                파일 = os.path.join(자료, 'items.json')
                표 = 읽기(파일, {})
                목록 = 표.setdefault(d['kind'], [])
                it = d['item']
                if it.get('id'):
                    for i, x in enumerate(목록):
                        if x['id'] == it['id']:
                            목록[i] = {**x, **it}
                            break
                else:
                    it['id'] = uuid.uuid4().hex[:8]
                    목록.append(it)
                쓰기(파일, 표)
                return self._json({'ok': True})

            if 길 == 'item/del':
                파일 = os.path.join(자료, 'items.json')
                표 = 읽기(파일, {})
                표[d['kind']] = [x for x in 표.get(d['kind'], []) if x['id'] != d['id']]
                쓰기(파일, 표)
                return self._json({'ok': True})

            if 길 == 'job/new':
                jid = uuid.uuid4().hex[:10]
                j = {'id': jid, 'name': d['name'],
                     'created': time.strftime('%Y-%m-%d'),
                     'step': 'news', 'url': '', 'topic': '', 'tone': '',
                     'minutes': 9, 'script': '', 'cuts': [], 'prompts': []}
                작업저장(j)
                return self._json({'ok': True, 'id': jid})

            if 길 == 'job/save':
                작업저장(d)
                return self._json({'ok': True})

            if 길 == 'job/del':
                import shutil
                shutil.rmtree(os.path.join(프로젝트칸, d['id']), ignore_errors=True)
                return self._json({'ok': True})

            return self._json({'error': '모르는 길: ' + 길}, 404)

        except Exception as e:
            return self._json({'error': str(e)}, 500)


# ── 켜기 ──────────────────────────────────────────
def 빈자리(시작=8760):
    for p in range(시작, 시작 + 40):
        s = socket.socket()
        try:
            s.bind(('127.0.0.1', p))
            s.close()
            return p
        except OSError:
            s.close()
    return 0  # 아무 자리나


def main():
    포트 = 빈자리()
    주소 = 'http://127.0.0.1:%d/' % 포트
    서버 = ThreadingHTTPServer(('127.0.0.1', 포트), 손)
    포트 = 서버.server_address[1]
    주소 = 'http://127.0.0.1:%d/' % 포트

    print('')
    print('  뉴스 AI 자동화')
    print('  ' + '─' * 44)
    print('  창이 저절로 열려. 안 열리면 아래 주소를 복사해서 넣어줘.')
    print('')
    print('      ' + 주소)
    print('')
    if 클로드길:
        print('  클로드 코드를 찾았어 → 대본 생성이 자동으로 돌아가.')
    else:
        print('  클로드 코드가 안 보여 → 대본은 [질문 복사]로 받아오면 돼.')
    print('')
    print('  ※ 이 검은 창은 닫지 마. 닫으면 화면도 멈춰.')
    print('    다 썼으면 이 창에서 Ctrl + C 를 누르거나 그냥 닫으면 돼.')
    print('')

    threading.Timer(0.8, lambda: webbrowser.open(주소)).start()
    try:
        서버.serve_forever()
    except KeyboardInterrupt:
        print('\n  껐어. 잘 가!\n')


if __name__ == '__main__':
    main()
