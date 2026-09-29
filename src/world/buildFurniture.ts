/**
 * layout.ts의 FURNITURE 목록으로 가구 3D 모델을 만든다.
 * 모든 가구의 윗면 높이는 layout의 height와 같아서, 그 위에 물체를 놓을 수 있다.
 */
import * as THREE from 'three';
import { FURNITURE, ROOMS, type Furniture, type Rect } from './layout';
import { grimeTexture, woodTexture, worldUV } from '../render/textures';
import { StorageCabinet, type CabinetDoor } from './cabinet';
import { Outlet } from './power';

// ---- 재질 (여러 가구가 함께 쓴다) — 픽셀 텍스처 × 색 ----
const grime = grimeTexture();
const wood = woodTexture();
const lambert = (color: number, map: THREE.Texture | null = grime) => new THREE.MeshLambertMaterial({ color, map });
const M = {
  wood: lambert(0x9a6c40, wood),
  woodDark: lambert(0x5a3d26, wood),
  epoxy: lambert(0x2c2f2c), // 실험대 상판 (검은 에폭시)
  cabinet: lambert(0xb9bcae),
  door: lambert(0xa3a898),
  metal: lambert(0x8d9290),
  handle: lambert(0x3d403c),
  glass: new THREE.MeshLambertMaterial({ color: 0x9fc4c8, transparent: true, opacity: 0.35, depthWrite: false }),
  plastic: lambert(0x5d665f),
  hazard: lambert(0xd6a21e),
  white: lambert(0xd8d6c8),
};

/** 만들어진 보관장들 (이름 → 보관장) — 기구를 넣을 자리를 찾을 때 쓴다 */
const cabinets = new Map<string, StorageCabinet>();
const outlets: Outlet[] = [];

export interface FurnitureResult {
  cabinets: Map<string, StorageCabinet>;
  /** 여닫을 수 있는 보관장 문 전부 */
  doors: CabinetDoor[];
  /** 실험 테이블 옆면의 콘센트 (장면에는 PowerSystem이 넣는다) */
  outlets: Outlet[];
}

export function buildFurniture(scene: THREE.Scene): FurnitureResult {
  cabinets.clear();
  outlets.length = 0;
  for (const f of FURNITURE) {
    const g = new THREE.Group();
    g.name = f.name;
    BUILDERS[f.kind](g, f);
    scene.add(g);
  }
  return { cabinets, doors: [...cabinets.values()].flatMap((c) => c.doors), outlets: [...outlets] };
}

type Builder = (g: THREE.Group, f: Furniture) => void;

