/**
 * 직류 회로 부품: 저항, 꼬마전구, 스위치, 전압계, 전류계 + 회로 해석 연결
 *
 * 모든 부품은 단자 두 개짜리 소자다. 도선으로 이어진 단자끼리는 같은 마디가 되고,
 * 부품 하나는 두 마디 사이에 놓인 저항으로 본다.
 *   저항      R (표시값, 오차 없음)
 *   꼬마전구  R(T) — 필라멘트 온도에 따라 변함 (sim/circuit.ts Filament)
 *   스위치    닫힘 0.001 Ω / 열림 = 끊김
 *   전류계    0.01 Ω (이상적인 전류계에 가깝게 — 회로에 직렬로 넣어도 전류가 거의 안 바뀜)
 *   전압계    10 MΩ (이상적인 전압계에 가깝게 — 병렬로 대도 전류를 거의 빼앗지 않음)
 * 광전관이 들어 있는 회로는 광전 효과 해석(electrical.ts)에 맡기고 여기서는 표시값을 건드리지 않는다.
 */
import * as THREE from 'three';
import { Item } from '../world/items';
import type { Action } from '../world/interactable';
import { Terminal, type WireSystem } from '../world/wires';
import { Lcd, type DCPowerSupply, type Microammeter, type Phototube } from './electrical';
import { Filament, junctionCurrent, solveDC, type Conductor, type Junction, type Source } from '../sim/circuit';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const BOARD = new THREE.MeshLambertMaterial({ color: 0xd9d2bc });
const DARK = new THREE.MeshLambertMaterial({ color: 0x2e302c });
const CASE = new THREE.MeshLambertMaterial({ color: 0x8b8f86 });
const METAL = new THREE.MeshLambertMaterial({ color: 0xb8bcc0 });
const FRONT = v(0, 0, 1);

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/** 두 단자짜리 회로 부품 */
export abstract class CircuitPart extends Item {
  abstract readonly a: Terminal;
  abstract readonly b: Terminal;
  /** 이번 해석에서 a → b로 흐른 전류 (A), 전위차 V_a − V_b (V) */
  current = 0;
  voltage = 0;
  /** 전원 장치가 있는 회로에 들어 있는가 (main이 매 프레임 채움) */
  inCircuit = false;
  onOpenPanel: (p: CircuitPart) => void = () => {};

  /** 지금 이 부품의 저항 (Ω). null = 끊김(열린 스위치) */
  abstract resistance(): number | null;

  /** 두 번 탭 메뉴에 "직류 회로 실험" (왼쪽 위 바로 열기 버튼은 전원 장치 쪽에서 하나만) */
  protected circuitActions(): Action[] {
    return this.inCircuit ? [{ label: '직류 회로 실험', run: () => this.onOpenPanel(this) }] : [];
  }

  extraActions(): Action[] {
    return this.circuitActions();
  }

  update(_dt: number): void {}
}

/** 저항 판: 받침 위의 색띠 저항 + 놋쇠 단자 두 개 */
export class Resistor extends CircuitPart {
  readonly a: Terminal;
  readonly b: Terminal;

  constructor(readonly R: number) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.1, 0.012, 0.05), BOARD, 0, 0.006, 0));
    const body = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.03, 8).rotateZ(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xd8c098 }), 0, 0.026, 0);
    g.add(body);
    // 색띠 (저항값 읽기 연습: 첫째·둘째 숫자, 곱수)
    const bands = colorBands(R);
    bands.forEach((c, i) => g.add(mesh(new THREE.CylinderGeometry(0.0063, 0.0063, 0.003, 8).rotateZ(Math.PI / 2), new THREE.MeshLambertMaterial({ color: c }), -0.009 + i * 0.006, 0.026, 0)));
    g.add(mesh(new THREE.BoxGeometry(0.07, 0.0015, 0.0015), METAL, 0, 0.026, 0)); // 다리
    super(g, { name: `저항 ${R} Ω`, radius: 0.06, mass: 0.05, touchPad: false });
    this.a = new Terminal(this, '왼쪽 단자', 'n', v(-0.038, 0.02, 0.012), FRONT);
    this.b = new Terminal(this, '오른쪽 단자', 'n', v(0.038, 0.02, 0.012), FRONT);
  }

  resistance(): number {
    return this.R;
  }
}

