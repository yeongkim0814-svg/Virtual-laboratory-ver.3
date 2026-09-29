/**
 * 화학 실험 기구: 용액을 담는 그릇, 시약병, 지시약병, pH 시험지, 폐액통
 *
 *   그릇(Container): 비커 100 mL · 삼각 플라스크 250 mL · 눈금실린더 50 mL · 뷰렛 50 mL · 시약병 500 mL
 *     용액(Solution)을 담고, 부피만큼 액면이 차오르며 색은 용액 계산으로 정해진다.
 *     정밀도(precision): 따를 때 슬라이더 한 칸, 눈금을 읽는 단위.
 *       비커 5 mL(대략), 플라스크 10 mL, 눈금실린더 0.5 mL, 뷰렛 0.05 mL
 *       → 정확한 부피가 필요하면 눈금실린더·뷰렛으로 잰다 (실제 실험과 같은 이유)
 *   들고 있는 그릇으로 다른 그릇을 두 번 탭 → "따르기" (시약병에서는 "받기").
 *   시약병에는 다시 붓지 않는다 (시약 오염 방지 — 실험실 규칙).
 *   뷰렛은 클램프에 물려 두고 두 번 탭 → "적하": 바로 아래 그릇으로 떨어뜨린다.
 */
import * as THREE from 'three';
import { Item, Socket } from '../world/items';
import type { Action, Interactable } from '../world/interactable';
import { INDICATORS, REAGENTS, Solution, reagentSolution, universalColor, type Reagent } from '../sim/chem';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const GLASS = new THREE.MeshLambertMaterial({ color: 0xd6ecef, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
const DARK = new THREE.MeshLambertMaterial({ color: 0x2a2c2e });
const WHITE = new THREE.MeshLambertMaterial({ color: 0xe8e8e0 });

export type ContainerKind = 'beaker' | 'flask' | 'cylinder' | 'burette' | 'bottle';

/** 안쪽 모양: 바닥 반지름 R, 윗면 반지름 r, 높이 H (원뿔대), 바닥 높이 y0 — 부피 ↔ 액면 높이 */
interface Profile {
  R: number;
  r: number;
  H: number;
  y0: number;
}

/** main.ts가 채워 주는 연결 고리 (따르기 창, 알림, 적하 대상 찾기) */
export const chemHooks = {
  pour: (_src: Container, _dst: Container) => {},
  dispense: (_b: Container) => {},
  toast: (_html: string) => {},
};

/** 뷰렛 콕 열림 정도 (mL/s) — 한 방울 ≈ 0.05 mL */
export const FLOW_RATES: [string, number][] = [['한 방울씩', 0.05], ['천천히', 0.2], ['빠르게', 1.0]];

export class Container extends Item {
  readonly solution = new Solution();
  /** 뷰렛에서 받은 부피 누계 (mL) — 적정 곡선의 가로축 (측정 프로그램이 기록 시작 때 0으로 맞춤) */
  titrantAdded = 0;
  /** 뷰렛 콕: 흐르는 속도 (mL/s, 0 = 잠김) */
  flowRate = 0;
  /** pH 전극을 꽂는 자리 (그릇 입구 위, 전극 끝이 바닥 바로 위(물체 좌표 y = 4 mm)에 오게) */
  probeSlot: Socket | null = null;
  private drip: THREE.Mesh | null = null;
  private dripT = 0;
  private liquid: THREE.Mesh;
  private liquidMat = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.72, depthWrite: false });
  private shownKey = '';

  /**
   * @param capacity 담을 수 있는 최대 부피 (mL)
   * @param precision 따르기 슬라이더 한 칸·눈금 읽기 단위 (mL)
   */
  constructor(group: THREE.Group, name: string, readonly kind: ContainerKind, readonly capacity: number,
    readonly precision: number, private profile: Profile, opts: { radius: number; mass: number; grip?: number }) {
    super(group, {
      name, radius: opts.radius, mass: opts.mass,
      plugs: opts.grip !== undefined ? [{ type: 'grip', point: v(0, opts.grip, 0) }] : [],
    });
    this.liquid = new THREE.Mesh(new THREE.BufferGeometry(), this.liquidMat);
    this.liquid.userData.noPick = true;
    this.liquid.raycast = () => {};
    group.add(this.liquid);
    if (kind !== 'bottle' && kind !== 'burette') {
      // 가운데는 뷰렛 끝 자리이므로 전극은 입구 안쪽 옆으로 비켜 꽂는다
      const off = Math.min(profile.r * 0.55, 0.014);
      this.probeSlot = new Socket(this, `${name} (전극 꽂기)`, ['probe'], v(0, 0.144, off), { hitRadius: 0.02 });
    }
  }

  /** 액면 높이 (그릇 바닥 기준, m) */
  liquidHeight(): number {
    return this.solution.V > 0 ? Math.min(this.heightOf(this.solution.V / 1000), this.profile.H) : 0;
  }

  /** 액면의 높이 (물체 좌표 y) */
  get surfaceY(): number {
    return this.profile.y0 + this.liquidHeight();
  }

  /**
   * 뷰렛 끝에서 떨어지는 방울·줄기 (보기용)
   * @param fall 뷰렛 끝에서 받는 그릇 액면까지 거리 (m)
   */
  animateDrip(dt: number, fall: number): void {
    if (!this.drip) {
      this.drip = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 1, 6), this.liquidMat);
      this.drip.userData.noPick = true;
      this.drip.raycast = () => {};
      this.object.add(this.drip);
    }
    const d = this.drip;
    d.visible = this.flowRate > 0 && this.volume > 0;
    if (!d.visible) return;
    if (this.flowRate >= 1) {
      // 빠르게: 가는 줄기
      d.scale.set(0.6, Math.max(0.001, fall), 0.6);
      d.position.y = -fall / 2;
      return;
    }
    // 방울: 한 방울(0.05 mL)마다 끝에서 떨어져 액면까지 (자유 낙하 대신 보기 좋은 일정한 속도)
    const period = 0.05 / this.flowRate;
    this.dripT = (this.dripT + dt) % period;
    const k = Math.min(1, this.dripT / Math.min(period, 0.35));
    d.scale.set(1, 0.005, 1); // 방울 하나 ≈ 5 mm
    d.position.y = -k * fall;
  }

  /** 들어 있는 부피 (mL) */
  get volume(): number {
    return this.solution.V * 1000;
  }

  get free(): number {
    return Math.max(0, this.capacity - this.volume);
  }

  /** 색 계산에 쓰는 빛의 두께 (cm) — 벽 근처 얇은 층을 본다고 보고 최대 1.5 cm */
  get pathCm(): number {
    return Math.min(1.5, this.profile.R * 200);
  }

  /** 부피 → 액면 높이 (원뿔대 부피를 이분법으로 뒤집기) */
  private heightOf(Vm3: number): number {
    const { R, r, H } = this.profile;
    const vol = (h: number) => {
      const rt = R + ((r - R) * h) / H;
      return (Math.PI * h * (R * R + R * rt + rt * rt)) / 3;
    };
    let lo = 0;
    let hi = H * 1.2;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (vol(m) < Vm3) lo = m;
      else hi = m;
    }
    return (lo + hi) / 2;
  }

  /** 액면·색 다시 그리기 (바뀌었을 때만) */
  refresh(): void {
    const Vm3 = this.solution.V / 1000; // L → m³
    const [cr, cg, cb] = this.solution.color(this.pathCm);
    const key = `${Vm3.toFixed(9)}|${cr.toFixed(3)},${cg.toFixed(3)},${cb.toFixed(3)}`;
    if (key === this.shownKey) return;
    this.shownKey = key;
    const h = Math.min(this.heightOf(Vm3), this.profile.H);
    this.liquid.visible = h > 0.0005;
    if (!this.liquid.visible) return;
    const { R, r, H, y0 } = this.profile;
    const rt = R + ((r - R) * h) / H;
    this.liquid.geometry.dispose();
    this.liquid.geometry = new THREE.CylinderGeometry(rt * 0.97, R * 0.97, h, 12);
    this.liquid.position.y = y0 + h / 2;
    this.liquidMat.color.setRGB(cr, cg, cb);
  }

  /** 눈금 읽기: 그릇의 정밀도만큼 반올림 */
  reading(): string {
    const V = this.volume;
    if (this.kind === 'burette') {
      // 뷰렛 눈금은 위가 0 → 읽은 값 = 50 − 들어 있는 양
      const r = 50 - V;
      return r < 0 ? '0 눈금 위 (50 mL 넘게 들어 있음)' : `눈금 ${(Math.round(r / 0.05) * 0.05).toFixed(2)} mL (들어 있는 양 ${V.toFixed(2)} mL)`;
    }
    const q = Math.round(V / this.precision) * this.precision;
    const digits = this.precision < 1 ? 1 : 0;
    return this.kind === 'cylinder' ? `${q.toFixed(digits)} mL` : `약 ${q.toFixed(0)} mL`;
  }

  extraActions(): Action[] {
    const out: Action[] = [{
      label: '눈금 읽기',
      local: true,
      run: () => chemHooks.toast(`${this.name}: ${this.volume > 0 ? `${this.reading()} · ${this.solution.colorName(this.pathCm)}` : '비어 있음'}`),
    }];
    if (this.kind === 'burette' && this.attachedTo) {
      if (this.flowRate > 0) out.unshift({ label: '콕 잠그기', run: () => { this.flowRate = 0; } });
      else if (this.volume > 0) {
        out.unshift(
          ...FLOW_RATES.map(([n, r]) => ({ label: `콕 열기 · ${n} (${r} mL/s)`, run: () => { this.flowRate = r; } })),
          { label: '정량 적하 (부피를 정해서)', local: true, run: () => chemHooks.dispense(this) },
        );
      }
    }
    return out;
  }

  useOn(target: Item): Action[] {
    if (!(target instanceof Container) || target === this) return [];
    if (target.kind === 'bottle') {
      if (this.kind === 'bottle') return [];
      return [{ label: `받기 ← ${target.name}`, local: true, run: () => chemHooks.pour(target, this) }];
    }
    if (this.volume <= 0) return [{ label: `${this.name}이(가) 비어 있음`, secondary: true, local: true, run: () => {} }];
    return [{ label: `따르기 → ${target.name}`, local: true, run: () => chemHooks.pour(this, target) }];
  }
}

