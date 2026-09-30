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

/**
 * 경첩으로 돌아가는 보관장 문 한 짝
 * dropDown: 긴 기구(레일 등)용 칸의 가로로 긴 문 — 아래쪽 경첩으로 앞으로 젖혀 연다
 */
export class CabinetDoor implements Interactable {
  readonly object = new THREE.Group();
  private pivot = new THREE.Group(); // 경첩 축
  private angle = 0;
  private target = 0;

  constructor(width: number, y1: number, y2: number, private hingeLeft: boolean, glass: boolean, m: CabinetMaterials, private dropDown = false) {
    // 젖히는 문은 양옆을 3 cm씩 줄인다 — 열어 눕혔을 때 옆 칸 문(칸막이 자리에 경첩)과 닿지 않게
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(width - (dropDown ? 0.06 : 0.006), y2 - y1, 0.018), glass ? m.glass : m.door);
    this.object.add(this.pivot);
    if (dropDown) {
      // 경첩 = 아래 모서리. 손잡이는 위쪽 가운데에 가로로
      this.pivot.position.y = y1;
      leaf.position.set(width / 2, (y2 - y1) / 2, 0);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.015, 0.02), m.handle);
      handle.position.set(width / 2, y2 - y1 - 0.06, 0.02);
      this.pivot.add(leaf, handle);
      return;
    }
    const s = hingeLeft ? 1 : -1; // 문짝이 경첩에서 뻗는 방향
    leaf.position.set((s * width) / 2, (y1 + y2) / 2, 0);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.1, 0.02), m.handle);
    handle.position.set(s * (width - 0.05), glass ? y1 + 0.14 : y2 - 0.14, 0.02);
    this.pivot.add(leaf, handle);
  }

  get isOpen(): boolean {
    return this.target !== 0;
  }

  actions(): Action[] {
    return [{ label: this.isOpen ? '보관장 문 닫기' : '보관장 문 열기', run: () => this.toggle() }];
  }

  toggle(): void {
    // 왼쪽 경첩은 −y축 방향(시계)으로, 오른쪽 경첩은 반대로 돌아야 바깥(+z)으로 열린다.
    // 아래 경첩(젖히는 문)은 x축 둘레 +90° → 윗부분이 앞(+z)으로 내려온다
    this.target = this.isOpen ? 0 : this.dropDown ? OPEN : this.hingeLeft ? -OPEN : OPEN;
  }

  update(dt: number): void {
    const d = this.target - this.angle;
    const step = 4 * dt;
    this.angle = Math.abs(d) <= step ? this.target : this.angle + Math.sign(d) * step;
    if (this.dropDown) this.pivot.rotation.x = this.angle;
    else this.pivot.rotation.y = this.angle;
  }
}

/** 보관장 모양 선택 (없으면 실험 기구 보관장처럼 키 큰 장) */
export interface CabinetOptions {
  /** 칸 폭 목록 (합이 장의 폭). 없으면 약 0.6 m씩 같게 */
  sections?: number[];
  /** 일반 칸 선반 윗면 높이 (첫 값 = 바닥 받침) */
  shelves?: number[];
  /** 위쪽 유리문 없이 한 짝(불투명)짜리 문만 — 낮은 수납장 */
  solidDoors?: boolean;
  /** 문 윗끝 높이 (기본 H − 0.04) */
  doorTop?: number;
  /** 윗판을 만들지 (위에 따로 상판을 얹는 가구는 false) */
  top?: boolean;
  /** 문 전체가 유리 한 장 (속이 보이는 냉장고형 시약장) */
  glassDoors?: boolean;
  /** 긴 기구용 칸 번호: 가로로 긴 문 한 짝을 아래로 젖혀 연다 (레일처럼 긴 것) */
  longSections?: number[];
  /** 양문: 칸마다 문 두 짝을 양쪽 옆판·칸막이에 경첩으로 달아 가운데서 연다 (문짝 폭이 반이라 앞으로 덜 튀어나온다) */
  doubleDoors?: boolean;
}

export class StorageCabinet {
  readonly group = new THREE.Group();
  readonly doors: CabinetDoor[] = [];
  private sections: { x0: number; x1: number; ys: number[] }[] = [];
  private shelves: number[];

