/**
 * 광학 기구: 광학대, 레이저, 슬릿판, 스크린
 *
 * 연결: 레이저·슬릿판·스크린 [railMount] → 광학대 레일 (원하는 위치에, 레일 가운데를 향하게)
 * 모든 광학 기구는 받침 바닥에서 광축(빛이 지나는 높이)까지 OPTIC_AXIS로 같다
 *   → 광학대 위에 올리면 레이저 빛이 슬릿과 스크린의 가운데를 자동으로 지난다.
 * 기구의 "앞"은 물체 좌표 +x: 레이저는 +x로 빛을 쏘고, 스크린은 +x 쪽 면에 무늬가 비친다.
 */
import * as THREE from 'three';
import { Item, Socket } from '../world/items';
import type { Action } from '../world/interactable';
import type { Aperture } from '../sim/optics';
import { intensity as intensityFn, wavelengthToRGB } from '../sim/optics';

export const OPTIC_AXIS = 0.15; // m (받침 바닥 ~ 광축)
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const DARK = new THREE.MeshLambertMaterial({ color: 0x2e302c });
const METAL = new THREE.MeshLambertMaterial({ color: 0x6f7470 });

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/** 받침 + 기둥 (레일에 끼우는 공통 부분) */
function carrier(g: THREE.Group, top: number): void {
  g.add(mesh(new THREE.BoxGeometry(0.06, 0.012, 0.06), DARK, 0, 0.006, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.005, 0.005, top - 0.012, 6), METAL, 0, 0.012 + (top - 0.012) / 2, 0));
}

const railPlug = () => [{ type: 'railMount' as const, point: v(0, 0, 0) }];

/** 광학대: 길이 1 m 레일. 옆면에 cm 눈금 */
export class OpticalRail extends Item {
  static readonly LENGTH = 1.0;
  readonly rail: Socket;

  constructor() {
    const g = new THREE.Group();
    const L = OpticalRail.LENGTH;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(L, 0.03, 0.05), [
      DARK, DARK, DARK, DARK,
      new THREE.MeshLambertMaterial({ map: rulerTexture(L) }), // 앞(+z) 면: 눈금
      new THREE.MeshLambertMaterial({ map: rulerTexture(L) }), // 뒤(−z) 면
    ]);
    bar.position.y = 0.015 + 0.01;
    g.add(bar);
    for (const x of [-L / 2 + 0.04, L / 2 - 0.04]) g.add(mesh(new THREE.BoxGeometry(0.03, 0.01, 0.12), DARK, x, 0.005, 0)); // 다리
    super(g, { name: '광학대', radius: 0.12, mass: 2.5, touchPad: false });
    this.rail = new Socket(this, '광학대 레일', ['railMount'], v(0, 0.04, 0), {
      multi: true, slide: { min: -L / 2 + 0.03, max: L / 2 - 0.03, axis: 'x' }, hitRadius: 0.03, faceCenter: true,
    });
  }

  extraActions(): Action[] {
    return this.rotateAction();
  }
}

/** 레이저: 파장 λ의 가는 빛을 +x로 쏜다 */
export class Laser extends Item {
  on = false;
  readonly color: THREE.Color;
  /** 빛이 나오는 구멍 (물체 좌표) */
  readonly aperture = v(0.08, OPTIC_AXIS, 0);
  private lamp: THREE.MeshBasicMaterial;

  constructor(readonly nm: number, label: string) {
    const g = new THREE.Group();
    carrier(g, OPTIC_AXIS - 0.02);
    const [r, gg, b] = wavelengthToRGB(nm);
    const color = new THREE.Color(r, gg, b);
    g.add(mesh(new THREE.BoxGeometry(0.16, 0.04, 0.04), new THREE.MeshLambertMaterial({ color: 0x3a3d38 }), 0, OPTIC_AXIS, 0));
    // 앞쪽 띠: 파장 색 (어떤 레이저인지 한눈에)
    g.add(mesh(new THREE.BoxGeometry(0.02, 0.042, 0.042), new THREE.MeshLambertMaterial({ color }), 0.05, OPTIC_AXIS, 0));
    const lamp = new THREE.MeshBasicMaterial({ color: 0x220000 });
    g.add(mesh(new THREE.BoxGeometry(0.006, 0.01, 0.01), lamp, 0.081, OPTIC_AXIS, 0)); // 출구 (켜지면 빛남)
    super(g, { name: `레이저 ${label} ${nm} nm`, radius: 0.09, mass: 0.4, touchPad: false, plugs: railPlug() });
    this.color = color;
    this.lamp = lamp;
  }