// ---------- 모양 만들기 ----------

function tube(r: number, h: number, y: number, mat: THREE.Material = GLASS, rTop = r): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, r, h, 12, 1, true), mat);
  m.position.y = y + h / 2;
  return m;
}

function disc(r: number, y: number, mat: THREE.Material = GLASS): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 12), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  return m;
}

/** 눈금선 (흰 가는 막대) */
function ticks(g: THREE.Group, r: number, y0: number, y1: number, n: number): void {
  for (let i = 0; i <= n; i++) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(i % 5 === 0 ? 0.008 : 0.005, 0.0012, 0.001), WHITE);
    t.position.set(0, y0 + ((y1 - y0) * i) / n, r + 0.0008);
    g.add(t);
  }
}

export function beaker(n: number): Container {
  const g = new THREE.Group();
  g.add(tube(0.026, 0.075, 0), disc(0.026, 0.001));
  ticks(g, 0.026, 0.004 + 0.0235, 0.004 + 0.047, 2); // 50·75·100 mL 대략 눈금
  return new Container(g, `비커 ${n}`, 'beaker', 110, 5, { R: 0.025, r: 0.025, H: 0.07, y0: 0.004 }, { radius: 0.03, mass: 0.1 });
}

export function flask(n: number): Container {
  const g = new THREE.Group();
  g.add(tube(0.042, 0.105, 0, GLASS, 0.016), tube(0.016, 0.04, 0.105), disc(0.042, 0.001));
  return new Container(g, `삼각 플라스크 ${n}`, 'flask', 250, 10, { R: 0.041, r: 0.015, H: 0.105, y0: 0.003 },
    { radius: 0.045, mass: 0.14, grip: 0.125 });
}

