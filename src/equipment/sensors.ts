/**
 * 센서와 노트북 (측정 프로그램)
 *
 *   노트북: 센서를 USB 선(2 m)으로 최대 2개까지 연결. 화면에 실시간 값·그래프가 나오고,
 *           두 번 탭 → "측정 프로그램"으로 기록·분석 패널을 연다.
 *   운동 센서(초음파): 앞면(원형 진동판)에서 초음파를 쏘아 되돌아오는 시간으로 가장 가까운 물체까지의 거리를 잰다.
 *     거리 = 음속 × 왕복 시간 / 2. 측정 범위 0.15 ~ 3 m, 해상도 1 mm.
 *     이 시뮬레이션에서는 앞면 중심에서 정면으로 광선을 쏘아 처음 닿는 물체까지의 거리로 계산한다.
 *     (실제 센서는 약 15°의 원뿔로 퍼지므로 옆의 물체가 잡히기도 한다 — 여기서는 정면의 한 줄만 본다)
 *   레일 양 끝의 센서 받침에 끼우면 레일 방향을 정확히 바라본다.
 */
import * as THREE from 'three';
import { HITBOX_MAT, Item } from '../world/items';
import type { Action } from '../world/interactable';
import { Cable, endToEndPath, settle } from '../world/cable';
import type { Sample } from '../sim/logger';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

const HOUSING = new THREE.MeshLambertMaterial({ color: 0x3f5f7a });
const GRILLE = new THREE.MeshLambertMaterial({ color: 0x9a8c6a });
const BLACK = new THREE.MeshLambertMaterial({ color: 0x1e1f20 });
const SHELL = new THREE.MeshLambertMaterial({ color: 0x55585c });
const LED_ON = new THREE.MeshBasicMaterial({ color: 0x5cff6a });
const LED_OFF = new THREE.MeshLambertMaterial({ color: 0x224422 });

export const USB_LENGTH = 2.0;
export const MOTION_MIN = 0.15;
export const MOTION_MAX = 3.0;

export class MotionSensor extends Item {
  laptop: Laptop | null = null;
  /** 기록 (노트북이 채움) */
  samples: Sample[] = [];
  /** 지금 잰 거리 (m, 범위 밖이면 null) */
  reading: number | null = null;
  /** 센서가 끼워진 레일의 재생 속도 (1 = 실제 시간) — 노트북이 시간 흐름에 쓴다 */
  timeScale: () => number = () => 1;
  linkActions: (s: MotionSensor) => Action[] = () => [];
  readonly face = v(0, 0.03, 0.026); // 진동판 중심 (물체 좌표)
  readonly cordExit = v(0, 0.03, -0.026);
  private led: THREE.Mesh;
  private ray = new THREE.Raycaster();

  constructor(name: string) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.07, 0.06, 0.05), HOUSING, 0, 0.03, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.004, 12).rotateX(Math.PI / 2), GRILLE, 0, 0.03, 0.026));
    g.add(mesh(new THREE.TorusGeometry(0.022, 0.003, 4, 12), BLACK, 0, 0.03, 0.027));
    const led = mesh(new THREE.BoxGeometry(0.006, 0.006, 0.004), LED_OFF, 0.028, 0.052, 0.026);
    g.add(led);
    super(g, {
      name, radius: 0.045, mass: 0.2,
      // 레일 끝 받침에 끼울 때: 뒷면 중심이 받침에 오고 앞면이 받침의 +x(레일 가운데)를 향한다
      plugs: [{ type: 'sensorMount', point: v(0, 0.03, -0.025), rotY: Math.PI / 2 }],
    });
    this.led = led;
  }

  extraActions(): Action[] {
    return this.linkActions(this);
  }

  /** 레일 끝 받침에 끼워져 있으면 돌리지 않는다 (레일 방향을 정확히 바라봄) */
  rotateAction(): Action[] {
    return this.attachedTo ? [] : super.rotateAction();
  }

  /** 앞면 중심(월드)과 바라보는 방향 */
  facePose(): { origin: THREE.Vector3; dir: THREE.Vector3 } {
    this.object.updateWorldMatrix(true, false);
    return {
      origin: this.object.localToWorld(this.face.clone()),
      dir: new THREE.Vector3(0, 0, 1).transformDirection(this.object.matrixWorld),
    };
  }

  /** 정면으로 가장 가까운 물체까지 거리 (1 mm 단위). 범위 밖이면 null */
  measure(scene: THREE.Scene): number | null {
    const { origin, dir } = this.facePose();
    this.ray.set(origin, dir);
    this.ray.near = 0.001;
    this.ray.far = MOTION_MAX + 0.5;
    const hit = this.ray.intersectObjects(scene.children, true).find((h) => {
      const m = h.object as THREE.Mesh;
      if (!m.isMesh || m.material === HITBOX_MAT) return false;
      for (let o: THREE.Object3D | null = m; o; o = o.parent) {
        if (!o.visible || o.userData.noPick || o === this.object) return false;
      }
      return true;
    });
    if (!hit || hit.distance < MOTION_MIN || hit.distance > MOTION_MAX) return null;
    return Math.round(hit.distance * 1000) / 1000;
  }

  setLed(on: boolean): void {
    this.led.material = on ? LED_ON : LED_OFF;
  }
}

