# 가상 실험실 (Virtual Laboratory)

갤럭시 탭에서 브라우저로 접속하는 1인칭 3D 가상 실험실. 물리·화학 법칙을 직접 구현하고 측정하는 것이 목표다.
현재 단계: **0.5단계 — 가구 배치 + 물체 집기/놓기** (화면 16:9 고정)

## 조작

| | 태블릿 | PC |
|---|---|---|
| 이동 | 화면 왼쪽 40%를 누른 채 밀기 (조이스틱) | WASD / 방향키 |
| 둘러보기 | 나머지 영역 드래그 | 마우스 드래그 |
| 집기·문 열기 | 물체 탭 또는 오른쪽 아래 버튼 | 클릭 / E |
| 놓기 | 책상·바닥 탭, 또는 조준 후 "놓기" (초록 고리 = 가능, 빨강 = 불가) | 클릭 / E |

## 실행 방법

```bash
npm install      # 처음 한 번
npm run dev      # 개발 서버 (같은 Wi-Fi의 태블릿에서 표시되는 Network 주소로 접속)
npm run build    # 배포용 빌드 → dist/
```

main 브랜치에 push하면 GitHub Actions가 GitHub Pages로 자동 배포한다
(최초 1회: Settings → Pages → Source = "GitHub Actions").

## 코드 구조

```
src/
  main.ts              시작점: 부품 연결 + 매 프레임 루프
  world/layout.ts      ★ 도면 데이터 (방·벽·문·가구 위치, 단위 m) — 3D·충돌·미니맵의 공통 원본
  world/buildLab.ts    도면 → 3D 바닥·벽·천장·조명
  world/buildFurniture.ts 가구 3D 모델 (칠판·실험대·보관장 …)
  world/items.ts       집을 수 있는 물체 (비커·플라스크·추·쇠공 …, 질량 포함)
  world/door.ts        여닫는 문 (경첩 회전 + 충돌 선분)
  world/interactable.ts 상호작용 물체의 공통 약속
  player/player.ts     1인칭 이동·시점 (yaw/pitch)
  player/collision.ts  원 vs 직사각형/선분 충돌 (위에서 본 2D)
  player/hand.ts       집기·들고 다니기·놓을 자리 판정
  input/controls.ts    터치 조이스틱·드래그·탭 + 키보드
  ui/minimap.ts        미니맵
  ui/settings.ts       설정 패널 (감도·속도, localStorage 저장)
```

로드맵은 [PLAN.md](PLAN.md) 참고.
