/* 이미지 AI 자동화 — 화면 로직
 *
 * 이미지 합성은 전부 여기(Canvas)에서 한다. 서버는 카피 생성과 파일 저장만 맡는다.
 * 그래야 글자 위치·크기를 바꿀 때마다 서버를 거치지 않고 즉시 다시 그릴 수 있다.
 */

const $ = (sel) => document.querySelector(sel);

const FONT_STACK =
  '"Pretendard", "Pretendard Variable", -apple-system, BlinkMacSystemFont, ' +
  '"Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", ' +
  '"Hiragino Sans", "Meiryo", sans-serif';

const LINE_HEIGHT = 1.22;   // 제목 줄간격 배수 (기본값)

// 사용자가 조절한 줄 간격까지 반영한 실제 배수.
// 사진 위 줄 간격이 고정이라 두 줄이 늘 붙어 나왔다.
function lineMul(card) {
  const raw = card && card.style && card.style.lineGap !== undefined
    ? card.style.lineGap : state.lineGap;
  const g = Number(raw);
  return LINE_HEIGHT * ((Number.isFinite(g) ? g : 100) / 100);
}
const MAX_TITLE_LINES = 4;  // 이보다 많아지면 글자를 줄인다
const CONCURRENCY = 3;      // 동시에 돌릴 요청 수

/* ── 상태 ──────────────────────────────────────────────── */

const state = {
  cards: [],          // {id, file, img, crop, copy, status, error, el, canvas}
  archivedCards: [],  // 사용자가 직접 "완성 목록으로 보내기"를 눌러 옮긴 카드들
  logo: null,         // Image
  logoMode: 'image',  // image | text — 글자 로고는 채널명을 얇게 박는 용도
  logoText: '',
  logoFont: '',
  logoColor: '#ffffff',
  logoAlpha: 35,      // 글자 로고 진하기 %
  logoPos: 'center',
  logoSize: 22,       // 이미지 너비 대비 %
  lineGap: 100,       // 글자 줄 간격 % (100이 기본)
  textPos: 'auto',    // 원본 글자가 있던 자리
  textSize: 7,        // 이미지 높이 대비 %
  autoCrop: true,     // 인스타 UI 자동 잘라내기
  hasGemini: false,   // Gemini 키가 있는가
  photoMode: 'erase', // off | erase | recreate
  category: 'person', // 고른 카테고리 (인물정보가 기본)
  lastSaveDir: null,
  running: false,
  viewFavorites: false,

  // 글자 꾸미기. 제목과 본문을 따로 둔다. 둘은 역할이 달라서
  // 크기·색·굵기가 같으면 구분이 안 된다.
  headSize: 10,        // 이미지 높이 대비 %
  headColor: '#FFD24A',
  headFont: '',        // 빈 값이면 기본 글꼴
  headWeight: 900,
  bodyColor: '#FFFFFF',
  bodyFont: '',
  bodyWeight: 900,

  saveSize: 'orig',    // orig | ig(4:5) | th(1:1) | tt(9:16) | custom
  customW: 1000,       // '직접 지정'일 때 쓸 크기
  customH: 1000,
  strokeColor: 'none', // 글자 테두리 색 ('none' 이면 안 두름)
  strokeSize: 3,       // 테두리 두께 1~8
  // 저장할 때마다 제미니를 한 번 더 부른다(돈이 나가고, 한도에 걸리면
  // 저장이 1~2분씩 멈춘다). 저장은 즉시 끝나야 하는 동작이라 기본은 끔.
  aiExpand: false,
};

// 저장 크기. 인스타 피드는 4:5, 스레드는 정사각형, 틱톡 사진은 9:16 이 기본이다.
const SAVE_SIZES = {
  ig: { w: 1080, h: 1350 },
  th: { w: 1080, h: 1080 },
  tt: { w: 1080, h: 1920 },
};

// 지금 고른 저장 크기. '직접 지정'이면 사용자가 넣은 값을 쓴다.
// 크기를 보는 곳이 여럿이라 한 군데로 모았다 - 따로따로 SAVE_SIZES 를
// 뒤지면 '직접 지정'을 빠뜨리는 곳이 생긴다.
function sizeSpec(key = state.saveSize) {
  if (key === 'custom') {
    const clamp = (v, d) => {
      const n = Math.round(Number(v));
      return Number.isFinite(n) ? Math.min(5000, Math.max(100, n)) : d;
    };
    return { w: clamp(state.customW, 1000), h: clamp(state.customH, 1000) };
  }
  return SAVE_SIZES[key] || null;
}

let seq = 0;

/* ── 화면 설정 기억하기 ────────────────────────────────
 *
 * 껐다 켤 때마다 모드가 기본값으로 돌아가면, 골라둔 것이 조용히 풀려서
 * 엉뚱한 처리가 돌아간다. 실제로 '사진 새로 만들기'를 골라뒀는데 다시
 * 켠 뒤 '글자만 지우기'가 돌아간 일이 있었다.
 */

/* ── 카테고리 ──────────────────────────────────────────
 *
 * 고른 항목 하나가 세 가지 일을 한다.
 *   1) 새로 넣는 이미지가 이 항목에 담긴다
 *   2) '이미지 변환'은 이 항목의 카드만 처리한다
 *   3) 무대에는 이 항목의 카드만 보인다
 *
 * 위쪽 줄과 사이드바 줄은 같은 값을 본다. 둘을 따로 두면 어느 쪽이
 * 진짜인지 알 수 없게 된다.
 */

/* ── 문체 견본 ─────────────────────────────────────────
 *
 * 문체는 말로 설명하기 어렵고 예시로 보여주는 게 빠르다. 자주 쓰는 여섯
 * 가지를 미리 넣어두고, 고쳐 쓴 것은 이름을 붙여 남길 수 있게 한다.
 */

const STYLE_PRESETS = [
  {
    name: '담백 뉴스',
    text: '[제목] 3년 만에 밝혀졌다\n' +
          '[본문] 어제 공개된 내용입니다.\n' +
          '결과부터 말씀드리면, 예상과 달랐습니다.',
  },
  {
    name: '감성 여운',
    text: '[제목] 그날, 아무도 몰랐다\n' +
          '[본문] 그냥 지나칠 뻔했어요.\n' +
          '근데 다시 보니까… 마음이 이상해지더라고요. 🥺',
  },
  {
    name: '강한 반전',
    text: '[제목] 끝난 줄 알았다\n' +
          '[본문] 여기서 끝이 아니었습니다.\n' +
          '마지막 한 줄에서 완전히 뒤집힙니다.',
  },
  {
    name: '친근한 수다',
    text: '[제목] 이건 진짜 몰랐다\n' +
          '[본문] 어제 알았는데요… 😳\n' +
          '저만 몰랐던 거 아니죠?',
  },
  {
    name: '정보 정리',
    text: '[제목] 오늘부터 달라진다\n' +
          '[본문] 핵심만 짧게 정리했습니다.\n' +
          '① 대상 ② 금액 ③ 신청 방법\n' +
          '놓치면 손해입니다.',
  },
  {
    name: '묵직한 기록',
    text: '[제목] 그는 끝내 돌아오지 못했다\n' +
          '[본문] 짧게 적겠습니다.\n' +
          '확인된 사실만 옮깁니다.',
  },
];

const STYLE_BOX = 'hooking-factory/styles';

function loadStyles() {
  try {
    const raw = JSON.parse(localStorage.getItem(STYLE_BOX) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];   // 저장소를 못 써도 견본은 그대로 쓸 수 있어야 한다
  }
}

function storeStyles(list) {
  try {
    localStorage.setItem(STYLE_BOX, JSON.stringify(list));
  } catch { /* 못 저장해도 화면은 계속 돈다 */ }
}

// 지금 칸에 들어와 있는 견본을 눌린 상태로 표시한다.
function markStylePreset() {
  const now = $('#style-sample').value.trim();
  $('#style-presets').querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', !!now && b.dataset.text === now);
  });
}

function buildStylePresets() {
  const box = $('#style-presets');
  box.innerHTML = '';
  STYLE_PRESETS.forEach((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = s.name;
    b.dataset.text = s.text;
    b.title = s.text;
    box.appendChild(b);
  });

  box.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    $('#style-sample').value = btn.dataset.text;
    markStylePreset();
    saveSettings();
    toast(`문체를 「${btn.textContent}」(으)로 바꿨습니다`);
  });
}

function renderSavedStyles(pick = '') {
  const sel = $('#style-saved');
  const list = loadStyles();
  sel.innerHTML = '<option value="">내가 저장한 문체…</option>';
  list.forEach((s, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = s.name;
    sel.appendChild(o);
  });
  sel.value = pick;
  $('#style-del').disabled = !list.length;
}

function initStyles() {
  buildStylePresets();
  renderSavedStyles();

  $('#style-save').addEventListener('click', () => {
    const text = $('#style-sample').value.trim();
    if (!text) return toast('먼저 아래 칸에 문체를 적어주세요', true);

    const name = (prompt('이 문체에 이름을 붙여주세요', '내 문체') || '').trim();
    if (!name) return;

    const list = loadStyles();
    // 같은 이름이 있으면 덮어쓴다. 이름이 둘이면 어느 것인지 알 수 없다.
    const at = list.findIndex((s) => s.name === name);
    if (at >= 0) list[at] = { name, text };
    else list.push({ name, text });

    storeStyles(list);
    renderSavedStyles(String(at >= 0 ? at : list.length - 1));
    toast(`「${name}」(으)로 저장했습니다`);
  });

  $('#style-saved').addEventListener('change', (ev) => {
    const i = ev.target.value;
    if (i === '') return;
    const item = loadStyles()[Number(i)];
    if (!item) return;
    $('#style-sample').value = item.text;
    markStylePreset();
    saveSettings();
  });

  $('#style-del').addEventListener('click', () => {
    const i = $('#style-saved').value;
    if (i === '') return toast('지울 문체를 먼저 고르세요', true);
    const list = loadStyles();
    const gone = list.splice(Number(i), 1)[0];
    storeStyles(list);
    renderSavedStyles();
    toast(`「${gone?.name || ''}」을(를) 지웠습니다`);
  });

  $('#style-sample').addEventListener('input', markStylePreset);
  markStylePreset();
}

const CATS = [
  { v: 'person', name: '인물정보', c: '#b79cff' },
  { v: 'issue',  name: '시사뉴스', c: '#6fb1ff' },
  { v: 'nature', name: '자연뉴스', c: '#5cd98a' },
  { v: 'star',   name: '연예뉴스', c: '#ff7fbc' },
  { v: 'policy', name: '정책뉴스', c: '#ffc44d' },
  { v: 'animal', name: '동물뉴스', c: '#4fd6c4' },
  { v: 'city',   name: '도시풍경', c: '#ff9166' },
  { v: 'general', name: '기타일반', c: '#a8b0bd' },
];

const catOf = (v) => CATS.find((c) => c.v === v) || CATS[0];

const REMEMBER = 'hooking-factory/settings';

const KEEP = ['photoMode', 'textPos', 'textSize', 'logoPos', 'logoSize',
              'logoMode', 'logoText', 'logoFont', 'logoColor', 'logoAlpha',
              'autoCrop', 'category',
              'headSize', 'headColor', 'headFont', 'headWeight',
              'bodyColor', 'bodyFont', 'bodyWeight', 'saveSize', 'aiExpand',
              'customW', 'customH', 'strokeColor', 'strokeSize', 'lineGap'];

/* ── 작업물 자동 저장 (IndexedDB) ──────────────────────────
 *
 * 화면 새로고침(또는 우리가 파일을 고쳐서 브라우저가 다시 불러올 때)에도
 * 작업 중인 카드와 완성 창고가 그대로 남아있어야 한다. 서버(app.py)는
 * 절대 건드리지 않기로 했으므로, 브라우저 안(IndexedDB)에만 저장한다 —
 * 이러면 서버 코드를 한 줄도 안 바꿔도 새로고침에도 살아남는다.
 *
 * 저장하는 값은 "다시 그리는 데 필요한 재료"들이다(원본 사진, 지운/새로
 * 만든 사진, 글 내용, 위치 등). 화면에 그려진 결과 자체를 통째로 저장하는
 * 게 아니라 이 재료로 render() 를 다시 돌려서 복원한다.
 */

const CARD_DB_NAME = 'hooking-factory-cards';
const CARD_DB_VERSION = 1;
const CARD_STORE = 'cards';

let cardDbPromise = null;