  /**
   * @param rect 도면상 차지 영역
   * @param front 앞면이 향하는 방향 (axis 축의 sign 쪽)
   * @param tallCount 앞쪽(로컬 −x 끝)부터 긴 칸의 개수
   */
  constructor(rect: Rect, front: { axis: 'x' | 'z'; sign: 1 | -1 }, H: number, tallCount: number, m: CabinetMaterials, o: CabinetOptions = {}) {
    const W = front.axis === 'x' ? rect.z2 - rect.z1 : rect.x2 - rect.x1;
    const D = front.axis === 'x' ? rect.x2 - rect.x1 : rect.z2 - rect.z1;
    this.shelves = o.shelves ?? SHELVES;
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
    const base = this.shelves[0];
    add(-hw, hw, 0, H, -hd, -hd + T); // 뒤판
    add(-hw, -hw + T, 0, H, -hd, hd); // 옆판
    add(hw - T, hw, 0, H, -hd, hd);
    if (o.top ?? true) add(-hw, hw, H - T, H, -hd, hd); // 윗판
    add(-hw, hw, 0, base, -hd, hd); // 바닥 받침

    let widths = o.sections;
    if (!widths) {
      const n = Math.max(1, Math.round(W / 0.6));
      widths = new Array(n).fill(W / n);
    }
    const scale = W / widths.reduce((a, b) => a + b, 0);
    let x0 = -hw;
    widths.forEach((w0, i) => {
      const w = w0 * scale;
      const x1 = x0 + w;
      const tall = i < tallCount;
      const long = o.longSections?.includes(i) ?? false;
      // 긴 칸(키 큰 칸: 스탠드 / 가로로 긴 칸: 레일)은 선반을 줄이거나 없앤다
      const ys = tall ? TALL_SHELVES : long ? [base] : this.shelves;
      this.sections.push({ x0, x1, ys });
      if (i > 0) add(x0 - T / 2, x0 + T / 2, base, H - T, -hd + T, hd); // 칸막이
      for (const y of ys.slice(1)) add(x0, x1, y - T, y, -hd + T, hd - 0.01); // 선반

      // 문: 모든 문이 왼쪽 경첩 (양문 옵션 제외). (양문처럼 번갈아 달면 두 칸이 한 칸막이에 경첩을 같이 써서
      // 둘 다 열었을 때 문짝이 같은 자리로 돌아와 겹친다. 같은 쪽에 달면 열린 문짝끼리 칸 폭만큼 떨어진다)
      // 넓은 칸은 폭 0.7 m 이하의 문 여러 짝으로 나눈다
      const top = o.doorTop ?? H - 0.04;
      const spans: [number, number, boolean][] = o.glassDoors
        ? [[base + 0.01, top, true]]
        : tall || o.solidDoors
        ? [[base + 0.01, top, !o.solidDoors && tall]]
        : [[base + 0.01, 0.97, false], [1.0, top, true]];
      const leaves = o.doubleDoors ? 2 : long ? 1 : Math.max(1, Math.ceil(w / 0.7));
      const lw = w / leaves;
      const last = i === widths.length - 1;
      for (let k = 0; k < leaves; k++) {
        // 양문의 오른쪽 짝은 오른쪽 칸막이에 경첩 → 두 짝이 가운데에서 양쪽으로 벌어진다.
        // 칸막이 하나에 이웃 칸 문과 경첩이 마주 붙으면, 열었을 때 두 문짝이 같은 자리로 돌아와 겹친다
        // → 칸막이 쪽 경첩은 칸 안쪽으로 3 cm씩 물려 단다 (열린 문짝 두 장과 서로 마주 보는 손잡이 사이에 틈)
        const right = !!o.doubleDoors && k === 1;
        const inset = !o.doubleDoors ? 0 : right ? (last ? 0 : 0.03) : i > 0 ? 0.03 : 0;
        for (const [y1, y2, glass] of spans) {
          const door = new CabinetDoor(lw - inset, y1, y2, !right, glass, m, long);
          door.object.position.set(right ? x1 - inset : x0 + k * lw + inset, 0, hd + 0.011);
          this.group.add(door.object);
          this.doors.push(door);
        }
      }
      x0 = x1;
    });
  }

  /**
   * 선반 위의 한 지점 (세계 좌표) — 기구를 넣어 둘 자리
   * @param section 칸 번호 (0부터)
   * @param shelf 선반 번호 (0 = 바닥)
   * @param t 칸 안에서 가로 위치 (0 ~ 1)
   */
  slot(section: number, shelf: number, t = 0.5): THREE.Vector3 {
    const s = this.sections[section];
    const ys = s.ys;
    const x = s.x0 + 0.06 + t * (s.x1 - s.x0 - 0.12);
    this.group.updateMatrixWorld(true);
    return this.group.localToWorld(new THREE.Vector3(x, ys[shelf], 0.02));
  }
}