/** 노트북 한 대의 측정 프로그램 상태 */
export class Laptop extends Item {
  readonly sensors: MotionSensor[] = [];
  readonly maxSensors = 2;
  recording = false;
  /** 기록 시각 (s) — 레일을 느리게 돌리면 그만큼 느리게 흐른다 (실험 속 시간) */
  clock = 0;
  rate = 20; // Hz
  duration = 10; // s (0 = 무제한)
  onOpenPanel: (l: Laptop) => void = () => {};
  readonly portLocal = v(0.155, 0.009, 0.03);
  private acc = 0;
  private screenCanvas = document.createElement('canvas');
  private screenTex: THREE.CanvasTexture;
  private drawTimer = 0;

  constructor(name: string) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.3, 0.018, 0.21), SHELL, 0, 0.009, 0)); // 본체
    g.add(mesh(new THREE.BoxGeometry(0.26, 0.001, 0.09), BLACK, 0, 0.0185, -0.035)); // 자판
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 160;
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    // 화면: 뒤쪽 모서리를 축으로 약 105° 열림
    const lid = new THREE.Group();
    lid.position.set(0, 0.018, -0.105);
    lid.rotation.x = -0.26;
    lid.add(mesh(new THREE.BoxGeometry(0.3, 0.2, 0.008), SHELL, 0, 0.1, 0));
    const screen = mesh(new THREE.PlaneGeometry(0.27, 0.169), new THREE.MeshBasicMaterial({ map: tex }), 0, 0.1, 0.0045);
    lid.add(screen);
    g.add(lid);
    g.add(mesh(new THREE.BoxGeometry(0.004, 0.006, 0.014), BLACK, 0.151, 0.009, 0.03)); // USB 구멍
    super(g, { name, radius: 0.17, mass: 1.6, touchPad: false });
    this.screenCanvas = canvas;
    this.screenTex = tex;
    this.drawScreen();
  }

  extraActions(): Action[] {
    return [
      { label: '측정 프로그램 열기', run: () => this.onOpenPanel(this) },
      ...(this.sensors.length ? [{ label: this.recording ? '기록 멈추기' : '기록 시작', run: () => (this.recording ? this.stop() : this.start()) }] : []),
    ];
  }

  experimentActions(): Action[] {
    return this.sensors.length && this.object.parent?.type === 'Scene' ? [{ label: `측정 프로그램 · ${this.name}`, run: () => this.onOpenPanel(this) }] : [];
  }

  /** USB 구멍 (월드)과 구멍이 향한 방향 */
  portPose(): { p: THREE.Vector3; dir: THREE.Vector3 } {
    this.object.updateWorldMatrix(true, false);
    return { p: this.object.localToWorld(this.portLocal.clone()), dir: new THREE.Vector3(1, 0, 0).transformDirection(this.object.matrixWorld) };
  }

  start(): void {
    for (const s of this.sensors) s.samples = [];
    this.clock = 0;
    this.acc = 1 / this.rate; // 시작하자마자 첫 점
    this.recording = true;
  }

  stop(): void {
    this.recording = false;
  }

  /** 매 프레임: 센서 값 읽기, 기록 중이면 표본 간격마다 저장, 화면 갱신 */
  update(dt: number, scene: THREE.Scene): void {
    // 이번 프레임에 움직인 물체(수레 등)의 월드 좌표를 먼저 갱신 — 안 하면 한 프레임 전 위치를 재게 된다
    if (this.sensors.length) scene.updateMatrixWorld();
    for (const s of this.sensors) s.reading = s.measure(scene);
    if (this.recording) {
      const scale = this.sensors[0]?.timeScale() ?? 1;
      const d = Math.min(dt, 0.1) * scale;
      this.clock += d;
      this.acc += d;
      const step = 1 / this.rate;
      if (this.acc >= step) {
        this.acc = Math.min(this.acc - step, step); // 프레임이 늦으면 한 번에 한 점만
        for (const s of this.sensors) s.samples.push({ t: this.clock, x: s.reading });
      }
      if (this.duration > 0 && this.clock >= this.duration) this.recording = false;
    }
    if ((this.drawTimer -= dt) <= 0) {
      this.drawTimer = 0.2;
      this.drawScreen();
    }
  }

  /** 노트북 화면: 연결된 센서의 실시간 값 + 첫 센서의 x–t 그래프 (레트로 픽셀) */
  private drawScreen(): void {
    const g = this.screenCanvas.getContext('2d')!;
    const W = 256;
    const H = 160;
    g.fillStyle = '#0d1a14';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#1f3a2c';
    g.fillRect(0, 0, W, 16);
    g.fillStyle = '#9dffb8';
    g.font = 'bold 11px monospace';
    g.fillText(`LAB LOGGER  ${this.recording ? '● REC' : ''}`, 6, 12);
    if (!this.sensors.length) {
      g.fillText('센서 없음 — USB 연결 대기', 10, 50);
    } else {
      this.sensors.forEach((s, i) => {
        g.fillText(`${s.name}: ${s.reading === null ? '범위 밖' : `${s.reading.toFixed(3)} m`}`, 8, 32 + i * 14);
      });
      const pts = this.sensors[0].samples.filter((p) => p.x !== null) as { t: number; x: number }[];
      const top = 34 + this.sensors.length * 14;
      g.strokeStyle = '#2f5a44';
      g.strokeRect(6, top, W - 12, H - top - 6);
      if (pts.length > 1) {
        const t1 = Math.max(pts[pts.length - 1].t, 1);
        let lo = Infinity;
        let hi = -Infinity;
        for (const p of pts) {
          lo = Math.min(lo, p.x);
          hi = Math.max(hi, p.x);
        }
        if (hi - lo < 0.02) { lo -= 0.01; hi += 0.01; }
        g.fillStyle = '#9dffb8';
        for (const p of pts) {
          const x = 7 + (p.t / t1) * (W - 15);
          const y = H - 7 - ((p.x - lo) / (hi - lo)) * (H - top - 9);
          g.fillRect(Math.round(x), Math.round(y), 2, 2);
        }
      }
    }
    this.screenTex.needsUpdate = true;
  }
}

