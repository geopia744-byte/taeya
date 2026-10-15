/* 뉴스ai자동화 — 화면 움직임 (1차)
   실측 기준: 대본 4,621자 = 9분 = 43컷(13초) → 513자/분, 107자/컷 */

const 자당분 = 513;          // 1분에 들어가는 글자수 (영상 실측)
const 컷당자 = 107;          // 컷 하나에 들어가는 글자수 (영상 실측)

let DB = { channels: [], projects: [] };
let 현재채널 = null;
let 현재프로젝트 = null;

const 단계 = [
  { k:'script',     en:'SCRIPT',     ko:'대본',       ic:'🗒' },
  { k:'voice',      en:'VOICE',      ko:'음성',       ic:'🎙' },
  { k:'style',      en:'STYLE',      ko:'스타일',     ic:'🎨' },
  { k:'storyboard', en:'STORYBOARD', ko:'스토리보드', ic:'▦' },
  { k:'image',      en:'IMAGE',      ko:'이미지',     ic:'🖼' },
  { k:'video',      en:'VIDEO',      ko:'영상',       ic:'🎬' },
  { k:'export',     en:'EXPORT',     ko:'완성',       ic:'⬆' },
];
let 현재단계 = 'script';

/* ── 서버와 말하기 ───────────────────── */
async function api(path, body){
  const o = body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {};
  const r = await fetch('/api/'+path, o);
  if(!r.ok) throw new Error(await r.text());
  return r.json();
}
async function load(){ DB = await api('state'); }

