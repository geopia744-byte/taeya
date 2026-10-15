/* 뉴스ai자동화 — 한 줄로 가는 흐름
   기사 주소 → 대본 → 컷(12초) → 나레이션 → 이미지 프롬프트 → 영상

   숫자는 레퍼런스 영상 실측:
     대본 4,621자 = 9분 = 43컷  →  513자/분, 107자/컷 */

const 자당분 = 513;
const 컷당자 = 107;

let 작업들 = [];
let 작 = null;          // 지금 열린 작업

const 단계 = [
  { k:'news',   en:'NEWS',   ko:'기사 주소',      ic:'🔗' },
  { k:'script', en:'SCRIPT', ko:'대본',          ic:'🗒' },
  { k:'cuts',   en:'CUTS',   ko:'컷 나누기',      ic:'✂' },
  { k:'voice',  en:'VOICE',  ko:'나레이션',       ic:'🎙' },
  { k:'image',  en:'IMAGE',  ko:'이미지 프롬프트', ic:'🎨' },
  { k:'video',  en:'VIDEO',  ko:'영상',          ic:'🎬' },
];
let 현재 = 'news';

/* ── 서버 ─────────────────────────────── */
async function api(p, b){
  const o = b ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)} : {};
  const r = await fetch('/api/'+p, o);
  if(!r.ok) throw new Error(await r.text());
  return r.json();
}
async function 불러오기(){ 작업들 = (await api('jobs')).jobs; }

/* 저장 — 글자 칠 때마다 보내면 요청이 겹쳐서 파일이 깨진다.
   그래서 0.5초 쉬었다가 한 번만 보낸다. */
let 저장대기 = null, 저장중 = false, 또저장 = false;

function 저장(바꿀것){
  Object.assign(작, 바꿀것);
  작.step = 현재;
  clearTimeout(저장대기);
  return new Promise(ok=>{ 저장대기 = setTimeout(async()=>{ await 진짜저장(); ok(); }, 500); });
}

async function 진짜저장(){
  if(저장중){ 또저장 = true; return; }
  저장중 = true;
  try { await api('job/save', 작); }
  catch(e){ toast('저장 실패: '+e.message, true); }
  저장중 = false;
  if(또저장){ 또저장 = false; await 진짜저장(); }
}

/* 단계를 옮기기 전에는 기다렸다가 확실히 저장한다 */
async function 저장지금(){ clearTimeout(저장대기); await 진짜저장(); }

