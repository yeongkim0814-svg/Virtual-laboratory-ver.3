/**
 * 아바타 모션 (순수 계산): 이동 속도·회전·앉기·고개·든 기구 → 관절 각. 뼈대 메시 없이 상자 관절을 코드로 돌린다.
 *
 * 각도 규칙 (관절 그룹의 rotation.x, 라디안): 아래로 늘어진 팔다리는 + 이면 앞(−z)으로 흔들린다.
 *   위로 뻗은 몸통·머리는 − 이면 앞으로 숙인다 (몸통 기울이기), 머리는 + 이면 위를 본다.
 *
 * 걷기: 걸음 위상 φ가 걸음 빈도 1.15·√(v/1.4) Hz로 돈다 (1.4 m/s에서 한 주기 = 두 걸음 = 약 0.9 s) → 제자리에서는 멈춘다.
 *   엉덩이 각은 발이 땅에서 미끄러지지 않게 정한다: 한 주기에 발이 가는 거리 4·L·sin θ = v / f. 무릎은 다리가 앞으로 나올 때 굽힘, 팔은 반대 다리와 같은 박자.
 *   골반 높이 = 땅을 딛은(더 낮은) 다리의 길이로 정해 발이 땅에 붙는다 → 걸을 때 몸이 저절로 조금 오르내린다.
 */

export const THIGH = 0.3;
export const SHIN = 0.3;
export const FOOT = 0.1;
export const HIP_DROP = 0.09; // 골반 중심 ~ 엉덩이 관절
/** 걸을 때 엉덩이 각 상한 (rad) · 무릎 굽힘 · 팔 흔들기 */
const HIP_MAX = 0.55;
const KNEE_AMP = 0.85;
const ARM_AMP = 0.35;
const CROUCH_HIP = 1.48; // 85°
const CROUCH_KNEE = -2.27; // −130°
const HOLD_SHOULDER = 0.79; // 45°
const HOLD_ELBOW = 1.22; // 70°
const MAX_HEAD_YAW = 0.87; // 50°
const MAX_HEAD_PITCH = 1.05; // 60°
/** 손 뻗기 동작 길이 (s) */
export const REACH_TIME = 0.4;

export interface MotionIn {
  /** 이동 속도 (m/s) · 회전 속도 (rad/s) */
  speed: number;
  turn: number;
  /** 시선 위아래 (rad, + = 위) · 앉은 정도 0 ~ 1 */
  pitch: number;
  c: number;
  holding: boolean;
  /** 손 뻗기: 명령 뒤 지난 시간 (s), 없으면 Infinity */
  reachAge: number;
  /** 누적 시간 (s) — 숨쉬기 */
  t: number;
}

export interface MotionState {
  phase: number;
  amp: number;
  headYaw: number;
  hold: number;
}

export const newMotion = (): MotionState => ({ phase: 0, amp: 0, headYaw: 0, hold: 0 });