function openCardDB() {
  if (cardDbPromise) return cardDbPromise;
  cardDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(CARD_DB_NAME, CARD_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CARD_STORE)) {
        db.createObjectStore(CARD_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return cardDbPromise;
}

async function dbSaveAll(records) {
  const db = await openCardDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(CARD_STORE, 'readwrite');
    tx.objectStore(CARD_STORE).clear();
    records.forEach((rec) => tx.objectStore(CARD_STORE).put(rec));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function dbLoadAll() {
  const db = await openCardDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CARD_STORE, 'readonly');
    const req = tx.objectStore(CARD_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// 카드를 "다시 그리는 데 필요한 재료"만 뽑아 저장 가능한 평범한 객체로 만든다.
// card.img / card.cleanImg 는 이미 data URL(card.dataUrl, card.cleanImg.src)에서
// 만든 것이므로, 그 문자열만 있으면 다시 그릴 수 있다.
//
// 카드 하나가 대시보드에도, 완성 목록에도 동시에 있을 수 있으므로(복사 방식),
// "어느 배열에서 왔는지"가 아니라 "지금 어디 어디에 들어있는지"를 플래그로 남긴다.
function serializeCard(card, inDashboard, inArchive, sortIndex) {
  return {
    id: card.id,
    inDashboard: !!inDashboard,
    inArchive: !!inArchive,
    // 손잡이로 옮겨놓은 순서. 이게 없으면 새로고침할 때 만든 시각순으로
    // 되돌아가 사용자가 배치한 자리가 사라진다.
    sortIndex: Number.isFinite(sortIndex) ? sortIndex : null,
    imgDataUrl: card.dataUrl || null,
    cleanDataUrl: card.cleanImg?.src || null,
    crop: card.crop || null,
    manualCrop: card.manualCrop || null,
    copy: card.copy || null,
    origTitle: card.origTitle || null,
    category: card.category,
    favorite: !!card.favorite,
    plain: !!card.plain,
    createdAt: (card.createdAt || new Date()).toISOString(),
    status: card.status === 'done' ? 'done' : 'idle',
    photoDone: !!card.photoDone,
    madeBy: card.madeBy || null,
    headOn: !!card.headOn,
    headText: card.headText || '',
    posHead: card.posHead || null,
    posBody: card.posBody || null,
    style: card.style || {},
    lineStyle: card.lineStyle || {},
    wordStyle: card.wordStyle || {},
    batchChecked: !!card.batchChecked,

    // 스레드 북마크릿으로 가져온 카드만 쓰는 값들. 원래 있던 카드는
    // 전부 null/false 로 저장되므로 기존 레코드 구조와 부딪히지 않는다.
    fromThread: !!card.fromThread,
    sourceImages: card.sourceImages || null,
    sourceIndex: card.sourceIndex || 0,
    sourceText: card.sourceText || null,
    sourceUrl: card.sourceUrl || null,
  };
}

let persistTimer = null;

// 드래그처럼 아주 자주 일어나는 변경까지 매번 저장하면 무겁기만 하니,
// 마지막 변경 이후 잠깐 쉬면 그때 한 번만 저장한다.
function persistNow() {
  clearTimeout(persistTimer);
  persistTimer = null;
  // 대시보드 배열과 완성 목록 배열에 같은 카드(같은 id)가 동시에 들어있을 수
  // 있으므로, id 기준으로 합쳐서 카드당 딱 하나의 저장 레코드만 만든다.
  const byId = new Map();
  state.cards.forEach((c, i) => {
    const rec = byId.get(c.id) || { card: c, inDashboard: false, inArchive: false };
    rec.inDashboard = true;
    rec.sortIndex = i;          // 대시보드에 놓인 순서를 그대로 적어둔다
    byId.set(c.id, rec);
  });
  state.archivedCards.forEach((c) => {
    const rec = byId.get(c.id) || { card: c, inDashboard: false, inArchive: false };
    rec.inArchive = true;
    byId.set(c.id, rec);
  });
  const records = [...byId.values()].map(
    ({ card, inDashboard, inArchive, sortIndex }) =>
      serializeCard(card, inDashboard, inArchive, sortIndex)
  );
  dbSaveAll(records).catch((err) => console.error('작업물 자동 저장 실패', err));
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistNow, 500);
}

/* 창을 닫거나 다른 탭으로 넘어갈 때, 아직 안 쓴 것이 있으면 지금 쓴다.

   저장은 0.5초 뒤에 도는데, 글자를 고치자마자 창을 닫으면 그 사이에
   꺼져서 마지막 수정이 통째로 날아갔다. 실제로 그렇게 됐다. */
['visibilitychange', 'pagehide', 'beforeunload'].forEach((ev) => {
  window.addEventListener(ev, () => {
    if (ev === 'visibilitychange' && document.visibilityState !== 'hidden') return;
    if (persistTimer) persistNow();
  });
});

// 새로고침 직후, 저장돼 있던 카드들을 원래 모습 그대로 되살린다.
// - 대시보드에도 있던 카드는 카드 그리드에 (완성목록에도 있었다면 같은 객체를 거기에도 등록)
// - 대시보드에서는 빠지고 완성 목록에만 남아있던 카드는 완성 창고에만
async function restoreAllCards() {
  let records = [];
  try {
    records = await dbLoadAll();
  } catch (err) {
    console.error('저장된 작업물을 불러오지 못했습니다', err);
    return;
  }
  if (!records.length) return;

  // 손잡이로 옮겨놓은 순서가 있으면 그대로, 없으면 만든 시각순으로 되살린다.
  // (예전에 저장된 카드에는 sortIndex 가 없다. 그건 시각순 뒤에 붙는다.)
  const at = (r) => (Number.isFinite(r.sortIndex) ? r.sortIndex : Infinity);
  records.sort((a, b) =>
    at(a) - at(b) || new Date(a.createdAt) - new Date(b.createdAt));

  for (const rec of records) {
    seq = Math.max(seq, rec.id || 0);
    const card = {
      id: rec.id,
      file: null,
      img: null,
      dataUrl: rec.imgDataUrl,
      cleanImg: null,
      crop: rec.crop,
      manualCrop: rec.manualCrop || null,
      copy: rec.copy,
      origTitle: rec.origTitle,
      status: rec.status,
      error: null,
      category: rec.category,
      favorite: rec.favorite,
      plain: !!rec.plain,
      createdAt: new Date(rec.createdAt),
      photoDone: rec.photoDone,
      madeBy: rec.madeBy,
      headOn: rec.headOn,
      headText: rec.headText,
      posHead: rec.posHead,
      posBody: rec.posBody,
      style: rec.style || {},
      lineStyle: rec.lineStyle || {},
      wordStyle: rec.wordStyle || {},
      batchChecked: rec.batchChecked,
      archived: !!rec.inArchive,
      hit: { head: null, body: null },

      fromThread: !!rec.fromThread,
      sourceImages: rec.sourceImages || null,
      sourceIndex: rec.sourceIndex || 0,
      sourceText: rec.sourceText || null,
      sourceUrl: rec.sourceUrl || null,
    };

    try {
      if (rec.imgDataUrl) card.img = await loadImage(rec.imgDataUrl);
      if (rec.cleanDataUrl) card.cleanImg = await loadImage(rec.cleanDataUrl);
    } catch (err) {
      console.error('저장된 사진을 불러오지 못했습니다', rec.id, err);
      continue;   // 사진 자체를 못 읽으면 이 카드는 건너뛴다
    }

    if (rec.inArchive && !rec.inDashboard) {
      // 완성 창고에만 남아있던(대시보드에서는 이미 뺀) 카드는 화면(DOM)에
      // 안 붙으므로, 화면 밖 캔버스 하나만 만들어서 다시보기/저장에 쓴다.
      card.canvas = document.createElement('canvas');
      state.archivedCards.push(card);
      render(card);
    } else {
      // 대시보드에 실제로 마운트한다 — 이 카드는 진짜 캔버스(DOM)를 갖는다.
      // (구버전 레코드처럼 inDashboard/inArchive가 둘 다 비어있는 손상된
      //  레코드도 안전하게 대시보드로 복원한다.)
      mountCard(card);
      state.cards.push(card);
      if (card.copy) fillCard(card);
      render(card);
      setStatus(card, card.status === 'done' ? 'done' : 'idle');
      applyThreadUI(card);
      const favBtn = card.el.querySelector('[data-act="fav"]');
      if (favBtn && card.favorite) {
        favBtn.textContent = '★';
        favBtn.classList.add('on');
      }
      // 완성 목록에도 동시에 있었다면, 같은 카드 객체를 그대로 등록한다
      // (대시보드에 실제로 그려진 캔버스를 완성 목록 썸네일에도 그대로 재사용).
      if (rec.inArchive) state.archivedCards.push(card);
    }
  }

  applyCategory();   // 칩 장수·빈 화면 표시를 복원된 카드 기준으로 다시 맞춘다
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(REMEMBER);
    if (!raw) return {};
    const saved = JSON.parse(raw) || {};
    KEEP.forEach((k) => { if (k in saved) state[k] = saved[k]; });

    // 예전 판은 이 옵션이 켜진 채로 저장돼 있다. 켜져 있는 줄 모르고 쓰다가
    // 저장이 2분씩 걸린 일이 있어, 기존 사용자도 한 번은 꺼진 상태에서
    // 시작하게 한다. 그 뒤로 켜면 그대로 기억한다.
    if (!saved.expandReset) {
      state.aiExpand = false;
      saved.expandReset = true;
    }
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
    out.bgNote = $('#bg-note').value;
    out.styleSample = $('#style-sample').value;
    out.expandReset = true;   // 위의 한 번짜리 초기화를 되풀이하지 않는다
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
function lineText(tokens) {
  return tokens.map((t) => t.text).join(' ');
}

// 원본 줄들을 "단어 토큰" 배열로 쪼갠다. 토큰마다 몇 번째 줄(origin)의
// 몇 번째 단어(wordIndex)인지 꼬리표를 붙여 둔다 — 나중에 줄바꿈이 다시
// 일어나도 "그 단어"를 잃어버리지 않기 위해서다.
function tokenizeLines(lines) {
  return lines.map((raw, origin) => String(raw).trim().split(/\s+/).filter(Boolean)
    .map((text, wordIndex) => ({ text, origin, wordIndex })));
}

// 일본어·중국어는 띄어쓰기가 없어서 한 줄이 통째로 어절 하나가 된다.
// 그 덩어리가 폭을 넘으면 끊을 자리를 못 찾아 글씨만 한없이 작아진다.
// 그럴 때만 글자 단위로 끊는다. 공백이 있는 한국어·영어는 여기 오지 않는다.
const NOT_LINE_START = '」』）〉》］｝、。，．・！？!?：；';

function splitWide(ctx, tok, maxWidth) {
  if (ctx.measureText(tok.text).width <= maxWidth) return [tok];

  const out = [];
  let buf = '';
  for (const ch of Array.from(tok.text)) {
    if (buf && ctx.measureText(buf + ch).width > maxWidth) {
      // 닫는 괄호·구두점이 다음 줄 첫 글자가 되면 일본어에서 눈에 거슬린다.
      // 그런 글자는 앞줄에 붙여 보낸다.
      if (NOT_LINE_START.includes(ch) && Array.from(buf).length > 1) {
        out.push({ ...tok, text: buf + ch });
        buf = '';
        continue;
      }
      out.push({ ...tok, text: buf });
      buf = ch;
    } else {
      buf += ch;
    }
  }
  if (buf) out.push({ ...tok, text: buf });
  return out;
}

// 줄바꿈이 필요할 때 어절(단어) 단위로 다시 나눈다. 원본 줄 경계는 넘지
// 않는다 — 다른 줄의 단어가 한 줄에 같이 붙는 일은 없다.
function wrapTokenLines(ctx, tokenLines, maxWidth) {
  const out = [];
  tokenLines.forEach((toks0) => {
    // 폭을 넘는 덩어리를 먼저 잘라둔다. 자르고 나면 아래 흐름은 그대로다.
    const toks = toks0.flatMap((t) => splitWide(ctx, t, maxWidth));
    if (!toks.length) return;
    let cur = [toks[0]];
    let curText = toks[0].text;
    for (let i = 1; i < toks.length; i++) {
      const test = `${curText} ${toks[i].text}`;
      if (ctx.measureText(test).width <= maxWidth) {
        cur.push(toks[i]);
        curText = test;
      } else {
        out.push(cur);
        cur = [toks[i]];
        curText = toks[i].text;
      }
    }
    out.push(cur);
  });
  return out;
}

function fitTitle(ctx, lines, boxW, boxH, startSize, weight = 900, font = '', mul = null) {
  const clean = lines.map((l) => String(l).trim()).filter(Boolean);
  if (!clean.length) return { size: startSize, wrapped: [] };
  const face = fontOf(font);
  const tokenLines = tokenizeLines(clean);

  const fits = (size, outLines) => {
    ctx.font = `${weight} ${size}px ${face}`;
    return outLines.every((toks) => ctx.measureText(lineText(toks)).width <= boxW)
        && outLines.length * size * (mul || lineMul()) <= boxH;
  };

  // 1단계 — AI가 준 줄 구성을 그대로 지키면서 글자만 줄여본다.
  // 의미 단위로 끊어 온 것이라, 줄을 늘려 어절 하나만 떨어뜨리는 것보다
  // 조금 작게 쓰는 편이 훨씬 낫다.
  let size = startSize;
  const floor = startSize * 0.62;
  while (size >= floor) {
    if (fits(size, tokenLines)) return { size, wrapped: tokenLines };
    size *= 0.97;
  }

  // 2단계 — 그래도 안 들어가면 어절 단위로 다시 나눈다. 단어는 쪼개지 않는다.
  size = startSize;
  for (let step = 0; step < 40; step++) {
    ctx.font = `${weight} ${size}px ${face}`;
    const wrapped = wrapTokenLines(ctx, tokenLines, boxW);
    if (wrapped.length <= MAX_TITLE_LINES && fits(size, wrapped)) {
      return { size, wrapped };
    }
    size *= 0.93;
    if (size < 8) break;
  }

  ctx.font = `${weight} ${size}px ${face}`;
  return { size, wrapped: wrapTokenLines(ctx, tokenLines, boxW) };
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
      const dim = 0.3;
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

// 고른 글꼴을 쓰되, 없는 글꼴이면 기본 글꼴로 흘러가게 뒤에 붙여 둔다.
function fontOf(name) {
  return name ? `"${name}", ${FONT_STACK}` : FONT_STACK;
}

// 끌어서 오른쪽으로 밀어도 글자가 화면 밖으로 나가지 않게 붙잡는다.
function clampLeft(ctx, fit, weight, font, left, w) {
  ctx.font = `${weight} ${fit.size}px ${fontOf(font)}`;
  const wide = Math.max(...fit.wrapped.map((toks) => ctx.measureText(lineText(toks)).width), 0);
  return Math.max(0, Math.min(w - wide, left));
}

/* 글자 테두리.

   흰 글자가 밝은 사진 위에 얹히면 묻혀서 안 읽힌다. 테두리를 두르면
   어떤 배경에서도 읽힌다.

   테두리를 두를 때는 그늘을 끈다. 둘 다 켜면 그늘이 테두리 바깥으로
   또 번져서 글자가 두 겹으로 지저분해진다. */
// 지금 그리는 카드. paintText 는 캔버스 밑바닥 함수라 카드를 넘겨받기
// 어려워서, 그리기 시작할 때 여기에 적어두고 쓴다.
let painting = null;

function strokeColorNow() {
  const c = painting && painting.style && painting.style.strokeColor !== undefined
    ? painting.style.strokeColor : state.strokeColor;
  return c && c !== 'none' ? c : null;
}

function strokeSizeNow() {
  const v = painting && painting.style && painting.style.strokeSize !== undefined
    ? painting.style.strokeSize : state.strokeSize;
  return Number(v) || 3;
}

function strokeOn() {
  return !!strokeColorNow();
}

// 글자 하나(또는 한 줄)를 테두리와 함께 그린다.
function paintText(ctx, text, x, y, size) {
  if (strokeOn()) {
    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1, size * strokeSizeNow() * 0.028);
    ctx.strokeStyle = strokeColorNow();
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeText(text, x, y);
    ctx.restore();
  }
  ctx.fillText(text, x, y);
}

// 글자 덩어리 하나를 그린다. 자리를 잡아 돌려주므로 끌어 옮길 때 쓴다.
// (제목처럼 한 줄 전체가 같은 글꼴·색인 경우에 쓴다)
function drawBlock(ctx, cfg) {
  const { lines, x, top, size, color, weight, font } = cfg;
  ctx.font = `${weight} ${size}px ${fontOf(font)}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = strokeOn() ? 'transparent' : 'rgba(0,0,0,.55)';
  ctx.shadowBlur = strokeOn() ? 0 : size * 0.28;
  ctx.fillStyle = color;
  const lineH = size * lineMul();
  const first = top + size * 0.82;
  let wide = 0;
  lines.forEach((toks, k) => {
    const text = lineText(toks);
    paintText(ctx, text, x, first + k * lineH, size);
    wide = Math.max(wide, ctx.measureText(text).width);
  });
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  return { x, y: top, w: wide, h: lines.length * lineH };
}

// ── 본문: 단어마다 글꼴·크기·색이 다를 수 있다 ──
// outLines: [{ words: [{text,color,font,weight,size}, ...], lineH }, ...]
function clampLeftLines(ctx, outLines, left, w) {
  let wide = 0;
  outLines.forEach((ln) => {
    let width = 0;
    ln.words.forEach((word, i) => {
      ctx.font = `${word.weight} ${word.size}px ${fontOf(word.font)}`;
      if (i > 0) width += ctx.measureText(' ').width;
      width += ctx.measureText(word.text).width;
    });
    wide = Math.max(wide, width);
  });
  return Math.max(0, Math.min(w - wide, left));
}

function drawBodyLines(ctx, { outLines, x, top }) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  let cursorY = top;
  let wide = 0;
  outLines.forEach((ln) => {
    const maxSize = Math.max(...ln.words.map((w) => w.size));
    const baseline = cursorY + maxSize * 0.82;   // 크기 다른 단어끼리도 같은 기준선에 앉는다
    let cursorX = x;
    ln.words.forEach((w, i) => {
      ctx.font = `${w.weight} ${w.size}px ${fontOf(w.font)}`;
      ctx.shadowColor = strokeOn() ? 'transparent' : 'rgba(0,0,0,.55)';
      ctx.shadowBlur = strokeOn() ? 0 : w.size * 0.28;
      ctx.fillStyle = w.color;
      if (i > 0) cursorX += ctx.measureText(' ').width;
      paintText(ctx, w.text, cursorX, baseline, w.size);
      cursorX += ctx.measureText(w.text).width;
      wide = Math.max(wide, cursorX - x);
    });
    cursorY += ln.lineH;
  });
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  return { x, y: top, w: wide, h: cursorY - top };
}

function render(card) {
  const canvas = card.canvas;
  // 글자를 지운 사진이 있으면 그걸 쓴다. 인스타 테두리를 잘라낸 뒤에
  // 만든 사진이라 자동 잘라내기는 다시 할 필요가 없다.
  const clean = card.cleanImg;
  // 내가 직접 올린 사진에는 가릴 외국어가 없다. 덮개도 그늘도 깔지
  // 않고 글자만 얹는다 - 사진을 있는 그대로 두는 것이 목적이다.
  const bare = !!card.plain;
  const img = clean || card.img;
  if (!img || !canvas) return;
  schedulePersist();   // 화면에 뭔가 새로 그려질 때마다 자동 저장을 예약한다
  // 다만 사용자가 위/아래 자름 슬라이더를 만졌으면 그건 지운 사진에도
  // 적용해야 한다. 안 그러면 슬라이더를 아무리 움직여도 화면이 그대로다.
  // 자름 값은 퍼센트라서 지운 사진의 제 크기에 그대로 대면 된다.
  const crop = clean
    ? (card.manualCrop
        ? manualCropRect(clean, card.manualCrop)
        : { x: 0, y: 0, w: clean.naturalWidth, h: clean.naturalHeight })
    : card.crop;

  const w = crop.w;
  const h = crop.h;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  painting = card;     // 테두리 등 카드별 값을 밑바닥 함수도 볼 수 있게
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);

  card.hit = { head: null, body: null };   // 끌어 옮길 때 쓸 자리

  const pad = w * 0.055;
  const boxW = w - pad * 2;
  const lines = photoPending(card)
    ? []
    : (card.copy?.title_lines?.filter(Boolean) || []);
  const region = (clean || bare) ? null : coverRegion(card);

  // 제목은 안 써도 된다. 켜고 글을 넣었을 때만 나온다.
  const headLines = (!photoPending(card) && card.headOn && card.headText)
    ? [String(card.headText).trim()].filter(Boolean) : [];

  if (!lines.length && !headLines.length) {
    if (hasLogo()) drawLogo(ctx, w);
    return;
  }

  /* ── 본문 자리 잡기 ──
   * 우선순위: 단어 강조(card.wordStyle) > 줄 스타일(card.lineStyle) > 왼쪽 패널 공통값.
   * 셋 다 없으면 전부 공통값으로 그려지던 원래 동작 그대로다. */
  let body = null;
  if (lines.length) {
    const cWeight = cardStyle(card, 'weight');
    const cFont = cardStyle(card, 'font');
    const cColor = cardStyle(card, 'color');
    const cSize = cardStyle(card, 'size');
    const mul = lineMul(card);

    const base = h * (cSize / 100);
    ctx.font = `${cWeight} ${base}px ${fontOf(cFont)}`;
    const fit = fitTitle(ctx, lines, boxW, h * 0.44, base, cWeight, cFont, mul);

    const outLines = fit.wrapped.map((tokens) => {
      const words = tokens.map((tok) => {
        const lineOv = card.lineStyle?.[tok.origin] || {};
        const wordOv = card.wordStyle?.[tok.origin]?.[tok.wordIndex] || {};
        const weight = wordOv.weight || lineOv.weight || cWeight;
        const font = wordOv.font || lineOv.font || cFont;
        const color = wordOv.color || lineOv.color || cColor;
        const sizePct = wordOv.size || lineOv.size || cSize;
        return { text: tok.text, color, font, weight, size: h * (sizePct / 100) };
      });
      const lineH = Math.max(...words.map((w) => w.size)) * mul;
      return { words, lineH };
    });

    // 강조 단어가 너무 커서 줄이 박스 밖으로 삐져나가면, 그 줄 전체를
    // 비율대로 살짝 줄인다 (강조 단어만 따로 줄이면 비율이 깨진다).
    outLines.forEach((ln) => {
      const widthOf = () => ln.words.reduce((sum, w, i) => {
        ctx.font = `${w.weight} ${w.size}px ${fontOf(w.font)}`;
        return sum + ctx.measureText(w.text).width + (i > 0 ? ctx.measureText(' ').width : 0);
      }, 0);
      let guard = 0;
      while (widthOf() > boxW && guard < 40) {
        ln.words.forEach((w) => { w.size *= 0.95; });
        ln.lineH = Math.max(...ln.words.map((w) => w.size)) * lineMul(card);
        guard++;
      }
    });

    const blockH = outLines.reduce((sum, ln) => sum + ln.lineH, 0);
    const maxSize = Math.max(...outLines.flatMap((ln) => ln.words.map((w) => w.size)));

    let top;
    let left = pad;
    if (card.posBody) {                       // 끌어서 옮겨 둔 자리
      left = card.posBody.x * w;
      top = card.posBody.y * h;
    } else if (state.textPos === 'top') top = pad;
    else if (state.textPos === 'middle') top = (h - blockH) / 2;
    else if (state.textPos === 'bottom') top = h - pad - blockH;
    else if (bare) top = (h - blockH) / 2;   // 내 사진은 한가운데서 시작
    else top = region
      ? ((region.top + region.bottom) / 2) * h - blockH / 2
      : h - pad - blockH;

    top = Math.max(0, Math.min(h - blockH, top));
    left = clampLeftLines(ctx, outLines, left, w);
    body = { outLines, top, left, blockH, maxSize };
  }

  /* ── 제목 자리 잡기 ── */
  let head = null;
  if (headLines.length) {
    const hSize = cardStyle(card, 'headSize');
    const hWeight = cardStyle(card, 'headWeight');
    const hFont = cardStyle(card, 'headFont');
    const base = h * (hSize / 100);
    const fit = fitTitle(ctx, headLines, boxW, h * 0.3, base, hWeight, hFont);
    const blockH = fit.wrapped.length * fit.size * lineMul(card);
    let top = card.posHead ? card.posHead.y * h : pad;
    let left = card.posHead ? card.posHead.x * w : pad;
    top = Math.max(0, Math.min(h - blockH, top));
    left = clampLeft(ctx, fit, hWeight, hFont, left, w);
    head = { ...fit, top, left, blockH };
  }

  /* ── 덮개·그늘 없음 ──
     예전에는 글자 뒤에 어두운 띠(덮개)와 옅은 그늘을 깔았다. 원본 외국어를
     가리고 글자를 읽히게 하려던 것인데, 깨끗한 사진에서는 그 띠가 그대로
     보여서 지저분했다. 사용자 요청으로 둘 다 그리지 않는다.
     사진에 원본 글자가 남아 있으면 글자를 그 위가 아닌 빈 자리로 끌어서
     옮기면 된다. drawCover / drawScrim 함수는 그대로 두었다 —
     되살릴 일이 생기면 여기서 다시 부르면 된다. */

  /* ── 글자 ── */
  if (body) {
    card.hit.body = drawBodyLines(ctx, {
      outLines: body.outLines, x: body.left, top: body.top,
    });
  }
  if (head) {
    card.hit.head = drawBlock(ctx, {
      lines: head.wrapped, x: head.left, top: head.top, size: head.size,
      color: cardStyle(card, 'headColor'),
      weight: cardStyle(card, 'headWeight'),
      font: cardStyle(card, 'headFont'),
    });
  }

  if (hasLogo()) drawLogo(ctx, w);
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

// 로고가 있느냐. 이미지 로고는 파일이, 글자 로고는 글자가 있어야 한다.
function hasLogo() {
  return state.logoMode === 'text'
    ? !!String(state.logoText || '').trim()
    : !!state.logo;
}

function drawLogo(ctx, w) {
  if (state.logoMode === 'text') return drawTextLogo(ctx, w);
  if (!state.logo) return;
  const lw = w * (state.logoSize / 100);
  const lh = lw * (state.logo.naturalHeight / state.logo.naturalWidth);
  const margin = w * 0.04;
  const x = state.logoPos === 'left' ? margin
          : state.logoPos === 'right' ? w - margin - lw
          : (w - lw) / 2;
  ctx.drawImage(state.logo, x, margin, lw, lh);
}

// 채널명을 얇게 박아 두는 글자 로고. 사진을 가리지 않도록 반투명으로
// 그리고, 밝은 사진에서도 보이도록 아주 옅은 그늘을 함께 깐다.
function drawTextLogo(ctx, w) {
  const text = String(state.logoText || '').trim();
  if (!text) return;
  // 크기 %는 이미지 로고에서 '너비 대비'였다. 글자에는 그대로 쓸 수
  // 없으므로 글자 크기로 환산한다.
  const size = Math.max(8, w * (state.logoSize / 100) * 0.42);
  const margin = w * 0.04;

  ctx.save();
  ctx.font = `800 ${size}px ${fontOf(state.logoFont)}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  const tw = ctx.measureText(text).width;
  const x = state.logoPos === 'left' ? margin
          : state.logoPos === 'right' ? Math.max(margin, w - margin - tw)
          : (w - tw) / 2;

  ctx.globalAlpha = Math.min(1, Math.max(0.05, state.logoAlpha / 100));
  ctx.shadowColor = 'rgba(0,0,0,.45)';
  ctx.shadowBlur = size * 0.25;
  ctx.fillStyle = state.logoColor || '#ffffff';
  ctx.fillText(text, x, margin);
  ctx.restore();
}

// 고른 종류에 맞는 칸만 보여준다. 위치·크기는 로고가 실제로 있을 때만.
function syncLogoBoxes() {
  // 편집창 단추에 지금 로고가 켜졌는지 표시한다. 창을 열어보지 않아도
  // 알 수 있어야 한다.
  const btn = $('#ed-logo');
  if (btn) btn.classList.toggle('on', hasLogo());

  const box = $('#logo-image-box');
  if (!box) return;
  const text = state.logoMode === 'text';
  box.hidden = text;
  $('#logo-text-box').hidden = !text;
  $('#logo-opts').hidden = !hasLogo();
}

function renderAll() {
  state.cards.forEach(render);
}

// 자동 잘라내기 스위치를 반영한다.
// card.manualCrop 이 있으면(사용자가 위/아래 자름 슬라이더를 만졌으면)
// 자동 감지 대신 그 값을 그대로 쓴다 — 사진마다 자동 감지 폭이 달라
// 카드 크기가 들쭉날쭉해지는 문제를 사용자가 직접 맞출 수 있게 한다.
function cropFor(img, card) {
  if (card?.manualCrop) return manualCropRect(img, card.manualCrop);
  return state.autoCrop
    ? detectPhotoRegion(img)
    : { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
}

// 위/아래를 퍼센트(%)로 얼마나 잘라낼지 받아 실제 픽셀 crop 사각형으로 바꾼다.
function manualCropRect(img, { top = 0, bottom = 0 }) {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const y0 = Math.round(H * (top / 100));
  const y1 = Math.round(H * (1 - bottom / 100));
  const h = Math.max(1, y1 - y0);
  return { x: 0, y: y0, w: W, h };
}

/* ── 카드 만들기 ───────────────────────────────────────── */

// plain=true 면 AI 를 한 번도 거치지 않는다. 사진을 그대로 올려두고
// 글자는 사용자가 [글자 편집] 으로 직접 얹는다. 돈이 들지 않는 길이다.
async function addFiles(fileList, plain = false) {
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
      category: state.category,   // 넣는 순간의 항목에 담긴다
      favorite: false,
      plain: !!plain,
      createdAt: new Date(),
      style: {},       // 이 카드만의 크기·글꼴·색·줄간격·테두리
      lineStyle: {},   // 본문 특정 줄만 다른 글꼴·크기·색을 줄 때 씀 { [줄번호]: {size,font,color,weight} }
      wordStyle: {},   // 본문 특정 단어만 강조할 때 씀 { [줄번호]: { [단어번호]: {size,font,color,weight} } }
    };
    state.cards.push(card);
    mountCard(card);

    try {
      const url = await readAsDataURL(file);
      card.dataUrl = url;
      card.img = await loadImage(url);
      card.crop = cropFor(card.img);

      if (plain) {
        // 편집·저장이 곧바로 되도록 최소한의 뼈대를 채워둔다. text_area 를
        // 0 으로 두어야 원본 글자를 가리는 덮개가 생기지 않는다.
        card.copy = blankCopy();
        card.origTitle = [...card.copy.title_lines];
        card.photoDone = true;
        card.madeBy = 'off';
        fillCard(card);          // 상태를 'done' 으로 만들어 준다
        schedulePersist();
      } else {
        render(card);
        setStatus(card, 'idle');
      }
    } catch (err) {
      setError(card, err.message);
    }
  }
  applyCategory();
}

function mountCard(card) {
  const node = $('#card-tpl').content.firstElementChild.cloneNode(true);
  card.el = node;
  card.canvas = node.querySelector('canvas');

  node.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-act]');
    const act = btn?.dataset?.act;
    if (!act) return;
    if (act === 'remove') removeCard(card);
    if (act === 'copy') copyBody(card);
    if (act === 'regen') { card.cleanImg = null; card.madeBy = null; card.photoDone = false; runOne(card); }
    if (act === 'download') openSaveDialog(card);
    if (act === 'fold') toggleFold(card, btn);
    if (act === 'edit-title') openEditor(card);
    if (act === 'edit-body') openBodyEditor(card);
    if (act === 'archive') moveToArchive(card);
    if (act === 'pick') togglePick(card);
    if (act === 'ja') retitleIn(card, 'ja', btn);
    if (act === 'cat-tag') toggleCatPicker(card);
    if (act === 'pick-cat') setCardCategory(card, btn.dataset.v);
    if (act === 'car-prev') cycleCardImage(card, -1);
    if (act === 'car-next') cycleCardImage(card, 1);
    if (act === 'fav') {
      card.favorite = !card.favorite;
      btn.textContent = card.favorite ? '★' : '☆';
      btn.classList.toggle('on', card.favorite);
      applyCategory();
      schedulePersist();
    }
  });

  const dateEl = node.querySelector('[data-role="date"]');
  const hh = String(card.createdAt.getHours()).padStart(2, '0');
  const mm = String(card.createdAt.getMinutes()).padStart(2, '0');
  dateEl.textContent = `${card.createdAt.getMonth() + 1}.${card.createdAt.getDate()} ${hh}:${mm}`;

  node.querySelector('[data-role="body"]').addEventListener('input', (ev) => {
    if (card.copy) card.copy.body = ev.target.value;
  });

  bindDrag(() => card, card.canvas);   // 작은 카드에서도 글자를 끌 수 있다

  const tag = node.querySelector('[data-role="cat"]');
  const cat = catOf(card.category);
  tag.textContent = cat.name;
  tag.style.setProperty('--c', cat.c);

  // 카테고리 옮기기: cat-tag를 누르면 8개 항목이 팝오버로 뜬다.
  const picker = node.querySelector('[data-role="cat-picker"]');
  CATS.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.act = 'pick-cat';
    b.dataset.v = c.v;
    b.style.setProperty('--c', c.c);
    b.textContent = c.name;
    picker.appendChild(b);
  });

  paintPick(card);

  $('#cards').appendChild(node);
}

