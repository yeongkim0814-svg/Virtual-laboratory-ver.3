/**
 * 실험실 도면 데이터 (단위: 미터)
 *
 * 손그림 도면을 1 m ≈ 70 px로 환산해서 만든 값이다.
 * 3D 모델, 충돌 판정, 미니맵이 전부 이 파일 하나만 보고 만들어진다.
 * → 방 크기를 바꾸고 싶으면 여기 숫자만 고치면 된다.
 *
 * 좌표계 (위에서 내려다본 도면 기준)
 *   x : 도면의 오른쪽 방향 (+)
 *   z : 도면의 아래쪽 방향 (+)
 *   y : 위쪽 (높이)
 *   원점 (0, 0) = 주 실험실 안쪽의 왼쪽 위 모서리 (칠판 벽과 위쪽 벽이 만나는 곳)
 */

/** 도면 위의 직사각형 영역. 벽·방 모두 이 형태로 표현한다. */
export interface Rect {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

export const WALL_HEIGHT = 3.0; // 천장 높이
export const WALL_THICKNESS = 0.2; // 바깥 벽 두께
export const DOOR_HEIGHT = 2.1;

/** 주 실험실 (칠판, 실험 테이블이 들어갈 큰 방) */
export const MAIN_ROOM: Rect = { x1: 0, z1: 0, x2: 12.0, z2: 7.6 };

/** 준비실 (오른쪽 작은 방: 보관장, 폐시약통, 대형 기구) */
export const PREP_ROOM: Rect = { x1: 12.7, z1: 0, x2: 17.2, z2: 7.6 };

/** 두 방 사이의 칸막이 벽 (도면에서 두꺼운 벽, 약 0.7 m) */
export const PARTITION = { x1: MAIN_ROOM.x2, x2: PREP_ROOM.x1 };

/** 칸막이 벽에 뚫린 문 (z 범위). 경첩은 아래쪽(z2), 준비실 쪽으로 열린다. */
export const DOOR = { z1: 5.0, z2: 6.5 };

export const ROOMS = [
  { name: '주 실험실', rect: MAIN_ROOM },
  { name: '준비실', rect: PREP_ROOM },
];

const T = WALL_THICKNESS;

/**
 * 충돌 판정에 쓰는 벽 목록 (위에서 본 직사각형).
 * 문 부분은 비워 두고, 문짝은 door.ts에서 따로 움직이는 충돌체로 처리한다.
 */
export const WALLS: Rect[] = [
  // 바깥 벽 4면 (두 방을 모두 감싼다)
  { x1: -T, z1: -T, x2: PREP_ROOM.x2 + T, z2: 0 }, // 위
  { x1: -T, z1: MAIN_ROOM.z2, x2: PREP_ROOM.x2 + T, z2: MAIN_ROOM.z2 + T }, // 아래
  { x1: -T, z1: 0, x2: 0, z2: MAIN_ROOM.z2 }, // 왼쪽 (칠판 벽)
  { x1: PREP_ROOM.x2, z1: 0, x2: PREP_ROOM.x2 + T, z2: MAIN_ROOM.z2 }, // 오른쪽
  // 칸막이 벽: 문 위쪽 부분과 아래쪽 부분
  { x1: PARTITION.x1, z1: 0, x2: PARTITION.x2, z2: DOOR.z1 },
  { x1: PARTITION.x1, z1: DOOR.z2, x2: PARTITION.x2, z2: MAIN_ROOM.z2 },
];

/** 가구 종류 — buildFurniture.ts가 종류별로 다른 모양을 만든다 */
export type FurnitureKind =
  | 'blackboard' | 'desk' | 'standingDesk' | 'labBench'
  | 'tallCabinet' | 'lowCabinet' | 'prepTable' | 'wasteCabinet' | 'bin' | 'largeEquipment' | 'reagentCabinet';

export interface Furniture {
  kind: FurnitureKind;
  name: string;
  rect: Rect; // 위에서 본 차지 영역 (충돌 판정에도 그대로 사용)
  height: number; // 윗면 높이 (m) — 물체를 놓을 수 있는 면
}

/**
 * 가구 배치 (손그림 도면에서 환산, 단위 m)
 * 높이는 실제 학교 실험실 가구의 일반적인 치수를 사용했다.
 */
export const FURNITURE: Furniture[] = [
  // ---- 주 실험실 ----
  { kind: 'blackboard', name: '칠판', rect: { x1: 0, z1: 1.4, x2: 0.08, z2: 6.4 }, height: 2.1 },
  { kind: 'desk', name: '교탁', rect: { x1: 1.625, z1: 1.35, x2: 2.675, z2: 4.15 }, height: 0.76 }, // 가로(깊이) 1.4 → 1.05 m
  { kind: 'standingDesk', name: '스탠딩 테이블', rect: { x1: 1.625, z1: 4.25, x2: 2.675, z2: 5.6 }, height: 1.05 }, // 가로(깊이) 1.4 → 1.05 m
  { kind: 'labBench', name: '실험 테이블 1', rect: { x1: 4.3, z1: 1.4, x2: 6.45, z2: 5.0 }, height: 0.85 },
  { kind: 'labBench', name: '실험 테이블 2', rect: { x1: 7.8, z1: 1.35, x2: 10.1, z2: 5.0 }, height: 0.85 },
  { kind: 'tallCabinet', name: '실험 기구 보관장', rect: { x1: 11.4, z1: 0, x2: 12.0, z2: 4.95 }, height: 2.1 },
  { kind: 'lowCabinet', name: '실험 기구 수납장', rect: { x1: 2.15, z1: 7.05, x2: 12.0, z2: 7.6 }, height: 0.9 },
  { kind: 'bin', name: '쓰레기통', rect: { x1: 0.25, z1: 6.8, x2: 0.85, z2: 7.4 }, height: 0.7 },
  // ---- 준비실 ----
  { kind: 'reagentCabinet', name: '시약장', rect: { x1: 12.7, z1: 0, x2: 13.45, z2: 4.95 }, height: 2.05 },
  // 준비 테이블: 양옆 보관장 문 앞을 막지 않도록 좌우에 0.7 m 통로를 둔다 (몸 지름 0.6 m < 0.7 m)
  { kind: 'prepTable', name: '준비 테이블', rect: { x1: 14.15, z1: 0, x2: 15.55, z2: 1.1 }, height: 0.85 },
  { kind: 'tallCabinet', name: '유리 기구 보관장', rect: { x1: 16.25, z1: 0, x2: 17.2, z2: 5.65 }, height: 2.1 },
  { kind: 'wasteCabinet', name: '폐시약 보관함', rect: { x1: 12.7, z1: 7.05, x2: 14.15, z2: 7.6 }, height: 0.9 },
  { kind: 'largeEquipment', name: '대형 실험 기구', rect: { x1: 14.7, z1: 6.4, x2: 17.0, z2: 7.6 }, height: 1.2 },
];

/** 처음 들어왔을 때의 위치와 바라보는 방향 */
export const SPAWN = {
  x: 9.0,
  z: 6.2,
  // yaw = 0 이면 -z(도면 위쪽)를 본다. +π/2 이면 -x(칠판 쪽)를 본다.
  yaw: Math.PI / 2,
};

/** (x, z) 지점이 어느 방에 있는지 이름을 돌려준다. */
export function roomNameAt(x: number, z: number): string {
  for (const room of ROOMS) {
    const r = room.rect;
    if (x >= r.x1 && x <= r.x2 && z >= r.z1 && z <= r.z2) return room.name;
  }
  return '문';
}
