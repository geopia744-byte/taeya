"""
이미지 AI 자동화 — 로컬 서버

해외 인스타 캡쳐를 넣으면 한/일/영 후킹 제목·캡션·해시태그를 만들어
브라우저에서 이미지에 합성하고, PC 폴더에 저장한다.

실행:  python app.py
그러면 브라우저가 열린다.
"""

import base64
import json
import mimetypes
import os
import re
import socket
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
import zipfile
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
DEFAULT_OUTPUT = ROOT / "출력"

# 설정은 프로그램 폴더가 아니라 사용자 계정 폴더에 둔다.
# 새 버전을 새 폴더에 풀 때마다 키를 다시 넣게 되면 안 된다.
CONFIG_PATH = Path.home() / ".hooking-factory" / "config.json"
LEGACY_CONFIG = ROOT / "config.json"

MODEL = "claude-opus-5"

# 요청 본문 상한 (이미지 여러 장이 base64로 들어오므로 넉넉히)
MAX_BODY = 64 * 1024 * 1024
# 영상은 JSON 이 아니라 날것으로 받으므로 한도를 따로 둔다.
MAX_VIDEO = 600 * 1024 * 1024

# "개인(personal)" 타입 Anthropic 키는 여러 워크스페이스에 걸쳐 쓸 수 있어서
# 요청마다 "어느 워크스페이스로 실행할지"를 헤더로 알려줘야 한다(안 그러면
# "anthropic-workspace-id is required..." 400 오류가 난다). 매번 설정 화면에서
# 입력받는 대신 여기에 고정값으로 박아 둔다 — 이 워크스페이스 자체가 바뀌지
# 않는 한 다시 손댈 일 없다.
ANTHROPIC_WORKSPACE_ID = "wrkspc_01Gyh8jcgqKbTtZ1TYTfNYZF"

# 북마크릿이 이 포트 범위를 순서대로 두드려서 지금 켜진 서버를 찾는다.
# find_port() 가 8790 부터 40개를 시도하는 것과 반드시 같은 범위여야 한다.
BOOKMARKLET_PORT_START = 8790
BOOKMARKLET_PORT_RANGE = 40