/** 저항 색 코드 (갈 빨 주 노 초 파 보 회 흰, 검 = 0) */
function colorBands(R: number): number[] {
  const C = [0x1a1a1a, 0x7a4a22, 0xc02a22, 0xe07a1a, 0xe8d02a, 0x2a9a3a, 0x2a4ad0, 0x8a3ac0, 0x8a8a8a, 0xf0f0f0];
  const e = Math.floor(Math.log10(R)) - 1;
  const d = Math.round(R / 10 ** e);
  return [C[Math.floor(d / 10)], C[d % 10], C[Math.max(0, e)], 0xc8a040]; // 마지막 금색 = 오차 5 %
}

/** 꼬마전구 3.8 V 0.3 A: 소켓 + 유리구 + 필라멘트. 필라멘트 온도에 따라 붉게 → 희게 빛난다 */
export class Bulb extends CircuitPart {
  readonly a: Terminal;
  readonly b: Terminal;
  readonly filament = new Filament(3.8, 0.3);
  private glow: THREE.MeshBasicMaterial;
  private glass: THREE.MeshLambertMaterial;
  private light: THREE.PointLight;

  constructor(name: string) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.08, 0.012, 0.05), BOARD, 0, 0.006, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.018, 8), METAL, 0, 0.021, 0)); // 소켓
    const glass = new THREE.MeshLambertMaterial({ color: 0xf0f0e8, transparent: true, opacity: 0.4, emissive: 0x000000, depthWrite: false });
    const bulb = mesh(new THREE.SphereGeometry(0.014, 10, 8), glass, 0, 0.044, 0);
    g.add(bulb);
    const glow = new THREE.MeshBasicMaterial({ color: 0x302820 });
    g.add(mesh(new THREE.BoxGeometry(0.008, 0.002, 0.002), glow, 0, 0.046, 0)); // 필라멘트
    super(g, { name, radius: 0.05, mass: 0.04, touchPad: false });
    this.glow = glow;
    this.glass = glass;
    this.light = new THREE.PointLight(0xffc070, 0, 1.4, 2);
    this.light.position.set(0, 0.046, 0);
    g.add(this.light);
    this.a = new Terminal(this, '왼쪽 단자', 'n', v(-0.03, 0.02, 0.012), FRONT);
    this.b = new Terminal(this, '오른쪽 단자', 'n', v(0.03, 0.02, 0.012), FRONT);
  }

  resistance(): number {
    return this.filament.R;
  }

  update(): void {
    // 밝기: 가시광 복사는 온도에 매우 민감 (대략 T^8 꼴) → 정격(2700 K)에서 1
    const T = this.filament.T;
    const b = T < 900 ? 0 : Math.min(1.6, ((T - 900) / 1800) ** 3);
    const c = new THREE.Color().setRGB(0.19 + b, 0.16 + 0.8 * b * Math.min(1, T / 2700), 0.12 + 0.55 * b * Math.min(1, (T / 2700) ** 3));
    this.glow.color.copy(c);
    this.glass.emissive.setRGB(0.9 * b, 0.65 * b, 0.3 * b);
    this.light.intensity = 0.9 * b;
  }
}

