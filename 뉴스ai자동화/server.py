# -*- coding: utf-8 -*-
"""뉴스ai자동화 — 작은 서버 (1차)

파이썬에 원래 들어 있는 기능만 쓴다. 따로 설치할 게 없다.
켜면 크롬 창이 저절로 열린다. 검은 창은 닫지 말 것.
"""

import json, os, sys, time, uuid, threading, webbrowser, socket
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cutter

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


def 클로드한번(질문, 분=30):
    """클로드를 한 번 불러 글을 받아온다."""
    p = subprocess.run(
        [클로드길, '-p', 질문, '--allowedTools', 'WebFetch,WebSearch'],
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

            if 길 == 'article/peek':
                글, 왜 = 기사읽기(d.get('url', ''))
                if 글:
                    return self._json({'ok': True, '제목': 글['제목'],
                                       '글자수': len(글['본문']),
                                       '맛보기': 글['본문'][:300]})
                return self._json({'ok': False, 'why': 왜})

            if 길 == 'script/start':
                if not 클로드길:
                    return self._json({'ok': False, 'why': '클로드 코드가 이 컴퓨터에 없어'})
                jid = d['id']
                with 생성자물쇠:
                    돌고있나 = 생성중.get(jid, {}).get('상태') == '도는중'
                if 돌고있나:
                    return self._json({'ok': True, '이미': True})
                def 준비하고부르기():
                    with 생성자물쇠:
                        생성중[jid] = {'상태': '도는중', '글': '', '오류': '',
                                      '시작': time.time(), '단계': '기사 읽는 중'}
                    질문 = 기사붙이기(d['prompt'], d.get('urls', ''))
                    with 생성자물쇠:
                        생성중[jid]['단계'] = '대본 쓰는 중'
                    클로드부르기(jid, 질문, int(d.get('chars') or 0))

                threading.Thread(target=준비하고부르기, daemon=True).start()
                return self._json({'ok': True})

            if 길 == 'script/status':
                with 생성자물쇠:
                    st = dict(생성중.get(d['id'], {'상태': '없음'}))
                if st.get('시작'):
                    st['지난초'] = int(time.time() - st.pop('시작'))
                return self._json(st)

            if 길 == 'cut':
                컷 = cutter.컷나누기(
                    d.get('script', ''),
                    목표초=float(d.get('target') or cutter.기본초),
                    후킹목표=float(d.get('hook') or cutter.후킹초),
                    강조목표=float(d.get('emph') or 0) or None,
                    마무리목표=float(d.get('endl') or 0) or None,
                )
                if d.get('skipCta'):
                    컷 = cutter.CTA빼기(컷)
                return self._json({'요약': cutter.요약(컷), '컷': 컷})

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
