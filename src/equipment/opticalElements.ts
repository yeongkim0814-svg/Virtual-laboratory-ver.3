/**
 * 기하광학 기구: 광학 원판, 평면거울, 반투명 거울, 반원형 아크릴 블록, 삼각 프리즘, 얇은 렌즈, 백색 광원
 *
 * 광학 면은 모양(메시)이 아니라 식으로 정의한다 (다각형 근사면으로 굴절시키면 곡면에서 각도가 틀어진다):
 *   각 기구의 "광학 좌표계"(optic 그룹)에서
 *     거울·반투명 거울·렌즈: 평면 x = 0
 *     반원 블록: 평면 x = 0 (지름 쪽 면) + 원통면 x² + z² = R² (x ≥ 0)   → 원판 가운데 = 지름의 중점
 *     프리즘: 정삼각형 기둥의 세 옆면
 *   빛 높이(책상 위 3.5 cm)를 지나도록 모두 책상에서 0.5 ~ 6.5 cm 높이를 덮는다.
 * 광선 추적은 equipment/beams.ts. 이 파일은 "면과 만나는 점·법선"과 기구별 성질만 알려 준다.
 *
 * 마이컬슨 간섭계용 미세 조정 나사 (거울·반투명 거울):
 *   기울기 나사: 광학 면을 세로축 둘레로 ±0.3° (0.001° 단위) → 두 빛이 비스듬히 겹쳐 곧은 무늬
 *   이동 나사: 면을 법선 방향으로 0 ~ 50 μm (0.01 μm 단위) → 경로차가 2d 바뀜 → 무늬가 λ/2마다 하나씩 지나감
 */
