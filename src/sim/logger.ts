/**
 * 측정 기록 분석 (노트북 측정 프로그램의 계산 부분) — 실험층
 *
 * 운동 센서는 위치 x만 잰다. 속도·가속도는 x(t)에서 "계산"한 값이다:
 *   v(tᵢ) = tᵢ 주변 w개 점의 x–t 직선 맞춤 기울기
 *   a(tᵢ) = tᵢ 주변 w개 점의 v–t 직선 맞춤 기울기
 * 두 점 차분 (x_{i+1} − x_i)/Δt 을 쓰지 않는 이유:
 *   센서 해상도(1 mm)만큼의 들쭉날쭉함이 Δt(수십 ms)로 나뉘면 크게 부풀고,
 *   한 번 더 미분하면(a) Δt²로 나뉘어 훨씬 더 커진다 → 창(window) w를 넓혀 평균을 내면 줄어든다.
 *   대신 창이 넓으면 급격한 변화(충돌 순간)가 뭉개진다. → "매끄러움 ↔ 시간 분해능"의 맞바꿈.
 */

export interface Sample {
  t: number; // s
  x: number | null; // m (범위 밖이면 null)
}

export interface Derived {
  t: number;
  x: number;
  v: number | null;
  a: number | null;
}

/** 점들 (t, y)의 최소제곱 기울기 */
function slope(ts: number[], ys: number[]): number | null {
  const n = ts.length;
  if (n < 2) return null;
  let mt = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mt += ts[i];
    my += ys[i];
  }
  mt /= n;
  my /= n;
  let sty = 0;
  let stt = 0;
  for (let i = 0; i < n; i++) {
    sty += (ts[i] - mt) * (ys[i] - my);
    stt += (ts[i] - mt) ** 2;
  }
  return stt > 0 ? sty / stt : null;
}

/** 가운데 i를 중심으로 반폭 h 안의 (연속으로 값이 있는) 점들 */
function windowAround<T>(arr: T[], i: number, h: number, ok: (p: T) => boolean): T[] {
  const out: T[] = [];
  for (let k = i - h; k <= i + h; k++) {
    if (k < 0 || k >= arr.length) continue;
    if (!ok(arr[k])) {
      if (k < i) out.length = 0; // 빈 곳 앞쪽은 버린다 (가로지르지 않음)
      else break;
      continue;
    }
    out.push(arr[k]);
  }
  return out;
}

/** 위치 기록 → (x, v, a). window = 창의 점 수 (홀수, 3 ~ 11) */
export function derive(samples: Sample[], window: number): Derived[] {
  const h = Math.max(1, Math.floor(window / 2));
  const withX = samples.map((s) => ({ t: s.t, x: s.x }));
  const vs: (number | null)[] = withX.map((_, i) => {
    if (withX[i].x === null) return null;
    const w = windowAround(withX, i, h, (p) => p.x !== null);
    return w.length >= Math.min(3, window) ? slope(w.map((p) => p.t), w.map((p) => p.x as number)) : null;
  });
  const withV = withX.map((p, i) => ({ t: p.t, v: vs[i] }));
  const out: Derived[] = [];
  for (let i = 0; i < withX.length; i++) {
    const x = withX[i].x;
    if (x === null) continue;
    const w = windowAround(withV, i, h, (p) => p.v !== null);
    const a = vs[i] !== null && w.length >= Math.min(3, window) ? slope(w.map((p) => p.t), w.map((p) => p.v as number)) : null;
    out.push({ t: withX[i].t, x, v: vs[i], a });
  }
  return out;
}

/**
 * x = c0 + c1·t + c2·t² 최소제곱 맞춤 → 가속도 a = 2·c2 (등가속도 운동이면 가장 정확한 방법:
 * 미분을 하지 않으므로 잡음이 부풀지 않는다). 점이 3개 미만이면 null
 */
export function quadFit(ts: number[], xs: number[]): { c0: number; c1: number; c2: number } | null {
  const n = ts.length;
  if (n < 3) return null;
  const t0 = ts[0]; // 수치 안정을 위해 첫 시각을 0으로
  let s1 = 0, s2 = 0, s3 = 0, s4 = 0, b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const t = ts[i] - t0;
    const x = xs[i];
    s1 += t; s2 += t * t; s3 += t ** 3; s4 += t ** 4;
    b0 += x; b1 += t * x; b2 += t * t * x;
  }
  const A = [[n, s1, s2], [s1, s2, s3], [s2, s3, s4]];
  const B = [b0, b1, b2];
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const f = A[j][i] / A[i][i];
      for (let k = i; k < 3; k++) A[j][k] -= f * A[i][k];
      B[j] -= f * B[i];
    }
  }
  const c = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let v = B[i];
    for (let k = i + 1; k < 3; k++) v -= A[i][k] * c[k];
    c[i] = v / A[i][i];
  }
  if (!c.every(Number.isFinite)) return null;
  return { c0: c[0], c1: c[1], c2: c[2] };
}