const BUILDERS: Record<Furniture['kind'], Builder> = {
  blackboard(g, f) {
    const r = f.rect;
    const bottom = 0.9;
    box(g, r, bottom, f.height, M.woodDark); // 테두리
    // 칠판 면: 캔버스에 분필 글씨를 그려 텍스처로 사용
    const w = r.z2 - r.z1 - 0.1;
    const h = f.height - bottom - 0.1;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: chalkTexture(w, h) }));
    board.rotation.y = Math.PI / 2; // +x(방 안쪽)를 보게
    board.position.set(r.x2 + 0.002, (bottom + f.height) / 2, (r.z1 + r.z2) / 2);
    g.add(board);
    box(g, { x1: r.x2, z1: r.z1, x2: r.x2 + 0.08, z2: r.z2 }, bottom - 0.03, bottom, M.woodDark); // 분필 받침
  },

  desk(g, f) {
    table(g, f.rect, f.height, M.wood, M.woodDark);
    // 앞가림판 (학생 쪽, +x 면)
    const r = f.rect;
    box(g, { x1: r.x2 - 0.06, z1: r.z1 + 0.05, x2: r.x2 - 0.03, z2: r.z2 - 0.05 }, 0.25, f.height - 0.04, M.woodDark);
  },

  standingDesk(g, f) {
    const r = f.rect;
    const cx = (r.x1 + r.x2) / 2;
    const cz = (r.z1 + r.z2) / 2;
    box(g, r, f.height - 0.04, f.height, M.wood); // 상판
    box(g, { x1: cx - 0.1, z1: cz - 0.1, x2: cx + 0.1, z2: cz + 0.1 }, 0.04, f.height - 0.04, M.metal); // 기둥
    box(g, { x1: r.x1 + 0.15, z1: cz - 0.3, x2: r.x2 - 0.15, z2: cz + 0.3 }, 0, 0.04, M.metal); // 받침
    // 노트북: 화면이 교사 자리(칠판 쪽, −x)를 향한다
    const y = f.height;
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.02, 0.34), M.handle);
    base.position.set(cx + 0.05, y + 0.01, cz);
    const screenGroup = new THREE.Group();
    screenGroup.position.set(cx + 0.17, y + 0.02, cz);
    screenGroup.rotation.z = -0.25; // 뒤로(+x) 살짝 젖힘
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.22, 0.34), M.handle);
    lid.position.y = 0.11;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.19), new THREE.MeshBasicMaterial({ color: 0x3a7f9e }));
    screen.rotation.y = -Math.PI / 2;
    screen.position.set(-0.009, 0.11, 0);
    screenGroup.add(lid, screen);
    g.add(base, screenGroup);
  },

  labBench(g, f) {
    const r = f.rect;
    box(g, r, f.height - 0.04, f.height, M.epoxy); // 상판
    const inner = inset(r, 0.06);
    box(g, inner, 0.08, f.height - 0.04, M.cabinet); // 하부 수납장
    box(g, inset(r, 0.1), 0, 0.08, M.plastic); // 걸레받이
    // 긴 두 면 모두 수납장 문 (양쪽에서 쓰는 실험대)
    const long: 'x' | 'z' = r.x2 - r.x1 > r.z2 - r.z1 ? 'z' : 'x';
    doors(g, inner, { axis: long, sign: 1 }, 0.12, f.height - 0.08, false);
    doors(g, inner, { axis: long, sign: -1 }, 0.12, f.height - 0.08, false);
    // 문이 없는 짧은 두 옆면에 2구 콘센트 (전자 장비용)
    const cx = (inner.x1 + inner.x2) / 2;
    const cz = (inner.z1 + inner.z2) / 2;
    const y = 0.62;
    if (long === 'x') {
      outlets.push(new Outlet(new THREE.Vector3(cx, y, inner.z2), new THREE.Vector3(0, 0, 1)));
      outlets.push(new Outlet(new THREE.Vector3(cx, y, inner.z1), new THREE.Vector3(0, 0, -1)));
    } else {
      outlets.push(new Outlet(new THREE.Vector3(inner.x2, y, cz), new THREE.Vector3(1, 0, 0)));
      outlets.push(new Outlet(new THREE.Vector3(inner.x1, y, cz), new THREE.Vector3(-1, 0, 0)));
    }
  },

  tallCabinet(g, f) {
    // 속이 빈 보관장: 칸마다 여닫는 문과 선반 (앞쪽 2칸은 스탠드 같은 긴 기구용)
    const cab = new StorageCabinet(f.rect, frontOf(f.rect), f.height, 2, {
      body: M.cabinet, door: M.door, glass: M.glass, handle: M.handle,
    });
    g.add(cab.group);
    cabinets.set(f.name, cab);
  },

  lowCabinet(g, f) {
    const r = f.rect;
    const front = frontOf(r);
    box(g, inset(r, 0.02), 0, f.height - 0.04, M.cabinet);
    box(g, grow(r, front, 0.03), f.height - 0.04, f.height, M.epoxy); // 상판 (앞으로 살짝 튀어나옴)
    doors(g, inset(r, 0.02), front, 0.1, f.height - 0.08, false);
  },

  prepTable(g, f) {
    table(g, f.rect, f.height, M.epoxy, M.metal);
  },

  wasteCabinet(g, f) {
    const r = f.rect;
    const front = frontOf(r);
    box(g, r, 0, f.height, M.cabinet);
    doors(g, r, front, 0.05, f.height - 0.12, false);
    // 경고 띠 (앞면 위쪽)
    box(g, faceStrip(r, front, 0.012), f.height - 0.1, f.height - 0.04, M.hazard);
    // 위에 폐액통 2개 — 도면의 동그라미 두 개
    const n = 2;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.32, 8), M.white);
      can.position.set(r.x1 + t * (r.x2 - r.x1), f.height + 0.16, (r.z1 + r.z2) / 2);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 6), M.hazard);
      cap.position.set(can.position.x, f.height + 0.34, can.position.z);
      g.add(can, cap);
    }
  },

  bin(g, f) {
    const r = f.rect;
    const cx = (r.x1 + r.x2) / 2;
    const cz = (r.z1 + r.z2) / 2;
    const rad = (r.x2 - r.x1) / 2 - 0.02;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad * 0.85, f.height, 10, 1, true), M.plastic);
    body.material = M.plastic.clone();
    (body.material as THREE.MeshLambertMaterial).side = THREE.DoubleSide;
    body.position.set(cx, f.height / 2, cz);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(rad * 0.85, 10), M.handle);
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.set(cx, 0.02, cz);
    g.add(body, bottom);
  },

  largeEquipment(g, f) {
    const r = f.rect;
    // 나무 상자
    box(g, { x1: r.x1, z1: r.z1 + 0.2, x2: r.x1 + 0.9, z2: r.z2 }, 0, 0.8, M.wood);
    // 기체 봄베 2개 (초록: 산소)
    for (const dx of [1.15, 1.45]) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.2, 8), lambert(0x2f6b45));
      tank.position.set(r.x1 + dx, 0.6, r.z2 - 0.25);
      const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.12, 6), M.metal);
      valve.position.set(tank.position.x, 1.26, tank.position.z);
      g.add(tank, valve);
    }
    // 덮개 씌운 장비
    box(g, { x1: r.x2 - 0.6, z1: r.z1 + 0.3, x2: r.x2, z2: r.z2 }, 0, 1.0, M.plastic);
  },
};

