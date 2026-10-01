/**
 * 광학 기구: 레이저, 슬릿판, 스크린
 *
 * - 셋 다 [grip] 플러그가 있어 스탠드 + 클램프로 원하는 높이·방향에 고정할 수 있다.
 * - 책상 위에 그냥 세워도 높이가 대략 맞도록 만들었다:
 *     레이저 빛 높이 3.5 cm, 슬릿 중심 4.5 cm, 스크린 중심 11 cm (스크린 세로 20 cm)
 * - 슬릿판의 틀에는 미세 조정 나사가 있다고 보고, 빛이 슬릿 중심에서 ±2 cm 안에 닿으면
 *   슬릿을 빛에 맞춘 것으로 처리한다 (그보다 벗어나면 판에 막힘).
 * - 기구의 "앞"은 물체 좌표 +x: 레이저는 +x로 빛을 쏜다.
 */
import * as THREE from 'three';
import { Item } from '../world/items';
import type { Action } from '../world/interactable';
import type { OutletPort, Powered } from '../world/power';
import type { Aperture } from '../sim/optics';
import { wavelengthToRGB } from '../sim/optics';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const BLACK = new THREE.MeshLambertMaterial({ color: 0x1a1b19 });
const DARK = new THREE.MeshLambertMaterial({ color: 0x242523 });

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/** 레이저가 고를 수 있는 파장 */
export const LASER_LINES = [
  { nm: 650, name: '빨강' },
  { nm: 532, name: '초록' },
  { nm: 405, name: '보라' },
] as const;

/** 레이저 빛이 어떤 면에 비친 정보 (광선 추적이 매 프레임 채운다) */
export interface LightPattern {
  lambda: number;
  color: THREE.Color;
  /** 슬릿을 지났으면 그 슬릿, 아니면 null (레이저 점만 비침) */
  ap: Aperture | null;
  /** 빛이 퍼져 나오는 점: 슬릿에 닿은 점 (또는 레이저 출구) */
  source: THREE.Vector3;
  /** 빛의 진행 방향, 무늬가 퍼지는 가로 방향(슬릿에 수직), 세로 방향 (월드, 단위벡터) */
  dir: THREE.Vector3;
  axisH: THREE.Vector3;
  axisV: THREE.Vector3;
  /** 들어온 빛 방향의 가로 성분 (슬릿판이 기울어 있으면 0이 아님) */
  inH: number;
  /** 슬릿 ~ 비친 면 거리 (m) */
  L: number;
  /** 비친 면의 이름 (스크린, 벽 …) */
  surface: string;
}

/** 레이저: 검은 상자 + 회색 전원선. 콘센트에 꽂혀 있어야 켜진다. 파장 3가지 중 선택 */
export class Laser extends Item implements Powered {
  on = false;
  nm: number = LASER_LINES[0].nm;
  /** 출력 (mW) — 광전 효과에서 빛의 세기(광자 수)를 바꾼다 */
  powerMw = 1;
  readonly color = new THREE.Color();
  /** 빛이 나오는 구멍 (물체 좌표) */
  readonly aperture = v(0.08, 0.035, 0);
  readonly cordExit = v(-0.08, 0.012, 0);
  readonly cordLength = 2.0;
  port: OutletPort | null = null;
  /** 이번 프레임에 빛이 만든 무늬 (광선 추적이 채움) */
  pattern: LightPattern | null = null;
  /** 슬릿판에 닿았지만 통과하지 못했을 때의 정렬 안내 (광선 추적이 채움) */
  alignHint: string | null = null;
  /** main.ts가 넣어 줌 */
  powerActions: (l: Laser) => Action[] = () => [];
  onOpenPanel: (l: Laser) => void = () => {};
  /** 광선 경로 패널 (main이 넣어 줌) */
  onOpenRays: (l: Laser) => void = () => {};
  private led: THREE.MeshBasicMaterial;

