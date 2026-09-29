/**
 * 전원: 콘센트와 전원선
 *
 * - 콘센트(Outlet): 실험 테이블의 빈 옆면에 붙은 2구 콘센트. 구멍(port)마다 기기 하나.
 * - 전원이 필요한 기기(Powered): 전원선 길이(cordLength)와 선이 나오는 점(cordExit)을 가진다.
 * - 연결: 기기를 탭해 "전원 연결" → 전원선이 닿는(거리 ≤ 선 길이) 가장 가까운 빈 구멍에 꽂힌다.
 *         콘센트를 탭해도 주변 기기를 골라 꽂을 수 있다.
 * - 기기를 선 길이보다 멀리 옮기면 플러그가 빠진다.
 * 레이저뿐 아니라 앞으로 추가할 전원 장치·전류계 등도 Powered만 따르면 그대로 쓸 수 있다.
 */
import * as THREE from 'three';
import type { Action, Interactable } from './interactable';
import { Cable, cablePath, settle, surfaceBelow } from './cable';

export interface Powered {
  readonly name: string;
  readonly object: THREE.Object3D;
  /** 전원선이 나오는 점 (물체 좌표) */
  readonly cordExit: THREE.Vector3;
  /** 전원선 길이 (m) */
  readonly cordLength: number;
  /** 꽂혀 있는 콘센트 구멍 (없으면 null) */
  port: OutletPort | null;
}

export class OutletPort {
  device: Powered | null = null;
  constructor(readonly outlet: Outlet, readonly local: THREE.Vector3) {}

  worldPosition(): THREE.Vector3 {
    this.outlet.object.updateWorldMatrix(true, false);
    return this.outlet.object.localToWorld(this.local.clone());
  }
}

const PLATE = new THREE.MeshLambertMaterial({ color: 0xd8d4c4 });
const HOLE = new THREE.MeshBasicMaterial({ color: 0x1a1a18 });

/** 2구 콘센트. object의 +z가 벽(테이블 옆면) 밖을 향한다 */
export class Outlet implements Interactable {
  readonly object = new THREE.Group();
  readonly ports: OutletPort[];
  /** 전원 시스템이 넣어 줌: 이 콘센트 근처의 기기 목록 동작 */
  getActions: (o: Outlet) => Action[] = () => [];

  constructor(position: THREE.Vector3, facing: THREE.Vector3) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.13, 0.015), PLATE);
    plate.position.z = 0.0075;
    this.object.add(plate);
    this.ports = [0.032, -0.032].map((y) => {
      // 구멍 두 개짜리 원형 소켓 (한국식 220 V)
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.018, 10), new THREE.MeshLambertMaterial({ color: 0xc4c0b0 }));
      face.position.set(0, y, 0.0155);
      this.object.add(face);
      for (const dx of [-0.009, 0.009]) {
        const hole = new THREE.Mesh(new THREE.CircleGeometry(0.0035, 6), HOLE);
        hole.position.set(dx, y, 0.016);
        this.object.add(hole);
      }
      return new OutletPort(this, new THREE.Vector3(0, y, 0.02));
    });
    this.object.position.copy(position);
    this.object.lookAt(position.clone().add(facing)); // +z를 facing 방향으로
  }

  /** 콘센트 면이 향한 방향 (월드) */
  facing(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, 1).applyQuaternion(this.object.quaternion);
  }

  actions(): Action[] {
    return this.getActions(this);
  }
}

const CORD_PTS = 140; // 점 간격이 3 cm보다 촘촘하도록 (전원선 2 m + 경로)

/**
 * 전원선 한 가닥. 실제 선처럼 놓이도록:
 *   기기 출구 → 기기가 놓인 면(책상 윗면)으로 내려옴 → 면 위를 따라 콘센트 쪽 가장자리까지
 *   → 가장자리에서 콘센트까지 아래로 처지며 늘어짐 (바닥 아래로는 내려가지 않음)
 */
class Cord {
  private out = Array.from({ length: CORD_PTS }, () => new THREE.Vector3());
  private cable = new Cable(CORD_PTS, 0.0045, 0xc8cac2);
  readonly line = this.cable.mesh;

  constructor(scene: THREE.Scene) {
    scene.add(this.line);
  }

