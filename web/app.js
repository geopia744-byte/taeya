/* 후킹 공장 — 화면 로직
 *
 * 이미지 합성은 전부 여기(Canvas)에서 한다. 서버는 카피 생성과 파일 저장만 맡는다.
 * 그래야 글자 위치·크기를 바꿀 때마다 서버를 거치지 않고 즉시 다시 그릴 수 있다.
 */

const $ = (sel) => document.querySelector(sel);

const FONT_STACK =
  '"Pretendard", "Pretendard Variable", -apple-system, BlinkMacSystemFont, ' +
  '"Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", ' +
  '"Hiragino Sans", "Meiryo", sans-serif';

const LINE_HEIGHT = 1.22;   // 제목 줄간격 배수
const MAX_TITLE_LINES = 4;  // 이보다 많아지면 글자를 줄인다
const CONCURRENCY = 3;      // 동시에 돌릴 요청 수

/* ── 상태 ──────────────────────────────────────────────── */

const state = {
  cards: [],          // {id, file, img, crop, copy, status, error, el, canvas}
  logo: null,         // Image
  logoPos: 'center',
  logoSize: 22,       // 이미지 너비 대비 %
  textPos: 'auto',    // 원본 글자가 있던 자리
  textSize: 7,        // 이미지 높이 대비 %
  autoCrop: true,     // 인스타 UI 자동 잘라내기
  hasGemini: false,   // Gemini 키가 있는가
  photoMode: 'erase', // off | erase | recreate
  lastSaveDir: null,
  running: false,
};

let seq = 0;

/* ── 화면 설정 기억하기 ────────────────────────────────
 *
 * 껐다 켤 때마다 모드가 기본값으로 돌아가면, 골라둔 것이 조용히 풀려서
 * 엉뚱한 처리가 돌아간다. 실제로 '사진 새로 만들기'를 골라뒀는데 다시
 * 켠 뒤 '글자만 지우기'가 돌아간 일이 있었다.
 */

const REMEMBER = 'hooking-factory/settings';

const KEEP = ['photoMode', 'textPos', 'textSize', 'logoPos', 'logoSize', 'autoCrop'];

function loadSettings() {
  try {
    const raw = localStorage.getItem(REMEMBER);
    if (!raw) return {};
    const saved = JSON.parse(raw) || {};
    KEEP.forEach((k) => { if (k in saved) state[k] = saved[k]; });
    return saved;
  } catch {
    return {};   // 저장소를 못 쓰는 브라우저여도 동작은 해야 한다
  }
}

function saveSettings() {
  try {
    const out = {};
    KEEP.forEach((k) => { out[k] = state[k]; });
    out.lang = $('#lang').value;
    out.guide = $('#guide').value;
    out.styleSample = $('#style-sample').value;
    localStorage.setItem(REMEMBER, JSON.stringify(out));
  } catch { /* 못 저장해도 그냥 진행한다 */ }
}

/* ── 자잘한 도구 ───────────────────────────────────────── */

function toast(msg, bad = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), bad ? 4200 : 2200);
}

