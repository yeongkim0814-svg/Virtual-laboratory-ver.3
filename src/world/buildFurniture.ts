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

const CAB_MATS = { body: M.cabinet, door: M.door, glass: M.glass, handle: M.handle };

/** 만들어진 보관장들 (이름 → 보관장) — 기구를 넣을 자리를 찾을 때 쓴다 */
const cabinets = new Map<string, StorageCabinet>();
const outlets: Outlet[] = [];
const wasteCans: THREE.Object3D[] = [];
const tickers: ((t: number) => void)[] = [];

export interface FurnitureResult {
  cabinets: Map<string, StorageCabinet>;
  /** 여닫을 수 있는 보관장 문 전부 */
  doors: CabinetDoor[];
  /** 실험 테이블 옆면의 콘센트 (장면에는 PowerSystem이 넣는다) */
  outlets: Outlet[];
  /** 폐시약 보관함 위의 폐액통 (main이 폐액통 동작을 붙인다) */
  wasteCans: THREE.Object3D[];
  /** 매 프레임 불러 줄 것 (시약장 온도·습도 표시 등), t = 경과 시간 (s) */
  tickers: ((t: number) => void)[];
}

export function buildFurniture(scene: THREE.Scene): FurnitureResult {
  cabinets.clear();
  outlets.length = 0;
  wasteCans.length = 0;
  tickers.length = 0;
  for (const f of FURNITURE) {
    const g = new THREE.Group();
    g.name = f.name;
    BUILDERS[f.kind](g, f);
    scene.add(g);
  }
  return { cabinets, doors: [...cabinets.values()].flatMap((c) => c.doors), outlets: [...outlets], wasteCans: [...wasteCans], tickers: [...tickers] };
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
    // 다리 4개짜리 높은 책상 (위의 노트북은 따로 기구로 놓인다 — 노트북 3)
    table(g, f.rect, f.height, M.wood, M.metal);
  },

  labBench(g, f) {
    const r = f.rect;
    box(g, r, f.height - 0.04, f.height, M.epoxy); // 상판
    const inner = inset(r, 0.06);
    // 하부 수납장: 긴 두 면 모두 여닫는 칸 (양쪽에서 쓰는 실험대) → 등을 맞댄 보관장 2개
    const long: 'x' | 'z' = r.x2 - r.x1 > r.z2 - r.z1 ? 'z' : 'x'; // 문이 향하는 축
    const halves: [Rect, 1 | -1][] = long === 'x'
      ? [[{ ...inner, x2: (inner.x1 + inner.x2) / 2 }, -1], [{ ...inner, x1: (inner.x1 + inner.x2) / 2 }, 1]]
      : [[{ ...inner, z2: (inner.z1 + inner.z2) / 2 }, -1], [{ ...inner, z1: (inner.z1 + inner.z2) / 2 }, 1]];
    halves.forEach(([rect, sign], i) => {
      const cab = new StorageCabinet(rect, { axis: long, sign }, f.height - 0.04, 0, CAB_MATS, {
        shelves: [0.06, 0.42], solidDoors: true, top: false,
      });
      g.add(cab.group);
      cabinets.set(`${f.name} ${i ? '+' : '−'}${long} 쪽`, cab);
    });
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
    const cab = new StorageCabinet(f.rect, frontOf(f.rect), f.height, 2, CAB_MATS);
    g.add(cab.group);
    cabinets.set(f.name, cab);
  },

  reagentCabinet(g, f) {
    // 시약 전용 보관장: 흰 철제 몸체 + 문 전체가 유리 (냉장고처럼 속이 보임), 아래 환기구,
    // 위에 온도·습도 표시창. 칸마다 선반 3단
    const H = 1.85;
    const front = frontOf(f.rect);
    const cab = new StorageCabinet(f.rect, front, H, 0, {
      body: lambert(0xdfe2dc), door: M.glass, glass: new THREE.MeshLambertMaterial({ color: 0xb8dde6, transparent: true, opacity: 0.28, depthWrite: false }), handle: M.metal,
    }, { shelves: [0.1, 0.5, 0.9, 1.3], glassDoors: true });
    g.add(cab.group);
    cabinets.set(f.name, cab);
    const W = front.axis === 'x' ? f.rect.z2 - f.rect.z1 : f.rect.x2 - f.rect.x1;
    const D = front.axis === 'x' ? f.rect.x2 - f.rect.x1 : f.rect.z2 - f.rect.z1;
    const local = (m: THREE.Mesh, x: number, y: number, z: number) => { m.position.set(x, y, z); cab.group.add(m); };
    // 머리 부분 (표시창 받침)과 아래 환기구 (어두운 가로줄)
    local(new THREE.Mesh(new THREE.BoxGeometry(W, f.height - H, D), lambert(0xdfe2dc)), 0, (H + f.height) / 2, 0);
    for (let k = 0; k < 3; k++) local(new THREE.Mesh(new THREE.BoxGeometry(W - 0.1, 0.008, 0.004), M.handle), 0, 0.025 + k * 0.022, D / 2 + 0.013);
    // 칸 두 개마다 표시창 하나: 온도·습도 (시약이 변하지 않게 서늘하고 건조하게 유지)
    const units = Math.max(1, Math.round(W / 1.25));
    for (let u = 0; u < units; u++) {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 48;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.NearestFilter;
      const x = -W / 2 + ((u + 0.5) * W) / units;
      local(new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.075), new THREE.MeshBasicMaterial({ map: tex })), x, (H + f.height) / 2, D / 2 + 0.002);
      const seed = u * 17.3;
      const draw = (t: number) => {
        const temp = 18 + 0.35 * Math.sin((t + seed) / 37) + 0.1 * Math.sin((t + seed) / 5.3);
        const rh = 44 + 2 * Math.sin((t + seed) / 53);
        const x2 = c.getContext('2d')!;
        x2.fillStyle = '#0c1a12';
        x2.fillRect(0, 0, 128, 48);
        x2.fillStyle = '#7dffa0';
        x2.font = 'bold 18px monospace';
        x2.fillText(`${temp.toFixed(1)}°C`, 6, 21);
        x2.fillText(`${rh.toFixed(0)}%RH`, 6, 42);
        x2.fillStyle = '#ffb040';
        x2.fillRect(114, 6, 8, 8); // 환기 팬 표시등
        tex.needsUpdate = true;
      };
      draw(0);
      let next = 0;
      tickers.push((t) => {
        if (t < next) return;
        next = t + 2;
        draw(t);
      });
    }
  },

  lowCabinet(g, f) {
    // 낮은 수납장: 여닫는 칸 + 선반 1단. 첫 칸은 레일(1.2 m)용 긴 칸 — 선반 없이, 가로로 긴 문을 아래로 젖혀 연다
    const r = f.rect;
    const front = frontOf(r);
    const body = inset(r, 0.02);
    const W = front.axis === 'x' ? body.z2 - body.z1 : body.x2 - body.x1;
    const rest = W - 1.4;
    const n = Math.max(1, Math.round(rest / 0.6));
    const cab = new StorageCabinet(body, front, f.height - 0.04, 0, CAB_MATS, {
      sections: [1.4, ...new Array(n).fill(rest / n)], shelves: [0.06, 0.45], solidDoors: true, top: false, longSections: [0],
    });
    g.add(cab.group);
    cabinets.set(f.name, cab);
    box(g, grow(r, front, 0.03), f.height - 0.04, f.height, M.epoxy); // 상판 (앞으로 살짝 튀어나옴)
  },

  prepTable(g, f) {
    table(g, f.rect, f.height, M.epoxy, M.metal);
  },

  wasteCabinet(g, f) {
    const r = f.rect;
    const front = frontOf(r);
    const cab = new StorageCabinet(r, front, f.height, 0, CAB_MATS, {
      // 칸 하나 + 양문: 넓은 수납 공간 하나를 가운데에서 양쪽으로 연다
      sections: [1], shelves: [0.05, 0.45], solidDoors: true, doorTop: f.height - 0.12, doubleDoors: true,
    });
    g.add(cab.group);
    cabinets.set(f.name, cab);
    // 경고 띠 (앞면 위쪽, 문 위)
    box(g, faceStrip(r, front, 0.012), f.height - 0.1, f.height - 0.04, M.hazard);
    // 위에 폐액통 2개 — 도면의 동그라미 두 개
    const n = 2;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      // 폐액통 한 개 = 통 + 뚜껑 (한 묶음으로 탭한다)
      const unit = new THREE.Group();
      unit.position.set(r.x1 + t * (r.x2 - r.x1), f.height, (r.z1 + r.z2) / 2);
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.32, 8), M.white);
      can.position.y = 0.16;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 6), M.hazard);
      cap.position.y = 0.34;
      unit.add(can, cap);
      g.add(unit);
      wasteCans.push(unit);
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
