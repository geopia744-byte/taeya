"""
후킹 공장 — 로컬 서버

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
import sys
import threading
import time
import webbrowser
import zipfile
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
CONFIG_PATH = ROOT / "config.json"
DEFAULT_OUTPUT = ROOT / "출력"

MODEL = "claude-opus-5"

# 요청 본문 상한 (이미지 여러 장이 base64로 들어오므로 넉넉히)
MAX_BODY = 64 * 1024 * 1024


# ─────────────────────────────────────────────────────────────
# 설정
# ─────────────────────────────────────────────────────────────

def load_config() -> dict:
    if CONFIG_PATH.exists():
        try:
            return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def save_config(cfg: dict) -> None:
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

5. **text_area** — 사진에 **박혀 있는 글자**가 차지하는 세로 범위.
   이미지 맨 위를 0.0, 맨 아래를 1.0으로 보고 `top`과 `bottom`을 낸다.

   이 범위는 **덮어서 가려진다.** 그 위에 한국어 제목을 얹기 때문이다.
   그러니 **넉넉하게 잡아라** — 조금 남으면 영어가 비쳐서 결과물을 망친다.
   글자의 실제 위아래 끝보다 0.02~0.04 정도씩 더 여유를 둬라.

   - 사진 아래쪽에 두 줄이 박혀 있다 → 대략 `{top: 0.72, bottom: 1.0}`
   - 가운데를 크게 가로지른다 → 대략 `{top: 0.38, bottom: 0.72}`
   - 인스타 UI 안의 캡션 글은 여기 포함하지 마라. **사진 위에 얹힌 글자만** 센다.
   - 박힌 글자가 아예 없다 → `{top: 0, bottom: 0}`

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


def build_user_prompt(lang: str, guide: str, style_sample: str) -> str:
    lang_name = LANGUAGES.get(lang, "한국어")
    parts = [
        f"## 작성 언어\n\n**{lang_name}**로 써라. title_lines, body, hashtags 전부.",
        f"## {lang_name} 후킹 문법\n\n{LANG_STYLE.get(lang, LANG_STYLE['ko'])}",
    ]
    if guide.strip():
        parts.append(
            "## 이번 콘텐츠의 콘셉트·타깃\n\n"
            f"{guide.strip()}\n\n"
            "이 방향에 맞춰 어조를 잡아라. "
            "(이 지시가 한국어로 적혀 있어도, 산출물은 위에서 지정한 언어로 써라.)"
        )
    if style_sample.strip():
        parts.append(
            "## 참고할 문체 샘플\n\n"
            f"{style_sample.strip()}\n\n"
            "이 샘플의 *어조와 리듬*을 따라라. 내용을 베끼라는 것이 아니다."
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
    },
    "required": ["source_text", "title_lines", "body", "hashtags", "text_area"],
    "additionalProperties": False,
}


def generate_copy(image_b64: str, media_type: str, lang: str,
                  guide: str, style_sample: str) -> dict:
    """이미지 한 장 → 제목·본문·해시태그."""
    import anthropic

    api_key = check_key(get_api_key(), "Anthropic")
    if not api_key:
        raise RuntimeError(
            "Anthropic 키가 설정되지 않았습니다. 화면 왼쪽 위 '설정'에서 넣어주세요."
        )

    client = anthropic.Anthropic(api_key=api_key, timeout=180.0)

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
                {"type": "text", "text": build_user_prompt(lang, guide, style_sample)},
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
        response = client.messages.create(**request)

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

# 사진을 새로 만든다. 인물·동물의 생김새는 그대로 두고 장면만 다시 짠다.
# 지울 글자가 없으니 지우기 실패도 없고, 원본 사진을 그대로 쓰지도 않는다.
RECREATE_PROMPT = """\
Create a new photograph of the same subject shown in the reference image.

Identity must stay exactly the same. The same face, the same features,
the same build and clothing style; for an animal, the same species,
colouring and markings. Someone who knows this subject must recognise
them instantly.

Place that subject in a new cinematic scene that fits this story:

{story}

