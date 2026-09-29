/**
 * 전기 기구: 직류 전원 장치, 마이크로전류계, 광전관 + 회로 해석
 *
 * 회로 해석 (광전 효과 실험용 직렬 고리)
 *   전원 장치 · 전류계 · 광전관이 도선으로 한 고리를 이루면 동작한다.
 *   - 이상적인 전류계는 저항 0 → 두 단자를 같은 전위로 본다.
 *   - 그러면 광전관의 양극·음극이 각각 전원 장치의 +·− 중 어디와 같은 전위인지로
 *     V_AK(양극 − 음극 전위)가 +V인지 −V인지(역전압) 정해진다. → 도선을 바꿔 꽂으면 역전압!
 *   - 전류계 부호: 전류(양극→음극, 관 안에서)가 음극에서 나와 고리를 따라 돌 때
 *     전류계의 + 단자로 들어가면 양수, − 단자로 들어가면 음수로 표시.
 */
import * as THREE from 'three';
import { Item } from '../world/items';
import type { Action } from '../world/interactable';
import type { OutletPort, Powered } from '../world/power';
import { Terminal, type WireSystem } from '../world/wires';
import { photoCurrent } from '../sim/photoelectric';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const CASE = new THREE.MeshLambertMaterial({ color: 0x8b8f86 });
const DARK = new THREE.MeshLambertMaterial({ color: 0x2e302c });
const FRONT = v(0, 0, 1);

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/** 작은 액정 표시창 (캔버스 텍스처, 바뀔 때만 다시 그림) */
class Lcd {
  readonly mesh: THREE.Mesh;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private text = '';

  constructor(w: number, h: number) {
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 24;
    this.ctx = c.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.magFilter = this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: this.tex }));
    this.show('');
  }

  show(text: string): void {
    if (text === this.text && text) return;
    this.text = text;
    const g = this.ctx;
    g.fillStyle = text ? '#1f3a24' : '#101410';
    g.fillRect(0, 0, 96, 24);
    g.fillStyle = '#9dff9a';
    g.font = '14px Galmuri11, monospace';
    g.textAlign = 'right';
    g.fillText(text, 92, 18);
    this.tex.needsUpdate = true;
  }
}

/**
 * 직류 전원 장치: 0 ~ 5 V, 극성 스위치. 콘센트에 꽂혀 있고 켜져 있어야 전압이 나온다.
 * 특정 실험 전용이 아닌 범용 기기 — 광전관이 회로에 있으면 광전 효과 패널도 열 수 있다.
 */
export class DCPowerSupply extends Item implements Powered {
  on = false;
  /** 설정 전압 크기 (V) */
  voltage = 0;
  /** 극성 스위치: true면 + 단자와 − 단자가 뒤바뀐 것처럼 동작 */
  reversed = false;
  readonly plus: Terminal;
  readonly minus: Terminal;
  readonly cordExit = v(0, 0.02, -0.07);
  readonly cordLength = 2.0;
  port: OutletPort | null = null;
  powerActions: (d: DCPowerSupply) => Action[] = () => [];
  onOpenPanel: (d: DCPowerSupply) => void = () => {};
  /** 범용 조절 패널 (어떤 실험에서든 전압 조절) */
  onOpenControls: (d: DCPowerSupply) => void = () => {};
  /** 광전관과 한 고리로 이어져 있는가 (main이 매 프레임 채움) */
  hasTube = false;
  private lcd = new Lcd(0.1, 0.028);

