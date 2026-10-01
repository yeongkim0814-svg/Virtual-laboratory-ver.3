/**
 * 아바타 모션 (순수 계산, DOM 없음): 위치·속도·고개·앉기·든 기구·손 뻗기 → 관절 회전(쿼터니언). 뼈대 메시 없이 Group 관절을 코드로 돌린다.
 * 설계: PLAN.md 6.4 B.
 *
 * 걷기 = 발 디딤: 디딘 발은 세계 좌표 고정점(미끄럼 0), 뜬 발은 뗀 자리 → 다음 디딜 자리로 호를 그리며 간다.
 *   다리는 2마디 IK(`ik2`)로 엉덩이~발목에 맞추고, 골반 높이는 디딘 발마다 역진자 √(L_e² − x²) + 발목 + 0.06 의 최솟값 (걷기)
 *   또는 용수철–질량(뛰기: 디딤 한가운데 가장 낮고 두 발 뜬 구간은 포물선)에서 저절로 나온다. 걷기↔뛰기는 프루드 수 Fr = v²/(gL)로 섞는다.
 *
 * 좌표: 몸 앞 = −z, 관절 그룹의 쉼 방향은 아래(−y). 방향각 ψ는 y축 회전 (앞 = (−sin ψ, −cos ψ), 오른쪽 = (cos ψ, −sin ψ)).
 */
import * as THREE from 'three';

// ---- 치수 (m) — avatars.ts buildRig와 같은 값 ----
export const THIGH = 0.4;
export const SHIN = 0.4; // 무릎 ~ 발목
export const ANKLE_H = 0.07; // 발목 높이 (발바닥 ~ 발목)
export const HIP_X = 0.13; // 엉덩이 관절 좌우 (굵은 다리가 맞닿을 만큼)
export const HIP_DROP = 0.06; // 골반 ~ 엉덩이 관절 (아래)
export const LEG = 0.8; // 다리 길이 L (넓적다리 + 정강이)
export const L_E = 0.98 * LEG; // 곧은 다리의 유효 길이 (IK가 d를 0.98(L₁+L₂)로 자르는 값과 같다)
export const NECK_Y = 0.48; // 골반 ~ 목
export const SHOULDER_X = 0.31; // 넓은 어깨 (굵은 팔이 몸통 옆에 늘어지도록)
export const SHOULDER_Y = 0.45;
export const UPPER = 0.29; // 위팔
export const FORE = 0.35; // 팔꿈치 ~ 손끝 (아래팔 0.26 + 손 0.09)
export const STAND_Y = 0.93;
export const CROUCH_Y = 0.45;
const G = 9.81;

/** 손 뻗기 시간표 (s): 뻗기(ease-out) · 멈춤 · 돌아옴 */
export const REACH_OUT = 0.25;
export const REACH_HOLD = 0.15;
export const REACH_BACK = 0.3;
export const REACH_TIME = REACH_OUT + REACH_HOLD + REACH_BACK;
/** 집기만 시간표를 이 배로 빨리 (0.7 s → 0.35 s): 물체가 빨리 손에 들어오게 */
export const PICK_SPEED = 2;

const GAIT_ON = 0.15; // 걸음 시계가 도는 속도 문턱 (m/s) · 멈춤 문턱 (겹침으로 떨림 방지)
const GAIT_OFF = 0.08;
const STEP_DEV = 0.18; // 서 있을 때 발이 쉼 자리에서 이만큼 벗어나면 한 걸음
const SETTLE_T = 0.3; // 정리 걸음 시간 (s)
const SWING_H = 0.07; // 뜬 발 높이
const HEEL_H = 0.04; // 발뒤꿈치 들기
const FOLLOW_TURN = 0.8727; // 50°: 이보다 고개가 돌아가면 몸이 따라 돈다
const MAX_NECK = 1.22; // 70°
const MAX_PITCH = 1.05; // 60°
const REACH_LEAN = 0.436; // 25°

export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const follow = (dt: number, tau: number) => 1 - Math.exp(-dt / tau);
const frac = (x: number) => x - Math.floor(x);
const smooth = (x: number) => x * x * (3 - 2 * x);
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

