/**
 * 손으로 집고 놓고 "서로 연결"할 수 있는 실험 물체 — 조립 시스템
 *
 * 규칙
 *  - 모든 물체는 "바닥면 중심"이 원점이다 → 어떤 면 위에 놓을 때 그 면의 높이에 그대로 두면 올라앉는다.
 *  - 플러그(Plug): 물체가 "다른 곳에 끼워지는" 부분.  예) 추의 고리(hook), 추의 몸통(grip)
 *  - 소켓(Socket): 물체가 "다른 것을 받는" 부분.     예) 실 끝 고리(hook을 받음), 클램프 집게(grip을 받음)
 *  - 플러그와 소켓의 종류가 맞으면 연결된다. 연결된 물체는 부모를 따라 움직이는 "자식"이 된다.
 *    (추를 매단 실을 들면 추도 함께 들린다)
 *
 * 이 규칙 하나로 스탠드–클램프–실–추, 클램프–플라스크, (나중에) 광학대–레이저–슬릿 등을 모두 표현한다.
 */
import * as THREE from 'three';
import type { Action, Interactable } from './interactable';

/** 연결 방식의 종류 */
export type PlugType =
  | 'rodMount' // 스탠드 막대에 끼우는 클램프 고정부
  | 'grip' // 클램프 집게로 잡을 수 있는 부분
  | 'hook' // 실 끝 고리에 걸 수 있는 고리
  | 'accessory'; // 클램프에 붙이는 부속 (각도기)

export interface Plug {
  type: PlugType;
  /** 물체 좌표계에서 연결되는 점 — 연결되면 이 점이 소켓 위치에 온다 */
  point: THREE.Vector3;
}

export const HITBOX_MAT = new THREE.MeshBasicMaterial({ visible: false });

export interface ItemOptions {
  name: string;
  /** 위에서 본 반지름 (m) — 놓을 때 겹침 판정용 */
  radius: number;
  /** 질량 (kg) */
  mass: number;
  plugs?: Plug[];
  /** 공기 저항 계수 × 단면적 C_d·A (m²) */
  dragArea?: number;
  /** 작은 물체용 터치 판정 원기둥을 붙일지 (큰 물체는 자기 모양으로 충분) */
  touchPad?: boolean;
  /** 무게 중심의 높이 (물체 좌표 y, 기본값 = 높이의 절반) */
  comY?: number;
}

export class Item implements Interactable {
  readonly name: string;
  readonly radius: number;
  readonly mass: number;
  readonly plugs: Plug[];
  readonly dragArea: number;
  readonly sockets: Socket[] = [];
  /** 보이는 모양의 높이 (m) */
  readonly height: number;
  /** 무게 중심의 높이 (물체 좌표 y) */
  readonly comY: number;
  /** 지금 끼워져 있는 소켓 (없으면 자유 상태) */
  attachedTo: Socket | null = null;
  attachedPlug: Plug | null = null;
  onPick: (item: Item) => void = () => {};

  constructor(readonly object: THREE.Group, o: ItemOptions) {
    this.name = o.name;
    this.radius = o.radius;
    this.mass = o.mass;
    this.plugs = o.plugs ?? [];
    this.dragArea = o.dragArea ?? 0;
    const box = new THREE.Box3().setFromObject(object);
    this.height = box.max.y - box.min.y;
    this.comY = o.comY ?? this.height / 2;
    if (o.touchPad ?? true) {
      // 작은 물체도 손가락으로 쉽게 탭할 수 있도록 보이지 않는 원기둥을 붙인다
      // (material.visible = false → 그려지지 않지만 광선(raycast)에는 맞는다)
      const h = Math.max(this.height, 0.08) + 0.02;
      const r = Math.max(o.radius, 0.05);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 8), HITBOX_MAT);
      pad.position.y = h / 2;
      object.add(pad);
    }
    object.userData.item = this;
  }

  /** 가능한 동작들: 부모(소켓 주인)가 주는 동작 + 자기 동작 + 집기 */
  actions(): Action[] {
    return [
      ...(this.attachedTo?.owner.childActions(this) ?? []),
      ...this.extraActions(),
      { label: `집기 · ${this.name}`, run: () => this.onPick(this) },
    ];
  }

  /** 하위 클래스가 덧붙이는 동작 */
  extraActions(): Action[] {
    return [];
  }

  /** 자식에게 달린 동작 (예: 실에 매달린 추 → "진자 실험") */
  childActions(_child: Item): Action[] {
    return [];
  }

  /** 소켓에서 빠지거나 장면에서 떼어 낸다 */
  detachFromParent(): void {
    if (this.attachedTo) this.attachedTo.detach(this);
    else this.object.removeFromParent();
  }

  /** 가장 바깥쪽 조립체의 주인 (스탠드–클램프–실–추 → 스탠드) */
  root(): Item {
    let it: Item = this;
    while (it.attachedTo) it = it.attachedTo.owner;
    return it;
  }

  // ---- 연결 이벤트 (하위 클래스가 필요하면 덮어씀) ----
  onAttached(_s: Socket): void {}
  onDetached(_s: Socket): void {}
  onChildAttached(_child: Item, _s: Socket): void {}
  onChildDetached(_child: Item, _s: Socket): void {}
}