  constructor() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.18, 0.09, 0.14), CASE, 0, 0.045, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 8).rotateX(Math.PI / 2), DARK, 0.05, 0.06, 0.076)); // 전압 손잡이
    super(g, { name: '직류 전원 장치', radius: 0.11, mass: 2.0, touchPad: false });
    this.lcd.mesh.position.set(-0.03, 0.066, 0.0705);
    g.add(this.lcd.mesh);
    this.plus = new Terminal(this, '+', '+', v(-0.05, 0.025, 0.07), FRONT);
    this.minus = new Terminal(this, '−', '-', v(-0.015, 0.025, 0.07), FRONT);
  }

  /** 실제로 나오는 전압 (+ 단자 − − 단자), 꺼져 있으면 0 */
  get output(): number {
    if (!this.on || !this.port) return 0;
    return this.reversed ? -this.voltage : this.voltage;
  }

  extraActions(): Action[] {
    const out: Action[] = [];
    if (this.port) out.push({ label: this.on ? '전원 장치 끄기' : '전원 장치 켜기', run: () => { this.on = !this.on; } });
    out.push(...this.powerActions(this));
    out.push({ label: '전압 조절', run: () => this.onOpenControls(this) });
    return out;
  }

  experimentActions(): Action[] {
    return this.hasTube ? [{ label: '광전 효과 실험', run: () => this.onOpenPanel(this) }] : [];
  }

  update(): void {
    if (!this.port) this.on = false;
    this.lcd.show(this.on ? `${this.output.toFixed(2)} V` : '');
  }
}

/** 마이크로전류계 (µA): 저항 0인 이상적 전류계, 0.001 µA까지 표시 */
export class Microammeter extends Item {
  readonly plus: Terminal;
  readonly minus: Terminal;
  /** 표시값 (A), 회로 해석이 채운다. null = 고리에 들어 있지 않음 */
  reading: number | null = null;
  private lcd = new Lcd(0.1, 0.028);

  constructor() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.12, 0.08, 0.08), CASE, 0, 0.04, 0));
    super(g, { name: '마이크로전류계', radius: 0.07, mass: 0.4, touchPad: false });
    this.lcd.mesh.position.set(0, 0.056, 0.0405);
    g.add(this.lcd.mesh);
    this.plus = new Terminal(this, '+', '+', v(-0.025, 0.02, 0.04), FRONT);
    this.minus = new Terminal(this, '−', '-', v(0.025, 0.02, 0.04), FRONT);
  }

  update(): void {
    this.lcd.show(this.reading === null ? '0.000 µA' : `${(this.reading * 1e6).toFixed(3)} µA`);
  }
}

/** 광전관: 유리관 속 반원통 음극 + 가는 양극. 레이저 빛이 유리에 닿으면 음극에 빛이 들어간다 */
export class Phototube extends Item {
  readonly anode: Terminal;
  readonly cathode: Terminal;
  /** 이번 프레임에 받은 빛 (광선 추적이 채움) */
  light: { lambda: number; powerW: number } | null = null;

  constructor(readonly metal: string, /** 일함수 (eV) */ readonly W: number) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.015, 10), DARK, 0, 0.0075, 0)); // 받침
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.07, 10),
      new THREE.MeshLambertMaterial({ color: 0xcfe6e0, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    glass.position.y = 0.05;
    g.add(glass);
    // 음극: 빛이 들어오는 쪽(+x)을 향해 오목한 반원통
    const cath = new THREE.Mesh(
      new THREE.CylinderGeometry(0.019, 0.019, 0.055, 8, 1, true, Math.PI, Math.PI), // θ = π~2π → x < 0 쪽 반원 (빛 쪽으로 오목)
      new THREE.MeshLambertMaterial({ color: 0x9a8f6a, side: THREE.DoubleSide }),
    );
    cath.position.y = 0.05;
    g.add(cath);
    g.add(mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.05, 4), DARK, 0.008, 0.05, 0)); // 양극 선
    super(g, {
      name: `광전관 (${metal}, W = ${W} eV)`, radius: 0.04, mass: 0.1, touchPad: false,
      plugs: [{ type: 'grip', point: v(0, 0.05, 0) }],
    });
    // 단자는 받침 뒤쪽(−x)
    this.anode = new Terminal(this, '양극(+)', '+', v(-0.028, 0.008, 0.018), v(-1, 0, 0));
    this.cathode = new Terminal(this, '음극(−)', '-', v(-0.028, 0.008, -0.018), v(-1, 0, 0));
  }

  /** 양극 전위 − 음극 전위가 V일 때 관을 흐르는 전류 (A, 양극→음극) */
  current(V: number): number {
    return this.light ? photoCurrent(this.light.lambda, this.light.powerW, this.W, V) : 0;
  }
}

