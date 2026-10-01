/**
 * 다른 참가자의 아바타: 가운 입은 연구자(미색 가운 · 숯색 바지 · 보안경 · 사람 색 장갑과 셔츠) 저폴리 인형(마디 관절) + 머리 위 이름표
 *   - 자세(x, z, 방향, 고개, 앉기)는 방장 경유로 초당 10번 온다 → 여기서 부드럽게 따라가고, 움직임(발 디딤 걸음·돌기·숨쉬기·앉기·들기·손 뻗기)은
 *     위치 변화에서 net/avatarMotion.ts가 계산한다 (모델 파일·뼈대 메시 없음)
 *   - 몸 전체가 정점 색 기둥 13개(+ 이름표 1) = 그리기 호출 14, 재질 하나
 *   - 손에 든 기구는 오른손에 붙는다 (다른 사람이 못 집도록 광선 판정에서 제외)
 *   - 광선에 맞지 않는다 (noPick): 뒤에 있는 기구를 탭할 수 있다
 *   - group.rotation.y = 받은 고개 방향. 몸 방향(걸음·따라 돌기)은 골반이 그 차이만큼 돌아 있다
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Item } from '../world/items';
import type { PlayerInfo, Pose } from './session';
import { isPickable, itemOf } from '../player/hand';
import { newMotion, stepMotion, wrapAngle, HIP_DROP, HIP_X, NECK_Y, SHOULDER_X, SHOULDER_Y, THIGH, SHIN, UPPER, FORE, ANKLE_H, type MotionState } from './avatarMotion';

const H = 1.72;
const _qe = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
/** 위치를 따라가는 속도 (1/s) */
const FOLLOW = 14;
const COAT = 0xb8b49a; // 바랜 미색 가운
const COAT_D = 0x9c9880; // 주머니 (짙은 미색)
const TROUSER = 0x3a3c40; // 숯색 바지
const SHOE = 0x3b2c22; // 짙은 갈색 신발
const SKIN = 0xb59a86; // 무채 살색
const HAIR = 0x2a2420;
const STRAP = 0x6a7f86; // 보안경 띠 (회청)
const LENS = 0x4f8a85; // 보안경 렌즈 (탁한 청록)

/** 관절 그룹 (모션이 quaternion을 정한다) */
export interface Rig {
  pelvis: THREE.Group;
  torso: THREE.Group;
  /** 몸통 메시 (숨쉬기 크기 변화는 이 메시에만 — 팔을 같이 늘리지 않는다) */
  torsoMesh: THREE.Mesh;
  head: THREE.Group;
  hipL: THREE.Group;
  hipR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
  shoulderL: THREE.Group;
  shoulderR: THREE.Group;
  elbowL: THREE.Group;
  elbowR: THREE.Group;
  flapL: THREE.Group;
  flapR: THREE.Group;
  /** 오른손 끝 (든 기구가 붙는 자리) */
  anchor: THREE.Group;
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
  /** 받은 자세 사이 속도 (m/s)로 다음 자세가 오기 전까지 앞질러 간다 */
  vx: number;
  vz: number;
  /** 모션에 쓰는 이동 속도 (실제로 움직인 만큼, 평활) */
  mvx: number;
  mvz: number;
  poseAt: number;
  c: number;
  pitch: number;
  t: number;
  reachAt: number;
  reachPoint: THREE.Vector3 | null;
}

// ---- 도형 도우미: 저폴리 기둥·상자 (평평한 면 + 마디마다 위 밝고 아래 어두운 2단 정점 색) ----

/** 정점 색: 기본 색 × (위쪽 절반 1.0 · 아래쪽 절반 0.72). uv·인덱스는 지운다 */
function shade(g0: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const g = g0.index ? g0.toNonIndexed() : g0;
  g.deleteAttribute('uv');
  g.computeVertexNormals(); // 평평한 면 법선
  g.computeBoundingBox();
  const { min, max } = g.boundingBox!;
  const pos = g.getAttribute('position');
  const base = new THREE.Color(color);
  const arr = new Float32Array(pos.count * 3);
  const mid = (min.y + max.y) / 2;
  for (let i = 0; i < pos.count; i++) {
    const k = pos.getY(i) >= mid - 1e-6 ? 1 : 0.72;
    arr[i * 3] = base.r * k;
    arr[i * 3 + 1] = base.g * k;
    arr[i * 3 + 2] = base.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** n각 기둥(아래 반지름 rb, 위 rt, 높이 h). 앞(−z)이 평면이 되게 반 칸 돌리고 앞뒤 sz · 좌우 sx 배, 가운데 (x, y0, z) */
const prism = (rb: number, rt: number, h: number, n: number, y0: number, color: number, sx = 1, sz = 1, x = 0, z = 0) =>
  shade(new THREE.CylinderGeometry(rt, rb, h, n, 1, false).rotateY(Math.PI / n).scale(sx, 1, sz).translate(x, y0, z), color);

const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: number) => shade(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);

/** 위쪽 반지름 rt · 아래 rb의 반쪽 기둥 (가운 자락: 왼쪽 반 = side −1). 안쪽 면은 안 그린다 → 앞이 열린 모습 */
function halfPrism(side: number, rb: number, rt: number, h: number, y0: number, color: number, sz: number, x: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rt, rb, h, 8, 1, true, side < 0 ? Math.PI : 0, Math.PI).scale(1, 1, sz).translate(x, y0, 0);
  return shade(g, color);
}

