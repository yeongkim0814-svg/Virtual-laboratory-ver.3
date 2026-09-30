/**
 * 역학 레일 · 수레 · 질량 막대
 *
 *   레일 (길이 1.2 m, 알루미늄): 윗면에 수레를 올린다 (레일 방향으로 탭한 자리, 1 cm 단위).
 *     옆면에 cm 눈금. 양 끝에 고무 멈추개. 오른쪽 끝 받침을 올려 기울일 수 있다 (0 ~ 10°).
 *   수레 (0.5 kg): 바퀴 4개, 양 끝 범퍼(자석 · 용수철 · 벨크로), 위에 질량 막대 2개까지.
 *   질량 막대 (0.25 kg): 수레 위에 얹는다.
 *
 * 레일이 TrackSim을 가지고 매 프레임 올려진 수레들의 운동·충돌을 계산해 위치를 옮긴다.
 * (센서는 나중에 — TrackSim이 (t, s, v)와 충돌을 기록해 둔다)
 */
import * as THREE from 'three';
import { Item, Socket } from '../world/items';
import { Cable, surfaceBelow } from '../world/cable';
import type { Action } from '../world/interactable';
import { BUMPER_NAME, FLAG_W, FORCE_BUMPER, TrackSim, type Bumper, type CartBody, type GateBody, type HangingLoad } from '../sim/track';
import { ForceSensor, Photogate } from './dynamicsSensors';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

const ALU = new THREE.MeshLambertMaterial({ color: 0xa9aeb2 });
const DARK = new THREE.MeshLambertMaterial({ color: 0x2a2c2e });
const RUBBER = new THREE.MeshLambertMaterial({ color: 0x1c1c1a });
const BAR = new THREE.MeshLambertMaterial({ color: 0x3a3d40 });
const BUMPER_MAT: Record<Bumper, THREE.Material> = {
  magnet: new THREE.MeshLambertMaterial({ color: 0xc0392b }),
  spring: new THREE.MeshLambertMaterial({ color: 0xd8d8d0 }),
  velcro: new THREE.MeshLambertMaterial({ color: 0x5c5a52 }),
};

export const RAIL_LENGTH = 1.2;
const RAIL_TOP = 0.022; // 바퀴가 닿는 면 높이
const HALF = RAIL_LENGTH / 2;