/** 구간 [t1, t2] 통계: 평균 속도(Δx/Δt), v–t 맞춤 기울기, x–t 2차 맞춤 가속도, 평균 a */
export function intervalStats(d: Derived[], t1: number, t2: number): {
  n: number; dx: number; dt: number; vAvg: number; aFit: number | null; aQuad: number | null; aMean: number | null;
} | null {
  const lo = Math.min(t1, t2);
  const hi = Math.max(t1, t2);
  const pts = d.filter((p) => p.t >= lo && p.t <= hi);
  if (pts.length < 2) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const vp = pts.filter((p) => p.v !== null);
  const ap = pts.filter((p) => p.a !== null);
  return {
    n: pts.length,
    dx: last.x - first.x,
    dt: last.t - first.t,
    vAvg: (last.x - first.x) / (last.t - first.t),
    aFit: slope(vp.map((p) => p.t), vp.map((p) => p.v as number)),
    aQuad: (() => { const q = quadFit(pts.map((p) => p.t), pts.map((p) => p.x)); return q ? 2 * q.c2 : null; })(),
    aMean: ap.length ? ap.reduce((s, p) => s + (p.a as number), 0) / ap.length : null,
  };
}

/**
 * 적정 곡선 분석 (pH–V)
 *  - 정돈: 같은 부피(0.01 mL 이내)에서 여러 번 잰 값은 마지막 값만 (전극이 따라잡은 값)
 *  - 기울기 ΔpH/ΔV: 0.1 mL 이상 떨어진 점 사이 (pH 표시 0.01 단위의 들쭉날쭉함이 부풀지 않게)
 *  - 당량점: 기울기가 가장 큰 곳 (pH가 가장 가파르게 뛰는 곳 = 변곡점). 3 pH/mL 이상일 때만
 *    (약산 적정 처음의 완만한 오르막 ≈ 1 pH/mL을 당량점으로 착각하지 않게 — 실제 당량점은 10 pH/mL 이상)
 *  - 반당량점: V_eq / 2에서의 pH — 약산을 강염기로 적정하면 [HA] = [A⁻] → pH = pKa (헨더슨-하셀바흐)
 */
export interface TitrationPoint {
  V: number;
  pH: number;
}

export function analyzeTitration(samples: { V: number; pH: number | null }[]): {
  points: TitrationPoint[];
  slope: TitrationPoint[]; // V와 그 자리의 ΔpH/ΔV
  eqV: number | null;
  eqPH: number | null;
  halfPH: number | null;
  startPH: number | null;
} {
  const points: TitrationPoint[] = [];
  for (const s of samples) {
    if (s.pH === null) continue;
    const last = points[points.length - 1];
    if (last && Math.abs(s.V - last.V) < 0.01) last.pH = s.pH;
    else points.push({ V: s.V, pH: s.pH });
  }
  points.sort((a, b) => a.V - b.V);
  const slope: TitrationPoint[] = [];
  let prev: TitrationPoint | null = null;
  for (const p of points) {
    if (prev && p.V - prev.V >= 0.1) {
      slope.push({ V: (p.V + prev.V) / 2, pH: (p.pH - prev.pH) / (p.V - prev.V) });
      prev = p;
    } else if (!prev) prev = p;
  }
  let best: TitrationPoint | null = null;
  for (const s of slope) if (!best || Math.abs(s.pH) > Math.abs(best.pH)) best = s;
  const interp = (V: number): number | null => {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (V >= a.V && V <= b.V) return b.V === a.V ? b.pH : a.pH + ((b.pH - a.pH) * (V - a.V)) / (b.V - a.V);
    }
    return null;
  };
  const ok = best && Math.abs(best.pH) > 3 && points.length >= 5;
  const eqV = ok ? best!.V : null;
  return {
    points, slope, eqV,
    eqPH: eqV === null ? null : interp(eqV),
    halfPH: eqV === null ? null : interp(eqV / 2),
    startPH: points.length ? points[0].pH : null,
  };
}

/**
 * 힘 센서 기록에서 충돌(힘이 솟은 구간) 찾기
 *   힘이 thresh(기본 0.3 N)를 넘는 구간을 찾고, 앞뒤로 잡음 수준(0.06 N) 아래가 될 때까지 넓힌다
 *   → 닿기 시작·떨어지는 순간의 작은 힘까지 넓이에 넣는다.
 * 충격량 J = ∫F dt (사다리꼴), 평균 힘 = J / 충돌 시간
 */
export interface ForceEpisode {
  t0: number;
  t1: number;
  J: number;
  Fmax: number;
  tPeak: number;
}

export function forceEpisodes(s: { t: number; F: number }[], thresh = 0.3, floor = 0.06): ForceEpisode[] {
  const out: ForceEpisode[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i].F < thresh) {
      i++;
      continue;
    }
    let a = i;
    while (a > 0 && s[a - 1].F > floor) a--;
    let b = i;
    while (b < s.length - 1 && s[b + 1].F > floor) b++;
    let J = 0;
    let Fmax = 0;
    let tPeak = s[a].t;
    for (let k = a; k <= b; k++) {
      if (k > a) J += 0.5 * (s[k].F + s[k - 1].F) * (s[k].t - s[k - 1].t);
      if (s[k].F > Fmax) { Fmax = s[k].F; tPeak = s[k].t; }
    }
    // 너무 짧은 잡음 튐은 버림 (3 ms 미만)
    if (s[b].t - s[a].t >= 0.003) out.push({ t0: s[a].t, t1: s[b].t, J, Fmax, tPeak });
    i = b + 1;
  }
  return out;
}
