/**
 * 수치 적분기: 운동 방정식 θ'' = a(θ, ω) 를 시간 간격 Δt씩 나아가며 푼다.
 * 상태는 (θ, ω) 두 개 — 각도와 각속도.
 *
 * 세 방법의 차이 (모두 같은 식을 풀지만 "다음 상태를 어떻게 추정하느냐"가 다르다)
 *
 *  오일러 (explicit Euler)
 *    θ ← θ + ω·Δt,   ω ← ω + a(θ, ω)·Δt        (둘 다 "현재" 값으로 계산)
 *    → 진동 운동에서 에너지가 매 스텝 조금씩 늘어난다 (진폭이 점점 커짐).
 *      조화 진동자라면 한 스텝마다 에너지가 (1 + ω₀²Δt²)배.
 *
 *  반암시적 오일러 (semi-implicit / symplectic Euler)
 *    ω ← ω + a(θ, ω)·Δt,   θ ← θ + (새 ω)·Δt     (속도를 먼저 갱신하고 그 값으로 위치 갱신)
 *    → 계산량은 오일러와 같은데 에너지가 늘거나 줄지 않고 참값 근처에서 오르내린다.
 *      (위상 공간의 넓이를 보존하는 "심플렉틱" 방법 — 게임 물리 엔진 대부분이 이것)
 *
 *  RK4 (4차 룽게-쿠타)
 *    한 스텝 안에서 기울기를 4번 재서 가중 평균 → 오차가 Δt⁴에 비례. 정확하지만 계산 4배.
 */

export type Method = 'rk4' | 'semi' | 'euler';

export interface State {
  theta: number; // rad
  omega: number; // rad/s
}

/** 각가속도 함수: 현재 상태 → θ'' */
export type Accel = (theta: number, omega: number) => number;

export function step(s: State, a: Accel, dt: number, method: Method): void {
  switch (method) {
    case 'euler': {
      const acc = a(s.theta, s.omega);
      s.theta += s.omega * dt;
      s.omega += acc * dt;
      return;
    }
    case 'semi': {
      s.omega += a(s.theta, s.omega) * dt;
      s.theta += s.omega * dt;
      return;
    }
    case 'rk4': {
      // k = (dθ/dt, dω/dt) = (ω, a(θ, ω))를 네 지점에서 잰다
      const { theta: t0, omega: w0 } = s;
      const k1t = w0;
      const k1w = a(t0, w0);
      const k2t = w0 + (k1w * dt) / 2;
      const k2w = a(t0 + (k1t * dt) / 2, w0 + (k1w * dt) / 2);
      const k3t = w0 + (k2w * dt) / 2;
      const k3w = a(t0 + (k2t * dt) / 2, w0 + (k2w * dt) / 2);
      const k4t = w0 + k3w * dt;
      const k4w = a(t0 + k3t * dt, w0 + k3w * dt);
      s.theta = t0 + ((k1t + 2 * k2t + 2 * k3t + k4t) * dt) / 6;
      s.omega = w0 + ((k1w + 2 * k2w + 2 * k3w + k4w) * dt) / 6;
      return;
    }
  }
}
