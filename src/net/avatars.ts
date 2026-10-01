/**
 * 다른 참가자의 아바타: 낡은 안전 작업복 현장 기술자(올리브·카키 옷, 검은 바이저 헬멧, 사각 배낭) 상자 인형(마디 관절) + 머리 위 이름표
 *   - 자세(x, z, 방향, 고개, 앉기)는 방장 경유로 초당 10번 온다 → 여기서 부드럽게 따라가고, 움직임(걷기·돌기·숨쉬기·앉기·들기·손 뻗기)은
 *     위치 변화에서 net/avatarMotion.ts가 계산한다 (모델 파일·뼈대 메시 없음)
 *   - 몸 전체가 정점 색 상자 10개(+ 이름표 1) = 그리기 호출 11, 재질 하나
 *   - 손에 든 기구는 오른손에 붙는다 (다른 사람이 못 집도록 광선 판정에서 제외)
 *   - 광선에 맞지 않는다 (noPick): 뒤에 있는 기구를 탭할 수 있다
 */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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
  /** 받은 자세 사이 속도 (m/s)로 다음 자세가 오기 전까지 앞질러 간다 */
  vx: number;
  vz: number;
  poseAt: number;
  turn: number;
  c: number;
  pitch: number;
  t: number;
  reachAt: number;
}

// ---- 도형 도우미: 둥글린 상자 · 캡슐 · 공 · 곡선 관 (모두 색 입힌 같은 속성의 지오메트리라 한 덩어리로 합친다) ----

/** 값 잡음 (0 ~ 1): 바랜 천·얼룩 색 변화에 쓴다 */
const hash = (x: number, y: number, z: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return n - Math.floor(n);
};
function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const sm = (t: number) => t * t * (3 - 2 * t);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash(xi + dx, yi + dy, zi + dz);
  const u = sm(fx);
  const v2 = sm(fy);
  const w = sm(fz);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v2),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v2),
    w,
  );
}