/* ── 카테고리 옮기기 ───────────────────────────────────────
 * cat-tag(팻말)를 누르면 다른 8개 항목이 뜨고, 고르면 그 카드가
 * 통째로 다른 카테고리로 옮겨간다. 지금 보고 있는 항목이 아니게
 * 되면 화면에서는 바로 사라진다(그 항목 칸으로 갔다는 뜻).
 */
function toggleCatPicker(card) {
  const picker = card.el.querySelector('[data-role="cat-picker"]');
  const open = picker.hidden;
  // 다른 카드에서 열려 있던 팝오버는 닫는다.
  document.querySelectorAll('.cat-picker').forEach((p) => { p.hidden = true; });
  picker.hidden = !open;
}

function setCardCategory(card, v) {
  if (!v || card.category === v) {
    card.el.querySelector('[data-role="cat-picker"]').hidden = true;
    return;
  }
  card.category = v;
  const cat = catOf(v);
  const tag = card.el.querySelector('[data-role="cat"]');
  tag.textContent = cat.name;
  tag.style.setProperty('--c', cat.c);
  card.el.querySelector('[data-role="cat-picker"]').hidden = true;
  applyCategory();
  schedulePersist();
  toast(`「${cat.name}」로 옮겼습니다`);
}

document.addEventListener('click', (ev) => {
  // 카드 바깥이나 다른 카드를 누르면 열려 있던 카테고리 팝오버를 닫는다.
  if (ev.target.closest('[data-act="cat-tag"]') || ev.target.closest('.cat-picker')) return;
  document.querySelectorAll('.cat-picker').forEach((p) => { p.hidden = true; });
});

/* ── 스레드 북마크릿으로 가져온 카드 ────────────────────────
 *
 * 일반 카드와 데이터 구조는 같다(card.img, card.dataUrl 을 그대로 씀).
 * 다른 점은 딱 셋: 사진이 여러 장일 수 있어 캐러셀로 넘기고,
 * 원문(sourceText)이 박스로 함께 붙고, "🧵 스레드 원문" 배지가 달린다.
 * 문구 생성·저장·편집은 기존 카드와 완전히 같은 코드를 그대로 탄다 —
 * card.img/card.dataUrl 만 지금 보이는 사진으로 맞춰주면 되기 때문이다.
 */

// 지금 카드에 보여줄 사진을 sourceImages[idx] 로 바꾼다.
async function setCardImage(card, idx) {
  if (!card.sourceImages || !card.sourceImages.length) return;
  const total = card.sourceImages.length;
  const i = ((idx % total) + total) % total;
  const url = card.sourceImages[i];
  try {
    card.img = await loadImage(url);
    card.dataUrl = url;
    card.sourceIndex = i;
    card.crop = cropFor(card.img, card);
    render(card);
  } catch (err) {
    console.error('스레드 사진을 불러오지 못했습니다', err);
  }
  const count = card.el?.querySelector('[data-role="car-count"]');
  if (count) count.textContent = `${i + 1}/${total}`;
}

function cycleCardImage(card, delta) {
  setCardImage(card, (card.sourceIndex || 0) + delta);
}

// 스레드 카드에만 붙는 화면 조각(배지·캐러셀·원문 박스)을 마운트 이후에 켠다.
function applyThreadUI(card) {
  if (!card.fromThread || !card.el) return;

  const badge = card.el.querySelector('[data-role="thread-badge"]');
  if (badge) badge.hidden = false;

  const total = (card.sourceImages || []).length;
  const nav = card.el.querySelector('[data-role="carousel"]');
  if (nav) {
    nav.hidden = total <= 1;
    const count = card.el.querySelector('[data-role="car-count"]');
    if (count) count.textContent = `${(card.sourceIndex || 0) + 1}/${total}`;
  }

  if (card.sourceText) {
    const box = card.el.querySelector('[data-role="source-box"]');
    const text = card.el.querySelector('[data-role="source-text"]');
    if (box && text) {
      text.textContent = card.sourceText;
      box.hidden = false;
    }
  }
  const link = card.el.querySelector('[data-role="source-link"]');
  if (link && card.sourceUrl) {
    link.href = card.sourceUrl;
    link.hidden = false;
  }
}

// 사진을 하나도 못 가져왔을 때 캔버스에 안내를 그린다(원문 글만이라도 살린다).
function renderNoImagePlaceholder(card) {
  const canvas = card.canvas;
  if (!canvas) return;
  canvas.width = 864;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#14161c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#666c78';
  ctx.font = '600 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🧵 사진을 가져오지 못했어요', canvas.width / 2, canvas.height / 2);
}

// 서버 수집함(/api/thread-inbox)에서 받은 항목들을 카드로 만든다.
async function createThreadCards(items) {
  for (const item of items) {
    const category = CATS.some((c) => c.v === item.category) ? item.category : state.category;
    const card = {
      id: ++seq,
      file: null,
      img: null,
      crop: null,
      copy: null,
      status: 'idle',
      error: null,
      category,
      favorite: false,
      createdAt: item.capturedAt ? new Date(item.capturedAt) : new Date(),
      lineStyle: {},
      wordStyle: {},
      fromThread: true,
      sourceImages: item.images || [],
      sourceIndex: 0,
      sourceText: item.text || '',
      sourceUrl: item.sourceUrl || '',
    };
    state.cards.push(card);
    mountCard(card);
    applyThreadUI(card);

    if (card.sourceImages.length) {
      await setCardImage(card, 0);
    } else {
      renderNoImagePlaceholder(card);
    }
    setStatus(card, 'idle');
  }
  applyCategory();
  schedulePersist();
  const n = items.length;
  toast(n > 1 ? `스레드에서 ${n}건 가져왔어요` : '스레드에서 가져왔어요');
}

/* ── 다른 언어로 제목 다시 달기 ────────────────────────
 *
 * 이미 완성된 카드의 사진은 그대로 두고 글만 다시 쓴다.
 * 사진을 건드리지 않으므로 제미니는 부르지 않는다 — Claude 한 번이면
 * 끝이고, 지운 사진·바꾼 배경도 그대로 살아 있다.
 */
async function retitleIn(card, lang, btn) {
  if (!card.dataUrl) return toast('원본 사진이 없어 다시 쓸 수 없습니다', true);
  if (card.retitling) return;

  card.retitling = true;
  if (btn) btn.disabled = true;
  const keepStatus = card.status;
  setStatus(card, 'working', lang === 'ja' ? '일본어로 쓰는 중' : '다시 쓰는 중');

  try {
    const [, meta, b64] = card.dataUrl.match(/^data:([^;]+);base64,(.*)$/) || [];
    const copy = await api('/api/generate', {
      image_b64: b64,
      media_type: meta || 'image/png',
      lang,
      guide: $('#guide').value,
      style_sample: $('#style-sample').value,
      // 배경 칸. 문구가 아니라 scene(새 배경 묘사)에만 쓰인다.
      bg_note: bgNote(),
      category: card.category || '',
      variant: 0,
    });

    // 사진에 관한 값은 예전 것을 지킨다. 사진을 다시 만들지 않았기 때문이다.
    // (text_area 를 새 값으로 덮으면 이미 지운 사진 위에 엉뚱한 덮개가 생긴다)
    if (card.copy && card.copy.text_area) copy.text_area = card.copy.text_area;
    if (card.copy && card.copy.overlays) copy.overlays = card.copy.overlays;

    card.copy = copy;
    card.lang = lang;
    card.origTitle = [...(copy.title_lines || [])];
    card.posHead = null;      // 손으로 옮겨둔 자리는 글이 바뀌면 안 맞는다
    card.posBody = null;
    fillCard(card);
    setStatus(card, keepStatus === 'done' ? 'done' : 'idle');
    if (btn) btn.classList.add('on');
    toast('일본어로 다시 썼습니다');
  } catch (err) {
    setStatus(card, keepStatus === 'done' ? 'done' : 'idle');
    toast(`다시 쓰기 실패 — ${err.message}`, true);
  } finally {
    card.retitling = false;
    if (btn) btn.disabled = false;
  }
}

/* ── 서버 수집함 확인(폴링) ──────────────────────────────── */

let threadPollTimer = null;

async function pollThreadInbox() {
  try {
    const data = await api('/api/thread-inbox');
    if (data.items && data.items.length) await createThreadCards(data.items);
  } catch {
    // 서버가 잠깐 바쁘거나 아직 안 켜졌을 수 있다. 조용히 넘어가고 다음 차례에 다시 본다.
  }
}

function startThreadPolling() {
  if (threadPollTimer) return;
  pollThreadInbox();
  threadPollTimer = setInterval(pollThreadInbox, 3500);
}

/* ── 본문 여닫기 · 제목 고치기 ────────────────────────────
 *
 * 카드가 세로로 길면 한 화면에 몇 장 안 들어온다. 본문과 해시태그는
 * 접어두고 필요할 때만 편다.
 *
 * 제목은 render() 가 캔버스에 그릴 뿐이라, title_lines 만 바꾸고 다시
 * 그리면 즉시 반영된다. 서버도 API 도 거치지 않는다.
 */

function toggleFold(card, btn) {
  const open = card.el.classList.toggle('open-body');
  btn.textContent = open ? '본문 접기 ▴' : '본문 보기 ▾';
}

function applyTitle(card, text) {
  if (!card.copy) return;
  // 빈 줄은 버린다. 줄 하나가 사진 위의 한 줄이 된다.
  card.copy.title_lines = String(text)
    .split('\n').map((s) => s.trim()).filter(Boolean);
  render(card);
}

function resetTitle(card) {
  if (!card.copy || !card.origTitle) return;
  card.copy.title_lines = [...card.origTitle];
  const box = $('#ed-body');
  if (box) box.value = card.origTitle.join('\n');
  if (editing === card) {
    lineSel = 'all';
    wordSel = null;
    renderLineSelUI();
    syncBodyLineUI();
  }
  render(card);
  toast('처음 글로 되돌렸습니다');
}

/* ── 글자 끌어 옮기기 ──────────────────────────────────────
 *
 * 캔버스에 그린 글자는 버튼이 아니라 그림이라 클릭이 안 된다.
 * 대신 누른 자리가 어느 덩어리 안인지 계산해서 그 덩어리를 따라 옮긴다.
 * 화면에 줄여 보여주고 있으므로 화면 좌표를 캔버스 좌표로 환산한다.
 */

function canvasPoint(canvas, ev) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (ev.clientX - r.left) * (canvas.width / r.width),
    y: (ev.clientY - r.top) * (canvas.height / r.height),
  };
}

function blockAt(card, p) {
  const pad = card.canvas.width * 0.04;   // 손가락이 조금 빗나가도 잡히게
  for (const key of ['head', 'body']) {   // 제목이 위에 있으니 먼저 본다
    const b = card.hit?.[key];
    if (!b) continue;
    if (p.x >= b.x - pad && p.x <= b.x + b.w + pad
     && p.y >= b.y - pad && p.y <= b.y + b.h + pad) return key;
  }
  return null;
}