export function cylinder(n: number): Container {
  const g = new THREE.Group();
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.008, 6), DARK);
  foot.position.y = 0.004;
  g.add(foot, tube(0.0125, 0.135, 0.008), disc(0.0125, 0.012));
  ticks(g, 0.0125, 0.012, 0.012 + 0.12, 10); // 0 ~ 50 mL, 5 mL마다
  return new Container(g, `눈금실린더 ${n}`, 'cylinder', 52, 0.5, { R: 0.0115, r: 0.0115, H: 0.12, y0: 0.012 }, { radius: 0.03, mass: 0.12 });
}

/** 뷰렛: 끝(아래)이 원점. 50 mL가 관 0.5 m를 채운다 → 안쪽 반지름 = √(50 cm³ / (π·50 cm)) ≈ 5.64 mm */
export function burette(n: number): Container {
  const g = new THREE.Group();
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.001, 0.04, 6), GLASS);
  tip.position.y = 0.02;
  const cock = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.008, 0.008), DARK);
  cock.position.y = 0.05;
  g.add(tip, cock, tube(0.0064, 0.56, 0.06));
  ticks(g, 0.0064, 0.08, 0.58, 50); // 1 mL마다
  const R = Math.sqrt(50e-6 / (Math.PI * 0.5));
  return new Container(g, `뷰렛 ${n}`, 'burette', 55, 0.05, { R, r: R, H: 0.55, y0: 0.08 }, { radius: 0.02, mass: 0.1, grip: 0.45 });
}

