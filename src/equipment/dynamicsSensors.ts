/**
 * 힘 센서 · 포토게이트 (노트북에 USB로 연결)
 *
 * 힘 센서: 레일 끝 받침에 끼운다. 레일 쪽으로 범퍼가 튀어나와 있고, 수레가 부딪히면 범퍼를 미는 힘을 잰다.
 *   1 kHz (1 ms마다)로 기록 — 충돌은 수십 ms라 운동 센서(수십 Hz)로는 모양을 볼 수 없다.
 *   범퍼: 용수철(부드러움, 충돌 약 0.1 s) / 고무(딱딱함, 약 0.025 s). 해상도 0.01 N, 잡음 약 ±0.02 N.
 * 포토게이트: 레일을 가로지르는 문 모양. 한쪽 기둥에서 적외선을 쏘고 다른 쪽이 받는다.
 *   수레 위 차단판(폭 2.0 cm)이 빛을 가린 시간 Δt → 그 순간의 속력 v = w/Δt. 0.01 ms 단위.
 * 두 센서 모두 궤도 시뮬레이션(sim/track.ts)이 0.5 ms 간격으로 계산한 값을 읽는다 — 레일 재생 속도를 늦추면 실험 속 시간으로 잰다.
 */
import * as THREE from 'three';
import type { Action } from '../world/interactable';
import { DataSensor } from './sensors';
import { FLAG_W, FORCE_BUMPER, type EndSensor, type ForceBumper, type GateBody, type TrackSim } from '../sim/track';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}
const BODY = new THREE.MeshLambertMaterial({ color: 0x3f7a5a });
const BLACK = new THREE.MeshLambertMaterial({ color: 0x1a1b19 });
const METAL = new THREE.MeshLambertMaterial({ color: 0x8c8f82 });
const BUMPER_COLOR: Record<ForceBumper, number> = { spring: 0xd8d8d0, rubber: 0x1c1c1a };
const LED_RED = new THREE.MeshBasicMaterial({ color: 0xff3a2a });
const LED_DIM = new THREE.MeshLambertMaterial({ color: 0x3a1a18 });

export interface ForceSample {
  t: number;
  F: number;
}

const FORCE_RATE = 1000; // Hz
const NOISE = 0.02; // N

export class ForceSensor extends DataSensor {
  /** 레일에 끼워졌을 때 레일이 채움: 궤도 시뮬레이션, 이 끝의 접촉, 맨 끝 수레 질량 */
  track: TrackSim | null = null;
  end: EndSensor | null = null;
  cartMass: number | null = null;
  bumper: ForceBumper = 'spring';
  samples: ForceSample[] = [];
  /** 지금 값 (N) */
  reading = 0;
  readonly cordExit = v(0, 0.05, -0.025);
  readonly cordDir = v(0, 1, 0);
  /** 범퍼 끝면 (물체 좌표): 받침(뒷면)에서 레일 쪽으로 11.5 cm */
  readonly tipLocal = v(0, 0.03, 0.09);
  private t0 = 0;
  private nextT = 0;
  private bumperMesh: THREE.Mesh;
  private coil: THREE.Mesh;

  constructor(name: string) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), BODY, 0, 0.03, 0)); // 몸체 (힘 측정 소자)
    g.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.04, 6).rotateX(Math.PI / 2), METAL, 0, 0.03, 0.045)); // 축
    const coil = mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.03, 8, 1, true).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: BUMPER_COLOR.spring, wireframe: true }), 0, 0.03, 0.07);
    g.add(coil);
    const bumper = mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.006, 10).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: BUMPER_COLOR.spring }), 0, 0.03, 0.087);
    g.add(bumper);
    const led = mesh(new THREE.BoxGeometry(0.006, 0.006, 0.004), BLACK, 0.018, 0.05, 0.026);
    g.add(led);
    super(g, {
      name, radius: 0.05, mass: 0.3,
      // 운동 센서와 같은 받침: 뒷면 중심이 받침에, 범퍼가 레일 가운데를 향함
      plugs: [{ type: 'sensorMount', point: v(0, 0.03, -0.025), rotY: Math.PI / 2 }],
    });
    this.led = led;
    this.bumperMesh = bumper;
    this.coil = coil;
    this.setBumper('spring');
  }

  setBumper(b: ForceBumper): void {
    this.bumper = b;
    (this.bumperMesh.material as THREE.MeshLambertMaterial).color.setHex(BUMPER_COLOR[b]);
    this.coil.visible = b === 'spring';
    this.bumperMesh.scale.set(1, 1, b === 'rubber' ? 3 : 1);
  }

  extraActions(): Action[] {
    const other: ForceBumper = this.bumper === 'spring' ? 'rubber' : 'spring';
    return [...super.extraActions(), { label: `범퍼 → ${FORCE_BUMPER[other].name}`, secondary: true, run: () => this.setBumper(other) }];
  }

  onDetached(s: Parameters<DataSensor['onDetached']>[0]): void {
    super.onDetached(s);
    this.track = null;
    this.end = null;
    this.cartMass = null;
  }

  rotateAction(): Action[] {
    return this.attachedTo ? [] : super.rotateAction();
  }

  /** 시뮬레이션이 쌓아 둔 (t, F)를 1 ms 간격으로 읽는다 */
  update(): void {
    const E = this.end;
    if (!E) {
      this.reading = 0;
      return;
    }
    const rec = !!this.laptop?.recording;
    for (const [t, F] of E.log) {
      if (t < this.nextT) continue;
      this.nextT = t + 1 / FORCE_RATE - 1e-9;
      const f = Math.round((F + (Math.random() + Math.random() + Math.random() - 1.5) * NOISE) * 100) / 100;
      this.reading = f;
      if (rec) this.samples.push({ t: t - this.t0, F: f });
    }
    E.log.length = 0;
    if (this.samples.length > 120000) this.samples.splice(0, 60000);
  }

  begin(): void {
    this.samples = [];
    this.t0 = this.track?.time ?? 0;
    this.nextT = this.t0;
    this.end?.log.splice(0);
  }

  record(): void {
    // 표본은 update()에서 1 kHz로 따로 쌓는다 (노트북의 표본 속도와 무관)
  }

  display(): string {
    if (!this.end) return '레일 끝 받침에 끼워져 있지 않음';
    return `${this.reading.toFixed(2)} N (${this.bumper === 'spring' ? '용수철' : '고무'} 범퍼)`;
  }

  screenPoints(): [number, number][] {
    const s = this.samples;
    const out: [number, number][] = [];
    for (let i = 0; i < s.length; i += 5) out.push([s[i].t, s[i].F]);
    return out;
  }
}

