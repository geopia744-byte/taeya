/* 뉴스ai자동화 — 레퍼런스 영상의 7단계 그대로
   메뉴 7개. 어느 것을 눌러도 독립해서 들어간다.

   숫자는 영상 실측: 대본 4,621자 = 9분 = 43컷 → 513자/분, 107자/컷 */

const 자당분 = 513;
const 컷당자 = 107;

let 작업들 = [];
let 예시그림 = {};   // {화풍id: dataURL}
let 내화풍 = [];
let 캐릭터들 = [];
let 작 = null;

const 단계 = [
  { k:'script',     en:'SCRIPT',     ko:'대본',       ic:'🗒' },
  { k:'voice',      en:'VOICE',      ko:'음성',       ic:'🎙' },
  { k:'style',      en:'STYLE',      ko:'스타일',     ic:'🎨' },
  { k:'storyboard', en:'STORYBOARD', ko:'스토리보드', ic:'▦' },
  { k:'image',      en:'IMAGE',      ko:'이미지',     ic:'🖼' },
  { k:'video',      en:'VIDEO',      ko:'영상',       ic:'🎬' },
  { k:'export',     en:'EXPORT',     ko:'완성',       ic:'⬆' },
];
let 현재 = 'script';

/* ── 서버 ─────────────────────────────── */
async function api(p, b){
  const o = b ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)} : {};
  const r = await fetch('/api/'+p, o);
  if(!r.ok) throw new Error(await r.text());
  return r.json();
}
async function 불러오기(){
  const r = await api('jobs');
  작업들 = r.jobs; 예시그림 = r.samples || {};
  내화풍 = r.myStyles || []; 캐릭터들 = r.chars || [];
}
async function 항목불러오기(){
  const r = await api('jobs');
  내화풍 = r.myStyles || []; 캐릭터들 = r.chars || [];
}

/* 저장 — 글자 칠 때마다 보내면 겹쳐서 깨진다. 0.5초 모아서 한 번만. */
let 저장대기=null, 저장중=false, 또저장=false;
function 저장(바꿀것){
  if(!작) return Promise.resolve();
  Object.assign(작, 바꿀것); 작.step = 현재;
  clearTimeout(저장대기);
  return new Promise(ok=>{ 저장대기=setTimeout(async()=>{ await 진짜저장(); ok(); },500); });
}
async function 진짜저장(){
  if(!작) return;
  if(저장중){ 또저장=true; return; }
  저장중=true;
  try{ await api('job/save', 작); }catch(e){ toast('저장 실패: '+e.message,true); }
  저장중=false;
  if(또저장){ 또저장=false; await 진짜저장(); }
}
async function 저장지금(){ clearTimeout(저장대기); await 진짜저장(); }