async function api(path, payload) {
  const res = await fetch(path, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: payload === undefined ? {} : { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청이 실패했습니다 (${res.status})`);
  return data;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
    img.src = src;
  });
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    fr.readAsDataURL(file);
  });
}

/* ── 인스타 UI 잘라내기 ────────────────────────────────────
 *
 * 캡쳐에는 하트·댓글 수·계정명·캡션이 같이 찍힌다. 사진 영역만 남긴다.
 * 배경(대개 흰색 또는 검정)으로 꽉 찬 가로줄을 UI로 보고, 그렇지 않은
 * 줄이 가장 길게 이어지는 구간을 사진으로 판단한다.
 */
function detectPhotoRegion(img) {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const FULL = { x: 0, y: 0, w: W, h: H };
  if (H < 80 || W < 80) return FULL;

  const sw = Math.min(W, 200);
  const sh = Math.min(H, 300);
  const cv = document.createElement('canvas');
  cv.width = sw;
  cv.height = sh;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  // 점 추출로 줄인다. 평균을 내면 흰 바탕의 글자가 뭉개져 회색 덩어리가 되고,
  // 그러면 캡션 칸을 사진으로 오해한다.
  cx.imageSmoothingEnabled = false;
  cx.drawImage(img, 0, 0, sw, sh);

  let px;
  try {
    px = cx.getImageData(0, 0, sw, sh).data;
  } catch {
    return FULL;  // 보안 제약 등으로 못 읽으면 원본 그대로 간다
  }

  // 인스타 UI 바탕은 순백 아니면 순검정이다. "모서리와 비슷한 색"으로 잡으면
  // 밝은 사진을 배경으로 오해해 사진을 잘라먹는다. 두 색만 배경으로 본다.
  const at = (x, y) => (y * sw + x) * 4;
  const isWhite = (i) => px[i] > 246 && px[i + 1] > 246 && px[i + 2] > 246;
  const isBlack = (i) => px[i] < 14 && px[i + 1] < 14 && px[i + 2] < 14;

  const corners = [at(0, 0), at(sw - 1, 0), at(0, sh - 1), at(sw - 1, sh - 1)];
  const whites = corners.filter(isWhite).length;
  const blacks = corners.filter(isBlack).length;
  let isBg;
  if (whites >= 2) isBg = isWhite;
  else if (blacks >= 2) isBg = isBlack;
  else return FULL;  // UI 바탕이 없는 캡쳐 — 통째로 쓴다

  // UI 는 언제나 가장자리에 붙어 있다. 가장자리부터 안쪽으로 깎는다.
  // (가운데의 가장 긴 구간을 고르는 방식은 사진 한복판을 잘라낼 위험이 있다)
  const trim = (n, isChrome) => {
    let a = 0;
    while (a < n && isChrome(a)) a++;
    let b = n;
    while (b > a && isChrome(b - 1)) b--;
    return [a, b];
  };

  // 세로 — 위아래 UI 띠. 배경으로 거의 꽉 차 있으므로 기준을 높게.
  const rowBgRatio = (y) => {
    let n = 0;
    for (let x = 0; x < sw; x++) if (isBg(at(x, y))) n++;
    return n / sw;
  };
  let [y0, y1] = trim(sh, (y) => rowBgRatio(y) > 0.94);
  if (y1 - y0 < sh * 0.4) { y0 = 0; y1 = sh; }

  // 가로 — 옆에 붙은 캡션 칸. 흰 바탕에 글자만 있어 배경 비율이 여전히 높다.
  const colBgRatio = (x) => {
    let n = 0;
    for (let y = y0; y < y1; y++) if (isBg(at(x, y))) n++;
    return n / (y1 - y0);
  };
  let [x0, x1] = trim(sw, (x) => colBgRatio(x) > 0.5);

  // 캡션 칸은 한쪽에만 붙지만, 사진 자체의 흰 여백은 양옆에 고르게 있다.
  // 양쪽이 비슷하게 잘렸다면 사진의 여백이므로 건드리지 않는다.
  const cutL = x0;
  const cutR = sw - x1;
  const even = cutL > 0 && cutR > 0
    && Math.min(cutL, cutR) / Math.max(cutL, cutR) > 0.4;
  if (even || x1 - x0 < sw * 0.4) { x0 = 0; x1 = sw; }

  const sx = W / sw;
  const sy = H / sh;
  return {
    x: Math.round(x0 * sx),
    y: Math.round(y0 * sy),
    w: Math.max(1, Math.round((x1 - x0) * sx)),
    h: Math.max(1, Math.round((y1 - y0) * sy)),
  };
}

/* ── 제목 배치 ─────────────────────────────────────────────
 *
 * 원본 툴은 "자유가 아니" / "었다" 처럼 단어를 쪼개 놓았다.
 * 여기서는 어절 단위로만 끊고, 넘치면 글자를 줄인다.
 */
function wrapByWords(ctx, lines, maxWidth) {
  const out = [];
  for (const raw of lines) {
    const words = String(raw).trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    let cur = words[0];
    for (let i = 1; i < words.length; i++) {
      const test = `${cur} ${words[i]}`;
      if (ctx.measureText(test).width <= maxWidth) {
        cur = test;
      } else {
        out.push(cur);
        cur = words[i];
      }
    }
    out.push(cur);
  }
  return out;
}

function fitTitle(ctx, lines, boxW, boxH, startSize) {
  const clean = lines.map((l) => String(l).trim()).filter(Boolean);
  if (!clean.length) return { size: startSize, wrapped: [] };

  const fits = (size, arr) => {
    ctx.font = `900 ${size}px ${FONT_STACK}`;
    return arr.every((l) => ctx.measureText(l).width <= boxW)
        && arr.length * size * LINE_HEIGHT <= boxH;
  };

  // 1단계 — AI가 준 줄 구성을 그대로 지키면서 글자만 줄여본다.
  // 의미 단위로 끊어 온 것이라, 줄을 늘려 어절 하나만 떨어뜨리는 것보다
  // 조금 작게 쓰는 편이 훨씬 낫다.
  let size = startSize;
  const floor = startSize * 0.62;
  while (size >= floor) {
    if (fits(size, clean)) return { size, wrapped: clean };
    size *= 0.97;
  }

  // 2단계 — 그래도 안 들어가면 어절 단위로 다시 나눈다. 단어는 쪼개지 않는다.
  size = startSize;
  for (let step = 0; step < 40; step++) {
    ctx.font = `900 ${size}px ${FONT_STACK}`;
    const wrapped = wrapByWords(ctx, clean, boxW);
    if (wrapped.length <= MAX_TITLE_LINES && fits(size, wrapped)) {
      return { size, wrapped };
    }
    size *= 0.93;
    if (size < 8) break;
  }

  ctx.font = `900 ${size}px ${FONT_STACK}`;
  return { size, wrapped: wrapByWords(ctx, clean, boxW) };
}

/* ── 카드 한 장 그리기 ─────────────────────────────── */

// AI 가 알려준 원본 글자 영역(전체 이미지 기준 0~1)을 잘라낸 화면 기준으로 옮긴다.
function coverRegion(card) {
  const a = card.copy?.text_area;
  if (!a || !(a.bottom > a.top)) return null;
  const H = card.img.naturalHeight;
  const top = (a.top * H - card.crop.y) / card.crop.h;
  const bottom = (a.bottom * H - card.crop.y) / card.crop.h;
  const t = Math.max(0, Math.min(1, top));
  const b = Math.max(0, Math.min(1, bottom));
  return b - t < 0.02 ? null : { top: t, bottom: b };
}

// 원본 영어를 완전히 가린다.
// 반투명으로 덮으면 흰 글자가 비쳐 결과물을 망치므로 완전 불투명으로 칠한다.
// 새까만 띠는 붙여넣은 티가 나므로, 덮을 자리의 평균색을 뽑아 아주 어둡게
// 만든 색을 쓴다. 따뜻한 사진은 따뜻하게, 차가운 사진은 차갑게 가라앉는다.
function drawCover(ctx, w, h, top, bottom) {
  const y0 = Math.max(0, top);
  const y1 = Math.min(h, bottom);
  if (y1 <= y0) return;

  let r = 11, g = 12, b = 15;
  try {
    const band = ctx.getImageData(0, y0, w, Math.max(1, Math.round(y1 - y0))).data;
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let i = 0; i < band.length; i += 4 * 37) {   // 듬성듬성 훑는다
      sr += band[i]; sg += band[i + 1]; sb += band[i + 2]; n++;
    }
    if (n) {
      const dim = 0.17;
      r = Math.round((sr / n) * dim);
      g = Math.round((sg / n) * dim);
      b = Math.round((sb / n) * dim);
    }
  } catch { /* 못 읽으면 기본 어두운 색을 쓴다 */ }

  const ink = `${r},${g},${b}`;
  const feather = Math.min((y1 - y0) * 0.34, h * 0.07);

  ctx.fillStyle = `rgb(${ink})`;
  ctx.fillRect(0, y0, w, y1 - y0);

  if (y0 > 0) {
    const t = Math.max(0, y0 - feather);
    const grad = ctx.createLinearGradient(0, t, 0, y0);
    grad.addColorStop(0, `rgba(${ink},0)`);
    grad.addColorStop(1, `rgba(${ink},1)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, t, w, y0 - t);
  }
  if (y1 < h) {
    const bt = Math.min(h, y1 + feather);
    const grad = ctx.createLinearGradient(0, y1, 0, bt);
    grad.addColorStop(0, `rgba(${ink},1)`);
    grad.addColorStop(1, `rgba(${ink},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, y1, w, bt - y1);
  }
}

// 사진 처리가 아직 남았으면 제목을 얹지 않는다.
// 지워지기 전 사진에 한국어를 박아두면 지워졌는지 아닌지 알 수가 없다.
function photoPending(card) {
  return state.hasGemini
      && state.photoMode !== 'off'
      && !card.cleanImg
      && !card.photoDone;
}

function render(card) {
  const canvas = card.canvas;
  // 글자를 지운 사진이 있으면 그걸 쓴다. 이미 깨끗하므로 잘라낼 것도 덮을 것도 없다.
  const clean = card.cleanImg;
  const img = clean || card.img;
  if (!img || !canvas) return;
  const crop = clean
    ? { x: 0, y: 0, w: clean.naturalWidth, h: clean.naturalHeight }
    : card.crop;

  const w = crop.w;
  const h = crop.h;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);

  const pad = w * 0.055;
  const boxW = w - pad * 2;
  const lines = photoPending(card)
    ? []
    : (card.copy?.title_lines?.filter(Boolean) || []);
  const region = clean ? null : coverRegion(card);

  if (!lines.length) {
    if (region) drawCover(ctx, w, h, region.top * h, region.bottom * h);
    if (state.logo) drawLogo(ctx, w);
    return;
  }

  // 글자를 먼저 배치해 봐야 덮개를 얼마나 크게 칠지 정할 수 있다.
  const base = h * (state.textSize / 100);
  const { size, wrapped } = fitTitle(ctx, lines, boxW, h * 0.44, base);
  const lineH = size * LINE_HEIGHT;
  const blockH = wrapped.length * lineH;

  // 글자 위치. '자동'이면 원본 영어가 있던 자리에 그대로 앉힌다.
  let blockTop;
  if (state.textPos === 'top') blockTop = pad;
  else if (state.textPos === 'middle') blockTop = (h - blockH) / 2;
  else if (state.textPos === 'bottom') blockTop = h - pad - blockH;
  else blockTop = region
    ? ((region.top + region.bottom) / 2) * h - blockH / 2
    : h - pad - blockH;
  blockTop = Math.max(pad * 0.4, Math.min(h - blockH - pad * 0.4, blockTop));

  // 덮개는 원본 글자 영역과 한국어 글자 영역을 모두 감싸야 한다.
  // 둘 중 하나만 덮으면 영어가 삐져나오거나 한국어가 사진에 묻힌다.
  const margin = size * 0.55;
  let y0 = blockTop - margin;
  let y1 = blockTop + blockH + margin;
  if (region) {
    y0 = Math.min(y0, region.top * h);
    y1 = Math.max(y1, region.bottom * h);
  }
  // 글자를 지운 사진에는 넓은 덮개가 필요 없다. 한국어가 읽히게만 살짝 깐다.
  if (clean) drawScrim(ctx, w, h, y0, y1 - y0);
  else drawCover(ctx, w, h, Math.max(0, y0), Math.min(h, y1));

  ctx.font = `900 ${size}px ${FONT_STACK}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,.55)';
  ctx.shadowBlur = size * 0.28;
  ctx.fillStyle = '#fff';
  const first = blockTop + size * 0.82;
  wrapped.forEach((line, k) => ctx.fillText(line, pad, first + k * lineH));
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  if (state.logo) drawLogo(ctx, w);
}

// 지운 사진 위에 쓸 가벼운 그림자. 사진을 가리지 않으면서 글자만 읽히게 한다.
function drawScrim(ctx, w, h, top, height) {
  const y0 = Math.max(0, top);
  const y1 = Math.min(h, top + height);
  if (y1 <= y0) return;
  const fade = Math.min(height * 0.6, h * 0.18);
  const g = ctx.createLinearGradient(0, y0 - fade, 0, y1 + fade * 0.5);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.3, 'rgba(0,0,0,.40)');
  g.addColorStop(0.72, 'rgba(0,0,0,.58)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, Math.max(0, y0 - fade), w, (y1 - y0) + fade * 1.5);
}

function drawLogo(ctx, w) {
  const lw = w * (state.logoSize / 100);
  const lh = lw * (state.logo.naturalHeight / state.logo.naturalWidth);
  const margin = w * 0.04;
  const x = state.logoPos === 'left' ? margin
          : state.logoPos === 'right' ? w - margin - lw
          : (w - lw) / 2;
  ctx.drawImage(state.logo, x, margin, lw, lh);
}

function renderAll() {
  state.cards.forEach(render);
}

// 자동 잘라내기 스위치를 반영한다.
function cropFor(img) {
  return state.autoCrop
    ? detectPhotoRegion(img)
    : { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
}

/* ── 카드 만들기 ───────────────────────────────────────── */

async function addFiles(fileList) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;

  for (const file of files) {
    const card = {
      id: ++seq,
      file,
      img: null,
      crop: null,
      copy: null,
      status: 'idle',
      error: null,
    };
    state.cards.push(card);
    mountCard(card);

    try {
      const url = await readAsDataURL(file);
      card.dataUrl = url;
      card.img = await loadImage(url);
      card.crop = cropFor(card.img);
      render(card);
      setStatus(card, 'idle');
    } catch (err) {
      setError(card, err.message);
    }
  }
  syncUI();
}

function mountCard(card) {
  const node = $('#card-tpl').content.firstElementChild.cloneNode(true);
  card.el = node;
  card.canvas = node.querySelector('canvas');

  node.addEventListener('click', (ev) => {
    const act = ev.target.dataset?.act;
    if (!act) return;
    if (act === 'remove') removeCard(card);
    if (act === 'copy') copyBody(card);
    if (act === 'regen') { card.cleanImg = null; card.madeBy = null; card.photoDone = false; runOne(card); }
    if (act === 'download') downloadOne(card);
  });

  node.querySelector('[data-role="body"]').addEventListener('input', (ev) => {
    if (card.copy) card.copy.body = ev.target.value;
  });

  $('#cards').appendChild(node);
}

function removeCard(card) {
  card.el?.remove();
  state.cards = state.cards.filter((c) => c !== card);
  syncUI();
}

function setStatus(card, status, label) {
  card.status = status;
  const overlay = card.el.querySelector('[data-role="overlay"]');
  const text = card.el.querySelector('[data-role="status"]');

  // 아직 변환 전이거나 이미 끝났으면 사진을 가리지 않는다.
  // 덮개는 실제로 기다리는 동안에만 띄운다.
  if (status === 'done' || (status === 'idle' && !label)) {
    overlay.hidden = true;
    return;
  }
  overlay.hidden = false;
  overlay.classList.toggle('done', status === 'idle');
  text.textContent = label || (status === 'working' ? '읽는 중' : '차례 기다리는 중');
}

function setError(card, message) {
  card.status = 'error';
  card.error = message;
  const err = card.el.querySelector('[data-role="err"]');
  err.textContent = message;
  err.hidden = false;
  setStatus(card, 'idle', '실패');
}

function clearError(card) {
  card.error = null;
  const err = card.el.querySelector('[data-role="err"]');
  err.hidden = true;
}

function fillCard(card) {
  const { copy } = card;
  if (!copy) return;
  card.el.querySelector('[data-role="body"]').value = copy.body || '';
  card.el.querySelector('[data-role="tags"]').textContent =
    (copy.hashtags || []).join(' ');

  // 사진을 실제로 손봤는지 표시한다. 덮은 것과 지운 것은 결과물이 다르다.
  const badge = card.el.querySelector('[data-role="badge"]');
  if (card.cleanImg) {
    badge.hidden = false;
    badge.className = 'badge clean';
    badge.textContent = card.madeBy === 'recreate' ? '✨ 새로 만든 사진' : '✂ 영어 지움';
  } else if (state.hasGemini && state.photoMode !== 'off') {
    badge.hidden = false;
    badge.className = 'badge';
    badge.textContent = '덮어서 가림';
  } else {
    badge.hidden = true;
  }

  render(card);
  setStatus(card, 'done');
}

/* ── 실행 ──────────────────────────────────────────────── */

// 잘라낸 사진만 뽑아낸다. 인스타 UI 는 이미 빠진 상태라 Gemini 가 사진만 본다.
function croppedBase64(card) {
  const c = document.createElement('canvas');
  c.width = card.crop.w;
  c.height = card.crop.h;
  c.getContext('2d').drawImage(
    card.img, card.crop.x, card.crop.y, card.crop.w, card.crop.h,
    0, 0, card.crop.w, card.crop.h,
  );
  return c.toDataURL('image/png').split(',')[1];
}

function canvasBase64(card) {
  return card.canvas.toDataURL('image/png').split(',')[1];
}

// 카피 쓰기. 원본 캡쳐 전체를 보고 쓴다 — 아래 캡션 글까지 읽어야 사건이 정확해진다.
async function writeCopy(card) {
  const [, meta, b64] = card.dataUrl.match(/^data:([^;]+);base64,(.*)$/) || [];
  card.copy = await api('/api/generate', {
    image_b64: b64,
    media_type: meta || 'image/png',
    lang: $('#lang').value,
    guide: $('#guide').value,
    style_sample: $('#style-sample').value,
  });
}

// 사진 처리. 실패해도 카피는 살아 있으므로 덮는 방식으로 이어간다.
async function transformOne(card) {
  const mode = state.photoMode;
  if (!state.hasGemini || mode === 'off' || card.cleanImg) {
    if (!card.photoDone) {
      card.photoDone = true;
      fillCard(card);
    }
    return;
  }

  const recreate = mode === 'recreate';
  setStatus(card, 'working', recreate ? '사진 만드는 중' : '글자 지우는 중');
  try {
    const out = await api('/api/erase', {
      image_b64: croppedBase64(card),
      media_type: 'image/png',
      mode,
      // 새로 만들 때는 무슨 사건인지 알려줘야 장면이 이야기에 맞는다.
      story: recreate ? storyOf(card) : '',
    });
    card.cleanImg = await loadImage(`data:${out.media_type};base64,${out.image_b64}`);
    card.madeBy = mode;
    clearError(card);
  } catch (err) {
    setError(card,
      `${recreate ? '사진 만들기' : '글자 지우기'} 실패 — 덮어서 처리했습니다. (${err.message})`);
  }
  card.photoDone = true;   // 이제 제목을 얹어도 된다
  fillCard(card);
}

// 사진을 새로 만들 때 넘길 장면 묘사.
// Claude 가 설계한 scene 을 쓴다. 없으면 사건 설명으로라도 방향을 준다.
function storyOf(card) {
  const c = card.copy || {};
  if (c.scene && c.scene.trim()) return c.scene.trim();
  return [c.source_text, (c.title_lines || []).join(' ')]
    .filter(Boolean).join('\n');
}

async function runOne(card) {
  if (!card.img) return;
  clearError(card);
  card.photoDone = false;
  setStatus(card, 'working', '읽는 중');
  try {
    await writeCopy(card);
  } catch (err) {
    return setError(card, err.message);
  }
  fillCard(card);
  await transformOne(card);
}

async function runAll() {
  const queue = state.cards.filter((c) => c.img && c.status !== 'working');
  if (!queue.length) return;

  state.running = true;
  syncUI();
  queue.forEach((c) => { clearError(c); c.photoDone = false; setStatus(c, 'queued'); });

  // 1단계 — 카피. 글은 여러 장을 동시에 맡겨도 잘 받아준다.
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (cursor < queue.length) {
        const card = queue[cursor++];
        setStatus(card, 'working', '읽는 중');
        try {
          await writeCopy(card);
          fillCard(card);
          if (photoPending(card)) setStatus(card, 'queued', '사진 차례 기다리는 중');
        } catch (err) {
          setError(card, err.message);
        }
      }
    }),
  );

  // 2단계 — 글자 지우기. 이미지 생성은 분당 허용 횟수가 적어서
  // 동시에 던지면 전부 한도에 걸린다. 한 장씩 차례로 보낸다.
  for (const card of queue) {
    if (card.copy) await transformOne(card);   // 건너뛸 때도 상태를 정리한다
  }

  state.running = false;
  syncUI();

  const failed = state.cards.filter((c) => c.status === 'error').length;
  toast(
    failed ? `${queue.length - failed}장 완료, ${failed}장은 덮어서 처리` : '전부 완료됐습니다',
    failed > 0,
  );
}

