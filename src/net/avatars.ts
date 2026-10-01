/**
 * 다른 참가자의 아바타: 색깔 육면체 하나 + 머리 위 이름표 (디자인은 나중에)
 *   - 자세(x, z, 방향)는 방장 경유로 초당 10번 온다 → 여기서 부드럽게 따라간다
 *   - 앞면(−z)만 밝게 칠해 어디를 보는지 알 수 있다
 *   - 손에 든 기구는 육면체 앞 가슴 높이에 붙는다 (다른 사람이 못 집도록 광선 판정에서 제외)
 *   - 광선에 맞지 않는다 (noPick): 뒤에 있는 기구를 탭할 수 있다
 */
import * as THREE from 'three';
import type { Item } from '../world/items';
import type { PlayerInfo, Pose } from './session';
import { isPickable, itemOf } from '../player/hand';

const W = 0.5;
const H = 1.7;
const D = 0.3;
/** 이만큼 길게 안 오면 사라진 것으로 보지 않는다 (사람이 있는 한 유지). 위치를 따라가는 속도 (1/s) */
const FOLLOW = 14;

interface Avatar {
  info: PlayerInfo;
  group: THREE.Group;
  anchor: THREE.Group;
  target: Pose;
  held: Item | null;
  seen: boolean;
}

export class Avatars {
  private map = new Map<string, Avatar>();
  private ray = new THREE.Raycaster();

  constructor(private scene: THREE.Scene, private retro: (root: THREE.Object3D) => void) {}

  get count(): number {
    return this.map.size;
  }

  /** 아바타 그룹 (테스트·디버그용) */
  groupOf(id: string): THREE.Object3D | null {
    return this.map.get(id)?.group ?? null;
  }

  ensure(info: PlayerInfo): Avatar {
    let a = this.map.get(info.id);
    if (a) return a;
    const geo = new THREE.BoxGeometry(W, H, D);
    // 정점 색: 앞면(−z)은 밝게, 나머지는 원래 색
    const base = new THREE.Color(info.color);
    const front = base.clone().lerp(new THREE.Color(0xffffff), 0.55);
    const colors: number[] = [];
    const normal = geo.getAttribute('normal');
    for (let i = 0; i < normal.count; i++) {
      const c = normal.getZ(i) < -0.5 ? front : base;
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const body = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    body.position.y = H / 2;
    const group = new THREE.Group();
    group.add(body, nameTag(info.name));
    const anchor = new THREE.Group();
    anchor.position.set(0, 1.05, -(D / 2 + 0.25));
    group.add(anchor);
    group.userData.noPick = true;
    group.visible = false; // 첫 자세를 받기 전에는 숨김
    this.retro(group);
    this.scene.add(group);
    a = { info, group, anchor, target: { x: 0, y: 0, z: 0, yaw: 0 }, held: null, seen: false };
    this.map.set(info.id, a);
    return a;
  }

  setPose(info: PlayerInfo, pose: Pose): void {
    const a = this.ensure(info);
    a.target = pose;
    if (!a.seen) {
      a.seen = true;
      a.group.visible = true;
      a.group.position.set(pose.x, 0, pose.z);
      a.group.rotation.y = pose.yaw;
    }
  }

  update(dt: number, camera: THREE.Camera): void {
    const k = 1 - Math.exp(-FOLLOW * dt);
    for (const a of this.map.values()) {
      if (!a.seen) continue;
      const g = a.group;
      g.position.x += (a.target.x - g.position.x) * k;
      g.position.z += (a.target.z - g.position.z) * k;
      let d = a.target.yaw - g.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d)); // −π ~ π (돌아가는 짧은 쪽으로)
      g.rotation.y += d * k;
      g.updateMatrixWorld(true);
      const tag = g.children.find((c) => c.userData.nameTag);
      tag?.lookAt(camera.position); // 이름표는 항상 보는 사람 쪽으로
    }
  }

  // ---------------------------------------------------------------- 손

  heldBy(id: string): Item | null {
    return this.map.get(id)?.held ?? null;
  }

  holderOf(item: Item): string | null {
    for (const [id, a] of this.map) if (a.held === item) return id;
    return null;
  }

  /** id가 item을 든다 (붙어 있던 곳에서 떼어 낸다) */
  hold(info: PlayerInfo, item: Item): void {
    const a = this.ensure(info);
    if (a.held) return;
    a.held = item;
    item.detachFromParent();
    a.anchor.add(item.object);
    item.object.position.set(0, 0, 0);
    item.object.rotation.set(0, 0, 0);
    item.object.updateMatrixWorld(true);
  }

  /** 든 기구를 point에 내려놓는다 */
  place(id: string, point: THREE.Vector3): boolean {
    const a = this.map.get(id);
    const item = a?.held;
    if (!a || !item) return false;
    item.object.removeFromParent();
    item.object.position.copy(point);
    item.object.rotation.set(0, item.yaw, 0);
    this.scene.add(item.object);
    item.object.updateMatrixWorld(true);
    a.held = null;
    return true;
  }

  /** 든 기구를 소켓에 끼우려고 넘겨준다 */
  handOver(id: string): Item | null {
    const a = this.map.get(id);
    const item = a?.held ?? null;
    if (!a || !item) return null;
    item.object.removeFromParent();
    item.object.rotation.set(0, 0, 0);
    a.held = null;
    return item;
  }

  /** 사람이 나감: 든 기구는 서 있던 자리 아래 면에 내려놓고 아바타를 지운다 */
  remove(id: string): void {
    const a = this.map.get(id);
    if (!a) return;
    if (a.held) {
      const p = a.group.position;
      this.place(id, new THREE.Vector3(p.x, this.surfaceY(p.x, p.z), p.z));
    }
    a.group.removeFromParent();
    this.map.delete(id);
  }

  clear(): void {
    for (const id of [...this.map.keys()]) this.remove(id);
  }

  /** (x, z) 위에서 아래로 쏴 처음 만나는 위를 향한 면의 높이 (기구·아바타 제외, 없으면 0) */
  private surfaceY(x: number, z: number): number {
    this.ray.set(new THREE.Vector3(x, 2.5, z), new THREE.Vector3(0, -1, 0));
    this.ray.far = 3;
    const hit = this.ray
      .intersectObjects(this.scene.children, true)
      .find((h) => isPickable(h.object) && !itemOf(h.object) && h.face && h.face.normal.clone().transformDirection(h.object.matrixWorld).y > 0.7);
    return hit ? hit.point.y : 0;
  }
}

function nameTag(name: string): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(0,0,0,0.6)';
  g.fillRect(0, 0, 128, 32);
  g.fillStyle = '#ffd9a0';
  g.font = 'bold 18px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, 64, 17, 120);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  // Sprite는 raycaster.camera가 없으면 오류를 내므로(빛 추적 등 .set()으로 쏘는 광선) 평면 메시를 매 프레임 카메라 쪽으로 돌린다
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.125), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  m.position.y = H + 0.18;
  m.userData.nameTag = true;
  return m;
}