/* ── 도구 ─────────────────────────────── */
function toast(m,bad){ const d=document.createElement('div');
  d.className='toast'+(bad?' bad':''); d.textContent=m;
  document.getElementById('toast').appendChild(d); setTimeout(()=>d.remove(),2800); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function 복사(t,말){ navigator.clipboard.writeText(t).then(()=>toast(말||'복사했어')); }
function 초표기(s){ const m=Math.floor(s/60); return `${m}:${(s%60).toFixed(1).padStart(4,'0')}`; }

/* ── 각 단계가 끝났는지 (체크 표시용. 막지는 않는다) ── */
const 끝났나 = {
  script:     ()=> !!(작 && (작.script||'').trim().length>200),
  voice:      ()=> !!(작 && 작.voiceDone),
  style:      ()=> !!(작 && 작.style),
  storyboard: ()=> !!(작 && 작.cuts && 작.cuts.length),
  image:      ()=> !!(작 && 작.prompts && 작.prompts.length),
  video:      ()=> !!(작 && 작.videoDone),
  export:     ()=> !!(작 && 작.exported),
};

/* ── 왼쪽 메뉴 ────────────────────────── */
function 기둥그리기(){
  const el = document.getElementById('pipe');
  if(!작){
    el.innerHTML = '<div class="rail"></div>' + 단계.map(s=>`
      <div class="step locked" style="cursor:default">
        <div class="mk"></div>
        <div style="flex:1"><div class="en">${s.en}</div><div class="ko">${s.ko}</div></div>
        <div class="ricon">${s.ic}</div>
      </div>`).join('');
    return;
  }
  el.innerHTML = '<div class="rail"></div>' + 단계.map(s=>{
    const 완 = 끝났나[s.k](), 온 = s.k===현재, 요 = 요약(s.k);
    return `<button class="step ${완?'done':''} ${온?'on':''}" onclick="이동('${s.k}')">
      <div class="mk">${완&&!온?'✓':''}</div>
      <div style="flex:1;min-width:0">
        <div class="en">${s.en}</div>
        <div class="ko">${s.ko}</div>
        ${요?`<div class="sub">${esc(요)}</div>`:''}
      </div>
      <div class="ricon">${s.ic}</div>
    </button>`;
  }).join('');
}

function 요약(k){
  if(!작) return '';
  if(k==='script'     && 작.script)        return 작.script.length.toLocaleString()+'자';
  if(k==='voice'      && 작.voiceName)     return 작.voiceName;
  if(k==='style'      && 작.style)         return (화풍찾기(작.style)||{}).이름||'';
  if(k==='storyboard' && 작.cuts && 작.cuts.length) return 작.cuts.length+'컷';
  if(k==='image'      && 작.prompts && 작.prompts.length) return 작.prompts.length+'장';
  return '';
}

async function 이동(k){
  if(작) await 저장지금();
  현재 = k; 기둥그리기(); 그리기();
  document.querySelector('.main').scrollTop = 0;
}

/* ── 작업 목록 ────────────────────────── */
function 작업목록(){
  작 = null; 현재='script'; 기둥그리기();
  document.getElementById('crSep').style.display='none';
  document.getElementById('crCur').textContent='';
  const m = document.getElementById('main');
  m.innerHTML = `
    <div class="h1">작업 목록</div>
    <div class="h1sub">영상 한 편 = 작업 하나.</div>
    ${작업들.length ? `<div class="chgrid">${작업들.slice().reverse().map(j=>`
      <div class="chcard" style="cursor:pointer" onclick="열기('${j.id}')">
        <div class="chtop"><div class="chico">🗒</div><div class="chname">${esc(j.name)}</div></div>
        <div class="chlink">${esc(j.created||'')}${j.script?` · ${j.script.length.toLocaleString()}자`:''}${(j.cuts&&j.cuts.length)?` · ${j.cuts.length}컷`:''}</div>
        <div class="chtag">${esc((단계.find(s=>s.k===(j.step||'script'))||단계[0]).ko)}</div>
        <div class="chbtns2"><button class="btn sm gh dang"
          onclick="event.stopPropagation();지우기('${j.id}')">🗑 지우기</button></div>
      </div>`).join('')}</div>`
    : `<div style="background:#0d2234;border:1px solid #1d4a68;border-radius:10px;padding:16px 18px">
         <div style="font-size:15px;font-weight:600;color:var(--cy2);margin-bottom:6px">👉 지금 할 일</div>
         <div style="font-size:13px;color:#9fc4dc;line-height:1.7">
           오른쪽 위 <b>[+ 새 작업]</b> 을 누르면 7단계 메뉴가 켜져.</div>
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
  현재 = 작.step || 'script';
  if(!단계.some(s=>s.k===현재)) 현재='script';
  document.getElementById('crSep').style.display='';
  document.getElementById('crCur').textContent = 작.name;
  기둥그리기(); 그리기();
}

/* ── 화면 그리기 ──────────────────────── */
/* 제 이동줄을 스스로 갖는 화면 */
const 자체이동줄 = ['storyboard'];

function 그리기(){
  const i = 단계.findIndex(s=>s.k===현재);
  document.getElementById('main').innerHTML =
    `<div class="stepno">${i+1}/7 ${단계[i].ko}</div>` + 본문[현재]()
    + (자체이동줄.includes(현재) ? '' : 이동줄(i));
  if(현재==='script') 글자세기();
  if(현재==='storyboard'){ 다펼침=false; 컷그리기(); }
}
function 이동줄(i){
  const 앞=i>0?단계[i-1]:null, 뒤=i<단계.length-1?단계[i+1]:null;
  return `<div class="navbar">
    ${앞?`<button class="btn" onclick="이동('${앞.k}')">이전</button>`:'<span></span>'}
    <div class="sp"></div>
    ${뒤?`<button class="btn cy" onclick="이동('${뒤.k}')">다음</button>`:''}
  </div>`;
}

const 본문 = {};

/* ══ 1 대본 ══ */
본문.script = ()=>`
  <div class="h1">대본</div>
  <div class="h1sub">영상에 사용할 대본을 입력하거나 AI에게 작성을 요청하세요.</div>

  <div class="card">
    <div class="corner">생성 · API 키 불필요</div>
    <h3>유튜브/주제로 대본 생성</h3>
    <div class="desc">참고 유튜브 링크나 <b>뉴스 기사 주소</b>를 주면 Claude가 리서치해서 대본 초안을 써줍니다.
      생성 후 아래 편집창에서 다듬고 확정하세요.</div>

    <textarea class="ta" id="url" style="min-height:58px;margin-bottom:9px"
      placeholder="참고 유튜브·뉴스 URL (선택, 한 줄에 하나씩)"
      oninput="저장({url:this.value})">${esc(작.url||'')}</textarea>
    <input class="in" id="topic" style="margin-bottom:12px" placeholder="주제/소재 (예: 인공지능 해킹)"
      value="${esc(작.topic||'')}" oninput="저장({topic:this.value})">

    <div class="row">
      <span class="lab">분량</span>
      <select class="sel" id="minutes" onchange="저장({minutes:+this.value});분량안내()">
        ${[5,9,10,15,20,30,45,60].map(v=>`<option value="${v}" ${(작.minutes||9)===v?'selected':''}>${v}분</option>`).join('')}
      </select>
      <input class="in" id="chars" style="width:168px" placeholder="글자수 직접(선택)"
        value="${작.chars2?esc(작.chars2):''}" oninput="저장({chars2:this.value});분량안내()">
      <button class="btn cy" onclick="질문복사()">대본 생성</button>
    </div>
    <div class="hint" id="분량글">　</div>
  </div>

  <div class="card">
    <div class="corner">대본 생성에 그대로 반영됨</div>
    <h3>말투 · 스토리텔링</h3>
    <textarea class="ta" id="tone" style="min-height:110px" oninput="저장({tone:this.value})"
      placeholder="- 낮고 차분한 이야기꾼 말투로 서술한다.
- 첫 세 문장 안에 반드시 긴장감을 준다.
- 마무리는 여운을 남기는 한 문장으로 끝낸다.">${esc(작.tone||'')}</textarea>
  </div>

  <div class="card">
    <h3 style="cursor:pointer" onclick="const g=document.getElementById('gd');g.style.display=g.style.display==='none'?'':'none'">▾ 대본 작성 가이드</h3>
    <div id="gd" style="margin-top:10px;font-size:13px;color:var(--tx2);line-height:2">
      • 문장 끝 온점(.) 후 반드시 띄어쓰기<br>
      • 따옴표(&quot;) 사용은 피해주세요 (자막이 지저분해지고, 음성 변환 오류가 발생할 수 있습니다)<br>
      • 문단 구분은 줄바꿈으로<br>
      • 특수문자(※, ★, → 등), 이모지 사용 금지<br>
      • URL, 이메일 주소 직접 넣지 마세요<br>
      • 단어 뒤 괄호 금지 (예: 클로드(Claude) <span style="color:#ef4444">✗</span> → 클로드 <span style="color:#4ade80">✓</span>)
    </div>
  </div>

  <div class="card">
    <h3>대본 내용</h3>
    <div style="display:flex;gap:6px;margin:10px 0 12px">
      <button class="btn sm cy">한국어</button>
      <button class="btn sm" disabled title="나중에">일본어</button>
      <button class="btn sm" disabled title="나중에">영어</button>
    </div>
    <textarea class="ta" id="script" style="min-height:330px"
      placeholder="영상에 사용할 대본을 입력하세요.&#10;&#10;문단은 줄바꿈으로 구분합니다."
      oninput="글자세기();저장({script:this.value});기둥그리기()">${esc(작.script||'')}</textarea>
    <div style="text-align:right;margin-top:7px" class="hint" id="글자">0자 / 60,000자</div>
    <div style="margin-top:6px;font-size:13px" id="검사">　</div>
  </div>`;

function 목표글자수(){
  const 직 = parseInt(((document.getElementById('chars')||{}).value||'').replace(/[^0-9]/g,''),10);
  if(직 > 0) return {자:직, 직접:true};
  const v = +((document.getElementById('minutes')||{}).value || 작.minutes || 9);
  return {자: v*자당분, 분:v, 직접:false};
}
function 분량안내(){
  const g = 목표글자수(), 컷 = Math.round(g.자/컷당자);
  document.getElementById('분량글').innerHTML = g.직접
    ? `글자수를 직접 넣으면 분량(분)보다 우선합니다. <b>${g.자.toLocaleString()}자 ≈ ${(g.자/자당분).toFixed(1)}분 ≈ 그림 ${컷}장</b>`
    : `글자수를 직접 넣으면 분량(분)보다 우선합니다. 약 ${자당분}자 = 1분 (영상 실측).
       <b>${g.분}분 ≈ ${g.자.toLocaleString()}자 ≈ 그림 ${컷}장</b>`;
}

function 질문복사(){
  const 분=작.minutes||9, 자=분*자당분;
  복사(`뉴스 영상 대본을 써줘.

[참고 기사]
${작.url||'(없음)'}

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
7. 설명이나 머리말 없이 대본 본문만 출력할 것`, '질문을 복사했어. 클로드에 붙여넣어');
}

function 글자세기(){
  const t=(document.getElementById('script')||{}).value||'';
  const g=document.getElementById('글자');
  if(g) g.textContent = `${t.length.toLocaleString()}자 / 60,000자 ≈ ${(t.length/자당분).toFixed(1)}분 ≈ 컷 ${Math.round(t.length/컷당자)}개`;
  const 검=document.getElementById('검사'); if(!검) return;
  const 문제=[];
  if(/\.[가-힣A-Za-z0-9]/.test(t)) 문제.push('온점 뒤 띄어쓰기');
  if(t.includes('"')) 문제.push('따옴표');
  if(/[※★→←↑↓◆■□●○]/.test(t)) 문제.push('특수문자');
  if(/https?:\/\//.test(t)) 문제.push('URL');
  if(/[가-힣]\([A-Za-z]/.test(t)) 문제.push('단어 뒤 괄호');
  if(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t)) 문제.push('이모지');
  검.innerHTML = !t.trim() ? '　'
    : (문제.length ? `<span style="color:#fbbf24">⚠ 가이드 위반: ${문제.join(' · ')}</span>`
                   : `<span style="color:#4ade80">✓ 대본 작성 가이드를 모두 통과했습니다.</span>`);
}

/* ══ 2 음성 ══ */
본문.voice = ()=>`
  <div class="h1">음성</div>
  <div class="h1sub">대본을 문장으로 쪼개서 하나씩 소리로 만든다.</div>
  <div class="note">아직 안 만든 단계야 (다음 차수). 지금은 <b>건너뛰기</b>로 표시만 해둘 수 있어.</div>
  <div class="card">
    <h3>무엇이 들어갈 예정인가</h3>
    <div style="font-size:13px;color:var(--tx2);line-height:2">
      • 목소리 고르기 — 무료 edge-tts / 유료 ElevenLabs<br>
      • 말하기 속도 (0.7~1.2배), 자막 최대 글자수<br>
      • 무음 압축 — 최소 0.5초 · 목표 0.30초 · 임계값 -50dB<br>
      • 문장마다 합성하고 <b>실제 길이를 재서 컷 시간을 다시 맞춤</b><br>
      • 다국어 음성 (日本語 · English)
    </div>
    <div style="margin-top:14px">
      <button class="btn" onclick="저장({voiceDone:true,voiceName:'건너뜀'}).then(()=>{기둥그리기();toast('표시해 뒀어')})">건너뛰기</button>
    </div>
  </div>`;

/* ══ 3 스타일 ══ */
본문.style = ()=>{
  const 묶음=[...new Set(화풍목록.map(s=>s.묶음))];
  const 있는예시 = Object.keys(예시그림).length;
  return `
  <div class="h1">스타일</div>
  <div class="h1sub">그림을 어떤 화풍으로 그릴지 정한다. 고른 화풍이 <b>모든 컷의 프롬프트 뒤에 자동으로 붙는다.</b></div>

  <div class="card">
    <div class="corner">예시 이미지 ${있는예시}/${화풍목록.length} · <a href="#" onclick="예시질문복사();return false">예시 프롬프트 복사</a></div>
    <h3>화풍 고르기</h3>
    <div class="desc">카드를 누르면 그 화풍으로 정해져. 미리보기 그림은
      <b>같은 장면을 화풍만 바꿔 그린 것</b>이라 나란히 놓고 비교할 수 있어.</div>

    ${묶음.map(g=>`
      <div style="font-size:13px;color:var(--tx2);margin:20px 0 10px;font-weight:600">${esc(g)}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(248px,1fr));gap:12px">
      ${화풍목록.filter(s=>s.묶음===g).map(s=>화풍카드(s)).join('')}
      </div>`).join('')}
  </div>

  <div class="card">
    <div class="corner">클릭으로 프로젝트에 넣기 · ${(작.pickedChars||[]).length}명 선택됨</div>
    <h3>내 화풍</h3>
    <div class="desc">위에 원하는 게 없으면 <b>설명·이미지로 직접 등록</b>해.</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(248px,1fr));gap:12px;margin-top:12px">
      ${(내화풍||[]).map(c=>내화풍카드(c)).join('')}
      <div onclick="내화풍추가()" style="cursor:pointer;border:1px dashed var(--line2);border-radius:10px;
        min-height:180px;display:flex;flex-direction:column;align-items:center;justify-content:center;
        color:var(--cy2);gap:6px">
        <div style="font-size:24px">＋</div>
        <div style="font-size:14px;font-weight:600">내 화풍 추가</div>
        <div style="font-size:11.5px;color:var(--tx3)">원하는 화풍을 설명·이미지로 등록</div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="corner">클릭으로 프로젝트에 넣기 · ${(작.pickedChars||[]).length}명 선택됨</div>
    <h3>캐릭터</h3>
    <div class="desc">등록한 캐릭터는 스토리보드와 이미지 생성 시 <b>외모가 일관되게 유지됩니다.</b></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(248px,1fr));gap:12px;margin-top:12px">
      ${(캐릭터들||[]).map(c=>캐릭터카드(c)).join('')}
      <div onclick="캐릭터추가()" style="cursor:pointer;border:1px dashed var(--line2);border-radius:10px;
        min-height:180px;display:flex;flex-direction:column;align-items:center;justify-content:center;
        color:var(--cy2);gap:6px">
        <div style="font-size:24px">＋</div>
        <div style="font-size:14px;font-weight:600">캐릭터 추가</div>
        <div style="font-size:11.5px;color:var(--tx3)">이름 · 외모 · 이미지 등록</div>
      </div>
    </div>
  </div>`;
};

/* ── 내 화풍 / 캐릭터 카드 ─────────────── */
function 그림칸(그림, 높이){
  return `<div style="height:${높이}px;background:#0b0b0e;display:flex;align-items:center;
    justify-content:center;border-bottom:1px solid var(--line);overflow:hidden">
    ${그림?`<img src="${그림}" style="width:100%;height:100%;object-fit:cover">`
          :`<div style="color:var(--tx3);font-size:11px;text-align:center;line-height:1.6">
              이미지 없음<br><span style="font-size:10px">끌어다 놔</span></div>`}</div>`;
}

function 내화풍카드(c){
  const 뽑힘 = 작.style==='my:'+c.id;
  return `<div onclick="화풍고르기('my:${c.id}')"
    ondragover="event.preventDefault()" ondrop="항목그림떨구기(event,'style','${c.id}')"
    style="cursor:pointer;border-radius:10px;overflow:hidden;position:relative;
      background:${뽑힘?'var(--cybg)':'var(--card2)'};
      border:1px solid ${뽑힘?'var(--cy)':'var(--line2)'}">
    <div style="position:absolute;top:6px;right:6px;display:flex;gap:4px;z-index:2">
      <button class="btn sm gh" style="padding:2px 7px" onclick="event.stopPropagation();내화풍고치기('${c.id}')">✎</button>
      <button class="btn sm gh" style="padding:2px 7px" onclick="event.stopPropagation();내항목지우기('style','${c.id}')">✕</button>
    </div>
    ${그림칸(c.img, 124)}
    <div style="padding:12px 14px">
      <div style="font-size:15px;font-weight:600;color:${뽑힘?'var(--cy2)':'var(--tx)'}">${esc(c.name)}</div>
      <div style="font-size:11.5px;color:var(--tx3);line-height:1.6;margin-top:5px;
        font-family:Consolas,monospace;word-break:break-all;max-height:50px;overflow:hidden">${esc(c.prompt||'')}</div>
    </div>
  </div>`;
}

function 캐릭터카드(c){
  const 뽑힘 = (작.pickedChars||[]).includes(c.id);
  return `<div onclick="캐릭터고르기('${c.id}')"
    ondragover="event.preventDefault()" ondrop="항목그림떨구기(event,'char','${c.id}')"
    style="cursor:pointer;border-radius:10px;overflow:hidden;position:relative;
      background:${뽑힘?'var(--cybg)':'var(--card2)'};
      border:1px solid ${뽑힘?'var(--cy)':'var(--line2)'}">
    <div style="position:absolute;top:6px;right:6px;display:flex;gap:4px;z-index:2">
      <button class="btn sm gh" style="padding:2px 7px" onclick="event.stopPropagation();캐릭터고치기('${c.id}')">✎</button>
      <button class="btn sm gh" style="padding:2px 7px" onclick="event.stopPropagation();내항목지우기('char','${c.id}')">✕</button>
    </div>
    ${그림칸(c.img, 124)}
    <div style="padding:12px 14px">
      <div style="font-size:15px;font-weight:600;color:${뽑힘?'var(--cy2)':'var(--tx)'}">${esc(c.name)}</div>
      <div style="font-size:11.5px;color:var(--tx3);line-height:1.6;margin-top:5px;
        font-family:Consolas,monospace;word-break:break-all;max-height:50px;overflow:hidden">${esc(c.prompt||'')}</div>
    </div>
  </div>`;
}

async function 내화풍추가(){
  const name = prompt('화풍 이름 (예: 경제3-코난)'); if(!name) return;
  const p = prompt('영문 설명 (그림을 어떻게 그릴지)\n예) retro 70s 80s japanese cel animation style, classic adventure tv anime look');
  if(p===null) return;
  await api('item/save', {kind:'style', item:{name, prompt:p}});
  await 항목불러오기(); 그리기(); toast(`내 화풍 「${name}」 등록했어. 카드에 그림을 끌어다 놓으면 미리보기가 붙어`);
}
async function 내화풍고치기(id){
  const c = 내화풍.find(x=>x.id===id);
  const name = prompt('화풍 이름', c.name); if(name===null) return;
  const p = prompt('영문 설명', c.prompt||''); if(p===null) return;
  await api('item/save', {kind:'style', item:{id, name, prompt:p, img:c.img}});
  await 항목불러오기(); 그리기(); toast('고쳤어');
}
async function 캐릭터추가(){
  const name = prompt('캐릭터 이름 (예: 진행자)'); if(!name) return;
  const p = prompt('외모를 영문으로\n예) a Korean male news anchor in his 40s, navy suit, short black hair');
  if(p===null) return;
  await api('item/save', {kind:'char', item:{name, prompt:p}});
  await 항목불러오기(); 그리기(); toast(`캐릭터 「${name}」 등록했어`);
}
async function 캐릭터고치기(id){
  const c = 캐릭터들.find(x=>x.id===id);
  const name = prompt('캐릭터 이름', c.name); if(name===null) return;
  const p = prompt('외모 (영문)', c.prompt||''); if(p===null) return;
  await api('item/save', {kind:'char', item:{id, name, prompt:p, img:c.img}});
  await 항목불러오기(); 그리기(); toast('고쳤어');
}
async function 내항목지우기(kind, id){
  if(!confirm('지울까?')) return;
  await api('item/del', {kind, id}); await 항목불러오기(); 그리기(); toast('지웠어');
}
async function 캐릭터고르기(id){
  const 고른 = new Set(작.pickedChars||[]);
  고른.has(id) ? 고른.delete(id) : 고른.add(id);
  await 저장({pickedChars:[...고른]}); await 저장지금();
  프롬프트다시짜기(); 그리기();
}

function 항목그림떨구기(ev, kind, id){
  ev.preventDefault(); ev.stopPropagation();
  const f=(ev.dataTransfer.files||[])[0];
  if(!f||!f.type.startsWith('image/')){ toast('그림 파일만 돼',true); return; }
  const fr=new FileReader();
  fr.onload=()=>{ const im=new Image();
    im.onload=async()=>{
      const W=480,H=Math.round(im.height*W/im.width);
      const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
      cv.getContext('2d').drawImage(im,0,0,W,H);
      const 표 = kind==='style'?내화풍:캐릭터들;
      const c = 표.find(x=>x.id===id);
      await api('item/save', {kind, item:{...c, img:cv.toDataURL('image/jpeg',0.82)}});
      await 항목불러오기(); 그리기(); toast('그림 넣었어');
    }; im.src=fr.result; };
  fr.readAsDataURL(f);
}

/* 고른 캐릭터들의 외모를 모아 한 줄로 */
function 캐릭터문구(){
  const 고른 = 작.pickedChars||[];
  return 캐릭터들.filter(c=>고른.includes(c.id)).map(c=>c.prompt).filter(Boolean).join(', ');
}

function 화풍카드(s){
  const 뽑힘 = 작.style===s.id;
  const 그림 = 예시그림[s.id];
  return `
  <div onclick="화풍고르기('${s.id}')"
    ondragover="event.preventDefault();this.style.borderColor='var(--cy)'"
    ondragleave="this.style.borderColor='${뽑힘?'var(--cy)':'var(--line2)'}'"
    ondrop="예시떨구기(event,'${s.id}')"
    style="cursor:pointer;border-radius:10px;overflow:hidden;
      background:${뽑힘?'var(--cybg)':'var(--card2)'};
      border:1px solid ${뽑힘?'var(--cy)':'var(--line2)'}">

    <div style="height:124px;background:#0b0b0e;display:flex;align-items:center;justify-content:center;
         border-bottom:1px solid var(--line);position:relative">
      ${그림 ? `<img src="${그림}" style="width:100%;height:100%;object-fit:cover">`
             : `<div style="text-align:center;color:var(--tx3);font-size:11.5px;line-height:1.6">
                  예시 이미지 없음<br>
                  <span style="font-size:10.5px">그림을 여기로 끌어다 놔</span>
                </div>`}
      ${그림?`<button class="btn sm gh" style="position:absolute;top:6px;right:6px;padding:2px 7px"
          onclick="event.stopPropagation();예시지우기('${s.id}')">✕</button>`:''}
    </div>

    <div style="padding:12px 14px">
      <div style="font-size:15px;font-weight:600;color:${뽑힘?'var(--cy2)':'var(--tx)'}">${esc(s.이름)}</div>
      <div style="font-size:12px;color:var(--tx2);line-height:1.6;margin-top:5px;min-height:38px">${esc(s.설명)}</div>
      ${s.통합?`<div style="display:inline-block;margin-top:8px;font-size:10.5px;line-height:1.5;
        color:#9fd4f5;background:#102a3c;border:1px solid #1d4a68;border-radius:5px;
        padding:3px 7px">통합: ${esc(s.통합)}</div>`:''}
    </div>
  </div>`;
}

/* 화풍을 고르면 — 이미 만들어 둔 컷 프롬프트를 전부 그 화풍으로 다시 짠다 */
function 화풍찾기(id){
  if(!id) return null;
  if(id.startsWith('my:')){
    const c = 내화풍.find(x=>'my:'+x.id===id);
    return c ? {이름:c.name, 영문:c.prompt||''} : null;
  }
  const s = 화풍목록.find(x=>x.id===id);
  return s ? {이름:s.이름, 영문:s.영문} : null;
}

/* 고른 화풍·캐릭터로 모든 컷 프롬프트를 다시 짠다 */
function 프롬프트다시짜기(){
  const s = 화풍찾기(작.style);
  const 인물 = 캐릭터문구();
  작.prompts = (작.prompts||[]).map(p=>{
    const 원 = p.원문 || p.영문.split(',')[0].trim();
    return {번호:p.번호, 묘사:p.묘사, 원문:원,
            영문:[원, 인물, s?s.영문:'', 공통규격].filter(Boolean).join(', ')};
  });
}

async function 화풍고르기(id){
  작.style = id;
  const n = (작.prompts||[]).length;
  프롬프트다시짜기();
  await 저장({style:id, prompts:작.prompts||[]});
  await 저장지금(); 기둥그리기(); 그리기();
  const s = 화풍찾기(id);
  toast(n ? `${s.이름} — 컷 ${n}개 프롬프트를 다시 짰어` : `${s.이름} 으로 정했어`);
}

/* 예시 그림 — 끌어다 놓으면 줄여서 저장한다 */
function 예시떨구기(ev, id){
  ev.preventDefault(); ev.stopPropagation();
  const f = (ev.dataTransfer.files||[])[0];
  if(!f || !f.type.startsWith('image/')){ toast('그림 파일만 돼', true); return; }
  const fr = new FileReader();
  fr.onload = ()=>{
    const im = new Image();
    im.onload = async ()=>{
      const W = 480, H = Math.round(im.height * W / im.width);
      const cv = document.createElement('canvas'); cv.width=W; cv.height=H;
      cv.getContext('2d').drawImage(im,0,0,W,H);
      const d = cv.toDataURL('image/jpeg', 0.82);
      예시그림[id] = d;
      await api('style/sample', {id, data:d});
      그리기(); toast('예시 그림 넣었어');
    };
    im.src = fr.result;
  };
  fr.readAsDataURL(f);
}
async function 예시지우기(id){
  delete 예시그림[id];
  await api('style/sample', {id, data:''});
  그리기(); toast('지웠어');
}

function 예시질문복사(){
  복사(`아래 12가지 화풍으로 "똑같은 한 장면"을 각각 그릴 것이다.
비교해 보려는 것이므로 장면 내용은 전부 같아야 한다.

[공통 장면]
a quiet Korean village street in the afternoon, traditional tiled roof houses on both sides,
one person walking away from the camera, distant mountains, soft daylight

[화풍별 프롬프트]
${화풍목록.map((s,i)=>`${i+1}. ${s.이름}
${s.영문}, ${공통규격}`).join('\n\n')}`, '예시 프롬프트 12개를 복사했어');
}

/* ══ 4 스토리보드 ══ */
본문.storyboard = ()=>`
  <div class="h1">스토리보드</div>
  <div class="h1sub">대본 내용을 장면 묘사와 영문 이미지 프롬프트로 만들어줍니다.
    화풍·캐릭터 정보가 함께 반영되며, 별도 API 키는 필요 없어요.</div>

  ${(작.script||'').trim().length<50 ? `<div class="note">대본이 아직 비어 있어. <b>대본</b>부터 채워줘.</div>` : ''}

  <div class="card">
    <h3>섹션 설정</h3>

    <div style="display:flex;align-items:center;gap:14px;margin:16px 0 6px">
      <span class="lab" style="width:104px">장면 목표 길이</span>
      <b id="목표값" style="width:46px;font-size:15px">${작.target||13}초</b>
      <input type="range" id="t" min="6" max="30" step="1" value="${작.target||13}"
        oninput="document.getElementById('목표값').textContent=this.value+'초';컷그리기()"
        style="flex:1;max-width:380px;accent-color:var(--cy)">
      <span id="장면수" style="color:var(--cy2);font-size:13px;white-space:nowrap">장면 약 –개</span>
      <button class="btn sm" onclick="컷그리기()">이 길이로 재생성</button>
    </div>

    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:14px 0 10px">
      <span class="lab" style="width:104px">구간별 길이</span>
      ${[['hk','후킹','#f59e0b',작.hook||8],['bd','본문','#38bdf8',작.target||13],
         ['em','강조','#a78bfa',작.emph||작.target||13],['ed','마무리','#34d399',작.endl||작.target||13]]
        .map(([id,ko,col,v])=>`
        <span style="display:flex;align-items:center;gap:6px">
          <span style="color:${col}">●</span><b style="font-size:13px">${ko}</b>
          <input class="in" id="${id}" value="${v}" style="width:62px;text-align:center;padding:6px"
            oninput="컷그리기()"><span style="font-size:12px;color:var(--tx3)">초</span>
        </span>`).join('')}
    </div>

    <div style="font-size:12.5px;color:var(--cy2);line-height:1.75;margin-bottom:16px" id="구성글">
      비우면 위 목표 길이를 따릅니다. 훅(첫 2분)만 촘촘하게 두면 좋아요 —
      실측상 그림 수는 조회수와 무관하지만 훅만은 예외였습니다.
    </div>

    <div style="display:flex;align-items:center;margin-bottom:9px">
      <span class="lab">타임라인</span>
      <div style="margin-left:auto;display:flex;gap:7px;align-items:center">
        <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--tx2);cursor:pointer">
          <input type="checkbox" id="cta" ${작.skipCta!==false?'checked':''} onchange="컷그리기()">
          구독·좋아요 문단은 그림 안 만들기</label>
        <button class="btn sm" onclick="자동설정()">자동설정</button>
      </div>
    </div>
    <div id="타임라인"></div>
    <div style="font-size:12px;color:var(--tx3);margin-top:8px">
      <span style="color:#f59e0b">■</span> 후킹
      <span style="color:#38bdf8;margin-left:12px">■</span> 본문
      <span style="color:#a78bfa;margin-left:12px">■</span> 강조
      <span style="color:#34d399;margin-left:12px">■</span> 마무리
    </div>
  </div>

  <div class="card">
    <div style="display:flex;align-items:center;margin-bottom:10px">
      <h3 style="margin:0">장면</h3>
      <div style="margin-left:auto;font-size:12.5px;color:var(--tx3)" id="장면총수"></div>
    </div>
    <div id="컷목록"></div>
    <div style="text-align:center;margin-top:12px">
      <a href="#" id="상세보기" onclick="상세토글();return false"></a>
    </div>
  </div>

  <div class="card">
    <h3>생성 상태</h3>
    <div style="font-size:13px;margin-top:8px" id="생성상태">
      아래 스토리보드 생성 버튼을 누르면 자막을 장면으로 나누고 장면별 묘사를 만듭니다.
    </div>
  </div>

  <div class="navbar">
    <button class="btn" onclick="이동('voice')">이전</button>
    <div class="sp"></div>
    <button class="btn cy" onclick="스토리보드생성()">스토리보드 생성</button>
    <button class="btn cy" onclick="이동('image')">다음</button>
  </div>`;

let 다펼침 = false;
function 상세토글(){ 다펼침 = !다펼침; 카드그리기(); }

function 칸채우기(v){
  ['bd','em','ed'].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=v; });
}
function 자동설정(){
  document.getElementById('t').value = 13;
  document.getElementById('목표값').textContent = '13초';
  document.getElementById('hk').value = 8;
  칸채우기(13);
  컷그리기(); toast('영상 실측값으로 맞췄어 (목표 13초 · 후킹 8초)');
}

const 구간색 = {'후킹':'#f59e0b','본문':'#38bdf8','강조':'#a78bfa','마무리':'#34d399'};
let 미리컷 = [];

let 컷타이머 = null;
async function 컷그리기(){
  clearTimeout(컷타이머);
  컷타이머 = setTimeout(진짜컷그리기, 180);
}

async function 진짜컷그리기(){
  const 목록=document.getElementById('컷목록'); if(!목록) return;
  if(!(작.script||'').trim()){
    목록.innerHTML=`<div class="empty">대본이 없어. 대본 단계부터 채워줘.</div>`;
    document.getElementById('타임라인').innerHTML =
      `<div style="background:var(--card2);border:1px solid var(--line2);border-radius:7px;
        padding:16px;text-align:center;color:var(--tx3);font-size:12.5px">
        스토리보드를 생성하면 타임라인이 표시됩니다.</div>`;
    return;
  }
  const 값 = id => +(document.getElementById(id)||{}).value || 0;
  const r = await api('cut', { script:작.script||'',
    target:값('t'), hook:값('hk'), emph:값('em'), endl:값('ed'),
    skipCta:document.getElementById('cta').checked });
  미리컷=r.컷; const s=r.요약;

  document.getElementById('장면수').textContent = `장면 약 ${s.컷수}개`;
  const g = s.구간별||{};
  document.getElementById('구성글').innerHTML =
    `= 후킹 ${g.후킹||0}장 + 본문 ${g.본문||0}장 + 강조 ${g.강조||0}장 + 마무리 ${g.마무리||0}장.
     비우면 위 목표 길이를 따릅니다. 훅(첫 2분)만 촘촘하게 두면 좋아요 —
     실측상 그림 수는 조회수와 무관하지만 훅만은 예외였습니다.`;
  document.getElementById('생성상태').innerHTML =
    `장면 <b style="color:var(--cy2)">${s.컷수}개</b> · 전체 ${s.전체분}분 · 평균 ${s.평균컷초}초.
     아래 <b>스토리보드 생성</b>을 누르면 이대로 확정됩니다.`;

  const 전체=s.전체초||1;
  document.getElementById('타임라인').innerHTML =
    `<div style="display:flex;height:26px;border-radius:5px;overflow:hidden;border:1px solid var(--line2)">`+
    미리컷.map(c=>`<div title="${c.번호}번 · ${c.길이초}초"
      style="width:${(c.길이초/전체*100).toFixed(3)}%;background:${구간색[c.구간]};border-right:1px solid rgba(0,0,0,.45)"></div>`).join('')+`</div>`;
  카드그리기();
}

/* 장면 카드 — 3칸 격자. 원본 그대로. */
function 카드그리기(){
  const 목록 = document.getElementById('컷목록'); if(!목록) return;
  const cs = 미리컷;
  const 묘사표 = {};
  (작.scenes||[]).forEach(x=>묘사표[x.번호]=x.묘사);

  const 보일것 = 다펼침 ? cs : cs.slice(0, 9);
  목록.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(282px,1fr));gap:12px">` +
    보일것.map(c=>{
      const 묘 = 묘사표[c.번호];
      const 글 = 묘 || c.대본;
      const 색 = 구간색[c.구간];
      return `<div style="background:var(--card2);border:1px solid var(--line2);border-radius:9px;padding:12px 14px">
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:9px">
          <span style="background:${색}22;color:${색};border:1px solid ${색}55;border-radius:5px;
            padding:1px 7px;font-size:12px;font-weight:700">${c.번호}</span>
          <span style="background:${색}22;color:${색};border-radius:5px;padding:1px 8px;font-size:11.5px">${c.구간}</span>
          <span style="margin-left:auto;font-size:11.5px;color:var(--tx3)">${c.시작초.toFixed(1)}s ~ ${c.끝초.toFixed(1)}s</span>
        </div>
        <div style="font-size:12.5px;line-height:1.7;color:${묘?'var(--tx)':'var(--tx2)'};
          ${다펼침?'':'max-height:72px;overflow:hidden'}">${esc(글)}</div>
        ${묘?'':`<div style="margin-top:7px;font-size:11px;color:var(--tx3)">↑ 대본 토막 (장면 묘사 아직 없음)</div>`}
      </div>`;
    }).join('') + `</div>`;

  document.getElementById('장면총수').textContent = `${cs.length}장면`;
  const a = document.getElementById('상세보기');
  if(a) a.textContent = 다펼침 ? `접기 ∧` : `상세보기 (전체 ${cs.length}장면) ∨`;
}

