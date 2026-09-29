/**
 * 보관장: 속이 빈 장 + 칸마다 여닫는 문 + 선반
 *
 * 장 자체의 좌표계(로컬)에서 만든 뒤 통째로 돌려서 방 안쪽을 보게 한다.
 *   로컬 x: 장의 가로(폭 W, −W/2 ~ +W/2),  로컬 z: 깊이(뒤 −D/2, 앞 +D/2),  로컬 y: 높이
 * 칸(section)은 폭 약 0.6 m. 앞쪽 몇 칸은 선반 없는 "긴 칸"(스탠드처럼 긴 기구용).
 * 일반 칸: 아래 불투명 문 + 위 유리문, 선반 높이 0.05 / 0.52 / 0.99 / 1.52 m
 */
import * as THREE from 'three';
import type { Action, Interactable } from './interactable';
import type { Rect } from './layout';
import { worldUV } from '../render/textures';

export interface CabinetMaterials {
  body: THREE.Material;
  door: THREE.Material;
  glass: THREE.Material;
  handle: THREE.Material;
}

const T = 0.02; // 판 두께
const SHELVES = [0.05, 0.52, 0.99, 1.52]; // 일반 칸 선반 윗면 높이
const TALL_SHELVES = [0.05, 1.52]; // 긴 칸
const OPEN = Math.PI / 2; // 문이 열리는 각도 (90° — 더 열면 옆 칸 앞을 가린다)

/** 경첩으로 돌아가는 보관장 문 한 짝 */
export class CabinetDoor implements Interactable {
  readonly object = new THREE.Group(); // 경첩 축
  private angle = 0;
  private target = 0;

  constructor(width: number, y1: number, y2: number, private hingeLeft: boolean, glass: boolean, m: CabinetMaterials) {
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(width - 0.006, y2 - y1, 0.018), glass ? m.glass : m.door);
    const s = hingeLeft ? 1 : -1; // 문짝이 경첩에서 뻗는 방향
    leaf.position.set((s * width) / 2, (y1 + y2) / 2, 0);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.1, 0.02), m.handle);
    handle.position.set(s * (width - 0.05), glass ? y1 + 0.14 : y2 - 0.14, 0.02);
    this.object.add(leaf, handle);
  }

  get isOpen(): boolean {
    return this.target !== 0;
  }

  actions(): Action[] {
    return [{ label: this.isOpen ? '보관장 문 닫기' : '보관장 문 열기', run: () => this.toggle() }];
  }

  toggle(): void {
    // 왼쪽 경첩은 −y축 방향(시계)으로, 오른쪽 경첩은 반대로 돌아야 바깥(+z)으로 열린다
    this.target = this.isOpen ? 0 : this.hingeLeft ? -OPEN : OPEN;
  }

  update(dt: number): void {
    const d = this.target - this.angle;
    const step = 4 * dt;
    this.angle = Math.abs(d) <= step ? this.target : this.angle + Math.sign(d) * step;
    this.object.rotation.y = this.angle;
  }
}

export class StorageCabinet {
  readonly group = new THREE.Group();
  readonly doors: CabinetDoor[] = [];
  private sections: { x0: number; x1: number; tall: boolean }[] = [];

  /**
   * @param rect 도면상 차지 영역
   * @param front 앞면이 향하는 방향 (axis 축의 sign 쪽)
   * @param tallCount 앞쪽(로컬 −x 끝)부터 긴 칸의 개수
   */
  constructor(rect: Rect, front: { axis: 'x' | 'z'; sign: 1 | -1 }, H: number, tallCount: number, m: CabinetMaterials) {
    const W = front.axis === 'x' ? rect.z2 - rect.z1 : rect.x2 - rect.x1;
    const D = front.axis === 'x' ? rect.x2 - rect.x1 : rect.z2 - rect.z1;
    // 로컬 +z(앞)를 세계의 앞 방향으로: y축 회전 θ는 (0,0,1) → (sinθ, 0, cosθ)
    this.group.rotation.y = front.axis === 'x' ? (front.sign * Math.PI) / 2 : front.sign > 0 ? 0 : Math.PI;
    this.group.position.set((rect.x1 + rect.x2) / 2, 0, (rect.z1 + rect.z2) / 2);

    const add = (x1: number, x2: number, y1: number, y2: number, z1: number, z2: number) => {
      const geo = new THREE.BoxGeometry(x2 - x1, y2 - y1, z2 - z1);
      const mesh = new THREE.Mesh(geo, m.body);
      mesh.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
      worldUV(geo, mesh.position);
      this.group.add(mesh);
    };
    const hw = W / 2;
    const hd = D / 2;
    add(-hw, hw, 0, H, -hd, -hd + T); // 뒤판
    add(-hw, -hw + T, 0, H, -hd, hd); // 옆판
    add(hw - T, hw, 0, H, -hd, hd);
    add(-hw, hw, H - T, H, -hd, hd); // 윗판
    add(-hw, hw, 0, SHELVES[0], -hd, hd); // 바닥 받침

    const n = Math.max(1, Math.round(W / 0.6));
    const w = W / n;
    for (let i = 0; i < n; i++) {
      const x0 = -hw + i * w;
      const x1 = x0 + w;
      const tall = i < tallCount;
      this.sections.push({ x0, x1, tall });
      if (i > 0) add(x0 - T / 2, x0 + T / 2, SHELVES[0], H - T, -hd + T, hd); // 칸막이
      for (const y of (tall ? TALL_SHELVES : SHELVES).slice(1)) add(x0, x1, y - T, y, -hd + T, hd - 0.01); // 선반

      // 문: 모든 칸이 왼쪽 경첩. (양문처럼 번갈아 달면 두 칸이 한 칸막이에 경첩을 같이 써서
      // 둘 다 열었을 때 문짝이 같은 자리로 돌아와 겹친다. 같은 쪽에 달면 열린 문짝끼리 칸 폭만큼 떨어진다)
      const hingeLeft = true;
      const hx = hingeLeft ? x0 : x1;
      const spans: [number, number, boolean][] = tall
        ? [[SHELVES[0] + 0.01, H - 0.04, true]]
        : [[SHELVES[0] + 0.01, 0.97, false], [1.0, H - 0.04, true]];
      for (const [y1, y2, glass] of spans) {
        const door = new CabinetDoor(w, y1, y2, hingeLeft, glass, m);
        door.object.position.set(hx, 0, hd + 0.011);
        this.group.add(door.object);
        this.doors.push(door);
      }
    }
  }

  /**
   * 선반 위의 한 지점 (세계 좌표) — 기구를 넣어 둘 자리
   * @param section 칸 번호 (0부터)
   * @param shelf 선반 번호 (0 = 바닥)
   * @param t 칸 안에서 가로 위치 (0 ~ 1)
   */
  slot(section: number, shelf: number, t = 0.5): THREE.Vector3 {
    const s = this.sections[section];
    const ys = s.tall ? TALL_SHELVES : SHELVES;
    const x = s.x0 + 0.06 + t * (s.x1 - s.x0 - 0.12);
    this.group.updateMatrixWorld(true);
    return this.group.localToWorld(new THREE.Vector3(x, ys[shelf], 0.02));
  }
}
