/**
 * 광전 효과 (아인슈타인, 1905)
 *
 * 빛은 에너지 E = hf = hc/λ 인 광자의 흐름이다. 광자 하나가 음극의 전자 하나에 에너지를 모두 준다.
 * 전자가 금속을 빠져나오려면 일함수 W만큼 에너지가 필요하므로, 튀어나온 전자의 최대 운동 에너지는
 *
 *     K_max = hf − W        (hf < W 이면 빛이 아무리 세도 전자가 나오지 않는다 → 문턱 진동수 f₀ = W/h)
 *
 * 양극에 역전압 V를 걸면 전자가 되밀린다. K_max = eV_s 인 전압(정지 전압 V_s)에서 전류가 0이 된다.
 *     eV_s = hf − W   →  V_s = (h/e)·f − W/e     ← V_s–f 그래프의 기울기가 h/e
 *
 * 빛의 세기(단위 시간당 광자 수)는 튀어나오는 전자의 "수"만 바꾼다 → 포화 전류 ∝ 세기, 정지 전압은 그대로.
 *
 * 전류–전압 곡선 모형 (V = 음극 대비 양극 전위)
 *   V ≥ 0 (가속): 전자가 점점 더 많이 양극에 모인다 → I = I_sat · (1 − 0.4·e^(−V/0.8 V))
 *   −V_s < V < 0 (역전압): 운동 에너지가 eV보다 큰 전자만 도착 → I = 0.6·I_sat · (1 + V/V_s)²
 *   V ≤ −V_s: I = 0
 * (에너지가 0~K_max로 퍼져 있고 방향도 제각각이라 역전압 쪽 곡선은 V_s 근처에서 완만하게 0에 닿는다.
 *  그래서 전류계가 0을 가리키는 전압은 실제 V_s보다 조금 작게 읽힌다 — 실제 실험에서도 생기는 오차)
 */

export const H = 6.62607015e-34; // 플랑크 상수 (J·s)
export const C = 2.99792458e8; // 빛의 속력 (m/s)
export const E_CHARGE = 1.602176634e-19; // 기본 전하 (C)

/** 양자 효율: 광자 하나가 전자 하나를 떼어 낼 확률 (알칼리 금속 음극 ≈ 0.5 %) */
const QUANTUM_EFFICIENCY = 0.005;

/** 광자 에너지 (eV) = hc/λ ÷ e */
export function photonEnergyEV(lambda: number): number {
  return (H * C) / lambda / E_CHARGE;
}

/** 진동수 f = c/λ (Hz) */
export function frequency(lambda: number): number {
  return C / lambda;
}

/**
 * 광전관 전류 (A, 양극 → 음극 방향 = 전자가 음극 → 양극으로 가는 방향)
 * @param lambda 빛의 파장 (m), powerW 음극에 닿는 빛의 세기 (W), W 일함수 (eV), V 양극 전위 − 음극 전위 (V)
 */
export function photoCurrent(lambda: number, powerW: number, W: number, V: number): number {
  const E = photonEnergyEV(lambda);
  const Vs = E - W; // 정지 전압 (V) = K_max / e
  if (Vs <= 0 || powerW <= 0) return 0;
  // 포화 전류 = (초당 광자 수) × 효율 × e = P/(hf) × η × e = η·P / E(eV)
  const Isat = (QUANTUM_EFFICIENCY * powerW) / E;
  if (V >= 0) return Isat * (1 - 0.4 * Math.exp(-V / 0.8));
  if (V <= -Vs) return 0;
  return 0.6 * Isat * (1 + V / Vs) ** 2;
}

/** 최소제곱 직선 y = a·x + b */
export function linearFit(xs: number[], ys: number[]): { a: number; b: number } | null {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  if (sxx === 0) return null;
  const a = sxy / sxx;
  return { a, b: my - a * mx };
}
