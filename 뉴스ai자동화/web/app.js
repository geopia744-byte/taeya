/* 뉴스ai자동화 — 레퍼런스 영상의 7단계 그대로
   메뉴 7개. 어느 것을 눌러도 독립해서 들어간다.

   숫자는 영상 실측: 대본 4,621자 = 9분 = 43컷 → 513자/분, 107자/컷 */

const 자당분 = 513;
const 컷당자 = 107;

let 작업들 = [];
let 예시그림 = {};   // {화풍id: dataURL}
let 클로드있나 = false;
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
  내화풍 = r.myStyles || []; 캐릭터들 = r.chars || []; 클로드있나 = !!r.claude;
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
  if(현재==='script'){ 글자세기(); 본문칸열기(); 어미보기(); 분량안내(); 배율안내(); }
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

    <textarea class="ta" id="url" style="min-height:58px;margin-bottom:7px"
      placeholder="참고 유튜브·뉴스 URL (선택, 한 줄에 하나씩)"
      oninput="저장({url:this.value})">${esc(작.url||'')}</textarea>
    <div style="display:flex;align-items:center;gap:9px;margin-bottom:12px">
      <button class="btn sm" onclick="기사확인()">🔍 기사 읽어오기</button>
      <span class="hint" id="기사상태" style="margin:0">주소를 넣고 눌러봐. 기사 본문을 가져와서 대본의 근거로 쓴다.</span>
    </div>
    <div id="본문칸"></div>
    <input class="in" id="topic" style="margin-bottom:12px" placeholder="주제/소재 (예: 인공지능 해킹)"
      value="${esc(작.topic||'')}" oninput="저장({topic:this.value})">

    <div class="row">
      <span class="lab">카테고리</span>
      <select class="sel" id="genre" onchange="장르바꿈(this.value)">
        ${장르목록.map(g=>`<option value="${g.id}" ${(작.genre||'econ')===g.id?'selected':''}>${esc(g.이름)}</option>`).join('')}
      </select>
      <span style="font-size:12px;color:var(--tx3)">고르면 아래 말투가 그 장르에 맞게 바뀐다</span>
    </div>

    <div class="row">
      <span class="lab">문장 끝맺음</span>
      <select class="sel" id="ending" onchange="저장({ending:this.value});어미보기()">
        ${어미목록.map(e=>`<option value="${e.id}" ${(작.ending||'jon')===e.id?'selected':''}>${esc(e.이름)}</option>`).join('')}
      </select>
      <span style="font-size:12px;color:var(--tx3)" id="어미글">　</span>
      <label style="display:flex;align-items:center;gap:7px;font-size:13px;color:var(--tx2);cursor:pointer">
        <input type="checkbox" id="useCta" ${작.useCta?'checked':''}
          onchange="저장({useCta:this.checked})"> 구독 유도 문장 넣기
      </label>
    </div>

    <div class="row">
      <span class="lab">근거 범위</span>
      <select class="sel" id="scope" onchange="저장({scope:this.value});배율안내()">
        <option value="only" ${(작.scope||'only')==='only'?'selected':''}>기사만 쓰기 (안전)</option>
        <option value="bg"   ${작.scope==='bg'?'selected':''}>기사 + 스스로 조사 (깊이)</option>
      </select>
      <span style="font-size:12px;color:var(--tx3)" id="범위글">　</span>
    </div>
    <div id="배율판" style="margin-top:10px"></div>

    <div class="row">
      <span class="lab">분량</span>
      <select class="sel" id="minutes" onchange="저장({minutes:+this.value});분량안내();배율안내()">
        ${[5,9,10,15,20,30,45,60].map(v=>`<option value="${v}" ${(작.minutes||9)===v?'selected':''}>${v}분</option>`).join('')}
      </select>
      <input class="in" id="chars" style="width:168px" placeholder="글자수 직접(선택)"
        value="${작.chars2?esc(작.chars2):''}" oninput="저장({chars2:this.value});분량안내();배율안내()">
      <button class="btn cy" id="genBtn" onclick="대본생성()">대본 생성</button>
      <button class="btn" onclick="질문복사()">📋 질문만 복사</button>
    </div>
    <div class="hint" id="분량글">　</div>
    <div id="생성판" style="margin-top:12px"></div>
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
    <div style="display:flex;align-items:center;gap:8px;margin-top:9px">
      <button class="btn sm" onclick="대본복사()">📋 대본 복사</button>
      <button class="btn sm" onclick="대본내려받기()">⬇ txt로 저장</button>
      <button class="btn sm gh" onclick="대본비우기()">비우기</button>
      <div style="margin-left:auto" class="hint" id="글자">0자 / 60,000자</div>
    </div>
    <div style="margin-top:8px;font-size:13px" id="검사">　</div>
  </div>`;

/* 기사 분량 대비 목표 분량이 얼마나 되는지 미리 알려준다.
   레퍼런스 영상 실측: 기사 약 1,800자 → 대본 4,621자 ≈ 2.5배 */
function 배율안내(){
  const 판 = document.getElementById('배율판'); if(!판) return;
  const 범 = document.getElementById('범위글');
  if(범) 범.textContent = (작.scope==='bg')
    ? '같은 사건의 다른 기사와 배경을 스스로 찾아서 채운다. 핵심 수치는 내 기사 것만 쓴다'
    : '내가 준 기사에 있는 사실만 쓴다. 검색하지 않는다';

  const 기사 = (작.articleText||'').trim().length;
  if(!기사){ 판.innerHTML=''; return; }
  const 목표 = 목표글자수().자;
  const 배 = 목표/기사;
  const 알맞 = Math.round(기사*2.5);

  let 색, 말;
  if(배 <= 2){        색='#4ade80'; 말='넉넉해. 기사 내용이 충분히 담겨.'; }
  else if(배 <= 4){   색='#4ade80'; 말='적당해. 레퍼런스 영상도 이 범위였어 (약 2.5배).'; }
  else if(배 <= 8){   색='#fbbf24'; 말='묽어질 수 있어. 같은 사실을 여러 번 돌려 쓰게 돼.'; }
  else {              색='#ef4444'; 말='무리야. 같은 말을 되풀이하는 대본이 나와.'; }

  판.innerHTML = `
    <div style="background:var(--card2);border:1px solid ${색}44;border-left:3px solid ${색};
      border-radius:7px;padding:11px 14px;font-size:12.5px;line-height:1.75">
      기사 <b>${기사.toLocaleString()}자</b> → 대본 <b>${목표.toLocaleString()}자</b>
      · <b style="color:${색}">${배.toFixed(1)}배</b><br>
      <span style="color:${색}">${말}</span>
      ${(배 > 4 && 작.scope !== 'bg') ? `<br><span style="color:var(--tx2)">
        <b>근거 범위를 「기사 + 배경 조사」로 바꿔봐.</b>
        그러면 같은 사건을 다룬 다른 기사와 배경을 <b>스스로 찾아서</b> 채워.<br>
        그게 싫으면 분량을 <b>${(알맞/자당분).toFixed(0)}분(${알맞.toLocaleString()}자)</b>으로 줄이면 돼.</span>`
        : (배 > 4 ? `<br><span style="color:#4ade80">배경 조사가 켜져 있어 —
             다른 기사와 맥락을 스스로 찾아서 채울 거야. 대신 3~10분 더 걸려.</span>` : '')}
    </div>`;
}

/* 근거를 어디까지 쓸지 */
function 근거규칙(){
  if(작.scope === 'bg'){
    return `이 영상의 뼈대는 아래 [기사 본문]이다. 거기서 벗어나지 마라.
   다만 기사 하나만으로는 분량이 모자라다.
   그래서 너는 먼저 조사를 해야 한다.

   [먼저 할 일 — 대본을 쓰기 전에]
   WebSearch 와 WebFetch 를 써서 아래를 직접 찾아라. 나에게 묻지 말고 네가 찾아라.
     1) 같은 사건을 다룬 다른 언론사 기사 두세 건
     2) 이 사건의 앞뒤 맥락 — 전에 무슨 일이 있었고 앞으로 무엇이 예정돼 있는지
     3) 등장하는 회사·제도·기술이 무엇인지 (모르는 사람에게 설명할 수 있을 만큼)
     4) 비슷한 과거 사례 하나
   찾은 것을 모아 대본을 써라.

   [사실을 다루는 법]
   - 아래 [기사 본문]과 네가 찾은 기사가 어긋나면 [기사 본문]을 따라라.
   - 이번 사건의 핵심 수치(금액, 지분율, 날짜, 기수)는 [기사 본문]의 값을 그대로 써라.
     검색에서 본 다른 숫자로 바꾸지 마라.
   - 검색으로 알게 된 배경과 과거 사례는 써도 된다.
     다만 단정하지 말고 알려져 있습니다, 전해집니다 처럼 한 겹 눅여라.
   - 어느 쪽에서도 확인되지 않은 것은 쓰지 마라. 추측으로 메우지 마라.
   - 출처 목록이나 각주를 대본에 넣지 마라. 말로 자연스럽게 녹여라.`;
  }
  return `아래 [기사 본문]에 적힌 사실만 써라.
   날짜, 숫자, 인물, 기관 이름, 사건 내용을 네 기억으로 지어내지 마라.
   기사에 없는 통계나 사례를 만들어 붙이지 마라.
   기사에 없는 내용이 필요하면 그 부분을 쓰지 말고 넘어가라.
   비유와 설명은 네가 만들어도 되지만, 사실 주장은 반드시 기사에서 나와야 한다.
   검색하지 마라.`;
}

function 어미보기(){
  const e = 어미목록.find(x=>x.id===(작.ending||'jon'))||어미목록[0];
  const 칸 = document.getElementById('어미글');
  if(칸) 칸.innerHTML = `예) <span style="color:var(--cy2)">${esc(e.보기)}</span>`;
}

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

/* 장르를 고르면 말투가 그 장르 것으로 바뀐다 */
async function 장르바꿈(id){
  const g = 장르목록.find(x=>x.id===id);
  const 칸 = document.getElementById('tone');
  const 지금 = (칸.value||'').trim();
  const 다른장르말투 = 장르목록.some(x=>x.말투.trim() && x.말투.trim()===지금);
  if(!지금 || 다른장르말투){        // 비었거나 다른 장르 기본값이면 갈아끼운다
    칸.value = g.말투;
  } else if(g.말투.trim() && !confirm(`말투를 「${g.이름}」 기본값으로 바꿀까?\n\n지금 적어 둔 글은 사라져.`)){
    await 저장({genre:id}); 기둥그리기(); return;
  } else if(g.말투.trim()){
    칸.value = g.말투;
  }
  await 저장({genre:id, tone:칸.value});
  toast(`카테고리를 「${g.이름}」 로 바꿨어`);
}

/* 기사를 읽어서 본문을 가져온다. 가져온 본문이 대본의 근거가 된다. */
async function 기사확인(){
  const 줄 = (document.getElementById('url').value||'').split('\n').map(s=>s.trim()).filter(Boolean);
  const 칸 = document.getElementById('기사상태');
  if(!줄.length){
    칸.innerHTML='<span style="color:#fbbf24">주소를 먼저 넣어줘</span>';
    본문칸열기(); return;
  }
  칸.innerHTML = '<span style="color:var(--cy2)">읽어오는 중...</span>';

  const 모음 = [];
  let 실패 = null;
  for(const u of 줄.slice(0,3)){
    const r = await api('article/fetch', {url:u});
    if(r.ok) 모음.push(`■ ${r.제목||u}\n${r.본문}`);
    else 실패 = r.why;
  }

  if(모음.length){
    const 글 = 모음.join('\n\n────────\n\n');
    await 저장({articleText:글}); await 저장지금();
    칸.innerHTML = `<span style="color:#4ade80">✓ 기사 ${모음.length}건, ${글.length.toLocaleString()}자를 가져왔어</span>`;
    본문칸열기(글);
    toast(`기사 본문 ${글.length.toLocaleString()}자를 가져왔어`);
  }else{
    칸.innerHTML = `<span style="color:#fbbf24">✕ 못 읽었어 (${esc(실패||'')}) — 아래에 본문을 붙여넣어줘</span>`;
    본문칸열기();
  }
}

function 본문칸열기(글){
  const 칸 = document.getElementById('본문칸');
  const 이미 = document.getElementById('atext');
  if(이미){
    if(글!=null) 이미.value = 글;
    const n = (이미.value||'').trim().length;
    const 세기 = document.getElementById('본문세기');
    if(세기) 세기.innerHTML = 본문세기글(n);
    if(글==null) 이미.focus();
    return;
  }
  const 값 = 글!=null ? 글 : (작.articleText||'');
  칸.innerHTML = `
    <div style="margin-bottom:12px">
      <div style="display:flex;align-items:center;margin-bottom:6px">
        <div style="font-size:12.5px;color:var(--tx2)">기사 본문 <b style="color:var(--cy2)">— 이 글이 대본의 근거가 된다</b></div>
        <div style="margin-left:auto;font-size:12px" id="본문세기">${본문세기글((값||'').trim().length)}</div>
      </div>
      <textarea class="ta" id="atext" style="min-height:130px"
        placeholder="기사 화면에서 본문 글을 긁어다 그대로 붙여넣어."
        oninput="저장({articleText:this.value});본문세기갱신();배율안내()">${esc(값)}</textarea>
    </div>`;
  if(!값) document.getElementById('atext').focus();
}

function 본문세기글(n){
  if(n >= 150) return `<span style="color:#4ade80">✓ ${n.toLocaleString()}자 — 대본 쓸 수 있어</span>`;
  if(n > 0)    return `<span style="color:#fbbf24">${n.toLocaleString()}자 — 너무 짧아. 150자는 넘어야 해</span>`;
  return `<span style="color:#fbbf24">비어 있음 — 이게 없으면 대본을 못 만들어</span>`;
}
function 본문세기갱신(){
  const e = document.getElementById('atext'); if(!e) return;
  const 세기 = document.getElementById('본문세기');
  if(세기) 세기.innerHTML = 본문세기글((e.value||'').trim().length);
}

/* ── 대본 생성 — 클로드 코드를 직접 부른다 ── */
let 생성폴링 = null;

async function 대본생성(){
  const 판 = document.getElementById('생성판');
  const 단추 = document.getElementById('genBtn');

  // 이건 뉴스 자동화다. 기사 본문이 없으면 지어낸 대본이 나온다. 반드시 막는다.
  const 본문길이 = (작.articleText||'').trim().length;
  if(본문길이 < 150){
    const 주소 = (작.url||'').trim();
    판.innerHTML = `
      <div class="note" style="margin:0">
        <b>기사 본문이 없어. 이대로는 못 만들어.</b><br><br>
        이건 <b>뉴스</b> 자동화야. 기사가 근거인데 그게 없으면 클로드가
        <b>자기 기억으로 지어내.</b> 날짜·숫자·사건이 틀린 대본이 나와서
        뉴스 채널에는 올릴 수 없어.<br><br>
        ${주소
          ? `주소는 넣었는데 <b>본문을 아직 못 가져왔어.</b><br>
             아래 <b>[🔍 기사 읽어오기]</b> 를 눌러봐.
             그래도 안 되면 기사 화면에서 <b>글을 긁어다 붙여넣어줘.</b>`
          : `맨 윗칸에 <b>뉴스 기사 주소</b>를 넣고 <b>[🔍 기사 읽어오기]</b> 를 눌러줘.<br>
             주소가 안 먹으면 기사 본문을 <b>직접 붙여넣어도</b> 돼.`}
      </div>
      <div style="margin-top:10px;display:flex;gap:8px">
        <button class="btn cy" onclick="기사확인()">🔍 기사 읽어오기</button>
        <button class="btn" onclick="본문칸열기()">본문 직접 붙여넣기</button>
      </div>`;
    return;
  }

  const 질문 = 질문글();

  if(!클로드있나){
    판.innerHTML = `
      <div class="note" style="margin:0">
        <b>이 컴퓨터에서 클로드 코드를 찾지 못했어.</b><br>
        그래서 자동으로는 못 만들어. 두 가지 중 하나야.<br><br>
        <b>① 지금 바로</b> — 오른쪽 <b>[📋 질문만 복사]</b> 를 눌러 클로드에 붙여넣고,
        나온 대본을 아래 <b>대본 내용</b> 칸에 붙여넣으면 돼.<br>
        <b>② 자동으로 하려면</b> — PC에 클로드 코드를 깔고 이 프로그램을 다시 켜.
      </div>`;
    질문복사();
    return;
  }

  const r = await api('script/start', {id:작.id, prompt:질문, urls:(작.url||''), chars:목표글자수().자});
  if(!r.ok){ 판.innerHTML = `<div class="note" style="margin:0">${esc(r.why||'시작하지 못했어')}</div>`; return; }

  단추.disabled = true; 단추.textContent = '생성 중...';
  pill('대본 생성');
  clearInterval(생성폴링);
  생성폴링 = setInterval(생성확인, 2000);
  생성확인();
}

async function 생성확인(){
  const 판 = document.getElementById('생성판'); if(!판) { clearInterval(생성폴링); return; }
  const st = await api('script/status', {id:작.id});

  if(st.상태==='도는중'){
    const 분 = Math.floor((st.지난초||0)/60), 초 = (st.지난초||0)%60;
    판.innerHTML = `<div style="background:var(--card2);border:1px solid var(--line2);border-radius:8px;
      padding:13px 15px;font-size:13px">
      <b style="color:var(--cy2)">${esc(st.단계||'클로드가 대본을 쓰는 중')}...</b>
      <span style="color:var(--tx3);margin-left:8px">${분}분 ${초}초 지남</span>
      <div style="color:var(--tx3);font-size:12px;margin-top:6px">
        기사를 읽고 쓰느라 <b>3~10분</b>쯤 걸려. 이 창을 닫지 말고 그냥 둬.</div></div>`;
    return;
  }

  clearInterval(생성폴링); pill('');
  const 단추 = document.getElementById('genBtn');
  if(단추){ 단추.disabled = false; 단추.textContent = '대본 생성'; }

  if(st.상태==='끝'){
    const 글 = 다듬기(st.글);

    // 대본이 아니라 되묻는 글이면 칸에 집어넣지 않는다
    if(되묻는글인가(글)){
      판.innerHTML = `
        <div class="note" style="margin:0">
          <b>대본 대신 클로드가 되물어왔어.</b> 준 정보가 모자라서야.<br><br>
          <b>이렇게 해 봐</b><br>
          · <b>주제/소재</b> 칸을 채워줘 (예: 인공지능 해킹) — 이게 제일 잘 들어<br>
          · 기사 주소를 넣었다면 <b>[🔍 기사 읽어오기]</b> 을 먼저 눌러봐.
            못 읽으면 본문을 직접 붙여넣어야 해<br>
          · <b>말투</b> 칸도 비어 있으면 카테고리를 한 번 다시 골라줘<br><br>
          <details open><summary style="cursor:pointer;color:var(--cy2)">클로드가 되물은 내용</summary>
          <div style="margin-top:8px;font-size:12px;color:var(--tx2);white-space:pre-wrap;
            max-height:200px;overflow:auto;background:#0e0e11;padding:10px;border-radius:6px">${esc(글)}</div></details>
          <div style="margin-top:10px;padding-top:10px;border-top:1px solid #4a3c10">
            <b>그래도 안 되면 이걸 보내줘</b><br>
            프로그램 폴더 안에 주고받은 글이 그대로 남아 있어.<br>
            <code style="font-size:11.5px;color:#e3c988">data\\projects\\${esc(작.id)}\\진단\\</code><br>
            그 안의 <b>보낸질문.txt</b> 와 <b>받은답.txt</b> 두 개를 보내주면 원인을 찾을 수 있어.
          </div>
        </div>`;
      toast('대본이 아니라 되묻는 글이 왔어', true);
      return;
    }

    document.getElementById('script').value = 글;
    글자세기(); await 저장({script:글}); await 저장지금(); 기둥그리기();
    판.innerHTML = `<div style="color:#4ade80;font-size:13px">
      ✓ 대본 ${글.length.toLocaleString()}자를 받았어. 아래 편집창에서 다듬으면 돼.</div>`;
    toast(`대본 ${글.length.toLocaleString()}자 생성 완료`);
  } else if(st.상태==='실패'){
    판.innerHTML = `<div class="note" style="margin:0">
      <b>대본을 못 받았어.</b><br>
      <span style="font-family:Consolas,monospace;font-size:11.5px;color:#e3c988">${esc(st.오류||'')}</span><br><br>
      대신 <b>[📋 질문만 복사]</b> 로 받아올 수 있어.</div>`;
  }
}

/* 대본이 아니라 "뭘 쓸까요?" 하고 되묻는 글인가 */
function 되묻는글인가(t){
  const g = (t||'').trim();
  if(g.length < 700 && /[?？]/.test(g)) return true;          // 짧은데 물음표가 있다
  const 신호 = ['알려주세요','확인하고 싶','정보 주시면','어떤 주제','어떤 뉴스',
                '말씀해 주','정해 주시','선택해 주','무엇을 다룰','알려주시면'];
  const 걸림 = 신호.filter(w=>g.includes(w)).length;
  return 걸림 >= 2 && g.length < 1600;
}

/* 클로드가 앞뒤에 붙이는 인사말·따옴표 울타리를 걷어낸다 */
function 다듬기(t){
  t = (t||'').trim();
  t = t.replace(/^```[a-z]*\s*/i,'').replace(/```\s*$/,'');
  t = t.replace(/^(네[,.]?\s*|알겠습니다[,.]?\s*|여기\s*있습니다[.:]?\s*)/,'');
  return t.trim();
}

function pill(글){
  const p=document.getElementById('pill');
  if(!p) return;
  if(글){ document.getElementById('pillTx').textContent=글; p.classList.add('on'); }
  else p.classList.remove('on');
}

/* 롱폼 구조 — 분량에 맞춰 각 토막의 글자수를 계산해 준다 */
function 구조글(총자){
  const 구독넣나 = !!작.useCta;
  const 훅 = Math.round(총자*0.10), 예고 = Math.round(총자*0.05),
        씨 = 구독넣나 ? Math.round(총자*0.03) : 0,
        강조 = Math.round(총자*0.12), 끝 = Math.round(총자*0.06);
  const 본문 = 총자 - 훅 - 예고 - 씨 - 강조 - 끝;
  const 덩이 = Math.max(3, Math.round(본문/1400));
  let n = 0;
  const 번 = ()=>['①','②','③','④','⑤','⑥'][n++];

  return `[너는 지금 신문 기사를 쓰는 게 아니다]

유튜브는 사람이 손가락으로 넘기다가 멈추는 곳이다.
3초 안에 붙잡지 못하면 그냥 넘어간다. 끝까지 보게 만드는 게 전부다.
정보를 알려주는 글이 아니라, 끝까지 듣고 싶게 만드는 말을 써라.

[말이지 글이 아니다]
- 입으로 소리내어 읽었을 때 자연스러워야 한다. 눈으로 읽는 글이 아니다.
- 문장을 짧게 써라. 한 문장에 생각 하나만 담아라.
  긴 문장이 이어지면 듣는 사람이 놓친다.
- 여러분, 당신 처럼 사람을 불러라. 혼잣말하지 마라.
- 질문을 던져라. 듣는 사람 머릿속에 물음표를 만들어라.
- 그런데, 문제는 여기부터입니다, 자 그럼, 같은 말로 흐름을 꺾어라.

[숫자는 이 영상의 뼈대다 — 반드시 쓰되 이렇게 써라]
- 숫자를 피하지 마라. 금액, 비율, 기간, 증감률을 아끼지 말고 써라.
- 다만 숫자 하나에 반드시 하나를 붙여라. 둘 중 하나면 된다.
    (가) 비교 — 전년 대비 몇 퍼센트, 몇 배, 얼마에서 얼마로
    (나) 체감 — 그 돈이 얼마나 큰지 와닿는 비유 (아파트 몇 채 값, 직원 월급 몇 년치)
- 한 문장에 숫자를 셋 이상 넣지 마라. 귀로 들으면 하나도 안 남는다.
  숫자가 많으면 문장을 쪼개라.
- 어려운 단위는 바꿔 말하라. 27억달러라고만 하지 말고 우리 돈으로 얼마인지 함께 말하라.

[절대 쓰지 마라 — 이러면 사람들이 나간다]
- …에 따르면, …로 나타났다, …로 알려졌다 같은 보도체
- 숫자와 기관 이름을 한 문장에 줄줄이 늘어놓는 것 (숫자 자체가 아니라 나열이 문제다)
- 첫째, 둘째, 셋째 처럼 목차 읽어주는 말투
- 아무 감정도 이해관계도 없는 설명만 이어지는 문단

${번()} 후킹 (약 ${훅.toLocaleString()}자) — 여기서 거의 다 결판난다

   숫자는 적극적으로 써라. 다만 숫자만 읊지 마라. 그건 앵커 멘트다.
   숫자 옆에 그 숫자가 왜 놀라운지를 반드시 붙여라.
   아래 셋 중 가장 잘 맞는 하나를 골라 써라.

   (가) 상식 뒤집기
       다들 이렇게 알고 있죠. 그런데 사실은 정반대입니다. 식으로 간다.
   (나) 궁금증 구멍
       무슨 일이 벌어졌는지만 보여주고, 왜 그런지는 아직 말하지 마라.
       듣는 사람이 답을 알고 싶어 못 견디게 만들어라.
   (다) 내 이해관계
       이게 왜 당신 지갑, 당신 일자리, 당신 집값과 엮이는지 먼저 때려라.

   나쁜 예) 27억달러, 우리 돈으로 3조7000억원입니다. 지분 10퍼센트를 사려면 필요한 돈입니다.
            → 숫자만 읊었다. 왜 놀라운지가 없다.
   좋은 예) 3조7000억원. 중형 아파트 1만 채 값입니다.
            이 돈을 들여 우리가 사려는 건 땅도 공장도 아닙니다. 남의 회사 지분 10퍼센트입니다.
            → 숫자를 쓰되 크기를 체감시키고, 바로 의문을 던졌다.