/* 스토리보드 생성 = ① 컷 자르기 ② 컷마다 장면 묘사 쓰기
   ②는 클로드가 해야 한다. 질문을 만들어 주고 받아 넣는다. */
async function 스토리보드생성(){
  if(!미리컷.length){ toast('자를 대본이 없어', true); return; }
  const 값 = id => +(document.getElementById(id)||{}).value || 0;
  await 저장({ cuts:미리컷, target:값('t'), hook:값('hk'), emph:값('em'), endl:값('ed'),
               skipCta:document.getElementById('cta').checked });
  await 저장지금(); 기둥그리기();

  document.getElementById('생성상태').innerHTML = `
    <div style="color:var(--cy2);font-weight:600;margin-bottom:8px">
      ① 장면 ${미리컷.length}개로 나눴습니다.</div>
    <div style="color:var(--tx2);line-height:1.8;margin-bottom:12px">
      ② 이제 <b>컷마다 장면 묘사</b>를 써야 합니다. 이건 클로드가 합니다.<br>
      아래 단추를 눌러 질문을 복사하고, 클로드에 붙여넣은 뒤 결과를 다시 붙여넣으세요.
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <button class="btn cy" onclick="묘사질문복사()">📋 장면 묘사 질문 복사</button>
      <button class="btn" onclick="묘사넣기칸()">받은 결과 붙여넣기</button>
    </div>
    <div id="묘사칸" style="margin-top:12px"></div>`;
  카드그리기();
  toast(`스토리보드가 확정되었습니다 — 장면 ${미리컷.length}개`);
}

