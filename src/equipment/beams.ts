/**
 * 광선 추적: 매 프레임(바뀐 것이 있을 때), 빛이 나오는 레이저·백색 광원마다 빛이 어디로 가는지 따라간다.
 *
 *   광원 ──▶ 광학 기구(식으로 정의한 면: equipment/opticalElements.ts)에서
 *              거울: 반사 (d' = d − 2(d·n)n)          반투명 거울: 반사 50 % + 투과 50 % (두 갈래)
 *              유리(블록·프리즘): 스넬 법칙 굴절 + 프레넬 반사(약한 갈래), 임계각을 넘으면 전반사
 *                                백색광은 처음 유리에 들어갈 때 21개 파장으로 갈라진다 (분산)
 *              렌즈: 이상적인 얇은 렌즈 (평행광 → 초점)
 *          ──▶ 슬릿판: 회절·간섭 무늬 (레이저만, 예전과 같음)
 *          ──▶ 그 밖의 면: 빛 점 · 무지개 띠 · 간섭무늬 · 화살표의 상
 *
 * 간섭 (마이컬슨 간섭계): 같은 레이저에서 나와 다른 길을 지난 빛이 같은 면의 같은 곳에 닿으면
 *   각 빛의 위상 φ = k·(광경로 + 비스듬한 성분 + 곡률 항)을 더해 세기 |Σ A e^{iφ}|²를 그린다.
 *   광경로 = Σ n·(지나온 거리). 거울을 d만큼 밀면 경로차가 2d 바뀌어 무늬가 λ/2마다 하나씩 지나간다.
 *   빔 반지름 w와 퍼짐각 div를 따라가므로, 오목 렌즈로 빔을 넓히면 동심원 무늬(곡률 차)가 생긴다.
 *
 * 빛 무늬 데칼(슬릿): 닿은 면에 붙는 얇은 사각형. 텍셀마다 월드 위치를 구하고, 슬릿에서 본 방향으로
 * 파동 광학 식(sim/optics.ts)의 세기를 계산해 그린다. 무늬 간격 Δy = λL/d.
 * 슬릿판이 빛에 대해 기울어 있으면 경로차 = d·(sinθ_나감 − sinθ_들어옴).
 */
import * as THREE from 'three';
import { HITBOX_MAT, type Item } from '../world/items';
import { isPickable, itemOf } from '../player/hand';
import { Laser, OpticScreen, SlitPlate, type LightPattern } from './optics';
import { intensity, wavelengthToRGB } from '../sim/optics';
import { Phototube } from './electrical';
import { BeamSplitter, GlassElement, OpticalElement, PlaneMirror, ThinLens, WhiteLightBox, type OpticHit } from './opticalElements';
import { WHITE_LINES, angleToNormal, fresnel, reflect, refract, refractiveIndex, thinLens } from '../sim/rayOptics';

const MAX_DIST = 12;
const DECAL_W = 512; // 데칼 텍스처 가로 텍셀
const DECAL_H = 32;

/** 면에 붙는 빛 무늬 */
class LightDecal {
  readonly mesh: THREE.Mesh;
  private tex: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private key = '';
  private basis = new THREE.Matrix4();