/* ── 알림 ────────────────────────────── */
function toast(msg, bad){
  const d=document.createElement('div');
  d.className='toast'+(bad?' bad':''); d.textContent=msg;
  document.getElementById('toast').appendChild(d);
  setTimeout(()=>d.remove(), 2600);
}
function notYet(name){
  toast(name+' — 아직 안 만든 칸이야 (영상에도 안 나왔어)', true);
}
function openModal(id){ document.getElementById(id).classList.add('on'); }
function closeModal(id){ document.getElementById(id).classList.remove('on'); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ── 홈 ──────────────────────────────── */
function goHome(){
  현재프로젝트 = null;
  document.getElementById('sideHome').style.display='';
  document.getElementById('sideProj').style.display='none';
  document.getElementById('crSep').style.display='none';
  document.getElementById('crCur').textContent='';
  drawHome();
}

function drawHome(){
  const m = document.getElementById('main');
  const 총프로젝트 = DB.projects.length;

  if(!DB.channels.length){
    m.innerHTML = `
      <div class="homehead">
        <div class="n">채널 0개</div>
        <div class="sp"></div>
        <button class="btn cy" onclick="newChannel()">+ 채널 추가</button>
      </div>
      <div class="empty">
        아직 채널이 없어.<br><br>
        오른쪽 위 <b>[+ 채널 추가]</b> 를 눌러서 첫 채널을 만들어 줘.<br>
        채널마다 <b>말투</b>를 적어 두면, 그 채널의 대본이 전부 그 말투로 나와.
      </div>`;
    return;
  }

  m.innerHTML = `
    <div class="homehead">
      <div class="n">채널 ${DB.channels.length}개</div>
      <div class="sp"></div>
      <button class="btn cy" onclick="newChannel()">+ 채널 추가</button>
    </div>
    <div class="chgrid">${DB.channels.map(카드).join('')}</div>
    <div style="margin-top:18px;font-size:12px;color:var(--tx3)">프로젝트 ${총프로젝트}개</div>`;
}

function 카드(c){
  const n = DB.projects.filter(p=>p.channel===c.id).length;
  const 말투있음 = (c.tone||'').trim().length > 0;
  return `
  <div class="chcard">
    <div class="chtop">
      <div class="chico">▶</div>
      <div class="chname">${esc(c.name)}</div>
      <div class="chcount">${n}</div>
    </div>
    <div class="chlink">♡ 채널 미연동</div>
    <div class="chtag">${말투있음 ? '말투 설정됨' : '기본 설정'}</div>
    <div class="chbtns">
      <button class="btn cy sm" onclick="notYet('자동 생성')">✦ 자동 생성</button>
      <button class="btn sm" onclick="newProject('${c.id}')">+ 새 프로젝트</button>
      <button class="btn sm" onclick="notYet('채널 검색')">🔍 채널 검색</button>
      <button class="btn sm" onclick="notYet('레퍼런스')">◇ 레퍼런스</button>
      <button class="btn sm" onclick="notYet('학습')">학습</button>
    </div>
    <div class="chbtns2">
      <button class="btn sm gh" onclick="editChannel('${c.id}')">⚙ 설정</button>
      <button class="btn sm gh dang" onclick="delChannel('${c.id}')">🗑</button>
      ${n ? `<button class="btn sm gh" onclick="listProjects('${c.id}')">프로젝트 ${n}개 ▾</button>` : ''}
    </div>
  </div>`;
}

function listProjects(cid){
  const c = DB.channels.find(x=>x.id===cid);
  const ps = DB.projects.filter(p=>p.channel===cid);
  const m = document.getElementById('main');
  m.innerHTML = `
    <div class="homehead">
      <div class="n"><a href="#" onclick="goHome();return false">← 모든 채널</a> · ${esc(c.name)}</div>
      <div class="sp"></div>
      <button class="btn cy" onclick="newProject('${cid}')">+ 새 프로젝트</button>
    </div>
    <div class="chgrid">${ps.map(p=>`
      <div class="chcard" style="cursor:pointer" onclick="openProject('${p.id}')">
        <div class="chtop"><div class="chico">🗒</div><div class="chname">${esc(p.name)}</div></div>
        <div class="chlink">만든 날 ${esc(p.created||'')}</div>
        <div class="chtag">${esc(단계.find(s=>s.k===(p.step||'script')).ko)} 단계</div>
      </div>`).join('')}</div>`;
}

/* ── 채널 만들기·고치기 ──────────────── */
let 고치는채널 = null;
function newChannel(){
  고치는채널 = null;
  document.getElementById('mChanTitle').textContent = '채널 추가';
  chName.value=''; chTone.value=''; chRefs.value='';
  openModal('mChan'); setTimeout(()=>chName.focus(),60);
}
function editChannel(id){
  const c = DB.channels.find(x=>x.id===id);
  고치는채널 = id;
  document.getElementById('mChanTitle').textContent = '채널 설정';
  chName.value=c.name||''; chTone.value=c.tone||''; chRefs.value=(c.refs||[]).join('\n');
  openModal('mChan'); setTimeout(()=>chName.focus(),60);
}
document.getElementById('chSave').onclick = async ()=>{
  const name = chName.value.trim();
  if(!name){ toast('카테고리 이름을 적어줘', true); chName.focus(); return; }
  const payload = { id:고치는채널, name, tone:chTone.value,
                    refs: chRefs.value.split('\n').map(s=>s.trim()).filter(Boolean) };
  await api('channel/save', payload);
  await load(); closeModal('mChan'); goHome();
  toast(고치는채널 ? '채널을 고쳤어' : `채널 「${name}」 을 만들었어`);
};
async function delChannel(id){
  const c = DB.channels.find(x=>x.id===id);
  const n = DB.projects.filter(p=>p.channel===id).length;
  if(!confirm(`채널 「${c.name}」 을 지울까?` + (n?`\n\n안에 든 프로젝트 ${n}개도 같이 지워져.`:''))) return;
  await api('channel/del', {id}); await load(); goHome(); toast('지웠어');
}

/* ── 프로젝트 ────────────────────────── */
let 만들채널 = null;
function newProject(cid){
  만들채널 = cid;
  const c = DB.channels.find(x=>x.id===cid);
  document.getElementById('pjWhere').textContent = `'${c.name}' 카테고리에 새 프로젝트를 만듭니다.`;
  pjName.value=''; openModal('mProj'); setTimeout(()=>pjName.focus(),60);
}
document.getElementById('pjSave').onclick = async ()=>{
  const name = pjName.value.trim();
  if(!name){ toast('프로젝트 이름을 적어줘', true); pjName.focus(); return; }
  const r = await api('project/new', {channel:만들채널, name});
  await load(); closeModal('mProj'); openProject(r.id);
  toast(`「${name}」 만들었어`);
};

function openProject(id){
  현재프로젝트 = DB.projects.find(p=>p.id===id);
  if(!현재프로젝트) return goHome();
  현재단계 = 현재프로젝트.step || 'script';
  document.getElementById('sideHome').style.display='none';
  document.getElementById('sideProj').style.display='';
  document.getElementById('crSep').style.display='';
  document.getElementById('crCur').textContent = 현재프로젝트.name;
  drawPipe(); drawStep();
}

/* ── 파이프라인 기둥 ─────────────────── */
function drawPipe(){
  const p = 현재프로젝트;
  const done = p.done || {};
  const el = document.getElementById('pipe');
  el.innerHTML = '<div class="rail"></div>' + 단계.map(s=>{
    const isDone = !!done[s.k];
    const isOn = s.k===현재단계;
    const sub = 요약(s.k);
    return `<button class="step ${isDone?'done':''} ${isOn?'on':''}" onclick="gotoStep('${s.k}')">
      <div class="mk">${isDone && !isOn ? '✓' : ''}</div>
      <div style="flex:1;min-width:0">
        <div class="en">${s.en}</div>
        <div class="ko">${s.ko}</div>
        ${sub?`<div class="sub">${esc(sub)}</div>`:''}
      </div>
      <div class="ricon">${s.ic}</div>
    </button>`;
  }).join('');
}

function 요약(k){
  const p = 현재프로젝트; if(!p) return '';
  if(k==='script' && p.scriptLen) return p.scriptLen.toLocaleString()+'자';
  if(k==='voice' && p.voice) return p.voice;
  if(k==='storyboard' && p.cuts) return p.cuts+'컷';
  if(k==='image' && p.imagesDone!=null) return p.imagesDone+'장';
  return '';
}

function gotoStep(k){ 현재단계 = k; drawPipe(); drawStep(); }

/* ── 단계 화면 ───────────────────────── */
function drawStep(){
  const i = 단계.findIndex(s=>s.k===현재단계);
  const s = 단계[i];
  const m = document.getElementById('main');
  m.innerHTML =
    `<div class="stepno">${i+1}/7 ${s.ko}</div>` +
    (본문[s.k] ? 본문[s.k]() : 준비중(s.ko)) +
    이동줄(i);
  if(s.k==='script'){ 대본계산(); 컷미리보기(); }
}

function 준비중(ko){
  return `<div class="h1">${ko}</div>
    <div class="h1sub">이 단계는 아직 안 만들었어.</div>
    <div class="card"><div style="color:var(--tx2);font-size:12.5px">
      1차에서는 <b>뼈대와 홈, 채널, 프로젝트</b>까지만 만들었어.<br>
      이 단계는 다음 차수에서 채울게.
    </div></div>`;
}

function 이동줄(i){
  const 앞 = i>0 ? 단계[i-1] : null;
  const 뒤 = i<6 ? 단계[i+1] : null;
  return `<div class="navbar">
    ${앞?`<button class="btn" onclick="gotoStep('${앞.k}')">이전</button>`:'<span></span>'}
    <div class="sp"></div>
    ${뒤?`<button class="btn cy" onclick="gotoStep('${뒤.k}')">다음</button>`:''}
  </div>`;
}

/* ── 1단계 대본 (1차에서는 칸만) ─────── */
const 본문 = {};

본문.script = ()=>`
  <div class="h1">대본</div>
  <div class="h1sub">영상에 사용할 대본을 입력하거나 AI에게 작성을 요청하세요.</div>

  <div class="card">
    <div class="corner">생성 · 2차에서 연결</div>
    <h3>유튜브/주제로 대본 생성</h3>
    <div class="desc">참고 유튜브 링크나 <b>뉴스 기사 주소</b>를 주면 리서치해서 대본 초안을 씁니다.
      생성 후 아래 편집창에서 다듬고 확정하세요.</div>

    <textarea class="ta" id="srcUrl" style="min-height:56px;margin-bottom:9px"
      placeholder="참고 유튜브·뉴스 URL (선택, 한 줄에 하나씩)"></textarea>
    <input class="in" id="srcTopic" style="margin-bottom:12px"
      placeholder="주제/소재 (예: 조선시대 구미호 설화)">

    <div class="row">
      <span class="lab">카테고리</span>
      <select class="sel" id="srcCat">${DB.channels.map(c=>
        `<option value="${c.id}" ${현재프로젝트&&c.id===현재프로젝트.channel?'selected':''}>${esc(c.name)}</option>`).join('')}</select>
      <span style="font-size:11.5px;color:var(--tx3)">카테고리 추가·설정은 홈에서</span>
    </div>

    <div class="row">
      <span class="lab">분량</span>
      <select class="sel" id="srcMin" onchange="대본계산()">
        <option value="5">5분</option>
        <option value="9" selected>9분</option>
        <option value="10">10분</option>
        <option value="15">15분</option>
        <option value="20">20분</option>
        <option value="30">30분</option>
        <option value="45">45분</option>
        <option value="60">60분</option>
      </select>
      <input class="in" id="srcChars" style="width:150px" placeholder="글자수 직접(선택)" oninput="대본계산()">
      <button class="btn cy" onclick="notYet('대본 생성')">대본 생성</button>
    </div>
    <div class="hint" id="환산">　</div>
  </div>

  <div class="card">
    <h3 style="cursor:pointer" onclick="toggleGuide()">▾ 대본 작성 가이드</h3>
    <div id="guide" style="margin-top:10px;font-size:12.5px;color:var(--tx2);line-height:2">
      • 문장 끝 온점(.) 후 반드시 띄어쓰기<br>
      • 따옴표(&quot;) 사용은 피해주세요 (자막이 지저분해지고, 음성 변환 오류가 발생할 수 있습니다)<br>
      • 문단 구분은 줄바꿈으로<br>
      • 특수문자(※, ★, → 등), 이모지 사용 금지<br>
      • URL, 이메일 주소 직접 넣지 마세요<br>
      • 단어 뒤 괄호 금지 (예: 클로드(Claude) ❌ → 클로드 ✅)
    </div>
  </div>

  <div class="card">
    <h3>대본 내용</h3>
    <div class="desc">지금은 직접 붙여넣을 수 있어. 2차에서 자동 생성을 연결할게.</div>
    <textarea class="ta" id="script" style="min-height:230px"
      placeholder="영상에 사용할 대본을 입력하세요.&#10;&#10;문단은 줄바꿈으로 구분합니다."
      oninput="대본계산();컷미리보기예약()">${esc(현재프로젝트.script||'')}</textarea>
    <div style="display:flex;margin-top:8px">
      <div class="hint" id="컷예상">　</div>
      <div class="sp" style="margin-left:auto"></div>
      <div class="hint" id="글자수">0자 / 60,000자</div>
    </div>
    <div style="margin-top:12px"><button class="btn cy" onclick="저장대본()">대본 저장</button></div>
  </div>

  <div class="card">
    <div class="corner" id="컷요약">　</div>
    <h3>컷 나누기 미리보기</h3>
    <div class="desc">대본을 <b>12~13초짜리 토막</b>으로 자른다. <b>토막 하나 = 그림 한 장 = 자막 한 구간.</b>
      문장 중간에서는 절대 자르지 않는다.</div>

    <div class="row">
      <span class="lab">한 컷 목표</span>
      <select class="sel" id="cutTarget" onchange="컷미리보기()">
        <option value="10">10초</option><option value="12">12초</option>
        <option value="13" selected>13초</option><option value="16">16초</option>
        <option value="20">20초</option>
      </select>
      <span class="lab">후킹 구간</span>
      <select class="sel" id="cutHook" onchange="컷미리보기()">
        <option value="6">6초</option><option value="8" selected>8초</option>
        <option value="10">10초</option><option value="13">13초 (따로 안 둠)</option>
      </select>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--tx2);cursor:pointer">
        <input type="checkbox" id="cutCta" checked onchange="컷미리보기()"> 구독·좋아요 문단은 그림 안 만들기
      </label>
      <button class="btn" onclick="컷미리보기()">다시 나누기</button>
    </div>

    <div id="타임라인" style="margin:14px 0 6px"></div>
    <div style="font-size:11px;color:var(--tx3);margin-bottom:12px">
      <span style="color:#f59e0b">■</span> 후킹
      <span style="color:#38bdf8;margin-left:10px">■</span> 본문
      <span style="color:#a78bfa;margin-left:10px">■</span> 강조
      <span style="color:#34d399;margin-left:10px">■</span> 마무리
    </div>
    <div id="컷목록"></div>
  </div>`;

function toggleGuide(){
  const g = document.getElementById('guide');
  g.style.display = g.style.display==='none' ? '' : 'none';
}

function 대본계산(){
  const t = (document.getElementById('script')||{}).value || '';
  const n = t.length;
  const gx = document.getElementById('글자수');
  if(gx) gx.textContent = n.toLocaleString()+'자 / 60,000자';

  // 목표 환산
  const 직접 = parseInt((document.getElementById('srcChars')||{}).value||'',10);
  const 분 = parseInt((document.getElementById('srcMin')||{}).value||'9',10);
  const 목표자 = 직접>0 ? 직접 : 분*자당분;
  const 목표분 = (목표자/자당분);
  const 목표컷 = Math.round(목표자/컷당자);
  const e = document.getElementById('환산');
  if(e) e.innerHTML = 직접>0
    ? `글자수를 직접 넣으면 분량보다 우선합니다. <b>${목표자.toLocaleString()}자 ≈ ${목표분.toFixed(1)}분 ≈ 그림 ${목표컷}장</b> (13초/컷)`
    : `약 ${자당분}자 = 1분 (영상 실측). <b>${분}분 ≈ ${목표자.toLocaleString()}자 ≈ 그림 ${목표컷}장</b> (13초/컷)`;

  const c = document.getElementById('컷예상');
  if(c) c.textContent = n ? `지금 대본 ≈ ${(n/자당분).toFixed(1)}분 ≈ 그림 ${Math.round(n/컷당자)}장` : '　';
}

/* ── 컷 나누기 미리보기 ──────────────── */
const 구간색 = {'후킹':'#f59e0b','본문':'#38bdf8','강조':'#a78bfa','마무리':'#34d399'};
let 컷타이머 = null;

function 컷미리보기예약(){
  clearTimeout(컷타이머);
  컷타이머 = setTimeout(컷미리보기, 450);
}

async function 컷미리보기(){
  const ta = document.getElementById('script');
  const 목록 = document.getElementById('컷목록');
  if(!ta || !목록) return;
  const 글 = ta.value.trim();
  if(!글){
    목록.innerHTML = `<div class="empty" style="padding:28px">위에 대본을 넣으면 컷이 여기 나와.</div>`;
    document.getElementById('타임라인').innerHTML='';
    document.getElementById('컷요약').textContent='　';
    return;
  }
  const r = await api('cut', {
    script: 글,
    target: document.getElementById('cutTarget').value,
    hook: document.getElementById('cutHook').value,
    skipCta: document.getElementById('cutCta').checked,
  });
  const s = r.요약, cs = r.컷;

  document.getElementById('컷요약').innerHTML =
    `<b style="color:var(--cy2)">컷 ${s.컷수}개</b> · ${s.전체분}분 · 평균 ${s.평균컷초}초`;

  // 타임라인 막대
  const 전체 = s.전체초 || 1;
  document.getElementById('타임라인').innerHTML =
    `<div style="display:flex;height:22px;border-radius:5px;overflow:hidden;border:1px solid var(--line2)">` +
    cs.map(c=>`<div title="${c.번호}번 · ${c.길이초}초 · ${c.구간}"
        style="width:${(c.길이초/전체*100).toFixed(3)}%;background:${구간색[c.구간]};
               border-right:1px solid rgba(0,0,0,.45)"></div>`).join('') + `</div>`;

  // 컷 목록
  목록.innerHTML = cs.map(c=>`
    <div style="display:flex;gap:11px;padding:9px 0;border-top:1px solid var(--line)">
      <div style="width:30px;flex-shrink:0;text-align:center">
        <div style="font-size:12px;font-weight:600;color:${구간색[c.구간]}">${c.번호}</div>
        <div style="font-size:9.5px;color:var(--tx3)">${c.구간}</div>
      </div>
      <div style="width:104px;flex-shrink:0;font-size:11px;color:var(--tx3);line-height:1.5">
        ${초표기(c.시작초)} ~ ${초표기(c.끝초)}<br>
        <span style="color:var(--tx2)">${c.길이초}초 · ${c.글자수}자</span>
      </div>
      <div style="flex:1;min-width:0;font-size:12.5px;color:var(--tx);line-height:1.65">${esc(c.대본)}</div>
    </div>`).join('');
}

function 초표기(s){
  const m = Math.floor(s/60), r = (s%60);
  return `${m}:${r.toFixed(1).padStart(4,'0')}`;
}

async function 저장대본(){
  const t = document.getElementById('script').value;
  await api('project/save', { id:현재프로젝트.id, script:t, scriptLen:t.length,
                              step:현재단계, done:{script: t.trim().length>0} });
  await load(); 현재프로젝트 = DB.projects.find(p=>p.id===현재프로젝트.id);
  drawPipe(); toast(`대본 ${t.length.toLocaleString()}자 저장했어`);
}

/* ── 시작 ────────────────────────────── */
(async ()=>{
  try { await load(); goHome(); }
  catch(e){ document.getElementById('main').innerHTML =
    `<div class="empty">서버에 닿지 못했어.<br>검은 창(명령 창)을 닫지 말고 열어둔 채로 다시 열어줘.</div>`; }
})();

// 창 밖 누르면 닫기
document.querySelectorAll('.mask').forEach(m=>{
  m.addEventListener('mousedown', e=>{ if(e.target===m) m.classList.remove('on'); });
});
document.addEventListener('keydown', e=>{
  if(e.key==='Escape') document.querySelectorAll('.mask.on').forEach(m=>m.classList.remove('on'));
});
