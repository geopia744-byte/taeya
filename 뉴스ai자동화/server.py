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


def 클로드부르기(작업id, 질문):
    """클로드 코드를 불러서 대본을 받아온다. 오래 걸리므로 딴 가닥에서 돈다."""
    def 상태(**kw):
        with 생성자물쇠:
            생성중.setdefault(작업id, {}).update(kw)

    상태(상태='도는중', 글='', 오류='', 시작=time.time())
    try:
        p = subprocess.run(
            [클로드길, '-p', 질문],
            capture_output=True, timeout=1800,
            creationflags=(subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0),
        )
        나온글 = (p.stdout or b'').decode('utf-8', 'replace').strip()
        에러 = (p.stderr or b'').decode('utf-8', 'replace').strip()
        if p.returncode != 0 and not 나온글:
            상태(상태='실패', 오류=에러[:600] or ('끝난 값 %d' % p.returncode))
        elif not 나온글:
            상태(상태='실패', 오류='클로드가 아무 글도 주지 않았어.')
        else:
            상태(상태='끝', 글=나온글)
    except subprocess.TimeoutExpired:
        상태(상태='실패', 오류='30분을 넘겨서 멈췄어.')
    except Exception as e:
        상태(상태='실패', 오류=str(e)[:600])


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


# ── 요청 처리 ─────────────────────────────────────
class 손(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=웹, **kw)

    def log_message(self, *a):
        pass  # 검은 창을 조용하게

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

            if 길 == 'script/start':
                if not 클로드길:
                    return self._json({'ok': False, 'why': '클로드 코드가 이 컴퓨터에 없어'})
                jid = d['id']
                with 생성자물쇠:
                    돌고있나 = 생성중.get(jid, {}).get('상태') == '도는중'
                if 돌고있나:
                    return self._json({'ok': True, '이미': True})
                threading.Thread(target=클로드부르기, args=(jid, d['prompt']), daemon=True).start()
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