  constructor(scene: THREE.Scene) {
    const c = document.createElement('canvas');
    c.width = DECAL_W;
    c.height = DECAL_H;
    this.ctx = c.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: this.tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      }),
    );
    this.mesh.raycast = () => {};
    this.mesh.userData.noPick = true;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  hide(): void {
    this.mesh.visible = false;
  }

  /**
   * @param hit 빛이 닿은 점, n 그 면의 법선 (빛이 오는 쪽)
   */
  show(light: LightPattern, hit: THREE.Vector3, n: THREE.Vector3): void {
    // 크기: 슬릿을 지났으면 회절 봉투(중앙 무늬 폭 2λL/a)의 약 2배, 아니면 1.2 cm 점
    const W = light.ap ? THREE.MathUtils.clamp((4 * light.lambda * light.L) / light.ap.a, 0.04, 1.5) : 0.012;
    const H = light.ap ? 0.02 : 0.012;
    // 데칼의 가로축 = 무늬 방향을 면에 투영한 것
    const h = light.axisH.clone().addScaledVector(n, -light.axisH.dot(n));
    if (h.lengthSq() < 1e-6) h.set(0, 1, 0).cross(n);
    h.normalize();
    const vtc = new THREE.Vector3().crossVectors(n, h).normalize();
    this.basis.makeBasis(h, vtc, n);
    this.mesh.quaternion.setFromRotationMatrix(this.basis);
    this.mesh.position.copy(hit).addScaledVector(n, 0.0015);
    this.mesh.scale.set(W, H, 1);
    this.mesh.visible = true;

    const key = [light.lambda, light.ap?.d, light.ap?.a, light.ap?.kind, ...light.source.toArray(), ...hit.toArray(), ...n.toArray(), ...light.axisH.toArray()]
      .map((x) => (typeof x === 'number' ? x.toFixed(4) : String(x))).join();
    if (key !== this.key) {
      this.key = key;
      this.draw(light, hit, h, vtc, W, H);
    }
  }

  private draw(light: LightPattern, hit: THREE.Vector3, h: THREE.Vector3, vtc: THREE.Vector3, W: number, H: number): void {
    const img = this.ctx.createImageData(DECAL_W, DECAL_H);
    const sigma = Math.max(0.0015, (1.5 * H) / DECAL_H); // 빔 반지름 ≈ 1.5 mm
    const P = new THREE.Vector3();
    const rel = new THREE.Vector3();
    const { r: cr, g: cg, b: cb } = light.color;
    for (let j = 0; j < DECAL_H; j++) {
      const t = (0.5 - (j + 0.5) / DECAL_H) * H;
      for (let i = 0; i < DECAL_W; i++) {
        const s = ((i + 0.5) / DECAL_W - 0.5) * W;
        P.copy(hit).addScaledVector(h, s).addScaledVector(vtc, t);
        let I: number;
        if (light.ap) {
          rel.subVectors(P, light.source);
          const vert = rel.dot(light.axisV);
          const q = rel.normalize().dot(light.axisH) - light.inH; // sinθ_나감 − sinθ_들어옴
          I = intensity(light.ap, light.lambda, q) * Math.exp(-(vert * vert) / (2 * sigma * sigma));
        } else {
          I = Math.exp(-P.distanceToSquared(hit) / (2 * sigma * sigma));
        }
        const k = (j * DECAL_W + i) * 4;
        const e = Math.min(1, I * 2.2);
        const hot = 0.45 * e * e; // 밝은 곳은 하얗게 타는 느낌
        img.data[k] = 255 * Math.min(1, cr * e + hot);
        img.data[k + 1] = 255 * Math.min(1, cg * e + hot);
        img.data[k + 2] = 255 * Math.min(1, cb * e + hot);
        img.data[k + 3] = 255;
      }
    }
    this.ctx.putImageData(img, 0, 0);
    this.tex.needsUpdate = true;
  }
}

/** 광원 */
export type LightSource = Laser | WhiteLightBox;

/** 광선 한 토막 */
interface Ray {
  o: THREE.Vector3;
  d: THREE.Vector3;
  /** 파장 (nm), 0 = 아직 갈라지지 않은 백색광 */
  nm: number;
  /** 세기 (광원 = 1) */
  p: number;
  src: LightSource;
  /** 광경로 (m, Σ n·거리) — 간섭 위상 */
  opl: number;
  /** 지나온 거리 (m) */
  path: number;
  /** 빔 반지름 (m, 음수 = 초점을 지나 뒤집힘)과 퍼짐각 (rad) */
  w: number;
  div: number;
  inside: GlassElement | null;
  depth: number;
  /** 처음 지난 렌즈 (화살표의 상 계산용): 광원 ~ 렌즈 거리 s, 초점 거리 f */
  lens: { s: number; f: number; at: number } | null;
}

/** 광선 경로 기록 (광학 패널용) */
export interface OpticEvent {
  el: string;
  kind: string;
  inDeg: number;
  outDeg: number | null;
  n1: number;
  n2: number;
  nm: number;
  p: number;
  depth: number;
}

export interface SourceTrace {
  events: OpticEvent[];
  /** 유리를 지나 나간 빛의 처음 방향 대비 꺾인 각 (도) */
  exits: { nm: number; dev: number; p: number }[];
  /** 간섭한 빛들: 경로차 (μm) */
  interference: { target: string; dOPL: number; lambda: number } | null;
  /** 화살표의 상: 물체 거리 s, 상 거리 s', 스크린 거리 D, 배율 */
  image: { s: number; f: number; sImg: number; D: number; m: number } | null;
}

interface Hit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  target: THREE.Object3D;
  ray: Ray;
}

const MAX_DEPTH = 24;
const MAX_SEGS = 600;
const MIN_P = 0.004;
/** 레이저 결맞음 길이 (m) */
const COHERENCE = 0.05;
/** 한 면에 그리는 빛 점·무늬의 최대 크기 (m) — 퍼진 빔이 방 전체를 덮지 않게 (스크린 짧은 변 0.2 m의 절반) */
const MAX_PATCH = 0.1;

/** 광선 선들 (모든 광원 합쳐 한 덩어리, 세기에 따라 밝기) */
class BeamLines {
  readonly line: THREE.LineSegments;
  private pos = new Float32Array(MAX_SEGS * 6);
  private col = new Float32Array(MAX_SEGS * 6);
  n = 0;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.line.raycast = () => {};
    this.line.frustumCulled = false;
    this.line.userData.noPick = true;
    scene.add(this.line);
  }

  clear(): void {
    this.n = 0;
  }

  add(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Color, p: number): void {
    if (this.n >= MAX_SEGS) return;
    const k = Math.min(1, 0.18 + 0.8 * Math.sqrt(p));
    a.toArray(this.pos, this.n * 6);
    b.toArray(this.pos, this.n * 6 + 3);
    for (const off of [0, 3]) {
      this.col[this.n * 6 + off] = c.r * k;
      this.col[this.n * 6 + off + 1] = c.g * k;
      this.col[this.n * 6 + off + 2] = c.b * k;
    }
    this.n++;
  }

  commit(): void {
    const g = this.line.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    g.setDrawRange(0, this.n * 2);
    this.line.visible = this.n > 0;
  }
}