/** 시약병 500 mL: 라벨에 시약 이름 */
export function reagentBottle(r: Reagent): Container {
  const g = new THREE.Group();
  const brown = r.id === 'H2O' ? GLASS : new THREE.MeshLambertMaterial({ color: 0x8a5a2a, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
  g.add(tube(0.043, 0.11, 0, brown), tube(0.043, 0.03, 0.11, brown, 0.015), tube(0.015, 0.02, 0.14, brown), disc(0.043, 0.001, brown));
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.02, 10), new THREE.MeshLambertMaterial({ color: capColor(r.id) }));
  cap.position.y = 0.17;
  g.add(cap);
  // 라벨
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = '#efe9d6';
  x.fillRect(0, 0, 128, 64);
  x.fillStyle = '#1a1a1a';
  x.font = 'bold 20px monospace';
  x.textAlign = 'center';
  const [a, b] = r.label.split(' ');
  x.fillText(a, 64, 28);
  if (b) x.fillText(b, 64, 54);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.03), new THREE.MeshBasicMaterial({ map: tex }));
  label.position.set(0, 0.06, 0.0435);
  g.add(label);
  const bottle = new Container(g, r.name, 'bottle', 510, 10, { R: 0.042, r: 0.042, H: 0.1, y0: 0.003 }, { radius: 0.05, mass: 0.8 });
  bottle.solution.add(reagentSolution(r, 0.5));
  bottle.refresh();
  return bottle;
}

function capColor(id: string): number {
  return ({ HCl: 0xc0392b, NaOH: 0x2f6fb0, AcOH: 0xd8a02a, NH3: 0x3a8f5a, H2O: 0xe0e0e0 } as Record<string, number>)[id] ?? 0x888888;
}

/** 지시약병 (스포이트 달림): 들고 그릇을 두 번 탭 → 1 ~ 3방울 */
export class DropperBottle extends Item {
  constructor(readonly indicator: keyof typeof INDICATORS, color: number) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.05, 10), new THREE.MeshLambertMaterial({ color: 0x6a4a2a, transparent: true, opacity: 0.7 }));
    body.position.y = 0.025;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), new THREE.MeshLambertMaterial({ color }));
    bulb.position.y = 0.065;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.012, 8), DARK);
    neck.position.y = 0.055;
    g.add(body, neck, bulb);
    super(g, { name: `${INDICATORS[indicator].name} 용액`, radius: 0.025, mass: 0.05 });
  }

  useOn(target: Item): Action[] {
    if (!(target instanceof Container) || target.kind === 'bottle') return [];
    const ind = INDICATORS[this.indicator];
    return [1, 2, 3].map((k) => ({
      label: `${ind.name} ${k}방울 → ${target.name}`,
      run: () => {
        target.solution.addMol(this.indicator, k * ind.dropMol);
        target.solution.V += k * 0.05e-3; // 1방울 ≈ 0.05 mL
        target.refresh();
        chemHooks.toast(`${target.name}에 ${ind.name} ${k}방울 → ${target.solution.colorName(target.pathCm)}`);
      },
    }));
  }
}

/** 만능 pH 시험지: 그릇에 찍어 색을 보고 pH를 대략(정수) 읽는다 */
export class PHPaper extends Item {
  constructor() {
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.016, 0.035), new THREE.MeshLambertMaterial({ color: 0xd9b24a }));
    box.position.y = 0.008;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.001, 0.008), new THREE.MeshLambertMaterial({ color: 0xe8d890 }));
    strip.position.set(0, 0.0165, 0);
    g.add(box, strip);
    super(g, { name: '만능 pH 시험지', radius: 0.04, mass: 0.03 });
  }

  useOn(target: Item): Action[] {
    if (!(target instanceof Container)) return [];
    return [{
      label: `pH 시험지 찍기 → ${target.name}`,
      local: true, // 읽기만 한다 (용액은 그대로)
      run: () => {
        const pH = target.solution.pH();
        if (pH === null) {
          chemHooks.toast(`${target.name}: 비어 있음`);
          return;
        }
        const [r, g, b] = universalColor(pH);
        const css = `rgb(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0})`;
        // 시험지는 색 비교표로 읽는다 → 정수 pH 정도의 정밀도
        chemHooks.toast(`<span style="display:inline-block;width:14px;height:14px;background:${css};vertical-align:middle"></span> 시험지 색을 비교표와 맞춰 보면 약 pH ${Math.round(pH)}`);
      },
    }];
  }
}