export interface SocketOptions {
  /** 여러 개를 받을 수 있는가 (스탠드 막대에는 클램프 여러 개) */
  multi?: boolean;
  /** 미끄러지는 소켓: 물체 좌표 y가 min~max인 막대 어디에나 (탭한 높이에) 끼운다 */
  slide?: { min: number; max: number };
  /** 터치 판정 크기 (m). 0이면 판정 없음 (주인 물체를 탭하면 됨) */
  hitRadius?: number;
  /** 끼운 물체를 카메라 쪽으로 돌려서 붙인다 (클램프 팔이 나를 향하게) */
  faceCamera?: boolean;
  /** 지금 받을 수 있는 상태인가 (예: 실이 걸려 있을 때만 끝 고리 사용 가능) */
  enabled?: () => boolean;
}

export class Socket {
  /** 끼운 물체가 붙는 기준점 (주인 물체의 자식) */
  readonly anchor = new THREE.Group();
  readonly children: Item[] = [];

  constructor(
    readonly owner: Item,
    /** 안내 문구에 쓰는 이름 (예: "클램프 집게") */
    readonly label: string,
    readonly accepts: PlugType[],
    position: THREE.Vector3,
    readonly opts: SocketOptions = {},
    parent: THREE.Object3D = owner.object,
  ) {
    this.anchor.position.copy(position);
    parent.add(this.anchor);
    owner.sockets.push(this);
    const r = opts.hitRadius ?? 0.04;
    if (r > 0) {
      const geo = opts.slide
        ? new THREE.CylinderGeometry(r, r, opts.slide.max - opts.slide.min, 6)
        : new THREE.SphereGeometry(r, 6, 4);
      const pad = new THREE.Mesh(geo, HITBOX_MAT);
      if (opts.slide) pad.position.y = (opts.slide.min + opts.slide.max) / 2 - position.y;
      pad.userData.socket = this;
      this.anchor.add(pad);
    }
  }

  /** item을 받을 수 있으면 맞는 플러그를 돌려준다 */
  accept(item: Item): Plug | null {
    if (this.opts.enabled && !this.opts.enabled()) return null;
    if (!this.opts.multi && this.children.length) return null;
    if (item === this.owner || isDescendant(this.owner, item)) return null;
    return item.plugs.find((p) => this.accepts.includes(p.type)) ?? null;
  }