/* ── 도구 ─────────────────────────────── */
function toast(m,bad){ const d=document.createElement('div');
  d.className='toast'+(bad?' bad':''); d.textContent=m;
  document.getElementById('toast').appendChild(d); setTimeout(()=>d.remove(),2800); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function 복사(t,말){ navigator.clipboard.writeText(t).then(()=>toast(말||'복사했어')); }
function 초표기(s){ const m=Math.floor(s/60); return `${m}:${(s%60).toFixed(1).padStart(4,'0')}`; }

/* ── 단계 잠금 ────────────────────────── */
const 끝났나 = {
  news:   ()=> !!(작 && (작.url||'').trim()),
  script: ()=> !!(작 && (작.script||'').trim().length > 200),
  cuts:   ()=> !!(작 && 작.cuts && 작.cuts.length),
  voice:  ()=> !!(작 && 작.voiceDone),
  image:  ()=> !!(작 && 작.prompts && 작.prompts.length),
  video:  ()=> !!(작 && 작.videoDone),
};
function 열렸나(k){
  const i = 단계.findIndex(s=>s.k===k);
  for(let j=0;j<i;j++) if(!끝났나[단계[j].k]()) return false;
  return true;
}

/* ── 왼쪽 기둥 ────────────────────────── */
function 기둥그리기(){
  const el = document.getElementById('pipe');
  if(!작){
    el.innerHTML = '<div class="rail"></div>' + 단계.map((s,i)=>`
      <div class="step locked" style="cursor:default">
        <div class="mk">${i+1}</div>
        <div style="flex:1"><div class="en">${s.en}</div><div class="ko">${s.ko}</div></div>
      </div>`).join('');
    return;
  }
  el.innerHTML = '<div class="rail"></div>' + 단계.map((s,i)=>{
    const 완 = 끝났나[s.k]();
    const 온 = s.k===현재;
    const 열 = 열렸나(s.k);
    return `<button class="step ${완?'done':''} ${온?'on':''} ${열?'':'locked'}"
        onclick="이동('${s.k}')" ${열?'':'title="앞 단계를 먼저 끝내"'}>
      <div class="mk">${완&&!온?'✓':(열?'':'🔒')}</div>
      <div style="flex:1;min-width:0">
        <div class="en">${i+1}. ${s.en}</div>
        <div class="ko">${s.ko}</div>
        ${요약(s.k)?`<div class="sub">${esc(요약(s.k))}</div>`:''}
      </div>
      <div class="ricon">${s.ic}</div>
    </button>`;
  }).join('');
}

function 요약(k){
  if(!작) return '';
  if(k==='script' && 작.script) return 작.script.length.toLocaleString()+'자';
  if(k==='cuts'   && 작.cuts)   return 작.cuts.length+'컷';
  if(k==='image'  && 작.style)  return (화풍목록.find(x=>x.id===작.style)||{}).이름||'';
  return '';
}

async function 이동(k){
  if(!열렸나(k)){ toast('앞 단계를 먼저 끝내야 들어갈 수 있어', true); return; }
  if(작) await 저장지금();
  현재 = k; 기둥그리기(); 그리기();
  document.querySelector('.main').scrollTop = 0;
}

/* ── 작업 목록 ────────────────────────── */
function 작업목록(){
  작 = null; 현재='news'; 기둥그리기();
  document.getElementById('crSep').style.display='none';
  document.getElementById('crCur').textContent='';
  const m = document.getElementById('main');
  m.innerHTML = `
    <div class="h1">작업 목록</div>
    <div class="h1sub">영상 한 편 = 작업 하나.</div>
    ${작업들.length ? `<div class="chgrid">${작업들.slice().reverse().map(j=>{
      const i = 단계.findIndex(s=>s.k===(j.step||'news'));
      return `<div class="chcard" style="cursor:pointer" onclick="열기('${j.id}')">
        <div class="chtop"><div class="chico">🗒</div><div class="chname">${esc(j.name)}</div></div>
        <div class="chlink">${esc(j.created||'')}${j.script?` · ${j.script.length.toLocaleString()}자`:''}${j.cuts?` · ${j.cuts.length}컷`:''}</div>
        <div class="chtag">${i+1}/6 ${esc(단계[i].ko)}</div>
        <div class="chbtns2"><button class="btn sm gh dang"
          onclick="event.stopPropagation();지우기('${j.id}')">🗑 지우기</button></div>
      </div>`;}).join('')}</div>`
    : `<div style="background:#0d2234;border:1px solid #1d4a68;border-radius:10px;padding:16px 18px">
         <div style="font-size:14px;font-weight:600;color:var(--cy2);margin-bottom:5px">👉 지금 할 일</div>
         <div style="font-size:12.5px;color:#9fc4dc;line-height:1.7">
           오른쪽 위 <b>[+ 새 작업]</b> 을 누르면 <b>1단계 기사 주소</b> 부터 시작돼.</div>
       </div>`}`;
}

async function 새작업(){
  const 이름 = prompt('작업 이름 (예: AI 해킹의 습격)');
  if(!이름) return;
  const r = await api('job/new', {name:이름});
  await 불러오기(); 열기(r.id);
}
async function 지우기(id){
  const j = 작업들.find(x=>x.id===id);
  if(!confirm(`「${j.name}」 을 지울까? 되돌릴 수 없어.`)) return;
  await api('job/del',{id}); await 불러오기(); 작업목록(); toast('지웠어');
}
function 열기(id){
  작 = 작업들.find(x=>x.id===id);
  if(!작) return 작업목록();
  현재 = 작.step || 'news';
  if(!열렸나(현재)) 현재 = 'news';
  document.getElementById('crSep').style.display='';
  document.getElementById('crCur').textContent = 작.name;
  기둥그리기(); 그리기();
}

/* ── 화면 그리기 ──────────────────────── */
function 그리기(){
  const i = 단계.findIndex(s=>s.k===현재);
  document.getElementById('main').innerHTML =
    `<div class="stepno">${i+1}/6 ${단계[i].ko}</div>` + 본문[현재]() + 이동줄(i);
  if(현재==='script') 글자세기();
  if(현재==='cuts')   컷그리기();
}

function 이동줄(i){
  const 앞=i>0?단계[i-1]:null, 뒤=i<단계.length-1?단계[i+1]:null;
  return `<div class="navbar">
    ${앞?`<button class="btn" onclick="이동('${앞.k}')">← ${앞.ko}</button>`:'<span></span>'}
    <div class="sp"></div>
    ${뒤?`<button class="btn cy" onclick="다음('${뒤.k}')">${뒤.ko} →</button>`:''}
  </div>`;
}
async function 다음(k){
  if(!끝났나[현재]()){ toast(안내[현재]||'이 단계를 먼저 끝내줘', true); return; }
  await 이동(k);
}
const 안내 = {
  news:'기사 주소나 주제를 먼저 넣어줘',
  script:'대본을 먼저 넣어줘 (200자 이상)',
  cuts:'컷을 먼저 나눠줘',
  voice:'나레이션을 먼저 만들어줘',
  image:'이미지 프롬프트를 먼저 뽑아줘',
};

const 본문 = {};

/* ══ 1단계 기사 주소 ══ */
본문.news = ()=>`
  <div class="h1">기사 주소</div>
  <div class="h1sub">뉴스 기사 주소 한 줄이면 돼. 여기서 전부 시작된다.</div>

  <div class="card">
    <h3>뉴스 기사 주소</h3>
    <div class="desc">네이버 뉴스, 신문사 기사, 유튜브 링크 다 돼. 여러 개면 한 줄에 하나씩.</div>
    <textarea class="ta" id="url" style="min-height:80px"
      placeholder="https://n.news.naver.com/mnews/article/003/0014233520"
      oninput="저장({url:this.value});기둥그리기()">${esc(작.url||'')}</textarea>
  </div>

  <div class="card">
    <h3>주제 <span style="color:var(--tx3);font-size:12px">(주소 없이 주제만 줘도 돼)</span></h3>
    <input class="in" id="topic" placeholder="예: 인공지능 해킹"
      value="${esc(작.topic||'')}" oninput="저장({topic:this.value})">
  </div>

  <div class="card">
    <div class="corner">대본 생성에 그대로 반영됨</div>
    <h3>말투 · 스토리텔링</h3>
    <div class="desc">어떤 말투로 쓸지 정하는 자리. 비워두면 기본 말투로 쓴다.</div>
    <textarea class="ta" id="tone" style="min-height:120px" oninput="저장({tone:this.value})"
      placeholder="- 낮고 차분한 이야기꾼 말투로 서술한다.
- 첫 세 문장 안에 반드시 긴장감을 준다.
- 마무리는 여운을 남기는 한 문장으로 끝낸다.">${esc(작.tone||'')}</textarea>
  </div>

  <div class="card">
    <h3>분량</h3>
    <div class="row">
      <select class="sel" id="minutes" onchange="저장({minutes:+this.value});분량안내()">
        ${[5,9,10,15,20,30,45,60].map(v=>`<option value="${v}" ${(작.minutes||9)===v?'selected':''}>${v}분</option>`).join('')}
      </select>
      <span class="hint" id="분량글">　</span>
    </div>
  </div>`;

function 분량안내(){
  const v = +document.getElementById('minutes').value;
  const 자 = v*자당분, 컷 = Math.round(자/컷당자);
  document.getElementById('분량글').innerHTML =
    `<b>${v}분 ≈ ${자.toLocaleString()}자 ≈ 컷 ${컷}개</b> · 컷 하나 13초 · 그림 ${컷}장 필요`;
}

/* ══ 2단계 대본 ══ */
본문.script = ()=>`
  <div class="h1">대본</div>
  <div class="h1sub">클로드에게 시켜서 받아오거나, 직접 붙여넣어.</div>

  <div class="card">
    <div class="corner">클로드에 붙여넣기</div>
    <h3>① 질문 만들기</h3>
    <div class="desc">아래 단추를 누르면 네 기사 주소·말투·분량이 들어간 질문이 통째로 복사돼.
      그걸 <b>클로드</b>에 붙여넣고, 나온 대본을 아래 칸에 붙여넣으면 끝.</div>
    <button class="btn cy" onclick="질문복사()">📋 질문 복사하기</button>
    <div class="hint">클로드 코드가 PC에 깔려 있으면 3차에서 자동으로 연결할게.</div>
  </div>

  <div class="card">
    <h3>② 대본 붙여넣기</h3>
    <textarea class="ta" id="script" style="min-height:300px"
      placeholder="여기에 대본을 붙여넣어.&#10;&#10;문단은 줄바꿈으로 구분."
      oninput="글자세기();저장({script:this.value});기둥그리기()">${esc(작.script||'')}</textarea>
    <div style="display:flex;margin-top:8px">
      <div class="hint" id="검사">　</div>
      <div style="margin-left:auto" class="hint" id="글자">0자</div>
    </div>
  </div>

  <div class="card">
    <h3 style="cursor:pointer" onclick="const g=document.getElementById('gd');g.style.display=g.style.display==='none'?'':'none'">▾ 대본 작성 가이드</h3>
    <div id="gd" style="margin-top:10px;font-size:12.5px;color:var(--tx2);line-height:2">
      • 문장 끝 온점(.) 후 반드시 띄어쓰기<br>
      • 따옴표(&quot;) 사용은 피해주세요 (자막이 지저분해지고, 음성 변환 오류)<br>
      • 문단 구분은 줄바꿈으로<br>
      • 특수문자(※, ★, → 등), 이모지 사용 금지<br>
      • URL, 이메일 주소 직접 넣지 마세요<br>
      • 단어 뒤 괄호 금지 (예: 클로드(Claude) ❌ → 클로드 ✅)
    </div>
  </div>`;

function 질문복사(){
  const 분 = 작.minutes||9, 자 = 분*자당분;
  const t = `뉴스 영상 대본을 써줘.

[참고 기사]
${(작.url||'(없음)')}

[주제]
${작.topic||'(기사 내용에 따름)'}

[분량]
정확히 ${자.toLocaleString()}자 내외 (약 ${분}분 분량)

[말투·스토리텔링]
${(작.tone||'').trim() || '- 차분하고 신뢰감 있는 뉴스 해설 말투\n- 첫 세 문장 안에 시청자를 붙잡는 긴장감을 준다\n- 마무리는 여운을 남기는 한 문장으로 끝낸다'}

[반드시 지킬 것]
1. 문장 끝 온점(.) 뒤에는 반드시 띄어쓰기
2. 따옴표(") 쓰지 말 것
3. 문단은 빈 줄로 구분
4. 특수문자(※ ★ → 등)와 이모지 쓰지 말 것
5. URL, 이메일 주소 넣지 말 것
6. 단어 뒤 괄호 금지 (클로드(Claude) ❌ → 클로드 ⭕)
7. 설명이나 머리말 없이 대본 본문만 출력할 것`;
  복사(t, '질문을 복사했어. 클로드에 붙여넣어');
}

function 글자세기(){
  const t = (document.getElementById('script')||{}).value||'';
  const g = document.getElementById('글자');
  if(g) g.textContent = `${t.length.toLocaleString()}자 ≈ ${(t.length/자당분).toFixed(1)}분 ≈ 컷 ${Math.round(t.length/컷당자)}개`;
  const 검 = document.getElementById('검사'); if(!검) return;
  const 문제 = [];
  if(/\.[가-힣A-Za-z0-9]/.test(t)) 문제.push('온점 뒤 띄어쓰기 빠진 곳');
  if(t.includes('"')) 문제.push('따옴표');
  if(/[※★→←↑↓◆■□●○]/.test(t)) 문제.push('특수문자');
  if(/https?:\/\//.test(t)) 문제.push('URL');
  if(/[가-힣]\([A-Za-z]/.test(t)) 문제.push('단어 뒤 괄호');
  if(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t)) 문제.push('이모지');
  검.innerHTML = !t.trim() ? '　'
    : (문제.length ? `<span style="color:#fbbf24">⚠ 가이드 위반: ${문제.join(' · ')}</span>`
                   : `<span style="color:#4ade80">✓ 대본 작성 가이드를 모두 통과했습니다.</span>`);
}

/* ══ 3단계 컷 나누기 ══ */
본문.cuts = ()=>`
  <div class="h1">컷 나누기</div>
  <div class="h1sub">대본을 <b>12~13초짜리 토막</b>으로 자른다.
    <b style="color:var(--cy2)">토막 하나 = 그림 한 장 = 자막 한 구간.</b></div>

  <div class="card">
    <div class="corner" id="컷요약">　</div>
    <h3>자르기 설정</h3>
    <div class="row">
      <span class="lab">한 컷 목표</span>
      <select class="sel" id="t" onchange="컷그리기()">
        ${[10,12,13,16,20].map(v=>`<option value="${v}" ${(작.target||13)===v?'selected':''}>${v}초</option>`).join('')}
      </select>
      <span class="lab">앞부분(후킹)</span>
      <select class="sel" id="h" onchange="컷그리기()">
        ${[6,8,10,13].map(v=>`<option value="${v}" ${(작.hook||8)===v?'selected':''}>${v}초</option>`).join('')}
      </select>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--tx2);cursor:pointer">
        <input type="checkbox" id="cta" ${작.skipCta!==false?'checked':''} onchange="컷그리기()">
        구독·좋아요 문단은 그림 안 만들기</label>
      <button class="btn cy" onclick="컷확정()">이 설정으로 확정</button>
    </div>
    <div id="타임라인" style="margin:14px 0 6px"></div>
    <div style="font-size:11px;color:var(--tx3)">
      <span style="color:#f59e0b">■</span> 후킹
      <span style="color:#38bdf8;margin-left:10px">■</span> 본문
      <span style="color:#34d399;margin-left:10px">■</span> 마무리
    </div>
  </div>

  <div class="card"><div id="컷목록"></div></div>`;

const 구간색 = {'후킹':'#f59e0b','본문':'#38bdf8','강조':'#a78bfa','마무리':'#34d399'};
let 미리컷 = [];

async function 컷그리기(){
  const 목록 = document.getElementById('컷목록'); if(!목록) return;
  const r = await api('cut', { script:작.script||'',
    target:+document.getElementById('t').value,
    hook:+document.getElementById('h').value,
    skipCta:document.getElementById('cta').checked });
  미리컷 = r.컷; const s = r.요약;
  document.getElementById('컷요약').innerHTML =
    `<b style="color:var(--cy2)">컷 ${s.컷수}개</b> · ${s.전체분}분 · 평균 ${s.평균컷초}초`;
  const 전체 = s.전체초||1;
  document.getElementById('타임라인').innerHTML =
    `<div style="display:flex;height:24px;border-radius:5px;overflow:hidden;border:1px solid var(--line2)">`+
    미리컷.map(c=>`<div title="${c.번호}번 · ${c.길이초}초"
      style="width:${(c.길이초/전체*100).toFixed(3)}%;background:${구간색[c.구간]};border-right:1px solid rgba(0,0,0,.45)"></div>`).join('')+`</div>`;
  목록.innerHTML = 미리컷.map(c=>`
    <div style="display:flex;gap:11px;padding:10px 0;border-top:1px solid var(--line)">
      <div style="width:32px;flex-shrink:0;text-align:center">
        <div style="font-size:13px;font-weight:700;color:${구간색[c.구간]}">${c.번호}</div>
        <div style="font-size:9.5px;color:var(--tx3)">${c.구간}</div></div>
      <div style="width:108px;flex-shrink:0;font-size:11px;color:var(--tx3);line-height:1.5">
        ${초표기(c.시작초)} ~ ${초표기(c.끝초)}<br>
        <span style="color:var(--tx2)">${c.길이초}초 · ${c.글자수}자</span></div>
      <div style="flex:1;min-width:0;font-size:12.5px;line-height:1.65">${esc(c.대본)}</div>
    </div>`).join('');
}

async function 컷확정(){
  if(!미리컷.length){ toast('자를 대본이 없어', true); return; }
  await 저장({ cuts:미리컷, target:+document.getElementById('t').value,
               hook:+document.getElementById('h').value,
               skipCta:document.getElementById('cta').checked });
  기둥그리기(); toast(`컷 ${미리컷.length}개로 확정했어`);
}

/* ══ 4단계 나레이션 ══ */
본문.voice = ()=>`
  <div class="h1">나레이션</div>
  <div class="h1sub">컷 ${(작.cuts||[]).length}개를 소리로 만든다.</div>
  <div class="note">아직 안 만든 단계야 (3차). 지금은 <b>건너뛰기</b>로 넘어가서
    이미지 프롬프트를 먼저 뽑을 수 있어.</div>
  <div class="card">
    <h3>무엇이 들어갈 예정인가</h3>
    <div style="font-size:12.5px;color:var(--tx2);line-height:2">
      • 목소리 고르기 (무료 edge-tts / 유료 ElevenLabs)<br>
      • 말하기 속도, 자막 최대 글자수<br>
      • 무음 압축 (말 사이 빈 곳 줄이기)<br>
      • 컷마다 소리를 만들고 <b>실제 길이를 재서 컷 시간을 다시 맞춤</b>
    </div>
    <div style="margin-top:14px">
      <button class="btn" onclick="저장({voiceDone:true}).then(()=>{기둥그리기();toast('건너뛰었어')})">
        건너뛰기 (나중에)</button>
    </div>
  </div>`;

/* ══ 5단계 이미지 프롬프트 ══ */
본문.image = ()=>{
  const 묶음 = [...new Set(화풍목록.map(s=>s.묶음))];
  return `
  <div class="h1">이미지 프롬프트</div>
  <div class="h1sub">화풍을 고르면 <b>컷마다 영문 프롬프트</b>가 만들어진다. 컷 ${(작.cuts||[]).length}개 = 그림 ${(작.cuts||[]).length}장.</div>

  <div class="card">
    <h3>화풍 고르기 <span style="color:var(--tx3);font-size:12px">12가지</span></h3>
    ${묶음.map(g=>`
      <div style="font-size:11px;color:var(--tx3);margin:14px 0 8px">${esc(g)}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(216px,1fr));gap:9px">
      ${화풍목록.filter(s=>s.묶음===g).map(s=>`
        <div onclick="화풍고르기('${s.id}')" style="cursor:pointer;padding:11px 13px;border-radius:9px;
            background:${작.style===s.id?'var(--cybg)':'var(--card2)'};
            border:1px solid ${작.style===s.id?'var(--cy)':'var(--line2)'}">
          <div style="font-size:13px;font-weight:600;color:${작.style===s.id?'var(--cy2)':'var(--tx)'}">${esc(s.이름)}</div>
          <div style="font-size:11px;color:var(--tx2);line-height:1.55;margin-top:4px">${esc(s.설명)}</div>
        </div>`).join('')}
      </div>`).join('')}
  </div>

  <div class="card">
    <div class="corner">클로드에 붙여넣기</div>
    <h3>① 장면 묘사 만들기</h3>
    <div class="desc">컷 대본을 읽고 <b>그 컷에 맞는 그림</b>을 묘사하게 시킨다.
      아래 단추를 누르면 컷 전부가 들어간 질문이 복사돼.</div>
    <button class="btn cy" onclick="묘사질문복사()" ${작.style?'':'disabled'}>📋 질문 복사하기</button>
    ${작.style?'':'<div class="hint">먼저 화풍을 골라줘</div>'}
  </div>

  <div class="card">
    <h3>② 받은 결과 붙여넣기</h3>
    <div class="desc">클로드가 준 줄들을 그대로 붙여넣어. 한 줄에 컷 하나씩이야.</div>
    <textarea class="ta" id="pr" style="min-height:160px"
      placeholder="1 | 해커가 어두운 방에서... | a hacker in a dark room..."></textarea>
    <div style="margin-top:10px"><button class="btn cy" onclick="프롬프트넣기()">넣기</button></div>
  </div>

  ${(작.prompts&&작.prompts.length)?`
  <div class="card">
    <div class="corner">${작.prompts.length}개</div>
    <h3>만들어진 프롬프트</h3>
    <div style="margin:10px 0"><button class="btn" onclick="전체프롬프트복사()">📋 영문 프롬프트 전부 복사</button></div>
    ${작.prompts.map(p=>`
      <div style="display:flex;gap:11px;padding:10px 0;border-top:1px solid var(--line)">
        <div style="width:28px;flex-shrink:0;text-align:center;font-weight:700;color:var(--cy2)">${p.번호}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12.5px;line-height:1.6">${esc(p.묘사)}</div>
          <div style="font-size:11.5px;color:var(--tx3);margin-top:5px;line-height:1.55;
            font-family:Consolas,monospace;word-break:break-all">${esc(p.영문)}</div>
        </div>
        <button class="btn sm gh" onclick="복사(${JSON.stringify(JSON.stringify(p.영문))})">복사</button>
      </div>`).join('')}
  </div>`:''}`;
};

async function 화풍고르기(id){ await 저장({style:id}); 기둥그리기(); 그리기(); }

function 묘사질문복사(){
  const s = 화풍목록.find(x=>x.id===작.style);
  const cs = 작.cuts||[];
  const t = `아래는 영상 대본을 ${cs.length}개의 컷으로 나눈 것이다.
컷마다 그 내용에 어울리는 그림을 하나씩 만들려고 한다.

각 컷에 대해 아래 형식으로 정확히 한 줄씩 출력해라. 설명이나 머리말은 쓰지 마라.

번호 | 장면 묘사(한국어 한 문장) | 영문 이미지 프롬프트

규칙
- 장면 묘사는 그 컷의 대본 내용을 그림으로 옮긴 것이어야 한다. 새 내용을 지어내지 마라.
- 영문 프롬프트에는 화풍을 넣지 마라. 내가 따로 붙인다.
- 영문 프롬프트에 글자·자막·워터마크를 넣으라는 말은 쓰지 마라.
- 인물이 반복해 나오면 같은 외모로 묘사해 일관성을 지켜라.

[컷 목록]
${cs.map(c=>`${c.번호}. (${c.길이초}초) ${c.대본}`).join('\n')}`;
  복사(t, `컷 ${cs.length}개짜리 질문을 복사했어`);
}

async function 프롬프트넣기(){
  const s = 화풍목록.find(x=>x.id===작.style);
  const 줄 = document.getElementById('pr').value.split('\n').map(x=>x.trim()).filter(Boolean);
  const out = [];
  for(const l of 줄){
    const m = l.split('|').map(x=>x.trim());
    if(m.length < 3) continue;
    const n = parseInt(m[0].replace(/[^0-9]/g,''),10);
    if(!n) continue;
    out.push({ 번호:n, 묘사:m[1], 영문:`${m[2]}, ${s.영문}, ${공통규격}` });
  }
  if(!out.length){ toast('읽을 줄이 없어. 「번호 | 묘사 | 영문」 모양이어야 해', true); return; }
  out.sort((a,b)=>a.번호-b.번호);
  await 저장({prompts:out}); 기둥그리기(); 그리기();
  toast(`프롬프트 ${out.length}개 넣었어`);
}

function 전체프롬프트복사(){
  복사((작.prompts||[]).map(p=>`${p.번호}. ${p.영문}`).join('\n\n'), '전부 복사했어');
}

/* ══ 6단계 영상 ══ */
본문.video = ()=>`
  <div class="h1">영상</div>
  <div class="h1sub">그림 + 나레이션 + 자막을 붙여서 mp4 하나로 만든다.</div>
  <div class="note">아직 안 만든 단계야 (4차). 그림 ${(작.prompts||[]).length}장을
    Flow·제미니 같은 데서 만들어 두면, 여기서 조립하게 돼.</div>
  <div class="card">
    <h3>무엇이 들어갈 예정인가</h3>
    <div style="font-size:12.5px;color:var(--tx2);line-height:2">
      • 컷마다 그림 올리기 (끌어다 놓기)<br>
      • 그림을 컷 길이에 맞춰 이어 붙이기<br>
      • 나레이션 얹기<br>
      • <b>자막을 화면에 굽기</b><br>
      • 1920×1080 mp4 로 내보내기
    </div>
  </div>`;

/* ── 시작 ─────────────────────────────── */
(async ()=>{
  try { await 불러오기(); 작업목록(); }
  catch(e){ document.getElementById('main').innerHTML =
    `<div class="empty">서버에 닿지 못했어.<br>검은 창을 닫지 말고 열어둔 채로 다시 열어줘.</div>`; }
})();