function 묘사넣기칸(){
  document.getElementById('묘사칸').innerHTML = `
    <textarea class="ta" id="sc" style="min-height:150px"
      placeholder="1 | 해커가 어두운 방에서 거대한 기업 빌딩의 보안망을 상징하는 격자 방벽을 노려본다 | a hacker in a dark room..."></textarea>
    <div style="margin-top:9px"><button class="btn cy" onclick="묘사넣기()">넣기</button></div>`;
  document.getElementById('sc').focus();
}

async function 묘사넣기(){
  const out=[];
  for(const l of document.getElementById('sc').value.split('\n')){
    const m=l.trim().split('|').map(x=>x.trim());
    if(m.length<2) continue;
    const n=parseInt(m[0].replace(/[^0-9]/g,''),10);
    if(!n) continue;
    out.push({번호:n, 묘사:m[1], 원문:m[2]||''});
  }
  if(!out.length){ toast('읽을 줄이 없어. 「번호 | 묘사 | 영문」 모양이어야 해', true); return; }
  out.sort((a,b)=>a.번호-b.번호);

  // 영문이 같이 왔으면 프롬프트까지 바로 만든다
  const s = 화풍찾기(작.style), 인물 = 캐릭터문구();
  const 프 = out.filter(x=>x.원문).map(x=>({
    번호:x.번호, 묘사:x.묘사, 원문:x.원문,
    영문:[x.원문, 인물, s?s.영문:'', 공통규격].filter(Boolean).join(', ')}));

  await 저장({scenes:out, prompts: 프.length?프:(작.prompts||[])});
  await 저장지금(); 기둥그리기(); 카드그리기();
  document.getElementById('생성상태').innerHTML =
    `<div style="color:#4ade80;font-weight:600">작업 완료됨</div>
     <div style="color:var(--tx3);font-size:12.5px;margin-top:5px">생성 방식: AI (claude)</div>
     ${프.length?`<div style="color:var(--tx2);font-size:12.5px;margin-top:7px">
       영문 프롬프트 ${프.length}개도 같이 만들었어. <b>이미지</b> 단계에서 확인해.</div>`:''}`;
  toast(`장면 묘사 ${out.length}개 넣었어`);
}