/* ── 내보내기 ──────────────────────────────────────────── */

function doneCards() {
  return state.cards.filter((c) => c.copy && c.status === 'done');
}

function downloadOne(card) {
  if (!card.copy) return toast('먼저 변환해주세요', true);
  const name = (card.copy.title_lines || []).join(' ').replace(/[\\/:*?"<>|]/g, '');
  const a = document.createElement('a');
  a.href = card.canvas.toDataURL('image/png');
  a.download = `${name || '무제'}.png`;
  a.click();
}

async function copyBody(card) {
  if (!card.copy) return toast('먼저 변환해주세요', true);
  const text = [card.copy.body, (card.copy.hashtags || []).join(' ')]
    .filter(Boolean).join('\n\n');
  try {
    await navigator.clipboard.writeText(text);
    toast('본문을 복사했습니다');
  } catch {
    toast('복사에 실패했습니다', true);
  }
}

async function saveToPC() {
  const items = doneCards();
  if (!items.length) return toast('저장할 게 없습니다', true);
  try {
    const res = await api('/api/save', {
      label: $('#lang').value,
      items: items.map((c) => ({
        image_b64: canvasBase64(c),
        title_lines: c.copy.title_lines,
        body: c.copy.body,
        hashtags: c.copy.hashtags,
      })),
    });
    state.lastSaveDir = res.dir;
    $('#save-note').textContent = `${res.count}장 저장 → ${res.dir}`;
    toast(`${res.count}장을 PC에 저장했습니다`);
  } catch (err) {
    toast(err.message, true);
  }
}

async function downloadZip() {
  if (!state.lastSaveDir) {
    await saveToPC();
    if (!state.lastSaveDir) return;
  }
  const res = await fetch('/api/zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dir: state.lastSaveDir }),
  });
  if (!res.ok) return toast('ZIP을 만들지 못했습니다', true);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '후킹공장.zip';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ── UI 동기화 ─────────────────────────────────────────── */

const MODE_HINT = {
  off: '사진을 건드리지 않습니다. 영어는 덮어서 가립니다. 비용이 들지 않습니다.',
  erase: '사진에 박힌 영어를 지우고 그 자리를 주변에 맞게 채웁니다.',
  recreate: '인물·동물의 생김새는 그대로 두고 장면을 새로 만듭니다. '
          + '원본 사진을 쓰지 않으므로 글자도 남지 않습니다.',
};

const MODE_LABEL = {
  off: '사진 그대로',
  erase: '글자만 지우기',
  recreate: '사진 새로 만들기',
};

function syncUI() {
  const has = state.cards.length > 0;
  $('#empty').hidden = has;
  $('#run').disabled = !has || state.running;

  // 무엇이 돌아갈지 버튼에 적는다. 고른 것과 도는 것이 어긋나면 안 된다.
  const what = state.hasGemini ? MODE_LABEL[state.photoMode] : null;
  $('#run').textContent = state.running
    ? '변환 중…'
    : (what ? `이미지 변환 — ${what}` : '이미지 변환');

  $('#export-group').hidden = doneCards().length === 0;
}

// 기억해둔 설정을 화면에 되살린다.
function applySettings(saved) {
  const mark = (id, value) => {
    const box = $(id);
    if (!box) return;
    box.querySelectorAll('button[data-v]').forEach((b) =>
      b.classList.toggle('on', b.dataset.v === value));
  };
  mark('#photo-mode', state.photoMode);
  mark('#text-pos', state.textPos);
  mark('#logo-pos', state.logoPos);

  $('#text-size').value = state.textSize;
  $('#text-size-out').textContent = `${state.textSize}%`;
  $('#logo-size').value = state.logoSize;
  $('#logo-size-out').textContent = `${state.logoSize}%`;
  $('#auto-crop').checked = state.autoCrop;
  $('#mode-hint').textContent = MODE_HINT[state.photoMode] || '';

  if (saved.lang) $('#lang').value = saved.lang;
  if (saved.guide) $('#guide').value = saved.guide;
  if (saved.styleSample) $('#style-sample').value = saved.styleSample;
}

function bindSegment(id, onPick) {
  $(id).addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-v]');
    if (!btn) return;
    $(id).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
    onPick(btn.dataset.v);
  });
}