  constructor() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.16, 0.07, 0.07), BLACK, 0, 0.035, 0)); // 몸통
    g.add(mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.006, 8).rotateZ(Math.PI / 2), DARK, 0.083, 0.035, 0)); // 출구
    const led = new THREE.MeshBasicMaterial({ color: 0x220000 });
    g.add(mesh(new THREE.BoxGeometry(0.012, 0.004, 0.012), led, 0.05, 0.072, 0)); // 윗면 표시등 (파장 색)
    g.add(mesh(new THREE.BoxGeometry(0.01, 0.012, 0.012), DARK, -0.083, 0.012, 0)); // 전원선 부싱
    super(g, {
      name: '레이저', radius: 0.09, mass: 0.5, touchPad: false,
      plugs: [{ type: 'grip', point: v(0, 0.035, 0) }],
    });
    this.led = led;
    this.setWavelength(this.nm);
  }

  /** 파장 (m) */
  get lambda(): number {
    return this.nm * 1e-9;
  }

  /** 켜져 있고 전원이 연결되어 있어야 빛이 나온다 */
  get emitting(): boolean {
    return this.on && this.port !== null;
  }

  setWavelength(nm: number): void {
    this.nm = nm;
    const [r, g, b] = wavelengthToRGB(nm);
    this.color.setRGB(r, g, b);
    this.updateLed();
  }

  updateLed(): void {
    this.led.color.copy(this.emitting ? this.color : new THREE.Color(0x221a14));
  }

  extraActions(): Action[] {
    const out: Action[] = [];
    if (this.port) {
      out.push({ label: this.on ? '레이저 끄기' : '레이저 켜기', run: () => { this.on = !this.on; this.updateLed(); } });
    }
    out.push(...this.powerActions(this));
    for (const l of LASER_LINES) {
      // 보조 동작: 메뉴가 열릴 때(콘센트에 꽂혀 켜기·집기가 함께 있을 때, 또는 길게 누를 때) 나온다
      if (l.nm !== this.nm) out.push({ label: `파장 → ${l.nm} nm (${l.name})`, secondary: true, run: () => this.setWavelength(l.nm) });
    }
    for (const p of [1, 3, 5]) {
      if (p !== this.powerMw) out.push({ label: `세기 → ${p} mW`, secondary: true, run: () => { this.powerMw = p; } });
    }
    return out;
  }

  experimentActions(): Action[] {
    if (!this.emitting) return [];
    const out: Action[] = [{ label: '광선 경로 (레이저)', run: () => this.onOpenRays(this) }];
    if (this.pattern?.ap) out.unshift({ label: '간섭무늬 관찰', run: () => this.onOpenPanel(this) });
    return out;
  }
}

/** 슬릿판: 틀에 끼운 슬릿 + 받침. 가운데 ±2 cm 안에 닿은 빛만 통과시킨다 */
export class SlitPlate extends Item {
  static readonly CENTER_Y = 0.045;