/** 광전 효과 회로 한 개의 해석 결과 */
export interface PhotoCircuitState {
  supply: DCPowerSupply;
  tube: Phototube | null;
  ammeter: Microammeter | null;
  /** 양극 − 음극 전위 (V) */
  vAK: number;
  /** 관을 흐르는 전류 (A) */
  current: number;
  /** 문제가 있으면 안내 문구 */
  problem: string | null;
}

/**
 * 회로 해석: 전원 장치마다 "전원 장치 – (전류계) – 광전관" 직렬 고리를 찾는다.
 * 결과는 전류계 표시값에 반영하고, 패널용으로 돌려준다.
 */
export function solveCircuits(wires: WireSystem, supplies: DCPowerSupply[], ammeters: Microammeter[], tubes: Phototube[]): PhotoCircuitState[] {
  // 이상적 전류계: 두 단자를 같은 마디로 본 뒤 전위 관계를 따진다
  const merged = wires.nodeOf(ammeters.map((a) => [a.plus, a.minus] as [Terminal, Terminal]));
  const raw = wires.nodeOf();
  for (const a of ammeters) a.reading = null;
  const out: PhotoCircuitState[] = [];

  for (const s of supplies) {
    const sp = merged(s.plus);
    const sm = merged(s.minus);
    const state: PhotoCircuitState = { supply: s, tube: null, ammeter: null, vAK: 0, current: 0, problem: null };
    out.push(state);
    if (sp === sm) {
      state.problem = s.plus.wires.length || s.minus.wires.length ? '전원 장치의 +와 −가 바로 이어짐 (단락)' : '전원 장치에 도선이 없음';
      continue;
    }
    // 이 전원 장치의 두 마디 사이에 걸친 광전관
    const tube = tubes.find((t) => {
      const a = merged(t.anode);
      const k = merged(t.cathode);
      return (a === sp && k === sm) || (a === sm && k === sp);
    });
    if (!tube) {
      state.problem = '광전관이 전원 장치와 한 고리로 이어지지 않음';
      continue;
    }
    state.tube = tube;
    state.vAK = merged(tube.anode) === sp ? s.output : -s.output;
    state.current = tube.current(state.vAK);

    // 고리 안의 전류계: 원래 마디 기준으로, 음극 쪽에서 전류가 들어오는 단자 찾기
    const NA = raw(tube.anode);
    const NK = raw(tube.cathode);
    for (const am of ammeters) {
      const x = raw(am.plus);
      const y = raw(am.minus);
      if (x === y) continue; // 전류계 자체가 단락됨
      let inT: Terminal | null = null;
      if (x === NK) inT = am.plus;
      else if (y === NK) inT = am.minus;
      else if (x === NA) inT = am.minus;
      else if (y === NA) inT = am.plus;
      if (!inT) continue;
      // 전류계가 전원 장치와 광전관 사이 고리에 있는지 (한쪽 단자는 전원 장치 마디와 이어져 있어야 함)
      const touchesSupply = [x, y].some((n) => n === raw(s.plus) || n === raw(s.minus));
      const touchesTube = [x, y].some((n) => n === NA || n === NK);
      if (!touchesSupply || !touchesTube) continue;
      am.reading = inT === am.plus ? state.current : -state.current;
      state.ammeter = am;
      break;
    }
    if (!state.ammeter) state.problem = '고리에 전류계가 없음 (전류를 읽을 수 없음)';
  }
  return out;
}
