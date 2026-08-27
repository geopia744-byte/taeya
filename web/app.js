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
  textPos: 'bottom',
  textSize: 7,        // 이미지 높이 대비 %
  autoCrop: true,     // 인스타 UI 자동 잘라내기
  lastSaveDir: null,
  running: false,
};

let seq = 0;

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

/* ── 카드 한 장 그리기 ─────────────────────────────────── */

function render(card) {
  const { img, crop, canvas } = card;
  if (!img || !canvas) return;

  const w = crop.w;
  const h = crop.h;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);

  const pad = w * 0.055;
  const boxW = w - pad * 2;

  // 제목
  const lines = card.copy?.title_lines?.filter(Boolean) || [];
  if (lines.length) {
    const base = h * (state.textSize / 100);
    const { size, wrapped } = fitTitle(ctx, lines, boxW, h * 0.44, base);
    const lineH = size * LINE_HEIGHT;
    const blockH = wrapped.length * lineH;

    let top;
    if (state.textPos === 'top') top = pad + size * 0.9;
    else if (state.textPos === 'middle') top = (h - blockH) / 2 + size * 0.82;
    else top = h - pad - blockH + size * 0.82;

    // 글자가 앉을 자리에만 어둠을 깔아 어떤 사진에서도 읽히게 한다.
    drawScrim(ctx, w, h, top - size, blockH + size * 1.5);

    ctx.font = `900 ${size}px ${FONT_STACK}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,.62)';
    ctx.shadowBlur = size * 0.3;
    ctx.shadowOffsetY = size * 0.05;
    ctx.fillStyle = '#fff';
    wrapped.forEach((line, i) => ctx.fillText(line, pad, top + i * lineH));
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  // 로고
  if (state.logo) {
    const lw = w * (state.logoSize / 100);
    const lh = lw * (state.logo.naturalHeight / state.logo.naturalWidth);
    const margin = w * 0.04;
    const x = state.logoPos === 'left' ? margin
            : state.logoPos === 'right' ? w - margin - lw
            : (w - lw) / 2;
    ctx.drawImage(state.logo, x, margin, lw, lh);
  }
}

function drawScrim(ctx, w, h, top, height) {
  const y0 = Math.max(0, top);
  const y1 = Math.min(h, top + height);
  if (y1 <= y0) return;
  // 위아래로 부드럽게 사라지는 띠. 사각형 자국이 남지 않게 한다.
  const fade = Math.min(height * 0.55, h * 0.2);
  const g = ctx.createLinearGradient(0, y0 - fade, 0, y1 + fade * 0.4);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.32, 'rgba(0,0,0,.42)');
  g.addColorStop(0.72, 'rgba(0,0,0,.62)');
  g.addColorStop(1, 'rgba(0,0,0,.15)');
  ctx.fillStyle = g;
  ctx.fillRect(0, Math.max(0, y0 - fade), w, (y1 - y0) + fade * 1.4);
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
    if (act === 'regen') runOne(card);
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
  card.el.querySelector('[data-role="body"]').value = copy.body || '';
  card.el.querySelector('[data-role="tags"]').textContent =
    (copy.hashtags || []).join(' ');
  render(card);
  setStatus(card, 'done');
}

/* ── 실행 ──────────────────────────────────────────────── */

function canvasBase64(card) {
  return card.canvas.toDataURL('image/png').split(',')[1];
}

async function runOne(card) {
  if (!card.img) return;
  clearError(card);
  setStatus(card, 'working', '읽는 중');

  try {
    const [, meta, b64] = card.dataUrl.match(/^data:([^;]+);base64,(.*)$/) || [];
    const copy = await api('/api/generate', {
      image_b64: b64,
      media_type: meta || 'image/png',
      lang: $('#lang').value,
      guide: $('#guide').value,
      style_sample: $('#style-sample').value,
    });
    card.copy = copy;
    fillCard(card);
  } catch (err) {
    setError(card, err.message);
  }
}

async function runAll() {
  const queue = state.cards.filter((c) => c.img && c.status !== 'working');
  if (!queue.length) return;

  state.running = true;
  syncUI();
  queue.forEach((c) => setStatus(c, 'queued'));

  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) },
    async () => {
      while (cursor < queue.length) {
        await runOne(queue[cursor++]);
      }
    });
  await Promise.all(workers);

  state.running = false;
  syncUI();

  const failed = state.cards.filter((c) => c.status === 'error').length;
  toast(failed ? `${queue.length - failed}장 완료, ${failed}장 실패` : '전부 완료됐습니다',
        failed > 0);
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

function syncUI() {
  const has = state.cards.length > 0;
  $('#empty').hidden = has;
  $('#run').disabled = !has || state.running;
  $('#run').textContent = state.running ? '변환 중…' : '이미지 변환';
  $('#export-group').hidden = doneCards().length === 0;
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
  bindSegment('#logo-pos', (v) => { state.logoPos = v; renderAll(); });
  $('#logo-size').addEventListener('input', (e) => {
    state.logoSize = +e.target.value;
    $('#logo-size-out').textContent = `${e.target.value}%`;
    renderAll();
  });

  $('#auto-crop').addEventListener('change', (e) => {
    state.autoCrop = e.target.checked;
    state.cards.forEach((card) => {
      if (card.img) card.crop = cropFor(card.img);
    });
    renderAll();
  });

  // 글자
  bindSegment('#text-pos', (v) => { state.textPos = v; renderAll(); });
  $('#text-size').addEventListener('input', (e) => {
    state.textSize = +e.target.value;
    $('#text-size-out').textContent = `${e.target.value}%`;
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
    dlg.showModal();
  });
  $('#save-settings').addEventListener('click', async () => {
    try {
      await api('/api/config', {
        api_key: $('#api-key').value,
        output_dir: $('#out-dir').value,
      });
      $('#api-key').value = '';
      toast('저장했습니다');
      dlg.close();
    } catch (err) {
      toast(err.message, true);
    }
  });
  $('#open-output').addEventListener('click', () => api('/api/open-output'));

  syncUI();
}

init();