  /** 파장 (m) */
  get lambda(): number {
    return this.nm * 1e-9;
  }

  /** 광학대에 끼워져 있으면 켜기/끄기가 주 동작, 따로 놓여 있으면 (집기가 먼저) 길게 눌러서 켠다 */
  extraActions(): Action[] {
    return [
      { label: this.on ? '레이저 끄기' : '레이저 켜기', run: () => this.toggle(), secondary: !this.attachedTo && !this.on },
      ...this.rotateAction(),
    ];
  }

  toggle(): void {
    this.on = !this.on;
    this.lamp.color.copy(this.on ? this.color : new THREE.Color(0x220000));
  }
}

/** 슬릿판: 가운데 창을 지나는 빛만 통과시키고, 슬릿 모양(aperture)에 따라 회절·간섭시킨다 */
export class SlitPlate extends Item {
  constructor(readonly ap: Aperture, label: string) {
    const g = new THREE.Group();
    carrier(g, OPTIC_AXIS - 0.035);
    const tex = slitTexture(ap);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.07, 0.09), [
      new THREE.MeshLambertMaterial({ map: tex }), new THREE.MeshLambertMaterial({ map: tex }),
      DARK, DARK, DARK, DARK,
    ]);
    plate.position.y = OPTIC_AXIS;
    g.add(plate);
    super(g, { name: label, radius: 0.05, mass: 0.1, touchPad: false, plugs: railPlug() });
  }

  /** 광선이 판에 닿은 점(물체 좌표)이 슬릿 창 안인가 — 창: 가로 ±4 mm, 세로 ±8 mm */
  inWindow(local: THREE.Vector3): boolean {
    return Math.abs(local.z) < 0.004 && Math.abs(local.y - OPTIC_AXIS) < 0.008;
  }

  extraActions(): Action[] {
    return this.rotateAction();
  }
}

/** 스크린에 비친 빛의 정보 (광선 추적이 매 프레임 채운다) */
export interface ScreenLight {
  lambda: number;
  color: THREE.Color;
  /** 슬릿을 지났으면 그 슬릿, 아니면 null (레이저 점만 비침) */
  ap: Aperture | null;
  /** 빛이 퍼져 나오는 점: 슬릿 중심 (또는 레이저 출구) */
  source: THREE.Vector3;
  /** 빛의 진행 방향, 무늬가 퍼지는 가로 방향, 세로 방향 (월드, 단위벡터) */
  dir: THREE.Vector3;
  axisH: THREE.Vector3;
  axisV: THREE.Vector3;
  /** 슬릿 ~ 스크린 거리 (m) */
  L: number;
}

/** 스크린: 흰 판(가로 30 cm × 세로 20 cm), 1 cm 격자. 레이저 빛은 스스로 빛나는 텍스처로 그린다 */
export class OpticScreen extends Item {
  static readonly W = 0.3;
  static readonly H = 0.2;
  static readonly TEX_W = 256;
  light: ScreenLight | null = null;
  onOpenPanel: (s: OpticScreen) => void = () => {};
  readonly face: THREE.Mesh;
  private glow: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private key = '';

