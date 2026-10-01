/**
 * 1인칭 두 손: 남의 눈에 보이는 아바타 팔(net/avatars.ts buildArm)을 카메라에 붙여 내 화면에도 그린다.
 *   - 같은 모션 계산: 손 뻗기 시간표(reachBlend)·목표(reachWorldTarget)·2마디 IK(ik2)를 아바타와 그대로 쓴다 → 내가 본 손 = 남이 본 손
 *   - 레이어 HELD_LAYER(1): 벽에 묻히지 않고, 광선 판정(레이어 0만 봄)에서 저절로 빠진다
 *   - 든 기구는 hand.ts가 정한 자리 그대로 → 오른손이 기구 오른쪽 옆 아래(경계 상자 오른쪽 면에서 7 cm 옆)로, 큰 기구는 왼손도 왼쪽 옆을 받친다
 *   - 빈손이면 손은 화면 아래(어깨 뒤)로 내려가 안 보인다 (조이스틱·시야 가림 방지). 카메라는 흔들지 않는다 (탭 멀미, 광학 정렬 정밀도)
 * 카메라 좌표: x 오른쪽 · y 위 · −z 앞 (아바타 몸통 좌표와 같은 방향이라 ik2 극 벡터도 같다)
 */
import * as THREE from 'three';
import { buildArm, type ArmRig } from '../net/avatars';
import { ik2, reachBlend, REACH_OUT, REACH_HOLD, reachWorldTarget, UPPER, FORE } from '../net/avatarMotion';
import { HELD_LAYER } from './hand';
import { HITBOX_MAT, type Item } from '../world/items';

/** 어깨 위치 (카메라 기준): 좌우 ±0.20 · 눈 아래 0.28 · 눈 뒤 0.10 */
const SH_X = 0.2;
const SH_Y = -0.28;
const SH_Z = 0.1;
/** 1인칭 장갑 폭 배율 (가까이 보이므로 화면을 덜 덮게) · 잡을 때 손을 기구 옆으로 띄우는 거리 (기구가 손에 가리지 않게) */
const GLOVE = 0.7;
const GRIP_OUT = 0.07;
/** 큰 기구(높이 > 0.3 m)는 왼손도 받친다 */
const TWO_HAND_H = 0.3;
const _inv = new THREE.Matrix4();
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _g = new THREE.Vector3();
const _w = new THREE.Vector3();

/** 오브젝트의 경계 상자를 카메라 좌표로 (메시 꼭짓점 8개씩, 판정용 숨은 상자는 뺀다) */
function cameraBox(obj: THREE.Object3D, inv: THREE.Matrix4, out: THREE.Box3): THREE.Box3 {
  out.makeEmpty();
  obj.updateWorldMatrix(true, true);
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o.material === HITBOX_MAT || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox!;
    _m.multiplyMatrices(inv, o.matrixWorld);
    for (let i = 0; i < 8; i++) out.expandByPoint(_p.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(_m));
  });
  return out;
}