/** 앞(−z)을 보는 삼각형 (셔츠 V) */
function tri(a: number[], b: number[], c: number[], color: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...c, ...b], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, -1, 0, 0, -1, 0, 0, -1], 3));
  const col = new THREE.Color(color);
  g.setAttribute('color', new THREE.Float32BufferAttribute([col.r, col.g, col.b, col.r, col.g, col.b, col.r, col.g, col.b], 3));
  return g;
}

const merge = (...g: THREE.BufferGeometry[]): THREE.BufferGeometry => mergeGeometries(g)!;

const joint = (parent: THREE.Object3D, x: number, y: number, z = 0): THREE.Group => {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
};

export interface ArmRig {
  shoulder: THREE.Group;
  elbow: THREE.Group;
  /** 손끝 (위팔 UPPER + 아래팔·손 FORE) */
  anchor: THREE.Group;
}

/**
 * 팔 하나 (가운 소매 + 사람 색 니트릴 장갑): 위팔 메시 1 + 아래팔·장갑 메시 1. 어깨 관절은 parent 안 (side·0.19, 0.45)
 * 1인칭 두 손이 같은 팔을 다시 쓴다 (위팔을 안 그리려면 shoulder의 첫 메시를 숨긴다)
 */
export function buildArm(side: number, color: number, mat: THREE.Material, parent: THREE.Object3D, x = side * SHOULDER_X, y = SHOULDER_Y): ArmRig {
  const shoulder = joint(parent, x, y);
  shoulder.add(new THREE.Mesh(merge(prism(0.042, 0.052, UPPER, 6, -UPPER / 2, COAT)), mat));
  const elbow = joint(shoulder, 0, -UPPER);
  elbow.add(new THREE.Mesh(merge(
    prism(0.038, 0.046, 0.2, 6, -0.1, COAT), // 소매
    prism(0.03, 0.04, FORE - 0.2, 6, -0.2 - (FORE - 0.2) / 2, color), // 장갑 (손)
  ), mat));
  const anchor = joint(elbow, 0, -FORE);
  return { shoulder, elbow, anchor };
}

/**
 * 인형 만들기 (가운 연구자, 약 6.5등신): 앞(−z). 서 있을 때 키 약 1.72 m, 발바닥 y = 0. 마디 13개 = 그리기 13.
 * 사람 색은 장갑과 가운 앞 V 셔츠 (앞·뒤 어디서나 식별)
 */