/** 정점 색: 기본 색 × 바랜 얼룩(±12 %). uv는 안 쓰므로 지운다 */
function tint(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  g.deleteAttribute('uv');
  const pos = g.getAttribute('position');
  const base = new THREE.Color(color);
  const col = new THREE.Color();
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = 0.88 + 0.24 * (0.6 * vnoise(x * 9, y * 9, z * 9) + 0.4 * vnoise(x * 23 + 5, y * 23, z * 23));
    col.copy(base).multiplyScalar(k).toArray(arr, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** 모서리를 반지름 r로 둥글린 상자 + 이음매 없는 부드러운 법선 */
function rbox(w: number, h: number, d: number, r: number, x: number, y: number, z: number, color: number): THREE.BufferGeometry {
  r = Math.min(r, Math.min(w, h, d) / 2 - 0.002);
  const g = new THREE.BoxGeometry(w, h, d, 4, 4, 4);
  const p = g.getAttribute('position');
  const hx = w / 2 - r;
  const hy = h / 2 - r;
  const hz = d / 2 - r;
  const cl = (v: number, m: number) => Math.max(-m, Math.min(m, v));
  for (let i = 0; i < p.count; i++) {
    let X = p.getX(i);
    let Y = p.getY(i);
    let Z = p.getZ(i);
    const qx = cl(X, hx);
    const qy = cl(Y, hy);
    const qz = cl(Z, hz);
    const dx = X - qx;
    const dy = Y - qy;
    const dz = Z - qz;
    const len = Math.hypot(dx, dy, dz);
    if (len > 1e-9) {
      X = qx + (dx / len) * r;
      Y = qy + (dy / len) * r;
      Z = qz + (dz / len) * r;
    }
    p.setXYZ(i, X, Y, Z);
  }
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const m = mergeVertices(g, 1e-5);
  m.computeVertexNormals();
  m.translate(x, y, z);
  return tint(m, color);
}

/** 얇은 평판 (패치·라벨·환기구): 납작하게 */
const plate = (w: number, h: number, d: number, x: number, y: number, z: number, color: number) => tint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);

/** 세로 캡슐 (팔다리): 전체 길이 len + 2r, 가운데 y */
const cap = (r: number, len: number, y: number, color: number) => tint(new THREE.CapsuleGeometry(r, len, 3, 8).translate(0, y, 0), color);

/** 공 (납작하게 sy) */
const ball = (r: number, x: number, y: number, z: number, color: number, sx = 1, sy = 1, sz = 1) =>
  tint(new THREE.SphereGeometry(r, 9, 6).scale(sx, sy, sz).translate(x, y, z), color);

/** 속 빈 원통 띠 (헬멧 식별 띠) */
const band = (r: number, h: number, y: number, color: number) => tint(new THREE.CylinderGeometry(r, r, h, 14, 1, true).translate(0, y, 0), color);

const merge = (...g: THREE.BufferGeometry[]): THREE.BufferGeometry => mergeGeometries(g)!;

const joint = (parent: THREE.Object3D, x: number, y: number, z = 0): THREE.Group => {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
};

/**
 * 인형 만들기 (3.5등신, 부드러운 곡면): 앞(−z), 뒤(+z)에 배낭. 서 있을 때 키 약 1.75 m, 발바닥 y = 0.
 * 모서리를 둥글린 몸통·돔 헬멧·캡슐 팔다리·공 어깨와 무릎. 식별 색(띠·가슴 패치·소매 끝·장화 줄)은 사람마다 다르게
 */
function buildRig(color: number, mat: THREE.Material, group: THREE.Group): Rig {
  const accent = new THREE.Color(color).lerp(new THREE.Color(0x6a6048), 0.1).getHex();
  const mesh = (geo: THREE.BufferGeometry, parent: THREE.Object3D) => {
    const m = new THREE.Mesh(geo, mat);
    parent.add(m);
    return m;
  };
  const hose = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3([new THREE.Vector3(0.13, 0.08, 0.33), new THREE.Vector3(0.19, -0.03, 0.35), new THREE.Vector3(0.14, -0.1, 0.31), new THREE.Vector3(0.07, -0.06, 0.28)]),
    10, 0.02, 5,
  );
  const pelvis = joint(group, 0, 0.79);
  const torso = joint(pelvis, 0, 0.09);
  mesh(merge(
    rbox(0.44, 0.2, 0.29, 0.08, 0, -0.01, 0, KHAKI), // 허리·엉덩이
    rbox(0.48, 0.44, 0.31, 0.11, 0, 0.2, 0, KHAKI), // 굵은 몸통
    rbox(0.38, 0.27, 0.06, 0.05, 0, 0.24, -0.16, GREEN), // 올리브 가슴 판
    plate(0.12, 0.12, 0.012, 0.06, 0.27, -0.195, accent), // 가슴 식별 패치 (네모)
    plate(0.07, 0.045, 0.012, -0.11, 0.14, -0.195, 0xb59b24), // 작은 경고 라벨
    rbox(0.07, 0.4, 0.05, 0.02, -0.16, 0.2, -0.175, BLACK), // 멜빵
    rbox(0.07, 0.4, 0.05, 0.02, 0.16, 0.2, -0.175, BLACK),
    rbox(0.52, 0.08, 0.34, 0.035, 0, 0.04, 0, BLACK), // 벨트
    rbox(0.09, 0.11, 0.08, 0.03, -0.2, 0.04, -0.19, BLACK), // 벨트 주머니
    rbox(0.09, 0.11, 0.08, 0.03, 0.2, 0.04, -0.19, BLACK),
    rbox(0.5, 0.08, 0.33, 0.04, 0, 0.42, 0, GREEN), // 어깨 판
    rbox(0.36, 0.4, 0.18, 0.05, 0, 0.22, 0.24, PACK), // 사각 장비 배낭
    rbox(0.37, 0.06, 0.19, 0.03, 0, 0.44, 0.24, BLACK), // 배낭 윗덮개
    plate(0.05, 0.05, 0.012, 0.11, 0.34, 0.335, LIGHT), // 상태 표시등
    plate(0.16, 0.014, 0.012, -0.03, 0.08, 0.335, BLACK), // 환기구 홈
    plate(0.16, 0.014, 0.012, -0.03, 0.115, 0.335, BLACK),
    plate(0.16, 0.014, 0.012, -0.03, 0.15, 0.335, BLACK),
    tint(hose, BLACK), // 늘어진 호스
  ), torso);
  const head = joint(torso, 0, 0.42);
  mesh(merge(
    cap(0.075, 0.0, 0.03, BLACK), // 목 보호대
    ball(0.215, 0, 0.2, 0, HELM, 1.1, 0.95, 1.05), // 돔 헬멧
    band(0.208, 0.05, 0.3, accent), // 식별 띠
    rbox(0.38, 0.24, 0.08, 0.065, 0, 0.19, -0.18, HELM), // 바이저 틀
    rbox(0.33, 0.19, 0.06, 0.055, 0, 0.19, -0.212, VISOR), // 불투명 검은 바이저 (얼굴 없음)
    plate(0.22, 0.02, 0.006, -0.03, 0.255, -0.245, TEAL), // 어두운 청록 반사
    rbox(0.3, 0.07, 0.09, 0.03, 0, 0.05, -0.17, BLACK), // 턱 보호대
    rbox(0.06, 0.1, 0.11, 0.025, 0.225, 0.19, -0.04, SIDEPLATE), // 옆 바이저 판
    rbox(0.06, 0.1, 0.11, 0.025, -0.225, 0.19, -0.04, SIDEPLATE),
  ), head);
  const arm = (side: number) => {
    const shoulder = joint(torso, side * 0.33, 0.36);
    mesh(merge(cap(0.085, 0.07, -0.12, KHAKI), ball(0.115, 0, 0.0, 0, GREEN)), shoulder);
    const elbow = joint(shoulder, 0, -0.24);
    mesh(merge(
      cap(0.075, 0.05, -0.1, GREEN), // 올리브 아래팔
      band(0.082, 0.03, -0.185, accent), // 소매 끝 식별 띠
      rbox(0.17, 0.15, 0.17, 0.06, 0, -0.27, 0, BLACK), // 두꺼운 장갑
    ), elbow);
    return { shoulder, elbow };
  };
  const leg = (side: number) => {
    const hip = joint(pelvis, side * 0.12, -0.09);
    mesh(merge(
      cap(0.105, 0.09, -0.15, KHAKI),
      rbox(0.05, 0.14, 0.1, 0.02, side * 0.115, -0.12, 0, BLACK), // 허벅지 옆 주머니
    ), hip);
    const knee = joint(hip, 0, -0.3);
    mesh(merge(
      cap(0.09, 0.12, -0.15, GREEN),
      ball(0.11, 0, 0, -0.025, DGREEN, 1, 0.9, 1), // 무릎 보호대
      rbox(0.2, 0.15, 0.34, 0.06, 0, -0.325, -0.07, BLACK), // 큰 장화 (바닥 −0.40)
      rbox(0.21, 0.03, 0.15, 0.012, 0, -0.29, -0.12, accent), // 장화 식별 줄
    ), knee);
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
    const anchor = joint(rig.elbowR, 0, -0.36, -0.07);
    group.userData.noPick = true;
    group.visible = false; // 첫 자세를 받기 전에는 숨김
    this.retro(group);
    this.scene.add(group);
    a = {
      info, group, anchor, rig, motion: newMotion(), target: { x: 0, y: 0, z: 0, yaw: 0 }, held: null, seen: false,
      speed: 0, vx: 0, vz: 0, poseAt: 0, turn: 0, c: 0, pitch: 0, t: 0, reachAt: -Infinity,
    };
    this.map.set(info.id, a);
    return a;
  }

  setPose(info: PlayerInfo, pose: Pose): void {
    const a = this.ensure(info);
    const now = performance.now();
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

  /** 이 사람이 방금 무언가를 조작했다 → 오른팔을 앞으로 뻗는다 */
  reach(id: string): void {
    const a = this.map.get(id);
    if (a) a.reachAt = performance.now();
  }

  /** 테스트·디버그: 모션 상태 (걸음 위상 등) */
  motionOf(id: string): MotionState | null {
    return this.map.get(id)?.motion ?? null;
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
      const ahead = Math.min(0.15, (now - a.poseAt) / 1000); // 자세 사이를 속도로 이어 뚝뚝 끊김을 줄임 (최대 0.15 s 앞)
      g.position.x += (a.target.x + a.vx * ahead - g.position.x) * k;
      g.position.z += (a.target.z + a.vz * ahead - g.position.z) * k;
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
      r.pelvis.position.x = j.sway;
      r.torso.rotation.z = j.roll;
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