/* ── 시작 ──────────────────────────────────────────────── */

function init() {
  // 파일 넣기
  $('#pick-files').addEventListener('change', (e) => {
    addFiles(e.target.files); e.target.value = '';
  });
  $('#pick-folder').addEventListener('change', (e) => {
    addFiles(e.target.files); e.target.value = '';
  });
  $('#clear-all').addEventListener('click', () => {
    state.cards.forEach((c) => c.el?.remove());
    state.cards = [];
    state.lastSaveDir = null;
    syncUI();
  });

  // 끌어다 놓기
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    if (++dragDepth === 1) $('#drop-veil').hidden = false;
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) { dragDepth = 0; $('#drop-veil').hidden = true; }
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('#drop-veil').hidden = true;
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  });

  // 로고
  $('#logo-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    state.logo = await loadImage(await readAsDataURL(file));
    $('#logo-label').textContent = file.name;
    $('#logo-opts').hidden = false;
    renderAll();
  });
  $('#logo-clear').addEventListener('click', () => {
    state.logo = null;
    $('#logo-file').value = '';
    $('#logo-label').textContent = '로고 이미지 업로드';
    $('#logo-opts').hidden = true;
    renderAll();
  });
  bindSegment('#logo-pos', (v) => { state.logoPos = v; saveSettings(); renderAll(); });
  $('#logo-size').addEventListener('input', (e) => {
    state.logoSize = +e.target.value;
    $('#logo-size-out').textContent = `${e.target.value}%`;
    saveSettings();
    renderAll();
  });

  $('#auto-crop').addEventListener('change', (e) => {
    state.autoCrop = e.target.checked;
    saveSettings();
    state.cards.forEach((card) => {
      if (card.img) card.crop = cropFor(card.img);
    });
    renderAll();
  });

  // 글자
  bindSegment('#text-pos', (v) => { state.textPos = v; saveSettings(); renderAll(); });
  $('#text-size').addEventListener('input', (e) => {
    state.textSize = +e.target.value;
    $('#text-size-out').textContent = `${e.target.value}%`;
    saveSettings();
    renderAll();
  });

  // 실행 · 내보내기
  $('#run').addEventListener('click', runAll);
  $('#save-pc').addEventListener('click', saveToPC);
  $('#download-zip').addEventListener('click', downloadZip);

  // 설정
  const dlg = $('#settings');
  $('#btn-settings').addEventListener('click', async () => {
    const cfg = await api('/api/config');
    $('#out-dir').value = cfg.output_dir || '';
    $('#key-state').textContent = cfg.has_key
      ? (cfg.key_from_env ? '환경변수에서 읽고 있습니다' : '저장된 키가 있습니다')
      : '아직 없습니다. 넣어야 동작합니다.';
    $('#gemini-state').textContent = cfg.has_gemini
      ? '저장된 키가 있습니다. 원본 영어를 지웁니다.'
      : '없어도 됩니다. 없으면 영어를 덮기만 합니다.';
    await fillModels(cfg.has_gemini);
    dlg.showModal();
  });
  $('#save-settings').addEventListener('click', async () => {
    try {
      await api('/api/config', {
        api_key: $('#api-key').value,
        gemini_key: $('#gemini-key').value,
        gemini_model: $('#gemini-model').value,
        output_dir: $('#out-dir').value,
      });
      $('#api-key').value = '';
      $('#gemini-key').value = '';
      await loadConfig();
      toast('저장했습니다');
      dlg.close();
    } catch (err) {
      toast(err.message, true);
    }
  });

  bindSegment('#photo-mode', (v) => {
    state.photoMode = v;
    $('#mode-hint').textContent = MODE_HINT[v] || '';
    saveSettings();
    syncUI();
  });
  ['#lang', '#guide', '#style-sample'].forEach((sel) =>
    $(sel).addEventListener('change', saveSettings));
  $('#open-output').addEventListener('click', () => api('/api/open-output'));

  applySettings(loadSettings());
  loadConfig();
  syncUI();
}

// 쓸 수 있는 사진 모델을 불러와 고를 수 있게 한다.
async function fillModels(hasGemini) {
  const field = $('#model-field');
  const sel = $('#gemini-model');
  field.hidden = !hasGemini;
  if (!hasGemini) return;

  sel.innerHTML = '<option value="">불러오는 중…</option>';
  try {
    const { models = [], chosen = '', error } = await api('/api/models');
    if (error || !models.length) {
      sel.innerHTML = `<option value="">${error || '모델을 찾지 못했습니다'}</option>`;
      return;
    }
    sel.innerHTML = ['<option value="">자동 (가장 좋은 것)</option>']
      .concat(models.map((m) => `<option value="${m}">${m}</option>`))
      .join('');
    sel.value = chosen || '';
  } catch (err) {
    sel.innerHTML = `<option value="">${err.message}</option>`;
  }
}

// 서버 설정을 읽어 Gemini 관련 화면을 켜고 끈다.
async function loadConfig() {
  try {
    const cfg = await api('/api/config');
    state.hasGemini = !!cfg.has_gemini;
  } catch {
    state.hasGemini = false;
  }
  $('#erase-group').hidden = !state.hasGemini;
}

init();