/** 빛 점 (면에 닿은 곳마다 하나, 가우스 모양) */
class Spots {
  readonly mesh: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private z = new THREE.Vector3(0, 0, 1);
  n = 0;

  constructor(scene: THREE.Scene) {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    const mat = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, 400);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(400 * 3), 3);
    this.mesh.raycast = () => {};
    this.mesh.frustumCulled = false;
    this.mesh.userData.noPick = true;
    scene.add(this.mesh);
  }

  clear(): void {
    this.n = 0;
  }

  add(p: THREE.Vector3, n: THREE.Vector3, size: number, c: THREE.Color): void {
    if (this.n >= 400) return;
    this.q.setFromUnitVectors(this.z, n);
    this.m.compose(p.clone().addScaledVector(n, 0.0015), this.q, new THREE.Vector3(size, size, 1));
    this.mesh.setMatrixAt(this.n, this.m);
    this.mesh.setColorAt(this.n, c);
    this.n++;
  }

  commit(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** 면에 그리는 정사각 무늬 (간섭무늬 · 화살표의 상) */
class SquareDecal {
  readonly mesh: THREE.Mesh;
  readonly ctx: CanvasRenderingContext2D;
  readonly tex: THREE.CanvasTexture;
  key = '';
  private basis = new THREE.Matrix4();
  readonly h = new THREE.Vector3();
  readonly v = new THREE.Vector3();

  constructor(scene: THREE.Scene, readonly N: number) {
    const c = document.createElement('canvas');
    c.width = c.height = N;
    this.ctx = c.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: this.tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5,
    }));
    this.mesh.raycast = () => {};
    this.mesh.userData.noPick = true;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** 면 위에 놓기: 가로축 h는 수평(가능하면), 세로축 v는 위쪽 */
  place(center: THREE.Vector3, n: THREE.Vector3, size: number): void {
    this.h.set(0, 1, 0).cross(n);
    if (this.h.lengthSq() < 1e-6) this.h.set(1, 0, 0);
    this.h.normalize();
    this.v.crossVectors(n, this.h).normalize();
    this.basis.makeBasis(this.h, this.v, n);
    this.mesh.quaternion.setFromRotationMatrix(this.basis);
    this.mesh.position.copy(center).addScaledVector(n, 0.002);
    this.mesh.scale.set(size, size, 1);
    this.mesh.visible = true;
  }
}

const tmpColor = new THREE.Color();
function colorOf(nm: number): THREE.Color {
  if (nm === 0) return tmpColor.setRGB(1, 0.97, 0.9).clone();
  const [r, g, b] = wavelengthToRGB(nm);
  return new THREE.Color(r, g, b);
}

export class BeamSystem {
  private raycaster = new THREE.Raycaster();
  private slitDecals = new Map<Laser, LightDecal>();
  private lines: BeamLines;
  private spots: Spots;
  private interf: SquareDecal[] = [];
  private images: SquareDecal[] = [];
  private tubeLight = new Map<Phototube, { lambda: number; powerW: number }>();
  /** 광원별 경로 기록 (광학 패널이 읽는다) */
  readonly traces = new Map<LightSource, SourceTrace>();
  private key = '';
  private lastTrace = 0;
  private hits: Hit[] = [];
  private segs = 0;
  /** 공기 중 광선 조각 (시작·끝, 월드) — 정렬 안내(beamOffset)가 읽는다 */
  private airSegs: { a: THREE.Vector3; b: THREE.Vector3 }[] = [];

  constructor(private scene: THREE.Scene, private items: Item[]) {
    this.lines = new BeamLines(scene);
    this.spots = new Spots(scene);
    for (let i = 0; i < 3; i++) this.interf.push(new SquareDecal(scene, 160));
    for (let i = 0; i < 2; i++) this.images.push(new SquareDecal(scene, 128));
  }

  private get sources(): LightSource[] {
    return this.items.filter((i): i is LightSource => (i instanceof Laser || i instanceof WhiteLightBox) && i.emitting && i.root().object.parent === this.scene);
  }

  private get elements(): OpticalElement[] {
    return this.items.filter((i): i is OpticalElement => i instanceof OpticalElement && i.root().object.parent === this.scene);
  }

  /** 광선이 처음 맞는 장면의 면 (광학 기구의 모양·보이지 않는 판정 영역·표시용 물체·exclude 안은 제외) */
  private cast(origin: THREE.Vector3, dir: THREE.Vector3, exclude: THREE.Object3D | null, far = MAX_DIST): THREE.Intersection | null {
    this.raycaster.set(origin, dir);
    this.raycaster.near = 1e-4;
    this.raycaster.far = far;
    for (const h of this.raycaster.intersectObjects(this.scene.children, true)) {
      if (!isPickable(h.object)) continue;
      if ((h.object as THREE.Mesh).material === HITBOX_MAT) continue;
      let skip = false;
      for (let o: THREE.Object3D | null = h.object; o; o = o.parent) {
        if (o === exclude || o.userData.opticElement) { skip = true; break; }
      }
      if (!skip) return h;
    }
    return null;
  }