# 북마크릿 설치 페이지(/bookmarklet.html)는 파일로 미리 만들어두지 않고
# 요청이 올 때마다 이 템플릿에 "지금 실제로 켜진 포트"를 끼워서 즉석으로
# 만들어 낸다 — 그래야 8790이 아닌 다른 포트에서 켜졌을 때도(드물게 다른
# 프로그램이 8790을 이미 쓰고 있던 경우) 북마크릿이 엉뚱한 포트를 찾는
# 일이 없다. web/bookmarklet.src.js 는 __PORT__ 자리표시자를 담은
# "읽는 원본"이고, 실제로 브라우저에 나가는 건 이 함수가 그 자리를
# 채워 넣은 결과물이다.
BOOKMARKLET_INSTALL_TEMPLATE = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>스레드 수집기 설치 — 이미지 AI 자동화</title>
<style>
  :root {{ color-scheme: dark; }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; padding: 40px 20px 80px;
    background: #0b0c0f; color: #e7e9ee;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Malgun Gothic", sans-serif;
    line-height: 1.65;
  }}
  .wrap {{ max-width: 560px; margin: 0 auto; }}
  h1 {{ font-size: 22px; margin: 0 0 6px; }}
  .sub {{ color: #9aa0ab; font-size: 14px; margin-bottom: 32px; }}
  .bm-box {{
    display: flex; align-items: center; justify-content: center;
    padding: 28px 16px; margin-bottom: 28px;
    background: #131519; border: 1px dashed #3a3f47; border-radius: 14px;
  }}
  .bm-link {{
    display: inline-flex; align-items: center; gap: 8px;
    padding: 14px 26px; border-radius: 999px; text-decoration: none;
    background: linear-gradient(135deg, #7C5CFF, #22A8F0);
    color: #fff; font-weight: 800; font-size: 15px;
    box-shadow: 0 8px 22px rgba(124, 92, 255, .35);
    cursor: grab; user-select: none;
  }}
  ol {{ padding-left: 20px; }}
  li {{ margin-bottom: 10px; }}
  .note {{
    margin-top: 28px; padding: 14px 16px; border-radius: 10px;
    background: rgba(111, 227, 161, .1); border: 1px solid rgba(111, 227, 161, .3);
    font-size: 13.5px; color: #b9f0d1;
  }}
  code {{ background: #1a1d23; padding: 1px 6px; border-radius: 5px; font-size: 13px; }}
  .step-title {{ font-weight: 700; color: #fff; }}
</style>
</head>
<body>
<div class="wrap">
  <h1>🧵 스레드 수집기 설치</h1>
  <p class="sub">아래 버튼을 <b>즐겨찾기(북마크) 바</b>로 끌어다 놓으면 설치 끝이에요.</p>

  <div class="bm-box">
    <a class="bm-link" id="bm-link" href="#" draggable="true">🧲 스레드 수집기</a>
  </div>

  <ol>
    <li><span class="step-title">즐겨찾기 바가 안 보이면</span> — 브라우저 설정에서 "북마크 바 표시"를 먼저 켜주세요 (크롬: <code>Ctrl/Cmd + Shift + B</code>).</li>
    <li><span class="step-title">위 버튼을 즐겨찾기 바로 드래그</span>해서 놓아주세요. (버튼을 눌러도 아무 일 안 나요 — 반드시 "끌어다" 놓아야 설치돼요.)</li>
    <li><span class="step-title">이미지 AI 자동화 프로그램을 켜두세요.</span> (<code>python app.py</code>) 대시보드가 브라우저에 열려 있어야 카드가 들어옵니다.</li>
    <li><span class="step-title">스레드(threads.net)에서 원하는 글을 화면 가운데 오게 둔 다음</span>, 방금 만든 <b>🧲 스레드 수집기</b> 북마크를 누르세요.</li>
    <li>새로 뜬 작은 창에서 <span class="step-title">카테고리를 고르면</span> 대시보드의 그 항목 칸에 새 카드로 들어갑니다.</li>
  </ol>

  <div class="note">
    ✅ 이 버튼은 지금 켜진 프로그램 주소(포트 {port})를 이미 그대로
    담고 있어요. 다른 설정을 더 바꾸실 필요 없이 바로 쓰시면 돼요.
  </div>
</div>
<script>
  document.getElementById('bm-link').href = 'javascript:' + encodeURIComponent({payload});
</script>
</body>
</html>
"""

# ─────────────────────────────────────────────────────────────
# 스레드 수집함 (북마크릿 → 대시보드)
#
# 북마크릿이 사진 URL·본문·카테고리를 이리로 던지면(POST), 서버는
# 그 사진들을 직접 내려받아(base64) 메모리 큐에 잠깐 들고 있는다.
# 대시보드가 몇 초마다 이 큐를 확인(GET)해서 카드로 만들고 나면 큐는 비운다.
# 디스크에는 아무것도 쓰지 않는다 — 카드가 된 다음부터는 브라우저의
# IndexedDB 저장이 그대로 이어받는다.
# ─────────────────────────────────────────────────────────────

_thread_inbox = []
_thread_inbox_lock = threading.Lock()
_thread_seq = 0

IMAGE_FETCH_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
}


def fetch_image_as_data_url(url: str) -> "str | None":
    """사진 URL을 서버가 직접 내려받아 data URL로 바꾼다.

    브라우저(북마크릿)가 직접 fetch 하면 CDN이 CORS를 안 열어줘서 막히는
    경우가 많다. 서버는 그냥 파이썬 코드라 그런 제약이 없다."""
    try:
        req = urllib.request.Request(url, headers=IMAGE_FETCH_HEADERS)
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read(12 * 1024 * 1024)  # 사진 한 장당 12MB 상한
            ctype = resp.headers.get_content_type() or "image/jpeg"
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        return None
    if not raw:
        return None
    b64 = base64.b64encode(raw).decode("ascii")
    return f"data:{ctype};base64,{b64}"


def thread_capture(payload: dict) -> dict:
    global _thread_seq
    text = (payload.get("text") or "").strip()[:4000]
    category = (payload.get("category") or "general").strip()
    source_url = (payload.get("sourceUrl") or "").strip()
    urls = [u for u in (payload.get("urls") or []) if isinstance(u, str)][:10]

    images = []
    for u in urls:
        data_url = fetch_image_as_data_url(u)
        if data_url:
            images.append(data_url)

    if not images and not text:
        raise RuntimeError("가져올 사진도 글도 없습니다.")

    with _thread_inbox_lock:
        _thread_seq += 1
        item = {
            "id": _thread_seq,
            "category": category,
            "text": text,
            "images": images,
            "sourceUrl": source_url,
            "capturedAt": datetime.now().isoformat(),
        }
        _thread_inbox.append(item)

    return {"ok": True, "id": item["id"], "imageCount": len(images),
            "failedCount": len(urls) - len(images)}


def thread_inbox_take() -> list:
    """쌓인 걸 전부 꺼내면서 큐는 비운다(가져간 것부터 지운다)."""
    with _thread_inbox_lock:
        items, _thread_inbox[:] = list(_thread_inbox), []
    return items


# ─────────────────────────────────────────────────────────────
# 영상 자막 지우기
#
# 자막을 통째로 뭉개거나 검은 띠로 덮지 않는다. 글자 획만 골라내서
# 지우고 그 자리를 주변 픽셀로 메운다. 그래야 자막 뒤에 있던 배경이
# 살아난다.
#
# 무거운 짐(opencv, ffmpeg)은 이 기능을 처음 쓸 때만 불러온다. 영상을
# 안 쓰는 사람에게까지 시작을 느리게 만들 이유가 없다.
# ─────────────────────────────────────────────────────────────

VIDEO_DIR = Path(tempfile.gettempdir()) / "hooking-factory-video"
_video_jobs = {}
_video_lock = threading.Lock()


def _cv2():
    try:
        import cv2
        import numpy
        return cv2, numpy
    except ImportError as exc:
        raise RuntimeError(
            "영상 기능에 필요한 부품이 없습니다. 프로그램을 껐다가 "
            "'시작하기_윈도우.bat' 으로 다시 열어주세요. (자동으로 설치됩니다)"
        ) from exc


def _ffmpeg() -> str:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:
        raise RuntimeError(
            "영상을 저장할 도구(ffmpeg)를 찾지 못했습니다. 프로그램을 껐다가 "
            "'시작하기_윈도우.bat' 으로 다시 열어주세요."
        ) from exc


def subtitle_mask(frame, band=None, ref=None):
    """이 한 장에서 '자막 글자'로 보이는 곳만 흰색으로 남긴 마스크.

    ref 는 '원래 화면'의 (높이, 너비). 띠만 잘라서 넘길 때 쓴다. 글자
    크기를 화면 높이에 견주어 판단하는데, 잘라낸 조각의 높이로 재면
    자막 글자가 전부 '너무 크다'고 걸러져 하나도 안 지워진다.
    """
    cv2, np = _cv2()
    h, w = ref if ref else frame.shape[:2]
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    # 자막은 어두운 테두리를 두른 밝은 글자다. 톱햇은 '주변보다 밝고 얇은
    # 것'만 남기므로, 배경이 밝은 곳에서도 글자만 걸린다.
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (17, 17))
    top = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, k)
    # 문턱을 55 에서 35 로 내렸다. 도우인처럼 테두리가 거의 없는 얇은
    # 자막은 55 에서 획 가장자리를 놓쳐 지운 자리에 흐린 자국이 남는다.
    # 여러 화면으로 재보니 배경 오검출은 늘지 않았다(흰 그릇 0%, 밝은
    # 꿀 배경 0%, 잔무늬 화면 2.7% 그대로).
    _, m = cv2.threshold(top, 35, 255, cv2.THRESH_BINARY)
    m[gray < 165] = 0            # 글자는 아주 밝다

    if band:
        y0, y1 = band
        keep = np.zeros_like(m)
        keep[max(0, y0):min(frame.shape[0], y1), :] = 255
        m = cv2.bitwise_and(m, keep)

    # 획 두께는 '붙이기 전' 상태로 재둔다. 한자처럼 획이 촘촘한 글자는
    # 붙이고 나면 속이 꽉 찬 덩어리가 되어, 나중에 재면 글자가 아니라고
    # 걸러진다(실제로 중국어 자막이 통째로 안 잡혔다).
    core = cv2.erode(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))

    # 흩어진 획을 한 덩어리(글자·단어)로 붙인다.
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE,
                         cv2.getStructuringElement(cv2.MORPH_RECT, (9, 3)))

    # 덩어리를 검사해 글자답지 않은 것을 버린다. 이게 없으면 하늘의 구름,
    # 물빛 반사 같은 밝은 배경까지 지워서 영상이 얼룩덜룩해진다.
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    out = np.zeros_like(m)
    for i in range(1, n):
        _, _, cw, ch, area = stats[i]
        if ch < 6 or ch > h * 0.12:      # 너무 작거나 큰 것
            continue
        if cw > w * 0.98:                # 화면을 가로지르는 띠
            continue
        if area < 20:
            continue
        here = lab == i
        # 글자는 획이 얇다. 깎아내도 속이 많이 남는다면 글자가 아니라
        # 흰 그릇·손·하이라이트 같은 덩어리다. 그걸 지우면 그 자리가
        # 통째로 뭉개져 화면이 깨진다.
        if int(core[here].sum()) / 255 > area * 0.30:
            continue
        out[here] = 255
    return out


def find_subtitle_bands(path: str, samples: int = 24, max_bands: int = 3):
    """자막이 머무는 가로 띠들을 찾는다. 없으면 빈 목록.

    요즘 영상은 위에 제목, 아래에 대사 자막이 동시에 뜬다. 이걸 하나로
    묶으면 그 사이의 멀쩡한 화면까지 전부 지워진다. 그래서 따로 찾는다.
    """
    cv2, np = _cv2()
    cap = cv2.VideoCapture(path)
    try:
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        if h <= 0:
            return None
        rows = np.zeros(h, dtype=np.float64)
        hit = 0
        for i in range(samples):
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(total * i / samples))
            ok, f = cap.read()
            if not ok:
                continue
            hit += 1
            rows += (subtitle_mask(f) > 0).sum(axis=1)
    finally:
        cap.release()
    if not hit:
        return None
    rows /= hit
    thr = max(rows.max() * 0.25, 2.0)
    on = rows > thr
    if not on.any():
        return []

    # 이어진 구간들을 따로 모은다. 최소~최대로 한 덩어리를 만들면, 위쪽
    # 자막과 아래쪽 오검출 하나 사이의 화면 전체가 띠가 되어버린다.
    runs, start = [], None
    gap = max(4, int(h * 0.01))          # 이만큼 떨어지면 다른 구간
    miss = 0
    for y in range(h):
        if on[y]:
            if start is None:
                start = y
            miss = 0
        elif start is not None:
            miss += 1
            if miss > gap:
                runs.append((start, y - miss + 1))
                start = None
    if start is not None:
        runs.append((start, h))
    if not runs:
        return []

    # 글자가 많이 모인 구간부터 고른다.
    runs.sort(key=lambda r: -rows[r[0]:r[1]].sum())
    pad = int(h * 0.02)
    picked = []
    for y0, y1 in runs[:max_bands]:
        y0 = int(max(0, y0 - pad))
        y1 = int(min(h, y1 + pad))
        # 띠 하나가 화면의 3할을 넘지 않는다. 그 이상은 자막이 아니다.
        if y1 - y0 > h * 0.3:
            y1 = y0 + int(h * 0.3)
        picked.append([y0, y1])
    picked.sort(key=lambda b: b[0])          # 위에서 아래 순으로
    return picked


def find_subtitle_band(path: str, samples: int = 24):
    """예전 이름. 첫 번째 띠만 준다."""
    got = find_subtitle_bands(path, samples)
    return got[0] if got else None


def video_info(path: str) -> dict:
    """길이·크기와, 자막이 제일 잘 보이는 장면 한 장."""
    cv2, np = _cv2()
    cap = cv2.VideoCapture(path)
    try:
        if not cap.isOpened():
            raise RuntimeError("영상을 읽지 못했습니다. mp4 파일인지 확인해주세요.")
        fps = cap.get(cv2.CAP_PROP_FPS) or 24
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        # 영상 곳곳에서 장면을 뽑아둔다. 한 장만 보여주면 긴 영상에서
        # 자막이 내내 같은 자리에 있는지 확인할 방법이 없다. 자막이 많이
        # 잡히는 순서로 골라, 자막 없는 순간만 보여주는 일도 막는다.
        shots = []
        for i in range(16):
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(total * i / 16) if total else 0)
            ok, f = cap.read()
            if not ok:
                continue
            at = round(total * i / 16 / fps, 1) if fps else 0
            shots.append((int((subtitle_mask(f) > 0).sum()), at, f))
        if not shots:
            raise RuntimeError("영상에서 장면을 하나도 읽지 못했습니다.")

        # 자막이 잡힌 장면들 중에서 고르되, 시간 축에 고르게 퍼뜨린다.
        # 자막이 많은 순으로만 뽑으면 5장이 한 구간에 몰려서, 긴 영상의
        # 다른 대목에서도 자막이 띠 안에 있는지 확인할 수가 없다.
        withtext = [x for x in shots if x[0] > 0] or shots
        want = min(5, len(withtext))
        step = len(withtext) / want
        picked = [withtext[min(len(withtext) - 1, int(i * step))] for i in range(want)]
        previews = []
        for _score, at, f in picked:
            ok, buf = cv2.imencode(".jpg", f, [cv2.IMWRITE_JPEG_QUALITY, 82])
            if ok:
                previews.append({
                    "at": at,
                    "b64": base64.b64encode(buf.tobytes()).decode(),
                })
        preview = previews[0]["b64"] if previews else ""
    finally:
        cap.release()

    return {
        "width": w, "height": h, "fps": round(fps, 3),
        "frames": total, "seconds": round(total / fps, 1) if fps else 0,
        "preview_b64": preview,
        "previews": previews,
        "bands": find_subtitle_bands(path),
    }


def clamp_bands(bands, h: int) -> list:
    """띠들을 화면 안으로 넣고, 하나가 화면의 3할을 넘지 않게 자른다.

    띠가 넓을수록 손댈 곳이 많아져 화면이 상할 위험이 커진다. 화면 쪽에서
    잘못 보내와도 여기서 자른다.
    """
    out = []
    for b in (bands or []):
        try:
            y0, y1 = int(b[0]), int(b[1])
        except (TypeError, ValueError, IndexError):
            continue
        y0 = max(0, min(y0, h - 1))
        y1 = max(y0 + 1, min(y1, h))
        if y1 - y0 > h * 0.3:
            y1 = y0 + int(h * 0.3)
        out.append((y0, y1))
    out.sort()
    return out


def erase_subtitles(src: str, dst: str, bands=None, on_progress=None) -> None:
    """자막을 지운 영상을 dst 로 만든다. 원본 소리는 그대로 옮긴다."""
    cv2, _np = _cv2()
    ff = _ffmpeg()

    cap = cv2.VideoCapture(src)
    if not cap.isOpened():
        raise RuntimeError("영상을 읽지 못했습니다.")
    fps = cap.get(cv2.CAP_PROP_FPS) or 24
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0

    # 화면은 ffmpeg 에 날것으로 흘려보내고, 소리는 원본에서 그대로 복사한다.
    # 중간 파일을 만들었다가 다시 인코딩하면 화질이 두 번 깎인다.
    cmd = [
        ff, "-y", "-hide_banner", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "bgr24",
        "-s", f"{w}x{h}", "-r", f"{fps}", "-i", "-",
        "-i", src,
        "-map", "0:v:0", "-map", "1:a:0?",   # 소리가 없는 영상도 있다
        # 화질이 첫째다. 자막 자리만 고치는데 나머지 화면까지 압축으로
        # 깎이면 안 된다. crf 16 + slow 는 원본과 눈으로 구분되지 않는
        # 수준이다(용량은 늘지만, 화질을 잃는 것보다 낫다).
        "-c:v", "libx264", "-preset", "slow", "-crf", "16",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        "-c:a", "copy", "-shortest", dst,
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

    grow = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    # 자막이 있는 띠만 들여다본다. 화면 전체를 훑을 이유가 없다 — 같은
    # 결과를 내면서 눈에 띄게 빨라진다.
    spans = clamp_bands(bands, h) or [(0, h)]
    done = 0
    skipped = 0          # 화면이 깨질까 봐 손대지 않고 지나간 장면 수
    try:
        while True:
            ok, f = cap.read()
            if not ok:
                break
            # 띠마다 따로 본다. 위 제목과 아래 자막을 하나로 묶으면 그
            # 사이의 멀쩡한 화면까지 지워진다.
            for y0, y1 in spans:
                strip = f[y0:y1]
                m = subtitle_mask(strip, ref=(h, w))
                if not m.any():
                    continue
                # 글자 가장자리의 흐린 획까지 덮도록 조금 부풀린다.
                m = cv2.dilate(m, grow, iterations=1)

                # 마지막 안전장치. 띠 안을 이만큼이나 지워야 한다면 그건
                # 자막이 아니라 화면 자체다(띠를 넓게 잡았거나 밝은 물건이
                # 들어왔거나). 그대로 메우면 그 대목이 통째로 뭉개진다.
                # 자막이 남는 것이 화면이 깨지는 것보다 낫다.
                if (m > 0).mean() > 0.28:
                    skipped += 1
                    continue

                # 메우는 반경은 3이 가장 깨끗했다. 넓게 잡으면 주변 색이
                # 더 많이 끌려와 오히려 자국이 커진다.
                f[y0:y1] = cv2.inpaint(strip, m, 3, cv2.INPAINT_TELEA)
            proc.stdin.write(f.tobytes())
            done += 1
            if on_progress and total and done % 8 == 0:
                on_progress(done / total)
    finally:
        cap.release()
        try:
            proc.stdin.close()
        except Exception:
            pass
        err = proc.stderr.read().decode("utf-8", "replace")
        code = proc.wait()

    if code != 0:
        raise RuntimeError(f"영상을 저장하지 못했습니다. {err.strip()[:200]}")
    if on_progress:
        on_progress(1.0)
    return {"frames": done, "skipped": skipped}


def video_job_start(job_id: str, src: str, dst: str, bands):
    """따로 도는 일꾼. 화면은 진행률만 물어본다."""
    def run():
        try:
            def prog(p):
                with _video_lock:
                    if job_id in _video_jobs:
                        _video_jobs[job_id]["progress"] = round(p, 3)
            res = erase_subtitles(src, dst, bands, prog) or {}
            with _video_lock:
                _video_jobs[job_id].update(done=True, progress=1.0, out=dst,
                                           skipped=res.get("skipped", 0),
                                           frames=res.get("frames", 0))
        except Exception as exc:            # noqa: BLE001 - 화면에 그대로 보여준다
            with _video_lock:
                _video_jobs[job_id].update(done=True, error=str(exc))

    with _video_lock:
        _video_jobs[job_id] = {"progress": 0.0, "done": False,
                               "error": None, "out": None}
    threading.Thread(target=run, daemon=True).start()


def prune_video_temp(max_age_hours: float = 6.0) -> None:
    """임시 폴더에 쌓인 옛 영상을 치운다. 영상은 커서 그냥 두면 곤란하다."""
    cutoff = time.time() - max_age_hours * 3600
    try:
        for f in VIDEO_DIR.glob("*.mp4"):
            try:
                if f.stat().st_mtime < cutoff:
                    f.unlink()
            except OSError:
                pass
    except OSError:
        pass


def video_job_state(job_id: str) -> dict:
    with _video_lock:
        job = _video_jobs.get(job_id)
        return dict(job) if job else {"error": "그런 작업이 없습니다."}

# ─────────────────────────────────────────────────────────────
# 설정
# ─────────────────────────────────────────────────────────────

def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def load_config() -> dict:
    if CONFIG_PATH.exists():
        return _read_json(CONFIG_PATH)
    # 예전 버전은 프로그램 폴더에 뒀다. 있으면 옮겨와서 이어 쓴다.
    if LEGACY_CONFIG.exists():
        old = _read_json(LEGACY_CONFIG)
        if old:
            try:
                save_config(old)
                print(f"  설정을 {CONFIG_PATH} 로 옮겼습니다.")
            except OSError:
                pass
        return old
    return {}


def save_config(cfg: dict) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(
        json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def get_api_key() -> str:
    """설정 파일 우선, 없으면 환경변수."""
    return load_config().get("api_key") or os.environ.get("ANTHROPIC_API_KEY", "")


def get_gemini_key() -> str:
    """설정 파일 우선, 없으면 환경변수."""
    return load_config().get("gemini_key") or os.environ.get("GEMINI_API_KEY", "")


def check_key(key: str, name: str) -> str:
    """키는 HTTP 헤더에 그대로 실린다. 영숫자가 아니면 알아보기 힘든 오류가
    나므로 여기서 걸러 사용자가 이해할 수 있는 말로 알려준다."""
    key = key.strip()
    if not key.isascii():
        raise RuntimeError(
            f"{name} 키에 한글이나 특수문자가 섞여 있습니다. "
            "따옴표나 공백이 같이 복사되지 않았는지 확인해주세요."
        )
    return key


def get_output_dir() -> Path:
    raw = load_config().get("output_dir")
    return Path(raw).expanduser() if raw else DEFAULT_OUTPUT


# ─────────────────────────────────────────────────────────────
# 카피 생성
# ─────────────────────────────────────────────────────────────

LANGUAGES = {
    "ko": "한국어",
    "ja": "日本語",
    "en": "English",
}

# 언어별 후킹 관용. 번역이 아니라 그 언어권 매체의 문법으로 다시 쓰게 만든다.
LANG_STYLE = {
    "ko": (
        "- 감정 단어를 하나 심어라 (기적, 소름, 반전, 충격 등). 남발하면 죽는다. 하나면 된다.\n"
        "- 쉼표로 호흡을 끊어 마지막 줄에 여운을 남기는 형태가 잘 먹힌다.\n"
        "- 조사를 생략해 명사로 끊는 압축도 유효하다. (\"새끼 찾아 수백 마일\")\n"
        "- 해시태그는 한글 위주에 영문 2~4개를 섞는다."
    ),
    "ja": (
        "- 「」(카기캇코)로 인용·강조하는 것이 일본 매체의 기본 문법이다. 적극 사용하라.\n"
        "- ！？ 를 붙여 의문과 놀라움을 동시에 던지는 형태가 흔하다.\n"
        "- 주인공의 1인칭 대사로 시작하는 헤드라인이 매우 강하다. (「わが子に会いたい」)\n"
        "- 体言止め(명사로 끝내기)로 여운을 남겨라.\n"
        "- 해시태그는 일본어 위주에 영문 2~4개를 섞는다."
    ),
    "en": (
        "- Short declarative sentences. Fragments are fine. Full stops create rhythm.\n"
        "- Negation reversals land hard: \"She wasn't lost.\" \"He didn't make it to morning.\"\n"
        "- Avoid ALL-CAPS tabloid phrasing and avoid clickbait cliches like \"you won't believe\".\n"
        "- Hashtags: lowercase, no Korean."
    ),
}

# 카테고리마다 사람을 멈추게 하는 지점이 다르다. 여덟 개를 같은 문법으로
# 쓰면 전부 같은 톤이 된다. 문구의 관점만 잡고, 사진 쪽은 건드리지 않는다.
CATEGORY_STYLE = {
    "person": {
        "name": "인물정보",
        "hook": "직함·이름을 앞세우지 마라. 아는 사람만 멈춘다. 그 사람에게 "
                "닥친 상황을 먼저 던지고 정체는 뒤로 미뤄라.",
    },
    "issue": {
        "name": "시사뉴스",
        "hook": "사건의 결말을 감춰라. 무거운 사건은 무겁게. 자극적인 단어보다 "
                "'말하지 않은 한 줄'이 강하다.",
    },
    "nature": {
        "name": "자연뉴스",
        "hook": "규모와 시간의 낯섦으로 끌어라. 몇 년, 몇 킬로미터, 몇 도 — "
                "사람이 가늠 못 하는 숫자가 후킹이 된다.",
    },
    "star": {
        "name": "연예뉴스",
        "hook": "관계와 반전으로 끌어라. 누가 누구에게 무엇을 했는지, "
                "그 마지막 조각만 가려라.",
    },
    "policy": {
        "name": "정책뉴스",
        "hook": "'나에게 얼마'로 번역해라. 제도 이름이 아니라 내 지갑에 "
                "무슨 일이 생기는지가 후킹이다.",
    },
    "animal": {
        "name": "동물뉴스",
        "hook": "동물의 행동을 사람의 마음으로 옮겨라. 의도와 감정을 읽어주면 "
                "사람이 멈춘다. 다만 지어내지는 마라.",
    },
    "city": {
        "name": "도시풍경",
        "hook": "익숙한 도시의 낯선 순간을 잡아라. 매일 보는 곳이 "
                "달라 보이는 지점이 후킹이다.",
    },
    "general": {
        "name": "기타일반",
        "hook": "일상 속 반전으로 끌어라. 평범해 보이는 것이 평범하지 "
                "않았다는 구조가 잘 먹힌다.",
    },
}


SYSTEM_PROMPT = """\
너는 소셜미디어 바이럴 콘텐츠 전문 카피라이터다. 번역가가 아니다.

## 네가 하는 일

해외 인스타그램 게시물 캡쳐를 받아서, 그 안의 사건을 **지정된 언어권 사람들의
스크롤을 멈추게 하는 문구**로 다시 쓴다. 원문을 옮기는 것이 아니라 다시 쓰는 것이다.

## 후킹의 원리 — 이것만 지켜라

**다 말하지 마라.**

원문 헤드라인은 대개 사실을 다 말해버려서 실패한다. 다 읽은 순간 볼 이유가 사라지기
때문이다. 좋은 후킹 문구는 정보를 *더하는* 게 아니라 *가려서*, 나머지가 궁금해
멈추게 만든다.

실제 예시 (영어 원문 → 한국어 재작성):

- `MEXICO HAS A REAL LIFE 'BATMAN' HUNTING DOWN THIEVES AT NIGHT`
  → `멕시코에 나타난 / 현실판 배트맨`
  ("밤에 도둑을 쫓는다"를 통째로 삭제했다. 덜어냈더니 더 궁금해졌다.)

- `BELUGA WHALE ESCAPES RESEARCH FACILITY AND SWIMS HUNDREDS OF MILES BACK TO HER BABY`
  → `탈출한 벨루가의 기적 / 새끼 찾아 수백 마일`
  ("기적"은 원문에 없다. 감정 단어를 하나 심었다.)

- `CHILD R*PIST SHOT D3AD MOMENTS AFTER BEING RELEASED FROM PRISON`
  → `출소 직후 총격 사망 / 그를 기다린 건 자유가 아니었다`
  (둘째 줄은 원문에 아예 없는 창작이다. 결말을 숨겨 궁금하게 만들었다.)

원문에 없는 문장을 만들어도 된다. 단, **사건의 사실관계를 왜곡하면 안 된다.**
일어나지 않은 일을 지어내지 마라. 어조와 구성만 새로 짜라.

## 산출물

1. **title_lines** — 이미지 위에 박을 제목. 2줄 (사건이 복잡하면 3줄까지).
   각 줄은 짧게. 한 줄이 길어지면 화면에서 읽히지 않는다.
   줄바꿈은 **의미 단위로** 끊어라. 단어 중간에서 끊지 마라.

2. **body** — 인스타그램 캡션.
   - **제목에 쓴 숫자와 반드시 일치시켜라.**
   - 인스타는 3줄이 넘으면 접힌다. **접히기 전 3줄 안에 후킹이 완성되어야 한다.**
   - 짧은 문장, 잦은 줄바꿈. 벽처럼 빽빽한 문단은 아무도 안 읽는다.
   - 이모지는 1~3개. 없어도 된다. 도배하지 마라.
   - 해시태그는 여기 넣지 마라. 따로 낸다.

3. **hashtags** — 10~15개. `#` 포함. 아래 언어별 지침을 따른다.

4. **source_text** — 원본 이미지에서 읽어낸 문구를 그대로. (검수용)

5. **scene** — 주인공 **뒤에 새로 깔 배경**을 영어로 한 문단.

   ⚠️ 이건 "사진을 새로 찍는" 게 아니라 **배경만 갈아끼우는** 작업이다.
   주인공은 — 사람이든, 동물이든, 상어든, 자동차든, 건물이든 —
   원본 사진에서 **그대로 오려서 붙인다.** 네가 설계하는 건
   **그 뒤와 주위 공간뿐이다.**

   써야 할 것 — 배경뿐이다:
   - 장소를 바꿔라 (같은 방이 아니라 골목, 병원 복도, 들판, 깊은 바다…)
   - 시간대와 조명을 정하라 (비 오는 밤의 네온, 새벽 역광, 형광등…)
   - 분위기를 한 마디로 (차갑고 무겁게, 따뜻하고 아련하게…)
   - 선명하게. 흐릿한 배경(보케·아웃포커스)은 쓰지 마라.

   **절대 쓰지 마라** — 이걸 쓰면 주인공이 딴것으로 바뀐다:
   - 카메라 얘기 (낮은 각도, 클로즈업, 어깨 너머, 줌, 구도…)
     → 카메라는 원본 그대로다. 네가 정하는 게 아니다.
   - 주인공의 생김새 (얼굴, 머리, 옷, 털, 몸집, 색깔…)
     → 원본에서 그대로 가져오므로 적으면 방해만 된다.
   - 주인공의 동작·자세 ("남자가 걸어온다", "상어가 헤엄친다"…)
     → 자세도 원본 그대로다. 움직이게 하면 안 된다.

   즉 **주인공이 아직 들어오기 전의, 텅 빈 장소 사진**을 묘사한다고
   생각해라. 그 빈 자리에 주인공을 나중에 그대로 올려놓을 것이다.

6. **text_area** — 사진에 **박혀 있는 글자**가 차지하는 세로 범위.
   이미지 맨 위를 0.0, 맨 아래를 1.0으로 보고 `top`과 `bottom`을 낸다.

   이 범위는 **덮어서 가려진다.** 그 위에 한국어 제목을 얹기 때문이다.
   그러니 **넉넉하게 잡아라** — 조금 남으면 영어가 비쳐서 결과물을 망친다.
   글자의 실제 위아래 끝보다 0.02~0.04 정도씩 더 여유를 둬라.

   - 사진 아래쪽에 두 줄이 박혀 있다 → 대략 `{top: 0.72, bottom: 1.0}`
   - 가운데를 크게 가로지른다 → 대략 `{top: 0.38, bottom: 0.72}`
   - 인스타 UI 안의 캡션 글은 여기 포함하지 마라. **사진 위에 얹힌 글자만** 센다.
   - 박힌 글자가 아예 없다 → `{top: 0, bottom: 0}`

7. **overlays** — 사진 위에 **얹혀 있는 작은 사진·배지**의 자리.

   뉴스 카드 사진에는 본 사진 위에 **또 다른 작은 사진**이 얹혀 있는
   경우가 많다. 동그란 테두리 안에 인물 얼굴이 들어 있거나, 네모난
   섬네일이 모서리에 붙어 있는 식이다.

   이것들은 **장면의 일부가 아니라 스티커다.** 상어는 물속에 있지만
   동그라미 속 얼굴은 어디에 있는 것이 아니라 그냥 덮여 있을 뿐이다.
   그래서 배경을 새로 만들 때 이 자리는 **원본을 그대로 도로 얹는다.**
   네가 자리를 알려주지 않으면 이 스티커가 사라지거나 뭉개진다.

   왼쪽 위, 오른쪽 아래 — 자리는 사진마다 다르다. 정해두지 말고
   **네 눈으로 보고** 찾아라. 여러 개면 여러 개 다 적어라.

   각 항목은 `shape`("circle" 또는 "rect")와 네 변의 위치를 낸다.
   왼쪽 끝을 0.0, 오른쪽 끝을 1.0 으로 보고 `left`/`right`,
   맨 위를 0.0, 맨 아래를 1.0 으로 보고 `top`/`bottom` 이다.
   테두리(흰 링, 그림자)까지 포함해 **아주 살짝 넉넉하게** 잡아라.

   - 왼쪽 위 동그란 얼굴 사진 → `{shape:"circle", left:0.05, top:0.04, right:0.30, bottom:0.24}`
   - 오른쪽 아래 네모 섬네일 → `{shape:"rect", left:0.68, top:0.70, right:0.96, bottom:0.94}`

   ⚠️ **얹힌 작은 사진만이다.** 아래를 넣지 마라:
   - 본 사진 속에 실제로 있는 것(사람, 동물, 자동차, 간판)
   - 글자·자막 (그건 `text_area` 가 맡는다)
   - 하트·댓글 같은 인스타 UI 아이콘
   - 사진 전체를 덮을 만큼 큰 것

   그런 게 없으면 빈 배열 `[]` 을 내라. 억지로 찾지 마라.

## 원본에서 읽을 것

이미지에는 인스타 UI(하트, 댓글 수, 계정명, 캡션)가 같이 찍혀 있을 수 있다.
사진 속에 박힌 헤드라인과, 아래쪽 캡션 텍스트를 모두 읽고 사건을 파악하라.
`R*PIST`, `D3AD` 처럼 검열을 피하려고 변형된 철자는 원래 단어로 이해하되,
네가 쓰는 문구에서는 해당 언어의 정상적인 보도 표현을 써라.

## 숫자는 절대 바꾸지 마라 ⚠️

기간·나이·금액·인원·거리 같은 **숫자는 원문에 적힌 값을 그대로** 써라.
없는 숫자를 만들지도, 있는 숫자를 키우거나 줄이지도 마라.

그리고 **title_lines 와 body 의 숫자가 서로 달라선 안 된다.**
제목에 "3년"을 썼으면 본문도 3년이다. 한 게시물 안에서 숫자가 어긋나면
읽는 사람이 바로 알아채고, 그 순간 신뢰를 잃는다.

- 원문 `THREE YEARS` → 제목 "3년", 본문 "3년". "10년"은 **틀렸다.**
- 원문에 기간이 없다 → 숫자를 쓰지 말고 "오래", "한참" 처럼 써라.

숫자를 부풀리면 더 자극적으로 보일 것 같지만, 틀린 숫자는 후킹이 아니라
거짓말이다. 후킹은 **가려서** 만드는 것이지 **불려서** 만드는 것이 아니다.

## 지켜야 할 선

- 사실을 지어내지 마라. 이미지에서 확인되지 않는 이름·장소·사건을 만들지 마라.
- 사건이 불명확하면 무리하게 단정하지 말고 확인 가능한 선에서 써라.
- 피해자를 조롱하거나 폭력을 미화하지 마라. 무거운 사건은 무겁게 다뤄라.
  후킹은 자극이 아니라 궁금증에서 나온다.
"""


def build_user_prompt(lang: str, guide: str, style_sample: str,
                      category: str = "", variant: int = 0,
                      bg_note: str = "") -> str:
    lang_name = LANGUAGES.get(lang, "한국어")
    parts = [
        f"## 작성 언어\n\n**{lang_name}**로 써라. title_lines, body, hashtags 전부.",
        f"## {lang_name} 후킹 문법\n\n{LANG_STYLE.get(lang, LANG_STYLE['ko'])}",
    ]

    cat = CATEGORY_STYLE.get(category)
    if cat:
        parts.append(
            f"## 이 게시물의 분류 — {cat['name']}\n\n"
            f"**문구를 뽑는 관점**\n{cat['hook']}\n\n"
            "분류에 억지로 끼워 맞추지는 마라. 사진이 이 분류와 안 맞으면 "
            "사진에 보이는 것을 따르되, 어조만 이 방향으로 잡아라."
        )
    if guide.strip():
        parts.append(
            "## 이번 콘텐츠의 콘셉트·타깃\n\n"
            f"{guide.strip()}\n\n"
            "이 방향에 맞춰 어조를 잡아라. "
            "(이 지시가 한국어로 적혀 있어도, 산출물은 위에서 지정한 언어로 써라.)"
        )
    if bg_note.strip():
        # 배경 지시는 오직 scene 만을 위한 칸이다. 여기 적은 말이 제목이나
        # 본문으로 새어 들어가면 사용자는 "배경만 바꾸려 했는데 문구까지
        # 바뀌었다"고 느낀다. 그래서 적용 범위를 못 박아 둔다.
        parts.append(
            "## 새 배경 지시 (사용자가 직접 지정)\n\n"
            f"{bg_note.strip()}\n\n"
            "**이 지시는 `scene` 항목에만 적용된다.** 여기 적힌 장소로 배경을 "
            "정하고, 조명·시간대·분위기·질감은 네가 살을 붙여 한 문단으로 "
            "완성해라. 이 장소에서 벗어나지 마라.\n\n"
            "**title_lines, body, hashtags 에는 절대 반영하지 마라.** "
            "문구는 사진과 위의 다른 지시만 보고 쓴다. 배경 지시는 문구와 "
            "아무 상관이 없다."
        )
    if style_sample.strip():
        # 견본은 대개 한국어로 적혀 있는데 일본어·영어로 뽑을 때도 그대로
        # 넘어간다. 여기서 못 박아두지 않으면 샘플의 언어가 산출물에
        # 섞이거나, 어조 대신 문장을 그대로 옮겨오는 일이 생긴다.
        parts.append(
            "## 참고할 문체 샘플\n\n"
            f"{style_sample.strip()}\n\n"
            "이 샘플의 *어조와 리듬*만 따라라. 내용을 베끼라는 것이 아니다.\n"
            f"**샘플이 어느 언어로 적혀 있든 산출물은 {lang_name}로 써라.** "
            f"샘플의 호흡과 온도를 {lang_name} 매체의 문법으로 옮기는 것이지, "
            "샘플의 문장을 번역하는 것이 아니다."
        )
    if variant > 0:
        # '다시 뽑기'를 눌렀다는 뜻이다. 같은 답을 또 주면 누른 보람이 없다.
        parts.append(
            "## 다시 뽑는 중이다\n\n"
            "앞서 뽑은 것이 마음에 들지 않아 다시 요청한 것이다.\n"
            "제목은 **다른 각도**에서 접근하라. 같은 문장 구조를 반복하지 마라."
        )

    parts.append("위 이미지를 보고 작업하라.")
    return "\n\n---\n\n".join(parts)


OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "source_text": {
            "type": "string",
            "description": "원본 이미지에서 읽어낸 문구 그대로",
        },
        "title_lines": {
            "type": "array",
            "items": {"type": "string"},
            "description": "이미지 위에 박을 제목. 2~3줄, 의미 단위로 끊어서",
        },
        "body": {"type": "string", "description": "인스타 캡션 본문 (해시태그 제외)"},
        "hashtags": {
            "type": "array",
            "items": {"type": "string"},
            "description": "'#'를 포함한 해시태그 10~15개",
        },
        "scene": {
            "type": "string",
            "description": (
                "주인공 뒤에 새로 깔 배경 묘사. 영어로 한 문단. "
                "주인공(사람·동물·사물 무엇이든)은 원본에서 그대로 오려 붙이므로 "
                "여기엔 배경만 쓴다. 장소·시간대·조명·분위기를 구체적으로 적어라. "
                "카메라 각도/구도, 주인공의 생김새, 주인공의 동작이나 자세는 "
                "절대 쓰지 마라 — 쓰면 주인공이 딴것으로 바뀐다. "
                "주인공이 아직 없는 '텅 빈 장소' 사진을 묘사하듯 써라. "
                "예: 'A rain-soaked city alley at night. Neon signs reflect in "
                "puddles on wet asphalt. Brick walls, a streetlamp glowing at the "
                "far end. Cold blue tones, heavy atmosphere. Sharp focus throughout.'"
            ),
        },
        "text_area": {
            "type": "object",
            "description": (
                "원본 사진에 박혀 있는 글자가 차지하는 세로 범위. "
                "이미지 전체 높이를 0.0(맨 위)~1.0(맨 아래)으로 봤을 때의 값. "
                "이 범위를 덮어서 원문을 가리므로 넉넉하게 잡아라."
            ),
            "properties": {
                "top": {"type": "number"},
                "bottom": {"type": "number"},
            },
            "required": ["top", "bottom"],
            "additionalProperties": False,
        },
        "overlays": {
            "type": "array",
            "description": (
                "본 사진 위에 얹혀 있는 작은 사진·배지의 자리. 동그란 인물 "
                "사진, 모서리의 네모 섬네일 같은 것. 배경을 새로 만들 때 이 "
                "자리는 원본을 그대로 도로 얹으므로, 사라지면 안 되는 것을 "
                "여기 적는다. 사진 속에 실제로 있는 것(사람·동물·사물), "
                "글자, 인스타 UI 아이콘은 넣지 마라. 없으면 빈 배열."
            ),
            "items": {
                "type": "object",
                "properties": {
                    "shape": {"type": "string", "enum": ["circle", "rect"]},
                    "left": {"type": "number"},
                    "top": {"type": "number"},
                    "right": {"type": "number"},
                    "bottom": {"type": "number"},
                },
                "required": ["shape", "left", "top", "right", "bottom"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["source_text", "title_lines", "body", "hashtags",
                 "scene", "text_area", "overlays"],
    "additionalProperties": False,
}


def _claude_message(exc: Exception) -> str:
    """Anthropic 이 돌려준 오류를 사용자가 알아들을 말로 바꾼다.

    그냥 두면 화면에 영어 딕셔너리가 통째로 뜬다. 제미니 쪽은 이미
    이렇게 옮기고 있는데(_gemini_message) 이쪽만 빠져 있었다.
    """
    raw = str(exc)
    low = raw.lower()

    if "credit balance is too low" in low or "insufficient" in low:
        return ("Anthropic 잔액이 떨어졌습니다. console.anthropic.com 의 "
                "Billing 에서 '자금 추가'로 충전해주세요. "
                "(사진 한 장에 대략 30~40원 듭니다)")
    if "invalid x-api-key" in low or "authentication_error" in low:
        return ("Anthropic 키가 올바르지 않습니다. 화면 왼쪽 위 '설정'에서 "
                "sk-ant- 로 시작하는 키를 다시 넣어주세요. "
                "(중간에 줄바꿈이나 따옴표가 섞이지 않았는지 확인해주세요)")
    if "permission" in low or "forbidden" in low:
        return "이 키로는 쓸 수 없습니다. 키를 만든 계정과 워크스페이스를 확인해주세요."
    if "rate_limit" in low or "429" in raw:
        return "Anthropic 분당 한도에 걸렸습니다. 잠시 뒤 다시 시도해주세요."
    if "overloaded" in low or "529" in raw:
        return "Anthropic 서버가 붐빕니다. 잠시 뒤 다시 시도해주세요."
    return raw


def generate_copy(image_b64: str, media_type: str, lang: str,
                  guide: str, style_sample: str,
                  category: str = "", variant: int = 0,
                  bg_note: str = "") -> dict:
    """이미지 한 장 → 제목·본문·해시태그."""
    import anthropic

    api_key = check_key(get_api_key(), "Anthropic")
    if not api_key:
        raise RuntimeError(
            "Anthropic 키가 설정되지 않았습니다. 화면 왼쪽 위 '설정'에서 넣어주세요."
        )

    client = anthropic.Anthropic(
        api_key=api_key, timeout=180.0,
        default_headers={"anthropic-workspace-id": ANTHROPIC_WORKSPACE_ID},
    )

    request = dict(
        model=MODEL,
        max_tokens=4000,
        system=SYSTEM_PROMPT,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": media_type,
                        "data": image_b64,
                    },
                },
                {"type": "text",
                 "text": build_user_prompt(lang, guide, style_sample,
                                           category, variant, bg_note)},
            ],
        }],
        output_config={"format": {"type": "json_schema", "schema": OUTPUT_SCHEMA}},
    )

    # 무거운 사건(범죄·사망)을 다루는 캡쳐가 흔하다. 안전 분류기가 한 번 거절해도
    # 같은 요청이 대체 모델에서 이어지도록 서버측 폴백을 켜 둔다.
    try:
        response = client.messages.create(
            **request,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except (anthropic.BadRequestError, TypeError):
        # 폴백 베타를 못 쓰는 환경이면 그냥 진행한다.
        # 여기서 또 실패하면 그건 진짜 오류이므로 알아들을 말로 바꿔 올린다.
        try:
            response = client.messages.create(**request)
        except anthropic.APIError as exc:
            raise RuntimeError(_claude_message(exc)) from None
    except anthropic.APIError as exc:
        raise RuntimeError(_claude_message(exc)) from None

    if response.stop_reason == "refusal":
        detail = ""
        if getattr(response, "stop_details", None):
            detail = f" ({response.stop_details.category})"
        raise RuntimeError(
            f"이 이미지는 생성이 거절되었습니다{detail}. 다른 이미지로 시도해보세요."
        )

    text = next((b.text for b in response.content if b.type == "text"), None)
    if not text:
        raise RuntimeError("응답이 비어 있습니다. 다시 시도해주세요.")

    data = json.loads(text)
    data["usage"] = {
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens,
    }
    return data


# ─────────────────────────────────────────────────────────────
# 원본 글자 지우기 (Gemini)
# ─────────────────────────────────────────────────────────────

GEMINI_HOST = "https://generativelanguage.googleapis.com/v1beta"

# 워터마크·로고 제거는 요청하지 않는다. 출처 표시를 지우는 요청으로 분류되어
# 정책상 차단되고, 그러면 한 장도 처리하지 못한다.
ERASE_PROMPT = """\
Remove all the text and captions burned into this image completely.
Reconstruct what was hidden behind the text naturally, matching the
surrounding scene, lighting, texture and grain.

Keep everything else exactly the same - the same people, the same
composition, the same framing, the same colors. Do not crop or zoom.
Do not add any new text. Do not change anyone's face or appearance.
"""

# 사진을 새로 만든다. 주인공(사람이든 동물이든 사물이든)과 자세·구도는
# 그대로 두고 "배경만" 새로 그린다 — 제미니 쪽 용어로는 "피사체 보존 배경 교체
# (Subject-Preserving Background Replacement)" / "생성형 채우기 기반
# 배경 교체(Generative Fill Background Replacement)"에 해당한다.
# (예전엔 아예 "새로운 사진"을 통째로 다시 찍으라고 시켰더니 사람 자체가
#  달라지는 문제가 있어서, 지금은 배경 교체로 방향을 바꿨다.)
RECREATE_PROMPT = """\
TASK TYPE: Photo editing (inpainting / outpainting), NOT new image
generation.

STEP 1 - Identify the MAIN SUBJECT of the reference photo yourself. The
main subject is whatever the photo is actually about. It is NOT always a
person: it may be a person, several people, an animal, a fish or a shark,
a vehicle, a building, a plant, a piece of food, or any other object. If
more than one thing is clearly prominent, treat all of them as the main
subject and keep every one of them.

STEP 2 - Treat that main subject as a fixed, immovable foreground layer to
be copied over unchanged - like a cutout pasted onto a new backdrop, not
redrawn.

Do not redraw, restyle, reinterpret, or regenerate the main subject in any
way. Its exact silhouette, outline, colours, texture, markings, surface
detail, pose and orientation, proportions, scale, and exact pixel position
in the frame must all stay identical to the reference photo. When the
subject is a person or an animal, that also means the identical face,
facial features, skin or fur, hairstyle, expression, body pose and
clothing. Someone who knows the original must instantly recognise the
result as the very same subject in the very same pose - not a
similar-looking one, not a re-enactment, not a new photoshoot.

Only the pixels behind the subject (the background/environment) should be
erased and generatively filled in with the new setting described below.
Blend the new background naturally with the subject's existing edges,
lighting direction and shadows so there is no cutout or collage look.

The new background must be ONE single, continuous, consistent environment
that fills the entire area behind and around the subject, from edge to edge
of the image. Never split the image into two different-looking areas or mix
two different locations/rooms/settings in the same photo (for example, do
not show one setting near the subject and a different, unrelated setting
elsewhere in the frame). It must look like one real, physically coherent
room or place, photographed in a single shot.

Render the new background in clear, sharp focus with rich, visible detail -
do NOT apply heavy blur, bokeh, or soft-focus/out-of-focus effects to it,
even if the original photo's background was blurred. A crisp, detailed
backdrop reads much better for a news thumbnail than a foggy one. Only the
thin strip of pixels immediately touching the subject's silhouette may be
softened slightly, purely to blend the edge seamlessly.

New background to generate:

{scene}

Do not change the camera framing, zoom, angle, viewpoint, perspective, or
crop from the original photo - the camera stays exactly where it was. Do
not add, move, rotate, resize, or remove any part of the main subject, and
do not change what it is doing. Even if the background description above
seems to suggest a different viewpoint or action, the original framing and
the original subject always win.

Photorealistic, natural lighting consistent with the subject. Portrait
orientation. No text, no captions, no letters or numbers anywhere in the
image.
"""

# 저장 크기(4:5 / 1:1 / 9:16)에 맞춰 여백 없이 확장한다. 사진을 자르거나
# 늘리지 않고, 부족한 자리만 원본과 이어지게 새로 그려 채운다.
EXPAND_PROMPT = """\
Outpaint this image to completely fill a new canvas.

Keep the entire original image exactly as it is - same subject, same people,
same framing, same colors, same lighting, same composition, same text if any
is visible. Do not crop, zoom, stretch, retouch, or alter the original pixels
in any way. Do not move or resize it.

Only generate new photorealistic content in the newly added space around the
original image's edges, naturally continuing the same scene - matching
lighting, perspective, texture, color grading and grain. Do not add any new
text, captions, letters, numbers, logos, watermarks, or new people/animals in
the newly generated area.
"""

# 저장 크기 → Gemini 가 이해하는 종횡비 문자열. generationConfig.imageConfig
# 로 그대로 넘긴다 (nano-banana 계열이 지원하는 값 중에서 고른 것들).
SAVE_ASPECTS = {"ig": "4:5", "th": "1:1", "tt": "9:16"}


_MODEL_CACHE: dict = {}

# 분당 한도를 한 번이라도 본 뒤에는 요청 사이에 간격을 둔다.
# 20장을 연달아 던지면 앞의 몇 장만 되고 나머지는 전부 한도에 걸린다.
# 한 번 데인 뒤부터 천천히 가는 편이, 빨리 가서 전부 실패하는 것보다 낫다.
_pace_lock = threading.Lock()
_pace = {"last": 0.0, "gap": 0.0}


def _wait_turn() -> None:
    with _pace_lock:                      # 잠근 채로 쉰다 — 요청이 겹치면 안 된다
        gap = _pace["gap"]
        if gap > 0:
            left = gap - (time.time() - _pace["last"])
            if left > 0:
                print(f"  한도를 아끼려고 {left:.0f}초 쉽니다")
                time.sleep(left)
        _pace["last"] = time.time()


# 분당 한도는 모델마다 따로 걸린다. 방금 걸린 모델을 다음 사진에서도
# 맨 앞에 두면 매번 한 번씩 헛되이 태운다. 잠시 뒤로 미뤄둔다.
_cooldown: dict = {}


def _cool_down(model: str, seconds: float) -> None:
    _cooldown[model] = time.time() + min(max(seconds or 60.0, 30.0), 300.0)


def _order_models(models: list) -> list:
    now = time.time()
    # 쉬고 있는 모델을 뒤로. 같은 무리 안에서는 원래 순서를 지킨다.
    return sorted(models, key=lambda m: _cooldown.get(m, 0.0) > now)


def _note_rate_limit(retry_after: float) -> None:
    with _pace_lock:
        _pace["gap"] = min(max(_pace["gap"], retry_after or 8.0, 8.0), 30.0)


def _quota_info(body: str) -> dict:
    """구글이 429 와 함께 보내는 한도 정보를 읽는다.

    얼마나 기다리라고 알려주고(RetryInfo), 어떤 한도가 걸렸는지도 알려준다
    (QuotaFailure). 분당 한도는 기다리면 풀리지만 하루 한도는 기다려도
    소용없으므로, 둘을 구분해야 헛되이 기다리지 않는다.
    """
    out = {"retry_after": 0.0, "per_day": False}
    # 오류 처리 중에 죽으면 진짜 원인이 사용자에게 닿지 않는다. 형태를 믿지 않는다.
    try:
        parsed = json.loads(body)
        details = (parsed or {}).get("error", {}) or {}
        details = details.get("details") or []
    except (json.JSONDecodeError, AttributeError, TypeError):
        return out
    if not isinstance(details, list):
        return out

    for item in details:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("@type", ""))
        if kind.endswith("RetryInfo"):
            raw = str(item.get("retryDelay", "")).rstrip("s")
            try:
                out["retry_after"] = float(raw)
            except ValueError:
                pass
        elif kind.endswith("QuotaFailure"):
            violations = item.get("violations") or []
            if not isinstance(violations, list):
                continue
            for v in violations:
                if not isinstance(v, dict):
                    continue
                blob = f"{v.get('quotaId', '')} {v.get('quotaMetric', '')}".lower()
                if "perday" in blob.replace("_", "") or "per_day" in blob:
                    out["per_day"] = True
    return out


def _gemini_message(status: int, body: str) -> str:
    """구글이 돌려준 오류를 사용자가 알아들을 수 있는 말로 바꾼다."""
    try:
        err = (json.loads(body) or {}).get("error") or {}
        detail = str(err.get("message", "")) if isinstance(err, dict) else ""
    except (json.JSONDecodeError, AttributeError, TypeError):
        detail = body[:200]
    if status in (400, 401, 403):
        low = detail.lower()
        if "api key" in low or "api_key" in low or "unauthenticated" in low:
            return ("Gemini 키가 올바르지 않습니다. "
                    "Google AI Studio 에서 키를 다시 확인해주세요.")
        if "billing" in low or "quota" in low:
            return ("Gemini 사용 한도에 걸렸거나 결제가 설정되지 않았습니다. "
                    f"({detail[:120]})")
        return f"Gemini 가 요청을 거절했습니다. {detail[:160]}"
    if status == 429:
        info = _quota_info(body)
        if info["per_day"]:
            return ("오늘 쓸 수 있는 Gemini 무료 횟수를 다 썼습니다. "
                    "내일이면 풀리지만, 계속 쓰시려면 Google AI Studio 에서 "
                    "결제를 설정해야 합니다. (월 지출 한도를 함께 걸어두세요)")
        return ("Gemini 분당 한도에 걸렸습니다. 기다렸다 다시 시도했는데도 "
                "계속 걸립니다. 무료 한도는 매우 적으니 Google AI Studio 에서 "
                "결제를 설정하면 한도가 크게 올라갑니다.")
    return f"Gemini 오류 {status}: {detail[:160]}"


def _gemini_get(path: str, key: str) -> dict:
    import urllib.error
    import urllib.request
    req = urllib.request.Request(f"{GEMINI_HOST}/{path}", headers={"x-goog-api-key": key})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(
            _gemini_message(exc.code, exc.read().decode("utf-8", "replace"))
        ) from None
    except TimeoutError:
        raise RuntimeError("Gemini 서버 응답이 너무 늦습니다 (30초 초과). 잠시 후 다시 시도해주세요.") from None
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Gemini 에 연결하지 못했습니다. 인터넷을 확인해주세요. ({exc.reason})") from None


def list_image_models(key: str) -> list:
    """이 키로 쓸 수 있는 이미지 모델을 좋은 것부터 늘어놓는다.

    구글이 모델 이름을 수시로 바꾸므로 코드에 박아두지 않고 물어본다.
    lite 모델은 사진 편집을 제대로 못 하고 받은 사진을 그대로 돌려주는
    일이 있어서 맨 뒤로 보낸다.
    """
    if "available" in _MODEL_CACHE:
        return _MODEL_CACHE["available"]

    data = _gemini_get("models?pageSize=200", key)
    usable = [
        m["name"].split("/")[-1] for m in data.get("models", [])
        if "generateContent" in (m.get("supportedGenerationMethods") or [])
        and "image" in m["name"].lower()
        and "embedding" not in m["name"].lower()
    ]

    def tier(name: str) -> int:
        """정식 출시본을 미리보기(preview)보다 먼저 쓴다.

        preview 모델은 구글이 서버를 조금만 열어둬서 늘 붐빈다. 성능이
        좋아도 매번 막히면 쓸모가 없다. lite 는 편집을 못 하므로 맨 뒤.
        """
        low = name.lower()
        if "lite" in low:
            return 4
        preview = 2 if ("preview" in low or "-exp" in low) else 0
        return preview + (0 if "pro" in low else 1)

    usable.sort(reverse=True)      # 새 버전 먼저
    usable.sort(key=tier)          # 파이썬 정렬은 안정적이라 등급이 우선한다

    _MODEL_CACHE["available"] = usable
    return usable


def pick_image_model(key: str) -> str:
    """쓸 모델을 정한다. 사용자가 고른 것이 있으면 그것을 쓴다."""
    picked = (load_config().get("gemini_model") or "").strip()
    if picked:
        return f"models/{picked.split('/')[-1]}"

    if "id" in _MODEL_CACHE:
        return _MODEL_CACHE["id"]

    usable = list_image_models(key)
    if not usable:
        raise RuntimeError(
            "이 키로 쓸 수 있는 이미지 모델을 찾지 못했습니다. "
            "Google AI Studio 에서 결제가 설정돼 있는지 확인해주세요."
        )
    chosen = f"models/{usable[0]}"
    _MODEL_CACHE["id"] = chosen
    print(f"  이미지 모델: {usable[0]}")
    print(f"  (고를 수 있는 모델: {', '.join(usable[:8])})")
    return chosen


def _looks_unchanged(before_b64: str, after_b64: str) -> bool:
    """돌려받은 사진이 보낸 것과 사실상 같은지 본다.

    바이트가 같으면 확실하고, 길이가 거의 같으면 의심한다. 재압축되면
    바이트는 달라지지만 크기는 비슷하게 남기 때문이다.
    """
    if before_b64 == after_b64:
        return True
    a, b = len(before_b64), len(after_b64)
    if not a or not b:
        return False
    return abs(a - b) / max(a, b) < 0.005


def build_image_prompt(mode: str, story: str, bg_note: str = "") -> str:
    """모드에 맞는 지시문을 만든다.

    새로 만들기에는 Claude 가 설계한 장면 묘사를 넣는다. 막연히 "새로
    만들라"고만 하면 모델이 원본 사진에 붙잡혀 편집만 하고 만다.
    """
    if mode == "expand":
        return EXPAND_PROMPT
    if mode != "recreate":
        return ERASE_PROMPT
    scene = (story or "").strip()
    if not scene:
        scene = ("A new, contextually fitting empty location behind the main "
                 "subject, clearly different from the reference image's "
                 "background, in sharp focus.")
    scene = scene[:800]
    # 사용자가 배경 칸에 직접 적은 지시. Claude 가 이미 scene 에 반영했겠지만,
    # 놓쳤을 수도 있으므로 여기서 한 번 더, 그것도 마지막에 못 박는다.
    # 마지막에 두는 이유: 앞의 묘사와 어긋날 때 사용자가 적은 쪽이 이겨야 한다.
    note = (bg_note or "").strip()[:300]
    if note:
        scene += ("\n\nThe location of the new background is fixed by the user "
                  f"and must be exactly this: {note}\n"
                  "This overrides any conflicting location above. It describes "
                  "the BACKGROUND ONLY - it never changes the main subject, "
                  "its pose, or the camera framing.")
    return RECREATE_PROMPT.format(scene=scene)


def candidate_models(key: str) -> list:
    """시도할 모델을 순서대로. 사용자가 고른 것이 있으면 그것만 쓴다."""
    picked = (load_config().get("gemini_model") or "").strip()
    if picked:
        return [picked.split("/")[-1]]
    usable = list_image_models(key)
    if not usable:
        raise RuntimeError(
            "이 키로 쓸 수 있는 이미지 모델을 찾지 못했습니다. "
            "Google AI Studio 에서 결제가 설정돼 있는지 확인해주세요."
        )
    return usable[:3]


def _call_image_model(model: str, key: str, image_b64: str,
                      media_type: str, prompt: str, patient: bool = False,
                      aspect_ratio: str = "", quick: bool = False) -> dict:
    """모델 하나에 요청한다.

    patient 가 아니면 한 번만 시도하고 실패를 올린다. 붐비는 모델을 붙잡고
    기다리느니 다른 모델로 가는 편이 훨씬 빠르기 때문이다.

    aspect_ratio 를 주면(예: "4:5") 저장 크기 확장(expand) 때만 쓰이고,
    구글이 그 비율에 맞춰 캔버스를 잡아준다 — 그래도 정확한 픽셀까지는
    보장 안 하므로, 받은 뒤 화면에서 다시 그 비율의 정확한 크기로
    맞춰 그린다.
    """
    import urllib.error
    import urllib.request

    body: dict = {
        "contents": [{
            "parts": [
                {"inline_data": {"mime_type": media_type, "data": image_b64}},
                {"text": prompt},
            ]
        }],
    }
    if aspect_ratio:
        body["generationConfig"] = {
            "imageConfig": {"aspectRatio": aspect_ratio},
        }
    payload = json.dumps(body).encode("utf-8")

    MAX_TRIES = 4 if patient else 1
    data = None
    for attempt in range(MAX_TRIES):
        if not quick:            # 저장은 사람이 앞에서 기다린다. 쉬지 않는다.
            _wait_turn()
        req = urllib.request.Request(
            f"{GEMINI_HOST}/models/{model}:generateContent",
            data=payload,
            headers={"Content-Type": "application/json", "x-goog-api-key": key},
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", "replace")

            # 붐비는 것(503)은 기다리기보다 다른 모델로 가는 편이 빠르다.
            # 여기서 참는 것은 분당 한도뿐이고, 그것도 기다리라고 한 만큼만이다.
            hint = 0.0
            if exc.code == 429:
                info = _quota_info(body)
                if not info["per_day"]:
                    hint = info["retry_after"]
                    _note_rate_limit(hint)
            if exc.code == 429 and patient:
                info = _quota_info(body)
                if not info["per_day"] and attempt < MAX_TRIES - 1:
                    wait = min((info["retry_after"] or 15 * (attempt + 1)) + 2, 120)
                    print(f"  분당 한도 — {wait:.0f}초 기다립니다 ({attempt + 1}/{MAX_TRIES - 1})")
                    time.sleep(wait)
                    continue

            if exc.code in (500, 502, 503, 504) and patient and attempt < MAX_TRIES - 1:
                wait = 8 * (attempt + 1)
                print(f"  {model} 이 붐빕니다 — {wait}초 뒤 다시 ({attempt + 1}/{MAX_TRIES - 1})")
                time.sleep(wait)
                continue

            raise _Busy(exc.code, _gemini_message(exc.code, body), hint) from None
        except TimeoutError:
            # 소켓 자체가 응답을 못 받아 끊긴 경우(HTTPError 도 URLError 도 아님).
            # 여기서 못 잡으면 180초를 그냥 흘려보낸 뒤 사용자에게 알 수 없는
            # 오류로만 보인다 — 다른 모델로 넘어가거나(비-patient), 잠깐
            # 쉬었다 같은 모델을 다시 불러본다(patient).
            if patient and attempt < MAX_TRIES - 1:
                wait = 5 * (attempt + 1)
                print(f"  {model} 응답 시간 초과 — {wait}초 뒤 다시 ({attempt + 1}/{MAX_TRIES - 1})")
                time.sleep(wait)
                continue
            raise _Busy(0, f"{model} 이 응답 시간을 초과했습니다 (180초).") from None
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Gemini 에 연결하지 못했습니다. ({exc.reason})") from None

    if data is None:
        raise _Busy(503, f"{model} 이 계속 붐빕니다.")

    candidates = data.get("candidates") or []
    if not candidates:
        blocked = (data.get("promptFeedback") or {}).get("blockReason")
        raise RuntimeError(
            f"이 사진은 처리가 거절되었습니다 ({blocked})." if blocked
            else "Gemini 응답이 비어 있습니다."
        )

    for part in candidates[0].get("content", {}).get("parts", []):
        blob = part.get("inlineData") or part.get("inline_data")
        if blob and blob.get("data"):
            out = blob["data"]
            # 어떤 모델은 편집을 못 하면 받은 사진을 그대로 돌려준다. 그러면
            # "지웠다"고 표시되지만 실제로는 영어가 남아 결과물이 망가진다.
            if _looks_unchanged(image_b64, out):
                raise _Busy(0, f"{model} 이 사진을 손대지 않고 그대로 돌려줬습니다.")
            return {"image_b64": out, "model": model,
                    "media_type": blob.get("mimeType") or blob.get("mime_type") or "image/png"}

    reason = candidates[0].get("finishReason", "")
    raise _Busy(0, f"{model} 이 이미지를 돌려주지 않았습니다"
                   f"{f' ({reason})' if reason else ''}.")


class _Busy(Exception):
    """다른 모델로 넘어가 볼 만한 실패."""

    def __init__(self, code: int, message: str, retry_after: float = 0.0):
        super().__init__(message)
        self.code = code
        self.retry_after = retry_after      # 구글이 알려준 대기 시간(초)


def transform_image(image_b64: str, media_type: str,
                    mode: str = "erase", story: str = "",
                    target_ratio: str = "", bg_note: str = "") -> dict:
    """사진에서 글자를 지우거나(erase), 같은 인물로 장면을 새로 만들거나
    (recreate), 저장 크기에 맞게 여백 없이 확장한다(expand).

    한 모델이 붐비거나 한도에 걸리거나 편집을 못 하면 다음 모델로 넘어간다.
    한 곳이 막혔다고 손을 놓으면 사용자가 할 수 있는 일이 없다.
    """
    key = check_key(get_gemini_key(), "Gemini")
    if not key:
        raise RuntimeError("Gemini 키가 없습니다.")

    prompt = build_image_prompt(mode, story, bg_note)
    aspect = target_ratio if mode == "expand" else ""
    # 방금 분당 한도에 걸린 모델은 뒤로 미뤄 둔다. 매번 같은 모델로 시작하면
    # 그 한 번이 늘 헛되이 나간다.
    models = _order_models(candidate_models(key))
    tried = []

    # 저장(expand)과 글자 지우기(erase) 둘 다 사용자가 화면 앞에서 기다리는
    # 동작이다. 여기서 쉬거나 다시 시도하면 몇십 초~몇 분씩 멈춘 것처럼
    # 보인다. 한 바퀴 돌아 안 되면 바로 포기하고, 화면 쪽 덮어쓰기 처리로
    # 즉시 넘어간다. (분당 한도가 실제로 회복되길 기다리는 건 밑에 있는
    # "2차 — 붐빔(503) 등" 단계에서만, 그것도 한도가 아닌 경우에만 한다.)
    quick = mode in ("expand", "erase")

    def once(model):
        return _call_image_model(model, key, image_b64, media_type, prompt,
                                 aspect_ratio=aspect, quick=quick)

    # 1차 — 한 번씩 빠르게 훑는다.
    #
    # 분당 한도는 모델마다 따로 걸린다. 그러니 한 모델이 한도에 걸렸다고
    # 멈추면 안 된다 — 옆 모델에는 아직 남아 있을 수 있고, 그게 기다리는
    # 것보다 훨씬 빠르다. 걸린 모델은 다음 사진에서 뒤로 미룬다.
    wait_hint = 0.0
    only_rate_limit = True
    for model in models:
        try:
            return once(model)
        except _Busy as exc:
            tried.append(str(exc))
            if exc.code == 429:
                wait_hint = max(wait_hint, exc.retry_after)
                _cool_down(model, exc.retry_after)
                print(f"  {model} 분당 한도 → 다음 모델로")
            else:
                only_rate_limit = False
                print(f"  {model} 실패 → 다음 모델로")

    if quick:
        seen = list(dict.fromkeys(tried))
        raise RuntimeError(" / ".join(seen) or "쓸 수 있는 모델이 없습니다.")

    if only_rate_limit:
        # 전부 분당 한도. 모델을 더 두드려봐야 같은 벽이다. 구글이 알려준
        # 만큼 딱 한 번 쉬고 한 바퀴만 더 돈다. 예전처럼 모델마다 네 번씩
        # 기다리면 사진 한 장에 100초를 버리고도 결국 실패한다.
        wait = min((wait_hint or 20.0) + 3.0, 70.0)
        print(f"  모든 모델이 분당 한도입니다 — {wait:.0f}초 쉬고 한 바퀴만 더")
        time.sleep(wait)
        for model in models:
            try:
                return once(model)
            except _Busy as exc:
                tried.append(str(exc))
        seen = list(dict.fromkeys(tried))
        raise RuntimeError(" / ".join(seen))

    # 2차 — 한도가 아니라 붐빔(503) 등이면 기다려가며 다시 시도한다.
    print("  모든 모델이 막혔습니다. 기다렸다 다시 시도합니다…")
    for model in models:
        try:
            return _call_image_model(model, key, image_b64, media_type, prompt,
                                     patient=True, aspect_ratio=aspect)
        except _Busy as exc:
            tried.append(str(exc))

    seen = list(dict.fromkeys(tried))
    raise RuntimeError(" / ".join(seen) or "쓸 수 있는 모델이 없습니다.")


# ─────────────────────────────────────────────────────────────
# 파일 저장
# ─────────────────────────────────────────────────────────────

_UNSAFE = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def safe_name(name: str, fallback: str = "무제") -> str:
    """파일명으로 쓸 수 없는 문자를 걷어낸다."""
    cleaned = _UNSAFE.sub("", name).strip().strip(".")
    cleaned = re.sub(r"\s+", " ", cleaned)
    return (cleaned or fallback)[:60]


def unique_path(path: Path) -> Path:
    """같은 이름이 있으면 (2), (3) 을 붙인다. 덮어쓰지 않는다."""
    if not path.exists():
        return path
    stem, suffix, n = path.stem, path.suffix, 2
    while True:
        cand = path.with_name(f"{stem} ({n}){suffix}")
        if not cand.exists():
            return cand
        n += 1


def save_batch(items: list, folder_label: str = "", flat: bool = False) -> dict:
    """완성된 카드를 저장한다.

    flat=False : '출력/날짜_시각_이름/' 아래에 이미지+캡션 쌍으로 (여러 장 한꺼번에)
    flat=True  : '출력/이름/' 아래에 이미지만 (한 장씩 카테고리 폴더에 쌓기)
    """
    label = safe_name(folder_label, "") if folder_label else ""

    if flat and label:
        out = get_output_dir() / label
    else:
        stamp = datetime.now().strftime("%Y%m%d_%H%M")
        out = get_output_dir() / (f"{stamp}_{label}" if label else stamp)
    out.mkdir(parents=True, exist_ok=True)

    saved = []
    for i, item in enumerate(items, start=1):
        title = " ".join(item.get("title_lines") or []) or "무제"

        if flat:
            # 한 장씩 쌓이므로, 같은 제목이 있으면 덮어쓰지 않고 번호를 붙인다.
            stem = safe_name(title)
            base, n = stem, 2
            while (out / f"{stem}.png").exists():
                stem = f"{base} ({n})"
                n += 1
        else:
            stem = f"{i:02d}_{safe_name(title)}"

        png = base64.b64decode(item["image_b64"])
        (out / f"{stem}.png").write_bytes(png)

        if not flat:
            body = (item.get("body") or "").rstrip()
            tags = " ".join(item.get("hashtags") or [])
            (out / f"{stem}.txt").write_text(
                f"{body}\n\n{tags}\n" if tags else f"{body}\n", encoding="utf-8"
            )
        saved.append(f"{stem}.png")

    return {"dir": str(out), "count": len(saved), "files": saved}


def zip_dir(target: Path) -> bytes:
    import io
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(target.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(target))
    return buf.getvalue()


# ─────────────────────────────────────────────────────────────
# HTTP
# ─────────────────────────────────────────────────────────────

# 북마크릿은 threads.net(외부 페이지)에서 우리 로컬 서버로 요청을 보낸다.
# 브라우저 CORS 규칙상 이 몇 개 주소만 다른 출처(cross-origin)에서 오는
# 요청을 허락해준다. 나머지 기존 주소들(/api/config 등)은 대시보드
# 자기 자신만 부르므로 그대로 둔다 — 건드리지 않는다.
_CORS_PATHS = {"/api/ping", "/api/thread-capture", "/api/thread-inbox"}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        # 요청마다 콘솔을 채우지 않는다. 오류는 따로 찍는다.
        pass

    # -- helpers ------------------------------------------------

    def _send(self, code: int, body: bytes, ctype: str, extra: dict = None,
              cors: bool = False):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cors:
            self.send_header("Access-Control-Allow-Origin", "*")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, payload: dict, cors: bool = False):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send(code, body, "application/json; charset=utf-8", cors=cors)

    def _serve_result(self):
        """다 만든 영상을 화면에 돌려준다 — 미리 보고, 원하면 내려받는다."""
        from urllib.parse import parse_qs, urlparse
        q = parse_qs(urlparse(self.path).query)
        job = video_job_state((q.get("id") or [""])[0])
        out = job.get("out")
        if not out or not Path(out).exists():
            return self._json(404, {"error": "결과 영상을 찾지 못했습니다."})

        target = Path(out)
        size = target.stat().st_size
        extra = {"Accept-Ranges": "bytes"}
        if (q.get("dl") or [""])[0]:
            # 파일 이름에 한글이 들어가므로 RFC 5987 형식으로 함께 적는다.
            quoted = urllib.parse.quote(target.name)
            extra["Content-Disposition"] = (
                f"attachment; filename=\"video.mp4\"; filename*=UTF-8''{quoted}")

        # 영상 재생기는 구간(Range)으로 나눠 달라고 한다. 이걸 받아주지
        # 않으면 재생 막대를 끌어 다른 데로 넘어갈 수가 없다.
        rng = self.headers.get("Range") or ""
        m = re.match(r"bytes=(\d*)-(\d*)", rng)
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else size - 1
            else:                                    # 끝에서 N 바이트
                start = max(0, size - int(m.group(2)))
                end = size - 1
            start = max(0, min(start, size - 1))
            end = max(start, min(end, size - 1))
            with open(target, "rb") as fp:
                fp.seek(start)
                chunk = fp.read(end - start + 1)
            extra["Content-Range"] = f"bytes {start}-{end}/{size}"
            return self._send(206, chunk, "video/mp4", extra)

        return self._send(200, target.read_bytes(), "video/mp4", extra)

    def _take_video(self) -> dict:
        """올라온 영상을 임시 폴더에 받아두고, 크기·길이와 미리보기를 준다."""
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            raise ValueError("영상이 비어 있습니다.")
        if length > MAX_VIDEO:
            raise ValueError(
                f"영상이 너무 큽니다. {MAX_VIDEO // (1024 * 1024)}MB 까지 됩니다.")

        VIDEO_DIR.mkdir(parents=True, exist_ok=True)
        # 올려둔 원본은 작업이 끝나도 남긴다 - 띠를 고쳐 다시 돌릴 때
        # 같은 영상을 또 올리게 하지 않기 위해서다. 대신 새 영상을 올릴
        # 때마다 오래된 것을 치운다.
        prune_video_temp()
        job_id = uuid.uuid4().hex[:12]
        src = VIDEO_DIR / f"{job_id}.mp4"

        # 한 번에 다 읽으면 큰 영상에서 메모리가 튄다. 조금씩 흘려 넣는다.
        left = length
        with open(src, "wb") as fp:
            while left > 0:
                chunk = self.rfile.read(min(1024 * 512, left))
                if not chunk:
                    break
                fp.write(chunk)
                left -= len(chunk)

        try:
            info = video_info(str(src))
        except Exception:
            try:
                src.unlink()
            except OSError:
                pass
            raise
        info["id"] = job_id
        return info

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > MAX_BODY:
            raise ValueError("요청이 너무 큽니다.")
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def _serve_bookmarklet(self):
        # self.server 는 main() 에서 만든 ThreadingHTTPServer 인스턴스라,
        # 지금 이 서버가 실제로 물려 있는 포트를 여기서 정확히 알 수 있다.
        port = self.server.server_address[1]
        try:
            src = (WEB / "bookmarklet.src.js").read_text(encoding="utf-8")
        except OSError:
            return self._json(500, {"error": "bookmarklet.src.js 를 찾을 수 없습니다."})
        js = src.replace("__PORT__", str(port))
        html = BOOKMARKLET_INSTALL_TEMPLATE.format(port=port, payload=repr(js))
        self._send(200, html.encode("utf-8"), "text/html; charset=utf-8")

    # -- routes -------------------------------------------------

    def do_OPTIONS(self):
        # 북마크릿이 JSON 을 POST 하기 전에 브라우저가 미리 물어보는 요청
        # (preflight). 우리 수집 주소만 허락해주면 된다.
        #
        # + Private Network Access: 최근 크롬은 https 사이트(threads.com 등)가
        # 127.0.0.1 같은 사설/루프백 주소로 요청을 보낼 때 한 번 더 확인을
        # 요구한다. Access-Control-Allow-Private-Network 헤더를 안 주면
        # "프로그램을 찾을 수 없다"는 것과 똑같은 네트워크 오류로 막힌다.
        path = self.path.split("?", 1)[0]
        if path in _CORS_PATHS:
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_response(404)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0]

        if path == "/bookmarklet.html":
            # 정적 파일이 아니라 요청 시점에 지금 포트를 끼워 즉석 생성한다.
            return self._serve_bookmarklet()

        if path == "/api/ping":
            # 북마크릿이 여러 포트를 두드려보며 "이게 우리 서버 맞나?" 확인할 때 씀.
            return self._json(200, {"ok": True, "app": "hooking-factory"}, cors=True)

        if path == "/api/video/result":
            return self._serve_result()

        if path.startswith("/api/video/status"):
            from urllib.parse import parse_qs, urlparse
            job_id = (parse_qs(urlparse(self.path).query).get("id") or [""])[0]
            return self._json(200, video_job_state(job_id))

        if path == "/api/thread-inbox":
            # 대시보드가 몇 초마다 물어보는 자리. 쌓인 게 있으면 통째로 내주고 비운다.
            return self._json(200, {"items": thread_inbox_take()}, cors=True)

        if path == "/api/config":
            cfg = load_config()
            return self._json(200, {
                "has_key": bool(get_api_key()),
                "key_from_env": not cfg.get("api_key")
                                and bool(os.environ.get("ANTHROPIC_API_KEY")),
                "has_gemini": bool(get_gemini_key()),
                "output_dir": str(get_output_dir()),
                "languages": LANGUAGES,
            })

        if path == "/api/models":
            try:
                key = check_key(get_gemini_key(), "Gemini")
                if not key:
                    return self._json(200, {"models": [], "chosen": "",
                                            "error": "Gemini 키가 없습니다."})
                return self._json(200, {
                    "chosen": (load_config().get("gemini_model") or ""),
                    "models": list_image_models(key),
                })
            except Exception as exc:
                return self._json(200, {"models": [], "chosen": "", "error": str(exc)})

        if path == "/api/open-output":
            out = get_output_dir()
            out.mkdir(parents=True, exist_ok=True)
            open_in_file_manager(out)
            return self._json(200, {"ok": True, "dir": str(out)})

        return self._serve_static(path)

    def do_POST(self):
        path = self.path.split("?", 1)[0]

        # 영상은 수십 MB 다. JSON(base64) 으로 감싸면 크기가 1.4배로 불고
        # 메모리에 통째로 올라간다. 날것 그대로 받아 파일로 흘려 넣는다.
        if path == "/api/video/upload":
            try:
                return self._json(200, self._take_video())
            except Exception as exc:              # noqa: BLE001
                return self._json(400, {"error": str(exc)})

        try:
            payload = self._read_json()
        except (ValueError, json.JSONDecodeError) as exc:
            return self._json(400, {"error": str(exc)})

        try:
            if path == "/api/thread-capture":
                # 북마크릿이 스레드 글(사진 URL들 + 본문 + 카테고리)을 보내는 자리.
                result = thread_capture(payload)
                return self._json(200, result, cors=True)

            if path == "/api/config":
                cfg = load_config()
                # 빈 칸은 '지워라'가 아니라 '그대로 둬라'로 읽는다.
                #
                # 설정창을 열면 키 칸은 늘 비어 보인다(저장된 키를 화면으로
                # 돌려주지 않기 때문이다). 그 상태에서 한쪽 키만 넣고 저장하면
                # 빈 칸이 그대로 올라와 다른 키가 지워졌다. 하나를 고치면
                # 다른 하나가 깨지는 일이 여기서 났다.
                # 키를 정말 지우려면 설정 파일에서 그 줄을 지우면 된다.
                if (payload.get("api_key") or "").strip():
                    cfg["api_key"] = payload["api_key"].strip()
                if (payload.get("gemini_key") or "").strip():
                    cfg["gemini_key"] = payload["gemini_key"].strip()
                    _MODEL_CACHE.clear()
                    _cooldown.clear()
                    # 새 키는 한도가 새로 시작한다. 예전 키에서 막혔다고
                    # 뒤로 미뤄둔 모델을 그대로 두면 새 키에서도 건너뛴다.
                    _cooldown.clear()
                if "gemini_model" in payload:
                    m = (payload["gemini_model"] or "").strip()
                    if m:
                        cfg["gemini_model"] = m
                    else:
                        cfg.pop("gemini_model", None)
                    _MODEL_CACHE.pop("id", None)
                if "output_dir" in payload:
                    d = (payload["output_dir"] or "").strip()
                    if d:
                        cfg["output_dir"] = d
                    else:
                        cfg.pop("output_dir", None)
                save_config(cfg)
                return self._json(200, {"ok": True, "output_dir": str(get_output_dir())})

            if path == "/api/generate":
                data = generate_copy(
                    image_b64=payload["image_b64"],
                    media_type=payload.get("media_type", "image/png"),
                    lang=payload.get("lang", "ko"),
                    guide=payload.get("guide", ""),
                    style_sample=payload.get("style_sample", ""),
                    category=payload.get("category", ""),
                    variant=int(payload.get("variant") or 0),
                    bg_note=payload.get("bg_note", ""),
                )
                return self._json(200, data)

            if path == "/api/erase":
                mode = payload.get("mode", "erase")
                target_ratio = ""
                if mode == "expand":
                    # 저장 크기 코드(ig/th/tt)로 받으면 서버가 실제 비율로
                    # 바꿔준다 — 프론트가 임의 문자열을 보내 엉뚱한 값이
                    # generationConfig 로 그대로 나가는 일을 막는다.
                    size_key = payload.get("save_size", "")
                    target_ratio = SAVE_ASPECTS.get(size_key, "")
                    if not target_ratio:
                        return self._json(400, {"error": "저장 크기가 올바르지 않습니다."})
                result = transform_image(
                    image_b64=payload["image_b64"],
                    media_type=payload.get("media_type", "image/png"),
                    mode=mode,
                    story=payload.get("story", ""),
                    target_ratio=target_ratio,
                    bg_note=payload.get("bg_note", ""),
                )
                return self._json(200, result)

            if path == "/api/video/start":
                job_id = str(payload.get("id") or "")
                src = VIDEO_DIR / f"{job_id}.mp4"
                if not job_id.isalnum() or not src.exists():
                    return self._json(400, {"error": "영상을 다시 넣어주세요."})
                # 여러 띠를 받는다. 예전 방식(band 하나)도 그대로 받아준다.
                bands = payload.get("bands")
                if not bands:
                    one = payload.get("band")
                    bands = [one] if one else []
                clean = []
                for b in bands[:4]:
                    try:
                        clean.append([int(b[0]), int(b[1])])
                    except (TypeError, ValueError, IndexError):
                        pass
                bands = clean or None
                name = safe_name(payload.get("name") or "영상")
                out_dir = get_output_dir()
                out_dir.mkdir(parents=True, exist_ok=True)
                dst = unique_path(out_dir / f"{name}_자막지움.mp4")
                video_job_start(job_id, str(src), str(dst), bands)
                return self._json(200, {"ok": True, "id": job_id})

            if path == "/api/save":
                result = save_batch(payload.get("items", []),
                                    payload.get("label", ""),
                                    bool(payload.get("flat")))
                return self._json(200, result)

            if path == "/api/zip":
                target = Path(payload["dir"])
                if not target.is_dir():
                    return self._json(404, {"error": "폴더를 찾을 수 없습니다."})
                blob = zip_dir(target)
                return self._send(
                    200, blob, "application/zip",
                    {"Content-Disposition":
                     f'attachment; filename="{target.name}.zip"'},
                )

        except Exception as exc:  # 사용자에게 그대로 보여줄 메시지
            print(f"[오류] {path}: {exc}", file=sys.stderr)
            return self._json(500, {"error": str(exc)}, cors=path in _CORS_PATHS)

        return self._json(404, {"error": "없는 주소입니다."})

    # -- static -------------------------------------------------

    def _serve_static(self, path: str):
        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        target = (WEB / rel).resolve()
        if not str(target).startswith(str(WEB.resolve())) or not target.is_file():
            return self._json(404, {"error": "파일을 찾을 수 없습니다."})
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript",):
            ctype += "; charset=utf-8"
        self._send(200, target.read_bytes(), ctype)


def open_in_file_manager(path: Path) -> None:
    import subprocess
    try:
        if sys.platform == "win32":
            os.startfile(path)  # noqa: S606
        elif sys.platform == "darwin":
            subprocess.run(["open", str(path)], check=False)
        else:
            subprocess.run(["xdg-open", str(path)], check=False)
    except OSError:
        pass


def find_port(preferred: int = 8765) -> int:
    for port in range(preferred, preferred + 40):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError("쓸 수 있는 포트를 찾지 못했습니다.")


def main() -> None:
    try:
        import anthropic  # noqa: F401
    except ImportError:
        print("먼저 설치가 필요합니다:\n\n    pip install anthropic\n", file=sys.stderr)
        sys.exit(1)

    # 예전에 켜둔 서버가 8765 를 붙잡고 있으면 화면이 그쪽으로 열려
    # 새 파일이 반영되지 않는다. 아예 다른 자리에서 시작한다.
    port = find_port(8790)
    url = f"http://127.0.0.1:{port}"
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)

    print(f"\n  이미지 AI 자동화 v13.36 이 열렸습니다.\n\n    {url}\n")
    print(f"  실행 폴더: {ROOT}")
    print(f"  결과물 저장 위치: {get_output_dir()}")
    if not get_api_key():
        print("  ⚠ Anthropic 키가 없습니다. 화면 왼쪽 위 '설정'에서 넣어주세요.")
    print(f"  원본 글자 지우기: {'켜짐 (Gemini)' if get_gemini_key() else '꺼짐 — 글자를 덮습니다'}")
    print(f"  설정 파일: {CONFIG_PATH}")
    print("\n  끄려면 이 창에서 Ctrl+C\n")

    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  종료합니다.\n")
        server.shutdown()


if __name__ == "__main__":
    main()