Fresh camera angle and background. Dramatic, filmic lighting. Photorealistic,
shallow depth of field, high detail. Portrait orientation.

No text, no captions, no letters or numbers anywhere in the image.
Do not reproduce the reference image's framing or its background.
"""


_MODEL_CACHE: dict = {}


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
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Gemini 에 연결하지 못했습니다. 인터넷을 확인해주세요. ({exc.reason})") from None


def pick_image_model(key: str) -> str:
    """이미지를 만들 수 있는 모델을 API 에 직접 물어서 고른다.

    구글이 모델 이름을 수시로 바꾸므로 코드에 박아두지 않는다.
    싼 것부터 고른다 — lite 가 있으면 lite, 없으면 flash, 그다음 나머지.
    """
    if "id" in _MODEL_CACHE:
        return _MODEL_CACHE["id"]

    data = _gemini_get("models?pageSize=200", key)
    usable = [
        m["name"] for m in data.get("models", [])
        if "generateContent" in (m.get("supportedGenerationMethods") or [])
        and "image" in m["name"].lower()
        and "embedding" not in m["name"].lower()
    ]
    if not usable:
        raise RuntimeError(
            "이 키로 쓸 수 있는 이미지 모델을 찾지 못했습니다. "
            "Google AI Studio 에서 결제가 설정돼 있는지 확인해주세요."
        )

    def rank(name: str) -> tuple:
        low = name.lower()
        return (0 if "lite" in low else 1 if "flash" in low else 2, len(name))

    chosen = sorted(usable, key=rank)[0]
    _MODEL_CACHE["id"] = chosen
    print(f"  이미지 모델: {chosen.split('/')[-1]}")
    return chosen


def build_image_prompt(mode: str, story: str) -> str:
    """모드에 맞는 지시문을 만든다."""
    if mode != "recreate":
        return ERASE_PROMPT
    clean = (story or "").strip()
    if not clean:
        clean = "A dramatic news moment involving this subject."
    return RECREATE_PROMPT.format(story=clean[:600])


def transform_image(image_b64: str, media_type: str,
                    mode: str = "erase", story: str = "") -> dict:
    """사진에서 글자를 지우거나(erase), 같은 인물로 장면을 새로 만든다(recreate)."""
    import urllib.error
    import urllib.request

    key = check_key(get_gemini_key(), "Gemini")
    if not key:
        raise RuntimeError("Gemini 키가 없습니다.")

    model = pick_image_model(key)
    payload = json.dumps({
        "contents": [{
            "parts": [
                {"inline_data": {"mime_type": media_type, "data": image_b64}},
                {"text": build_image_prompt(mode, story)},
            ]
        }],
    }).encode("utf-8")

    # 이미지 생성은 분당 허용 횟수가 적다. 429 는 기다렸다 다시 하면 대개 통과하므로
    # 사용자에게 떠넘기지 않고 여기서 참아준다.
    MAX_TRIES = 5
    data = None
    for attempt in range(MAX_TRIES):
        req = urllib.request.Request(
            f"{GEMINI_HOST}/{model}:generateContent",
            data=payload,
            headers={"Content-Type": "application/json", "x-goog-api-key": key},
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", "replace")
            if exc.code != 429:
                raise RuntimeError(_gemini_message(exc.code, body)) from None

            info = _quota_info(body)
            # 하루 한도는 기다려도 풀리지 않는다. 헛되이 붙잡고 있지 않는다.
            if info["per_day"] or attempt == MAX_TRIES - 1:
                raise RuntimeError(_gemini_message(429, body)) from None

            # 구글이 알려준 시간만큼 기다린다. 안 알려주면 점점 길게.
            wait = info["retry_after"] or (15 * (attempt + 1))
            wait = min(wait + 2, 120)
            print(f"  분당 한도 — {wait:.0f}초 기다립니다 ({attempt + 1}/{MAX_TRIES - 1})")
            time.sleep(wait)
            continue
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Gemini 에 연결하지 못했습니다. ({exc.reason})") from None

    if data is None:
        raise RuntimeError("Gemini 응답을 받지 못했습니다.")

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
            return {
                "image_b64": blob["data"],
                "media_type": blob.get("mimeType") or blob.get("mime_type") or "image/png",
            }

    reason = candidates[0].get("finishReason", "")
    raise RuntimeError(
        f"이미지가 돌아오지 않았습니다{f' ({reason})' if reason else ''}. "
        "다른 사진으로 시도해보세요."
    )


# ─────────────────────────────────────────────────────────────
# 파일 저장
# ─────────────────────────────────────────────────────────────

_UNSAFE = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def safe_name(name: str, fallback: str = "무제") -> str:
    """파일명으로 쓸 수 없는 문자를 걷어낸다."""
    cleaned = _UNSAFE.sub("", name).strip().strip(".")
    cleaned = re.sub(r"\s+", " ", cleaned)
    return (cleaned or fallback)[:60]


def save_batch(items: list, folder_label: str = "") -> dict:
    """완성된 카드들을 '출력/날짜_시각/' 아래에 이미지+텍스트 쌍으로 저장."""
    stamp = datetime.now().strftime("%Y%m%d_%H%M")
    label = safe_name(folder_label, "") if folder_label else ""
    out = get_output_dir() / (f"{stamp}_{label}" if label else stamp)
    out.mkdir(parents=True, exist_ok=True)

    saved = []
    for i, item in enumerate(items, start=1):
        title = " ".join(item.get("title_lines") or []) or "무제"
        stem = f"{i:02d}_{safe_name(title)}"

        png = base64.b64decode(item["image_b64"])
        (out / f"{stem}.png").write_bytes(png)

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

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        # 요청마다 콘솔을 채우지 않는다. 오류는 따로 찍는다.
        pass

    # -- helpers ------------------------------------------------

    def _send(self, code: int, body: bytes, ctype: str, extra: dict = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send(code, body, "application/json; charset=utf-8")

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > MAX_BODY:
            raise ValueError("요청이 너무 큽니다.")
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    # -- routes -------------------------------------------------

    def do_GET(self):
        path = self.path.split("?", 1)[0]

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

        if path == "/api/open-output":
            out = get_output_dir()
            out.mkdir(parents=True, exist_ok=True)
            open_in_file_manager(out)
            return self._json(200, {"ok": True, "dir": str(out)})

        return self._serve_static(path)

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        try:
            payload = self._read_json()
        except (ValueError, json.JSONDecodeError) as exc:
            return self._json(400, {"error": str(exc)})

        try:
            if path == "/api/config":
                cfg = load_config()
                if "api_key" in payload:
                    key = (payload["api_key"] or "").strip()
                    if key:
                        cfg["api_key"] = key
                    else:
                        cfg.pop("api_key", None)
                if "gemini_key" in payload:
                    key = (payload["gemini_key"] or "").strip()
                    if key:
                        cfg["gemini_key"] = key
                    else:
                        cfg.pop("gemini_key", None)
                    _MODEL_CACHE.clear()
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
                )
                return self._json(200, data)

            if path == "/api/erase":
                result = transform_image(
                    image_b64=payload["image_b64"],
                    media_type=payload.get("media_type", "image/png"),
                    mode=payload.get("mode", "erase"),
                    story=payload.get("story", ""),
                )
                return self._json(200, result)

            if path == "/api/save":
                result = save_batch(payload.get("items", []),
                                    payload.get("label", ""))
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
            return self._json(500, {"error": str(exc)})

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

    port = find_port()
    url = f"http://127.0.0.1:{port}"
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)

    print(f"\n  후킹 공장이 열렸습니다.\n\n    {url}\n")
    print(f"  결과물 저장 위치: {get_output_dir()}")
    if not get_api_key():
        print("  ⚠ Anthropic 키가 없습니다. 화면 왼쪽 위 '설정'에서 넣어주세요.")
    print(f"  원본 글자 지우기: {'켜짐 (Gemini)' if get_gemini_key() else '꺼짐 — 글자를 덮습니다'}")
    print("\n  끄려면 이 창에서 Ctrl+C\n")

    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  종료합니다.\n")
        server.shutdown()


if __name__ == "__main__":
    main()