function bindDrag(getCard, canvas) {
  canvas.addEventListener('pointerdown', (ev) => {
    const card = getCard();
    if (!card || !card.copy || card.canvas !== canvas) return;
    const p = canvasPoint(canvas, ev);
    const key = blockAt(card, p);
    if (!key) return;

    ev.preventDefault();
    canvas.setPointerCapture(ev.pointerId);
    canvas.classList.add('dragging');
    const b = card.hit[key];
    const grabX = p.x - b.x;
    const grabY = p.y - b.y;

    const move = (e) => {
      const q = canvasPoint(canvas, e);
      const slot = key === 'head' ? 'posHead' : 'posBody';
      card[slot] = {
        x: Math.max(0, Math.min(1, (q.x - grabX) / canvas.width)),
        y: Math.max(0, Math.min(1, (q.y - grabY) / canvas.height)),
      };
      render(card);
    };
    const up = () => {
      canvas.classList.remove('dragging');
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  });
}

/* ── 큰 편집창 ────────────────────────────────────────────
 *
 * 목록의 카드는 작아서 글자를 정확히 놓기 어렵다. 편집할 때만
 * 카드의 캔버스를 큰 창으로 옮겨 두고, 닫을 때 제자리로 돌려놓는다.
 * 같은 캔버스를 쓰므로 창에서 고친 것이 카드에 그대로 남는다.
 */

let editing = null;
let bodyEditing = null;   // 본문(긴 글) 편집 팝업이 지금 어느 카드를 다루고 있는지
let archivePage = 1;      // 완성 목록 — 지금 보고 있는 페이지
const ARCHIVE_PAGE_SIZE = 12;   // 한 페이지에 12개씩

// 아직 변환하지 않은 사진에서도 글자 편집이 열려야 한다. 어느 단추로
// 올렸는지에 따라 되고 안 되고가 갈리면, 사용자는 그걸 기억하고 있어야
// 한다. 글상자가 없으면 그 자리에서 빈 것을 만들어 준다 - AI 는 부르지
// 않으므로 돈이 들지 않는다.
function blankCopy() {
  return {
    // 비워 둔다. 사진을 불러오면 사진만 보여야 한다 - 안내 문구가
    // 사진에 얹혀 나오면 그걸 지우는 것부터 해야 한다.
    title_lines: [],
    body: '',
    hashtags: [],
    source_text: '',
    scene: '',
    text_area: { top: 0, bottom: 0 },   // 가릴 원본 글자가 없다
    overlays: [],
  };
}

function openEditor(card) {
  if (!card.img) return toast('사진을 아직 읽지 못했습니다', true);
  if (!card.copy) {
    card.copy = blankCopy();
    card.origTitle = [...card.copy.title_lines];
    card.plain = true;        // AI 를 안 쓰겠다는 뜻이므로 대기열에서 뺀다
    card.photoDone = true;
    card.madeBy = 'off';
    fillCard(card);
    schedulePersist();
  }
  editing = card;
  card.smallCanvas = card.canvas;
  card.canvas = $('#ed-canvas');

  $('#ed-head-on').checked = !!card.headOn;
  $('#ed-head').value = card.headText || '';
  $('#ed-head').disabled = !card.headOn;
  $('#ed-body').value = (card.copy.title_lines || []).join('\n');
  const mc = card.manualCrop || { top: 0, bottom: 0 };
  $('#ed-crop-top').value = mc.top;
  $('#ed-crop-top-out').textContent = `${mc.top}%`;
  $('#ed-crop-bottom').value = mc.bottom;
  $('#ed-crop-bottom-out').textContent = `${mc.bottom}%`;
  lineSel = 'all';
  wordSel = null;
  renderLineSelUI();
  syncBodyLineUI();
  // 카드마다 값이 다르므로, 열 때 이 카드 값으로 칸을 다시 채운다.
  // 이게 없으면 앞서 편집하던 카드의 값이 그대로 남아 보인다.
  syncStyleUI();
  render(card);
  $('#editor').showModal();
}

function closeEditor() {
  const card = editing;
  editing = null;
  if (!card) return;
  card.canvas = card.smallCanvas;
  card.smallCanvas = null;
  render(card);            // 작은 카드에 다시 그린다
}

/* ── 본문(긴 글) 편집 — 큰 화면 팝업 ───────────────────────
 * 사진 위에 그려지는 소제목(글자 편집/title_lines)과는 완전히 다른
 * 데이터다. 이건 카드 하단 "본문 보기" 안 글(card.copy.body)을
 * 그대로 편집하는 것뿐이라, 저장돼도 사진에는 아무 변화가 없다. */
function openBodyEditor(card) {
  // 글자 편집과 같은 이유로, 변환 전에도 열려야 한다.
  if (!card.img) return toast('사진을 아직 읽지 못했습니다', true);
  if (!card.copy) {
    card.copy = blankCopy();
    card.origTitle = [...card.copy.title_lines];
    card.plain = true;
    card.photoDone = true;
    card.madeBy = 'off';
    fillCard(card);
    schedulePersist();
  }
  bodyEditing = card;
  $('#body-edit-text').value = card.copy.body || '';
  $('#body-edit-dlg').showModal();
  $('#body-edit-text').focus();
}

function closeBodyEditor() {
  bodyEditing = null;
  $('#body-edit-dlg').close();
}

function saveBodyEditor() {
  const card = bodyEditing;
  if (!card) return;
  const text = $('#body-edit-text').value;
  if (card.copy) card.copy.body = text;
  // 카드 하단의 작은 본문 칸(접었다 펴는 곳)도 같이 맞춰준다.
  const smallBox = card.el?.querySelector('[data-role="body"]');
  if (smallBox) smallBox.value = text;
  schedulePersist();
  toast('본문을 저장했습니다');
  closeBodyEditor();
}

function removeCard(card) {
  card.el?.remove();
  state.cards = state.cards.filter((c) => c !== card);
  applyCategory();
  schedulePersist();
}

// 사용자가 직접 고른 완료 카드를 "완성 목록"으로 보낸다.
// 예전엔 대시보드에서 빼서(이동) 옮겼는데, 그러면 작업하던 화면에서
// 결과물이 사라져 불편하다는 요청이 있어 이제는 "복사"로 바꾼다 —
// 카드는 대시보드에 그대로 남고, 사용자가 카드의 ✕(빼기)를 직접
// 눌러야만 대시보드에서 없어진다. 완성 목록에는 별개로 계속 남아있다.
function moveToArchive(card) {
  if (state.archivedCards.includes(card)) return;   // 이미 보낸 카드는 중복으로 다시 넣지 않는다
  card.archived = true;
  state.archivedCards.push(card);
  const archiveBtn = card.el?.querySelector('[data-role="archive"]');
  if (archiveBtn) archiveBtn.hidden = true;
  applyCategory();
  toast('완성 목록으로 보냈습니다 (대시보드에는 그대로 남아있어요)');
  schedulePersist();   // 새로고침해도 안 사라지게 저장해 둔다
}

function setStatus(card, status, label) {
  card.status = status;
  const overlay = card.el.querySelector('[data-role="overlay"]');
  const text = card.el.querySelector('[data-role="status"]');
  const archiveBtn = card.el.querySelector('[data-role="archive"]');

  // 아직 변환 전이거나 이미 끝났으면 사진을 가리지 않는다.
  // 덮개는 실제로 기다리는 동안에만 띄운다.
  if (status === 'done' || (status === 'idle' && !label)) {
    overlay.hidden = true;
    if (archiveBtn) archiveBtn.hidden = status !== 'done' || card.archived;
    return;
  }
  overlay.hidden = false;
  overlay.classList.toggle('done', status === 'idle');
  text.textContent = label || (status === 'working' ? '읽는 중' : '차례 기다리는 중');
  if (archiveBtn) archiveBtn.hidden = true;
}

function setError(card, message) {
  card.status = 'error';
  card.error = message;
  const err = card.el.querySelector('[data-role="err"]');
  err.textContent = message;
  err.hidden = false;
  setStatus(card, 'idle', '실패');
}

// 실패로 처리할 것까지는 아니지만 알려야 할 때. status 는 건드리지 않는다.
// 실패 이유를 사진 위에 한 줄로. 한도는 기다리면 풀리고, 나머지는 아니다.
// 이 둘을 구분해 말해주지 않으면 사용자가 계속 다시 눌러서 한도만 더 태운다.
function warnFor(what, message) {
  const m = String(message || '');
  if (m.includes('분당')) return `⏳ ${what} — 제미니 분당 한도. 1~2분 뒤 [다시 뽑기]`;
  if (m.includes('오늘') || m.includes('하루')) return `🚫 ${what} — 오늘 제미니 한도 소진`;
  if (m.includes('결제') || m.includes('billing')) return `💳 ${what} — 제미니 결제 설정 필요`;
  return `⚠ ${what} 실패 · 덮어서 가림`;
}

function setWarn(card, message) {
  const el = card.el?.querySelector('[data-role="warn"]');
  if (!el) return;
  el.textContent = message || '';
  el.hidden = !message;
}

function setNote(card, message) {
  const err = card.el.querySelector('[data-role="err"]');
  err.textContent = message;
  err.hidden = false;
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

  // 편집창에서 보고 있던 카드라면 새로 뽑은 글로 갈아 끼운다.
  if (editing === card) $('#ed-body').value = (copy.title_lines || []).join('\n');

  render(card);
  setStatus(card, 'done');
  syncUI();     // 한 장이라도 끝나면 저장 단추가 켜진다
}

/* ── 실행 ──────────────────────────────────────────────── */

// 잘라낸 사진만 캔버스로 뽑아낸다. 인스타 UI 는 이미 빠진 상태라 Gemini 가 사진만 본다.
function cropCanvas(card) {
  const c = document.createElement('canvas');
  c.width = card.crop.w;
  c.height = card.crop.h;
  c.getContext('2d').drawImage(
    card.img, card.crop.x, card.crop.y, card.crop.w, card.crop.h,
    0, 0, card.crop.w, card.crop.h,
  );
  return c;
}

function croppedBase64(card) {
  return cropCanvas(card).toDataURL('image/png').split(',')[1];
}

/* ── 인물 오려내기 (배경 합성용) ──────────────────────────
 *
 * "사진 새로 만들기"는 Gemini한테 "인물은 그대로 두고 배경만 바꿔라"라고
 * 프롬프트로 부탁하지만, 모델이 사진 전체를 다시 그리는 방식이라 결과가
 * 매번 달라진다(딴 사람처럼 나오거나 안고 있던 아기가 사라지는 등).
 *
 * 그래서 브라우저에서 인물만 정확히 오려내는(세그멘테이션) 작업을 따로
 * 하고, Gemini가 만든 배경 위에 "원본 그 자체" 인물 픽셀을 다시 얹는다.
 * 인물은 AI가 다시 그린 게 아니라 원본이라서 100% 같은 사람이 보장된다.
 *
 * MediaPipe Selfie Segmenter(사람 전용)를 쓰므로 동물 사진이나 인식이
 * 안 되는 경우엔 마스크 신뢰도를 검사해서 자동으로 예전 방식(AI 결과를
 * 그대로 씀)으로 돌아간다. */

let _segmenterPromise = null;

function getImageSegmenter() {
  if (!_segmenterPromise) {
    _segmenterPromise = (async () => {
      const vision = await import(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs'
      );
      const fileset = await vision.FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
      );
      return vision.ImageSegmenter.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
          delegate: 'GPU',
        },
        outputCategoryMask: false,
        outputConfidenceMasks: true,
        runningMode: 'IMAGE',
      });
    })().catch((err) => {
      _segmenterPromise = null;   // 실패하면 다음에 다시 시도할 수 있게 비운다
      throw err;
    });
  }
  return _segmenterPromise;
}

// 사람 마스크(0~255 그레이스케일)를 목표 크기(w,h)의 캔버스로 만든다.
// 실패하거나 이 이미지엔 안 맞다 싶으면 null.
// timeoutMs 안에 안 끝나면(콜백이 영영 안 오는 경우 등) 무조건 포기하고
// null 을 준다 — 이 단계 때문에 사진 만들기 전체가 멈춰서는 안 된다.
async function buildSubjectMaskCanvas(sourceCanvas, w, h, timeoutMs = 6000) {
  let timer = null;
  try {
    return await Promise.race([
      buildSubjectMaskCanvasInner(sourceCanvas, w, h),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          console.warn('[사진처리] 인물 분리 시간 초과 — 예전 방식으로 처리합니다.');
          resolve(null);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function buildSubjectMaskCanvasInner(sourceCanvas, w, h) {
  console.log('[사진처리] 인물 분리 모델 준비 중…');
  let segmenter;
  try {
    segmenter = await getImageSegmenter();
  } catch (err) {
    console.warn('인물 분리 모델을 불러오지 못했습니다 — 예전 방식으로 처리합니다.', err);
    return null;
  }
  console.log('[사진처리] 인물 분리 모델 준비 완료, 분석 시작');

  let result;
  try {
    // segment() 는 값을 리턴하지 않고 콜백으로 결과를 준다.
    result = await new Promise((resolve, reject) => {
      try {
        segmenter.segment(sourceCanvas, resolve);
      } catch (err) {
        reject(err);
      }
    });
  } catch (err) {
    console.warn('인물 분리에 실패했습니다 — 예전 방식으로 처리합니다.', err);
    return null;
  }
  console.log('[사진처리] 인물 분리 분석 완료');

  try {
    const masks = result?.confidenceMasks;
    if (!masks || !masks.length) return null;

    // 이 모델은 마스크를 두 장 준다 — 0번이 '배경', 1번이 '사람'이다.
    // 0번을 쓰면 원본 배경을 새 배경 위에 도로 덮어버려서, 제미니가 배경을
    // 제대로 새로 그려 보내도 화면에는 원본 배경이 그대로 보인다.
    // 라벨을 읽어 '배경이 아닌 것'을 고른다. 라벨을 못 읽으면 1번을 쓴다.
    let idx = masks.length > 1 ? 1 : 0;
    try {
      const labels = segmenter.getLabels ? segmenter.getLabels() : null;
      if (labels && labels.length === masks.length) {
        const found = labels.findIndex((l) => !/back[\s_-]?ground/i.test(String(l)));
        if (found >= 0) idx = found;
        console.log(`[사진처리] 마스크 종류 [${labels.join(', ')}] → `
                  + `${labels[idx]} 사용`);
      }
    } catch { /* 라벨을 못 읽어도 기본값으로 진행한다 */ }

    const mask = masks[idx];
    const mw = mask.width;
    const mh = mask.height;
    const raw = mask.getAsFloat32Array();

    // 확신도를 그대로 투명도로 쓰면 안 된다. 사람이 없는 사진에서는 화면
    // 곳곳이 0.7 쯤으로 어정쩡하게 나오는데, 그 값을 투명도로 쓰면 원본이
    // 70% 불투명하게 새 배경을 통째로 덮어버린다. 확실한 곳만 남기고 자른다.
    const small = document.createElement('canvas');
    small.width = mw;
    small.height = mh;
    const sctx = small.getContext('2d');
    const imgData = sctx.createImageData(mw, mh);
    let vague = 0;
    for (let i = 0; i < mw * mh; i++) {
      const raw1 = raw[i];
      if (raw1 > 0.25 && raw1 < 0.75) vague++;
      const v = raw1 > 0.5 ? 255 : 0;
      imgData.data[i * 4 + 0] = v;
      imgData.data[i * 4 + 1] = v;
      imgData.data[i * 4 + 2] = v;
      imgData.data[i * 4 + 3] = 255;
    }
    sctx.putImageData(imgData, 0, 0);

    // 진짜 사람을 찾았다면 경계만 애매하고 나머지는 확실하다. 화면 곳곳이
    // 애매하다면 사람을 못 찾고 헤맨 것이므로 쓰지 않는다.
    const vagueRatio = vague / (mw * mh);
    if (vagueRatio > 0.3) {
      console.log(`[사진처리] 인물 분리가 불분명합니다(애매한 부분 `
                + `${(vagueRatio * 100).toFixed(0)}%) — 마스크를 쓰지 않습니다`);
      return null;
    }

    // 목표 해상도로 확대. 자연스러운 보간 덕에 경계가 부드럽게 이어진다.
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = w;
    maskCanvas.height = h;
    const mctx = maskCanvas.getContext('2d');
    mctx.imageSmoothingEnabled = true;
    mctx.filter = 'blur(2px)';
    mctx.drawImage(small, 0, 0, mw, mh, 0, 0, w, h);
    return maskCanvas;
  } finally {
    result?.close?.();
  }
}

// 마스크에서 "사람"으로 잡힌 비율. 너무 적으면 사람을 못 찾은 것이고,
// 너무 많으면 새 배경이 거의 다 가려져 배경을 바꾼 의미가 없어진다.
function maskCoverage(maskCanvas) {
  const { width: w, height: h } = maskCanvas;
  const data = maskCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += data[i];
  return sum / (255 * w * h);
}

// AI가 만든 새 배경 위에, 원본 사진 속 인물 픽셀을 마스크 모양대로 오려 얹는다.
function compositeSubjectOntoBackground(bgImg, subjectCanvas, maskCanvas, w, h) {
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  ctx.drawImage(bgImg, 0, 0, w, h);

  const layer = document.createElement('canvas');
  layer.width = w;
  layer.height = h;
  const lctx = layer.getContext('2d');
  lctx.drawImage(subjectCanvas, 0, 0, w, h);
  lctx.globalCompositeOperation = 'destination-in';
  lctx.drawImage(maskCanvas, 0, 0, w, h);

  ctx.drawImage(layer, 0, 0);
  return out;
}

// 사진 위에 얹혀 있던 작은 사진(동그란 얼굴, 모서리 섬네일)을 원본에서
// 그대로 도로 찍는다. 이건 장면이 아니라 스티커다 — 상어는 물속에 있지만
// 동그라미 속 얼굴은 어디에 있는 게 아니라 그냥 덮여 있을 뿐이다.
// AI를 한 번도 거치지 않으므로 위치도 내용도 1픽셀 안 틀린다.
// 자리는 클로드가 사진을 보고 찾아준다. 왼쪽이든 오른쪽이든, 몇 개든.
function stampOverlays(baseCanvas, srcCanvas, overlays, w, h) {
  const list = Array.isArray(overlays) ? overlays : [];
  if (!list.length) return baseCanvas;

  const ctx = baseCanvas.getContext('2d');
  const clamp = (v) => Math.min(1, Math.max(0, Number(v)));
  let done = 0;

  list.forEach((ov) => {
    if (!ov) return;
    const l = clamp(ov.left);
    const t = clamp(ov.top);
    const r = clamp(ov.right);
    const b = clamp(ov.bottom);
    if (!(r > l && b > t)) return;
    // 사진의 절반 가까이를 덮는다면 스티커가 아니라 잘못 읽은 것이다.
    // 그대로 찍으면 새로 만든 배경을 통째로 가려버린다.
    if ((r - l) * (b - t) > 0.4) {
      console.log('[사진처리] 얹힌 사진이 너무 큽니다 — 건너뜁니다');
      return;
    }

    const x = l * w;
    const y = t * h;
    const ww = (r - l) * w;
    const hh = (b - t) * h;

    ctx.save();
    ctx.beginPath();
    if (ov.shape === 'rect') {
      ctx.rect(x, y, ww, hh);
    } else {
      ctx.ellipse(x + ww / 2, y + hh / 2, ww / 2, hh / 2, 0, 0, Math.PI * 2);
    }
    ctx.clip();
    ctx.drawImage(srcCanvas, 0, 0, w, h);
    ctx.restore();
    done += 1;
  });

  if (done) console.log(`[사진처리] 얹힌 사진 ${done}개를 원본 그대로 다시 얹었습니다`);
  return baseCanvas;
}

/* ── 저장 크기 ────────────────────────────────────────────
 *
 * 인스타 피드는 4:5, 틱톡 사진은 9:16 이다. 캡쳐 크기 그대로 올리면
 * 플랫폼이 알아서 잘라내면서 글자가 잘릴 수 있다.
 *
 * 모자라는 자리는 같은 사진을 크게 늘려 흐리게 깐다. 검은 여백보다
 * 자연스럽고, 사진을 잘라내지 않으므로 인물이 잘릴 일도 없다.
 */
// 사진을 자르지 않고 안 맞는 비율만큼 살짝 넘치게 채운다(여백/블러 없음).
// AI 확장이 꺼져 있을 때, 그리고 AI가 돌려준 사진을 정확한 저장 크기로
// 마지막에 맞출 때 둘 다 이 함수를 쓴다.
function fitCoverCanvas(src, W, H) {
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const cx = out.getContext('2d');
  const cover = Math.max(W / src.width, H / src.height);
  const dw = src.width * cover;
  const dh = src.height * cover;

  // 세로가 잘려야 할 때(예: 4:5 사진 → 1:1 저장)는 아래를 지키고 위를
  // 자른다. 제목은 아래쪽에 얹혀 있어서, 가운데를 기준으로 자르면
  // 글자가 반쯤 잘려나간다. 위쪽은 대개 하늘·배경이라 잃어도 덜 아프다.
  const dy = dh > H ? H - dh : (H - dh) / 2;

  cx.drawImage(src, (W - dw) / 2, dy, dw, dh);
  return out;
}

// AI 확장을 안 쓸 때의 저장. 여백을 남기지 않고 저장 크기를 꽉 채운다.
// (예전에는 남는 자리에 흐린 배경을 깔았는데, 1:1 로 저장하면 사진이
//  위쪽에 조그맣게 박히고 아래가 텅 비어 나왔다.)
function plainExportCanvas(card) {
  const src = card.canvas;
  const spec = sizeSpec();
  if (!spec || !src.width) return src;
  return fitCoverCanvas(src, spec.w, spec.h);
}

// 원본 비율이 저장 크기랑 이미 거의 맞으면(1% 이내) 굳이 Gemini를
// 부르지 않는다 — 잘릴 것도, 채울 것도 거의 없기 때문이다.
function ratioAlreadyMatches(src, spec) {
  const srcRatio = src.width / src.height;
  const wantRatio = spec.w / spec.h;
  return Math.abs(srcRatio - wantRatio) / wantRatio < 0.01;
}

// 원본이 너무 크면 줄여서 보낸다. 최종 저장 크기는 어차피 1080급이라
// 화질 차이는 거의 안 보이는데, Gemini가 처리할 픽셀 수가 줄어서
// 확장 속도가 눈에 띄게 빨라진다.
function downscaledForAI(src, maxSide = 1280) {
  const scale = Math.min(1, maxSide / Math.max(src.width, src.height));
  if (scale >= 1) return src;
  const out = document.createElement('canvas');
  out.width = Math.round(src.width * scale);
  out.height = Math.round(src.height * scale);
  out.getContext('2d').drawImage(src, 0, 0, out.width, out.height);
  return out;
}

// Gemini(nano-banana)로 저장 크기에 맞춰 자연스럽게 확장한다.
// 실패하면 예외를 던지고, 부른 쪽(doSave)이 기존 방식으로 대체한다.
async function expandCanvasWithAI(card) {
  const src = card.canvas;
  const spec = sizeSpec();
  if (!spec || !src.width) return src;
  if (ratioAlreadyMatches(src, spec)) return fitCoverCanvas(src, spec.w, spec.h);

  const sendCanvas = downscaledForAI(src);
  const image_b64 = sendCanvas.toDataURL('image/png').split(',')[1];
  const out = await api('/api/erase', {
    image_b64,
    media_type: 'image/png',
    mode: 'expand',
    save_size: state.saveSize,
  });
  const img = await loadImage(`data:${out.media_type};base64,${out.image_b64}`);
  // Gemini가 비율은 맞춰줘도 정확한 픽셀까지는 보장하지 않으므로,
  // 마지막에 한 번 더 정확한 저장 크기로 맞춰 그린다(거의 안 잘림).
  return fitCoverCanvas(img, spec.w, spec.h);
}

// 파일명으로 못 쓰는 문자를 걷어낸다 (서버 safe_name과 같은 목적).
function safeFileName(name, fallback = '무제') {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || fallback).slice(0, 60);
}

// 캔버스를 그대로 파일로 다운로드한다. 서버에 저장 요청을 하지 않고
// 브라우저가 정한 다운로드 폴더(대개 '다운로드')로 바로 떨어지게 한다.
function downloadCanvasAsFile(canvas, filename) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('이미지를 만들지 못했습니다.'));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      resolve();
    }, 'image/png');
  });
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
    // 배경 칸. 문구가 아니라 scene(새 배경 묘사)에만 쓰인다.
    bg_note: bgNote(),
    // 어느 항목에 담긴 사진인지 알려준다. 문구의 관점과, 새로 그릴
    // 배경의 방향이 여기서 갈린다.
    category: card.category || '',
    // 몇 번째로 뽑는 것인지. 0보다 크면 '다시 뽑기'이므로 앞서와
    // 다른 각도·다른 장소를 달라고 요청한다.
    variant: card.tries || 0,
  });
  card.tries = (card.tries || 0) + 1;
  // AI 가 처음 준 제목을 따로 둔다. 고쳤다가 「원래대로」로 돌아올 자리다.
  card.origTitle = [...(card.copy.title_lines || [])];
}

