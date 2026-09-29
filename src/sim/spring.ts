/**
 * 용수철 진자 (연직 방향) — 실험층
 *
 * 좌표: y = 평형 위치에서 아래쪽으로 잰 변위 (m)
 *
 * 1) 평형: 추(m)와 용수철 자신의 무게 절반이 늘림 → x_eq = (m + m_s/2)·g / k
 *    (용수철의 각 부분은 자기 아래쪽 무게만 떠받친다 → 평균하면 자기 무게의 절반)
 * 2) 운동: 중력은 평형 위치만 옮길 뿐 복원력에 들어가지 않는다
 *       m_eff·y'' = −k·y − (공기 저항)      m_eff = m + m_s/3
 *    m_s/3: 용수철 코일이 위(고정)에서 아래(추)로 갈수록 빠르게 움직인다고 보면(속도가 위치에 비례)
 *    용수철의 운동 에너지 = ½·(m_s/3)·v²  → 추에 m_s/3만큼 질량이 더 붙은 것과 같다 (레일리 보정)
 * 3) 주기: T = 2π√(m_eff/k)   (진폭과 무관 — 복원력이 변위에 정확히 비례하므로, 단진자와 다른 점)
 *
 * 어디서 깨지는가
 *  - 탄성 한계를 넘으면 후크 법칙 F = kx 가 성립하지 않는다 (용수철이 영구 변형)
 *  - 진폭이 x_eq보다 크면 위쪽 끝에서 용수철이 자연 길이보다 짧아져야 한다 → 밀착 감긴 용수철은 더 줄지 않음
 *  - m_s/3 보정은 추가 용수철보다 충분히 무거울 때의 근사 (m ≪ m_s 이면 파동처럼 움직인다)
 */
import { step, type Method, type State } from './integrators';
import { G } from './pendulum';

const RHO_AIR = 1.2;

export interface SpringSpec {
  k: number; // 용수철 상수 (N/m)
  L0: number; // 자연 길이 (m)
  ms: number; // 용수철 질량 (kg)
  limit: number; // 탄성 한계 늘어남 (m)
}

export class SpringSim {
  spec: SpringSpec = { k: 10, L0: 0.1, ms: 0.012, limit: 0.35 };
  /** 추 (없으면 null) */
  bob: { mass: number; dragArea: number } | null = null;
  amplitude = 0.02; // 처음 당긴 거리 (m)
  method: Method = 'rk4';
  dt = 0.001;
  airDrag = false;

  readonly state: State = { theta: 0, omega: 0 }; // theta = y (m), omega = v (m/s)
  time = 0;
  running = false;
  readonly periods: number[] = [];
  readonly trace: [number, number][] = [];
  private lastCross: number | null = null;
  private energy0 = 0;
  private carry = 0;

  get mass(): number {
    return this.bob?.mass ?? 0;
  }

  /** 정적 늘어남 x_eq */
  staticExtension(): number {
    return ((this.mass + this.spec.ms / 2) * G) / this.spec.k;
  }

  /** 유효 질량 m + m_s/3 */
  effectiveMass(): number {
    return this.mass + this.spec.ms / 3;
  }

  /** 이상적인 주기 2π√(m/k) — 용수철 질량 무시 */
  idealPeriod(): number {
    return 2 * Math.PI * Math.sqrt(this.mass / this.spec.k);
  }

  /** 용수철 질량 보정 주기 2π√((m + m_s/3)/k) */
  correctedPeriod(): number {
    return 2 * Math.PI * Math.sqrt(this.effectiveMass() / this.spec.k);
  }

  /** 진폭이 정적 늘어남보다 커서 용수철이 자연 길이보다 짧아져야 하는가 */
  get slackRisk(): boolean {
    return this.amplitude > this.staticExtension();
  }

  /** 가장 많이 늘어났을 때 탄성 한계를 넘는가 */
  get overLimit(): boolean {
    return this.staticExtension() + this.amplitude > this.spec.limit;
  }

  reset(): void {
    this.running = false;
    this.state.theta = this.amplitude;
    this.state.omega = 0;
    this.time = 0;
    this.carry = 0;
    this.periods.length = 0;
    this.lastCross = null;
    this.trace.length = 0;
  }

  release(): void {
    this.reset();
    this.energy0 = this.energy();
    this.running = true;
    this.trace.push([0, this.state.theta]);
  }

  private accel = (y: number, v: number): number => {
    let a = (-this.spec.k * y) / this.effectiveMass();
    if (this.airDrag && this.bob) a -= ((RHO_AIR * this.bob.dragArea) / (2 * this.effectiveMass())) * v * Math.abs(v);
    return a;
  };

  advance(elapsed: number): void {
    if (!this.running || !this.bob) return;
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
    if (!Number.isFinite(cur) || Math.abs(cur) > 1) {
      this.running = false;
      return;
    }
    if (prev < 0 && cur >= 0) {
      const tCross = this.time - this.dt + (this.dt * -prev) / (cur - prev);
      if (this.lastCross !== null) this.periods.push(tCross - this.lastCross);
      this.lastCross = tCross;
    }
    const last = this.trace[this.trace.length - 1];
    if (!last || this.time - last[0] >= 0.005) {
      this.trace.push([this.time, cur]);
      if (this.trace.length > 3000) this.trace.splice(0, this.trace.length - 3000);
    }
  }

  /** 진동 에너지 ½·m_eff·v² + ½·k·y² (평형 기준 — 중력 위치 에너지는 이 식에 흡수됨) */
  energy(): number {
    return 0.5 * this.effectiveMass() * this.state.omega ** 2 + 0.5 * this.spec.k * this.state.theta ** 2;
  }

  energyDrift(): number {
    return this.energy0 > 0 ? (this.energy() - this.energy0) / this.energy0 : 0;
  }

  measuredPeriod(): number | null {
    if (!this.periods.length) return null;
    return this.periods.reduce((a, b) => a + b, 0) / this.periods.length;
  }
}
