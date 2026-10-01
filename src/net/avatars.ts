/**
 * 다른 참가자의 아바타: 낡은 안전 작업복 현장 기술자(올리브·카키 옷, 검은 바이저 헬멧, 사각 배낭) 상자 인형(마디 관절) + 머리 위 이름표
 *   - 자세(x, z, 방향, 고개, 앉기)는 방장 경유로 초당 10번 온다 → 여기서 부드럽게 따라가고, 움직임(걷기·돌기·숨쉬기·앉기·들기·손 뻗기)은
 *     위치 변화에서 net/avatarMotion.ts가 계산한다 (모델 파일·뼈대 메시 없음)
 *   - 몸 전체가 정점 색 상자 10개(+ 이름표 1) = 그리기 호출 11, 재질 하나
 *   - 손에 든 기구는 오른손에 붙는다 (다른 사람이 못 집도록 광선 판정에서 제외)
 *   - 광선에 맞지 않는다 (noPick): 뒤에 있는 기구를 탭할 수 있다
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Item } from '../world/items';
import type { PlayerInfo, Pose } from './session';
import { isPickable, itemOf } from '../player/hand';
import { newMotion, stepMotion, type MotionState } from './avatarMotion';

const H = 1.75;
/** 위치를 따라가는 속도 (1/s) */
const FOLLOW = 14;
const GREEN = 0x4f5d36; // 올리브 초록: 가슴 판·아래팔·정강이
const DGREEN = 0x37432b; // 어두운 초록: 무릎 보호대
const KHAKI = 0x938d62; // 카키: 몸통·위팔·허벅지
const HELM = 0x6b7340; // 헬멧
const BLACK = 0x1f201e; // 멜빵·벨트·장갑·장화·배낭
const PACK = 0x2e312c;
const VISOR = 0x05090a;
const TEAL = 0x123a3a;
const SIDEPLATE = 0x4a5a56;
const LIGHT = 0xff9a22; // 상태 표시등 (배낭)

/** 관절 그룹 (모션이 rotation.x 등을 돌린다) */
export interface Rig {
  pelvis: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  hipL: THREE.Group;
  hipR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
  shoulderL: THREE.Group;
  shoulderR: THREE.Group;
  elbowL: THREE.Group;
  elbowR: THREE.Group;
}

interface Avatar {
  info: PlayerInfo;
  group: THREE.Group;
  anchor: THREE.Group;
  rig: Rig;
  motion: MotionState;
  target: Pose;
  held: Item | null;
  seen: boolean;
  speed: number;
  turn: number;
  c: number;
  pitch: number;
  t: number;
  reachAt: number;
}

type BoxSpec = [w: number, h: number, d: number, x: number, y: number, z: number, color: number];