  /**
   * 광학 기구(el)로 들어오는 빛줄기와 기구 중심(frame().c)의 옆 거리.
   * 기구 앞(중심에서 1 cm 넘게 떨어진 곳)에서 출발해 중심 근처까지 오는 공기 중 조각 가운데
   * 중심과 가장 가까운 것 (수평 5 cm · 높이 2 cm 안). 없으면 null
   *   off  : 빛줄기에서 중심까지 부호 있는 거리 (m, 진행 방향 기준 왼쪽 +)
   *   move : 중심을 빛줄기 위로 옮기는 수평 이동 (m)
   *   dir  : 빛의 수평 진행 방향 (단위)
   */
  beamOffset(el: OpticalElement): { off: number; move: THREE.Vector3; dir: THREE.Vector3 } | null {
    const c = el.frame().c;
    let best: { off: number; move: THREE.Vector3; dir: THREE.Vector3 } | null = null;
    let bestD = 0.05;
    for (const { a, b } of this.airSegs) {
      const d = new THREE.Vector3(b.x - a.x, 0, b.z - a.z);
      const len = d.length();
      if (len < 1e-4) continue;
      d.divideScalar(len);
      const w = new THREE.Vector3(c.x - a.x, 0, c.z - a.z);
      const t = w.dot(d);
      if (t < 0.01 || t > len + 0.03) continue;
      if (Math.abs(a.y + (b.y - a.y) * Math.min(t / len, 1) - c.y) > 0.02) continue;
      const perp = w.clone().addScaledVector(d, -t);
      const dist = perp.length();
      if (dist >= bestD) continue;
      bestD = dist;
      const left = new THREE.Vector3(d.z, 0, -d.x); // 위에서 볼 때 진행 방향의 왼쪽
      best = { off: perp.dot(left), move: perp.negate(), dir: d };
    }
    return best;
  }

  /** 바뀐 것이 있는가: 장면에 놓인 기구들의 위치·방향 + 광원·기구 설정 */
  private stateKey(): string {
    let h = 0;
    for (const it of this.items) {
      if (it.root().object.parent !== this.scene) continue;
      it.object.updateWorldMatrix(true, false);
      const e = it.object.matrixWorld.elements;
      h = (h * 31 + e[12] * 1e4 + e[13] * 3e4 + e[14] * 7e4 + e[0] * 1e3 + e[2] * 2e3) % 1e9;
      if (it instanceof Laser) h += (it.emitting ? 1 : 0) + it.nm * 7 + it.powerMw * 13;
      if (it instanceof WhiteLightBox) h += (it.emitting ? 3 : 0) + it.mode.length * 17;
      if (it instanceof OpticalElement) h += it.fineTilt * 1e5 + it.fineShift * 1e3;
    }
    return h.toFixed(3);
  }

  update(): void {
    for (const item of this.items) {
      if (item instanceof Phototube) item.light = null;
      if (item instanceof Laser) item.updateLed();
      if (item instanceof WhiteLightBox) item.refreshFace();
    }
    const key = this.stateKey();
    const now = performance.now();
    if (key !== this.key || now - this.lastTrace > 400) {
      this.key = key;
      this.lastTrace = now;
      this.traceAll();
    }
    for (const [t, l] of this.tubeLight) t.light = { ...l };
  }

  private traceAll(): void {
    this.lines.clear();
    this.spots.clear();
    this.hits = [];
    this.segs = 0;
    this.airSegs = [];
    this.tubeLight.clear();
    this.traces.clear();
    for (const d of [...this.interf, ...this.images]) d.mesh.visible = false;
    for (const item of this.items) {
      if (item instanceof Laser) {
        item.pattern = null;
        item.alignHint = null;
      }
    }
    const used = new Set<Laser>();
    for (const src of this.sources) {
      this.traces.set(src, { events: [], exits: [], interference: null, image: null });
      src.object.updateWorldMatrix(true, false);
      const m = src.object.matrixWorld;
      const dir = new THREE.Vector3(1, 0, 0).transformDirection(m);
      const base = src.object.localToWorld(src.aperture.clone());
      const side = new THREE.Vector3(0, 0, 1).transformDirection(m);
      if (src instanceof Laser) {
        this.trace({ o: base, d: dir, nm: src.nm, p: 1, src, opl: 0, path: 0, w: 0.001, div: 0.0006, inside: null, depth: 0, lens: null }, used);
      } else {
        const offs = src.mode === 'triple' ? [-0.012, 0, 0.012] : [0];
        for (const z of offs) {
          this.trace({ o: base.clone().addScaledVector(side, z), d: dir.clone(), nm: 0, p: 1 / offs.length, src, opl: 0, path: 0, w: 0.0015, div: 0.003, inside: null, depth: 0, lens: null }, used);
        }
      }
    }
    for (const [laser, dec] of this.slitDecals) if (!used.has(laser)) dec.hide();
    this.drawHits();
    this.lines.commit();
    this.spots.commit();
  }