/**
 * 발광 다이오드(LED): 한쪽으로만 전류가 흐르는 pn 접합 + 직렬 저항 10 Ω
 *   I = I_s (e^{V_j/(nV_T)} − 1): 문턱(빨강 약 1.8 V) 아래에서는 거의 0, 넘으면 전압이 조금만 올라도 전류가 폭발적으로 는다
 *   → "전압을 너무 걸면 망가진다"의 정체는 전압이 아니라 이렇게 늘어나는 **전류(발열)**다. 그래서 LED에는 늘 직렬 저항을 단다.
 * 접합 온도: dT/dt = (P·R_th − (T − 25 °C)) / τ,  R_th 1000 K/W, τ 0.3 s. 150 °C를 넘으면 타서 끊어진다(열린 회로).
 *   정격 20 mA에서는 약 65 °C, 빨강은 대략 55 mA 이상을 계속 흘리면 탄다.
 * 문턱 전압 ≈ 빛알 에너지/e: 빨강(620 nm, 2.0 eV) < 초록(525 nm, 2.4 eV) < 파랑(465 nm, 2.7 eV)
 */
export class Led extends CircuitPart {
  static readonly RS = 10;
  static readonly N_VT = 2 * 0.02585;
  static readonly T_BURN = 150;
  readonly a: Terminal;
  readonly b: Terminal;
  readonly junction: Junction;
  burnt = false;
  /** 접합 온도 (°C) */
  Tj = 25;
  onBurn: (l: Led) => void = () => {};
  private dome: THREE.MeshLambertMaterial;
  private chip: THREE.MeshBasicMaterial;
  private light: THREE.PointLight;
  private readonly color: THREE.Color;

  /** @param vj20 20 mA에서의 접합 전압 (V) */
  constructor(readonly colorName: string, readonly nm: number, color: number, vj20: number) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.07, 0.012, 0.05), BOARD, 0, 0.006, 0));
    g.add(mesh(new THREE.BoxGeometry(0.0015, 0.02, 0.0015), METAL, -0.003, 0.02, 0)); // 다리
    g.add(mesh(new THREE.BoxGeometry(0.0015, 0.02, 0.0015), METAL, 0.003, 0.02, 0));
    const dome = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.75, emissive: 0x000000 });
    g.add(mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.01, 10), dome, 0, 0.034, 0));
    g.add(mesh(new THREE.SphereGeometry(0.0055, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), dome, 0, 0.039, 0));
    const chip = new THREE.MeshBasicMaterial({ color: 0x222222 });
    g.add(mesh(new THREE.BoxGeometry(0.003, 0.002, 0.003), chip, 0, 0.034, 0));
    super(g, { name: `LED ${colorName}`, radius: 0.045, mass: 0.02, touchPad: false });
    this.dome = dome;
    this.chip = chip;
    this.color = new THREE.Color(color);
    this.light = new THREE.PointLight(color, 0, 0.8, 2);
    this.light.position.set(0, 0.04, 0);
    g.add(this.light);
    this.junction = { a: 0, b: 0, Is: 0.02 / Math.exp(vj20 / Led.N_VT), nVt: Led.N_VT, vd: 0 };
    // 애노드(+, 긴 다리) · 캐소드(−)
    this.a = new Terminal(this, '+ (애노드)', '+', v(-0.022, 0.02, 0.012), FRONT);
    this.b = new Terminal(this, '− (캐소드)', '-', v(0.022, 0.02, 0.012), FRONT);
  }

  /** 옴 소자가 아님 — 회로 해석이 따로 다룬다 */
  resistance(): number | null {
    return null;
  }

  /** 정상 상태 I(V) (이론 곡선용): V = I·R_s + V_j */
  steadyCurrent(V: number): number {
    if (this.burnt || V <= 0) return 0;
    let lo = 0;
    let hi = V / Led.RS;
    for (let i = 0; i < 60; i++) {
      const I = (lo + hi) / 2;
      if (junctionCurrent(this.junction, V - I * Led.RS) > I) lo = I;
      else hi = I;
    }
    return (lo + hi) / 2;
  }

  heat(dt: number): void {
    if (this.burnt) {
      this.Tj += (25 - this.Tj) * Math.min(1, dt / 0.3);
      return;
    }
    const P = Math.max(0, this.voltage * this.current);
    this.Tj += ((P * 1000 - (this.Tj - 25)) / 0.3) * dt;
    if (this.Tj > Led.T_BURN) {
      this.burnt = true;
      this.current = 0;
      this.onBurn(this);
    }
  }

  replace(): void {
    this.burnt = false;
    this.Tj = 25;
    this.junction.vd = 0;
  }

  extraActions(): Action[] {
    const out = this.circuitActions();
    if (this.burnt) out.unshift({ label: '새 LED로 교체 (탄 LED 버리기)', run: () => this.replace() });
    return out;
  }

  update(): void {
    // 밝기 ∝ 전류 (20 mA에서 1)
    const b = this.burnt ? 0 : Math.min(1.5, Math.max(0, this.current) / 0.02);
    this.dome.emissive.copy(this.color).multiplyScalar(0.9 * b);
    this.chip.color.copy(this.burnt ? new THREE.Color(0x0a0a0a) : new THREE.Color(0x222222).lerp(new THREE.Color(0xffffff), Math.min(1, b)));
    this.dome.opacity = this.burnt ? 0.95 : 0.75;
    if (this.burnt) this.dome.color.setRGB(this.color.r * 0.25, this.color.g * 0.25, this.color.b * 0.25);
    else this.dome.color.copy(this.color);
    this.light.intensity = 0.25 * b;
  }
}