const AX_Y = new THREE.Vector3(0, 1, 0);
const AX_X = new THREE.Vector3(1, 0, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

// ---------------------------------------------------------------- 2마디 IK (다리·팔 공용)

const _u = new THREE.Vector3();
const _p = new THREE.Vector3();
const _m = new THREE.Vector3();
const _b = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const _qi = new THREE.Quaternion();

/**
 * 뿌리 관절 원점에서 target(뿌리 좌표)에 끝을 맞추는 2마디 IK. 결과는 관절 Group의 quaternion (쉼 방향 = −y).
 * 가운데 관절(무릎·팔꿈치)은 pole 쪽으로 튀어나온다 (무릎 = 앞 (0,0,−1), 팔꿈치 = 뒤·아래).
 * 뿌리 회전은 완전한 기저(−y = 위마디 방향, 접는 축 = x)로 만들어 가운데 관절이 x축 회전만 하게 한다 (비틀림 없음).
 * 목표 거리 d는 [0.05, 0.98(L₁+L₂)]로 잘린다 → 닿지 못하면 목표 방향으로 최대한 뻗는다. 반환 = 실제 거리. mid = 가운데 관절 위치(선택).
 */
export function ik2(target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, qRoot: THREE.Quaternion, qMid: THREE.Quaternion, mid?: THREE.Vector3): number {
  const d0 = target.length();
  const d = clamp(d0, 0.05, 0.98 * (l1 + l2));
  if (d0 > 1e-6) _u.copy(target).divideScalar(d0);
  else _u.copy(DOWN);
  // 극 벡터를 u에 수직으로
  _p.copy(pole).addScaledVector(_u, -pole.dot(_u));
  if (_p.lengthSq() < 1e-8) _p.set(0, 0, 1).addScaledVector(_u, -_u.z);
  if (_p.lengthSq() < 1e-8) _p.set(1, 0, 0);
  _p.normalize();
  // 코사인 법칙: 뿌리에서 위마디가 목표 방향과 이루는 각 α
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _m.copy(_u).multiplyScalar(cosA * l1).addScaledVector(_p, sinA * l1);
  mid?.copy(_m);
  // 위마디 방향 a = m / l1. 기저: y = −a, z = 극 쪽 성분(뒤를 향하게 부호 정함), x = y × z
  _y.copy(_m).divideScalar(-l1);
  _z.copy(_p).addScaledVector(_y, -_p.dot(_y));
  if (_z.lengthSq() < 1e-10) _z.set(0, 0, 1);
  _z.normalize();
  const flip = _z.z < 0; // 쉼 자세에서 +z는 뒤 → 앞쪽 극(무릎)이면 뒤집어 기저를 몸 방향과 맞춘다
  if (flip) _z.negate();
  _x.crossVectors(_y, _z);
  qRoot.setFromRotationMatrix(_mat.makeBasis(_x, _y, _z));
  // 아래마디 방향을 뿌리 좌표로 → 가운데 관절 회전 (x축 회전)
  _b.copy(_u).multiplyScalar(d).sub(_m).divideScalar(l2);
  _qi.copy(qRoot).invert();
  _b.applyQuaternion(_qi);
  qMid.setFromUnitVectors(DOWN, _b);
  return d;
}

// ---------------------------------------------------------------- 손 뻗기 시간표 · 목표

/** 명령 뒤 지난 시간 age(s) → 뻗은 정도 0 ~ 1 (0 ~ 0.25 s 뻗기 ease-out · 0.15 s 멈춤 · 0.3 s 돌아옴 ease-in-out) */
export function reachBlend(age: number): number {
  if (!(age >= 0) || age >= REACH_TIME) return 0;
  if (age < REACH_OUT) {
    const u = age / REACH_OUT;
    return 1 - (1 - u) * (1 - u);
  }
  if (age < REACH_OUT + REACH_HOLD) return 1;
  return 1 - smooth((age - REACH_OUT - REACH_HOLD) / REACH_BACK);
}

/** 손 뻗을 세계 좌표: 받은 점, 없으면 몸 앞 0.5 m · 가슴 높이 (x, z = 몸 위치, yaw = 몸 방향) */
export function reachWorldTarget(point: THREE.Vector3 | null | undefined, x: number, z: number, yaw: number, out: THREE.Vector3): THREE.Vector3 {
  if (point) return out.copy(point);
  return out.set(x - Math.sin(yaw) * 0.5, 1.2, z - Math.cos(yaw) * 0.5);
}

// ---------------------------------------------------------------- 상태 · 입출력

export interface MotionIn {
  /** 골반 세계 위치 (x, z) · 이동 속도 (m/s, 평활) */
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** 받은 고개 방향 (rad) · 시선 위아래 (rad, + = 위) · 앉은 정도 0 ~ 1 */
  headYaw: number;
  pitch: number;
  c: number;
  holding: boolean;
  /** 손 뻗기: 명령 뒤 지난 시간 (s), 없으면 Infinity · 뻗을 세계 좌표 (없으면 몸 앞 0.5 m) */
  reachAge: number;
  reachPoint: THREE.Vector3 | null;
  /** 누적 시간 (s) — 숨쉬기 */
  t: number;
}

export interface Foot {
  /** 발목 세계 위치 (그리는 값) */
  pos: THREE.Vector3;
  /** 디딘 자리 (세계, 디딤 동안 고정) · 뗀 자리 */
  plant: THREE.Vector3;
  from: THREE.Vector3;
  stance: boolean;
  /** 뜬 발 진행 0 ~ 1 · 디딤 진행 0 ~ 1 */
  s: number;
  p: number;
}

export interface MotionOut {
  /** 골반 높이 (m) · 몸 방향 (세계 yaw) */
  pelvisY: number;
  bodyYaw: number;
  /** 골반 기준 몸통 · 몸통 기준 머리 */
  torso: THREE.Quaternion;
  head: THREE.Quaternion;
  /** 다리 [왼, 오른]: 엉덩이 · 무릎 관절 회전 */
  hip: THREE.Quaternion[];
  knee: THREE.Quaternion[];
  /** 팔 [왼, 오른]: 어깨 · 팔꿈치 관절 회전 */
  shoulder: THREE.Quaternion[];
  elbow: THREE.Quaternion[];
  /** 가운 자락 앞뒤 각 (rad) · 몸통 숨쉬기 비율 */
  breath: number;
  /** 지금 디딘 발 · 두 발 다 뜬 구간(뛰기) */
  stance: boolean[];
  flight: boolean;
  /** 디딤 비율 β · 걸음 빈도 f (Hz) · 프루드 수 */
  beta: number;
  freq: number;
  fr: number;
  /** 뻗은 정도 0 ~ 1 */
  reachK: number;
}

export interface MotionState {
  init: boolean;
  /** 걸음 시계가 도는 중 · 위상 [0,1) · 누적 주기 수 (펼친 값) */
  gait: boolean;
  phase: number;
  cycles: number;
  bodyYaw: number;
  catchUp: boolean;
  hold: number;
  feet: Foot[];
  yStance: number;
  flightT: number;
  out: MotionOut;
}

const newFoot = (): Foot => ({ pos: new THREE.Vector3(), plant: new THREE.Vector3(), from: new THREE.Vector3(), stance: true, s: 0, p: 0 });
const quats = () => [new THREE.Quaternion(), new THREE.Quaternion()];

export const newMotion = (): MotionState => ({
  init: false, gait: false, phase: 0, cycles: 0, bodyYaw: 0, catchUp: false, hold: 0, feet: [newFoot(), newFoot()], yStance: STAND_Y, flightT: 0,
  out: {
    pelvisY: STAND_Y, bodyYaw: 0, torso: new THREE.Quaternion(), head: new THREE.Quaternion(), hip: quats(), knee: quats(), shoulder: quats(), elbow: quats(),
    breath: 0, stance: [true, true], flight: false, beta: 0.6, freq: 0, fr: 0, reachK: 0,
  },
});

/** 걸음 변수: 프루드 수 → 디딤 비율 β (걷기 0.6 ↔ 뛰기 0.4), 섞임 u (0 = 걷기, 1 = 뛰기), 빈도 f */
export function gaitParams(v: number): { fr: number; beta: number; u: number; f: number } {
  const fr = (v * v) / (G * LEG);
  const u = clamp((fr - 0.4) / 0.2, 0, 1);
  return { fr, beta: 0.6 - 0.2 * u, u, f: 0.55 + 0.45 * v };
}

// ---------------------------------------------------------------- 한 프레임

const POLE_KNEE = new THREE.Vector3(0, 0, -1);
const _pole = new THREE.Vector3();
const _t = new THREE.Vector3();
const _w = new THREE.Vector3();
const _sh = new THREE.Vector3();
const _hand = new THREE.Vector3();
const _hold = new THREE.Vector3(0.12, SHOULDER_Y - 0.25, -0.3); // 든 자세 오른손: 몸 앞 0.30 · 가슴 아래 0.25 (몸통 좌표)
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qBody = new THREE.Quaternion();
const _qTW = new THREE.Quaternion();

/** 디딤 끝 40 %에서 발뒤꿈치 들기 (발목 +0.04) */
const heel = (p: number) => HEEL_H * smooth(clamp((p - 0.6) / 0.4, 0, 1));

function restSpot(i: number, m: MotionIn, psi: number, out: THREE.Vector3): THREE.Vector3 {
  const side = i === 0 ? -1 : 1;
  return out.set(m.x + Math.cos(psi) * side * HIP_X, 0, m.z - Math.sin(psi) * side * HIP_X);
}

export function stepMotion(s: MotionState, m: MotionIn, dt: number): MotionOut {
  dt = clamp(dt, 0, 0.1);
  const o = s.out;
  const speed = Math.hypot(m.vx, m.vz);
  const c = clamp(m.c, 0, 1);

  // ---- 처음: 몸은 고개 방향, 발은 엉덩이 아래 ----
  if (!s.init) {
    s.init = true;
    s.bodyYaw = m.headYaw;
    for (let i = 0; i < 2; i++) {
      const f = s.feet[i];
      restSpot(i, m, s.bodyYaw, f.plant);
      f.plant.y = ANKLE_H;
      f.pos.copy(f.plant);
      f.from.copy(f.plant);
      f.stance = true;
    }
  }

  // ---- 1) 몸 방향: 움직이면 고개를 τ 0.15 s로 따라가고, 서 있으면 50° 넘을 때만 τ 0.25 s로 따라 돈다 (거의 0이 될 때까지) ----
  const diff = wrapAngle(m.headYaw - s.bodyYaw);
  if (s.gait || speed >= GAIT_ON) {
    s.bodyYaw += diff * follow(dt, 0.15);
    s.catchUp = false;
  } else {
    if (Math.abs(diff) > FOLLOW_TURN) s.catchUp = true;
    else if (Math.abs(diff) < 0.05) s.catchUp = false;
    if (s.catchUp) s.bodyYaw += diff * follow(dt, 0.25);
  }
  const psi = s.bodyYaw;
  const rx = Math.cos(psi);
  const rz = -Math.sin(psi);

  // ---- 2) 걸음 시계 ----
  const gp = gaitParams(speed);
  const f = gp.f;
  const beta = gp.beta;
  if (!s.gait && speed >= GAIT_ON) {
    s.gait = true;
    // 이미 뜬 발이 있으면 그 진행에 이어 붙인다 (튐 방지). 둘 다 디뎠으면 왼발부터
    const k = s.feet[0].stance ? (s.feet[1].stance ? -1 : 1) : 0;
    s.phase = k < 0 ? beta : frac(beta + s.feet[k].s * (1 - beta) - 0.5 * k + 1);
  } else if (s.gait && speed < GAIT_OFF) {
    s.gait = false;
  }
  if (s.gait) {
    s.phase = frac(s.phase + f * dt);
    s.cycles += f * dt;
  }

  // ---- 3) 발 디딤 ----
  const feet = s.feet;
  for (let i = 0; i < 2; i++) {
    const ft = feet[i];
    const side = i === 0 ? -1 : 1;
    if (s.gait) {
      const ph = frac(s.phase + 0.5 * i);
      const want = ph < beta;
      if (ft.stance && !want) {
        ft.from.copy(ft.pos);
        ft.stance = false;
      }
      // 다음 디딜 자리 = 착지 순간 예상 골반 위치 + 디딤 절반만큼 앞 + 좌우 ±0.10 (레이버트식 발 놓기)
      const swing = !want ? clamp((ph - beta) / (1 - beta), 0, 1) : 1;
      const tLeft = (1 - swing) * ((1 - beta) / f) + beta / (2 * f);
      const tx = m.x + m.vx * tLeft + rx * side * HIP_X;
      const tz = m.z + m.vz * tLeft + rz * side * HIP_X;
      if (!ft.stance && want) {
        ft.plant.set(tx, ANKLE_H, tz); // 착지: 이 점에 고정
        ft.stance = true;
      }
      if (ft.stance) {
        ft.p = clamp(ph / beta, 0, 1);
        ft.pos.set(ft.plant.x, ANKLE_H + heel(ft.p), ft.plant.z);
      } else {
        ft.s = swing;
        ft.p = 0;
        const e = smooth(swing);
        ft.pos.set(ft.from.x + (tx - ft.from.x) * e, ft.from.y + (ANKLE_H - ft.from.y) * e + SWING_H * Math.sin(Math.PI * swing), ft.from.z + (tz - ft.from.z) * e);
      }
    } else {
      restSpot(i, m, psi, _t);
      if (!ft.stance) {
        // 정리 걸음: 쉼 자리로 (시간 기준)
        ft.s = Math.min(1, ft.s + dt / SETTLE_T);
        if (ft.s >= 1) {
          ft.plant.set(_t.x, ANKLE_H, _t.z);
          ft.stance = true;
          ft.pos.copy(ft.plant);
        } else {
          const e = smooth(ft.s);
          ft.pos.set(ft.from.x + (_t.x - ft.from.x) * e, ft.from.y + (ANKLE_H - ft.from.y) * e + SWING_H * Math.sin(Math.PI * ft.s), ft.from.z + (_t.z - ft.from.z) * e);
        }
      } else {
        ft.pos.set(ft.plant.x, ANKLE_H, ft.plant.z);
      }
      ft.p = 0;
    }
  }
  if (!s.gait && feet[0].stance && feet[1].stance) {
    // 제자리에서 멀리 순간이동했거나 몸이 돌아 발이 쉼 자리에서 벗어나면 한 걸음 (한 번에 한 발)
    restSpot(0, m, psi, _t);
    const dev0 = Math.hypot(feet[0].plant.x - _t.x, feet[0].plant.z - _t.z);
    restSpot(1, m, psi, _w);
    const dev1 = Math.hypot(feet[1].plant.x - _w.x, feet[1].plant.z - _w.z);
    if (Math.max(dev0, dev1) > 1) {
      for (let i = 0; i < 2; i++) {
        restSpot(i, m, psi, feet[i].plant);
        feet[i].plant.y = ANKLE_H;
        feet[i].pos.copy(feet[i].plant);
      }
    } else if (Math.max(dev0, dev1) > STEP_DEV) {
      const k = dev0 > dev1 ? 0 : 1;
      feet[k].from.copy(feet[k].pos);
      feet[k].stance = false;
      feet[k].s = 0;
    }
  }
  // 걷는 중 순간이동: 발이 엉덩이에서 너무 멀면 다시 심는다
  if (s.gait) {
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      if (Math.hypot(feet[i].pos.x - (m.x + rx * side * HIP_X), feet[i].pos.z - (m.z + rz * side * HIP_X)) > 1.2) {
        restSpot(i, m, psi, feet[i].plant);
        feet[i].plant.y = ANKLE_H;
        feet[i].pos.copy(feet[i].plant);
        feet[i].from.copy(feet[i].plant);
      }
    }
  }
  o.stance[0] = feet[0].stance;
  o.stance[1] = feet[1].stance;

  // ---- 4) 골반 높이: 걷기 = 역진자, 뛰기 = 용수철–질량 (Fr로 섞음), 뜬 구간 = 포물선 ----
  const u = s.gait ? gp.u : 0;
  let y = Infinity;
  let anyStance = false;
  for (let i = 0; i < 2; i++) {
    const ft = feet[i];
    if (!ft.stance) continue;
    anyStance = true;
    const side = i === 0 ? -1 : 1;
    const xh = Math.hypot(ft.pos.x - (m.x + rx * side * HIP_X), ft.pos.z - (m.z + rz * side * HIP_X));
    const yw = Math.sqrt(Math.max(0, L_E * L_E - xh * xh)) + ft.pos.y + HIP_DROP;
    let yi = yw;
    if (u > 0) {
      const yr = 0.9 - 0.035 * Math.sin(Math.PI * ft.p);
      yi = Math.min(yw, (1 - u) * yw + u * yr); // 다리가 닿는 높이를 넘지 않게 (아래 설명 참고)
    }
    y = Math.min(y, yi);
  }
  let flight = false;
  if (anyStance) {
    y = Math.min(y, STAND_Y);
    s.yStance = y;
    s.flightT = 0;
  } else if (s.gait) {
    flight = true;
    s.flightT += dt;
    const tf = Math.max(0, (0.5 - beta) / f);
    const tt = Math.min(s.flightT, tf);
    y = s.yStance + 0.5 * G * tt * (tf - tt);
  } else {
    y = s.yStance;
  }
  y += (CROUCH_Y - y) * c;
  o.pelvisY = y;
  o.flight = flight;
  o.beta = beta;
  o.freq = s.gait ? f : 0;
  o.fr = gp.fr;
  o.bodyYaw = psi;

  // ---- 5) 다리 IK (엉덩이 관절 좌표 = 골반 좌표: 몸 방향만 돌아 있음) ----
  const cs = Math.cos(psi);
  const sn = Math.sin(psi);
  const hipAng = [0, 0];
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const hx = m.x + rx * side * HIP_X;
    const hz = m.z + rz * side * HIP_X;
    const dx = feet[i].pos.x - hx;
    const dy = feet[i].pos.y - (y - HIP_DROP);
    const dz = feet[i].pos.z - hz;
    _t.set(cs * dx - sn * dz, dy, sn * dx + cs * dz);
    ik2(_t, THIGH, SHIN, POLE_KNEE, o.hip[i], o.knee[i], _m);
    hipAng[i] = Math.atan2(-_m.z, -_m.y);
  }

  // ---- 6) 몸통 · 머리 · 손 뻗기 (몸통 기울기·돌림이 정해진 뒤 팔 IK) ----
  s.hold += ((m.holding ? 1 : 0) - s.hold) * follow(dt, 0.15);
  const k = reachBlend(m.reachAge);
  o.reachK = k;
  const pitch = clamp(m.pitch, -MAX_PITCH, MAX_PITCH);
  let lean = 0.35 * c + 0.08 * u; // 앉으면 몸통 앞 20°
  let twist = 0;
  const reachT = _w;
  if (k > 0) {
    reachWorldTarget(m.reachPoint, m.x, m.z, psi, reachT);
    // 팔 길이 밖이면 몸통을 그쪽으로 최대 25° 숙이고 돌린다 (남은 만큼은 못 닿음)
    _sh.set(SHOULDER_X, SHOULDER_Y, 0).applyAxisAngle(AX_Y, psi);
    const ex = reachT.x - (m.x + _sh.x);
    const ey = reachT.y - (y + _sh.y);
    const ez = reachT.z - (m.z + _sh.z);
    const excess = Math.hypot(ex, ey, ez) - 0.6;
    if (excess > 0) {
      lean += Math.min(REACH_LEAN, excess * 2) * k;
      const rel = wrapAngle(Math.atan2(-ex, -ez) - psi);
      twist = clamp(rel, -REACH_LEAN, REACH_LEAN) * k * Math.min(1, excess / 0.1);
    }
  }
  const torsoX = -lean + 0.3 * pitch;
  _qa.setFromAxisAngle(AX_Y, twist);
  _qb.setFromAxisAngle(AX_X, torsoX);
  o.torso.copy(_qa).multiply(_qb);
  const neck = clamp(wrapAngle(m.headYaw - psi - twist), -MAX_NECK, MAX_NECK);
  _qa.setFromAxisAngle(AX_Y, neck);
  _qb.setFromAxisAngle(AX_X, 0.7 * pitch + lean);
  o.head.copy(_qa).multiply(_qb);
  o.breath = 0.015 * Math.sin(2 * Math.PI * 0.25 * m.t) * (1 - Math.min(1, speed / 0.5)) * (1 - c);

  // 팔: 손 목표(몸통 좌표) → ik2. 걸을 때 반대 다리 엉덩이 각의 0.6배로 흔들고(팔꿈치 0.25 rad 기본 굽힘), 들면 몸 앞 받침, 뻗으면 실제 목표로
  _qBody.setFromAxisAngle(AX_Y, psi);
  _qTW.copy(_qBody).multiply(o.torso).invert();
  const elbowBase = 0.25 + 0.6 * u;
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const theta = 0.6 * hipAng[1 - i] * (1 - c) * (i === 1 ? 1 - s.hold : 1);
    const th2 = theta + elbowBase;
    // 쉼·흔들기 자세의 손끝 (어깨 기준)
    _hand.set(side * 0.035, -UPPER * Math.cos(theta) - FORE * Math.cos(th2), -UPPER * Math.sin(theta) - FORE * Math.sin(th2));
    _hand.x += side * SHOULDER_X;
    _hand.y += SHOULDER_Y;
    if (i === 1) {
      _hand.lerp(_hold, s.hold);
      if (k > 0) {
        _t.copy(reachT).set(reachT.x - m.x, reachT.y - y, reachT.z - m.z).applyQuaternion(_qTW);
        _hand.lerp(_t, k);
      }
    }
    _hand.x -= side * SHOULDER_X;
    _hand.y -= SHOULDER_Y;
    _pole.set(side * 0.25, -0.35, 1);
    ik2(_hand, UPPER, FORE, _pole, o.shoulder[i], o.elbow[i]);
  }
  return o;
}
