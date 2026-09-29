# 가상 실험실 (Virtual Laboratory)

갤럭시 탭에서 브라우저로 접속하는 1인칭 3D 가상 실험실. 물리·화학 법칙을 직접 구현하고 측정하는 것이 목표다.
현재 단계: **1.5단계 — 기구를 직접 꺼내 조립하는 실험실 + 단진자** (화면 16:9 고정, PS1 시대 레트로 그래픽)

## 조작

| | 태블릿 | PC |
|---|---|---|
| 이동 | 화면 왼쪽 40%를 누른 채 밀기 (조이스틱) | WASD / 방향키 |
| 둘러보기 | 나머지 영역 드래그 | 마우스 드래그 |
| 집기·문 열기 | 물체를 탭 (화면 어디든) | 클릭 / E |
| 놓기 | 들고 있을 때 책상·바닥을 탭 (호박색 고리 = 가능, 빨강 = 불가) | 클릭 / E |

조준점 아래에 지금 탭하면 일어날 일이 표시된다 (예: `[탭] 집기 · 비커`).

## 실험 방법: 기구를 꺼내 직접 조립한다

기구는 **주 실험실 오른쪽 벽의 보관장**에 있다. 문을 탭해 열고 꺼낸다.

| 칸 | 기구 |
|---|---|
| 1·2 (긴 칸) | 스탠드 |
| 3 | 클램프 |
| 4 | 실, 각도기 |
| 5 | 추 50 g · 100 g · 200 g |
| 6 | 쇠공, 추 100 g |

기구끼리는 **플러그 → 소켓**이 맞으면 연결된다. 물체를 든 채 다른 기구를 탭하면 조준점 아래에
`[탭] 연결 · 클램프 → 스탠드 막대`처럼 표시된다.

| 들고 있는 것 | 탭할 곳 | 결과 |
|---|---|---|
| 클램프 | 스탠드 막대 (원하는 높이) | 그 높이에 고정, 팔이 나를 향함 |
| 실 | 클램프 집게 | 실이 늘어짐 |
| 추·쇠공 | 실 끝 고리 | 매달림 → **진자** |
| 추·쇠공·실·플라스크 | 클램프 집게 | 집게에 단단히 고정 |
| 각도기 | 클램프 | 받침점 뒤에 세워짐 |

연결된 기구를 들면 거기에 붙은 것도 함께 들린다. 매달린 추를 탭하면 **진자 실험 / 집기** 메뉴가 뜬다.

### 단진자 실험 패널
실 길이 ℓ, 처음 각도 θ₀, 적분 방법, Δt, 공기 저항을 정하고 **놓기**. 진자 길이는
L = ℓ + (고리 ~ 추 무게 중심)으로 자동 계산된다. 추가 책상에 닿는 길이면 실이 자동으로 짧아지고 안내가 뜬다.
측정 주기 T, 작은 각 근사 T₀ = 2π√(L/g), 타원 적분으로 구한 정확한 주기, 역학적 에너지 변화,
θ(t) 그래프, 기록 표를 보여 준다.

## 웹에서 실행

**https://yeongkim0814-svg.github.io/Virtual-laboratory-ver.3/**

GitHub Pages가 이 브랜치의 `docs/` 폴더를 그대로 웹에 올린다. 코드를 고친 뒤에는 반드시
`npm run build:docs`로 `docs/`를 다시 만들어 함께 커밋해야 웹에 반영된다 (push 후 1~2분).

최초 1회 설정: 저장소 **Settings → Pages → Build and deployment**
- Source: **Deploy from a branch**
- Branch: `ccr-2ba68f1a-3uovu1`, 폴더 `/docs` → Save

## 개발

```bash
npm install          # 처음 한 번
npm run dev          # 개발 서버 (같은 Wi-Fi의 태블릿에서 표시되는 Network 주소로 접속)
npm run build:docs   # 웹 배포용 빌드 → docs/
```

## 코드 구조

```
src/
  main.ts              시작점: 부품 연결 + 매 프레임 루프
  world/layout.ts      ★ 도면 데이터 (방·벽·문·가구 위치, 단위 m) — 3D·충돌·미니맵의 공통 원본
  world/buildLab.ts    도면 → 3D 바닥·벽·천장·조명
  world/buildFurniture.ts 가구 3D 모델 (칠판·실험대·보관장 …)
  world/items.ts       ★ 조립 시스템: 물체(Item) · 플러그 · 소켓, 연결/분리
  world/cabinet.ts     여닫는 문과 선반이 있는 보관장
  world/door.ts        여닫는 문 (경첩 회전 + 충돌 선분)
  world/interactable.ts 상호작용 물체의 공통 약속
  player/player.ts     1인칭 이동·시점 (yaw/pitch)
  player/collision.ts  원 vs 직사각형/선분 충돌 (위에서 본 2D)
  player/hand.ts       집기·들고 다니기·놓을 자리 판정
  sim/integrators.ts   수치 적분기 (오일러 / 반암시적 오일러 / RK4)
  sim/pendulum.ts      단진자 운동 방정식, 주기 측정, 이론 주기(작은 각·타원 적분)
  equipment/mechanics.ts   스탠드, 클램프, 추, 쇠공, 각도기
  equipment/pendulumString.ts 실 — 추가 걸리면 진자가 되어 시뮬레이션을 돌림
  equipment/stock.ts   보관장에 기구 채우기
  ui/pendulumPanel.ts  실험 패널 (조건, 측정값, 그래프, 기록 표)
  render/retro.ts      레트로 렌더링: 저해상도 + 외곽선·색 보정·디더링 후처리 + PS1 정점 떨림
  render/textures.ts   코드로 그린 픽셀 텍스처 + 실제 크기 기준 텍스처 좌표(worldUV)
  input/controls.ts    터치 조이스틱·드래그·탭 + 키보드
  ui/minimap.ts        미니맵
  ui/settings.ts       설정 패널 (감도·속도, localStorage 저장)
```

로드맵은 [PLAN.md](PLAN.md) 참고.

글꼴: [Galmuri](https://github.com/quiple/galmuri) (SIL Open Font License 1.1, `src/assets/fonts/Galmuri-OFL.md`)