/** 칼날 스위치: 두 번 탭 → 닫기·열기 */
export class KnifeSwitch extends CircuitPart {
  readonly a: Terminal;
  readonly b: Terminal;
  closed = false;
  private blade: THREE.Object3D;

  constructor() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.1, 0.012, 0.05), BOARD, 0, 0.006, 0));
    g.add(mesh(new THREE.BoxGeometry(0.006, 0.016, 0.012), METAL, -0.03, 0.02, 0)); // 경첩 받침
    g.add(mesh(new THREE.BoxGeometry(0.006, 0.016, 0.012), METAL, 0.03, 0.02, 0)); // 날 받이
    const blade = new THREE.Group();
    blade.position.set(-0.03, 0.026, 0);
    blade.add(mesh(new THREE.BoxGeometry(0.066, 0.003, 0.008), METAL, 0.033, 0, 0));
    blade.add(mesh(new THREE.BoxGeometry(0.008, 0.02, 0.008), DARK, 0.066, 0.008, 0)); // 손잡이
    g.add(blade);
    super(g, { name: '스위치', radius: 0.06, mass: 0.06, touchPad: false });
    this.blade = blade;
    this.a = new Terminal(this, '왼쪽 단자', 'n', v(-0.042, 0.02, 0.014), FRONT);
    this.b = new Terminal(this, '오른쪽 단자', 'n', v(0.042, 0.02, 0.014), FRONT);
    this.set(false);
  }

  set(closed: boolean): void {
    this.closed = closed;
    this.blade.rotation.z = closed ? 0 : 1.0;
  }

  resistance(): number | null {
    return this.closed ? 0.001 : null;
  }

  extraActions(): Action[] {
    return [{ label: this.closed ? '스위치 열기' : '스위치 닫기', run: () => this.set(!this.closed) }, ...this.circuitActions()];
  }
}

/** 디지털 전압계 (±20 V, 0.001 V) — 내부 저항 10 MΩ */
export class Voltmeter extends CircuitPart {
  static readonly R_IN = 10e6;
  readonly a: Terminal;
  readonly b: Terminal;
  private lcd = new Lcd(0.1, 0.028);