import * as THREE from 'three';
import { Item, Socket } from '../world/items';
import type { Action } from '../world/interactable';
import type { OutletPort, Powered } from '../world/power';
import { ACRYLIC, FLINT, type Glass } from '../sim/rayOptics';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
function mesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}
const DARK = new THREE.MeshLambertMaterial({ color: 0x2e302c });
const BLACK = new THREE.MeshLambertMaterial({ color: 0x1c1d1b });
const SILVER = new THREE.MeshBasicMaterial({ color: 0xd8dde2 });
const GLASS = new THREE.MeshLambertMaterial({ color: 0xa8d4e4, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
const ACRYL = new THREE.MeshLambertMaterial({ color: 0x9fd8e6, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });

/** 광학 면과 만난 점 */
export interface OpticHit {
  t: number;
  /** 월드 좌표 */
  point: THREE.Vector3;
  /** 면의 바깥쪽 법선 (월드, 단위) */
  normal: THREE.Vector3;
  /** 어느 면인가 (기구마다 번호) */
  face: number;
}

/** 빛 높이 범위 (광학 좌표 y) */
const Y0 = 0.005;
const Y1 = 0.068;
const EPS = 1e-6;

/** 광학 기구의 공통 부분 */
export abstract class OpticalElement extends Item {
  /** 광학 좌표계 (미세 조정 나사가 이 그룹을 돌리고 옮긴다) */
  readonly optic = new THREE.Group();
  /** 미세 기울기 (도), 미세 이동 (μm) — 거울·반투명 거울만 */
  fineTilt = 0;
  fineShift = 0;
  onFine: (e: OpticalElement) => void = () => {};
  private inv = new THREE.Matrix4();

  constructor(g: THREE.Group, name: string, radius: number, mass: number) {
    super(g, { name, radius, mass, touchPad: false, plugs: [{ type: 'opticMount', point: v(0, 0, 0) }] });
    g.add(this.optic);
    // 광선 추적의 장면 광선이 이 기구의 모양(메시)에 맞지 않게 표시 — 면은 식으로 계산
    g.userData.opticElement = this;
  }

  /** 미세 조정 나사가 있는 기구인가 */
  get fineAdjustable(): boolean {
    return false;
  }

  applyFine(): void {
    this.optic.rotation.y = THREE.MathUtils.degToRad(this.fineTilt);
    this.optic.position.x = this.fineShift * 1e-6;
    this.optic.updateMatrixWorld(true);
  }

  setFine(tilt: number, shift: number): void {
    this.fineTilt = THREE.MathUtils.clamp(Math.round(tilt * 1000) / 1000, -0.3, 0.3);
    this.fineShift = THREE.MathUtils.clamp(Math.round(shift * 100) / 100, 0, 50);
    this.applyFine();
  }

  extraActions(): Action[] {
    return this.fineAdjustable ? [{ label: '미세 조정 나사 (기울기 · 이동)', local: true, run: () => this.onFine(this) }] : [];
  }

  /**
   * 광선(월드)과 이 기구의 광학 면이 처음 만나는 점. 없으면 null
   */
  intersect(o: THREE.Vector3, d: THREE.Vector3): OpticHit | null {
    this.optic.updateWorldMatrix(true, false);
    this.inv.copy(this.optic.matrixWorld).invert();
    const lo = o.clone().applyMatrix4(this.inv);
    const ld = d.clone().transformDirection(this.inv);
    const h = this.localHit(lo, ld);
    if (!h) return null;
    const p = lo.clone().addScaledVector(ld, h.t).applyMatrix4(this.optic.matrixWorld);
    const n = h.n.clone().transformDirection(this.optic.matrixWorld);
    return { t: h.t, point: p, normal: n, face: h.face };
  }

  /** 광학 좌표계에서 가장 가까운 면 (t > 0) */
  protected abstract localHit(o: THREE.Vector3, d: THREE.Vector3): { t: number; n: THREE.Vector3; face: number } | null;

  /** 광학 좌표계의 원점·x축 (월드) — 렌즈 중심·광축 등 */
  frame(): { c: THREE.Vector3; ax: THREE.Vector3 } {
    this.optic.updateWorldMatrix(true, false);
    return {
      c: new THREE.Vector3(0, 0.035, 0).applyMatrix4(this.optic.matrixWorld),
      ax: new THREE.Vector3(1, 0, 0).transformDirection(this.optic.matrixWorld),
    };
  }
}

/** 평면 x = 0 (|z| ≤ hw, y ∈ [y0, y1]) */
function planeX(o: THREE.Vector3, d: THREE.Vector3, hw: number, y0 = Y0, y1 = Y1): number | null {
  if (Math.abs(d.x) < EPS) return null;
  const t = -o.x / d.x;
  if (t <= EPS) return null;
  const z = o.z + d.z * t;
  const y = o.y + d.y * t;
  return Math.abs(z) <= hw && y >= y0 && y <= y1 ? t : null;
}

/** 평면거울: 앞(+x)만 반사, 뒤는 막힘 */
export class PlaneMirror extends OpticalElement {
  static readonly REFLECT = 0.95;
  constructor(name = '평면거울') {
    const g = new THREE.Group();
    super(g, name, 0.05, 0.15);
    this.optic.add(mesh(new THREE.BoxGeometry(0.004, Y1 - Y0, 0.08), SILVER, 0.0005, (Y0 + Y1) / 2, 0)); // 거울 면
    this.optic.add(mesh(new THREE.BoxGeometry(0.006, Y1 - Y0 + 0.006, 0.086), BLACK, -0.004, (Y0 + Y1) / 2, 0)); // 뒤판
    g.add(mesh(new THREE.BoxGeometry(0.03, 0.006, 0.07), DARK, -0.01, 0.003, 0)); // 받침
  }

  get fineAdjustable(): boolean {
    return true;
  }

  protected localHit(o: THREE.Vector3, d: THREE.Vector3) {
    const t = planeX(o, d, 0.04);
    return t === null ? null : { t, n: v(1, 0, 0), face: 0 };
  }
}

/** 반투명 거울 (빔 분할기): 얇은 판, 반사 50 % · 투과 50 %. 두께에 의한 옆 밀림은 무시 */
export class BeamSplitter extends OpticalElement {
  constructor() {
    const g = new THREE.Group();
    super(g, '반투명 거울 (빔 분할기)', 0.045, 0.1);
    this.optic.add(mesh(new THREE.BoxGeometry(0.002, Y1 - Y0, 0.06), new THREE.MeshLambertMaterial({ color: 0xbcd6e8, transparent: true, opacity: 0.5, depthWrite: false }), 0, (Y0 + Y1) / 2, 0));
    for (const z of [-0.033, 0.033]) this.optic.add(mesh(new THREE.BoxGeometry(0.008, Y1 - Y0 + 0.006, 0.006), BLACK, 0, (Y0 + Y1) / 2, z)); // 틀
    g.add(mesh(new THREE.BoxGeometry(0.03, 0.006, 0.075), DARK, 0, 0.003, 0));
  }

  get fineAdjustable(): boolean {
    return true;
  }

  protected localHit(o: THREE.Vector3, d: THREE.Vector3) {
    const t = planeX(o, d, 0.03);
    return t === null ? null : { t, n: v(1, 0, 0), face: 0 };
  }
}

/** 유리(굴절) 기구 */
export abstract class GlassElement extends OpticalElement {
  abstract readonly glass: Glass;
}

/** 반원형 아크릴 블록: 반지름 5 cm, 지름 쪽 평면이 원판 가운데를 지난다 */
export class HalfDisk extends GlassElement {
  static readonly R = 0.05;
  readonly glass = ACRYLIC;

  constructor() {
    const g = new THREE.Group();
    super(g, '반원형 아크릴 블록', 0.06, 0.12);
    const R = HalfDisk.R;
    // 반원 기둥: 원통 조각(θ = 0 ~ π, x ≥ 0 쪽) + 평면
    const geo = new THREE.CylinderGeometry(R, R, Y1 - Y0, 32, 1, false, 0, Math.PI);
    const m = mesh(geo, ACRYL, 0, (Y0 + Y1) / 2, 0);
    this.optic.add(m);
    this.optic.add(mesh(new THREE.BoxGeometry(0.001, 0.004, 0.001), BLACK, 0, Y1 + 0.001, 0)); // 가운데 표시
  }

  protected localHit(o: THREE.Vector3, d: THREE.Vector3) {
    const R = HalfDisk.R;
    let best: { t: number; n: THREE.Vector3; face: number } | null = null;
    const tp = planeX(o, d, R);
    if (tp !== null) best = { t: tp, n: v(-1, 0, 0), face: 0 };
    // 원통 x² + z² = R²
    const a = d.x * d.x + d.z * d.z;
    const b = 2 * (o.x * d.x + o.z * d.z);
    const c = o.x * o.x + o.z * o.z - R * R;
    const disc = b * b - 4 * a * c;
    if (a > EPS && disc >= 0) {
      for (const s of [-1, 1]) {
        const t = (-b + s * Math.sqrt(disc)) / (2 * a);
        if (t <= EPS || (best && t >= best.t)) continue;
        const p = o.clone().addScaledVector(d, t);
        if (p.x < -EPS || p.y < Y0 || p.y > Y1) continue;
        best = { t, n: v(p.x, 0, p.z).normalize(), face: 1 };
      }
    }
    return best;
  }
}

/** 삼각 프리즘 (정삼각형, 한 변 6 cm, 꼭지각 60°, 플린트 유리) */
export class Prism extends GlassElement {
  static readonly SIDE = 0.06;
  readonly glass = FLINT;
  /** 옆면들: 바깥 법선 n, n·p = c */
  private faces: { n: THREE.Vector3; c: number }[] = [];

  constructor() {
    const g = new THREE.Group();
    super(g, '삼각 프리즘 (플린트 유리 60°)', 0.05, 0.2);
    const s = Prism.SIDE;
    const rIn = s / (2 * Math.sqrt(3)); // 내접원 반지름 = 중심 ~ 면 거리
    // 꼭짓점 하나가 −x 쪽을 향함 → 면 법선은 0°, 120°, 240° 방향 (x축 기준, 위에서 볼 때)
    for (const deg of [0, 120, 240]) {
      const a = THREE.MathUtils.degToRad(deg);
      this.faces.push({ n: v(Math.cos(a), 0, -Math.sin(a)), c: rIn });
    }
    const R = s / Math.sqrt(3);
    const shape = new THREE.Shape();
    [180, 60, 300].forEach((deg, i) => {
      const a = THREE.MathUtils.degToRad(deg);
      const x = R * Math.cos(a);
      const z = -R * Math.sin(a);
      if (i === 0) shape.moveTo(x, -z);
      else shape.lineTo(x, -z);
    });
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: Y1 - Y0, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2); // 모양 평면(x, y) → 수평(x, −z), 두께 → +y
    const m = mesh(geo, GLASS, 0, Y0, 0);
    this.optic.add(m);
  }

  protected localHit(o: THREE.Vector3, d: THREE.Vector3) {
    let best: { t: number; n: THREE.Vector3; face: number } | null = null;
    this.faces.forEach((f, i) => {
      const dn = f.n.dot(d);
      if (Math.abs(dn) < EPS) return;
      const t = (f.c - f.n.dot(o)) / dn;
      if (t <= EPS || (best && t >= best.t)) return;
      const p = o.clone().addScaledVector(d, t);
      if (p.y < Y0 || p.y > Y1) return;
      // 삼각형 안 (다른 두 면의 안쪽)
      for (let k = 0; k < 3; k++) if (k !== i && this.faces[k].n.dot(p) > this.faces[k].c + 1e-5) return;
      best = { t, n: f.n.clone(), face: i };
    });
    return best;
  }
}

/** 얇은 렌즈 (이상적): 지름 5 cm, 중심이 빛 높이 3.5 cm */
export class ThinLens extends OpticalElement {
  static readonly RADIUS = 0.025;

  constructor(readonly f: number) {
    const g = new THREE.Group();
    super(g, `${f > 0 ? '볼록' : '오목'} 렌즈 (f = ${f > 0 ? '+' : ''}${Math.round(f * 100)} cm)`, 0.04, 0.08);
    const R = ThinLens.RADIUS;
    // 볼록: 가운데가 두꺼움, 오목: 가장자리가 두꺼움 (보기용)
    const lens = new THREE.Mesh(new THREE.SphereGeometry(R, 16, 10), GLASS);
    lens.scale.set(f > 0 ? 0.22 : 0.08, 1, 1);
    lens.position.y = 0.035;
    this.optic.add(lens);
    if (f < 0) this.optic.add(mesh(new THREE.TorusGeometry(R, 0.004, 6, 16).rotateY(Math.PI / 2), GLASS, 0, 0.035, 0));
    this.optic.add(mesh(new THREE.TorusGeometry(R + 0.002, 0.002, 4, 16).rotateY(Math.PI / 2), BLACK, 0, 0.035, 0)); // 테
    g.add(mesh(new THREE.BoxGeometry(0.006, 0.008, 0.006), BLACK, 0, 0.004, 0)); // 기둥
    g.add(mesh(new THREE.BoxGeometry(0.03, 0.004, 0.05), DARK, 0, 0.002, 0));
  }

  protected localHit(o: THREE.Vector3, d: THREE.Vector3) {
    if (Math.abs(d.x) < EPS) return null;
    const t = -o.x / d.x;
    if (t <= EPS) return null;
    const p = o.clone().addScaledVector(d, t);
    if (Math.hypot(p.y - 0.035, p.z) > ThinLens.RADIUS) return null;
    return { t, n: v(1, 0, 0), face: 0 };
  }
}

/**
 * 광학 원판: 1° 눈금 원판 (반지름 12 cm). 가운데 자리에 거울·블록·프리즘·렌즈를 끼우고 돌리면
 * 원판 위에서 입사각·굴절각을 읽는다 (0° 선 = 원판의 +x 방향).
 */
export class OpticalDisc extends Item {
  static readonly R = 0.12;
  readonly seat: Socket;

  constructor() {
    const g = new THREE.Group();
    const top = new THREE.MeshLambertMaterial({ map: discTexture() });
    const side = new THREE.MeshLambertMaterial({ color: 0xd8d4c4 });
    g.add(mesh(new THREE.CylinderGeometry(OpticalDisc.R, OpticalDisc.R, 0.005, 48), [side, top, side], 0, 0.0025, 0));
    super(g, { name: '광학 원판 (각도 눈금)', radius: 0.13, mass: 0.4 });
    this.seat = new Socket(this, '광학 원판 가운데', ['opticMount'], v(0, 0.005, 0), { hitRadius: 0.06 });
  }
}

/**
 * 원판 윗면: 1° 눈금, 10°마다 숫자, 0°–180° 선(원판 +x = 법선 자리)과 90° 선.
 * 숫자는 0° 선에서 잰 각 (0 ~ 90 ~ 0) — 법선과 이루는 각을 바로 읽도록
 * (원통 윗면 UV: 월드 (x, z) → 캔버스 X = 가운데 + z, Y = 가운데 − x)
 */
function discTexture(): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ece7d6';
  g.fillRect(0, 0, S, S);
  const cx = S / 2;
  const r = S / 2 - 2;
  // 원판 좌표의 각 a (위에서 볼 때 +x에서 시작해 반시계, 점 = (cos a, −sin a)) → 캔버스
  const P = (a: number, rad: number): [number, number] => [cx - Math.sin(a) * rad, cx - Math.cos(a) * rad];
  g.strokeStyle = '#2a2a26';
  g.fillStyle = '#2a2a26';
  g.font = 'bold 15px monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let deg = 0; deg < 360; deg++) {
    const a = THREE.MathUtils.degToRad(deg);
    const len = deg % 10 === 0 ? 26 : deg % 5 === 0 ? 17 : 9;
    g.lineWidth = deg % 10 === 0 ? 2 : 1;
    g.beginPath();
    g.moveTo(...P(a, r));
    g.lineTo(...P(a, r - len));
    g.stroke();
    if (deg % 10 === 0) {
      const m = deg % 180;
      g.fillText(String(m <= 90 ? m : 180 - m), ...P(a, r - 42));
    }
  }
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(...P(0, r));
  g.lineTo(...P(Math.PI, r));
  g.moveTo(...P(Math.PI / 2, r));
  g.lineTo(...P(-Math.PI / 2, r));
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 백색 광원 상자: 전원선. 모드: 한 줄 · 평행 세 줄 · 화살표 물체 */
export type LightBoxMode = 'single' | 'triple' | 'arrow';
export const LIGHTBOX_MODE_NAME: Record<LightBoxMode, string> = { single: '광선 한 줄 (슬릿)', triple: '평행 광선 세 줄', arrow: '화살표 물체 (상 만들기)' };