/** 옆면 cm 눈금 텍스처 (1024 × 32) */
function rulerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d9dcd6';
  g.fillRect(0, 0, 1024, 32);
  g.fillStyle = '#1a1a1a';
  g.font = 'bold 11px monospace';
  for (let cm = 0; cm <= 120; cm++) {
    const x = Math.round((cm / 120) * 1023);
    const h = cm % 10 === 0 ? 18 : cm % 5 === 0 ? 12 : 7;
    g.fillRect(x, 0, 1, h);
    if (cm % 10 === 0 && cm > 0 && cm < 120) g.fillText(String(cm), x - (cm >= 100 ? 10 : 6), 30);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Rail extends Item {
  readonly sim = new TrackSim();
  readonly track: Socket;
  /** 포토게이트 자리 (레일을 따라 1 cm 단위) */
  readonly gateTrack: Socket;
  /** 양 끝 센서 받침 [왼쪽, 오른쪽] */
  readonly mounts: Socket[];
  onOpenPanel: (r: Rail) => void = () => {};
  /** 재생 속도 (패널에서: 1, ½, ¼, 0 = 멈춤) */
  speed = 1;
  /** 기울어지는 몸체 (왼쪽 끝 바닥이 회전축) */
  private body = new THREE.Group();
  private leg: THREE.Mesh;
  private bodies = new Map<Cart, CartBody>();
  private written = new Map<Cart, number>();
  private nextId = 1;

  constructor() {
    const g = new THREE.Group();
    const body = new THREE.Group();
    body.position.x = -HALF; // 회전축 = 왼쪽 끝
    const at = (m: THREE.Mesh) => { m.position.x += HALF; body.add(m); };
    at(mesh(new THREE.BoxGeometry(RAIL_LENGTH, 0.012, 0.1), ALU, 0, 0.006, 0)); // 바닥 판
    for (const z of [-0.03, 0.03]) at(mesh(new THREE.BoxGeometry(RAIL_LENGTH, 0.01, 0.012), ALU, 0, 0.017, z)); // 바퀴 길
    for (const x of [-HALF + 0.01, HALF - 0.01]) at(mesh(new THREE.BoxGeometry(0.02, 0.045, 0.1), RUBBER, x, 0.0225, 0)); // 멈추개
    const ruler = new THREE.Mesh(new THREE.PlaneGeometry(RAIL_LENGTH, 0.012), new THREE.MeshBasicMaterial({ map: rulerTexture() }));
    ruler.position.set(0, 0.006, 0.0505);
    at(ruler);
    g.add(body);
    super(g, { name: '역학 레일', radius: 0.35, mass: 1.5, touchPad: false });
    this.body = body;
    // 오른쪽 끝 받침 (기울였을 때만 보임)
    this.leg = mesh(new THREE.BoxGeometry(0.03, 1, 0.08).translate(0, 0.5, 0), DARK, HALF - 0.03, 0, 0);
    this.leg.visible = false;
    g.add(this.leg);
    // 수레 자리: 몸체 좌표에서 x = 0.1 ~ 1.1 (레일 가운데 = 0.6)
    this.track = new Socket(this, '역학 레일', ['railMount'], v(HALF, RAIL_TOP, 0), {
      slide: { min: 0.1, max: RAIL_LENGTH - 0.1, axis: 'x' }, multi: true, hitRadius: 0.04,
    }, body);
    // 포토게이트 자리: 레일을 넘어가는 문을 레일 몸체 바닥에 걸친다 (수레와 같은 구간)
    this.gateTrack = new Socket(this, '역학 레일 (포토게이트 자리)', ['railGate'], v(HALF, 0, 0), {
      slide: { min: 0.15, max: RAIL_LENGTH - 0.15, axis: 'x' }, multi: true, hitRadius: 0.05,
    }, body);
    // 양 끝 센서 받침: 멈추개 바깥, 센서 앞면 중심이 수레 몸체 높이(레일 윗면 + 3.2 cm)에 오게.
    // 오른쪽 받침은 180° 돌려서 두 받침 모두 +x 쪽(받침 좌표)이 레일 가운데를 향한다
    this.mounts = [0, RAIL_LENGTH].map((x, i) => {
      const end = new THREE.Group();
      end.position.x = x;
      end.rotation.y = i ? Math.PI : 0;
      body.add(end);
      end.add(mesh(new THREE.BoxGeometry(0.06, 0.004, 0.08), DARK, -0.03, 0.022, 0)); // 받침판
      return new Socket(this, `레일 ${i ? '오른쪽' : '왼쪽'} 끝 받침`, ['sensorMount', 'railEnd'], v(-0.055, RAIL_TOP + 0.032, 0), { hitRadius: 0.035 }, end);
    });
  }

  get carts(): Cart[] {
    return this.track.children.filter((c): c is Cart => c instanceof Cart);
  }

  /** 기울기 (도) — 오른쪽 끝이 올라간다 */
  get inclineDeg(): number {
    return THREE.MathUtils.radToDeg(this.sim.incline);
  }

  setIncline(deg: number): void {
    const d = THREE.MathUtils.clamp(Math.round(deg * 10) / 10, 0, 10);
    this.sim.incline = THREE.MathUtils.degToRad(d);
    this.body.rotation.z = this.sim.incline;
    const h = RAIL_LENGTH * Math.sin(this.sim.incline);
    this.leg.visible = h > 0.002;
    this.leg.scale.y = Math.max(h, 0.001);
  }

  extraActions(): Action[] {
    return [
      ...(this.holding ? [{ label: '수레 놓기 (도르래 추가 끌기 시작)', run: () => this.release() }] : []),
      { label: `기울기 +0.5° (지금 ${this.inclineDeg.toFixed(1)}°)`, secondary: true, run: () => this.setIncline(this.inclineDeg + 0.5) },
      { label: `기울기 −0.5° (지금 ${this.inclineDeg.toFixed(1)}°)`, secondary: true, run: () => this.setIncline(this.inclineDeg - 0.5) },
    ];
  }

  experimentActions(): Action[] {
    return this.carts.length && this.object.parent?.type === 'Scene' ? [{ label: '궤도 실험', run: () => this.onOpenPanel(this) }] : [];
  }

  bodyOf(c: Cart): CartBody | undefined {
    return this.bodies.get(c);
  }

  /** 수레를 v(m/s)로 밀기 (+ = 레일 오른쪽) */
  push(c: Cart, speed: number): void {
    const b = this.bodies.get(c);
    if (!b) return;
    this.sim.unstick(b.id);
    b.locked = false;
    b.v = speed;
  }

  /** 도르래 실험: 잡고 있던 수레를 놓는다 (추가 끌기 시작) */
  release(): void {
    for (const b of this.bodies.values()) b.locked = false;
  }

  /** 실이 묶인(잡혀 있는) 수레가 있는가 */
  get holding(): boolean {
    return [...this.bodies.values()].some((b) => b.locked);
  }

  /** 도르래에 걸린 추 정보 (패널 표시용) */
  loadInfo(): { cart: Cart; m: number; M: number; dir: 1 | -1 } | null {
    const L = this.sim.load;
    if (!L) return null;
    for (const [c, b] of this.bodies) if (b.id === L.cartId) return { cart: c, m: L.m, M: b.mass, dir: L.dir };
    return null;
  }

  stopAll(): void {
    for (const b of this.bodies.values()) {
      b.v = 0;
      this.sim.unstick(b.id);
    }
  }

  /** 수레의 레일 위 위치를 s(m, 레일 가운데 = 0)로 옮기고 멈춘다 */
  place(c: Cart, s: number): void {
    const b = this.bodies.get(c);
    const a = c.object.parent;
    if (!b || !a) return;
    this.shiftLoad(b, s);
    b.s = s;
    b.v = 0;
    this.sim.unstick(b.id);
    a.position.x = s + HALF;
    this.written.set(c, a.position.x);
  }

  /** 추와 이어진 수레를 손으로 옮기면 실 길이만큼 추도 오르내리고, 수레는 다시 잡은 상태가 된다 */
  private shiftLoad(b: CartBody, s: number): void {
    const L = this.sim.load;
    if (!L || L.cartId !== b.id) return;
    L.drop = Math.min(L.maxDrop, Math.max(L.minDrop, L.drop + L.dir * (s - b.s)));
    L.taut = true;
    b.locked = true;
  }

  onChildDetached(child: Item): void {
    if (!(child instanceof Cart)) return;
    const b = this.bodies.get(child);
    if (b) {
      this.sim.unstick(b.id);
      this.sim.carts.splice(this.sim.carts.indexOf(b), 1);
    }
    this.bodies.delete(child);
    this.written.delete(child);
  }

  /** 매 프레임: 올려진 수레 ↔ 시뮬레이션 동기화 → 적분 → 위치 반영 */
  update(dt: number): void {
    for (const c of this.carts) {
      const a = c.object.parent!;
      let b = this.bodies.get(c);
      if (!b) {
        b = { id: this.nextId++, mass: c.totalMass, length: c.length, bumper: c.bumper, s: a.position.x - HALF, v: 0, history: [] };
        this.bodies.set(c, b);
        this.sim.carts.push(b);
      } else if (this.written.get(c) !== a.position.x) {
        // 사용자가 위치를 옮김 (±1 cm) → 그 자리에서 멈춘 상태로
        this.shiftLoad(b, a.position.x - HALF);
        b.s = a.position.x - HALF;
        b.v = 0;
      }
      b.mass = c.totalMass;
      b.bumper = c.bumper;
    }
    this.syncLoad();
    this.syncSensors();
    // 레일을 들고 있으면 멈춤
    if (this.object.parent?.type === 'Scene' && this.speed > 0) this.sim.advance(dt * this.speed);
    for (const c of this.carts) {
      const b = this.bodies.get(c)!;
      const a = c.object.parent!;
      const old = a.position.x;
      a.position.x = b.s + HALF;
      this.written.set(c, a.position.x);
      c.roll(a.position.x - old);
    }
    this.drawString();
  }

  private gateBodies = new Map<Photogate, GateBody>();
  private nextGate = 1;

  /**
   * 끝 받침의 힘 센서 → 시뮬레이션의 범퍼 접촉, 포토게이트 → 빛줄기 위치
   * (범퍼 끝면·빛줄기 위치는 레일 몸체 좌표로 바꿔 s = x − 0.6 m)
   */
  private syncSensors(): void {
    const body = this.body;
    body.updateWorldMatrix(true, false);
    const inv = body.matrixWorld.clone().invert();
    for (let i = 0; i < 2; i++) {
      const f = this.mounts[i].children[0];
      if (!(f instanceof ForceSensor)) {
        this.sim.ends[i] = null;
        continue;
      }
      f.object.updateWorldMatrix(true, false);
      const tip = f.object.localToWorld(f.tipLocal.clone()).applyMatrix4(inv);
      const spec = FORCE_BUMPER[f.bumper];
      const E = this.sim.ends[i] ?? { face: 0, k: spec.k, e: spec.e, F: 0, vIn: 0, log: [] };
      E.face = tip.x - HALF;
      E.k = spec.k;
      E.e = spec.e;
      this.sim.ends[i] = E;
      f.track = this.sim;
      f.end = E;
      // 이 끝에 가장 가까운 수레의 질량 (충격량 = 운동량 변화 비교용)
      const bs = [...this.bodies.values()];
      const near = bs.reduce<CartBody | null>((a, b) => (!a || (i ? b.s > a.s : b.s < a.s) ? b : a), null);
      f.cartMass = near ? near.mass : null;
    }
    const gates = this.gateTrack.children.filter((c): c is Photogate => c instanceof Photogate);
    for (const [g, b] of this.gateBodies) {
      if (gates.includes(g)) continue;
      this.gateBodies.delete(g);
      this.sim.gates.splice(this.sim.gates.indexOf(b), 1);
    }
    for (const g of gates) {
      let b = this.gateBodies.get(g);
      if (!b) {
        b = { id: this.nextGate++, s: 0, blocked: false, passes: [] };
        this.gateBodies.set(g, b);
        this.sim.gates.push(b);
      }
      b.s = g.object.parent!.position.x - HALF;
      g.track = this.sim;
      g.gate = b;
    }
  }

  /** 끝 받침에 끼운 도르래 (있으면)와 그 쪽 방향 */
  private pulley(): { p: Pulley; dir: 1 | -1 } | null {
    for (let i = 0; i < 2; i++) {
      const p = this.mounts[i].children[0];
      if (p instanceof Pulley) return { p, dir: i === 1 ? 1 : -1 };
    }
    return null;
  }

  /**
   * 도르래에 추가 걸려 있으면 시뮬레이션에 "추" 를 만든다.
   * 실은 도르래 쪽에서 가장 가까운 수레에 묶인다. 새로 걸면 그 수레를 잡고 있는 상태로 시작 (놓기를 기다림).
   */
  private syncLoad(): void {
    const pu = this.pulley();
    const hanger = pu?.p.hook.children[0];
    const carts = [...this.bodies.values()];
    if (!pu || !hanger || !carts.length || this.object.parent?.type !== 'Scene') {
      if (this.sim.load) for (const b of carts) b.locked = false;
      this.sim.load = null;
      return;
    }
    const tied = carts.reduce((a, b) => (pu.dir * b.s > pu.dir * a.s ? b : a));
    // 추가 내려갈 수 있는 거리: 도르래 바로 아래 면(바닥·책상)까지 − 추 높이
    pu.p.object.updateWorldMatrix(true, false);
    const top = pu.p.object.localToWorld(pu.p.hookLocal(0));
    const maxDrop = Math.max(0.05, top.y - surfaceBelow(top.x, top.z, top.y) - hanger.height - 0.015);
    let L = this.sim.load;
    if (!L || L.cartId !== tied.id || L.dir !== pu.dir) {
      L = {
        cartId: tied.id, dir: pu.dir, m: hanger.mass, inertia: Pulley.INERTIA, fp: Pulley.FRICTION,
        drop: Math.min(Pulley.REST_DROP, maxDrop), minDrop: 0.03, maxDrop, taut: true, sRest: tied.s,
      } satisfies HangingLoad;
      this.sim.load = L;
      tied.locked = true; // 추를 걸자마자 끌려가지 않게 손으로 잡고 있음
      tied.v = 0;
    }
    L.m = hanger.mass;
    L.maxDrop = maxDrop;
    pu.p.setDrop(L.drop);
  }

  /** 실: 수레 앞 끝 → 도르래 바퀴 위 → 바퀴 바깥쪽으로 감겨 → 추 고리 */
  private stringCable: Cable | null = null;
  private stringPts = Array.from({ length: 12 }, () => new THREE.Vector3());
  private drawString(): void {
    const pu = this.pulley();
    const L = this.sim.load;
    const info = this.loadInfo();
    const show = !!(pu && L && info && this.object.parent?.type === 'Scene');
    if (!show) {
      if (this.stringCable) this.stringCable.mesh.visible = false;
      return;
    }
    if (!this.stringCable) {
      this.stringCable = new Cable(this.stringPts.length, 0.0012, 0xe8e0c8);
      this.object.parent!.add(this.stringCable.mesh);
    }
    const c = info!.cart;
    c.object.updateWorldMatrix(true, false);
    const tie = c.object.localToWorld(new THREE.Vector3(L!.dir * 0.095, 0.045, 0)); // 수레 도르래 쪽 범퍼
    const p = pu!.p;
    const top = p.object.localToWorld(new THREE.Vector3(0, Pulley.TOP, Pulley.CZ));
    const pts: THREE.Vector3[] = [tie, top];
    // 바퀴를 따라 90° 감기는 부분 (바퀴 중심 기준)
    const ctr = p.object.localToWorld(new THREE.Vector3(0, Pulley.TOP - Pulley.R, Pulley.CZ));
    const outward = p.object.localToWorld(new THREE.Vector3(0, Pulley.TOP - Pulley.R, Pulley.CZ - Pulley.R)).sub(ctr);
    const up = top.clone().sub(ctr);
    for (let k = 1; k <= 8; k++) {
      const a = (k / 8) * (Math.PI / 2);
      pts.push(ctr.clone().addScaledVector(up, Math.cos(a)).addScaledVector(outward, Math.sin(a)));
    }
    pts.push(p.object.localToWorld(p.hookLocal(L!.drop)));
    this.stringPts.forEach((q, i) => q.copy(pts[Math.min(i, pts.length - 1)]));
    this.stringCable.setPoints(this.stringPts);
    this.stringCable.mesh.visible = true;
  }
}

export class Cart extends Item {
  static readonly BASE_MASS = 0.5;
  /** 범퍼 포함 길이 (m) */
  readonly length = 0.19;
  bumper: Bumper = 'magnet';
  /** 밀 때의 속력 (m/s) — 패널에서 조절 */
  pushSpeed = 0.3;
  readonly slots: Socket[];
  private wheels: THREE.Mesh[] = [];
  private bumpers: THREE.Mesh[] = [];

  constructor(name: string, color: number) {
    const g = new THREE.Group();
    const shell = new THREE.MeshLambertMaterial({ color });
    g.add(mesh(new THREE.BoxGeometry(0.17, 0.03, 0.08), shell, 0, 0.032, 0)); // 몸체
    const wheels: THREE.Mesh[] = [];
    for (const x of [-0.06, 0.06]) for (const z of [-0.03, 0.03]) {
      const w = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.008, 8).rotateX(Math.PI / 2), DARK, x, 0.012, z);
      wheels.push(w);
      g.add(w);
    }
    const bumpers: THREE.Mesh[] = [];
    for (const x of [-0.09, 0.09]) {
      const b = mesh(new THREE.BoxGeometry(0.01, 0.024, 0.05), BUMPER_MAT.magnet, x, 0.032, 0);
      bumpers.push(b);
      g.add(b);
    }
    // 차단판 (포토게이트용): 가운데 위에 폭 2.0 cm, 질량 막대 두 개 사이
    g.add(mesh(new THREE.BoxGeometry(FLAG_W, 0.053, 0.003), DARK, 0, 0.0735, 0));
    super(g, {
      name, radius: 0.1, mass: Cart.BASE_MASS, dragArea: 0,
      plugs: [{ type: 'railMount', point: v(0, 0, 0) }],
    });
    this.wheels = wheels;
    this.bumpers = bumpers;
    this.slots = [-0.045, 0.045].map((x, i) => new Socket(this, `${name} 위 ${i ? '오른쪽' : '왼쪽'}`, ['cartMass'], v(x, 0.047, 0), { hitRadius: 0.03 }));
  }

  /** 수레 + 얹은 질량 막대 (kg) */
  get totalMass(): number {
    return Cart.BASE_MASS + this.slots.reduce((m, s) => m + s.children.reduce((a, c) => a + c.mass, 0), 0);
  }

  get rail(): Rail | null {
    const o = this.attachedTo?.owner;
    return o instanceof Rail ? o : null;
  }

  setBumper(b: Bumper): void {
    this.bumper = b;
    for (const m of this.bumpers) m.material = BUMPER_MAT[b];
  }

  /** 굴러간 거리만큼 바퀴를 돌린다 (보기용) */
  roll(dx: number): void {
    for (const w of this.wheels) w.rotation.z -= dx / 0.012;
  }

  /** 레일 위에서는 돌리지 않는다 (레일 방향으로만 움직임) */
  rotateAction(): Action[] {
    return this.rail ? [] : super.rotateAction();
  }

  extraActions(): Action[] {
    const rail = this.rail;
    const out: Action[] = [];
    if (rail) {
      if (rail.holding) out.push({ label: '놓기 (도르래 추가 끌기 시작)', run: () => rail.release() });
      out.push(
        { label: `밀기 → ${this.pushSpeed.toFixed(2)} m/s`, run: () => rail.push(this, this.pushSpeed) },
        { label: `밀기 ← ${this.pushSpeed.toFixed(2)} m/s`, run: () => rail.push(this, -this.pushSpeed) },
        { label: '멈추기', run: () => rail.push(this, 0) },
      );
    }
    for (const b of Object.keys(BUMPER_NAME) as Bumper[]) {
      if (b !== this.bumper) out.push({ label: `범퍼 → ${BUMPER_NAME[b]}`, secondary: true, run: () => this.setBumper(b) });
    }
    return out;
  }
}