/** 센서 ↔ 노트북 USB 연결과 선 그리기 */
export class SensorNetwork {
  private cables = new Map<MotionSensor, { cable: Cable; pts: THREE.Vector3[] }>();

  constructor(private scene: THREE.Scene, readonly laptops: Laptop[], readonly sensors: MotionSensor[]) {
    for (const s of sensors) s.linkActions = (x) => this.actionsFor(x);
  }

  private nearestLaptop(s: MotionSensor): Laptop | null {
    const p = s.object.localToWorld(s.cordExit.clone());
    let best: Laptop | null = null;
    let bestD = USB_LENGTH;
    for (const l of this.laptops) {
      if (l.sensors.length >= l.maxSensors || l.object.parent?.type !== 'Scene') continue;
      const d = l.portPose().p.distanceTo(p);
      if (d < bestD) { bestD = d; best = l; }
    }
    return best;
  }

  actionsFor(s: MotionSensor): Action[] {
    if (s.laptop) return [{ label: `노트북 연결 끊기 (${s.laptop.name})`, secondary: true, run: () => this.disconnect(s) }];
    const l = this.nearestLaptop(s);
    return l
      ? [{ label: `노트북에 연결 · ${l.name}`, run: () => this.connect(s, l) }]
      : [{ label: `노트북이 너무 멂 (USB ${USB_LENGTH} m)`, secondary: true, run: () => {} }];
  }

  connect(s: MotionSensor, l: Laptop): void {
    this.disconnect(s);
    s.laptop = l;
    l.sensors.push(s);
    s.setLed(true);
    const c = { cable: new Cable(80, 0.0035, 0x2b2d30), pts: Array.from({ length: 80 }, () => new THREE.Vector3()) };
    this.scene.add(c.cable.mesh);
    this.cables.set(s, c);
  }

  disconnect(s: MotionSensor): void {
    const l = s.laptop;
    if (l) l.sensors.splice(l.sensors.indexOf(s), 1);
    s.laptop = null;
    s.setLed(false);
    const c = this.cables.get(s);
    c?.cable.mesh.removeFromParent();
    this.cables.delete(s);
  }

  /** 매 프레임: 너무 멀어지면 빠지고, 선을 다시 그린다 */
  update(): void {
    for (const [s, c] of this.cables) {
      const l = s.laptop!;
      s.object.updateWorldMatrix(true, false);
      const a = s.object.localToWorld(s.cordExit.clone());
      const fa = new THREE.Vector3(0, 0, -1).transformDirection(s.object.matrixWorld);
      const { p, dir } = l.portPose();
      if (a.distanceTo(p) > USB_LENGTH) {
        this.disconnect(s);
        continue;
      }
      settle(endToEndPath(a, fa, p, dir, 0.005), c.pts, 0.005);
      c.cable.setPoints(c.pts);
    }
  }
}