export class WhiteLightBox extends Item implements Powered {
  on = false;
  mode: LightBoxMode = 'single';
  readonly aperture = v(0.085, 0.035, 0);
  readonly cordExit = v(-0.085, 0.015, 0);
  readonly cordLength = 2.0;
  port: OutletPort | null = null;
  powerActions: (l: WhiteLightBox) => Action[] = () => [];
  onOpenPanel: (l: WhiteLightBox) => void = () => {};
  private face: THREE.MeshBasicMaterial;
  private faceTex: THREE.CanvasTexture[];

  constructor() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.17, 0.07, 0.1), new THREE.MeshLambertMaterial({ color: 0x3a4a5a }), 0, 0.035, 0));
    const texs = (['single', 'triple', 'arrow'] as LightBoxMode[]).map((m) => faceTexture(m));
    const face = new THREE.MeshBasicMaterial({ map: texs[0] });
    const f = mesh(new THREE.PlaneGeometry(0.06, 0.05), face, 0.0851, 0.035, 0);
    f.rotation.y = Math.PI / 2;
    g.add(f);
    for (let i = 0; i < 4; i++) g.add(mesh(new THREE.BoxGeometry(0.002, 0.004, 0.08), BLACK, -0.04 + i * 0.02, 0.071, 0)); // 환기구
    super(g, { name: '백색 광원', radius: 0.1, mass: 0.8, touchPad: false });
    this.face = face;
    this.faceTex = texs;
    this.refreshFace();
  }

  get emitting(): boolean {
    return this.on && this.port !== null;
  }

  setMode(m: LightBoxMode): void {
    this.mode = m;
    this.refreshFace();
  }

  refreshFace(): void {
    const i = ['single', 'triple', 'arrow'].indexOf(this.mode);
    this.face.map = this.faceTex[i];
    this.face.color.setScalar(this.emitting ? 1 : 0.25);
  }

  extraActions(): Action[] {
    const out: Action[] = [];
    if (this.port) out.push({ label: this.on ? '광원 끄기' : '광원 켜기', run: () => { this.on = !this.on; this.refreshFace(); } });
    out.push(...this.powerActions(this));
    for (const m of ['single', 'triple', 'arrow'] as LightBoxMode[]) {
      if (m !== this.mode) out.push({ label: `앞판 → ${LIGHTBOX_MODE_NAME[m]}`, secondary: true, run: () => this.setMode(m) });
    }
    return out;
  }

  experimentActions(): Action[] {
    return this.emitting ? [{ label: '광선 경로 (백색 광원)', run: () => this.onOpenPanel(this) }] : [];
  }
}

/** 광원 앞판: 검은 판에 슬릿 한 줄 / 세 줄 / 화살표 모양 구멍 */
function faceTexture(m: LightBoxMode): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 48;
  c.height = 40;
  const g = c.getContext('2d')!;
  g.fillStyle = '#16181a';
  g.fillRect(0, 0, 48, 40);
  g.fillStyle = '#fff6dc';
  if (m === 'single') g.fillRect(23, 8, 2, 24);
  else if (m === 'triple') for (const x of [14, 23, 32]) g.fillRect(x, 8, 2, 24);
  else {
    g.fillRect(23, 14, 2, 18);
    g.beginPath();
    g.moveTo(24, 6);
    g.lineTo(18, 15);
    g.lineTo(30, 15);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}