export class FpHands {
  readonly root = new THREE.Group();
  private mat = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xdddddd }); // 재질 색 순백이면 팔레트 검사에 걸림
  private arms!: [ArmRig, ArmRig]; // 왼 · 오른
  private color = -1;
  /** 손이 기구를 잡은 정도 (왼 · 오른, 0 ~ 1) */
  private grab = [0, 0];
  private reachAt = -Infinity;
  private reachSpeed = 1;
  private reachPoint: THREE.Vector3 | null = null;
  private lastX = NaN;
  private lastZ = NaN;
  private phase = 0;
  private amp = 0;
  private gripFor: Item | null = null;
  private box = new THREE.Box3();
  private pole = [new THREE.Vector3(-0.25, -0.35, 1), new THREE.Vector3(0.25, -0.35, 1)];

  constructor(private camera: THREE.PerspectiveCamera, private retro: (root: THREE.Object3D) => void) {
    this.root.position.set(0, 0, SH_Z);
    this.root.userData.noPick = true;
    camera.add(this.root);
    this.build(0x888888);
  }

  /** 팔을 (다시) 만든다: 식별 색 띠가 내 색이 되도록 */
  private build(color: number): void {
    this.color = color;
    for (const a of this.arms ?? []) {
      a.shoulder.removeFromParent();
      a.shoulder.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    }
    this.arms = [buildArm(-1, color, this.mat, this.root, -SH_X, SH_Y, GLOVE), buildArm(1, color, this.mat, this.root, SH_X, SH_Y, GLOVE)];
    this.root.traverse((o) => { o.layers.set(HELD_LAYER); o.userData.noPick = true; });
    this.retro(this.root);
  }

  /** 내가 방금 무언가를 조작했다 → 오른손을 그 자리로 뻗는다 (아바타와 같은 시간표) */
  reach(point?: THREE.Vector3 | null, speed = 1, keep = false): void {
    const now = performance.now();
    // keep: 미세 조정처럼 연달아 오는 호출 — 뻗는 중이면 다시 처음부터 하지 않는다 (뻗는 도중이면 그대로 이어서, 멈춤 구간이면 완전히 뻗은 시점으로 되돌려 멈춤을 다시 시작)
    const age = ((now - this.reachAt) / 1000) * this.reachSpeed;
    this.reachAt = keep && age < REACH_OUT + REACH_HOLD ? now - (Math.min(age, REACH_OUT) / speed) * 1000 : now;
    this.reachSpeed = speed;
    this.reachPoint = point ?? null;
  }

  /** 지금 뻗은 정도 0 ~ 1 (테스트·디버그) */
  reachK(): number {
    return reachBlend(((performance.now() - this.reachAt) / 1000) * this.reachSpeed);
  }

  update(dt: number, held: Item | null, visible: boolean, color: number): void {
    this.root.visible = visible;
    if (!visible) return;
    if (color !== this.color) this.build(color);
    const cam = this.camera;
    cam.updateMatrixWorld(true);
    _inv.copy(cam.matrixWorld).invert();

    // ---- 내 걸음 위상 (아바타와 같은 걸음 빈도 식 f = 0.55 + 0.45 v): 손이 살짝 흔들린다 ----
    const v = dt > 0 && Number.isFinite(this.lastX) ? Math.hypot(cam.position.x - this.lastX, cam.position.z - this.lastZ) / dt : 0;
    this.lastX = cam.position.x;
    this.lastZ = cam.position.z;
    const vm = Math.min(v, 4);
    this.amp += ((vm > 0.15 ? 1 : 0) - this.amp) * (1 - Math.exp(-dt / 0.15));
    if (this.amp > 0.01) this.phase += (0.55 + 0.45 * vm) * dt;
    const bob = Math.sin(2 * Math.PI * this.phase) * 0.012 * this.amp;
    const sway = Math.cos(2 * Math.PI * this.phase) * 0.008 * this.amp;

    // ---- 든 기구의 잡을 점 (카메라 좌표, 기구가 바뀔 때만 계산) ----
    const gripR = _g;
    const gripL = _w;
    let two = false;
    if (held) {
      if (held !== this.gripFor) {
        this.gripFor = held;
        cameraBox(held.object, _inv, this.box);
      }
      const b = this.box;
      const sy = b.max.y - b.min.y;
      const cz = (b.min.z + b.max.z) / 2;
      gripR.set(b.max.x + GRIP_OUT, b.min.y + 0.3 * sy, cz);
      two = sy > TWO_HAND_H;
      gripL.set(b.min.x - GRIP_OUT, b.min.y + 0.3 * sy, cz);
    } else this.gripFor = null;
    this.grab[0] += ((held && two ? 1 : 0) - this.grab[0]) * (1 - Math.exp(-dt / 0.15));
    this.grab[1] += ((held ? 1 : 0) - this.grab[1]) * (1 - Math.exp(-dt / 0.15));

    // ---- 손 목표 → ik2 (어깨 기준) ----
    const k = reachBlend(((performance.now() - this.reachAt) / 1000) * this.reachSpeed);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      // 쉼: 어깨 아래 · 약간 뒤 (화면 아래로 사라짐), 걸으면 살짝 흔들림
      _t.set(side * 0.04 + sway * side, -(UPPER + FORE) * 0.95 + bob, -0.02);
      if (held) {
        const g = i === 0 ? gripL : gripR;
        _p.set(g.x - (side * SH_X), g.y - SH_Y, g.z - SH_Z);
        _t.lerp(_p, this.grab[i]);
      }
      if (i === 1 && k > 0) {
        reachWorldTarget(this.reachPoint, cam.position.x, cam.position.z, cam.rotation.y, _p);
        _p.applyMatrix4(_inv);
        _p.set(_p.x - SH_X, _p.y - SH_Y, _p.z - SH_Z);
        _t.lerp(_p, k);
      }
      ik2(_t, UPPER, FORE, this.pole[i], this.arms[i].shoulder.quaternion, this.arms[i].elbow.quaternion);
    }
  }

  /** 테스트·디버그: 오른손 끝(카메라 좌표) · 오른손이 잡으러 가는 점 */
  handTip(side: 0 | 1 = 1): THREE.Vector3 {
    this.camera.updateMatrixWorld(true);
    this.arms[side].anchor.updateWorldMatrix(true, false);
    return this.arms[side].anchor.getWorldPosition(new THREE.Vector3()).applyMatrix4(_inv.copy(this.camera.matrixWorld).invert());
  }
}