  constructor(name: string) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.12, 0.08, 0.08), CASE, 0, 0.04, 0));
    g.add(mesh(new THREE.BoxGeometry(0.03, 0.012, 0.002), new THREE.MeshBasicMaterial({ color: 0x3a6fd0 }), 0.04, 0.072, 0.0405)); // V 표시 띠
    super(g, { name, radius: 0.07, mass: 0.35, touchPad: false });
    this.lcd.mesh.position.set(-0.01, 0.056, 0.0405);
    g.add(this.lcd.mesh);
    this.a = new Terminal(this, '+', '+', v(-0.025, 0.02, 0.04), FRONT);
    this.b = new Terminal(this, '−', '-', v(0.025, 0.02, 0.04), FRONT);
  }

  resistance(): number {
    return Voltmeter.R_IN;
  }

  /** 표시값 (V): + 단자 전위 − − 단자 전위 */
  get reading(): number {
    return this.voltage;
  }

  update(): void {
    const V = this.voltage;
    this.lcd.show(Math.abs(V) > 20 ? 'OL' : `${V.toFixed(3)} V`);
  }
}

/** 디지털 전류계 (±2 A, 0.1 mA) — 내부 저항 0.01 Ω */
export class Ammeter extends CircuitPart {
  static readonly R_IN = 0.01;
  readonly a: Terminal;
  readonly b: Terminal;
  private lcd = new Lcd(0.1, 0.028);

  constructor(name: string) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.12, 0.08, 0.08), CASE, 0, 0.04, 0));
    g.add(mesh(new THREE.BoxGeometry(0.03, 0.012, 0.002), new THREE.MeshBasicMaterial({ color: 0xc0302a }), 0.04, 0.072, 0.0405)); // A 표시 띠
    super(g, { name, radius: 0.07, mass: 0.35, touchPad: false });
    this.lcd.mesh.position.set(-0.01, 0.056, 0.0405);
    g.add(this.lcd.mesh);
    this.a = new Terminal(this, '+', '+', v(-0.025, 0.02, 0.04), FRONT);
    this.b = new Terminal(this, '−', '-', v(0.025, 0.02, 0.04), FRONT);
  }

  resistance(): number {
    return Ammeter.R_IN;
  }

  /** 표시값 (A): + 단자로 들어가 − 단자로 나오는 전류 */
  get reading(): number {
    return this.current;
  }

  update(): void {
    const I = this.current;
    this.lcd.show(Math.abs(I) > 2 ? 'OL' : `${(I * 1000).toFixed(1)} mA`);
  }
}

/** 전원 장치 하나가 이루는 회로의 해석 결과 (패널용) */
export interface DCCircuitState {
  supply: DCPowerSupply;
  /** 같은 회로(연결 요소)에 든 부품 */
  parts: CircuitPart[];
  /** 전원이 내보내는 전류 (A) · 단자 전압 (V) */
  current: number;
  terminalV: number;
  /** 정전류(전류 제한) 모드 */
  limited: boolean;
}

export const SUPPLY_R = 0.05;
export const SUPPLY_IMAX = 1.0;

/**
 * 매 프레임 회로 해석. 전구 필라멘트는 짧은 시간 간격으로 나눠 (풀기 → 가열) 되풀이한다
 * (켜는 순간 차가운 필라멘트에 큰 전류가 흘렀다가 빠르게 줄어드는 돌입 전류까지 나온다)
 */