  constructor() {
    const g = new THREE.Group();
    const W = OpticScreen.W;
    const H = OpticScreen.H;
    carrier(g, OPTIC_AXIS - H / 2);
    g.add(mesh(new THREE.BoxGeometry(0.01, H + 0.01, W + 0.01), DARK, -0.006, OPTIC_AXIS, 0)); // 뒤판
    const c = document.createElement('canvas');
    c.width = OpticScreen.TEX_W;
    c.height = Math.round((OpticScreen.TEX_W * H) / W);
    const glow = new THREE.CanvasTexture(c);
    glow.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshLambertMaterial({ map: gridTexture(), emissive: 0xffffff, emissiveMap: glow }),
    );
    face.rotation.y = Math.PI / 2; // 평면의 앞(+z)을 +x로
    face.position.set(0, OPTIC_AXIS, 0);
    g.add(face);
    super(g, { name: '스크린', radius: 0.08, mass: 0.3, touchPad: false, plugs: railPlug() });
    this.face = face;
    this.glow = glow;
    this.ctx = c.getContext('2d')!;
    this.clear();
  }

  experimentActions(): Action[] {
    return this.light?.ap ? [{ label: '간섭무늬 관찰', run: () => this.onOpenPanel(this) }] : [];
  }

  extraActions(): Action[] {
    return this.rotateAction();
  }

  private clear(): void {
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    this.glow.needsUpdate = true;
  }

  /**
   * 이번 프레임에 비친 빛을 받는다. 바뀌었을 때만 텍스처를 다시 그린다.
   * 텍셀마다: 스크린 위 점 P의 월드 좌표 → 슬릿에서 본 각도 sinθ → 세기 I(θ)
   */
  setLight(light: ScreenLight | null): void {
    this.light = light;
    const key = light
      ? [light.lambda, light.ap?.d, light.ap?.a, light.ap?.kind, ...light.source.toArray(), ...light.dir.toArray(), light.L]
        .map((n) => (typeof n === 'number' ? n.toFixed(4) : n)).join()
        + this.object.matrixWorld.elements.map((n) => n.toFixed(3)).join()
      : '';
    if (key === this.key) return;
    this.key = key;
    if (!light) return this.clear();

    const { ctx } = this;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const img = ctx.createImageData(w, h);
    const W = OpticScreen.W;
    const H = OpticScreen.H;
    const texel = W / w;
    const sigma = Math.max(0.001, 1.2 * texel); // 레이저 빔 반지름 ≈ 1 mm (텍셀보다 가늘면 안 보이므로 최소 1.2 텍셀)
    const P = new THREE.Vector3();
    const rel = new THREE.Vector3();
    this.face.updateWorldMatrix(true, false);
    const [cr, cg, cb] = [light.color.r, light.color.g, light.color.b];
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        // 평면 좌표 → 월드 (평면의 x = 가로, y = 세로)
        P.set((i + 0.5) * texel - W / 2, H / 2 - (j + 0.5) * texel, 0).applyMatrix4(this.face.matrixWorld);
        rel.subVectors(P, light.source);
        const along = rel.dot(light.dir);
        const lat = rel.dot(light.axisH);
        const vert = rel.dot(light.axisV);
        let I: number;
        if (light.ap) {
          const sinT = lat / Math.hypot(lat, along);
          I = intensityFn(light.ap, light.lambda, sinT) * Math.exp(-(vert * vert) / (2 * sigma * sigma));
        } else {
          I = Math.exp(-(lat * lat + vert * vert) / (2 * sigma * sigma)); // 레이저 점
        }
        const k = (j * w + i) * 4;
        const e = Math.min(1, I * 1.4);
        img.data[k] = 255 * Math.min(1, cr * e + 0.25 * e * e);
        img.data[k + 1] = 255 * Math.min(1, cg * e + 0.25 * e * e);
        img.data[k + 2] = 255 * Math.min(1, cb * e + 0.25 * e * e);
        img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.glow.needsUpdate = true;
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

/** 광학대 옆면 눈금: 1 cm마다 짧은 선, 10 cm마다 긴 선 */
function rulerTexture(L: number): THREE.CanvasTexture {
  const px = Math.round(L * 200); // 2 px = 1 cm
  return pixelCanvas(px, 8, (g) => {
    g.fillStyle = '#c9c4a8';
    g.fillRect(0, 0, px, 8);
    g.fillStyle = '#2a2a22';
    for (let cm = 0; cm <= L * 100; cm++) g.fillRect(Math.min(px - 1, cm * 2), 0, 1, cm % 10 === 0 ? 6 : cm % 5 === 0 ? 4 : 2);
  });
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