/* ══ 5 이미지 ══ */
본문.image = ()=>{
  const cs=작.cuts||[], s=화풍찾기(작.style);
  return `
  <div class="h1">이미지</div>
  <div class="h1sub">컷마다 <b>영문 이미지 프롬프트</b>를 만든다. 장면 ${cs.length}개 = 그림 ${cs.length}장.</div>

  ${!cs.length?`<div class="note"><b>4단계 스토리보드</b>에서 컷을 먼저 확정해줘.</div>`:''}
  ${!s?`<div class="note"><b>3단계 스타일</b>에서 화풍을 먼저 골라줘. 고른 화풍이 프롬프트 뒤에 붙어.</div>`
      :`<div class="hint" style="margin-bottom:14px">화풍: <b style="color:var(--cy2)">${esc(s.이름)}</b> — 프롬프트 뒤에 자동으로 붙어</div>`}

  <div class="card">
    <div class="corner">클로드에 붙여넣기</div>
    <h3>① 장면 묘사 만들기</h3>
    <div class="desc">컷 대본을 읽고 <b>그 컷에 맞는 그림</b>을 묘사하게 시킨다.</div>
    <button class="btn cy" onclick="묘사질문복사()" ${cs.length?'':'disabled'}>📋 질문 복사하기</button>
  </div>

  <div class="card">
    <h3>② 받은 결과 붙여넣기</h3>
    <div class="desc">한 줄에 컷 하나씩. <code>번호 | 장면 묘사 | 영문 프롬프트</code></div>
    <textarea class="ta" id="pr" style="min-height:150px"
      placeholder="1 | 해커가 어두운 방에서 거대한 기업 빌딩의 보안망을 노려본다 | a hacker in a dark room staring at a giant corporate firewall grid"></textarea>
    <div style="margin-top:10px"><button class="btn cy" onclick="프롬프트넣기()">넣기</button></div>
  </div>

  ${(작.prompts&&작.prompts.length)?`
  <div class="card">
    <div class="corner">${작.prompts.length}장</div>
    <h3>만들어진 프롬프트</h3>
    <div style="margin:10px 0"><button class="btn" onclick="전체프롬프트복사()">📋 영문 프롬프트 전부 복사</button></div>
    ${작.prompts.map(p=>`
      <div style="display:flex;gap:12px;padding:11px 0;border-top:1px solid var(--line)">
        <div style="width:30px;flex-shrink:0;text-align:center;font-weight:700;color:var(--cy2);font-size:14px">${p.번호}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;line-height:1.65">${esc(p.묘사)}</div>
          <div style="font-size:12px;color:var(--tx3);margin-top:6px;line-height:1.6;
            font-family:Consolas,monospace;word-break:break-all">${esc(p.영문)}</div>
        </div>
      </div>`).join('')}
  </div>`:''}`;
};