  constructor(readonly ap: Aperture, label: string) {
    const g = new THREE.Group();
    const cy = SlitPlate.CENTER_Y;
    const tex = slitTexture(ap);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.07, 0.09), [
      new THREE.MeshLambertMaterial({ map: tex }), new THREE.MeshLambertMaterial({ map: tex }),
      DARK, DARK, DARK, DARK,
    ]);
    plate.position.y = cy;
    g.add(plate);
    g.add(mesh(new THREE.BoxGeometry(0.04, 0.01, 0.1), DARK, 0, 0.005, 0)); // 받침
    super(g, {
      name: label, radius: 0.05, mass: 0.08, touchPad: false,
      // 집게는 판의 옆 가장자리를 문다: 판 면(법선 +x)이 클램프 팔 방향(집게 좌표 +z)을 보도록 −90° 돌리고,
      // 슬릿 중심은 팔 선에서 4.5 cm 옆으로 비켜난다 → 빛이 팔·막대에 막히지 않음
      plugs: [{ type: 'grip', point: v(0, cy, -0.045), rotY: -Math.PI / 2 }],
    });
  }

  /**
   * 빛이 닿은 점(물체 좌표)이 미세 조정 범위 안인가.
   * 슬릿은 세로로 긴 선이라 세로 방향이 더 너그럽다: 가로 ±2 cm, 세로 ±3 cm
   */
  inWindow(local: THREE.Vector3): boolean {
    return Math.abs(local.z) < 0.02 && Math.abs(local.y - SlitPlate.CENTER_Y) < 0.03;
  }

  /** 범위를 벗어났을 때 안내 문구 (빛이 슬릿 중심보다 어디를 지나는지) */
  missHint(local: THREE.Vector3): string {
    const parts: string[] = [];
    const dy = local.y - SlitPlate.CENTER_Y;
    if (Math.abs(dy) >= 0.03) parts.push(`${(Math.abs(dy) * 100).toFixed(1)} cm ${dy > 0 ? '위' : '아래'}`);
    if (Math.abs(local.z) >= 0.02) parts.push(`옆으로 ${(Math.abs(local.z) * 100).toFixed(1)} cm`);
    return `빛이 슬릿 중심보다 ${parts.join(', ')}를 지남`;
  }
}

/** 스크린: 흰 판(가로 30 cm × 세로 20 cm, 1 cm 격자) + 받침 */
export class OpticScreen extends Item {
  static readonly W = 0.3;
  static readonly H = 0.2;
  static readonly CENTER_Y = 0.11;

  constructor() {
    const g = new THREE.Group();
    const { W, H, CENTER_Y: cy } = OpticScreen;
    g.add(mesh(new THREE.BoxGeometry(0.01, H + 0.01, W + 0.01), DARK, -0.006, cy, 0)); // 뒤판
    const face = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshLambertMaterial({ map: gridTexture() }));
    face.rotation.y = Math.PI / 2; // 평면의 앞(+z)을 +x로
    face.position.set(0, cy, 0);
    g.add(face);
    g.add(mesh(new THREE.BoxGeometry(0.06, 0.01, 0.2), DARK, -0.006, 0.005, 0)); // 받침
    super(g, {
      name: '스크린', radius: 0.08, mass: 0.3, touchPad: false,
      // 슬릿판과 같은 방식: 옆 가장자리를 물고, 흰 면이 클램프 팔 방향을 본다
      plugs: [{ type: 'grip', point: v(0, cy, -W / 2), rotY: -Math.PI / 2 }],
    });
  }
}

// ---------- 텍스처 ----------

function pixelCanvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

/** 슬릿판 앞면: 검은 판에 가는 흰 선 (이중이면 2개) */
function slitTexture(ap: Aperture): THREE.CanvasTexture {
  return pixelCanvas(36, 28, (g) => {
    g.fillStyle = '#1b1c19';
    g.fillRect(0, 0, 36, 28);
    g.fillStyle = '#6a6c62';
    g.fillRect(2, 2, 32, 2); // 라벨 자리
    g.fillStyle = '#e8e4d0';
    if (ap.kind === 'double') {
      g.fillRect(16, 9, 1, 10);
      g.fillRect(19, 9, 1, 10);
    } else g.fillRect(17, 9, 2, 10);
  });
}

/** 스크린 면: 흰 종이 + 1 cm 격자 (30 × 20 cm → 60 × 40 px) */
function gridTexture(): THREE.CanvasTexture {
  return pixelCanvas(60, 40, (g) => {
    g.fillStyle = '#e4e0d0';
    g.fillRect(0, 0, 60, 40);
    g.fillStyle = '#b9b4a0';
    for (let x = 0; x < 60; x += 2) g.fillRect(x, 0, 1, 40);
    for (let y = 0; y < 40; y += 2) g.fillRect(0, y, 60, 1);
    g.fillStyle = '#8a846e';
    g.fillRect(30, 0, 1, 40);
    g.fillRect(0, 20, 60, 1);
  });
}