export function solveDCCircuits(
  wires: WireSystem, supplies: DCPowerSupply[], parts: CircuitPart[], microammeters: Microammeter[], tubes: Phototube[], dt: number,
): DCCircuitState[] {
  const node = wires.nodeOf();
  const idx = new Map<Terminal, number>();
  const id = (t: Terminal) => {
    const r = node(t);
    if (!idx.has(r)) idx.set(r, idx.size);
    return idx.get(r)!;
  };
  // 연결 요소 (도선 + 부품 + 전원) — 광전관이 든 요소는 표시값을 건드리지 않는다
  const all: [Terminal, Terminal][] = [
    ...supplies.map((s) => [s.plus, s.minus] as [Terminal, Terminal]),
    ...parts.map((p) => [p.a, p.b] as [Terminal, Terminal]),
    ...microammeters.map((m) => [m.plus, m.minus] as [Terminal, Terminal]),
    ...tubes.map((t) => [t.anode, t.cathode] as [Terminal, Terminal]),
  ];
  for (const [a, b] of all) {
    id(a);
    id(b);
  }
  // LED마다 속 마디 하나 (애노드 ─ R_s ─ 속 마디 ─ 접합 ─ 캐소드)
  const leds = parts.filter((p): p is Led => p instanceof Led);
  const inner = new Map<Led, number>();
  for (const l of leds) inner.set(l, idx.size + inner.size);
  const n = idx.size + leds.length;
  const comp = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (comp[i] === i ? i : (comp[i] = find(comp[i])));
  for (const [a, b] of all) comp[find(id(a))] = find(id(b));
  const tubeComp = new Set(tubes.map((t) => find(id(t.anode))));
  const liveSupplies = supplies.filter((s) => s.on && s.port);

  const conductors = (): Conductor[] => {
    const out: Conductor[] = [];
    for (const p of parts) {
      const R = p.resistance();
      if (R !== null) out.push({ a: id(p.a), b: id(p.b), R });
    }
    for (const m of microammeters) out.push({ a: id(m.plus), b: id(m.minus), R: 0.01 });
    for (const l of leds) if (!l.burnt) out.push({ a: id(l.a), b: inner.get(l)!, R: Led.RS });
    return out;
  };
  const junctions = (): Junction[] => {
    const out: Junction[] = [];
    for (const l of leds) {
      if (l.burnt) continue;
      l.junction.a = inner.get(l)!;
      l.junction.b = id(l.b);
      out.push(l.junction);
    }
    return out;
  };
  const sources: Source[] = liveSupplies.map((s) => ({ a: id(s.plus), b: id(s.minus), E: s.output, r: SUPPLY_R, Imax: SUPPLY_IMAX }));

  const bulbs = parts.filter((p): p is Bulb => p instanceof Bulb);
  const steps = Math.max(1, Math.min(12, Math.ceil(dt / 0.004)));
  const ledCurrent = (l: Led, V: Float64Array) => (l.burnt ? 0 : (V[id(l.a)] - V[inner.get(l)!]) / Led.RS);
  let res = solveDC(n, conductors(), sources, junctions());
  for (let k = 0; k < steps; k++) {
    for (const b of bulbs) {
      const I = (res.V[id(b.a)] - res.V[id(b.b)]) / b.filament.R;
      b.filament.heat(I, dt / steps);
    }
    for (const l of leds) {
      l.voltage = res.V[id(l.a)] - res.V[id(l.b)];
      l.current = ledCurrent(l, res.V);
      l.heat(dt / steps);
    }
    res = solveDC(n, conductors(), sources, junctions());
  }

  for (const p of parts) {
    const c = find(id(p.a));
    const R = p.resistance();
    p.voltage = tubeComp.has(c) ? 0 : res.V[id(p.a)] - res.V[id(p.b)];
    p.current = tubeComp.has(c) ? 0 : p instanceof Led ? ledCurrent(p, res.V) : R === null ? 0 : p.voltage / R;
    p.inCircuit = false;
  }
  // 광전관이 없는 회로의 마이크로전류계는 여기서 채운다 (광전 효과 해석이 먼저 null로 비워 둠)
  for (const m of microammeters) {
    if (tubeComp.has(find(id(m.plus)))) continue;
    const I = (res.V[id(m.plus)] - res.V[id(m.minus)]) / 0.01;
    m.reading = Math.abs(I) > 1e-12 ? I : null;
  }

  const out: DCCircuitState[] = [];
  for (const s of supplies) {
    const c = find(id(s.plus));
    if (tubeComp.has(c)) continue;
    const k = liveSupplies.indexOf(s);
    const inComp = parts.filter((p) => find(id(p.a)) === c);
    if (!inComp.length) continue;
    for (const p of inComp) p.inCircuit = true;
    out.push({
      supply: s,
      parts: inComp,
      current: k < 0 ? 0 : res.sourceI[k],
      terminalV: res.V[id(s.plus)] - res.V[id(s.minus)],
      limited: k >= 0 && res.limited[k],
    });
  }
  return out;
}
