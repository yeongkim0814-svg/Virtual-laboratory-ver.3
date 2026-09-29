/**
 * 단진자 시뮬레이션 (실험층 — 측정 대상이므로 식을 직접 푼다)
 *
 * 운동 방정식 (줄 길이 L = 받침점 ~ 추의 중심, 질량 m, θ는 연직선과 이루는 각)
 *
 *   θ'' = −(g/L)·sin θ  −  (ρ·C_d·A·L / 2m)·θ'·|θ'|
 *          └ 중력의 접선 성분    └ 공기 저항 (속력 v = L·θ' 의 제곱에 비례, 운동 반대 방향)
 *
 * 유도: 추의 접선 방향 뉴턴 제2법칙  m·(L·θ'') = −m·g·sin θ − ½ρC_dA·v·|v|
 * 양변을 m·L로 나누면 위 식. 공기 저항이 없으면 m이 약분된다 → 주기가 질량과 무관.
 *
 * 작은 각 근사: sin θ ≈ θ  →  θ'' = −(g/L)·θ  (단순 조화 운동)  →  T₀ = 2π√(L/g)
 * 정확한 주기 (진폭 θ₀, 공기 저항 없음):  T = 4√(L/g) · K(sin(θ₀/2))   K = 제1종 완전 타원 적분
 *
 * 모형의 가정 (어디서 깨지는가)
 *  - 줄은 늘어나지 않고 질량이 없다
 *  - 추는 L 위치의 한 점 (실제 추는 크기가 있어 "물리 진자"가 된다 — 추가 작을수록 잘 맞음)
 *  - 받침점 마찰 없음
 */
import { step, type Method, type State } from './integrators';

export const G = 9.8; // m/s² (교과서 값)
const RHO_AIR = 1.2; // kg/m³ (20 °C 공기)

export interface Bob {
  mass: number; // kg
  /** 공기 저항 계수 C_d × 단면적 A (m²) */
  dragArea: number;
}

export class PendulumSim {
  // ---- 실험 조건 ----
  length = 0.5; // m
  theta0 = (10 * Math.PI) / 180; // rad
  method: Method = 'rk4';
  dt = 0.001; // s
  airDrag = false;
  bob: Bob | null = null;

  // ---- 상태 ----
  readonly state: State = { theta: this.theta0, omega: 0 };
  time = 0; // 놓은 뒤 경과 시간 (s)
  running = false;
  /** 측정된 주기들: θ가 음→양으로 지나는 순간 사이의 시간 */
  readonly periods: number[] = [];
  private lastCross: number | null = null;
  private energy0 = 0;
  /** 그래프용 기록 [t, θ] (최근 것만) */
  readonly trace: [number, number][] = [];

  /** 초기 각도로 되돌리고 멈춘다 (손으로 추를 잡고 있는 상태) */
  reset(): void {
    this.running = false;
    this.state.theta = this.theta0;
    this.state.omega = 0;
    this.time = 0;
    this.periods.length = 0;
    this.lastCross = null;
    this.trace.length = 0;
  }

  /** 추를 놓는다 */
  release(): void {
    this.reset();
    this.energy0 = this.energy();
    this.running = true;
    this.trace.push([0, this.state.theta]);
  }

  /** 각가속도 θ'' (위 운동 방정식) */
  private accel = (theta: number, omega: number): number => {
    let a = -(G / this.length) * Math.sin(theta);
    if (this.airDrag && this.bob) {
      const c = (RHO_AIR * this.bob.dragArea * this.length) / (2 * this.bob.mass);
      a -= c * omega * Math.abs(omega);
    }
    return a;
  };

  /** 실제 시간 elapsed(s)만큼 진행 — 내부에서는 고정 Δt로 여러 번 적분 */
  private carry = 0;
  advance(elapsed: number): void {
    if (!this.running) return;
    this.carry += elapsed;
    let n = 0;
    while (this.carry >= this.dt && n < 4000) {
      this.stepOnce();
      this.carry -= this.dt;
      n++;
    }
  }

  private stepOnce(): void {
    const prev = this.state.theta;
    step(this.state, this.accel, this.dt, this.method);
    this.time += this.dt;
    const cur = this.state.theta;
    // 발산 방지 (오일러 + 큰 Δt): 한 바퀴를 넘으면 멈춤
    if (!Number.isFinite(cur) || Math.abs(cur) > Math.PI) {
      this.running = false;
      return;
    }
    // 음 → 양으로 지나는 순간: 두 스텝 사이를 직선으로 보간해 정확한 시각을 구한다
    if (prev < 0 && cur >= 0) {
      const tCross = this.time - this.dt + (this.dt * -prev) / (cur - prev);
      if (this.lastCross !== null) this.periods.push(tCross - this.lastCross);
      this.lastCross = tCross;
    }
    const last = this.trace[this.trace.length - 1];
    if (!last || this.time - last[0] >= 0.01) {
      this.trace.push([this.time, cur]);
      if (this.trace.length > 3000) this.trace.splice(0, this.trace.length - 3000);
    }
  }

  /** 역학적 에너지 (J): 위치 에너지 mgL(1−cos θ) + 운동 에너지 ½m(Lω)² */
  energy(): number {
    const m = this.bob?.mass ?? 1;
    const L = this.length;
    return m * G * L * (1 - Math.cos(this.state.theta)) + 0.5 * m * (L * this.state.omega) ** 2;
  }

  /** 놓은 순간 대비 에너지 변화율 */
  energyDrift(): number {
    return this.energy0 > 0 ? (this.energy() - this.energy0) / this.energy0 : 0;
  }

  /** 측정 주기 평균 */
  measuredPeriod(): number | null {
    if (!this.periods.length) return null;
    return this.periods.reduce((a, b) => a + b, 0) / this.periods.length;
  }
}

/** 작은 각 근사 주기 T₀ = 2π√(L/g) */
export function smallAnglePeriod(L: number): number {
  return 2 * Math.PI * Math.sqrt(L / G);
}

/**
 * 정확한 주기 T = 4√(L/g)·K(k),  k = sin(θ₀/2)
 * K(k) = π / (2·AGM(1, √(1−k²)))  — 산술-기하 평균(AGM)은 몇 번만 반복해도 수렴한다
 */
export function exactPeriod(L: number, theta0: number): number {
  const k = Math.sin(Math.abs(theta0) / 2);
  let a = 1;
  let b = Math.sqrt(1 - k * k);
  for (let i = 0; i < 12; i++) {
    const an = (a + b) / 2;
    b = Math.sqrt(a * b);
    a = an;
  }
  const K = Math.PI / (2 * a);
  return 4 * Math.sqrt(L / G) * K;
}