${번()} 예고 (약 ${예고.toLocaleString()}자)
   - 오늘 풀어줄 것을 알리되, 답을 미리 말하지 마라.
   - 끝까지 봐야 할 이유 한 줄을 남겨라. (마지막에 가장 중요한 게 있다는 식)
${구독넣나 ? `
${번()} 구독 유도 (약 ${씨.toLocaleString()}자)
   - 짧게 한두 문장만. 길게 끌지 마라.
` : ''}
${번()} 본문 (약 ${본문.toLocaleString()}자, 덩어리 ${덩이}개)

   덩어리 하나하나를 이렇게 짜라. 설명을 늘어놓지 마라.
     1) 질문을 던진다 — 그런데 왜 하필 이 회사일까요
     2) 긴장을 만든다 — 여기에 걸림돌이 하나 있습니다
     3) 풀어준다 — 사실과 숫자는 여기서 쓴다
     4) 일상 비유로 못 박는다 — 쉽게 와닿는 그림 하나
     5) 다음으로 넘긴다 — 그런데 더 놀라운 건 따로 있습니다

   - 숫자는 반드시 비교 기준과 함께 말한다. 전년 대비, 몇 배, 얼마에서 얼마로.
   - 한 덩어리에 소주제 하나만. 덩어리 사이는 빈 줄로 나눈다.