// ====================== 도우미 함수 ======================

/** 도면 직사각형을 높이 y1~y2의 상자로 세운다. */
function box(g: THREE.Group, r: Rect, y1: number, y2: number, mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.BoxGeometry(r.x2 - r.x1, y2 - y1, r.z2 - r.z1);
  const m = new THREE.Mesh(geo, mat);
  m.position.set((r.x1 + r.x2) / 2, (y1 + y2) / 2, (r.z1 + r.z2) / 2);
  worldUV(geo, m.position); // 텍스처 1장 = 1 m
  g.add(m);
  return m;
}

/** 상판 + 다리 4개 */
function table(g: THREE.Group, r: Rect, h: number, top: THREE.Material, leg: THREE.Material): void {
  box(g, r, h - 0.04, h, top);
  const l = 0.05;
  const a = inset(r, 0.04);
  for (const [x, z] of [[a.x1, a.z1], [a.x2 - l, a.z1], [a.x1, a.z2 - l], [a.x2 - l, a.z2 - l]]) {
    box(g, { x1: x, z1: z, x2: x + l, z2: z + l }, 0, h - 0.04, leg);
  }
}

function inset(r: Rect, d: number): Rect {
  return { x1: r.x1 + d, z1: r.z1 + d, x2: r.x2 - d, z2: r.z2 - d };
}

/** 앞면 방향: axis 축으로 sign(±1) 쪽을 향한다 */
interface Front {
  axis: 'x' | 'z';
  sign: 1 | -1;
}

/** 벽에 붙은 가구의 앞면 = 얇은 쪽 축에서 방 중심을 향하는 방향 */
function frontOf(r: Rect): Front {
  const cx = (r.x1 + r.x2) / 2;
  const cz = (r.z1 + r.z2) / 2;
  const room = ROOMS.find(({ rect: q }) => cx >= q.x1 && cx <= q.x2 && cz >= q.z1 && cz <= q.z2)?.rect ?? r;
  const axis = r.x2 - r.x1 < r.z2 - r.z1 ? 'x' : 'z';
  const toRoom = axis === 'x' ? (room.x1 + room.x2) / 2 - cx : (room.z1 + room.z2) / 2 - cz;
  return { axis, sign: toRoom >= 0 ? 1 : -1 };
}

