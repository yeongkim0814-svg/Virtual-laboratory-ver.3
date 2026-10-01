/**
 * 함수 발생기 · 오실로스코프 + 과도 회로 연결
 *
 * 함수 발생기: 사인 · 사각 · 삼각파, 1 Hz ~ 20 kHz, 진폭(최댓값) 0 ~ 10 V, 직류 오프셋 ±5 V. 출력 저항 50 Ω.
 * 오실로스코프: 2채널, 입력 1 MΩ. 화면 가로 10칸 × 세로 8칸.
 *
 * 땅(접지): 발생기의 COM과 오실로스코프의 GND는 콘센트 접지선에 이미 이어져 있다 (실제 실험실과 같음).
 *   → 둘은 같은 마디(0 V)다. 회로의 한쪽 끝을 COM이나 GND에 이어 주면 된다.
 *   → 프로브(CH)는 "땅에 대한 전위"를 잰다. 접지 단자에 엉뚱한 곳을 이으면 그 마디가 땅에 단락된다(실제 실수와 같음).
 *   → 저항 양끝의 전압처럼 땅에 닿지 않는 두 점의 차는 CH1, CH2를 각각 대고 눈으로 비교한다.
 *
 * 시간 규칙: 오실로스코프가 켜져 연결된 회로는 "한 번 훑는 시간(10칸 × 시간축)"의 2배씩 회로 시간이 나아가며
 *   (트리거를 찾을 앞부분 + 보여 줄 부분) 상태(축전기 전압·코일 전류)가 이어진다. 느린 시간축에서는 실제보다 빠르게,
 *   빠른 시간축에서는 느리게 진행하므로 실제 충전 시간은 시간축으로 읽는다. 축전기·코일이 든 회로는 오실로스코프가
 *   없으면 풀지 않는다 (직류 회로 패널은 축전기를 "끊김"으로, 코일을 "도선(R_L)"으로 본다).
 */
import * as THREE from 'three';
import { Item } from '../world/items';
import type { Action } from '../world/interactable';
import type { OutletPort, Powered } from '../world/power';
import { Terminal, type WireSystem } from '../world/wires';
import { Lcd, type DCPowerSupply } from './electrical';
import { Capacitor, Inductor, Led, RectDiode, SUPPLY_R, type CircuitPart } from './circuitParts';
import { Transient, waveform, type TC, type TD, type TElement, type TL, type Wave } from '../sim/transient';
import { findTrigger, measure, phaseLag, type ChMeasure } from '../sim/scopeAnalysis';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const CASE = new THREE.MeshLambertMaterial({ color: 0x8b8f86 });
const DARK = new THREE.MeshLambertMaterial({ color: 0x2e302c });
const FRONT = v(0, 0, 1);

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/** 세로 눈금 (V/칸) · 시간축 (s/칸): 1-2-5 순서 */
export const V_DIVS = [0.05, 0.1, 0.2, 0.5, 1, 2, 5];
export const T_DIVS = [20e-6, 50e-6, 100e-6, 200e-6, 500e-6, 1e-3, 2e-3, 5e-3, 10e-3, 20e-3, 50e-3, 100e-3, 200e-3, 500e-3];
export const WAVE_NAMES: Record<Wave, string> = { sine: '사인파', square: '사각파', triangle: '삼각파' };
export const GEN_F_MIN = 1;
export const GEN_F_MAX = 20000;
/** 화면에 보이는 표본 수 (가로 10칸) · 한 번 푸는 걸음 수 = 두 배 */
export const SCOPE_N = 2000;
const GEN_R_OUT = 50;
const PROBE_R = 1e6;