/**
 * 도르래: 레일 끝 받침에 끼운다. 바퀴 윗면이 수레 몸통 높이(실 높이)에 오고, 레일 바깥쪽으로 튀어나온다.
 * 바퀴 바깥쪽으로 내려온 실 끝 고리에 추(추 20 ~ 200 g, 쇠공)를 건다.
 * 물체 좌표: 받침에 끼우면 +z가 레일 가운데를 향한다 (plug rotY = 90°)
 *   바퀴 중심 (0, −R, −0.03), 축은 x 방향. 실은 바퀴 위(0, 0, −0.03)를 지나 바깥쪽(z = −0.03 − R)으로 내려간다.
 */
export class Pulley extends Item {
  /** 바퀴 반지름 (실이 감기는 홈 기준) */
  static readonly R = 0.04;
  /** 바퀴 중심의 앞뒤 위치 (물체 좌표 z): 레일 쪽 가장자리는 받침 바로 앞 */
  static readonly CZ = -0.05;
  /** 바퀴 관성 I/r² = m_p/2 (얇은 원판, 바퀴 20 g) */
  static readonly INERTIA = 0.01;
  /** 축 마찰력 (N) */
  static readonly FRICTION = 0.003;
  /** 추를 처음 걸었을 때·도르래를 떼었을 때 실 길이 (도르래 아래로 늘어진 길이) */
  static readonly REST_DROP = 0.12;
  /** 실이 지나는 바퀴 꼭대기의 높이 (물체 좌표 y): 물체 원점은 받침 바닥 → 책상에 놓으면 바퀴가 상판 위에 선다 */
  static readonly TOP = 2 * Pulley.R + 0.008;
  readonly hook: Socket;

