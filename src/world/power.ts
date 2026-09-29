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
import { FURNITURE } from './layout';

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

  actions(): Action[] {
    return this.getActions(this);
  }
}

const CORD_PTS = 24;

/**
 * 전원선 한 가닥. 실제 선처럼 놓이도록:
 *   기기 출구 → 기기가 놓인 면(책상 윗면)으로 내려옴 → 면 위를 따라 콘센트 쪽 가장자리까지
 *   → 가장자리에서 콘센트까지 아래로 처지며 늘어짐 (바닥 아래로는 내려가지 않음)
 */
class Cord {
  readonly line: THREE.Line;
  private pts = new Float32Array(3 * CORD_PTS);

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pts, 3));
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x8c8e88 }));
    this.line.raycast = () => {};
    this.line.frustumCulled = false;
    this.line.userData.noPick = true;
    scene.add(this.line);
  }

  set(a: THREE.Vector3, b: THREE.Vector3, restY: number): void {
    const path: THREE.Vector3[] = [a.clone()];
    const onTop = new THREE.Vector3(a.x, restY + 0.004, a.z);
    path.push(onTop);
    // 기기가 가구 윗면 위에 있으면: 콘센트 방향으로 그 면의 가장자리까지 면을 따라 간다
    const top = FURNITURE.find((f) => Math.abs(f.height - restY) < 0.03
      && a.x >= f.rect.x1 && a.x <= f.rect.x2 && a.z >= f.rect.z1 && a.z <= f.rect.z2);
    let hangFrom = onTop;
    if (top) {
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      // 광선 (a + t·d)이 직사각형을 빠져나가는 t
      const tx = dx > 0 ? (top.rect.x2 - a.x) / dx : dx < 0 ? (top.rect.x1 - a.x) / dx : Infinity;
      const tz = dz > 0 ? (top.rect.z2 - a.z) / dz : dz < 0 ? (top.rect.z1 - a.z) / dz : Infinity;
      const t = Math.min(tx, tz, 1);
      hangFrom = new THREE.Vector3(a.x + dx * t, restY + 0.004, a.z + dz * t);
      path.push(hangFrom);
    }
    // 가장자리 → 콘센트: 처지는 곡선
    const n = CORD_PTS - path.length;
    const sag = 0.3 * hangFrom.distanceTo(b);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const p = hangFrom.clone().lerp(b, t);
      p.y = Math.max(0.005, p.y - sag * 4 * t * (1 - t));
      path.push(p);
    }
    path.forEach((p, i) => p.toArray(this.pts, i * 3));
    (this.line.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
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
    if (!this.nearestFreePort(d)) return [{ label: `콘센트가 너무 멂 (전원선 ${d.cordLength} m)`, secondary: true, run: () => {} }];
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
      let root: THREE.Object3D = d.object;
      while (root.parent && root.parent.type !== 'Scene') root = root.parent;
      cord.set(a, b, root.getWorldPosition(new THREE.Vector3()).y);
    }
  }
}