export function fmtFreq(f: number): string {
  return f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 2 : 3)} kHz` : `${f >= 100 ? f.toFixed(1) : f.toFixed(2)} Hz`;
}

export function fmtTime(t: number): string {
  const a = Math.abs(t);
  return a >= 1 ? `${t.toFixed(2)} s` : a >= 1e-3 ? `${(t * 1e3).toPrecision(3)} ms` : `${(t * 1e6).toPrecision(3)} μs`;
}

export function fmtVolt(x: number): string {
  const a = Math.abs(x);
  return a >= 1 ? `${x.toFixed(2)} V` : `${(x * 1000).toFixed(0)} mV`;
}

/** 함수 발생기 */
export class FuncGen extends Item implements Powered {
  on = false;
  wave: Wave = 'sine';
  freq = 1000;
  /** 최댓값 (V) · 직류 오프셋 (V) */
  amp = 2;
  offset = 0;
  readonly out: Terminal;
  readonly com: Terminal;
  readonly cordExit = v(0, 0.02, -0.08);
  readonly cordLength = 2.0;
  port: OutletPort | null = null;
  powerActions: (d: FuncGen) => Action[] = () => [];
  onOpenPanel: (g: FuncGen) => void = () => {};
  private lcd = new Lcd(0.1, 0.028);

  constructor(name = '함수 발생기') {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.22, 0.09, 0.16), CASE, 0, 0.045, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 10).rotateX(Math.PI / 2), DARK, 0.065, 0.062, 0.086)); // 손잡이
    g.add(mesh(new THREE.BoxGeometry(0.03, 0.008, 0.002), new THREE.MeshBasicMaterial({ color: 0xd8a02a }), 0.065, 0.082, 0.0805)); // 표시 띠
    super(g, { name, radius: 0.13, mass: 2.5, touchPad: false });
    this.lcd.mesh.position.set(-0.04, 0.062, 0.0805);
    g.add(this.lcd.mesh);
    this.out = new Terminal(this, 'OUT (출력)', '+', v(0.03, 0.025, 0.08), FRONT);
    this.com = new Terminal(this, 'COM (접지)', '-', v(0.075, 0.025, 0.08), FRONT);
  }

  /** 시각 t의 출력 전압 (V) */
  at(t: number): number {
    return waveform(this.wave, this.freq, this.amp, this.offset, t);
  }

  extraActions(): Action[] {
    const out: Action[] = [];
    if (this.port) out.push({ label: this.on ? '함수 발생기 끄기' : '함수 발생기 켜기', run: () => { this.on = !this.on; } });
    out.push(...this.powerActions(this));
    out.push({ label: '파형 조절', local: true, run: () => this.onOpenPanel(this) });
    return out;
  }

  experimentActions(): Action[] {
    return this.on ? [{ label: '함수 발생기 · 오실로스코프', local: true, run: () => this.onOpenPanel(this) }] : [];
  }

  update(): void {
    if (!this.port) this.on = false;
    this.lcd.show(this.on ? fmtFreq(this.freq) : '');
  }
}

/** 한 번 푼 결과 (동기화하지 않는 계산값) */
export interface ScopeSim {
  has: boolean;
  note: string;
  /** 새 파형이 계산될 때마다 +1 */
  seq: number;
  /** 표시 구간 표본 간격 (s) */
  dt: number;
  ch1: Float32Array;
  ch2: Float32Array;
  triggered: boolean;
  m1: ChMeasure;
  m2: ChMeasure;
  /** CH2가 CH1보다 늦는 각 (도) */
  phase: number | null;
  /** 이 회로에 든 함수 발생기 */
  gens: FuncGen[];
  lastRun: number;
  settled: number;
  /** 지난번 최댓값·최솟값 (CH1 최대, CH1 최소, CH2 최대, CH2 최소) — 정상 상태 판정용 */
  stats: number[];
  /** 풀이 구간의 부품별 평균 [전압, 전류] — 직류 해석이 매 프레임 0으로 덮어쓰므로 매 프레임 다시 적용한다 */
  means: Map<CircuitPart, [number, number]>;
  /** 기구 위 화면을 마지막으로 그린 상태 (기구의 단순 필드로 두면 되돌리기·스냅숏이 기록하므로 여기에) */
  drawn: string;
  key: string;
  simT: number;
}

const NO_M: ChMeasure = { vpp: 0, vmax: 0, vmin: 0, mean: 0, rms: 0, freq: null, period: null };

/** 오실로스코프 */
export class Oscilloscope extends Item implements Powered {
  on = false;
  /** 'yt' = 시간에 따른 전압, 'xy' = CH1(가로) 대 CH2(세로) */
  mode: 'yt' | 'xy' = 'yt';
  show1 = true;
  show2 = true;
  /** 세로 눈금 (V/칸) · 세로 위치 (칸) */
  vdiv1 = 1;
  vdiv2 = 1;
  pos1 = 0;
  pos2 = 0;
  /** 시간축 (s/칸) */
  tdiv = 1e-3;
  trigCh = 1;
  trigLevel = 0;
  trigRise = true;
  /** 화면 정지 */
  hold = false;
  readonly ch1: Terminal;
  readonly ch2: Terminal;
  readonly gnd: Terminal;
  readonly cordExit = v(0, 0.02, -0.11);
  readonly cordLength = 2.0;
  port: OutletPort | null = null;
  powerActions: (d: Oscilloscope) => Action[] = () => [];
  onOpenPanel: (s: Oscilloscope) => void = () => {};
  readonly sim: ScopeSim = {
    has: false, note: '', seq: 0, dt: 1e-6, ch1: new Float32Array(SCOPE_N), ch2: new Float32Array(SCOPE_N), triggered: false,
    m1: NO_M, m2: NO_M, phase: null, gens: [], lastRun: 0, settled: 0, stats: [0, 0, 0, 0], means: new Map(), drawn: '', key: '', simT: 0,
  };
  private screen: { ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture };

  constructor(name = '오실로스코프') {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.3, 0.19, 0.22), CASE, 0, 0.095, 0));
    g.add(mesh(new THREE.BoxGeometry(0.19, 0.14, 0.004), DARK, -0.02, 0.118, 0.111)); // 화면 테두리
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 128;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    g.add(mesh(new THREE.PlaneGeometry(0.175, 0.14 * 0.875), new THREE.MeshBasicMaterial({ map: tex }), -0.02, 0.118, 0.1135));
    g.add(mesh(new THREE.BoxGeometry(0.03, 0.006, 0.002), new THREE.MeshBasicMaterial({ color: 0xffd84a }), -0.095, 0.052, 0.111)); // CH1 띠
    g.add(mesh(new THREE.BoxGeometry(0.03, 0.006, 0.002), new THREE.MeshBasicMaterial({ color: 0x4adfff }), -0.045, 0.052, 0.111)); // CH2 띠
    super(g, { name, radius: 0.17, mass: 4, touchPad: false });
    this.screen = { ctx: c.getContext('2d')!, tex };
    this.ch1 = new Terminal(this, 'CH1', 'n', v(-0.095, 0.03, 0.11), FRONT);
    this.ch2 = new Terminal(this, 'CH2', 'n', v(-0.045, 0.03, 0.11), FRONT);
    this.gnd = new Terminal(this, 'GND (접지)', '-', v(0.07, 0.03, 0.11), FRONT);
    drawScope(this.screen.ctx, 160, 128, this, true);
  }

  extraActions(): Action[] {
    const out: Action[] = [];
    if (this.port) out.push({ label: this.on ? '오실로스코프 끄기' : '오실로스코프 켜기', run: () => { this.on = !this.on; } });
    out.push(...this.powerActions(this));
    out.push({ label: '오실로스코프 화면·조절', local: true, run: () => this.onOpenPanel(this) });
    return out;
  }

  experimentActions(): Action[] {
    return this.on ? [{ label: '오실로스코프 실험', local: true, run: () => this.onOpenPanel(this) }] : [];
  }

  update(): void {
    if (!this.port) this.on = false;
    const key = `${this.on}|${this.sim.seq}|${this.mode}|${this.show1}|${this.show2}|${this.vdiv1}|${this.vdiv2}|${this.pos1}|${this.pos2}|${this.trigLevel}|${this.trigCh}|${this.tdiv}`;
    if (key === this.sim.drawn) return;
    this.sim.drawn = key;
    drawScope(this.screen.ctx, 160, 128, this, true);
    this.screen.tex.needsUpdate = true;
  }
}

const COL1 = '#ffd84a';
const COL2 = '#4adfff';

export interface Cursors {
  /** 화면 가로·세로에 대한 비율 (0 ~ 1), 없으면 null */
  x: (number | null)[];
  y: (number | null)[];
}

/** 화면 그리기 (기구 위 작은 화면과 패널의 큰 화면이 같이 쓴다) */
export function drawScope(g: CanvasRenderingContext2D, w: number, h: number, sc: Oscilloscope, compact: boolean, cur?: Cursors): void {
  g.fillStyle = sc.on ? '#06140a' : '#0a0c0a';
  g.fillRect(0, 0, w, h);
  if (!sc.on) return;
  const cw = w / 10;
  const ch = h / 8;
  // 눈금: 10 × 8 칸, 가운데 십자는 더 밝게 + 눈금 점
  g.strokeStyle = '#1c4a2a';
  g.lineWidth = 1;
  g.beginPath();
  for (let i = 1; i < 10; i++) { g.moveTo(Math.round(i * cw) + 0.5, 0); g.lineTo(Math.round(i * cw) + 0.5, h); }
  for (let j = 1; j < 8; j++) { g.moveTo(0, Math.round(j * ch) + 0.5); g.lineTo(w, Math.round(j * ch) + 0.5); }
  g.stroke();
  g.strokeStyle = '#2f8a4a';
  g.beginPath();
  g.moveTo(Math.round(w / 2) + 0.5, 0); g.lineTo(Math.round(w / 2) + 0.5, h);
  g.moveTo(0, Math.round(h / 2) + 0.5); g.lineTo(w, Math.round(h / 2) + 0.5);
  g.stroke();
  const s = sc.sim;
  if (!s.has) {
    if (!compact) {
      g.fillStyle = '#8fd8a0';
      g.font = `${Math.round(h / 22)}px Galmuri11, monospace`;
      g.textAlign = 'center';
      g.fillText(s.note || '신호 없음', w / 2, h / 2 - 8);
      g.textAlign = 'left';
    }
    return;
  }
  const lw = compact ? 1.6 : Math.max(1.5, w / 320);
  if (sc.mode === 'xy') {
    g.strokeStyle = '#8fff9a';
    g.lineWidth = lw;
    g.beginPath();
    for (let i = 0; i < SCOPE_N; i++) {
      const x = w / 2 + (s.ch1[i] / sc.vdiv1) * cw;
      const y = h / 2 - (s.ch2[i] / sc.vdiv2) * ch;
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.stroke();
  } else {
    const trace = (data: Float32Array, vdiv: number, pos: number, color: string) => {
      const py = (val: number) => h / 2 - (val / vdiv + pos) * ch;
      g.strokeStyle = color;
      g.lineWidth = lw;
      g.beginPath();
      const per = SCOPE_N / w;
      if (per <= 1.5) {
        for (let i = 0; i < SCOPE_N; i++) {
          const x = (i / (SCOPE_N - 1)) * w;
          if (i) g.lineTo(x, py(data[i]));
          else g.moveTo(x, py(data[i]));
        }
      } else {
        // 한 화소에 표본이 여러 개: 위아래 끝(봉투)을 이어서 그린다 → 빠른 신호는 띠로 보인다
        for (let x = 0; x < w; x++) {
          const i0 = Math.floor(x * per);
          const i1 = Math.min(SCOPE_N, Math.floor((x + 1) * per));
          let lo = Infinity;
          let hi = -Infinity;
          for (let i = i0; i < i1; i++) { if (data[i] < lo) lo = data[i]; if (data[i] > hi) hi = data[i]; }
          const first = data[i0];
          const last = data[i1 - 1];
          if (!x) g.moveTo(0, py(first));
          g.lineTo(x + 0.5, py(first));
          if (first <= last) { g.lineTo(x + 0.5, py(lo)); g.lineTo(x + 0.5, py(hi)); } else { g.lineTo(x + 0.5, py(hi)); g.lineTo(x + 0.5, py(lo)); }
          g.lineTo(x + 0.5, py(last));
        }
      }
      g.stroke();
    };
    if (sc.show1) trace(s.ch1, sc.vdiv1, sc.pos1, COL1);
    if (sc.show2) trace(s.ch2, sc.vdiv2, sc.pos2, COL2);
    // 트리거 레벨 표시 (왼쪽 가장자리의 작은 삼각형)
    const tv = sc.trigCh === 1 ? sc.vdiv1 : sc.vdiv2;
    const tp = sc.trigCh === 1 ? sc.pos1 : sc.pos2;
    const ty = h / 2 - (sc.trigLevel / tv + tp) * ch;
    g.fillStyle = sc.trigCh === 1 ? COL1 : COL2;
    const a = compact ? 4 : 9;
    g.beginPath();
    g.moveTo(0, ty - a / 2); g.lineTo(a, ty); g.lineTo(0, ty + a / 2);
    g.fill();
  }
  if (cur) {
    g.setLineDash([4, 4]);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1;
    g.beginPath();
    for (const fx of cur.x) if (fx !== null) { g.moveTo(Math.round(fx * w) + 0.5, 0); g.lineTo(Math.round(fx * w) + 0.5, h); }
    for (const fy of cur.y) if (fy !== null) { g.moveTo(0, Math.round(fy * h) + 0.5); g.lineTo(w, Math.round(fy * h) + 0.5); }
    g.stroke();
    g.setLineDash([]);
  }
  if (!compact && sc.mode === 'yt' && !s.triggered) {
    g.fillStyle = '#ffb060';
    g.font = `${Math.round(h / 26)}px Galmuri11, monospace`;
    g.fillText('트리거 못 잡음 (자유 진행)', 8, h - 8);
  }
}

/** 이번 프레임의 회로 환경 */
export interface ScopeEnv {
  wires: WireSystem;
  scopes: Oscilloscope[];
  gens: FuncGen[];
  parts: CircuitPart[];
  supplies: DCPowerSupply[];
}

interface Track {
  part: CircuitPart;
  a: number;
  b: number;
  kind: 'R' | 'C' | 'L' | 'D';
  R: number;
  el: TElement | null;
  accV: number;
  accI: number;
}

/**
 * 켜진 오실로스코프마다 연결된 회로를 풀어 파형을 채운다 (프레임마다 부르되 내부에서 120 ms에 한 번만 푼다).
 * 풀이가 끝나면 부품의 전압·전류 표시값(직류 전압계·전류계)에 풀이 구간의 평균을 넣는다.
 */
export function updateScopes(env: ScopeEnv, nowMs: number): void {
  const claimed = new Set<CircuitPart>();
  for (const sc of env.scopes) {
    const s = sc.sim;
    if (!sc.on || !sc.port) {
      s.has = false;
      s.note = !sc.port ? '콘센트에 꽂혀 있지 않음' : '전원이 꺼져 있음';
      s.gens = [];
      s.key = '';
      s.means = new Map();
      continue;
    }
    // 직류 해석(solveDCCircuits)이 이 부품들의 전압·전류를 0으로 덮어쓴 뒤이므로, 지난 풀이의 평균을 매 프레임 다시 넣는다
    for (const [p, [vv, ii]] of s.means) { p.voltage = vv; p.current = ii; }
    if (nowMs - s.lastRun < 120 && s.lastRun) {
      continue;
    }
    run(sc, env, nowMs, claimed);
  }
}

function run(sc: Oscilloscope, env: ScopeEnv, nowMs: number, claimed: Set<CircuitPart>): void {
  const s = sc.sim;
  s.lastRun = nowMs;
  const node = env.wires.nodeOf();
  // 땅: 콘센트에 꽂힌 발생기의 COM · 오실로스코프의 GND
  const earth = new Set<Terminal>();
  for (const g of env.gens) if (g.port) earth.add(node(g.com));
  for (const o of env.scopes) if (o.port) earth.add(node(o.gnd));
  const ids = new Map<Terminal, number>();
  const id = (t: Terminal): number => {
    const r = node(t);
    if (earth.has(r)) return 0;
    if (!ids.has(r)) ids.set(r, ids.size + 1);
    return ids.get(r)!;
  };
  // 간선: 이 해석에 들어갈 수 있는 두 단자 소자
  interface Edge { a: number; b: number; part?: CircuitPart; gen?: FuncGen; sup?: DCPowerSupply }
  const edges: Edge[] = [];
  for (const p of env.parts) edges.push({ a: id(p.a), b: id(p.b), part: p });
  for (const g of env.gens) if (g.on && g.port) edges.push({ a: id(g.out), b: id(g.com), gen: g });
  for (const q of env.supplies) if (q.on && q.port) edges.push({ a: id(q.plus), b: id(q.minus), sup: q });
  // 프로브가 닿은 마디에서 이어진 모든 것 (땅은 모두 같은 마디라 허브)
  const probes = [sc.ch1, sc.ch2].filter((t) => t.wires.length > 0).map((t) => id(t));
  if (!probes.length) {
    s.has = false;
    s.note = '프로브(CH1 · CH2)를 회로에 도선으로 연결하세요';
    s.gens = [];
    s.key = '';
    s.means = new Map();
    return;
  }
  const comp = new Set<number>(probes);
  for (let changed = true; changed;) {
    changed = false;
    for (const e of edges) {
      if (comp.has(e.a) !== comp.has(e.b)) { comp.add(e.a); comp.add(e.b); changed = true; }
    }
  }
  const inComp = edges.filter((e) => comp.has(e.a) && comp.has(e.b));
  s.gens = inComp.filter((e) => e.gen).map((e) => e.gen!);
  const mine = inComp.filter((e) => e.part).map((e) => e.part!);
  if (mine.some((p) => claimed.has(p))) {
    s.has = false;
    s.note = '다른 오실로스코프가 같은 회로를 재고 있습니다';
    s.means = new Map();
    return;
  }
  for (const p of mine) claimed.add(p);
  // 마디 번호: 땅 0, 나머지 1, 2, …
  const loc = new Map<number, number>([[0, 0]]);
  const L = (g: number): number => {
    if (!loc.has(g)) loc.set(g, loc.size);
    return loc.get(g)!;
  };
  for (const e of inComp) { L(e.a); L(e.b); }
  const els: TElement[] = [];
  const tracks: Track[] = [];
  const sig: string[] = [];
  let extra = 0; // 코일·다이오드의 속 마디
  const tmpNode = () => 1000 + extra++;
  for (const e of inComp) {
    const a = L(e.a);
    const b = L(e.b);
    if (e.gen) {
      const g = e.gen;
      els.push({ kind: 'V', a, b, r: GEN_R_OUT, E: (t) => g.at(t), i: 0 });
      sig.push(`G${a}.${b}.${g.wave}.${g.freq}.${g.amp}.${g.offset}`);
    } else if (e.sup) {
      const E = e.sup.output;
      els.push({ kind: 'V', a, b, r: SUPPLY_R, E: () => E, i: 0 });
      sig.push(`S${a}.${b}.${E}`);
    } else if (e.part) {
      const p = e.part;
      if (p instanceof Capacitor) {
        const el: TC = { kind: 'C', a, b, C: p.C, v: p.vC, i: p.iC };
        els.push(el);
        tracks.push({ part: p, a, b, kind: 'C', R: 0, el, accV: 0, accI: 0 });
        sig.push(`C${a}.${b}.${p.C}`);
      } else if (p instanceof Inductor) {
        const m = tmpNode();
        const el: TL = { kind: 'L', a, b: m, L: p.L, v: p.vL, i: p.iL };
        els.push(el, { kind: 'R', a: m, b, R: p.Rl });
        tracks.push({ part: p, a, b, kind: 'L', R: p.Rl, el, accV: 0, accI: 0 });
        sig.push(`L${a}.${b}.${p.L}.${p.Rl}`);
      } else if ((p instanceof RectDiode || p instanceof Led) && !p.burnt) {
        const m = tmpNode();
        const el: TD = { kind: 'D', a: m, b, Is: p.junction.Is, nVt: p.junction.nVt, vd: p.junction.vd, i: 0 };
        els.push({ kind: 'R', a, b: m, R: p.rs }, el);
        tracks.push({ part: p, a, b, kind: 'D', R: p.rs, el, accV: 0, accI: 0 });
        sig.push(`D${a}.${b}.${p.junction.Is}`);
      } else if (!(p instanceof Led) && !(p instanceof RectDiode)) {
        const R = p.resistance();
        if (R !== null) {
          els.push({ kind: 'R', a, b, R });
          tracks.push({ part: p, a, b, kind: 'R', R, el: null, accV: 0, accI: 0 });
          sig.push(`R${a}.${b}.${R.toFixed(4)}`);
        }
      }
    }
  }
  // 오실로스코프 입력 저항 1 MΩ (프로브가 닿은 모든 채널)
  for (const o of env.scopes) {
    for (const t of [o.ch1, o.ch2]) {
      if (t.wires.length && comp.has(id(t))) els.push({ kind: 'R', a: L(id(t)), b: 0, R: PROBE_R });
    }
  }
  // 속 마디를 연속 번호로
  const remap = new Map<number, number>();
  let n = loc.size;
  for (const e of els) {
    for (const k of ['a', 'b'] as const) {
      if (e[k] >= 1000) {
        if (!remap.has(e[k])) remap.set(e[k], n++);
        e[k] = remap.get(e[k])!;
      }
    }
  }
  const ch1 = sc.ch1.wires.length ? L(id(sc.ch1)) : -1;
  const ch2 = sc.ch2.wires.length ? L(id(sc.ch2)) : -1;
  // 파라미터가 같고 파형이 변하지 않으면(정상 상태) 다시 풀지 않는다
  const key = [sc.tdiv, sc.trigCh, sc.trigLevel, sc.trigRise, ch1, ch2, sig.join(',')].join('|');
  if (key !== s.key) { s.key = key; s.settled = 0; }
  if (sc.hold || (s.settled >= 2 && s.has)) return;
  const sweep = 10 * sc.tdiv;
  const h = sweep / SCOPE_N;
  const total = 2 * SCOPE_N;
  const sim = new Transient(n, els);
  sim.t = s.simT;
  const f1 = new Float32Array(total);
  const f2 = new Float32Array(total);
  for (let k = 0; k < total; k++) {
    sim.step(h);
    f1[k] = ch1 >= 0 ? sim.V[ch1] : 0;
    f2[k] = ch2 >= 0 ? sim.V[ch2] : 0;
    for (const tr of tracks) {
      const vv = sim.V[tr.a] - sim.V[tr.b];
      tr.accV += vv;
      tr.accI += tr.kind === 'R' ? vv / tr.R : tr.kind === 'D' ? (tr.el as TD).i : (tr.el as TC | TL).i;
    }
  }
  s.simT = sim.t;
  // 부품 상태·표시값 되돌려 쓰기
  s.means = new Map(tracks.map((tr) => [tr.part, [tr.accV / total, tr.accI / total] as [number, number]]));
  for (const tr of tracks) {
    const p = tr.part;
    p.voltage = tr.accV / total;
    p.current = tr.accI / total;
    if (p instanceof Capacitor) { p.vC = (tr.el as TC).v; p.iC = (tr.el as TC).i; }
    else if (p instanceof Inductor) { p.vL = (tr.el as TL).v; p.iL = (tr.el as TL).i; }
    else if ((p instanceof RectDiode || p instanceof Led) && tr.el) p.junction.vd = (tr.el as TD).vd;
  }
  // 트리거: 앞 절반에서 찾는다
  const tch = sc.trigCh === 1 ? f1 : f2;
  const hasTrig = (sc.trigCh === 1 ? ch1 : ch2) >= 0;
  const idx = hasTrig ? findTrigger(tch, 1, SCOPE_N, sc.trigLevel, sc.trigRise) : -1;
  const start = idx >= 0 ? idx : 0;
  s.ch1.set(f1.subarray(start, start + SCOPE_N));
  s.ch2.set(f2.subarray(start, start + SCOPE_N));
  s.triggered = idx >= 0;
  s.dt = h;
  s.m1 = ch1 >= 0 ? measure(f1, h) : NO_M;
  s.m2 = ch2 >= 0 ? measure(f2, h) : NO_M;
  s.phase = ch1 >= 0 && ch2 >= 0 ? phaseLag(f1, f2, h, s.m1.period ?? s.m2.period) : null;
  // 정상 상태 판정: 트리거가 잡히고 두 채널의 최댓값·최솟값이 두 번 연속 거의 그대로면 더 풀지 않는다
  // (표본 위상이 달라 파형 전체를 비교하면 거의 늘 조금씩 다르므로 봉우리 높이로 본다)
  const stats = [s.m1.vmax, s.m1.vmin, s.m2.vmax, s.m2.vmin];
  const range = Math.max(1e-3, s.m1.vpp, s.m2.vpp);
  let diff = 0;
  for (let k = 0; k < 4; k++) diff = Math.max(diff, Math.abs(stats[k] - s.stats[k]));
  s.stats = stats;
  s.settled = s.has && s.triggered && diff < 2e-4 * range ? s.settled + 1 : 0;
  s.has = true;
  s.note = '';
  s.seq++;
}
