/* 화풍 12가지 — 레퍼런스 영상에 나온 그대로 */

const 화풍목록 = [
  { id:'cine', 통합:'포토리얼리스틱 · 포토리얼 3D · 하이퍼리얼 3D',   묶음:'실사 · 3D', 이름:'시네마틱 실사',
    설명:'실제 사진 같은 사실적 렌더링. 영화 스틸컷 느낌의 극적인 조명과 구도',
    영문:'photorealistic cinematic film still, dramatic lighting, shallow depth of field, 35mm, high detail' },

  { id:'3danim', 통합:'3D 카툰', 묶음:'실사 · 3D', 이름:'3D 애니메이션',
    설명:'극장판 3D 애니메이션 느낌. 생동감 있는 캐릭터와 시네마틱 조명',
    영문:'3d animated feature film style, pixar-like rendering, expressive characters, soft cinematic lighting' },

  { id:'toy', 통합:'블록 토이 · 클레이 · 로우폴리 3D',    묶음:'실사 · 3D', 이름:'미니어처 토이',
    설명:'블록·클레이·로우폴리로 만든 장난감 디오라마. 틸트시프트 미니어처 감성',
    영문:'miniature toy diorama, clay and low poly blocks, tilt-shift macro photography, tiny world' },

  { id:'cyber', 통합:'',  묶음:'실사 · 3D', 이름:'사이버펑크 3D',
    설명:'네온 불빛의 미래 도시. 어두운 배경과 강렬한 보라·청록 대비',
    영문:'cyberpunk 3d render, neon lit futuristic city, dark background, strong purple and teal contrast' },

  { id:'webtoon', 통합:'',묶음:'만화 · 애니', 이름:'한국 웹툰',
    설명:'깔끔한 선화와 셀 셰이딩의 한국 웹툰 스타일 디지털 일러스트',
    영문:'korean webtoon style digital illustration, clean line art, cel shading, soft gradients' },

  { id:'joseon', 통합:'사극 웹툰', 묶음:'만화 · 애니', 이름:'조선시대 만화',
    설명:'조선시대 배경의 한국 웹툰·만화 스타일. 한복과 전통 건축의 사극 감성',
    영문:'korean historical webtoon style, joseon dynasty setting, hanbok, traditional architecture' },

  { id:'water', 통합:'감성 풍경 애니',  묶음:'만화 · 애니', 이름:'수채 애니',
    설명:'지브리풍 수채 애니메이션. 따뜻한 빛과 감성적인 풍경 묘사',
    영문:'studio ghibli inspired watercolor anime, warm light, lush emotional scenery, hand painted' },

  { id:'retro', 통합:'빈티지 애니메이션',  묶음:'만화 · 애니', 이름:'레트로 애니',
    설명:'80~90년대 셀 애니메이션. 필름 그레인과 바랜 색감의 복고 감성',
    영문:'retro 80s 90s cel animation, film grain, faded nostalgic colors, vintage anime still' },

  { id:'pop', 통합:'',    묶음:'그 밖', 이름:'코믹 팝아트',
    설명:'굵은 윤곽선과 강렬한 원색의 미국 코믹 팝아트',
    영문:'american comic pop art, bold black outlines, vivid primary colors, halftone dots' },

  { id:'chibi', 통합:'',  묶음:'그 밖', 이름:'치비',
    설명:'머리가 큰 귀여운 치비 캐릭터. 둥글고 부드러운 형태',
    영문:'cute chibi character art, big head small body, rounded soft shapes, pastel palette' },

  { id:'paper', 통합:'',  묶음:'그 밖', 이름:'종이 공예',
    설명:'색종이를 오려 겹친 페이퍼 컷 아트, 입체감 있는 레이어와 그림자',
    영문:'layered paper cut craft art, colored construction paper, visible depth layers and soft drop shadows' },

  { id:'gothic', 통합:'', 묶음:'그 밖', 이름:'다크 고딕',
    설명:'어둡고 신비로운 고딕 분위기, 짙은 명암과 음산한 디테일',
    영문:'dark gothic atmosphere, deep chiaroscuro shadows, eerie ornate details, moody fog' },
];

/* 모든 프롬프트 끝에 붙는 공통 규격 */
/* 모든 프롬프트 뒤에 붙는 공통 문구.
   부정어("no text", "no people")를 쓰지 않는다.
   이미지 AI 는 「~하지 마」를 잘 못 알아듣고, 오히려 그 단어를 보고
   넣어 버린다. 제미니로 시험했을 때 no people 이라고 적었는데
   사람이 화면 주인공으로 나왔다.
   그래서 「무엇이 있는지」만 적는다. */
const 공통규격 = '16:9 widescreen cinematic composition, '
  + 'strong depth with clear foreground midground and background, '
  + 'dramatic directional lighting with visible light source, '
  + 'rich atmosphere, haze and depth of field';

/* 정보 그래픽 층 — 화풍 12가지 **위에** 얹는다.
   화풍을 새로 만드는 게 아니라, 고른 화풍 그대로에
   도표·화살표·도형 같은 설명 요소를 섞는 것이다.

   왜 필요한가.
   뉴스 대본에는 실사로 찍을 수 없는 말이 수두룩하다.
   「지분 10퍼센트」, 「부채 부담」, 「전력 수요 급증」 같은 것들이다.
   이것을 장면으로만 그리면 어색해진다.
   저울 위에 아파트 1만 채를 실사로 올리면 이상한 사진이 될 뿐이다.
   경제·시사 유튜브가 죄다 모션그래픽을 쓰는 까닭이 이것이다. */

const 그래픽층 = [
  { id:'', 이름:'안 섞기', 꼬리:'장면만 그린다',
    영문:'' },

  { id:'light', 이름:'살짝', 꼬리:'장면이 주인공, 도형은 거들기만',
    영문:'with subtle infographic elements woven into the scene, '
       + 'a few clean vector arrows and simple geometric indicators, '
       + 'light data accents' },

  { id:'heavy', 이름:'많이', 꼬리:'도표와 도형이 주인공 (경제·시사에 맞음)',
    영문:'designed as a motion-graphics infographic, '
       + 'bold vector bars pie segments and directional arrows as the main visual language, '
       + 'flat iconography, quantities shown by the size of shapes, '
       + 'simple flat background, broadcast news graphics quality' },
];

function 그래픽찾기(id){
  return 그래픽층.find(x => x.id === (id || '')) || 그래픽층[0];
}
