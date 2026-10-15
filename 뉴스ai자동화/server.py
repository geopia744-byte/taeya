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
채널파일 = os.path.join(자료, 'channels.json')

os.makedirs(프로젝트칸, exist_ok=True)


# ── 파일 읽고 쓰기 ────────────────────────────────
def 읽기(경로, 기본):
    try:
        with open(경로, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return 기본


def 쓰기(경로, 값):
    os.makedirs(os.path.dirname(경로), exist_ok=True)
    tmp = 경로 + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(값, f, ensure_ascii=False, indent=2)
    os.replace(tmp, 경로)


def 채널들():
    return 읽기(채널파일, [])


def 프로젝트들():
    out = []
    for d in sorted(os.listdir(프로젝트칸)):
        p = os.path.join(프로젝트칸, d, 'project.json')
        if os.path.exists(p):
            v = 읽기(p, None)
            if v:
                out.append(v)
    return out


def 프로젝트저장(p):
    쓰기(os.path.join(프로젝트칸, p['id'], 'project.json'), p)


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
            if self.path == '/api/state':
                return self._json({'channels': 채널들(), 'projects': 프로젝트들()})
            return self._json({'error': '모르는 길'}, 404)
        return super().do_GET()

    # 자료 받기
    def do_POST(self):
        if not self.path.startswith('/api/'):
            return self._json({'error': '모르는 길'}, 404)
        길 = self.path[5:]
        try:
            d = self._body()

            if 길 == 'channel/save':
                cs = 채널들()
                if d.get('id'):
                    for c in cs:
                        if c['id'] == d['id']:
                            c['name'] = d['name']
                            c['tone'] = d.get('tone', '')
                            c['refs'] = d.get('refs', [])
                            break
                else:
                    cs.append({
                        'id': uuid.uuid4().hex[:10],
                        'name': d['name'],
                        'tone': d.get('tone', ''),
                        'refs': d.get('refs', []),
                        'created': time.strftime('%Y-%m-%d'),
                    })
                쓰기(채널파일, cs)
                return self._json({'ok': True})

            if 길 == 'channel/del':
                cs = [c for c in 채널들() if c['id'] != d['id']]
                쓰기(채널파일, cs)
                import shutil
                for p in 프로젝트들():
                    if p.get('channel') == d['id']:
                        shutil.rmtree(os.path.join(프로젝트칸, p['id']), ignore_errors=True)
                return self._json({'ok': True})

            if 길 == 'project/new':
                pid = uuid.uuid4().hex[:10]
                p = {
                    'id': pid,
                    'channel': d['channel'],
                    'name': d['name'],
                    'created': time.strftime('%Y-%m-%d'),
                    'step': 'script',
                    'done': {},
                    'script': '',
                    'scriptLen': 0,
                }
                프로젝트저장(p)
                return self._json({'ok': True, 'id': pid})

            if 길 == 'cut':
                컷 = cutter.컷나누기(
                    d.get('script', ''),
                    목표초=float(d.get('target', cutter.기본초)),
                    후킹목표=float(d.get('hook', cutter.후킹초)),
                )
                if d.get('skipCta'):
                    컷 = cutter.CTA빼기(컷)
                return self._json({'요약': cutter.요약(컷), '컷': 컷})

            if 길 == 'project/save':
                for p in 프로젝트들():
                    if p['id'] == d['id']:
                        for k, v in d.items():
                            if k == 'done':
                                p.setdefault('done', {}).update(v)
                            elif k != 'id':
                                p[k] = v
                        프로젝트저장(p)
                        return self._json({'ok': True})
                return self._json({'error': '없는 프로젝트'}, 404)

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