export interface Joints {
  pelvisY: number;
  torsoX: number;
  headX: number;
  headY: number;
  hipL: number;
  hipR: number;
  kneeL: number;
  kneeR: number;
  shoulderL: number;
  shoulderR: number;
  elbowL: number;
  elbowR: number;
  /** 몸통 위아래 크기 비율 (숨쉬기) */
  breath: number;
  /** 걸을 때 골반 좌우 이동 (m) · 몸통 좌우 기울기 (rad) */
  sway: number;
  roll: number;
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const follow = (dt: number, tau: number) => 1 - Math.exp(-dt / tau);

/** 다리 하나의 엉덩이 관절 높이 (m) */
export const legHeight = (hip: number, knee: number) => THIGH * Math.cos(hip) + SHIN * Math.cos(hip + knee) + FOOT;

export function stepMotion(s: MotionState, m: MotionIn, dt: number): Joints {
  // ---- 걷기 세기: 속도 0.05 m/s 아래는 0 (제자리 걸음 방지), 제자리에서 돌면 작게 디딤 ----
  const v = m.speed < 0.05 ? 0 : m.speed;
  const walk = clamp(v / 1.2, 0, 1);
  const spin = clamp(Math.abs(m.turn) / 1.5, 0, 1) * 0.3;
  const target = Math.max(walk, spin) * (1 - m.c);
  s.amp += (target - s.amp) * follow(dt, 0.1);
  // 걸음 빈도(주기/초): 1.4 m/s에서 1.15 Hz, 빨리 걸을수록 보폭이 늘어 √v로만 증가 (최대 2 Hz)
  const cadence = Math.min(2, 1.15 * Math.sqrt(v / 1.4));
  s.phase += Math.max(2 * Math.PI * cadence, Math.abs(m.turn) * 1.0) * dt;
  const sin = Math.sin(s.phase);
  const cos = Math.cos(s.phase);
  const c = m.c;
  // 발이 땅에서 미끄러지지 않게: 한 주기에 발이 가는 거리 = 4·L·sin(θ) = v / f → 엉덩이 각 θ (다리 길이 L = 0.6 m)
  const hipAmp = cadence > 0.05 ? Math.min(HIP_MAX, Math.asin(clamp(v / (4 * (THIGH + SHIN) * cadence), 0, 1))) : 0;
  const stride = Math.max(hipAmp, 0.25) * s.amp;

  // ---- 다리 ----
  const hipL = stride * sin * (1 - c) + CROUCH_HIP * c;
  const hipR = -stride * sin * (1 - c) + CROUCH_HIP * c;
  const kneeL = -KNEE_AMP * s.amp * Math.max(0, cos) * (1 - c) + CROUCH_KNEE * c;
  const kneeR = -KNEE_AMP * s.amp * Math.max(0, -cos) * (1 - c) + CROUCH_KNEE * c;
  const pelvisY = Math.max(legHeight(hipL, kneeL), legHeight(hipR, kneeR)) + HIP_DROP;

  // ---- 팔: 걸을 때 반대 다리와 같은 박자, 들면 받침 자세, 조작하면 앞으로 뻗음 ----
  s.hold += ((m.holding ? 1 : 0) - s.hold) * follow(dt, 0.15);
  const reach = m.reachAge < REACH_TIME ? Math.sin((Math.PI * m.reachAge) / REACH_TIME) : 0;
  const swing = ARM_AMP * s.amp * sin;
  const shoulderL = -swing * (1 - c * 0.5);
  const elbowL = 0.2 * s.amp + 0.15 * c;
  const shoulderR = (swing + 0.0) * (1 - s.hold) * (1 - c * 0.5) + HOLD_SHOULDER * s.hold + 0.9 * reach;
  const elbowR = (0.2 * s.amp + 0.15 * c) * (1 - s.hold) + HOLD_ELBOW * s.hold - 0.4 * reach;

  // ---- 몸통·머리: 앉으면 앞으로 숙임, 머리는 몸보다 먼저 돈다 ----
  const torsoX = -0.35 * c - 0.05 * s.amp;
  const wantYaw = clamp(m.turn * 0.25, -MAX_HEAD_YAW, MAX_HEAD_YAW);
  s.headYaw += (wantYaw - s.headYaw) * follow(dt, 0.12);
  const headX = clamp(m.pitch, -MAX_HEAD_PITCH, MAX_HEAD_PITCH) - torsoX;

  return {
    pelvisY, torsoX, headX, headY: s.headYaw, hipL, hipR, kneeL, kneeR, shoulderL, shoulderR, elbowL, elbowR,
    breath: 0.015 * Math.sin(2 * Math.PI * 0.25 * m.t) * (1 - s.amp) * (1 - c),
    sway: 0.025 * s.amp * Math.sin(s.phase) * (1 - c),
    roll: 0.05 * s.amp * Math.sin(s.phase) * (1 - c),
  };
}