/** 상자 여러 개를 정점 색으로 합친 하나의 지오메트리 */
function boxes(specs: BoxSpec[]): THREE.BufferGeometry {
  const parts = specs.map(([w, h, d, x, y, z, color]) => {
    const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();
    const col = new THREE.Color(color);
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.toArray(arr, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.deleteAttribute('uv');
    return g;
  });
  return mergeGeometries(parts)!;
}

const joint = (parent: THREE.Object3D, x: number, y: number, z = 0): THREE.Group => {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
};

/** 인형 만들기: 앞(−z), 뒤(+z)에 배낭. 서 있을 때 키 1.75 m, 발바닥 y = 0. 식별 색(띠·가슴 패치·장화 줄)은 사람마다 다르게 */
function buildRig(color: number, mat: THREE.Material, group: THREE.Group): Rig {
  const accent = new THREE.Color(color).lerp(new THREE.Color(0x6a6048), 0.1).getHex();
  const mesh = (geo: THREE.BufferGeometry, parent: THREE.Object3D) => {
    const m = new THREE.Mesh(geo, mat);
    parent.add(m);
    return m;
  };
  const pelvis = joint(group, 0, 0.96);
  const torso = joint(pelvis, 0, 0.09);
  mesh(boxes([
    [0.42, 0.2, 0.26, 0, 0, 0, KHAKI], // 허리·엉덩이
    [0.44, 0.46, 0.27, 0, 0.28, 0, KHAKI], // 넓은 몸통
    [0.34, 0.28, 0.02, 0, 0.31, -0.14, GREEN], // 초록 가슴 판
    [0.1, 0.1, 0.012, 0.05, 0.33, -0.156, accent], // 가슴 식별 패치 (네모)
    [0.065, 0.04, 0.012, -0.1, 0.22, -0.156, 0xb59b24], // 작은 경고 라벨
    [0.05, 0.42, 0.02, -0.15, 0.27, -0.145, BLACK], // 멜빵
    [0.05, 0.42, 0.02, 0.15, 0.27, -0.145, BLACK],
    [0.47, 0.07, 0.3, 0, 0.06, 0, BLACK], // 벨트
    [0.075, 0.09, 0.06, -0.19, 0.06, -0.16, BLACK], // 벨트 주머니
    [0.075, 0.09, 0.06, 0.19, 0.06, -0.16, BLACK],
    [0.46, 0.07, 0.29, 0, 0.5, 0, GREEN], // 어깨 판
    [0.32, 0.4, 0.16, 0, 0.28, 0.22, PACK], // 사각 장비 배낭
    [0.33, 0.05, 0.17, 0, 0.5, 0.22, BLACK], // 배낭 윗덮개
    [0.04, 0.04, 0.012, 0.1, 0.4, 0.306, LIGHT], // 상태 표시등
    [0.14, 0.012, 0.012, -0.03, 0.12, 0.306, BLACK], // 환기구 홈
    [0.14, 0.012, 0.012, -0.03, 0.15, 0.306, BLACK],
    [0.14, 0.012, 0.012, -0.03, 0.18, 0.306, BLACK],
    [0.035, 0.2, 0.035, 0.12, 0.1, 0.32, BLACK], // 늘어진 호스
    [0.035, 0.035, 0.07, 0.12, 0.0, 0.3, BLACK],
  ]), torso);
  const head = joint(torso, 0, 0.46);
  mesh(boxes([
    [0.1, 0.07, 0.1, 0, 0.03, 0, BLACK], // 목 보호대
    [0.25, 0.2, 0.27, 0, 0.14, 0, HELM], // 낮고 넓은 헬멧
    [0.23, 0.07, 0.25, 0, 0.255, 0, HELM], // 각진 윗면
    [0.265, 0.04, 0.285, 0, 0.19, 0, accent], // 식별 띠
    [0.21, 0.11, 0.02, 0, 0.115, -0.14, VISOR], // 불투명 검은 바이저 (얼굴 없음)
    [0.13, 0.015, 0.005, -0.02, 0.14, -0.152, TEAL], // 어두운 청록 반사
    [0.23, 0.045, 0.05, 0, 0.04, -0.125, BLACK], // 턱 보호대
    [0.015, 0.12, 0.012, 0.113, 0.115, -0.14, BLACK], // 바이저 테두리
    [0.015, 0.12, 0.012, -0.113, 0.115, -0.14, BLACK],
    [0.05, 0.05, 0.05, 0.14, 0.12, -0.06, SIDEPLATE], // 옆 바이저 판
    [0.05, 0.05, 0.05, -0.14, 0.12, -0.06, SIDEPLATE],
  ]), head);
  const arm = (side: number) => {
    const shoulder = joint(torso, side * 0.29, 0.4);
    mesh(boxes([[0.14, 0.26, 0.14, 0, -0.13, 0, KHAKI]]), shoulder);
    const elbow = joint(shoulder, 0, -0.26);
    mesh(boxes([
      [0.125, 0.2, 0.125, 0, -0.1, 0, GREEN], // 초록 아래팔
      [0.135, 0.025, 0.135, 0, -0.205, 0, accent], // 소매 끝 식별 띠
      [0.15, 0.12, 0.15, 0, -0.265, 0, BLACK], // 두꺼운 장갑
    ]), elbow);
    return { shoulder, elbow };
  };
  const leg = (side: number) => {
    const hip = joint(pelvis, side * 0.1, -0.09);
    mesh(boxes([
      [0.17, 0.4, 0.17, 0, -0.2, 0, KHAKI],
      [0.04, 0.13, 0.09, side * 0.105, -0.16, 0, BLACK], // 허벅지 옆 주머니
    ]), hip);
    const knee = joint(hip, 0, -0.4);
    mesh(boxes([
      [0.145, 0.4, 0.145, 0, -0.2, 0, GREEN],
      [0.175, 0.1, 0.175, 0, -0.04, -0.012, DGREEN], // 무릎 보호대
      [0.18, 0.14, 0.3, 0, -0.4, -0.06, BLACK], // 큰 장화 (바닥 −0.47)
      [0.185, 0.025, 0.12, 0, -0.38, -0.1, accent], // 장화 식별 줄
    ]), knee);
    return { hip, knee };
  };
  const aL = arm(-1);
  const aR = arm(1);
  const lL = leg(-1);
  const lR = leg(1);
  return { pelvis, torso, head, hipL: lL.hip, hipR: lR.hip, kneeL: lL.knee, kneeR: lR.knee, shoulderL: aL.shoulder, shoulderR: aR.shoulder, elbowL: aL.elbow, elbowR: aR.elbow };
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
    const group = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const rig = buildRig(info.color, mat, group);
    group.add(nameTag(info.name));
    // 든 기구: 오른손 끝. 팔이 돌아도 기구는 똑바로 서게 update에서 반대로 돌려 준다
    const anchor = joint(rig.elbowR, 0, -0.33, -0.06);
    group.userData.noPick = true;
    group.visible = false; // 첫 자세를 받기 전에는 숨김
    this.retro(group);
    this.scene.add(group);
    a = {
      info, group, anchor, rig, motion: newMotion(), target: { x: 0, y: 0, z: 0, yaw: 0 }, held: null, seen: false,
      speed: 0, turn: 0, c: 0, pitch: 0, t: 0, reachAt: -Infinity,
    };
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

  /** 이 사람이 방금 무언가를 조작했다 → 오른팔을 앞으로 뻗는다 */
  reach(id: string): void {
    const a = this.map.get(id);
    if (a) a.reachAt = performance.now();
  }

  /** 테스트·디버그: 인형 관절 */
  rigOf(id: string): Rig | null {
    return this.map.get(id)?.rig ?? null;
  }

  update(dt: number, camera: THREE.Camera): void {
    const k = 1 - Math.exp(-FOLLOW * dt);
    const now = performance.now();
    for (const a of this.map.values()) {
      if (!a.seen) continue;
      const g = a.group;
      const px = g.position.x;
      const pz = g.position.z;
      const py = g.rotation.y;
      g.position.x += (a.target.x - g.position.x) * k;
      g.position.z += (a.target.z - g.position.z) * k;
      let d = a.target.yaw - g.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d)); // −π ~ π (돌아가는 짧은 쪽으로)
      g.rotation.y += d * k;
      // ---- 모션: 실제로 움직인 만큼으로 속도·회전 속도를 구한다 (지수 평활 0.15 s) ----
      if (dt > 0) {
        const sm = 1 - Math.exp(-dt / 0.15);
        a.speed += (Math.hypot(g.position.x - px, g.position.z - pz) / dt - a.speed) * sm;
        let dy = g.rotation.y - py;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        a.turn += (dy / dt - a.turn) * sm;
        a.c += ((a.target.c ?? 0) - a.c) * (1 - Math.exp(-dt / 0.08));
        a.pitch += ((a.target.pitch ?? 0) - a.pitch) * (1 - Math.exp(-dt / 0.08));
        a.t += dt;
      }
      const j = stepMotion(a.motion, { speed: a.speed, turn: a.turn, pitch: a.pitch, c: a.c, holding: !!a.held, reachAge: (now - a.reachAt) / 1000, t: a.t }, dt);
      const r = a.rig;
      r.pelvis.position.y = j.pelvisY;
      r.torso.rotation.x = j.torsoX;
      r.torso.scale.y = 1 + j.breath;
      r.head.rotation.set(j.headX, j.headY, 0);
      r.hipL.rotation.x = j.hipL;
      r.hipR.rotation.x = j.hipR;
      r.kneeL.rotation.x = j.kneeL;
      r.kneeR.rotation.x = j.kneeR;
      r.shoulderL.rotation.x = j.shoulderL;
      r.shoulderR.rotation.x = j.shoulderR;
      r.elbowL.rotation.x = j.elbowL;
      r.elbowR.rotation.x = j.elbowR;
      a.anchor.rotation.x = -(j.shoulderR + j.elbowR) - j.torsoX; // 든 기구는 팔이 돌아도 똑바로
      g.updateMatrixWorld(true);
      const tag = g.children.find((c) => c.userData.nameTag);
      if (tag) {
        tag.position.y = r.head.matrixWorld.elements[13] - g.position.y + 0.45; // 머리 위 (앉으면 같이 내려옴)
        tag.lookAt(camera.position); // 이름표는 항상 보는 사람 쪽으로
      }
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
  m.position.y = H + 0.2;
  m.userData.nameTag = true;
  return m;
}
