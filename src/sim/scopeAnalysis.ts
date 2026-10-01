/**
 * 오실로스코프 파형 분석 (순수 계산): 자동 측정 · 트리거 · 위상차
 *
 * 주파수: 파형이 "중간 높이"(최대·최소의 가운데)를 위로 지나는 시각을 선형 보간으로 구하고, 이웃한 두 시각의 간격 = 주기.
 *   잡음에 속지 않도록 신호 폭의 10 %만큼 내려갔다가 다시 올라올 때만 센다(히스테리시스).
 * 위상차: CH1이 위로 중간 높이를 지나는 시각 t₁, CH2가 지나는 시각 t₂ → Δt = t₂ − t₁ (주기 T로 접어 −T/2 ~ T/2),
 *   φ = 360° × Δt / T. 양수 = CH2가 CH1보다 늦다(지연). RC 저역 통과 거름망의 출력은 늦다: φ = arctan(ωRC) > 0.
 */

export interface ChMeasure {
  vpp: number;
  vmax: number;
  vmin: number;
  mean: number;
  rms: number;
  /** 주파수 (Hz) · 주기 (s). 두 번 이상 지나지 않았으면 null */
  freq: number | null;
  period: number | null;
}

/** 위로 지나는 시각들 (s). level 아래로 hyst만큼 내려간 뒤 level 이상이 되는 순간 */
export function risingCrossings(x: ArrayLike<number>, dt: number, level: number, hyst: number): number[] {
  const out: number[] = [];
  let armed = x[0] < level - hyst;
  for (let i = 1; i < x.length; i++) {
    if (x[i] < level - hyst) armed = true;
    else if (armed && x[i] >= level && x[i - 1] < level) {
      out.push((i - 1 + (level - x[i - 1]) / (x[i] - x[i - 1])) * dt);
      armed = false;
    }
  }
  return out;
}

export function measure(x: ArrayLike<number>, dt: number): ChMeasure {
  let vmax = -Infinity;
  let vmin = Infinity;
  let s = 0;
  let s2 = 0;
  const n = x.length;
  for (let i = 0; i < n; i++) {
    const v = x[i];
    if (v > vmax) vmax = v;
    if (v < vmin) vmin = v;
    s += v;
    s2 += v * v;
  }
  if (!n) return { vpp: 0, vmax: 0, vmin: 0, mean: 0, rms: 0, freq: null, period: null };
  const vpp = vmax - vmin;
  const m: ChMeasure = { vpp, vmax, vmin, mean: s / n, rms: Math.sqrt(s2 / n), freq: null, period: null };
  if (vpp > 1e-4) {
    const cr = risingCrossings(x, dt, (vmax + vmin) / 2, 0.1 * vpp);
    if (cr.length >= 2) {
      m.period = (cr[cr.length - 1] - cr[0]) / (cr.length - 1);
      m.freq = 1 / m.period;
    }
  }
  return m;
}

/** CH2가 CH1보다 늦는 위상 (도, −180 ~ 180). 두 신호가 같은 주파수의 주기 신호가 아니면 null */
export function phaseLag(a: ArrayLike<number>, b: ArrayLike<number>, dt: number, period: number | null): number | null {
  if (!period) return null;
  const mid = (x: ArrayLike<number>) => {
    let hi = -Infinity;
    let lo = Infinity;
    for (let i = 0; i < x.length; i++) { hi = Math.max(hi, x[i]); lo = Math.min(lo, x[i]); }
    return { level: (hi + lo) / 2, vpp: hi - lo };
  };
  const ma = mid(a);
  const mb = mid(b);
  if (ma.vpp < 1e-4 || mb.vpp < 1e-4) return null;
  const ta = risingCrossings(a, dt, ma.level, 0.1 * ma.vpp);
  const tb = risingCrossings(b, dt, mb.level, 0.1 * mb.vpp);
  if (!ta.length || !tb.length) return null;
  let d = tb[0] - ta[0];
  d -= period * Math.round(d / period);
  return (360 * d) / period;
}

/** [from, to) 에서 level을 (rise면 위로, 아니면 아래로) 지나는 첫 표본 번호. 없으면 −1 */
export function findTrigger(x: ArrayLike<number>, from: number, to: number, level: number, rise: boolean): number {
  for (let i = Math.max(1, from); i < to; i++) {
    if (rise ? x[i - 1] < level && x[i] >= level : x[i - 1] > level && x[i] <= level) return i;
  }
  return -1;
}