  private event(r: Ray, e: Omit<OpticEvent, 'nm' | 'p' | 'depth'>): void {
    const tr = this.traces.get(r.src);
    if (!tr || tr.events.length > 200) return;
    tr.events.push({ ...e, nm: r.nm, p: r.p, depth: r.depth });
  }

  /** 광선 하나를 따라간다 (갈라지면 되부름) */
  private trace(r: Ray, used: Set<Laser>): void {
    while (r.depth < MAX_DEPTH && this.segs < MAX_SEGS && r.p >= MIN_P) {
      // 가장 가까운 광학 면
      let oh: OpticHit | null = null;
      let el: OpticalElement | null = null;
      for (const e of this.elements) {
        const h = e.intersect(r.o, r.d);
        if (h && h.t > 1e-5 && (!oh || h.t < oh.t)) { oh = h; el = e; }
      }
      const sh = r.inside ? null : this.cast(r.o, r.d, r.depth === 0 ? r.src.object : null, oh ? oh.t : MAX_DIST);
      const color = colorOf(r.nm);
      if (sh && (!oh || sh.distance < oh.t)) {
        this.segment(r, sh.point, color);
        this.surface(r, sh, used);
        return;
      }
      if (!oh || !el) {
        if (r.inside) return; // 유리 윗면·아랫면으로 빠짐 (여기서는 버림)
        this.segment(r, r.o.clone().addScaledVector(r.d, MAX_DIST), color);
        this.recordExit(r);
        return;
      }
      this.segment(r, oh.point, color);
      const next = this.interact(r, el, oh);
      if (!next.length) return;
      for (let i = 1; i < next.length; i++) this.trace(next[i], used);
      r = next[0];
    }
  }

  /** r의 시작점 → p까지 선 긋고 광선 상태를 p로 옮긴다 */
  private segment(r: Ray, p: THREE.Vector3, color: THREE.Color): void {
    const len = r.o.distanceTo(p);
    this.lines.add(r.o, p, color, r.p);
    this.segs++;
    if (!r.inside && r.p > 0.02) this.airSegs.push({ a: r.o.clone(), b: p.clone() });
    const n = r.inside ? refractiveIndex(r.inside.glass, r.nm || 550) : 1;
    r.opl += n * len;
    r.path += len;
    r.w += r.div * len;
    r.o = p.clone();
  }

  /** 광학 기구에서: 다음 광선(들) — 첫째가 계속 따라갈 광선 */
  private interact(r: Ray, el: OpticalElement, h: OpticHit): Ray[] {
    const n = h.normal;
    const facing = r.d.dot(n) < 0 ? n : n.clone().negate();
    const inDeg = angleToNormal(r.d, n);
    const child = (d: THREE.Vector3, p: number, extra: Partial<Ray> = {}): Ray => ({
      ...r, o: h.point.clone().addScaledVector(d, 1e-5), d, p, depth: r.depth + 1, ...extra,
    });
    if (el instanceof PlaneMirror) {
      if (r.d.dot(n) >= 0) { this.stop(r, h, el); return []; } // 뒷면
      this.event(r, { el: el.name, kind: '반사', inDeg, outDeg: inDeg, n1: 1, n2: 1 });
      return [child(reflect(r.d, n), r.p * PlaneMirror.REFLECT)];
    }
    if (el instanceof BeamSplitter) {
      this.event(r, { el: el.name, kind: '분할 (반사 50 % + 투과 50 %)', inDeg, outDeg: inDeg, n1: 1, n2: 1 });
      return [child(r.d.clone(), r.p * 0.5), child(reflect(r.d, n), r.p * 0.5)];
    }
    if (el instanceof ThinLens) {
      const { c, ax } = el.frame();
      const d2 = thinLens(r.d, h.point, c, ax, el.f);
      this.event(r, { el: el.name, kind: '렌즈', inDeg, outDeg: angleToNormal(d2, n), n1: 1, n2: 1 });
      return [child(d2, r.p * 0.96, { div: r.div - r.w / el.f, lens: r.lens ?? { s: r.path, f: el.f, at: r.path } })];
    }
    if (el instanceof GlassElement) {
      const entering = r.inside !== el;
      // 백색광은 처음 굴절할 때 파장별로 갈라진다
      if (r.nm === 0 && entering) {
        const R0 = fresnel(Math.abs(r.d.dot(n)), 1, refractiveIndex(el.glass, 550));
        const out: Ray[] = [];
        for (const nm of WHITE_LINES) {
          const sub = { ...r, nm, p: (r.p * (1 - R0)) / WHITE_LINES.length };
          const t = this.refractAt(sub, el, h, facing, inDeg, true);
          if (t) out.push(t);
        }
        if (r.p * R0 >= MIN_P * 3) out.push(child(reflect(r.d, facing), r.p * R0));
        return out;
      }
      const out: Ray[] = [];
      const n1 = entering ? 1 : refractiveIndex(el.glass, r.nm);
      const n2 = entering ? refractiveIndex(el.glass, r.nm) : 1;
      const Rf = fresnel(Math.abs(r.d.dot(n)), n1, n2);
      const t = this.refractAt(r, el, h, facing, inDeg, entering, Rf);
      if (t) out.push(t);
      // 되비치는 빛 (전반사면 전부)
      const pr = t ? r.p * Rf : r.p;
      if (!t) this.event(r, { el: el.name, kind: '전반사', inDeg, outDeg: inDeg, n1, n2 });
      if (pr >= (r.nm ? MIN_P * 2 : MIN_P * 3)) out.push(child(reflect(r.d, facing), pr, { inside: entering ? null : el }));
      return out;
    }
    return [];
  }