function buildRig(color: number, mat: THREE.Material, group: THREE.Group): Rig {
  const mesh = (geo: THREE.BufferGeometry, parent: THREE.Object3D) => {
    const m = new THREE.Mesh(geo, mat);
    parent.add(m);
    return m;
  };
  const pelvis = joint(group, 0, 0.93);
  mesh(merge(prism(0.13, 0.14, 0.16, 6, -0.02, TROUSER, 1.15, 0.85)), pelvis); // 바지 허리
  const torso = joint(pelvis, 0, 0);
  const torsoMesh = mesh(merge(
    prism(0.205, 0.185, 0.48, 8, 0.22, COAT, 1, 0.72), // 가운 몸통
    tri([-0.075, 0.46, -0.126], [0, 0.2, -0.131], [0.075, 0.46, -0.126], color), // 앞 V: 사람 색 셔츠
    box(0.075, 0.09, 0.02, -0.095, 0.07, -0.135, COAT_D), // 가운 주머니
    box(0.075, 0.09, 0.02, 0.095, 0.07, -0.135, COAT_D),
  ), torso);
  const head = joint(torso, 0, NECK_Y);
  mesh(merge(
    prism(0.04, 0.04, 0.06, 6, 0.03, SKIN), // 목
    prism(0.085, 0.09, 0.22, 8, 0.15, SKIN), // 머리 (눈 = 목 위 0.15)
    prism(0.097, 0.097, 0.09, 8, 0.215, HAIR), // 머리칼
    box(0.17, 0.15, 0.05, 0, 0.17, 0.075, HAIR),
    prism(0.099, 0.099, 0.05, 8, 0.15, STRAP), // 보안경 띠
    box(0.13, 0.035, 0.012, 0, 0.15, -0.098, LENS), // 렌즈
  ), head);
  // 가운 자락: 골반 자식, 허리 → 무릎 0.50 m (엉덩이 앞뒤 각의 0.6배로 흔들림)
  const flap = (side: number) => {
    const f = joint(pelvis, side * HIP_X, -HIP_DROP);
    mesh(merge(halfPrism(side, 0.27, 0.19, 0.5, -0.15, COAT, 0.75, -side * HIP_X)), f);
    return f;
  };
  const flapL = flap(-1);
  const flapR = flap(1);
  const aL = buildArm(-1, color, mat, torso);
  const aR = buildArm(1, color, mat, torso);
  const leg = (side: number) => {
    const hip = joint(pelvis, side * HIP_X, -HIP_DROP);
    mesh(merge(prism(0.06, 0.075, THIGH, 6, -THIGH / 2, TROUSER)), hip);
    const knee = joint(hip, 0, -THIGH);
    mesh(merge(
      prism(0.045, 0.058, SHIN, 6, -SHIN / 2, TROUSER), // 정강이 (무릎 ~ 발목)
      box(0.1, ANKLE_H, 0.26, 0, -SHIN - ANKLE_H / 2, -0.06, SHOE), // 신발
    ), knee);
    return { hip, knee };
  };
  const lL = leg(-1);
  const lR = leg(1);
  return {
    pelvis, torso, torsoMesh, head, hipL: lL.hip, hipR: lR.hip, kneeL: lL.knee, kneeR: lR.knee, shoulderL: aL.shoulder, shoulderR: aR.shoulder, elbowL: aL.elbow, elbowR: aR.elbow,
    flapL, flapR, anchor: aR.anchor,
  };
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
    // 든 기구: 오른손 끝 (rig.anchor). 팔이 돌아도 기구는 몸 방향으로 똑바로 서게 update에서 반대로 돌려 준다
    const anchor = rig.anchor;
    group.userData.noPick = true;
    group.visible = false; // 첫 자세를 받기 전에는 숨김
    this.retro(group);
    this.scene.add(group);
    a = {
      info, group, anchor, rig, motion: newMotion(), target: { x: 0, y: 0, z: 0, yaw: 0 }, held: null, seen: false,
      vx: 0, vz: 0, mvx: 0, mvz: 0, poseAt: 0, c: 0, pitch: 0, t: 0, reachAt: -Infinity, reachPoint: null,
    };
    this.map.set(info.id, a);
    return a;
  }

  setPose(info: PlayerInfo, pose: Pose): void {
    const a = this.ensure(info);
    const now = performance.now();
    if (a.seen && Math.hypot(pose.x - a.group.position.x, pose.z - a.group.position.z) > 1.5) {
      // 순간이동(재접속·텔레포트): 따라가지 않고 바로 옮긴다 (속도가 튀어 발이 끌려가지 않게)
      a.group.position.set(pose.x, 0, pose.z);
      a.vx = a.vz = a.mvx = a.mvz = 0;
      a.poseAt = 0;
    }
    if (a.seen && a.poseAt && now > a.poseAt) {
      const dt = (now - a.poseAt) / 1000;
      const vx = Math.max(-4, Math.min(4, (pose.x - a.target.x) / dt));
      const vz = Math.max(-4, Math.min(4, (pose.z - a.target.z) / dt));
      a.vx += (vx - a.vx) * 0.6;
      a.vz += (vz - a.vz) * 0.6;
    }
    a.poseAt = now;
    a.target = pose;
    if (!a.seen) {
      a.seen = true;
      a.group.visible = true;
      a.group.position.set(pose.x, 0, pose.z);
      a.group.rotation.y = pose.yaw;
    }
  }

  /** 이 사람이 방금 무언가를 조작했다 → 오른손을 세계 좌표 point(없으면 몸 앞 0.5 m 가슴 높이)로 뻗는다 (0.25 s 뻗기 · 0.15 s 멈춤 · 0.3 s 돌아옴) */
  reach(id: string, point?: THREE.Vector3): void {
    const a = this.map.get(id);
    if (!a) return;
    a.reachAt = performance.now();
    a.reachPoint = point ? (a.reachPoint ?? new THREE.Vector3()).copy(point) : null;
  }

  /** 테스트·디버그: 모션 상태 (걸음 위상 등) */
  motionOf(id: string): MotionState | null {
    return this.map.get(id)?.motion ?? null;
  }

  /** 테스트·디버그: 인형 관절 */
  rigOf(id: string): Rig | null {
    return this.map.get(id)?.rig ?? null;
  }

  /** 테스트·디버그: 그려진 발목 세계 위치 (무릎 관절 아래 정강이 끝, 관절 행렬로 구한 값) [왼, 오른] */
  anklesOf(id: string): THREE.Vector3[] | null {
    const r = this.map.get(id)?.rig;
    if (!r) return null;
    return [r.kneeL, r.kneeR].map((k) => k.localToWorld(new THREE.Vector3(0, -SHIN, 0)));
  }

  /** 테스트·디버그: 그려진 손끝 세계 위치 · 관절(어깨·엉덩이·머리) 세계 위치 */
  handOf(id: string): THREE.Vector3 | null {
    return this.map.get(id)?.anchor.getWorldPosition(new THREE.Vector3()) ?? null;
  }

  jointOf(id: string, name: 'shoulderR' | 'hipL' | 'hipR' | 'head'): THREE.Vector3 | null {
    return this.map.get(id)?.rig[name].getWorldPosition(new THREE.Vector3()) ?? null;
  }

  update(dt: number, camera: THREE.Camera): void {
    const k = 1 - Math.exp(-FOLLOW * dt);
    const now = performance.now();
    for (const a of this.map.values()) {
      if (!a.seen) continue;
      const g = a.group;
      const px = g.position.x;
      const pz = g.position.z;
      const ahead = Math.min(0.15, (now - a.poseAt) / 1000); // 자세 사이를 속도로 이어 뚝뚝 끊김을 줄임 (최대 0.15 s 앞)
      g.position.x += (a.target.x + a.vx * ahead - g.position.x) * k;
      g.position.z += (a.target.z + a.vz * ahead - g.position.z) * k;
      let d = a.target.yaw - g.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d)); // −π ~ π (돌아가는 짧은 쪽으로)
      g.rotation.y += d * k;
      // ---- 모션: 실제로 움직인 만큼으로 이동 속도를 구한다 (지수 평활 0.15 s) ----
      if (dt > 0) {
        const sm = 1 - Math.exp(-dt / 0.15);
        a.mvx += ((g.position.x - px) / dt - a.mvx) * sm;
        a.mvz += ((g.position.z - pz) / dt - a.mvz) * sm;
        a.c += ((a.target.c ?? 0) - a.c) * (1 - Math.exp(-dt / 0.08));
        a.pitch += ((a.target.pitch ?? 0) - a.pitch) * (1 - Math.exp(-dt / 0.08));
        a.t += dt;
      }
      const o = stepMotion(a.motion, {
        x: g.position.x, z: g.position.z, vx: a.mvx, vz: a.mvz, headYaw: g.rotation.y, pitch: a.pitch, c: a.c, holding: !!a.held,
        reachAge: (now - a.reachAt) / 1000, reachPoint: a.reachPoint, t: a.t,
      }, dt);
      const r = a.rig;
      r.pelvis.position.set(0, o.pelvisY, 0);
      r.pelvis.rotation.y = wrapAngle(o.bodyYaw - g.rotation.y); // 몸 방향 (group은 고개 방향)
      r.torso.quaternion.copy(o.torso);
      r.torsoMesh.scale.y = 1 + o.breath;
      r.head.quaternion.copy(o.head);
      r.hipL.quaternion.copy(o.hip[0]);
      r.hipR.quaternion.copy(o.hip[1]);
      r.kneeL.quaternion.copy(o.knee[0]);
      r.kneeR.quaternion.copy(o.knee[1]);
      r.shoulderL.quaternion.copy(o.shoulder[0]);
      r.shoulderR.quaternion.copy(o.shoulder[1]);
      r.elbowL.quaternion.copy(o.elbow[0]);
      r.elbowR.quaternion.copy(o.elbow[1]);
      r.flapL.rotation.x = o.flap[0];
      r.flapR.rotation.x = o.flap[1];
      g.updateMatrixWorld(true);
      // 든 기구는 팔이 돌아도 몸 방향으로 똑바로: 앵커의 세계 회전 = 몸 방향 yaw
      r.elbowR.getWorldQuaternion(_qe);
      a.anchor.quaternion.copy(_qe.invert()).multiply(_qy.setFromAxisAngle(_up, o.bodyYaw));
      a.anchor.updateMatrixWorld(true);
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