/** 폐액통 (폐시약 보관함 위): 들고 있는 그릇을 탭하면 비운다 */
/**
 * 폐액통: 유기 폐액 / 무기 폐액으로 나눠 버린다 (실험실 폐기 규칙)
 *   유기: 탄소 화합물이 든 용액 — 여기서는 아세트산(CH₃COOH)이 든 것
 *   무기: 무기산·염기·염 수용액 — HCl, NaOH, NH₃와 그 중화물(NaCl 등)
 *   (지시약도 유기물이지만 몇 방울이라 분류를 바꾸지 않는다. 증류수만 든 것은 어느 통에 버려도 된다)
 * 잘못 고르면 버리지 않고 알림창으로 이유를 알려 준다.
 */
export type WasteKind = 'organic' | 'inorganic';
export const WASTE_NAME: Record<WasteKind, string> = { organic: '유기 폐액통', inorganic: '무기 폐액통' };

/** 용액이 어느 폐액통으로 가야 하나 (증류수만 → null = 아무 곳) */
export function wasteKindOf(s: Solution): WasteKind | null {
  if ((s.n.Ac ?? 0) > 1e-12) return 'organic';
  if ((s.n.Na ?? 0) > 1e-12 || (s.n.Cl ?? 0) > 1e-12 || (s.n.N ?? 0) > 1e-12) return 'inorganic';
  return null;
}

export const wasteHooks = { alert: (_title: string, _body: string) => {} };

export class WasteCan implements Interactable {
  /** 모인 폐액 (mL) */
  volume = 0;
  getHeld: () => Item | null = () => null;
  readonly name: string;

  constructor(readonly object: THREE.Object3D, readonly kind: WasteKind) {
    this.name = WASTE_NAME[kind];
    object.userData.interactable = this;
    // 통 앞에 라벨
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 64;
    const x = c.getContext('2d')!;
    x.fillStyle = kind === 'organic' ? '#d8a02a' : '#2f6fb0';
    x.fillRect(0, 0, 128, 64);
    x.fillStyle = '#ffffff';
    x.font = 'bold 26px sans-serif';
    x.textAlign = 'center';
    x.fillText(kind === 'organic' ? '유기' : '무기', 64, 30);
    x.font = 'bold 14px sans-serif';
    x.fillText('폐액', 64, 54);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.06), new THREE.MeshBasicMaterial({ map: tex }));
    label.position.set(0, 0.18, 0.121);
    label.raycast = () => {};
    object.add(label);
  }

  actions(): Action[] {
    const h = this.getHeld();
    if (!(h instanceof Container) || h.kind === 'bottle' || h.volume <= 0) return [];
    return [{
      label: `${this.name}에 버리기 (${h.reading()})`,
      run: () => {
        const need = wasteKindOf(h.solution);
        if (need && need !== this.kind) {
          wasteHooks.alert('잘못된 폐액통', need === 'organic'
            ? `${h.name}에는 아세트산(CH₃COOH, 탄소 화합물)이 들어 있습니다. <b>유기 폐액통</b>에 버리세요.<br>유기물은 무기 폐액과 섞이면 따로 처리할 수 없고, 소각 등 다른 방법으로 처리해야 합니다.`
            : `${h.name}에는 무기산·염기(HCl, NaOH, NH₃ 또는 그 중화물)만 들어 있습니다. <b>무기 폐액통</b>에 버리세요.<br>유기 폐액통은 탄소 화합물(아세트산 등)을 모으는 곳입니다.`);
          return;
        }
        this.volume += h.volume;
        h.solution.clear();
        h.titrantAdded = 0;
        h.refresh();
        chemHooks.toast(`${this.name}에 버림 · 모인 폐액 ${this.volume.toFixed(0)} mL`);
      },
    }];
  }
}

export { REAGENTS };