  /** 굴절해 들어가거나 나가는 광선 (전반사면 null) */
  private refractAt(r: Ray, el: GlassElement, h: OpticHit, facing: THREE.Vector3, inDeg: number, entering: boolean, Rf?: number): Ray | null {
    const ng = refractiveIndex(el.glass, r.nm);
    const n1 = entering ? 1 : ng;
    const n2 = entering ? ng : 1;
    const d2 = refract(r.d, facing, n1, n2);
    if (!d2) return null;
    const R = Rf ?? fresnel(Math.abs(r.d.dot(facing)), n1, n2);
    this.event(r, { el: el.name, kind: entering ? '굴절 (들어감)' : '굴절 (나옴)', inDeg, outDeg: angleToNormal(d2, facing), n1, n2 });
    return { ...r, o: h.point.clone().addScaledVector(d2, 1e-5), d: d2, p: r.p * (1 - R), inside: entering ? el : null, depth: r.depth + 1 };
  }

  /** 광선이 기구 뒷면 등에 막힘 */
  private stop(r: Ray, h: OpticHit, el: OpticalElement): void {
    this.hits.push({ point: h.point, normal: h.normal.clone().negate(), target: el.object, ray: r });
  }

  /** 유리를 지나 나간 빛: 처음 방향 대비 꺾인 각 */
  private recordExit(r: Ray): void {
    const tr = this.traces.get(r.src);
    if (!tr) return;
    const d0 = new THREE.Vector3(1, 0, 0).transformDirection(r.src.object.matrixWorld);
    tr.exits.push({ nm: r.nm, dev: THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(d0.dot(r.d), -1, 1))), p: r.p });
  }

  /** 장면의 면에 닿음: 슬릿판 · 광전관 · 그 밖 */
  private surface(r: Ray, hit: THREE.Intersection, used: Set<Laser>): void {
    this.recordExit(r);
    const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : r.d.clone().negate();
    if (n.dot(r.d) > 0) n.negate();
    const target = itemOf(hit.object);
    const laser = r.src instanceof Laser ? r.src : null;
    if (laser && target instanceof SlitPlate && !used.has(laser)) {
      this.slit(laser, r, target, hit, used);
      return;
    }
    if (target instanceof Phototube && laser) {
      const cur = this.tubeLight.get(target);
      this.tubeLight.set(target, { lambda: laser.lambda, powerW: (cur?.powerW ?? 0) + laser.powerMw * 1e-3 * r.p });
    }
    this.hits.push({ point: hit.point.clone(), normal: n, target: target?.object ?? hit.object, ray: r });
  }

  /** 슬릿판: 미세 조정 범위 안이면 통과 → 회절·간섭 무늬 (예전 방식) */
  private slit(laser: Laser, r: Ray, plate: SlitPlate, hit: THREE.Intersection, used: Set<Laser>): void {
    plate.object.updateWorldMatrix(true, false);
    const pm = plate.object.matrixWorld;
    const normal = new THREE.Vector3(1, 0, 0).transformDirection(pm);
    const local = plate.object.worldToLocal(hit.point.clone());
    const dir = r.d;
    if (!plate.inWindow(local)) laser.alignHint = plate.missHint(local);
    else if (Math.abs(normal.dot(dir)) <= 0.5) laser.alignHint = '슬릿판이 빛에 대해 너무 비스듬함 (60° 넘게 돌아감)';
    if (laser.alignHint) {
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : dir.clone().negate();
      if (n.dot(dir) > 0) n.negate();
      this.hits.push({ point: hit.point.clone(), normal: n, target: plate.object, ray: r });
      return;
    }
    used.add(laser);
    const axisH = new THREE.Vector3(0, 0, 1).transformDirection(pm);
    const light: LightPattern = {
      lambda: laser.lambda, color: laser.color, ap: plate.ap, source: hit.point.clone(), dir: dir.clone(), axisH,
      axisV: new THREE.Vector3(0, 1, 0).transformDirection(pm), inH: dir.dot(axisH), L: 0, surface: '',
    };
    const from = hit.point.clone().addScaledVector(dir, 0.003);
    const next = this.cast(from, dir, plate.object);
    let dec = this.slitDecals.get(laser);
    if (!dec) this.slitDecals.set(laser, (dec = new LightDecal(this.scene)));
    if (!next) {
      this.lines.add(from, from.clone().addScaledVector(dir, MAX_DIST), laser.color, r.p * 0.3);
      dec.hide();
      return;
    }
    this.lines.add(from, next.point, laser.color, r.p * 0.3);
    const n = next.face ? next.face.normal.clone().transformDirection(next.object.matrixWorld) : dir.clone().negate();
    if (n.dot(dir) > 0) n.negate();
    const target = itemOf(next.object);
    light.L = next.point.distanceTo(light.source);
    light.surface = target instanceof OpticScreen ? '스크린' : target ? target.name : '벽·가구 면';
    laser.pattern = light;
    // 광전관에 닿으면 음극에 빛이 들어간다 (슬릿을 지난 빛은 대부분 막혀 약 5 %만)
    if (target instanceof Phototube) {
      const cur = this.tubeLight.get(target);
      this.tubeLight.set(target, { lambda: laser.lambda, powerW: (cur?.powerW ?? 0) + laser.powerMw * 1e-3 * 0.05 * r.p });
    }
    dec.show(light, next.point, n);
  }

  /** 닿은 점들 그리기: 같은 레이저의 빛이 겹치면 간섭무늬, 화살표 물체면 상, 나머지는 빛 점 */
  private drawHits(): void {
    const rest: Hit[] = [];
    // 1) 간섭: 같은 레이저 · 같은 물체 · 가까이 (빔 반지름 3배 안)
    // 광원으로 되돌아온 빛은 간섭무늬 없이 작은 빛 점으로만 (레이저 몸체에 크게 번지지 않게)
    const coherent = this.hits.filter((h) => h.ray.src instanceof Laser && itemOf(h.target) !== h.ray.src);
    const done = new Set<Hit>();
    let di = 0;
    for (const a of coherent) {
      if (done.has(a)) continue;
      // 결맞음 길이 (반도체 레이저 약 5 cm) 안의 경로차만 간섭 — 더 멀면 세기만 더해진다
      const group = coherent.filter((b) => !done.has(b) && b.ray.src === a.ray.src && b.target === a.target
        && b.point.distanceTo(a.point) < 3 * Math.max(Math.abs(a.ray.w), Math.abs(b.ray.w), 0.002)
        && Math.abs(b.ray.opl - a.ray.opl) < COHERENCE);
      if (group.length >= 2 && di < this.interf.length) {
        for (const g of group) done.add(g);
        this.drawInterference(this.interf[di++], group);
      }
    }
    for (const h of this.hits) if (!done.has(h)) rest.push(h);
    // 2) 화살표 물체의 상
    let ii = 0;
    for (const h of rest) {
      const src = h.ray.src;
      if (src instanceof WhiteLightBox && src.mode === 'arrow' && h.ray.depth <= 3 && ii < this.images.length) {
        this.drawImage(this.images[ii++], h);
        continue;
      }
      const w = Math.max(Math.abs(h.ray.w), 0.0012);
      // 퍼진 빛은 같은 세기가 넓은 면에 흩어지므로 어둡게 (w 3 cm 넘으면 1/w로)
      const spread = Math.max(0.15, Math.min(1, 0.03 / w));
      const c = colorOf(h.ray.nm).multiplyScalar(spread * Math.min(1.4, 0.35 + 1.4 * Math.sqrt(h.ray.p * (h.ray.nm ? WHITE_LINES.length / 3 : 1))));
      this.spots.add(h.point, h.normal, Math.min(MAX_PATCH, 2.4 * w * (h.ray.nm ? 1.6 : 1)), c);
    }
  }

  /** 간섭무늬: 겹친 빛마다 위상 φ = k(광경로 + (P−H)·d + ρ²/2R), 진폭 √p·e^{−ρ²/w²} */
  private drawInterference(dec: SquareDecal, group: Hit[]): void {
    const src = group[0].ray.src as Laser;
    const k = (2 * Math.PI) / src.lambda;
    const wMax = Math.max(...group.map((g) => Math.abs(g.ray.w)), 0.0015);
    const size = Math.min(3 * wMax, MAX_PATCH);
    const center = group.reduce((c, g) => c.add(g.point), new THREE.Vector3()).multiplyScalar(1 / group.length);
    const n = group[0].normal;
    dec.place(center, n, size);
    const oplRef = Math.min(...group.map((g) => g.ray.opl));
    const tr = this.traces.get(src);
    if (tr) tr.interference = { target: itemOf(group[0].target)?.name ?? '면', dOPL: (Math.max(...group.map((g) => g.ray.opl)) - oplRef) * 1e6, lambda: src.nm };
    const key = group.map((g) => `${(g.ray.opl - oplRef).toFixed(10)}|${g.point.toArray().map((x) => x.toFixed(6))}|${g.ray.d.toArray().map((x) => x.toFixed(6))}|${g.ray.w.toFixed(5)}|${g.ray.div.toFixed(5)}`).join('/') + src.nm;
    if (key === dec.key) return;
    dec.key = key;
    const N = dec.N;
    const img = dec.ctx.createImageData(N, N);
    const P = new THREE.Vector3();
    const rel = new THREE.Vector3();
    const { r: cr, g: cg, b: cb } = src.color;
    const beams = group.map((g) => ({
      H: g.point, d: g.ray.d, a: Math.sqrt(g.ray.p), w: Math.max(Math.abs(g.ray.w), 0.0008),
      R: Math.abs(g.ray.div) > 1e-6 ? g.ray.w / g.ray.div : Infinity, opl: g.ray.opl - oplRef,
    }));
    const pSum = group.reduce((s, g) => s + g.ray.p, 0);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        P.copy(center).addScaledVector(dec.h, ((i + 0.5) / N - 0.5) * size).addScaledVector(dec.v, (0.5 - (j + 0.5) / N) * size);
        let re = 0;
        let im = 0;
        for (const b of beams) {
          rel.subVectors(P, b.H);
          const along = rel.dot(b.d);
          const rho2 = rel.lengthSq() - along * along;
          const phi = k * (b.opl + along + (Number.isFinite(b.R) ? rho2 / (2 * b.R) : 0));
          const amp = b.a * Math.exp(-rho2 / (b.w * b.w));
          re += amp * Math.cos(phi);
          im += amp * Math.sin(phi);
        }
        const I = (re * re + im * im) / Math.max(pSum, 1e-6) / 2;
        const e = Math.min(1, I * 1.6);
        const hot = 0.4 * e * e;
        const q = (j * N + i) * 4;
        img.data[q] = 255 * Math.min(1, cr * e + hot);
        img.data[q + 1] = 255 * Math.min(1, cg * e + hot);
        img.data[q + 2] = 255 * Math.min(1, cb * e + hot);
        img.data[q + 3] = 255;
      }
    }
    dec.ctx.putImageData(img, 0, 0);
    dec.tex.needsUpdate = true;
  }

  /**
   * 화살표 물체의 상 (얇은 렌즈 공식): 물체 거리 s, 상 거리 s' = 1/(1/f − 1/s), 렌즈 ~ 스크린 거리 D
   *   스크린 위 크기 = 물체 × (−D/s)  (렌즈 중심을 지나는 광선), 흐림 반지름 = 렌즈 반지름 × |1 − D/s'|
   *   D = s'이면 흐림 0 → 선명한 거꾸로 선 상
   */
  private drawImage(dec: SquareDecal, h: Hit): void {
    const OBJ = 0.03; // 화살표 높이
    const L = h.ray.lens;
    const A = ThinLens.RADIUS;
    let scale: number;
    let blur: number;
    const tr = this.traces.get(h.ray.src);
    if (L) {
      const s = L.s;
      const D = h.ray.path - L.at;
      const sImg = Math.abs(1 / L.f - 1 / s) < 1e-9 ? Infinity : 1 / (1 / L.f - 1 / s);
      scale = -D / s;
      blur = Number.isFinite(sImg) ? A * Math.abs(1 - D / sImg) : A;
      if (tr) tr.image = { s, f: L.f, sImg, D, m: scale };
    } else {
      scale = 1 + h.ray.path * 2; // 렌즈 없이: 퍼진 빛
      blur = 0.01 + h.ray.path * 0.25;
      if (tr) tr.image = null;
    }
    const size = Math.max(Math.abs(scale) * OBJ * 1.6, 2.4 * blur + 0.01, 0.02);
    dec.place(h.point, h.normal, size);
    const key = `${scale.toFixed(4)}|${blur.toFixed(4)}|${size.toFixed(4)}`;
    if (key === dec.key) return;
    dec.key = key;
    const N = dec.N;
    const g = dec.ctx;
    g.save();
    g.clearRect(0, 0, N, N);
    g.fillStyle = '#000';
    g.fillRect(0, 0, N, N);
    const px = (m: number) => (m / size) * N;
    const bpx = px(blur);
    g.filter = `blur(${Math.min(16, bpx * 0.45).toFixed(1)}px)`;
    g.translate(N / 2, N / 2);
    g.scale(1, -Math.sign(scale) || 1); // 캔버스 y는 아래로 → 배율이 양수면 위를 향하게
    const hgt = px(Math.abs(scale) * OBJ);
    // 같은 빛이 넓게 퍼질수록 어둡다 (상 크기 + 흐림) — 그래도 흐린 상이 보이는 정도는 남긴다
    const bright = Math.min(1, 0.45 + 0.01 / Math.max(0.004, Math.abs(scale) * OBJ + blur));
    g.fillStyle = `rgba(255,246,220,${bright})`;
    // 화살표: 앞판 구멍 모양 (기둥 + 머리), 가운데가 물체 중심
    g.fillRect(-hgt * 0.04, -hgt * 0.5, hgt * 0.08, hgt * 0.75);
    g.beginPath();
    g.moveTo(0, hgt * 0.5);
    g.lineTo(-hgt * 0.25, hgt * 0.2);
    g.lineTo(hgt * 0.25, hgt * 0.2);
    g.fill();
    g.restore();
    dec.tex.needsUpdate = true;
  }
}
