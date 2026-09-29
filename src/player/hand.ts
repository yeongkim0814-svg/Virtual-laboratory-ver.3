/**
 * 손: 물체를 집고, 들고 다니고, 원하는 면 위에 놓는다.
 *
 * 놓을 자리 찾기
 *   1. 조준점(또는 탭한 곳)에서 광선을 쏴서 처음 맞는 면을 찾는다.
 *   2. 그 면의 법선 벡터 n이 거의 위쪽(n·ŷ > 0.7, 즉 기울기 약 45° 이하)이면 "놓을 수 있는 면"이다.
 *      → 벽이나 가구 옆면(n이 수평)에는 놓을 수 없다.
 *   3. 다른 물체와 같은 높이에서 겹치면(중심 거리 < 두 반지름의 합) 놓을 수 없다.
 * 아직 중력·낙하는 없다. 물체는 고른 면 위에 바로 올라앉는다.
 *
 * 들고 있는 물체는 "레이어 1"로 옮겨 따로 그린다 (retro.ts가 깊이 버퍼를 지운 뒤 맨 앞에 그림).
 * → 벽에 가까이 가도 파묻혀 보이지 않고, 광선 판정(레이어 0만 봄)에서도 자동으로 빠진다.
 */
import * as THREE from 'three';
import type { Item } from '../world/items';
import { INTERACT_RANGE } from '../world/interactable';

const MIN_UP = 0.7; // 법선의 y성분이 이보다 커야 놓을 수 있다
export const HELD_LAYER = 1;

export interface PlaceTarget {
  point: THREE.Vector3;
  valid: boolean;
}

export class Hand {
  held: Item | null = null;
  /** 이번 프레임의 조준점 놓을 자리 (없으면 null) */
  aim: PlaceTarget | null = null;

  private raycaster = new THREE.Raycaster();
  private marker: THREE.Mesh;
  private normal = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private items: Item[],
  ) {
    // 놓을 자리 표시: 바닥에 눕힌 고리 (호박색 = 가능, 빨강 = 불가)
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1, 12),
      new THREE.MeshBasicMaterial({ color: 0xffa640, transparent: true, opacity: 0.9, depthTest: false }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.renderOrder = 1000;
    this.marker.visible = false;
    this.marker.userData.noPick = true;
    scene.add(this.marker);
  }

  pickUp(item: Item): void {
    if (this.held) return;
    this.held = item;
    item.detachFromParent(); // 책상 위든 다른 기구의 소켓이든 붙어 있던 곳에서 떼어 낸다 (자식은 함께 딸려 옴)
    this.camera.add(item.object);
    // 카메라 기준 오른쪽 아래 앞. 큰 물체(스탠드 등)일수록 더 멀리·아래에 들어 화면을 덜 가린다
    const h = new THREE.Box3().setFromObject(item.object).getSize(new THREE.Vector3()).y;
    item.object.position.set(0.22 + 0.2 * h, -0.2 - 0.5 * h, -0.45 - 0.35 * h);
    item.object.rotation.set(0, 0, 0);
    setLayer(item.object, HELD_LAYER);
  }

  /** 지정한 자리에 내려놓는다. 성공하면 true */
  place(target: PlaceTarget | null): boolean {
    const item = this.held;
    if (!item || !target?.valid) return false;
    this.camera.remove(item.object);
    setLayer(item.object, 0);
    item.object.position.copy(target.point);
    item.object.rotation.set(0, item.yaw, 0); // 돌려 둔 방향 유지
    this.scene.add(item.object);
    this.held = null;
    this.marker.visible = false;
    return true;
  }

  /** 들고 있던 물체를 다른 곳(예: 진자 스탠드)에 넘겨준다 */
  handOver(): Item | null {
    const item = this.held;
    if (!item) return null;
    this.camera.remove(item.object);
    setLayer(item.object, 0);
    item.object.rotation.set(0, 0, 0);
    this.held = null;
    this.marker.visible = false;
    return item;
  }

  /** 화면 좌표(ndc)에서 놓을 자리를 찾는다 */
  findTarget(ndcX: number, ndcY: number): PlaceTarget | null {
    const item = this.held;
    if (!item) return null;
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    this.raycaster.far = INTERACT_RANGE;
    // 들고 있는 물체·표시 고리는 무시하고, 다른 물체는 통과시킨다 (물체 위에 쌓기는 아직 지원하지 않음 →
    // 광선이 물체를 지나 아래 책상에 맞고, 아래의 겹침 검사에서 불가로 판정된다)
    const hit = this.raycaster
      .intersectObjects(this.scene.children, true)
      .find((h) => isPickable(h.object) && !itemOf(h.object));
    if (!hit || !hit.face) return null;

    // 면의 법선을 월드 좌표로 바꾼다 (물체가 회전해 있어도 올바른 방향을 얻기 위해)
    this.normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    let valid = this.normal.y > MIN_UP;

    // 다른 물체와 겹치는지
    for (const other of this.items) {
      if (other === item || other.object.parent !== this.scene) continue;
      const p = other.object.position;
      const d = Math.hypot(p.x - hit.point.x, p.z - hit.point.z);
      if (d < other.radius + item.radius && Math.abs(p.y - hit.point.y) < 0.05) valid = false;
    }
    return { point: hit.point.clone(), valid };
  }

  /** 매 프레임: 조준점 기준 놓을 자리 표시 (aimX = 조준점의 화면 x 좌표, ndc) */
  update(aimX = 0): void {
    this.aim = this.findTarget(aimX, 0);
    const m = this.marker;
    m.visible = !!this.held && !!this.aim;
    if (!m.visible || !this.aim || !this.held) return;
    m.position.copy(this.aim.point).add(new THREE.Vector3(0, 0.003, 0));
    const r = this.held.radius;
    m.scale.set(r, r, r);
    (m.material as THREE.MeshBasicMaterial).color.set(this.aim.valid ? 0xffa640 : 0xff3c28);
  }
}

/**
 * 광선에 맞아도 되는 물체인가.
 * 제외: 표시 고리 등 noPick 표시가 붙은 것, 숨겨진 것 (three.js 광선은 visible=false도 맞히므로 직접 거른다)
 */
export function isPickable(o: THREE.Object3D | null): boolean {
  for (; o; o = o.parent) if (o.userData.noPick || !o.visible) return false;
  return true;
}

/** 광선에 맞은 부분이 속한 물체(Item)를 찾는다 (없으면 null) */
export function itemOf(o: THREE.Object3D | null): Item | null {
  for (; o; o = o.parent) if (o.userData.item) return o.userData.item as Item;
  return null;
}

function setLayer(obj: THREE.Object3D, layer: number): void {
  obj.traverse((o) => o.layers.set(layer));
}