${번()} 강조 (약 ${강조.toLocaleString()}자)
   - 여기가 이 영상의 꼭대기다. 가장 세게 쓴다.
   - 그래서 당신은 무엇을 해야 하는가를 분명히 짚어라.
   - 짧은 문장을 연달아 쓰면 힘이 실린다.

${번()} 마무리 (약 ${끝.toLocaleString()}자)
   - 앞으로 무엇을 지켜봐야 하는지 하나만 남겨라.
   - 여운이 남는 한 문장으로 끝내라. 요약하지 마라.

각 토막에 제목이나 번호를 쓰지 마라. 자연스럽게 이어지는 한 편의 말로 써라.${구독넣나 ? '' : `

[이 말들은 한 번도 쓰지 마라]
구독, 좋아요, 알림 설정, 하이프, 채널 추가, 댓글 달아 주세요,
영상이 도움이 되셨다면 — 시청자에게 무언가 눌러 달라는 문장을 쓰지 마라.`}`;
}

function 질문글(){
  const g = 목표글자수();
  const 장르 = (장르목록.find(x=>x.id===(작.genre||'econ'))||{}).이름 || '';
  return `너는 유튜브 롱폼 영상 대본 작가다. 아래 조건으로 대본을 써라.

[가장 중요한 규칙]
1. ${근거규칙()}
2. 되묻지 마라. 질문하지 마라. 확인을 구하지 마라.
   곧바로 대본 본문만 출력해라.