// 사진 처리. 실패해도 카피는 살아 있으므로 덮는 방식으로 이어간다.
async function transformOne(card) {
  const mode = state.photoMode;
  if (!state.hasGemini || mode === 'off' || card.cleanImg) {
    console.log(`[사진처리] 건너뜀 — hasGemini=${state.hasGemini}, mode=${mode}, cleanImg=${!!card.cleanImg}`);
    if (!card.photoDone) {
      card.photoDone = true;
      fillCard(card);
    }
    return;
  }

  const recreate = mode === 'recreate';
  setStatus(card, 'working', recreate ? '사진 만드는 중' : '글자 지우는 중');
  console.log(`[사진처리] 시작 — mode=${mode}`);
  try {
    const cropCv = cropCanvas(card);

    if (!recreate) {
      // 글자만 지우기 — 예전 그대로, 한 번만 호출한다.
      console.log('[사진처리] Gemini 호출 시작 (글자 지우기)');
      const out = await api('/api/erase', {
        image_b64: cropCv.toDataURL('image/png').split(',')[1],
        media_type: 'image/png',
        mode,
        story: '',
      });
      console.log('[사진처리] Gemini 응답 받음');
      card.cleanImg = await loadImage(`data:${out.media_type};base64,${out.image_b64}`);
      card.madeBy = mode;
      clearError(card);
      setWarn(card, '');
    } else {
      // 사진 새로 만들기 — 2단계로 나눈다.
      // 1단계) 영어 글자부터 지우고 자연스럽게 메꾼다 (인물·배경은 원본 그대로).
      // 2단계) 그 '깨끗한 사진'을 가지고 배경만 새로 그린다.
      // 한 번의 요청에 "글자 지우기 + 인물 보존 + 배경 교체"를 다 시키면
      // 모델이 배경 교체까지는 손을 못 대는 경우가 많아서 나눴다.
      console.log('[사진처리] 1단계 — 글자 지우기 시작');
      let erasedCv = cropCv;
      let erasedOk = false;
      try {
        const eraseOut = await api('/api/erase', {
          image_b64: cropCv.toDataURL('image/png').split(',')[1],
          media_type: 'image/png',
          mode: 'erase',
          story: '',
        });
        const erasedImg = await loadImage(`data:${eraseOut.media_type};base64,${eraseOut.image_b64}`);
        const c = document.createElement('canvas');
        c.width = cropCv.width;
        c.height = cropCv.height;
        c.getContext('2d').drawImage(erasedImg, 0, 0, cropCv.width, cropCv.height);
        erasedCv = c;
        erasedOk = true;
        console.log('[사진처리] 1단계 완료 — 글자 지워진 사진 확보');
      } catch (err) {
        console.warn('[사진처리] 1단계(글자 지우기) 실패 — 원본으로 2단계 진행합니다.', err);
      }

      // 인물 마스크는 '글자 지워진 사진' 기준으로 뽑는다 — 인물 위에 글자가
      // 걸쳐 있었다면 마스크도 그 지운 자국 기준이라야 나중에 얹을 인물
      // 픽셀에 외국어 잔재가 안 남는다.
      let maskCv = null;
      try {
        maskCv = await buildSubjectMaskCanvas(erasedCv, erasedCv.width, erasedCv.height);
        if (maskCv) {
          const cov = maskCoverage(maskCv);
          // 사람 분리 모델이라 동물·사물은 잡히지 않는다(=너무 적음). 화면을
          // 거의 다 덮는 마스크도 버린다 — 그대로 얹으면 제미니가 새로 그린
          // 배경이 통째로 가려져, 배경이 안 바뀐 것처럼 보인다.
          if (cov < 0.02 || cov > 0.85) {
            console.log(`[사진처리] 인물 비율 ${(cov * 100).toFixed(1)}% — `
                      + '오려붙이기를 쓰지 않습니다');
            maskCv = null;
          } else {
            console.log(`[사진처리] 인물 비율 ${(cov * 100).toFixed(1)}% — `
                      + '이 부분만 원본을 얹습니다');
          }
        }
      } catch (err) {
        console.warn('인물 마스크 준비 중 오류 — 예전 방식으로 처리합니다.', err);
        maskCv = null;
      }

      // 1단계를 도는 동안 ✕ 로 지워졌을 수 있다. 2단계는 요청이 한 번 더
      // 나가므로, 여기서 확인하지 않으면 없어진 카드 때문에 돈이 나간다.
      if (!state.cards.includes(card)) {
        console.log('[사진처리] 카드가 지워져 2단계를 건너뜁니다');
        return;
      }

      if (!maskCv) {
        console.log('[사진처리] 주인공을 오려내지 못했습니다(사람이 아니거나 인식 실패) '
                  + '— 보존은 AI 지시문에만 의존합니다');
      }
      console.log('[사진처리] 2단계 — 배경 교체 시작');
      try {
      const out = await api('/api/erase', {
        image_b64: erasedCv.toDataURL('image/png').split(',')[1],
        media_type: 'image/png',
        mode: 'recreate',
        story: storyOf(card),
        bg_note: bgNote(),
      });
      console.log('[사진처리] 2단계 완료 — 배경 응답 받음');
      console.log(`[사진처리] 입력 크기 ${erasedCv.toDataURL('image/png').length}자, 결과 크기 ${out.image_b64.length}자 (모델: ${out.model || '?'})`);
      let finalImg = await loadImage(`data:${out.media_type};base64,${out.image_b64}`);
      const W = erasedCv.width;
      const H = erasedCv.height;
      let outCv = null;

      if (maskCv) {
        // 글자 지워진 원본 주인공 픽셀을 새 배경 위에 그대로 얹는다.
        outCv = compositeSubjectOntoBackground(finalImg, erasedCv, maskCv, W, H);
        console.log('[사진처리] 주인공 합성 완료 — 원본 픽셀 그대로');
      }

      // 얹혀 있던 작은 사진은 배경과 함께 사라지거나 뭉개진다. 도로 찍는다.
      const overlays = (card.copy || {}).overlays;
      if (Array.isArray(overlays) && overlays.length) {
        if (!outCv) {
          outCv = document.createElement('canvas');
          outCv.width = W;
          outCv.height = H;
          outCv.getContext('2d').drawImage(finalImg, 0, 0, W, H);
        }
        stampOverlays(outCv, erasedCv, overlays, W, H);
      }

      if (outCv) finalImg = await loadImage(outCv.toDataURL('image/png'));
      card.cleanImg = finalImg;
      card.madeBy = mode;
      clearError(card);
      setWarn(card, '');
      } catch (err) {
        // 배경 교체가 실패했다고 1단계에서 지운 사진까지 버리면 안 된다.
        // 버리면 이미 낸 돈도 날리고, 결과물은 검은 띠로 덮여 더 나빠진다.
        if (!erasedOk) throw err;
        console.warn('[사진처리] 2단계 실패 — 글자 지운 사진으로 마무리합니다.', err);
        card.cleanImg = await loadImage(erasedCv.toDataURL('image/png'));
        card.madeBy = 'erase';
        setWarn(card, warnFor('배경 교체', err.message));
        setNote(card, `글자는 지웠지만 배경 새로 만들기는 실패했습니다. `
                    + `[다시 뽑기]를 누르면 다시 시도합니다. (${err.message})`);
      }
    }
  } catch (err) {
    console.error('[사진처리] 실패', err);
    setWarn(card, warnFor(recreate ? '사진 만들기' : '글자 지우기', err.message));
    setError(card,
      `${recreate ? '사진 만들기' : '글자 지우기'} 실패 — 덮어서 처리했습니다. (${err.message})`);
  }
  card.photoDone = true;   // 이제 제목을 얹어도 된다
  fillCard(card);
}