  constructor() {
    const g = new THREE.Group();
    const R = Pulley.R;
    const z = Pulley.CZ;
    // 모양은 바퀴 꼭대기 기준으로 만들고 통째로 TOP만큼 올린다
    const body = new THREE.Group();
    body.position.y = Pulley.TOP;
    g.add(body);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x2f6fb0 });
    // 홈이 파인 바퀴: 가운데 원판 + 양쪽 테두리 (조금 더 큼)
    const wheel = mesh(new THREE.CylinderGeometry(R, R, 0.01, 18).rotateZ(Math.PI / 2), wheelMat, 0, -R, z);
    const rimA = mesh(new THREE.CylinderGeometry(R + 0.004, R + 0.004, 0.003, 18).rotateZ(Math.PI / 2), wheelMat, 0.0065, -R, z);
    const rimB = mesh(new THREE.CylinderGeometry(R + 0.004, R + 0.004, 0.003, 18).rotateZ(Math.PI / 2), wheelMat, -0.0065, -R, z);
    // 바퀴살 느낌이 나게 밝은 원판 (돌 때 보이도록 흰 표시 하나)
    const mark = mesh(new THREE.BoxGeometry(0.0125, 0.006, R * 0.8), ALU, 0, -R, z - R * 0.4);
    const hub = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.03, 10).rotateZ(Math.PI / 2), ALU, 0, -R, z);
    // 축을 잡는 팔 두 개: 바퀴 중심 → 받침 집게
    const armLen = -z + 0.02;
    const arm = mesh(new THREE.BoxGeometry(0.004, 0.02, armLen), ALU, 0.0135, -R, z / 2 + 0.01);
    const arm2 = mesh(new THREE.BoxGeometry(0.004, 0.02, armLen), ALU, -0.0135, -R, z / 2 + 0.01);
    const clamp = mesh(new THREE.BoxGeometry(0.034, 0.03, 0.024), DARK, 0, -R, 0.02);
    const post = mesh(new THREE.BoxGeometry(0.02, R, 0.012), DARK, 0, -R / 2, 0.02);
    body.add(wheel, rimA, rimB, mark, hub, arm, arm2, clamp, post);
    super(g, { name: '도르래', radius: 0.06, mass: 0.08, plugs: [{ type: 'railEnd', point: v(0, Pulley.TOP, 0), rotY: Math.PI / 2 }] });
    this.wheel = [wheel, mark];
    this.hook = new Socket(this, '도르래 실 끝 고리', ['hook'], this.hookLocal(Pulley.REST_DROP), { hitRadius: 0.035 });
  }

  private wheel: THREE.Mesh[];
  private lastDrop = Pulley.REST_DROP;

  /** 추가 drop만큼 내려갔을 때 실 끝 고리 (물체 좌표): 바퀴 바깥쪽 가장자리에서 수직으로 내려감 */
  hookLocal(drop: number): THREE.Vector3 {
    return v(0, Pulley.TOP - Pulley.R - drop, Pulley.CZ - Pulley.R);
  }

  /** 실 길이 반영 + 실이 풀린 만큼 바퀴를 돌린다 (미끄러짐 없음: Δθ = Δs / R) */
  setDrop(drop: number): void {
    this.hook.anchor.position.copy(this.hookLocal(drop));
    const dth = (drop - this.lastDrop) / Pulley.R;
    this.lastDrop = drop;
    for (const w of this.wheel) {
      // 바퀴 중심을 축으로 회전 (축은 물체 x축)
      const c = new THREE.Vector3(0, -Pulley.R, Pulley.CZ);
      w.position.sub(c).applyAxisAngle(new THREE.Vector3(1, 0, 0), dth).add(c);
      w.rotateX(dth);
    }
  }

  /**
   * 레일에 끼우지 않은 도르래: 실을 감아 추가 받침 바닥 높이에 닿게 둔다
   * (손에 들면 도르래 바로 옆에 매달려 보이고, 책상에 놓으면 추가 도르래 옆 상판에 얹힌다)
   */
  private rest(): void {
    const w = this.hook.children[0];
    if (!w) return this.setDrop(0);
    const hang = w.plugs[0]?.point.y ?? w.height; // 추 바닥 → 고리
    this.setDrop(Math.max(-Pulley.R, Pulley.TOP - Pulley.R - hang));
  }

  /** 레일에서 떼면 (추가 1 m 가까이 아래에 매달린 채 사라지지 않게) 실을 감아 둔다 */
  onDetached(s: Socket): void {
    super.onDetached(s);
    this.rest();
  }

  onChildAttached(child: Item, s: Socket): void {
    super.onChildAttached(child, s);
    if (!this.attachedTo) this.rest();
  }

  /** 받침에 끼워져 있으면 돌리지 않는다 */
  rotateAction(): Action[] {
    return this.attachedTo ? [] : super.rotateAction();
  }
}

/** 질량 막대 250 g: 수레 위에 얹는다 */
export function massBar(): Item {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.07, 0.018, 0.05), BAR, 0, 0.009, 0));
  return new Item(g, {
    name: '질량 막대 250 g', radius: 0.045, mass: 0.25,
    plugs: [{ type: 'cartMass', point: v(0, 0, 0) }],
  });
}