export interface GatePass {
  gate: string;
  /** 가리기 시작·끝 (기록 시작 기준, s) */
  on: number;
  off: number;
  /** v = w / Δt (m/s) */
  v: number;
}

export class Photogate extends DataSensor {
  track: TrackSim | null = null;
  gate: GateBody | null = null;
  readonly cordExit = v(0, 0.14, -0.068);
  readonly cordDir = v(0, 1, 0);
  private t0 = 0;
  private from = 0;
  private beamLed: THREE.Mesh;

  constructor(name: string) {
    const g = new THREE.Group();
    // 레일을 넘어가는 문: 기둥 두 개 (z = ±6.8 cm) + 윗가로대. 빛줄기는 레일 몸체 기준 높이 10 cm
    for (const z of [-0.068, 0.068]) {
      g.add(mesh(new THREE.BoxGeometry(0.03, 0.14, 0.014), BLACK, 0, 0.07, z));
      g.add(mesh(new THREE.BoxGeometry(0.012, 0.012, 0.008), METAL, 0, 0.1, z - Math.sign(z) * 0.011)); // 발광·수광부
    }
    g.add(mesh(new THREE.BoxGeometry(0.03, 0.014, 0.15), BLACK, 0, 0.147, 0));
    const led = mesh(new THREE.BoxGeometry(0.008, 0.006, 0.006), LED_DIM, 0, 0.157, 0);
    g.add(led);
    super(g, { name, radius: 0.08, mass: 0.2, plugs: [{ type: 'railGate', point: v(0, 0, 0) }] });
    this.beamLed = led;
  }

  onDetached(s: Parameters<DataSensor['onDetached']>[0]): void {
    super.onDetached(s);
    this.track = null;
    this.gate = null;
  }

  rotateAction(): Action[] {
    return this.attachedTo ? [] : super.rotateAction();
  }

  update(): void {
    this.beamLed.material = this.gate?.blocked ? LED_RED : LED_DIM;
  }

  begin(): void {
    this.t0 = this.track?.time ?? 0;
    this.from = this.gate?.passes.length ?? 0;
  }

  record(): void {}

  /** 기록 시작 뒤 끝난 가림들 (기록 중이 아니면 최근 것까지 모두) */
  passes(): GatePass[] {
    const g = this.gate;
    if (!g) return [];
    const start = Math.min(this.from, g.passes.length);
    return g.passes.slice(start).filter((p) => p.off !== null).map((p) => ({
      gate: this.name, on: p.on - this.t0, off: (p.off as number) - this.t0, v: FLAG_W / ((p.off as number) - p.on),
    }));
  }

  display(): string {
    if (!this.gate) return '레일에 끼워져 있지 않음';
    if (this.gate.blocked) return '빛이 가려짐';
    const last = this.gate.passes.filter((p) => p.off !== null).pop();
    if (!last) return '대기 (차단판이 지나가면 잰다)';
    const dt = (last.off as number) - last.on;
    return `Δt ${(dt * 1000).toFixed(2)} ms · v ${(FLAG_W / dt).toFixed(3)} m/s`;
  }

  screenPoints(): [number, number][] {
    return this.passes().map((p) => [p.on, p.v]);
  }
}