// 왼쪽 패널 '배경 지시' 칸. 사진 새로 만들기에만 쓰인다.
function bgNote() {
  const el = $('#bg-note');
  return el ? el.value.trim() : '';
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

// 사진 처리 방식을 바꿔놓고 다시 누른 것이라면, 끝난 카드도 다시 만들어야 한다.
// 이게 없으면 '글자만 지우기'로 한 번 돌린 뒤 '사진 새로 만들기'로 바꿔도
// 카드가 done 이라 큐에서 빠져, 눌러도 아무 일이 없었다.
function wantedMode() {
  return state.hasGemini ? state.photoMode : 'off';
}

function needsRemake(card) {
  return card.status === 'done' && (card.madeBy || 'off') !== wantedMode();
}

async function runAll() {
  // 끝난 카드는 다시 넣지 않는다 — 결과가 덮어써지기 때문이다.
  // 단, 사진 처리 방식이 바뀌었다면 그건 사용자가 일부러 바꾼 것이므로 다시 만든다.
  // 고른 것이 있으면 그것만. 없으면 이 항목 전체.
  const picked = pickedInCategory();
  const pool = picked.length ? picked : inCategory();
  const queue = pool.filter((c) =>
    c.img && c.status !== 'working' && (c.status !== 'done' || needsRemake(c))
    // '사진만 넣기'로 올린 카드는 AI 를 안 쓰겠다는 뜻이다. 습관적으로
    // [이미지 변환] 을 눌렀다가 돈이 나가면 안 된다. ✓ 로 콕 집었을
    // 때만 돈다.
    && (!c.plain || picked.length));

  if (!queue.length) {
    // 조용히 아무 일도 안 일어나면 고장으로 보인다. 왜 안 도는지 말해준다.
    const done = pool.filter((c) => c.status === 'done').length;
    toast(done
      ? `이 항목의 ${done}장은 이미 「${MODE_LABEL[wantedMode()]}」로 만들어졌습니다. `
        + '다시 만들려면 카드의 [다시 뽑기]를 누르세요.'
      : '변환할 사진이 없습니다.', true);
    return;
  }

  state.running = true;
  syncUI();
  queue.forEach((c) => {
    clearError(c);
    // 방식이 바뀌어 다시 만드는 카드는 지난 결과를 비워야 새로 처리된다.
    // (transformOne 은 cleanImg 가 남아 있으면 건너뛴다)
    // 사진만 다시 만들면 되므로 문구는 그대로 둔다 — 다시 쓰면 Claude 값이
    // 한 번 더 나가는데, 바뀐 건 사진 처리 방식뿐이다.
    c.photoOnly = c.status === 'done' && !!c.copy;
    if (c.status === 'done') { c.cleanImg = null; c.madeBy = null; }
    c.photoDone = false;
    setStatus(c, 'queued');
  });

  try {
    // 1단계 — 카피. 글은 여러 장을 동시에 맡겨도 잘 받아준다.
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        while (cursor < queue.length) {
          const card = queue[cursor++];
          if (!state.cards.includes(card)) continue;   // 그 사이 지워졌으면 건너뛴다
          try {
            if (card.photoOnly) {
              // 문구는 이미 있다. 사진만 다시 만든다.
              fillCard(card);
              setStatus(card, 'queued', '사진 차례 기다리는 중');
              continue;
            }
            setStatus(card, 'working', '읽는 중');
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
      if (!state.cards.includes(card)) continue;   // 처리 도중 ✕ 로 지워진 카드는 건너뛴다
      if (!card.copy) continue;
      try {
        await transformOne(card);   // 건너뛸 때도 상태를 정리한다
      } catch (err) {
        setError(card, err.message);
      }
    }
  } finally {
    // 도중에 무슨 일이 있어도(카드 삭제, 오류 등) 버튼은 반드시 풀린다.
    state.running = false;
    syncUI();
  }

  const failed = state.cards.filter((c) => c.status === 'error').length;
  toast(
    failed ? `${queue.length - failed}장 완료, ${failed}장은 덮어서 처리` : '전부 완료됐습니다',
    failed > 0,
  );
}

/* ── 내보내기 ──────────────────────────────────────────── */

// 완성 창고의 카드를 다시 대시보드로 되돌려 편집을 이어가게 한다.
// moveToArchive()는 "복사"라서 대부분의 카드는 이미 대시보드에도 남아있지만,
// 사용자가 대시보드에서 ✕(빼기)로 지운 카드는 완성 창고에만 남아 화면 밖
// 캔버스만 갖고 있다 — 그런 카드는 restoreAllCards()와 같은 방식으로
// 실제 그리드에 다시 마운트한 다음 편집창을 연다.
function resumeFromArchive(card) {
  // 완성 창고에서 나온 카드는 "이미 보냈다"는 표시가 계속 남아있어서
  // [완성 목록으로 보내기] 버튼이 안 보였다 — 다시 작업을 이어가는
  // 것이므로 이 표시를 꺼서 버튼이 다시 나타나게 한다.
  card.archived = false;

  if (!state.cards.includes(card)) {
    mountCard(card);
    state.cards.push(card);
    if (card.copy) fillCard(card);
    render(card);
    applyThreadUI(card);
    if (card.favorite) {
      const favBtn = card.el.querySelector('[data-act="fav"]');
      if (favBtn) { favBtn.textContent = '★'; favBtn.classList.add('on'); }
    }
    applyCategory();
  }
  // 완성 창고에 들어와 있던 카드는 애초에 [완성 목록으로 보내기]를 눌러야만
  // 들어올 수 있었으므로 항상 완료 상태였다. 그런데도 상태 판정이 어긋나면
  // 버튼이 숨은 채로 남는 문제가 있어, 여기서는 무조건 done으로 확정하고
  // 버튼도 직접 다시 보이게 만든다(둘 다 해두면 어떤 경우에도 안전하다).
  setStatus(card, 'done');
  const archiveBtn = card.el?.querySelector('[data-role="archive"]');
  if (archiveBtn) archiveBtn.hidden = false;
  schedulePersist();
  toast('대시보드로 되돌렸습니다 — 이어서 작업하세요');
  closeArchiveView();
  openEditor(card);
}

function doneCards() {
  // "완성 목록" 다이얼로그는 이제 자동으로 done인 걸 다 보여주지 않고,
  // 사용자가 카드에서 직접 "📥 완성 목록으로 보내기"를 눌러 옮긴 것만 보여준다.
  return state.archivedCards.filter((c) => c.copy && c.status === 'done');
}

/* ── 완성 목록 ──────────────────────────────────────────
 * 변환 + 본문 작업이 끝난 사진들을 날짜순 리스트로 보여주고,
 * 체크한 것만 골라 한 번에 저장한다(폴더 하나에 사진+캡션 쌍으로). */

function batchDateStr(card) {
  const yyyy = card.createdAt.getFullYear();
  const mm = String(card.createdAt.getMonth() + 1).padStart(2, '0');
  const dd = String(card.createdAt.getDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}`;
}

function batchTitleStr(card) {
  return (card.copy?.title_lines || []).join(' ').trim() || '(제목 없음)';
}

function renderBatchList() {
  const box = $('#archive-list');
  const pager = $('#archive-pager');
  // 구글 시트처럼 "쌓인 순서 그대로" — 오래된 것부터 1번, 2번… 번호가 붙는다.
  const list = doneCards().sort((a, b) => a.createdAt - b.createdAt);

  if (!list.length) {
    box.innerHTML = '<p class="batch-empty">아직 완성 목록으로 보낸 사진이 없습니다.<br>카드 완료 후 나타나는 [📥 완성 목록으로 보내기]를 누르면 여기 모입니다.</p>';
    pager.hidden = true;
    pager.innerHTML = '';
    return;
  }

  // 12개씩 페이지로 나눈다. 삭제 등으로 목록이 줄어들어 지금 페이지가
  // 없어졌으면 마지막 페이지로 자동으로 당겨온다.
  const totalPages = Math.max(1, Math.ceil(list.length / ARCHIVE_PAGE_SIZE));
  if (archivePage > totalPages) archivePage = totalPages;
  if (archivePage < 1) archivePage = 1;

  const startIdx = (archivePage - 1) * ARCHIVE_PAGE_SIZE;
  const pageItems = list.slice(startIdx, startIdx + ARCHIVE_PAGE_SIZE);

  box.innerHTML = '';
  pageItems.forEach((card, i) => {
    const idx = startIdx + i;   // 페이지가 바뀌어도 번호는 전체 기준으로 이어진다
    const row = document.createElement('div');
    row.className = 'batch-row';
    row.innerHTML = `
      <input type="checkbox" class="batch-check" title="선택">
      <span class="batch-no">${idx + 1}</span>
      <span class="batch-date">${batchDateStr(card)}</span>
      <img class="batch-thumb" alt="">
      <span class="batch-title"></span>
      <button type="button" class="batch-view" title="다시보기">👁️</button>
      <button type="button" class="batch-save-one" title="PC로 저장">💾</button>
      <button type="button" class="batch-del" title="완성 목록에서 삭제">✕</button>
    `;

    // 썸네일 하나가 어떤 이유로든 실패해도 나머지 목록까지 같이 비어버리면 안 되므로
    // 카드 하나 처리 실패는 그 카드만 빈 썸네일로 두고 넘어간다.
    try {
      row.querySelector('.batch-thumb').src = card.canvas.toDataURL('image/png');
    } catch (err) {
      console.error('완성 목록 썸네일 만들기 실패', err);
    }

    row.querySelector('.batch-title').textContent = batchTitleStr(card);

    // 행을 클릭하면(체크박스·다른 버튼 제외) 대시보드로 되돌려 이어서 작업한다.
    row.classList.add('batch-row-clickable');
    row.title = '클릭하면 대시보드로 돌아가 이어서 작업합니다';
    row.addEventListener('click', () => resumeFromArchive(card));

    // 체크칸은 지금은 실행 동작 없이 사용자가 직접 표시해두는 용도(예: 구글시트로 옮긴 것 체크).
    const check = row.querySelector('.batch-check');
    check.checked = !!card.batchChecked;
    check.addEventListener('click', (ev) => ev.stopPropagation());
    check.addEventListener('change', () => {
      card.batchChecked = check.checked;
      schedulePersist();
    });

    row.querySelector('.batch-view').addEventListener('click', (ev) => {
      ev.stopPropagation();
      openPreview(card);
    });

    row.querySelector('.batch-save-one').addEventListener('click', (ev) => {
      ev.stopPropagation();
      openSaveDialog(card);
    });

    row.querySelector('.batch-del').addEventListener('click', (ev) => {
      ev.stopPropagation();
      state.archivedCards = state.archivedCards.filter((c) => c !== card);
      renderBatchList();
      schedulePersist();
    });

    box.appendChild(row);
  });

  renderArchivePager(totalPages);
}

// 완성 목록 페이지 번호 단추들을 그린다. 1페이지뿐이면 아예 숨긴다.
function renderArchivePager(totalPages) {
  const pager = $('#archive-pager');
  if (totalPages <= 1) {
    pager.hidden = true;
    pager.innerHTML = '';
    return;
  }
  pager.hidden = false;
  pager.innerHTML = '';

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'pager-nav';
  prev.textContent = '‹';
  prev.disabled = archivePage === 1;
  prev.addEventListener('click', () => { archivePage -= 1; renderBatchList(); });
  pager.appendChild(prev);

  for (let p = 1; p <= totalPages; p++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pager-num' + (p === archivePage ? ' on' : '');
    b.textContent = String(p);
    b.addEventListener('click', () => { archivePage = p; renderBatchList(); });
    pager.appendChild(b);
  }

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'pager-nav';
  next.textContent = '›';
  next.disabled = archivePage === totalPages;
  next.addEventListener('click', () => { archivePage += 1; renderBatchList(); });
  pager.appendChild(next);
}

// "완성 목록" 버튼을 누르면 팝업이 아니라, 카드 그리드가 있던 자리를
// 완성 창고 목록 화면으로 통째로 바꿔서 보여준다. 자료가 몇백 장이 되어도
// 화면 전체를 다 쓰기 때문에 팝업창보다 훨씬 넉넉하게 스크롤할 수 있다.
function openArchiveView() {
  archivePage = 1;   // 완성 목록을 새로 열 때는 항상 1페이지부터 보여준다
  renderBatchList();
  $('#empty').hidden = true;
  $('#cards').hidden = true;
  $('#archive-view').hidden = false;
}

function closeArchiveView() {
  $('#archive-view').hidden = true;
  $('#cards').hidden = false;
  applyCategory();   // 카드 그리드/빈 화면 표시 상태를 원래대로 되돌린다
}

function isArchiveOpen() {
  return !$('#archive-view').hidden;
}

// 완성 목록 리스트에서 "다시보기"를 누르면 그 사진을 크게 띄워준다.
// PC 저장이나 삭제와 달리 아무것도 바꾸지 않는, 그냥 보기 전용 기능이다.
function openPreview(card) {
  try {
    $('#preview-img').src = card.canvas.toDataURL('image/png');
  } catch (err) {
    console.error('다시보기 이미지 만들기 실패', err);
    return toast('사진을 불러오지 못했습니다', true);
  }
  $('#preview-title').textContent = batchTitleStr(card);
  $('#preview-dlg').showModal();
}

// CSV 안에 쉼표·줄바꿈·따옴표가 그대로 섞여 들어가면 칸이 깨지므로,
// 그런 값은 큰따옴표로 감싸고 내부 따옴표는 두 개로 이스케이프한다.
function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// 체크한 사진들만 골라 구글 시트로 바로 가져갈 수 있는 CSV 파일로 내보낸다.
// (구글 계정 로그인·API 연동 없이도, 구글 시트에서 '파일 > 가져오기'로
// 이 파일 하나만 올리면 바로 표가 채워진다.)
function exportCheckedToSheet() {
  const picked = doneCards()
    .sort((a, b) => a.createdAt - b.createdAt)
    .filter((c) => c.batchChecked);

  if (!picked.length) {
    return toast('구글 시트로 보낼 사진을 먼저 체크해주세요', true);
  }

  const rows = [['번호', '날짜', '제목', '본문', '해시태그']];
  picked.forEach((card, idx) => {
    rows.push([
      idx + 1,
      batchDateStr(card),
      batchTitleStr(card),
      card.copy?.body || '',
      (card.copy?.hashtags || []).join(' '),
    ]);
  });

  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
  // 맨 앞의 BOM(\uFEFF)이 없으면 엑셀·구글 시트에서 한글이 깨져 보인다.
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const stamp = new Date();
  const name = `완성목록_${stamp.getMonth() + 1}월${stamp.getDate()}일_`
    + `${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}.csv`;

  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  toast(`${picked.length}장을 CSV로 내보냈습니다 — 구글 시트에서 [파일 > 가져오기]로 열어주세요`);
}



/* ── 이미지 저장 ──────────────────────────────────────────
 *
 * 저장할 때 두 가지를 고른다 — 어느 카테고리 폴더에 넣을지,
 * 인스타용(4:5)인지 틱톡용(9:16)인지. 고르고 [저장]을 누르면
 * 설정에서 지정한 폴더 아래 카테고리 이름의 폴더로 들어간다.
 */

let saveTarget = null;

function openSaveDialog(card) {
  if (!card || !card.copy) return toast('먼저 변환해주세요', true);
  saveTarget = card;

  const sel = $('#save-cat');
  sel.innerHTML = CATS
    .map((c) => `<option value="${c.v}">${c.name}</option>`).join('');
  sel.value = card.category;

  $('#save-size').value = sizeSpec() ? state.saveSize : 'ig';
  $('#save-w').value = state.customW;
  $('#save-h').value = state.customH;
  syncCustomSizeRow();
  $('#save-note').textContent = '';
  $('#ai-expand').checked = state.aiExpand;
  syncAiExpandRow();
  $('#save-dlg').showModal();
}

// 직접 지정 칸은 그걸 골랐을 때만 보인다.
function syncCustomSizeRow() {
  $('#custom-size-row').hidden = $('#save-size').value !== 'custom';
}

// AI 확장 체크박스는 Gemini 키가 있고, 정해진 크기일 때만 보인다.
// '직접 지정'은 어떤 비율이 될지 모르므로 AI 확장을 쓰지 않는다 - 서버는
// 정해진 세 비율만 알고 있다. 대신 여백 없이 꽉 채워 저장한다.
function syncAiExpandRow() {
  const show = state.hasGemini && SAVE_SIZES[$('#save-size').value];
  $('#ai-expand-row').hidden = !show;
  $('#ai-expand-hint').hidden = !show || !$('#ai-expand').checked;
}

async function doSave() {
  const card = saveTarget;
  if (!card) return;

  state.saveSize = $('#save-size').value;   // 고른 크기로 그려서 보낸다
  if (state.saveSize === 'custom') {
    state.customW = Number($('#save-w').value) || 1000;
    state.customH = Number($('#save-h').value) || 1000;
    const spec = sizeSpec();               // 범위 밖 값은 여기서 잘린다
    state.customW = spec.w;
    state.customH = spec.h;
    $('#save-w').value = spec.w;
    $('#save-h').value = spec.h;
  }
  state.aiExpand = $('#ai-expand').checked;
  saveSettings();

  const btn = $('#save-go');
  btn.disabled = true;
  try {
    const useAI = state.aiExpand && state.hasGemini && SAVE_SIZES[state.saveSize];
    let canvas;
    if (useAI) {
      $('#save-note').textContent = 'AI로 사진을 확장하는 중… (몇 초~몇십 초 걸려요)';
      try {
        canvas = await expandCanvasWithAI(card);
      } catch (err) {
        console.warn('[AI 확장 실패, 기존 방식으로 대체]', err);
        toast(`AI 확장에 실패해서 여백 없이 잘라 저장했어요 (${err.message})`, true);
        canvas = plainExportCanvas(card);
      }
    } else {
      canvas = plainExportCanvas(card);
    }

    const title = (card.copy.title_lines || []).join(' ').trim();
    const filename = `${safeFileName(title)}.png`;
    await downloadCanvasAsFile(canvas, filename);
    $('#save-note').textContent = '내 PC 다운로드 폴더에 저장했습니다.';
    toast('다운로드 폴더에 저장했습니다');
  } catch (err) {
    $('#save-note').textContent = err.message;
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
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



/* ── UI 동기화 ─────────────────────────────────────────── */

const MODE_HINT = {
  off: '사진을 건드리지 않습니다. 영어는 덮어서 가립니다. 비용이 들지 않습니다.',
  erase: '사진에 박힌 영어를 지우고 그 자리를 주변에 맞게 채웁니다.',
  recreate: '주인공(사람·동물·사물)은 그대로 두고 주위 배경만 새로 만듭니다. '
          + '영어 글자는 먼저 지우므로 남지 않습니다.',
};

/* 고를 수 있는 글꼴. PC 에 깔려 있는 것만 실제로 보인다.
   없는 글꼴을 고르면 기본 글꼴로 나오므로 망가지지는 않는다. */
const FONTS = [
  ['', '기본 (Pretendard·맑은 고딕)'],
  ['Malgun Gothic', '맑은 고딕'],
  ['맑은 고딕', '맑은 고딕 (한글 이름)'],
  ['NanumGothic', '나눔고딕'],
  ['나눔스퀘어', '나눔스퀘어'],
  ['NanumMyeongjo', '나눔명조'],
  ['HY헤드라인M', 'HY헤드라인M'],
  ['HYGothic-Extra', 'HY견고딕'],
  ['Batang', '바탕'],
  ['Gulim', '굴림'],
  ['Dotum', '돋움'],
  ['Gungsuh', '궁서'],
  ['Black Han Sans', '검은고딕 (설치 시)'],
  ['BM JUA_TTF', '배달의민족 주아 (설치 시)'],
];

/* 내 PC 글꼴 — 새로 추가한 기능. 기존 목록은 건드리지 않는다.

   글꼴을 늘리려면 코드의 FONTS 목록을 고쳐야 했다. 사용자가 글꼴을
   받아 설치해도 대시보드에는 안 보인다는 뜻이다. 브라우저에게 PC에
   깔린 글꼴을 물어보고, 그 결과를 목록에 얹는다. */
const MY_FONTS_KEY = 'hooking-my-fonts';

function loadMyFonts() {
  try {
    const raw = JSON.parse(localStorage.getItem(MY_FONTS_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveMyFonts(list) {
  try {
    localStorage.setItem(MY_FONTS_KEY, JSON.stringify(list));
  } catch { /* 저장 못 해도 이번 판에서는 쓸 수 있다 */ }
}

let myFonts = [];

function fillFontPicks() {
  const rows = [...FONTS];
  if (myFonts.length) {
    // 내가 넣은 글꼴은 아래에 따로 모아 둔다. 어느 것이 원래 있던
    // 것이고 어느 것이 내가 넣은 것인지 구분이 돼야 한다.
    rows.push(['', '── 내 PC 글꼴 ──']);
    myFonts.forEach((f) => rows.push([f, f]));
  }
  const html = rows
    .map(([v, name]) => `<option value="${v}">${name}</option>`).join('');
  ['#body-font', '#head-font', '#ed-body-font', '#ed-head-font', '#logo-font']
    .forEach((id) => { const el = $(id); if (el) el.innerHTML = html; });
}

function addMyFonts(names) {
  const have = new Set(myFonts);
  const known = new Set(FONTS.map(([v]) => v));
  let added = 0;
  names.forEach((raw) => {
    const name = String(raw || '').trim();
    if (!name || have.has(name) || known.has(name)) return;
    have.add(name);
    myFonts.push(name);
    added += 1;
  });
  if (!added) return 0;
  myFonts.sort((a, b) => a.localeCompare(b, 'ko'));
  saveMyFonts(myFonts);
  fillFontPicks();
  syncStyleUI();          // 고르고 있던 값이 지워지지 않게 다시 칠한다
  return added;
}

async function scanLocalFonts() {
  if (!window.queryLocalFonts) {
    return toast('이 브라우저는 PC 글꼴을 못 읽습니다. 크롬이나 엣지에서 '
               + '열거나, 글꼴 이름을 직접 넣어주세요.', true);
  }
  try {
    const got = await window.queryLocalFonts();
    const n = addMyFonts(got.map((f) => f.family));
    toast(n ? `PC 글꼴 ${n}개를 목록에 넣었습니다.`
            : '새로 넣을 글꼴이 없습니다 (이미 다 들어와 있습니다).');
  } catch (err) {
    // 권한을 거절했거나 브라우저가 막은 경우다.
    toast(`글꼴을 읽지 못했습니다 — ${err.message}. 이름을 직접 넣어보세요.`, true);
  }
}

/* 같은 값을 왼쪽 패널과 편집창 두 군데서 만진다. 한 곳에서 바꾸면
   다른 곳도 따라와야 한다. 그래서 값은 state 한 곳에만 두고,
   화면은 이 함수가 state 를 보고 다시 칠한다. */
function syncStyleUI() {
  const set = (id, v) => { const el = $(id); if (el) el.value = v; };
  const out = (id, v) => { const el = $(id); if (el) el.textContent = `${v}%`; };
  const seg = (id, v) => {
    const box = $(id);
    if (box) box.querySelectorAll('button[data-v]')
      .forEach((b) => b.classList.toggle('on', b.dataset.v === String(v)));
  };

  // 편집창 값은 지금 편집 중인 카드 것을 보여준다. 없으면 기본값.
  const mine = (k) => (editing && editing.style && editing.style[k] !== undefined
    ? editing.style[k] : state[k]);

  set('#text-size', state.textSize);      out('#text-size-out', state.textSize);
  set('#head-size', state.headSize);      out('#head-size-out', state.headSize);
  set('#ed-head-size', mine('headSize')); out('#ed-head-size-out', mine('headSize'));

  set('#body-font', state.bodyFont);
  set('#head-font', state.headFont);   set('#ed-head-font', mine('headFont'));
  set('#body-color', state.bodyColor);
  set('#head-color', state.headColor); set('#ed-head-color', mine('headColor'));
  set('#ed-line-gap', mine('lineGap'));
  const lg = $('#ed-line-gap-out');
  if (lg) lg.textContent = `${mine('lineGap')}%`;

  seg('#ed-stroke', mine('strokeColor'));
  set('#ed-stroke-size', mine('strokeSize'));
  const so = $('#ed-stroke-size-out');
  if (so) so.textContent = mine('strokeSize');
  const swr = $('#ed-stroke-w-row');
  if (swr) swr.hidden = !(mine('strokeColor') && mine('strokeColor') !== 'none');

  seg('#body-weight', state.bodyWeight);
  seg('#head-weight', state.headWeight);  set('#ed-head-weight', mine('headWeight'));

  // 본문(ed-body-*) 칸은 "적용 줄" 선택에 따라 값이 달라지므로 따로 채운다.
  syncBodyLineUI();
}

/* ── 편집창 안, 본문 "줄 단위" / "단어 단위" 스타일 ─────────────────
 *
 * 왼쪽 패널의 크기·글꼴·색은 모든 카드·모든 줄에 공통으로 적용되는 값이다.
 * 편집창에서 "적용 줄"을 특정 줄로 선택하면, 그때부터 크기·글꼴·색 칸은
 * 그 카드의 그 줄에만 적용되는 값을 읽고 쓴다. "전체"로 두면 원래처럼
 * 공통값을 건드린다.
 *
 * 거기서 한 단계 더 들어가서, 본문 칸에서 글자를 드래그로 선택하고
 * "선택한 글자만 다르게"를 누르면 그 순간부터는 그 단어(들)에만 적용된다.
 * 우선순위는 단어 > 줄 > 공통값이다. */

let lineSel = 'all';   // 'all' | '0' | '1' | '2' ...
let wordSel = null;    // { origin, wordIndices, label } | null — 선택된 단어

const LINE_KEYMAP = { size: 'textSize', font: 'bodyFont', color: 'bodyColor', weight: 'bodyWeight' };

/* 카드마다 따로 갖는 글자 모양.

   원래는 크기·글꼴·색·줄간격이 프로그램 전체 설정 하나뿐이었다. 그래서
   한 카드를 편집하면 다른 카드들까지 같이 바뀌었다. 카드가 제 값을
   가지면 그 카드만 바뀐다.

   찾는 순서: 단어 강조 > 줄 스타일 > 이 카드 > 전체 기본값 */
function cardStyle(card, key) {
  const v = card && card.style ? card.style[key] : undefined;
  return v !== undefined ? v : state[LINE_KEYMAP[key] || key];
}

function bodyLineValue(key) {
  if (wordSel && editing) {
    const wordOv = editing.wordStyle?.[wordSel.origin]?.[wordSel.wordIndices[0]] || {};
    if (wordOv[key] !== undefined) return wordOv[key];
    const lineOv = editing.lineStyle?.[wordSel.origin] || {};
    return lineOv[key] !== undefined ? lineOv[key] : cardStyle(editing, key);
  }
  const ov = (lineSel !== 'all' && editing?.lineStyle?.[lineSel]) || {};
  return ov[key] !== undefined ? ov[key] : cardStyle(editing, key);
}

function setBodyStyle(key, value) {
  if (wordSel && editing) {
    editing.wordStyle ||= {};
    editing.wordStyle[wordSel.origin] ||= {};
    wordSel.wordIndices.forEach((idx) => {
      editing.wordStyle[wordSel.origin][idx] ||= {};
      editing.wordStyle[wordSel.origin][idx][key] = value;
    });
    render(editing);
    return;
  }
  if (lineSel === 'all') {
    // '전체'는 '이 카드의 모든 줄'이라는 뜻이다. 다른 카드까지 바뀌면
    // 한 장을 손보다 나머지 장을 전부 망친다.
    if (editing) {
      editing.style ||= {};
      editing.style[key] = value;
      syncStyleUI();
      render(editing);
      schedulePersist();
    } else {
      setStyle(LINE_KEYMAP[key], value);
    }
    return;
  }
  editing.lineStyle ||= {};
  editing.lineStyle[lineSel] ||= {};
  editing.lineStyle[lineSel][key] = value;
  render(editing);
}

// 본문(textarea)에서 지금 드래그로 선택된 글자가 어느 줄의 몇 번째
// 단어(들)에 해당하는지 찾아낸다. 줄을 넘나드는 선택은 지원하지 않는다
// (한 줄 안에서만 강조 가능).
function getBodySelectionWords() {
  const ta = $('#ed-body');
  if (!ta || !editing) return null;
  const { selectionStart: s, selectionEnd: e } = ta;
  if (s === e) return null;

  const text = ta.value;
  const rawLines = text.split('\n');
  let offset = 0;
  let origin = -1;

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const lineStart = offset;
    const lineEnd = offset + raw.length;
    const isContent = !!raw.trim();
    if (isContent) origin++;

    if (s >= lineStart && s <= lineEnd) {
      if (!isContent) return null;
      const localStart = s - lineStart;
      const localEnd = Math.min(e, lineEnd) - lineStart;
      const words = raw.trim().split(/\s+/).filter(Boolean);
      const hitIdx = [];
      let pos = 0;
      words.forEach((wd, idx) => {
        const wStart = raw.indexOf(wd, pos);
        const wEnd = wStart + wd.length;
        pos = wEnd;
        if (wStart < localEnd && wEnd > localStart) hitIdx.push(idx);
      });
      return hitIdx.length ? { origin, wordIndices: hitIdx, label: words.filter((_, i2) => hitIdx.includes(i2)).join(' ') } : null;
    }
    offset = lineEnd + 1;
  }
  return null;
}

function syncBodyLineUI() {
  const size = $('#ed-body-size');
  const sizeOut = $('#ed-body-size-out');
  const font = $('#ed-body-font');
  const color = $('#ed-body-color');
  const weight = $('#ed-body-weight');
  if (size) size.value = bodyLineValue('size');
  if (sizeOut) sizeOut.textContent = `${bodyLineValue('size')}%`;
  if (font) font.value = bodyLineValue('font');
  if (color) color.value = bodyLineValue('color');
  if (weight) weight.value = bodyLineValue('weight');

  const status = $('#ed-word-status');
  const clearBtn = $('#ed-word-clear');
  if (status) {
    status.hidden = !wordSel;
    if (wordSel) status.textContent = `"${wordSel.label}" 강조 중 — 아래 크기·글꼴·색이 이 글자에만 적용됩니다`;
  }
  if (clearBtn) clearBtn.hidden = !wordSel;
}

// 편집창을 열 때, 본문 글이 바뀌어 줄 수가 바뀔 때마다 다시 그린다.
function renderLineSelUI() {
  const box = $('#ed-line-sel');
  const resetBtn = $('#ed-line-reset');
  const hint = $('#ed-line-hint');
  if (!box || !editing) return;

  const n = (editing.copy?.title_lines || []).length;
  if (lineSel !== 'all' && Number(lineSel) >= n) lineSel = 'all';   // 줄이 사라졌으면 전체로

  const opts = [['all', '전체']];
  for (let i = 0; i < n; i++) opts.push([String(i), `${i + 1}줄`]);

  box.innerHTML = opts.map(([v, label]) =>
    `<button type="button" data-v="${v}" class="${v === lineSel ? 'on' : ''}">${label}</button>`,
  ).join('');
  box.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      lineSel = b.dataset.v;
      wordSel = null;          // 줄 선택으로 돌아오면 단어 강조 모드는 해제
      renderLineSelUI();
      syncBodyLineUI();
    });
  });

  if (resetBtn) resetBtn.hidden = (lineSel === 'all');
  if (hint) {
    if (lineSel === 'all') {
      hint.hidden = true;
    } else {
      hint.hidden = false;
      hint.textContent = '이 줄만 아래 크기·글꼴·색이 다르게 적용됩니다.';
    }
  }
}

// 값 하나를 바꾸고, 두 화면을 맞추고, 모든 카드를 다시 그린다.
/* 편집창에서 만지는 값은 그 카드에만 넣는다. 편집창을 안 열고 왼쪽
   패널에서 만졌다면 갈 데가 없으므로 전체 기본값으로 넣는다. */
function setCardOrGlobal(key, value) {
  if (editing) {
    editing.style ||= {};
    editing.style[key] = value;
    syncStyleUI();          // 옆에 붙은 숫자 표시를 따라오게 한다
    render(editing);
    schedulePersist();
    return;
  }
  state[key] = value;
  saveSettings();
  renderAll();
}

function setStyle(key, value) {
  state[key] = value;
  syncStyleUI();
  saveSettings();
  renderAll();
}

const MODE_LABEL = {
  off: '사진 그대로',
  erase: '글자만 지우기',
  recreate: '사진 새로 만들기',
};

/* 칩 두 줄을 CATS 표에서 만든다. 목록을 HTML 에 또 적어두면
   한쪽만 고쳤을 때 조용히 어긋난다. */
function buildChips(id) {
  const box = $(id);
  box.innerHTML = '';
  CATS.forEach((cat) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.v = cat.v;
    b.style.setProperty('--c', cat.c);

    const name = document.createElement('span');
    name.textContent = cat.name;
    const n = document.createElement('b');
    n.className = 'n';
    n.hidden = true;

    b.append(name, n);
    box.appendChild(b);
  });

  box.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-v]');
    if (btn) pickCategory(btn.dataset.v);
  });
}

function pickCategory(v) {
  if (isArchiveOpen()) closeArchiveView();
  if (state.category === v && !state.viewFavorites) return;
  state.category = v;
  state.viewFavorites = false;
  const favBtn = $('#fav-view');
  if (favBtn) favBtn.classList.remove('on');
  saveSettings();
  applyCategory();
}

// 고른 사진만 돌린다. 아무것도 안 골랐으면 예전처럼 전부 돈다 —
// 한 장씩 고르는 게 규칙이 되면 20장 돌릴 때 손이 너무 많이 간다.
function togglePick(card) {
  card.picked = !card.picked;
  paintPick(card);
  syncUI();
}

function paintPick(card) {
  const btn = card.el?.querySelector('[data-act="pick"]');
  if (btn) btn.classList.toggle('on', !!card.picked);
  card.el?.classList.toggle('picked', !!card.picked);
}

function pickedInCategory() {
  return inCategory().filter((c) => c.picked);
}

function clearPicks() {
  state.cards.forEach((c) => {
    if (!c.picked) return;
    c.picked = false;
    paintPick(c);
  });
  syncUI();
}

function inCategory() {
  if (state.viewFavorites) return state.cards.filter((c) => c.favorite);
  return state.cards.filter((c) => c.category === state.category);
}

// 고른 항목을 화면 전체에 반영한다. 칩 두 줄, 장수, 카드 보이기까지.
function applyCategory() {
  const count = {};
  state.cards.forEach((c) => { count[c.category] = (count[c.category] || 0) + 1; });

  ['#category', '#category-side'].forEach((id) => {
    const box = $(id);
    if (!box) return;
    box.querySelectorAll('button[data-v]').forEach((b) => {
      b.classList.toggle('on', !state.viewFavorites && b.dataset.v === state.category);
      const n = b.querySelector('.n');
      const v = count[b.dataset.v] || 0;
      n.hidden = v === 0;
      n.textContent = v;
    });
  });

  const favCount = state.cards.filter((c) => c.favorite).length;
  const favBadge = document.querySelector('#fav-view .n');
  if (favBadge) {
    favBadge.hidden = favCount === 0;
    favBadge.textContent = favCount;
  }

  state.cards.forEach((c) => {
    if (c.el) c.el.hidden = state.viewFavorites ? !c.favorite : c.category !== state.category;
  });

  updateSortOrder();
  syncUI();
}

// "최신순" 토글이 켜져 있으면 최근 작업한 것부터 보이게 시각적으로만
// 순서를 바꾼다. 실제 state.cards 배열이나 DOM 위치는 안 건드리고
// CSS grid 의 order 값만 바꾼다.
function updateSortOrder() {
  const cards = inCategory();
  const sorted = state.sortRecent
    ? [...cards].sort((a, b) => b.createdAt - a.createdAt)
    : cards;
  sorted.forEach((c, i) => {
    if (c.el) c.el.style.order = i;
  });
}

function syncUI() {
  // 배경 지시는 '사진 새로 만들기'에서만 쓰인다. 다른 모드에선 숨겨서
  // 적어놓고 왜 안 먹느냐는 오해를 없앤다.
  const bgBox = $('#bg-group');
  if (bgBox) bgBox.hidden = !state.hasGemini || state.photoMode !== 'recreate';

  const here = inCategory();
  const cat = catOf(state.category);
  const elsewhere = state.cards.length - here.length;

  $('#empty').hidden = here.length > 0;
  $('#run').disabled = !here.length || state.running || state.viewFavorites;

  if (state.viewFavorites) {
    // 지금 넣으면 어디로 담기는지 빈 화면에서도 알아야 한다.
    $('#empty-sub').textContent = '★ 버튼을 누른 이미지가 여기 모입니다.';
  } else {
    // 지금 넣으면 어디로 담기는지 빈 화면에서도 알아야 한다.
    $('#empty-sub').textContent = elsewhere
      ? `지금 넣으면 「${cat.name}」에 담깁니다. 다른 항목에 ${elsewhere}장 있습니다.`
      : `지금 넣으면 「${cat.name}」에 담깁니다.`;
  }

  // 무엇이 돌아갈지 버튼에 적는다. 고른 것과 도는 것이 어긋나면 안 된다.
  const picked = here.filter((c) => c.picked).length;
  const what = state.hasGemini ? MODE_LABEL[state.photoMode] : null;
  const head = picked ? `선택한 ${picked}장 변환` : '이미지 변환';
  $('#run').textContent = state.running
    ? '변환 중…'
    : (what ? `${head} — ${what}` : head);

  // 고른 게 있을 때만 해제 단추를 보여준다.
  const chip = $('#pick-clear');
  if (chip) {
    chip.hidden = !picked;
    chip.textContent = `✓ ${picked}장 선택 · 해제`;
  }
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
  mark('#logo-mode', state.logoMode);
  // 이 함수 안에는 set() 이 없다. 값 넣기는 직접 한다.
  const put = (id, v) => { const el = $(id); if (el) el.value = v; };
  put('#logo-text', state.logoText || '');
  put('#logo-font', state.logoFont);
  put('#logo-color', state.logoColor);
  put('#logo-alpha', state.logoAlpha);
  const la = $('#logo-alpha-out');
  if (la) la.textContent = `${state.logoAlpha}%`;
  syncLogoBoxes();
  syncStyleUI();
  $('#logo-size').value = state.logoSize;
  $('#logo-size-out').textContent = `${state.logoSize}%`;
  $('#auto-crop').checked = state.autoCrop;
  $('#mode-hint').textContent = MODE_HINT[state.photoMode] || '';

  if (saved.lang) $('#lang').value = saved.lang;
  if (saved.guide) $('#guide').value = saved.guide;
  if (saved.bgNote) $('#bg-note').value = saved.bgNote;
  if (saved.styleSample) $('#style-sample').value = saved.styleSample;
}

function bindSegment(id, onPick) {
  const box = $(id);
  if (!box) return;      // 화면에서 뺀 항목이면 그냥 넘어간다
  box.addEventListener('click', (ev) => {
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
  $('#pick-plain').addEventListener('change', (e) => {
    addFiles(e.target.files, true);
    e.target.value = '';
  });
  $('#pick-folder').addEventListener('change', (e) => {
    addFiles(e.target.files); e.target.value = '';
  });
  $('#pick-clear').addEventListener('click', clearPicks);

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
    syncLogoBoxes();
    renderAll();
  });
  $('#logo-clear').addEventListener('click', () => {
    // 지금 쓰고 있는 쪽만 지운다. 이미지를 쓰다 글자로 바꿨는데 이미지가
    // 같이 지워지면 되돌릴 수가 없다.
    if (state.logoMode === 'text') {
      state.logoText = '';
      $('#logo-text').value = '';
    } else {
      state.logo = null;
      $('#logo-file').value = '';
      $('#logo-label').textContent = '로고 이미지 업로드';
    }
    saveSettings();
    syncLogoBoxes();
    renderAll();
  });
  $('#ed-logo').addEventListener('click', () => {
    syncStyleUI();          // 지금 값이 창에 그대로 보이게
    $('#logo-dlg').showModal();
  });

  bindSegment('#logo-mode', (v) => {
    state.logoMode = v;
    saveSettings();
    syncLogoBoxes();
    renderAll();
  });
  $('#logo-text').addEventListener('input', (e) => {
    state.logoText = e.target.value;
    saveSettings();
    syncLogoBoxes();
    renderAll();
  });
  $('#logo-font').addEventListener('change', (e) => {
    state.logoFont = e.target.value; saveSettings(); renderAll();
  });
  $('#logo-color').addEventListener('input', (e) => {
    state.logoColor = e.target.value; saveSettings(); renderAll();
  });
  $('#logo-alpha').addEventListener('input', (e) => {
    state.logoAlpha = +e.target.value;
    $('#logo-alpha-out').textContent = `${e.target.value}%`;
    saveSettings();
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
      if (card.img) card.crop = cropFor(card.img, card);
    });
    renderAll();
  });

  // 글자 — 본문
  bindSegment('#text-pos', (v) => {
    state.textPos = v;
    // 위치 단추를 누르면 끌어 옮겨 둔 자리는 버린다. 안 그러면 눌러도 안 움직인다.
    state.cards.forEach((c) => { c.posBody = null; });
    saveSettings();
    renderAll();
  });
  // 크기·글꼴·색·굵기는 왼쪽 패널과 편집창 두 군데에 같은 것이 있다.
  // 두 곳이 미치는 범위는 다르다.
  //   왼쪽 패널 = 앞으로 만들 카드까지 포함한 전체 기본값
  //   편집창    = 지금 열어 놓은 그 카드 한 장
  // 편집창이 전체를 바꾸면, 한 장을 손보다가 대시보드의 나머지 장을
  // 전부 망친다.
  const bindStyle = (id, key, kind, apply) => {
    const el = $(id);
    if (!el) return;
    ['input', 'change'].forEach((evName) =>
      el.addEventListener(evName, (e) =>
        apply(key, kind === 'num' ? +e.target.value : e.target.value)));
  };

  [['#text-size',  'textSize',  'num'],
   ['#head-size',  'headSize',  'num'],
   ['#body-font',  'bodyFont',  'text'],
   ['#head-font',  'headFont',  'text'],
   ['#body-color', 'bodyColor', 'text'],
   ['#head-color', 'headColor', 'text'],
  ].forEach(([id, key, kind]) => bindStyle(id, key, kind, setStyle));

  [['#ed-head-size',   'headSize',   'num'],
   ['#ed-head-font',   'headFont',   'text'],
   ['#ed-head-color',  'headColor',  'text'],
   ['#ed-head-weight', 'headWeight', 'num'],
  ].forEach(([id, key, kind]) => bindStyle(id, key, kind, setCardOrGlobal));
  $('#ed-line-gap').addEventListener('input', (e) => {
    $('#ed-line-gap-out').textContent = `${e.target.value}%`;
    setCardOrGlobal('lineGap', +e.target.value);
  });

  bindSegment('#ed-stroke', (v) => {
    setCardOrGlobal('strokeColor', v);
    syncStyleUI();          // 두께 칸을 켜고 끈다
  });
  $('#ed-stroke-size').addEventListener('input', (e) => {
    $('#ed-stroke-size-out').textContent = e.target.value;
    setCardOrGlobal('strokeSize', +e.target.value);
  });

  bindSegment('#body-weight', (v) => setStyle('bodyWeight', +v));
  bindSegment('#head-weight', (v) => setStyle('headWeight', +v));

  // 편집창의 본문 크기·글꼴·색·굵기 — "적용 줄"이 전체면 공통값을,
  // 특정 줄이면 그 카드의 그 줄에만 적용되는 값을 바꾼다.
  $('#ed-body-size').addEventListener('input', (e) => {
    setBodyStyle('size', +e.target.value);
    $('#ed-body-size-out').textContent = `${e.target.value}%`;
  });
  $('#ed-body-font').addEventListener('change', (e) => setBodyStyle('font', e.target.value));
  $('#ed-body-color').addEventListener('input', (e) => setBodyStyle('color', e.target.value));
  $('#ed-body-weight').addEventListener('change', (e) => setBodyStyle('weight', +e.target.value));
  $('#ed-line-reset').addEventListener('click', () => {
    if (!editing || lineSel === 'all') return;
    if (editing.lineStyle) delete editing.lineStyle[lineSel];
    syncBodyLineUI();
    render(editing);
    toast('이 줄을 기본값으로 되돌렸습니다');
  });

  $('#ed-word-mark').addEventListener('click', () => {
    if (!editing) return;
    const sel = getBodySelectionWords();
    if (!sel) {
      toast('본문 칸에서 강조할 글자를 먼저 드래그해서 선택해주세요');
      return;
    }
    wordSel = sel;
    lineSel = 'all';           // 화면 혼동을 막기 위해 줄 선택은 전체로 되돌림
    renderLineSelUI();
    syncBodyLineUI();
  });

  $('#ed-word-clear').addEventListener('click', () => {
    if (!editing || !wordSel) return;
    const bucket = editing.wordStyle?.[wordSel.origin];
    if (bucket) wordSel.wordIndices.forEach((idx) => delete bucket[idx]);
    wordSel = null;
    syncBodyLineUI();
    render(editing);
    toast('강조를 없앴습니다');
  });


  // 큰 편집창
  $('#ed-close').addEventListener('click', () => $('#editor').close());
  $('#editor').addEventListener('close', () => {
    const pop = $('#title-popover');
    if (pop) pop.hidden = true;
    closeEditor();
  });

  /* 제목 칸은 자주 쓰지 않는데 자리를 많이 차지해서, 접어 두었다가
     단추를 누를 때만 편다. 바깥을 누르면 닫힌다. */
  const titlePop = $('#title-popover');
  if (titlePop) {
    $('#ed-title-pop-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      titlePop.hidden = !titlePop.hidden;
    });
    $('#title-pop-close').addEventListener('click', () => { titlePop.hidden = true; });
    document.addEventListener('click', (e) => {
      if (titlePop.hidden) return;
      if (titlePop.contains(e.target) || e.target.closest('#ed-title-pop-btn')) return;
      titlePop.hidden = true;
    });
  }
  $('#ed-head-on').addEventListener('change', (e) => {
    if (!editing) return;
    editing.headOn = e.target.checked;
    $('#ed-head').disabled = !e.target.checked;
    if (e.target.checked && !editing.headText) $('#ed-head').focus();
    render(editing);
  });
  $('#ed-head').addEventListener('input', (e) => {
    if (!editing) return;
    editing.headText = e.target.value;
    render(editing);
  });
  $('#ed-body').addEventListener('input', (e) => {
    if (!editing) return;
    applyTitle(editing, e.target.value);
    wordSel = null;
    renderLineSelUI();
    syncBodyLineUI();
  });
  $('#ed-reset-pos').addEventListener('click', () => {
    if (!editing) return;
    editing.posHead = null;
    editing.posBody = null;
    render(editing);
    toast('글자를 처음 자리로 되돌렸습니다');
  });
  $('#ed-reset-text').addEventListener('click', () => {
    if (editing) resetTitle(editing);
  });

  // 사진 자르기(위/아래) — 슬라이더를 만지면 자동 감지 대신 이 값을 쓴다.

  // 편집 중인 카드는 지금 card.canvas 가 큰 편집창(ed-canvas) 쪽을
  // 가리키고 있다. 큰 창만 다시 그리면 대시보드의 작은 사진은 옛날
  // 모습 그대로 남는다. 둘 다 그려준다.
  function renderBoth(card) {
    render(card);
    if (card === editing && card.smallCanvas) {
      const bigCanvas = card.canvas;
      card.canvas = card.smallCanvas;
      render(card);
      card.canvas = bigCanvas;
    }
  }

  function applyManualCrop(card, top, bottom) {
    card.manualCrop = { top, bottom };
    card.crop = cropFor(card.img, card);
    renderBoth(card);
    schedulePersist();
  }
  $('#ed-crop-top').addEventListener('input', (e) => {
    if (!editing) return;
    const top = +e.target.value;
    $('#ed-crop-top-out').textContent = `${top}%`;
    applyManualCrop(editing, top, editing.manualCrop?.bottom || 0);
  });
  $('#ed-crop-bottom').addEventListener('input', (e) => {
    if (!editing) return;
    const bottom = +e.target.value;
    $('#ed-crop-bottom-out').textContent = `${bottom}%`;
    applyManualCrop(editing, editing.manualCrop?.top || 0, bottom);
  });
  $('#ed-crop-reset').addEventListener('click', () => {
    if (!editing) return;
    editing.manualCrop = null;
    editing.crop = cropFor(editing.img, editing);
    $('#ed-crop-top').value = 0;
    $('#ed-crop-top-out').textContent = '0%';
    $('#ed-crop-bottom').value = 0;
    $('#ed-crop-bottom-out').textContent = '0%';
    renderBoth(editing);
    schedulePersist();
    toast('자동 잘라내기로 되돌렸습니다');
  });
  $('#ed-crop-apply-all').addEventListener('click', () => {
    if (!editing) return;
    const top = +$('#ed-crop-top').value;
    const bottom = +$('#ed-crop-bottom').value;
    const byId = new Map();
    [...state.cards, ...state.archivedCards].forEach((c) => byId.set(c.id, c));
    byId.forEach((card) => {
      if (!card.img) return;
      applyManualCrop(card, top, bottom);
    });
    toast('모든 카드를 같은 비율로 통일했습니다');
  });

  $('#ed-save').addEventListener('click', () => {
    if (!editing) return;
    openSaveDialog(editing);
  });
  bindDrag(() => editing, $('#ed-canvas'));

  // 실행 · 저장
  $('#run').addEventListener('click', runAll);

  // 로고·저장은 위쪽 줄의 단추로 연다. 왼쪽 패널을 끝까지 내리지 않아도 된다.
  $('#btn-logo').addEventListener('click', () => $('#logo-dlg').showModal());
  $('#logo-close').addEventListener('click', () => $('#logo-dlg').close());

  $('#btn-batch').addEventListener('click', openArchiveView);
  $('#archive-back').addEventListener('click', closeArchiveView);
  $('#archive-export-sheet').addEventListener('click', exportCheckedToSheet);
  $('#body-edit-close').addEventListener('click', closeBodyEditor);
  $('#body-edit-dlg').addEventListener('close', () => { bodyEditing = null; });
  $('#body-edit-save').addEventListener('click', saveBodyEditor);
  $('#preview-close').addEventListener('click', () => $('#preview-dlg').close());
  $('#save-close').addEventListener('click', () => $('#save-dlg').close());
  $('#save-go').addEventListener('click', doSave);
  $('#save-size').addEventListener('change', () => {
    syncCustomSizeRow();
    syncAiExpandRow();
  });
  $('#ai-expand').addEventListener('change', syncAiExpandRow);
  $('#open-output2').addEventListener('click', () => api('/api/open-output'));

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
  ['#lang', '#guide', '#style-sample', '#bg-note'].forEach((sel) =>
    $(sel).addEventListener('change', saveSettings));
  $('#open-output').addEventListener('click', () => api('/api/open-output'));

  buildChips('#category');
  mountFavChip();
  myFonts = loadMyFonts();
  fillFontPicks();
  $('#font-scan').addEventListener('click', scanLocalFonts);
  applySettings(loadSettings());
  initStyles();
  applyCategory();
  loadConfig();
  restoreAllCards();   // 작업 중이던 카드 + 완성 창고를 브라우저 저장소에서 되살린다
  startThreadPolling();   // 북마크릿으로 들어온 게 있는지 몇 초마다 확인
  syncUI();
}

// "즐겨찾기" 전용 필터. CATS 목록에는 없는 특수 항목이라 buildChips 와
// 별도로 만든다. 실제 카테고리가 아니므로 새로 넣는 사진은 여기 담기지
// 않고, 별표(★)를 누른 사진만 모아서 보여준다.
function mountFavChip() {
  const b = document.createElement('button');
  b.type = 'button';
  b.id = 'fav-view';
  b.className = 'chip fav-chip';
  b.style.setProperty('--c', '#ffc736');

  const name = document.createElement('span');
  name.textContent = '★ 즐겨찾기';

  const n = document.createElement('b');
  n.className = 'n';
  n.hidden = true;

  b.append(name, n);
  $('#category').appendChild(b);

  b.addEventListener('click', () => {
    if (isArchiveOpen()) closeArchiveView();
    state.viewFavorites = !state.viewFavorites;
    b.classList.toggle('on', state.viewFavorites);
    applyCategory();
  });
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
  syncUI();   // 배경 지시 칸 등 Gemini 여부에 따라 달라지는 것들
}

init();

/* "최신순" 정렬 토글 — 새로 추가한 기능. 기존 코드는 건드리지 않음. */
state.sortRecent = false;
$('#sort-recent').addEventListener('click', () => {
  state.sortRecent = !state.sortRecent;
  $('#sort-recent').classList.toggle('on', state.sortRecent);
  updateSortOrder();
});

/* 접이식(아코디언) 섹션 — 새로 추가한 기능. 기존 코드는 건드리지 않음.
   .collapsible 클래스가 붙은 section 은 처음엔 접혀 있다가,
   제목(h2)을 클릭하면 펼쳐진다. */
document.querySelectorAll('.collapsible > h2').forEach((h) => {
  h.addEventListener('click', () => {
    h.parentElement.classList.toggle('open');
  });
});

/* 카드 순서 바꾸기(끌어놓기) — 새로 추가한 기능. 기존 코드는 건드리지 않음.

   사진 위에는 이미 '글자 끌기'가 붙어 있다. 그래서 사진을 잡아 끄는 방식으로
   만들면 제목을 옮기려다 카드가 움직인다. 전용 손잡이(⠿)에서만 시작한다.

   실제로 state.cards 배열의 순서를 바꾼다. 저장도 이 순서를 따르므로
   프로그램을 껐다 켜도 내가 놓은 자리가 그대로 남는다. */
(function enableCardReorder() {
  const box = $('#cards');
  if (!box) return;
  let dragging = null;

  const cardOf = (el) => {
    const art = el && el.closest ? el.closest('.card') : null;
    return art ? state.cards.find((c) => c.el === art) : null;
  };

  const clearMarks = () => {
    box.querySelectorAll('.drop-before, .drop-after').forEach((el) =>
      el.classList.remove('drop-before', 'drop-after'));
  };

  const endDrag = () => {
    clearMarks();
    if (dragging && dragging.el) dragging.el.classList.remove('card-dragging');
    dragging = null;
  };

  // 마우스가 카드의 왼쪽 절반에 있으면 그 앞, 오른쪽 절반이면 그 뒤에 꽂는다.
  const dropsBefore = (over, x) => {
    const r = over.el.getBoundingClientRect();
    return x < r.left + r.width / 2;
  };

  box.addEventListener('dragstart', (e) => {
    if (!e.target.classList || !e.target.classList.contains('grip')) return;
    const card = cardOf(e.target);
    if (!card) return;
    dragging = card;
    card.el.classList.add('card-dragging');
    e.dataTransfer.effectAllowed = 'move';
    // 값이 없으면 일부 브라우저에서 끌기가 아예 시작되지 않는다.
    e.dataTransfer.setData('text/plain', String(card.id));
  });

  box.addEventListener('dragover', (e) => {
    if (!dragging) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const over = cardOf(e.target);
    clearMarks();
    if (!over || over === dragging) return;
    over.el.classList.add(dropsBefore(over, e.clientX) ? 'drop-before' : 'drop-after');
  });

  box.addEventListener('drop', (e) => {
    if (!dragging) return;
    e.preventDefault();
    const over = cardOf(e.target);
    const moved = dragging;
    clearMarks();
    if (over && over !== moved) {
      const before = dropsBefore(over, e.clientX);
      state.cards.splice(state.cards.indexOf(moved), 1);
      const at = state.cards.indexOf(over) + (before ? 0 : 1);
      state.cards.splice(at, 0, moved);

      // '최신순'이 켜져 있으면 시간순이 내가 놓은 순서를 덮어쓴다. 꺼준다.
      if (state.sortRecent) {
        state.sortRecent = false;
        const btn = $('#sort-recent');
        if (btn) btn.classList.remove('on');
        toast('순서를 직접 바꿨으므로 「최신순」을 껐습니다.');
      }
      updateSortOrder();
      schedulePersist();
    }
    endDrag();
  });

  box.addEventListener('dragend', endDrag);
})();

/* 영상 자막 지우기 — 새로 추가한 기능. 기존 코드는 건드리지 않음.

   영상에 구워진 자막을 지운다. 통째로 뭉개거나 검은 띠로 덮는 게 아니라,
   글자 획만 골라 지우고 그 자리를 주변 화면으로 메운다. 소리는 그대로 남는다.

   무거운 일은 전부 서버가 한다. 여기서는 영상을 넘기고, 지울 범위를
   맞추게 하고, 진행률을 보여줄 뿐이다. */
(function videoSubtitleEraser() {
  const dlg = $('#video-dlg');
  const openBtn = $('#btn-video');
  if (!dlg || !openBtn) return;

  const fileIn = $('#vid-file');
  const label = $('#vid-label');
  const stage = $('#vid-stage');
  const shot = $('#vid-shot');
  const bandsBox = $('#vid-bands');
  const meta = $('#vid-meta');
  const runBox = $('#vid-run');
  const barFill = $('#vid-bar-fill');
  const runNote = $('#vid-run-note');
  const errBox = $('#vid-error');
  const goBtn = $('#vid-go');
  const openDirBtn = $('#vid-open');
  const saveBtn = $('#vid-save');
  const resultBox = $('#vid-result-box');
  const resultVid = $('#vid-result');
  const atLabel = $('#vid-at');
  const timeLabel = $('#vid-time');

  let job = null;        // {id, width, height, ...}
  let bands = [];        // [[y0,y1], …] — 원본 픽셀 기준. 여러 개 될 수 있다
  let shots = [];        // 영상 곳곳에서 뽑아둔 장면들
  let shotAt = 0;
  let poll = null;
  let busy = false;

  const fail = (msg) => {
    errBox.textContent = msg;
    errBox.hidden = !msg;
  };

  function reset() {
    if (poll) clearInterval(poll);
    poll = null;
    job = null;
    bands = [];
    shots = [];
    shotAt = 0;
    busy = false;
    resultBox.hidden = true;
    resultVid.removeAttribute('src');
    resultVid.load();
    saveBtn.hidden = true;
    goBtn.hidden = false;
    fileIn.value = '';
    label.textContent = '영상 고르기 (mp4)';
    stage.hidden = true;
    runBox.hidden = true;
    openDirBtn.hidden = true;
    goBtn.disabled = true;
    goBtn.textContent = '자막 지우기';
    barFill.style.width = '0%';
    fail('');
  }

  // 띠는 원본 픽셀 좌표로 다루고, 화면에는 비율로 그린다. 미리보기가
  // 창 크기에 따라 줄어들어도 좌표가 어긋나지 않는다.
  const MAX_BANDS = 4;

  function drawBands() {
    if (!job) return;
    bandsBox.innerHTML = '';
    bands.forEach((b, i) => {
      const el = document.createElement('div');
      el.className = 'vid-band';
      el.dataset.i = i;
      el.style.top = `${(b[0] / job.height) * 100}%`;
      el.style.height = `${((b[1] - b[0]) / job.height) * 100}%`;
      el.innerHTML = '<span class="vid-grip vid-grip-t" data-edge="top"></span>'
        + `<span class="vid-no">${i + 1}</span>`
        + (bands.length > 1
            ? '<button type="button" class="vid-drop" title="이 띠 지우기">✕</button>'
            : '')
        + '<span class="vid-grip vid-grip-b" data-edge="bottom"></span>';
      bandsBox.appendChild(el);
    });
    $('#vid-band-n').textContent = `띠 ${bands.length}개`;
    $('#vid-add-band').disabled = bands.length >= MAX_BANDS;
  }

  openBtn.addEventListener('click', () => {
    reset();
    dlg.showModal();
  });
  $('#vid-close').addEventListener('click', () => {
    // 작업 중에 닫아도 서버는 계속 돈다. 결과는 출력 폴더에 남는다.
    dlg.close();
  });
  openDirBtn.addEventListener('click', () => api('/api/open-output'));
  saveBtn.addEventListener('click', () => {
    // 브라우저의 '다른 이름으로 저장'을 띄운다. 출력 폴더에는 이미 있다.
    window.location.href = `/api/video/result?id=${job.id}&dl=1`;
  });

  // 문제 구간을 정확히 찾으려면 한 컷씩 넘길 수 있어야 한다. 재생 막대만
  // 있으면 1초 단위로도 못 맞춘다.
  const showTime = () => {
    const d = Number.isFinite(resultVid.duration) ? resultVid.duration : 0;
    timeLabel.textContent = `${resultVid.currentTime.toFixed(1)} / ${d.toFixed(1)}초`;
  };
  resultVid.addEventListener('timeupdate', showTime);
  resultVid.addEventListener('loadedmetadata', showTime);
  resultBox.querySelectorAll('[data-jump]').forEach((b) => {
    b.addEventListener('click', () => {
      resultVid.pause();      // 넘긴 자리에서 멈춰 있어야 들여다볼 수 있다
      const d = Number.isFinite(resultVid.duration) ? resultVid.duration : 0;
      resultVid.currentTime = Math.min(d,
        Math.max(0, resultVid.currentTime + Number(b.dataset.jump)));
      showTime();
    });
  });

  // 지금 보고 있는 장면을 사진으로 저장한다. 어디가 어떻게 망가졌는지
  // 보여주려면 말로 설명하는 것보다 그 순간의 사진 한 장이 정확하다.
  $('#vid-grab').addEventListener('click', () => {
    if (!resultVid.videoWidth) return fail('아직 영상을 읽지 못했습니다.');
    const cv = document.createElement('canvas');
    cv.width = resultVid.videoWidth;
    cv.height = resultVid.videoHeight;
    cv.getContext('2d').drawImage(resultVid, 0, 0, cv.width, cv.height);
    const a = document.createElement('a');
    a.href = cv.toDataURL('image/png');
    a.download = `${job.name}_${resultVid.currentTime.toFixed(1)}초.png`;
    a.click();
    toast(`${resultVid.currentTime.toFixed(1)}초 장면을 저장했습니다.`);
  });

  // 띠를 고쳐 다시 돌리고 싶을 때. 영상은 이미 받아뒀으므로 다시 안 올린다.
  $('#vid-back').addEventListener('click', () => {
    resultBox.hidden = true;
    runBox.hidden = true;
    stage.hidden = false;
    goBtn.hidden = false;
    goBtn.textContent = '다시 지우기';
  });

  // 드물게 브라우저가 이 영상 형식을 못 읽는 경우가 있다. 그때 깨진
  // 재생기를 보여주느니 어디서 확인하면 되는지 알려주는 편이 낫다.
  // 재생이 있어야 뜻이 있는 것들. 못 읽을 때 이것만 접는다 — 결과칸을
  // 통째로 접으면 [띠 다시 맞추기] 까지 사라져 아무것도 못 하게 된다.
  const playOnly = () => [resultVid, $('#vid-jumps'), $('#vid-grab'),
                          $('#vid-inspect-hint')];

  resultVid.addEventListener('error', () => {
    if (!resultVid.getAttribute('src')) return;
    playOnly().forEach((el) => { if (el) el.hidden = true; });
    runNote.textContent += ' (이 브라우저에서는 미리보기가 안 됩니다 — '
                         + '[폴더 열기]로 확인하세요)';
  });

  // 장면 넘겨보기 — 긴 영상에서 자막이 내내 띠 안에 있는지 확인하는 수단.
  function showShot(i) {
    if (!shots.length) return;
    shotAt = (i + shots.length) % shots.length;
    const sh = shots[shotAt];
    shot.src = `data:image/jpeg;base64,${sh.b64}`;
    atLabel.textContent = `${sh.at}초 (${shotAt + 1}/${shots.length})`;
  }
  $('#vid-prev').addEventListener('click', () => showShot(shotAt - 1));
  $('#vid-next').addEventListener('click', () => showShot(shotAt + 1));

  // 손대기 전의 장면을 그대로 저장한다. 자막이 원래 어떤 모양·색·두께인지
  // 봐야 왜 못 잡았는지 알 수 있다. 결과 사진만으로는 알 수 없다.
  $('#vid-grab-src').addEventListener('click', () => {
    if (!shots.length) return;
    const a = document.createElement('a');
    a.href = `data:image/jpeg;base64,${shots[shotAt].b64}`;
    a.download = `${job.name}_원본_${shots[shotAt].at}초.jpg`;
    a.click();
    toast(`${shots[shotAt].at}초 원본 장면을 저장했습니다.`);
  });

  fileIn.addEventListener('change', async () => {
    const f = fileIn.files && fileIn.files[0];
    if (!f) return;
    fail('');
    label.textContent = `${f.name} — 살펴보는 중…`;
    goBtn.disabled = true;

    try {
      const res = await fetch('/api/video/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: f,
      });
      const info = await res.json();
      if (!res.ok || info.error) throw new Error(info.error || '영상을 읽지 못했습니다.');

      job = info;
      job.name = f.name.replace(/\.[^.]+$/, '');
      shots = Array.isArray(info.previews) && info.previews.length
        ? info.previews
        : [{ at: 0, b64: info.preview_b64 }];
      // 못 찾았으면 아래쪽에 흔히 있는 자리로 띠 하나를 놓아준다.
      bands = (Array.isArray(info.bands) && info.bands.length)
        ? info.bands.map((b) => [b[0], b[1]])
        : [[Math.round(info.height * 0.78), Math.round(info.height * 0.95)]];
      showShot(0);
      drawBands();

      const mb = (f.size / (1024 * 1024)).toFixed(1);
      meta.textContent = `${info.width}×${info.height} · ${info.seconds}초 · ${mb}MB`
        + (info.bands && info.bands.length
            ? ` · 자막 자리 ${info.bands.length}곳을 자동으로 찾았습니다`
            : ' · 자막을 못 찾아 아래쪽에 띠를 놓았습니다');
      label.textContent = `${f.name} — 다른 영상 고르기`;
      stage.hidden = false;
      goBtn.disabled = false;
    } catch (err) {
      label.textContent = '영상 고르기 (mp4)';
      fail(err.message);
    }
  });

  // 띠 추가·삭제
  $('#vid-add-band').addEventListener('click', () => {
    if (!job || bands.length >= MAX_BANDS) return;
    const H = job.height;
    const tall = Math.round(H * 0.08);
    const free = (top) => bands.every((b) => top + tall < b[0] || top > b[1]);

    // 자막이 흔히 앉는 자리부터 내어준다 — 아래쪽, 그다음 위쪽. 둘 다
    // 차 있으면 마지막 띠 아래에 붙인다. 새 띠가 늘 바로 아래에 생기면
    // 아래쪽 자막에 쓰려고 화면 끝까지 끌어야 한다.
    const spots = [Math.round(H * 0.80), Math.round(H * 0.08)];
    let top = spots.find(free);
    if (top === undefined) {
      top = Math.min(H - tall,
        Math.max(0, ...bands.map((b) => b[1])) + Math.round(H * 0.03));
    }
    bands.push([top, Math.min(H, top + tall)]);
    bands.sort((a, b) => a[0] - b[0]);
    drawBands();
  });

  bandsBox.addEventListener('click', (e) => {
    if (!e.target.classList.contains('vid-drop') || busy) return;
    const i = Number(e.target.closest('.vid-band').dataset.i);
    if (bands.length > 1) bands.splice(i, 1);
    drawBands();
  });

  // 띠 끌기.
  //   손잡이(위/아래) 를 잡으면 → 그 변만 움직여 크기를 바꾼다
  //   띠 가운데를 잡으면       → 크기는 그대로 두고 통째로 옮긴다
  // 옮기기가 없으면 자막 자리로 띠를 보내려고 위아래를 번갈아 맞춰야 해서
  // 사실상 못 쓴다.
  bandsBox.addEventListener('pointerdown', (e) => {
    if (!job || busy) return;
    if (e.target.classList.contains('vid-drop')) return;   // ✕ 는 삭제다
    const el = e.target.closest('.vid-band');
    if (!el) return;
    const band = bands[Number(el.dataset.i)];
    if (!band) return;

    const edge = (e.target.dataset && e.target.dataset.edge) || null;
    const H = job.height;
    const cap = Math.round(H * 0.3);
    const gap = Math.round(H * 0.02);       // 띠가 뒤집히지 않게
    const box = shot.getBoundingClientRect();
    const yOf = (ev) => Math.round(
      Math.min(1, Math.max(0, (ev.clientY - box.top) / box.height)) * H);
    const grabAt = yOf(e);                  // 옮길 때 쓰는 처음 잡은 자리
    const start = [band[0], band[1]];

    e.preventDefault();
    e.target.setPointerCapture(e.pointerId);

    const move = (ev) => {
      const y = yOf(ev);
      if (edge === 'top') {
        band[0] = Math.max(0, Math.min(y, band[1] - gap));
        if (band[1] - band[0] > cap) band[0] = band[1] - cap;
      } else if (edge === 'bottom') {
        band[1] = Math.min(H, Math.max(y, band[0] + gap));
        if (band[1] - band[0] > cap) band[1] = band[0] + cap;
      } else {
        // 통째로 옮기기 — 높이를 지키고 화면 밖으로 나가지 않게 한다.
        const tall = start[1] - start[0];
        let top = start[0] + (y - grabAt);
        top = Math.max(0, Math.min(top, H - tall));
        band[0] = top;
        band[1] = top + tall;
      }
      // 끄는 중에는 이 띠만 고쳐 그린다. 전체를 다시 만들면 지금 잡고
      // 있는 손잡이가 사라져 끌기가 그 자리에서 끊긴다.
      el.style.top = `${(band[0] / H) * 100}%`;
      el.style.height = `${((band[1] - band[0]) / H) * 100}%`;
    };
    const up = () => {
      e.target.removeEventListener('pointermove', move);
      e.target.removeEventListener('pointerup', up);
      bands.sort((a, b) => a[0] - b[0]);   // 놓고 나서 위→아래 순으로 정리
      drawBands();
    };
    e.target.addEventListener('pointermove', move);
    e.target.addEventListener('pointerup', up);
  });

  goBtn.addEventListener('click', async () => {
    if (!job || busy) return;
    busy = true;
    fail('');
    goBtn.disabled = true;
    goBtn.textContent = '지우는 중…';
    runBox.hidden = false;
    runNote.textContent = '시작하는 중…';

    try {
      const out = await api('/api/video/start',
        { id: job.id, bands, name: job.name });
      if (out.error) throw new Error(out.error);
    } catch (err) {
      busy = false;
      goBtn.disabled = false;
      goBtn.textContent = '자막 지우기';
      runBox.hidden = true;
      return fail(err.message);
    }

    poll = setInterval(async () => {
      let st;
      try {
        st = await (await fetch(`/api/video/status?id=${job.id}`)).json();
      } catch {
        return;   // 잠깐 못 물어봤다고 그만두지 않는다
      }
      const pct = Math.round((st.progress || 0) * 100);
      barFill.style.width = `${pct}%`;
      runNote.textContent = st.done ? '' : `${pct}% — 창을 닫아도 계속 진행됩니다`;

      if (!st.done) return;
      clearInterval(poll);
      poll = null;
      busy = false;
      goBtn.textContent = '자막 지우기';
      goBtn.disabled = false;

      if (st.error) {
        runBox.hidden = true;
        return fail(st.error);
      }
      const file = String(st.out || '').split(/[\\/]/).pop();
      runNote.textContent = `완성됐습니다 — ${file}`;
      if (st.skipped > 0 && st.frames > 0) {
        // 화면이 깨질 것 같아 손대지 않고 지나간 장면이 있으면 알려준다.
        // 모르면 '왜 여긴 안 지워졌지' 하고 헤매게 된다.
        const pct = Math.round((st.skipped / st.frames) * 100);
        runNote.textContent += ` · 화면이 깨질 것 같은 ${pct}% 구간은 `
                             + '건드리지 않았습니다 (띠를 좁히면 줄어듭니다)';
      }
      openDirBtn.hidden = false;
      saveBtn.hidden = false;
      // 바로 눈으로 확인하게 해준다. 폴더를 열어 찾아 재생할 필요가 없다.
      playOnly().forEach((el) => { if (el) el.hidden = false; });
      resultVid.src = `/api/video/result?id=${job.id}`;
      resultBox.hidden = false;
      // 띠 맞추던 화면을 접는다. 둘 다 펴두면 창이 길어져 재생기가
      // 화면 밖으로 밀려나고, 멈춰서 들여다볼 수가 없다.
      stage.hidden = true;
      goBtn.hidden = true;
      toast('영상 자막을 지웠습니다. 출력 폴더에 저장했습니다.');
    }, 900);
  });
})();