3. 머리말, 설명, 인사말, 마무리 인사를 쓰지 마라. 첫 글자부터 대본이어야 한다.

[카테고리]
${장르}

[참고 기사]
${작.url||'(없음)'}

[주제]
${작.topic||'(기사 내용에 따름)'}

[분량]
정확히 ${g.자.toLocaleString()}자 내외

[문장 끝맺음 — 이것은 아래 말투 설명보다 우선한다]
${(어미목록.find(x=>x.id===(작.ending||'jon'))||어미목록[0]).규칙}

[말투·스토리텔링 — 어떤 결로 이야기할지. 문장 끝맺음은 위 규칙을 따를 것]
${(작.tone||'').trim() || '- 차분하고 신뢰감 있는 뉴스 해설 말투\n- 첫 세 문장 안에 시청자를 붙잡는 긴장감을 준다\n- 마무리는 여운을 남기는 한 문장으로 끝낸다'}

${구조글(g.자)}

[반드시 지킬 것]
1. 문장 끝 온점(.) 뒤에는 반드시 띄어쓰기
2. 따옴표(") 쓰지 말 것
3. 문단은 빈 줄로 구분
4. 특수문자(※ ★ → 등)와 이모지 쓰지 말 것
5. URL, 이메일 주소 넣지 말 것
6. 단어 뒤 괄호 금지 (클로드(Claude) 금지 → 클로드)
7. 설명이나 머리말 없이 대본 본문만 출력할 것
8. 참고 기사 주소가 있으면 그 내용을 먼저 읽고 쓸 것
9. 어떤 경우에도 나에게 되묻지 말 것. 바로 대본을 쓸 것
10. 기사에 없는 사실을 지어내지 말 것. 이건 뉴스다
11. 위 [문장 끝맺음] 규칙을 처음부터 끝까지 한 문장도 빠짐없이 지킬 것.
    말투 설명이 다른 어미로 적혀 있어도 거기에 끌려가지 말 것` +
    ((작.articleText||'').trim()
      ? `\n\n[기사 본문 — 이 영상의 뼈대다]\n${작.articleText.trim()}`
      : '');
}

function 질문복사(){
  복사(질문글(), '질문을 복사했어. 클로드에 붙여넣어');
}

function 대본복사(){
  const t=(document.getElementById('script')||{}).value||'';
  if(!t.trim()){ toast('복사할 대본이 없어', true); return; }
  복사(t, `대본 ${t.length.toLocaleString()}자를 복사했어`);
}

function 대본내려받기(){
  const t=(document.getElementById('script')||{}).value||'';
  if(!t.trim()){ toast('저장할 대본이 없어', true); return; }
  const 날 = new Date().toISOString().slice(0,10).replace(/-/g,'');
  const 이름 = `${(작.name||'대본').replace(/[\\/:*?"<>|]/g,'_')}_${날}.txt`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff'+t], {type:'text/plain;charset=utf-8'}));
  a.download = 이름; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
  toast(`${이름} 으로 저장했어`);
}

async function 대본비우기(){
  if(!confirm('대본을 비울까? 되돌릴 수 없어.')) return;
  document.getElementById('script').value='';
  글자세기(); await 저장({script:''}); await 저장지금(); 기둥그리기();
  toast('비웠어');
}

function 글자세기(){
  const t=(document.getElementById('script')||{}).value||'';
  const g=document.getElementById('글자');
  if(g) g.textContent = `${t.length.toLocaleString()}자 / 60,000자 ≈ ${(t.length/자당분).toFixed(1)}분 ≈ 컷 ${Math.round(t.length/컷당자)}개`;
  const 검=document.getElementById('검사'); if(!검) return;
  const 문제=[];
  // 1.4기가와트 같은 소수점과 1.2.3 같은 번호는 문장 끝이 아니다
  if(/[가-힣](?:\.)[가-힣A-Za-z]/.test(t)) 문제.push('온점 뒤 띄어쓰기');
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