function 묘사질문복사(){
  const cs=(작.cuts&&작.cuts.length)?작.cuts:미리컷;
  if(!cs.length){ toast('먼저 스토리보드를 생성해줘', true); return; }
  복사(`아래는 영상 대본을 ${cs.length}개의 컷으로 나눈 것이다.
컷마다 그 내용에 어울리는 그림을 하나씩 만들려고 한다.

각 컷에 대해 아래 형식으로 정확히 한 줄씩 출력해라. 설명이나 머리말은 쓰지 마라.

번호 | 장면 묘사(한국어 한 문장) | 영문 이미지 프롬프트

규칙
- 장면 묘사는 그 컷의 대본 내용을 그림으로 옮긴 것이어야 한다. 새 내용을 지어내지 마라.
- 영문 프롬프트에 화풍은 넣지 마라. 내가 따로 붙인다.
- 영문 프롬프트에 글자·자막·워터마크를 넣으라는 말은 쓰지 마라.
- 인물이 반복해 나오면 같은 외모로 묘사해 일관성을 지켜라.

[컷 목록]
${cs.map(c=>`${c.번호}. (${c.길이초}초) ${c.대본}`).join('\n')}`, `컷 ${cs.length}개짜리 질문을 복사했어`);
}

async function 프롬프트넣기(){
  const s=화풍찾기(작.style);
  if(!s){ toast('먼저 스타일에서 화풍을 골라줘', true); return; }
  const 인물=캐릭터문구();
  const out=[];
  for(const l of document.getElementById('pr').value.split('\n')){
    const m=l.trim().split('|').map(x=>x.trim());
    if(m.length<3) continue;
    const n=parseInt(m[0].replace(/[^0-9]/g,''),10);
    if(!n) continue;
    out.push({번호:n, 묘사:m[1], 원문:m[2],
      영문:[m[2], 인물, s.영문, 공통규격].filter(Boolean).join(', ')});
  }
  if(!out.length){ toast('읽을 줄이 없어. 「번호 | 묘사 | 영문」 모양이어야 해', true); return; }
  out.sort((a,b)=>a.번호-b.번호);
  await 저장({prompts:out}); await 저장지금(); 기둥그리기(); 그리기();
  toast(`프롬프트 ${out.length}개 넣었어`);
}
function 전체프롬프트복사(){
  복사((작.prompts||[]).map(p=>`${p.번호}. ${p.영문}`).join('\n\n'), '전부 복사했어');
}