  /**
   * 전원선 경로: 기기 → (놓인 면으로 내려와) 면 위의 장비를 돌아 가장자리 → 가구를 돌아 늘어짐 → 콘센트
   * 콘센트는 실험대 상판(6 cm 튀어나옴) 아래 수납장 면에 있으므로, 플러그에서 먼저 10 cm 수평으로 나와
   * 상판 가장자리 바깥에서 오르내린다 (상판을 뚫지 않게).
   * @param a 기기의 전원선 출구, center 기기 중심 (출구에서 바깥으로 뻗을 방향을 정함)
   * @param restY 기기가 놓인 면의 높이 — null이면 손에 들고 있음 (손 아래 면으로 늘어진다)
   * @param b 콘센트 구멍, out 콘센트 면이 향한 방향
   */
  set(a: THREE.Vector3, center: THREE.Vector3, restY: number | null, b: THREE.Vector3, out: THREE.Vector3): void {
    const CLR = 0.005;
    const path: THREE.Vector3[] = [a.clone()];
    let S: number;
    let A: THREE.Vector3;
    if (restY === null) {
      S = surfaceBelow(a.x, a.z, a.y);
      A = new THREE.Vector3(a.x, S + CLR, a.z);
    } else {
      S = restY;
      const dir = new THREE.Vector3(a.x - center.x, 0, a.z - center.z);
      if (dir.lengthSq() < 1e-8) dir.set(1, 0, 0);
      const a1 = a.clone().addScaledVector(dir.normalize(), 0.03);
      path.push(a1);
      A = new THREE.Vector3(a1.x, Math.min(a1.y, S + CLR), a1.z);
    }
    const b1 = b.clone().addScaledVector(out, 0.1);
    path.push(...cablePath(A, S, b1, b1.y, CLR), b);
    settle(path, this.out, CLR);
    this.cable.setPoints(this.out);
    this.line.visible = true;
  }

  hide(): void {
    this.line.visible = false;
  }
}

export class PowerSystem {
  private cords = new Map<Powered, Cord>();

  constructor(private scene: THREE.Scene, readonly outlets: Outlet[], private devices: Powered[]) {
    for (const o of outlets) {
      o.object.userData.interactable = o;
      o.getActions = (outlet) => this.outletActions(outlet);
      scene.add(o.object);
    }
  }

  /** 꽂혀 있는 전원선이 하나라도 있는가 */
  hasCords(): boolean {
    return [...this.cords.values()].some((c) => c.line.visible);
  }

  /** 기기의 전원선 출구 (월드) */
  private exitOf(d: Powered): THREE.Vector3 {
    d.object.updateWorldMatrix(true, false);
    return d.object.localToWorld(d.cordExit.clone());
  }

  /** 선이 닿는 가장 가까운 빈 구멍 */
  nearestFreePort(d: Powered): OutletPort | null {
    const p = this.exitOf(d);
    let best: OutletPort | null = null;
    let bestD = d.cordLength;
    for (const o of this.outlets) {
      for (const port of o.ports) {
        if (port.device) continue;
        const dist = port.worldPosition().distanceTo(p);
        if (dist <= bestD) { bestD = dist; best = port; }
      }
    }
    return best;
  }

  plug(d: Powered, port = this.nearestFreePort(d)): boolean {
    if (!port || port.device) return false;
    this.unplug(d);
    port.device = d;
    d.port = port;
    return true;
  }

  unplug(d: Powered): void {
    if (d.port) d.port.device = null;
    d.port = null;
  }

  /** 기기 쪽 동작: 전원 연결 / 뽑기 */
  deviceActions(d: Powered): Action[] {
    if (d.port) return [{ label: `전원 뽑기 · ${d.name}`, secondary: true, run: () => this.unplug(d) }];
    // 닿는 콘센트가 없으면 안내만 (보조 동작이라 짧은 탭의 "집기"를 방해하지 않음)
    if (!this.nearestFreePort(d)) return [{ label: `콘센트가 너무 멂 (전원선 ${d.cordLength} m)`, secondary: true, local: true, run: () => {} }];
    return [{ label: '전원 연결', run: () => this.plug(d) }];
  }

  private outletActions(outlet: Outlet): Action[] {
    const out: Action[] = [];
    for (const d of this.devices) {
      if (d.port?.outlet === outlet) out.push({ label: `플러그 뽑기 · ${d.name}`, run: () => this.unplug(d) });
    }
    for (const d of this.devices) {
      if (d.port) continue;
      const free = outlet.ports.find((p) => !p.device);
      if (free && free.worldPosition().distanceTo(this.exitOf(d)) <= d.cordLength) {
        out.push({ label: `꽂기 · ${d.name}`, run: () => this.plug(d, free) });
      }
    }
    return out;
  }

  /** 매 프레임: 너무 멀어진 플러그는 빠지고, 꽂힌 선을 다시 그린다 */
  update(): void {
    for (const d of this.devices) {
      let cord = this.cords.get(d);
      if (!d.port) {
        cord?.hide();
        continue;
      }
      const a = this.exitOf(d);
      const b = d.port.worldPosition();
      if (a.distanceTo(b) > d.cordLength) {
        this.unplug(d);
        cord?.hide();
        continue;
      }
      if (!cord) this.cords.set(d, (cord = new Cord(this.scene)));
      // 선이 놓일 면의 높이: 조립체 맨 아래(예: 클램프에 물렸으면 스탠드 밑판)가 놓인 곳
      // (손에 들고 있으면 카메라에 붙어 있으므로 장면까지 올라가다 카메라를 만나면 "들고 있음")
      let root: THREE.Object3D = d.object;
      let held = false;
      while (root.parent && root.parent.type !== 'Scene') {
        root = root.parent;
        if ((root as THREE.Camera).isCamera) held = true;
      }
      const center = d.object.getWorldPosition(new THREE.Vector3());
      cord.set(a, center, held ? null : root.getWorldPosition(new THREE.Vector3()).y, b, d.port.outlet.facing());
    }
  }
}