/** 앞면 쪽으로 d만큼 늘린 직사각형 */
function grow(r: Rect, f: Front, d: number): Rect {
  const q = { ...r };
  if (f.axis === 'x') f.sign > 0 ? (q.x2 += d) : (q.x1 -= d);
  else f.sign > 0 ? (q.z2 += d) : (q.z1 -= d);
  return q;
}

/** 앞면에 붙는 두께 t의 얇은 띠 */
function faceStrip(r: Rect, f: Front, t: number): Rect {
  if (f.axis === 'x') {
    const x = f.sign > 0 ? r.x2 : r.x1 - t;
    return { x1: x, z1: r.z1 + 0.02, x2: x + t, z2: r.z2 - 0.02 };
  }
  const z = f.sign > 0 ? r.z2 : r.z1 - t;
  return { x1: r.x1 + 0.02, z1: z, x2: r.x2 - 0.02, z2: z + t };
}

/** 앞면에 약 0.6 m 폭의 문짝들과 손잡이를 단다 */
function doors(g: THREE.Group, r: Rect, f: Front, y1: number, y2: number, glass: boolean): void {
  const along = f.axis === 'x' ? [r.z1, r.z2] : [r.x1, r.x2];
  const len = along[1] - along[0];
  const n = Math.max(1, Math.round(len / 0.6));
  const w = len / n;
  const t = 0.015;
  const gap = 0.012;
  for (let i = 0; i < n; i++) {
    const a = along[0] + i * w + gap;
    const b = along[0] + (i + 1) * w - gap;
    const face = f.axis === 'x' ? (f.sign > 0 ? r.x2 : r.x1 - t) : f.sign > 0 ? r.z2 : r.z1 - t;
    const rect: Rect = f.axis === 'x' ? { x1: face, z1: a, x2: face + t, z2: b } : { x1: a, z1: face, x2: b, z2: face + t };
    box(g, rect, y1, y2, glass ? M.glass : M.door);
    // 손잡이: 짝수 번째 문은 오른쪽 끝, 홀수는 왼쪽 끝 → 양문처럼 보이게
    const hAlong = i % 2 === 0 ? b - 0.06 : a + 0.04;
    const hy = glass ? y1 + 0.15 : y2 - 0.12;
    const hf = f.axis === 'x' ? (f.sign > 0 ? face + t : face - 0.02) : f.sign > 0 ? face + t : face - 0.02;
    const hr: Rect = f.axis === 'x' ? { x1: hf, z1: hAlong, x2: hf + 0.02, z2: hAlong + 0.02 } : { x1: hAlong, z1: hf, x2: hAlong + 0.02, z2: hf + 0.02 };
    box(g, hr, hy - 0.06, hy + 0.06, M.handle);
  }
}

/**
 * 칠판에 분필 글씨 (진자 주기 공식 — 1단계 예고)
 * 저해상도 캔버스 + 픽셀 글꼴(Galmuri) + NearestFilter → 도트 글씨.
 * 글꼴 파일이 늦게 로드되면 로드 후에 다시 그린다.
 */
function chalkTexture(w: number, h: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = Math.round((320 * h) / w);
  const g = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  const draw = () => {
    g.fillStyle = '#1f3527';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(150,170,150,0.12)'; // 지운 자국
    g.fillRect(180, 8, 120, 30);
    g.fillStyle = '#e6e4d6';
    g.font = '12px Galmuri11, monospace';
    g.fillText('가상 실험실', 14, 20);
    g.fillText('단진자의 주기  T = 2π√(L/g)', 14, 40);
    g.fillStyle = '#a9ad9e';
    g.fillText('sin θ ≈ θ 는 어디까지 맞을까?', 14, 58);
    tex.needsUpdate = true;
  };
  draw();
  document.fonts?.load('12px Galmuri11').then(draw, () => {});
  return tex;
}