/* ══ 6 영상 ══ */
본문.video = ()=>`
  <div class="h1">영상</div>
  <div class="h1sub">그림 + 음성 + 자막을 붙여서 mp4 하나로 만든다.</div>
  <div class="note">아직 안 만든 단계야 (다음 차수).</div>
  <div class="card">
    <h3>무엇이 들어갈 예정인가</h3>
    <div style="font-size:13px;color:var(--tx2);line-height:2">
      • 컷마다 그림 올리기 (끌어다 놓기 / 이미지 교체)<br>
      • 그림을 컷 길이에 맞춰 이어 붙이기<br>
      • 음성 얹기<br>
      • <b>자막을 화면에 굽기</b><br>
      • 1920×1080 mp4 로 내보내고 [폴더 열기]
    </div>
  </div>`;

/* ══ 7 완성 ══ */
본문.export = ()=>`
  <div class="h1">완성 <span class="badge unverified">원본 미확인</span></div>
  <div class="h1sub">레퍼런스 영상 4편 어디에도 이 화면이 열리지 않았어. 끝까지 회색이었어.</div>
  <div class="note">그래서 이 단계만은 <b>내가 추측해서</b> 만들게 돼.
    나중에 원본을 보면 바로 고칠 수 있게 「원본 미확인」으로 표시해 둬.</div>
  <div class="card">
    <h3>예상되는 것</h3>
    <div style="font-size:13px;color:var(--tx2);line-height:2">
      • 제목 · 설명 · 태그 만들기<br>
      • 썸네일 만들기<br>
      • 유튜브 올리기
    </div>
  </div>`;

/* ── 시작 ─────────────────────────────── */
(async ()=>{
  try { await 불러오기(); 작업목록(); }
  catch(e){ document.getElementById('main').innerHTML =
    `<div class="empty">서버에 닿지 못했어.<br>검은 창을 닫지 말고 열어둔 채로 다시 열어줘.</div>`; }
})();