  /**
   * 연결: 플러그 점이 소켓 점에 오도록 item을 소켓의 자식으로 붙인다.
   * @param hitWorld 탭한 점 (미끄러지는 소켓에서 높이를 정함)
   * @param cameraWorld 카메라 위치 (faceCamera일 때 방향을 정함)
   */
  attach(item: Item, plug: Plug, hitWorld?: THREE.Vector3, cameraWorld?: THREE.Vector3): void {
    let parent: THREE.Object3D = this.anchor;
    this.owner.object.updateWorldMatrix(true, false);
    if (this.opts.slide) {
      // 막대의 탭한 높이에 개별 기준점을 만든다 (1 cm 단위)
      const local = hitWorld ? this.owner.object.worldToLocal(hitWorld.clone()) : this.anchor.position.clone();
      const y = THREE.MathUtils.clamp(Math.round(local.y * 100) / 100, this.opts.slide.min, this.opts.slide.max);
      const a = new THREE.Group();
      a.position.set(this.anchor.position.x, y, this.anchor.position.z);
      this.owner.object.add(a);
      parent = a;
    }
    if (this.opts.faceCamera && cameraWorld) {
      // 소켓 위치에서 카메라를 향하는 수평 방향으로 돌린다
      const cam = this.owner.object.worldToLocal(cameraWorld.clone());
      parent.rotation.y = Math.atan2(cam.x - parent.position.x, cam.z - parent.position.z);
    }
    item.object.position.copy(plug.point).multiplyScalar(-1);
    item.object.rotation.set(0, 0, 0);
    parent.add(item.object);
    item.attachedTo = this;
    item.attachedPlug = plug;
    this.children.push(item);
    this.owner.onChildAttached(item, this);
    item.onAttached(this);
  }

  detach(item: Item): void {
    const parent = item.object.parent;
    item.object.removeFromParent();
    if (this.opts.slide && parent && parent !== this.anchor) parent.removeFromParent();
    const i = this.children.indexOf(item);
    if (i >= 0) this.children.splice(i, 1);
    item.attachedTo = null;
    item.attachedPlug = null;
    this.owner.onChildDetached(item, this);
    item.onDetached(this);
  }

  worldPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return this.anchor.getWorldPosition(target);
  }
}

/** a가 b의 조립체 안(자식·손자…)에 있는가 */
function isDescendant(a: Item, b: Item): boolean {
  for (let s = a.attachedTo; s; s = s.owner.attachedTo) if (s.owner === b) return true;
  return false;
}

// ====================== 장식용 물체 (연결 없음 / 플라스크는 집게로 잡을 수 있음) ======================

const glass = () =>
  new THREE.MeshLambertMaterial({ color: 0xcfe6e0, transparent: true, opacity: 0.4, depthWrite: false });
const liquid = (color: number) => new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.8 });

function beaker(liquidColor: number): THREE.Group {
  const g = new THREE.Group();
  const r = 0.04;
  const h = 0.1;
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 8, 1, true), glass());
  wall.position.y = h / 2;
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(r, 8), glass());
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = 0.002;
  const water = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.94, r * 0.94, h * 0.55, 8), liquid(liquidColor));
  water.position.y = (h * 0.55) / 2 + 0.003;
  g.add(water, wall, bottom);
  return g;
}

function flask(liquidColor: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.055, 0.1, 8, 1, true), glass());
  body.position.y = 0.05;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.06, 6, 1, true), glass());
  neck.position.y = 0.13;
  const water = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.052, 0.035, 8), liquid(liquidColor));
  water.position.y = 0.0185;
  g.add(water, body, neck);
  return g;
}

function woodBlock(): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.07), new THREE.MeshLambertMaterial({ color: 0xc89b62 }));
  m.position.y = 0.025;
  g.add(m);
  return g;
}

export function at<T extends Item>(item: T, p: THREE.Vector3): T {
  item.object.position.copy(p);
  return item;
}

/** 실험 테이블 위에 처음부터 놓여 있는 물체들 (질량 = 부피 × 밀도) */
export function createBenchItems(): Item[] {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  return [
    at(new Item(beaker(0x4a9fd8), { name: '비커 (물)', radius: 0.045, mass: 0.38 }), v(5.0, 0.85, 2.4)),
    // 삼각 플라스크는 목 부분을 클램프로 잡을 수 있다
    at(new Item(flask(0xd86a8a), {
      name: '삼각 플라스크', radius: 0.058, mass: 0.17,
      plugs: [{ type: 'grip', point: new THREE.Vector3(0, 0.13, 0) }],
    }), v(5.7, 0.85, 2.7)),
    at(new Item(woodBlock(), { name: '나무 도막', radius: 0.065, mass: 0.21 }), v(9.0, 0.85, 2.9)),
    at(new Item(beaker(0xe0c040), { name: '비커 (용액)', radius: 0.045, mass: 0.38 }), v(14.6, 0.85, 0.55)),
  ];
}
