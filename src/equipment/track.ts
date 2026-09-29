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
import type { Action } from '../world/interactable';
import { BUMPER_NAME, TrackSim, type Bumper, type CartBody } from '../sim/track';

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
    // 양 끝 센서 받침: 멈추개 바깥, 센서 앞면 중심이 수레 몸체 높이(레일 윗면 + 3.2 cm)에 오게.
    // 오른쪽 받침은 180° 돌려서 두 받침 모두 +x 쪽(받침 좌표)이 레일 가운데를 향한다
    this.mounts = [0, RAIL_LENGTH].map((x, i) => {
      const end = new THREE.Group();
      end.position.x = x;
      end.rotation.y = i ? Math.PI : 0;
      body.add(end);
      end.add(mesh(new THREE.BoxGeometry(0.06, 0.004, 0.08), DARK, -0.03, 0.022, 0)); // 받침판
      return new Socket(this, `레일 ${i ? '오른쪽' : '왼쪽'} 끝 센서 받침`, ['sensorMount'], v(-0.055, RAIL_TOP + 0.032, 0), { hitRadius: 0.035 }, end);
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
    b.v = speed;
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
    b.s = s;
    b.v = 0;
    this.sim.unstick(b.id);
    a.position.x = s + HALF;
    this.written.set(c, a.position.x);
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
        b.s = a.position.x - HALF;
        b.v = 0;
      }
      b.mass = c.totalMass;
      b.bumper = c.bumper;
    }
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

/** 질량 막대 250 g: 수레 위에 얹는다 */
export function massBar(): Item {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.07, 0.018, 0.05), BAR, 0, 0.009, 0));
  return new Item(g, {
    name: '질량 막대 250 g', radius: 0.045, mass: 0.25,
    plugs: [{ type: 'cartMass', point: v(0, 0, 0) }],
  });
}
