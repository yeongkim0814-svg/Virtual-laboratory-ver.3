/**
 * 직류 회로 해석 (마디 전압법, Modified Nodal Analysis의 가장 단순한 꼴)
 *
 * 원리
 *   키르히호프 전류 법칙(KCL): 각 마디로 들어오는 전류의 합 = 0.
 *   저항 R(컨덕턴스 G = 1/R)이 마디 a, b 사이에 있으면 a에서 b로 흐르는 전류는 G(V_a − V_b) (옴의 법칙).
 *   모든 마디에 KCL을 쓰면 G·V = I 꼴의 연립 일차 방정식이 된다 → 가우스 소거로 V를 구한다.
 *   키르히호프 전압 법칙(KVL)은 "마디마다 전위가 하나"라는 사실로 자동으로 만족된다.
 *
 * 전원 장치 = 이상 전압원 E + 내부 저항 r  →  노턴 등가(전류원 E/r ∥ 컨덕턴스 1/r)로 바꿔 넣는다.
 *   전류가 한계 I_max를 넘으면 실제 실험용 전원처럼 정전류(CC) 모드로 바뀐다 (단락해도 안전).
 * 다이오드(LED)처럼 전류가 전압에 비례하지 않는 소자는 뉴턴 반복으로 푼다:
 *   지금 추정한 전압 V_d에서 I(V)를 접선(컨덕턴스 g = dI/dV + 전류원)으로 바꿔 넣고 → 선형으로 풀고 → V_d를 고쳐 다시.
 * 기준 전위: 모든 마디에 아주 작은 컨덕턴스(gmin)를 땅(0 V)으로 달아, 떠 있는 마디도 전위가 정해지게 한다.
 */

export interface Conductor {
  a: number;
  b: number;
  /** 저항 (Ω) */
  R: number;
}

export interface Source {
  /** + 단자 마디 */
  a: number;
  /** − 단자 마디 */
  b: number;
  /** 기전력 (V, a − b) */
  E: number;
  /** 내부 저항 (Ω) */
  r: number;
  /** 전류 한계 (A) */
  Imax: number;
}

export interface CircuitResult {
  /** 마디 전위 (V) */
  V: Float64Array;
  /** 전원마다 + 단자에서 나가는 전류 (A) */
  sourceI: number[];
  /** 전원마다 정전류(CC) 모드인가 */
  limited: boolean[];
}

/**
 * 이상적인 pn 접합 (쇼클리 식): I = I_s (e^{V/(nV_T)} − 1)
 * 직렬 저항은 따로 Conductor로 넣는다. vd = 지난번 풀이의 접합 전압 (다음 풀이의 첫 추정값)
 */
export interface Junction {
  /** 애노드(+) 마디 · 캐소드(−) 마디 */
  a: number;
  b: number;
  Is: number;
  nVt: number;
  vd: number;
}

export function junctionCurrent(j: Pick<Junction, 'Is' | 'nVt'>, V: number): number {
  return j.Is * (Math.exp(V / j.nVt) - 1);
}

const GMIN = 1e-12;

/** n개 마디 회로를 푼다 */
export function solveDC(n: number, parts: Conductor[], sources: Source[], junctions: Junction[] = []): CircuitResult {
  const limited = sources.map(() => false);
  /** 정전류 모드일 때 + 단자에서 밖으로 내보내는 전류 (부호 포함) */
  const Icc = sources.map(() => 0);
  let V: Float64Array = new Float64Array(n);
  // 정전류로 바뀐 전원이 생기면 다시 푼다 (전원 수만큼이면 충분)
  for (let pass = 0; pass <= sources.length; pass++) {
    const G = Array.from({ length: n }, () => new Float64Array(n));
    const I = new Float64Array(n);
    const stamp = (a: number, b: number, g: number) => {
      G[a][a] += g;
      G[b][b] += g;
      G[a][b] -= g;
      G[b][a] -= g;
    };
    for (let i = 0; i < n; i++) G[i][i] += GMIN;
    for (const p of parts) if (p.a !== p.b) stamp(p.a, p.b, 1 / p.R);
    sources.forEach((s, k) => {
      if (s.a === s.b) return;
      if (limited[k]) {
        // 정전류: + 단자에서 바깥 회로(마디 a)로 Icc를 밀어 넣고, − 단자(마디 b)로 받아들인다
        I[s.a] += Icc[k];
        I[s.b] -= Icc[k];
        return;
      }
      stamp(s.a, s.b, 1 / s.r);
      I[s.a] += s.E / s.r;
      I[s.b] -= s.E / s.r;
    });
    V = junctions.length ? newton(G, I, junctions) : gauss(G, I);
    let changed = false;
    sources.forEach((s, k) => {
      if (limited[k] || s.a === s.b) return;
      const out = (s.E - (V[s.a] - V[s.b])) / s.r;
      if (Math.abs(out) > s.Imax) {
        limited[k] = true;
        Icc[k] = Math.sign(out) * s.Imax;
        changed = true;
      }
    });
    if (!changed) break;
  }
  // 도선 하나로 +와 −를 바로 이은 경우(두 단자가 같은 마디): 전원 안에서 단락 → 정전류로 한계만큼 흐른다
  sources.forEach((s, k) => {
    if (s.a === s.b && s.E !== 0) {
      limited[k] = true;
      Icc[k] = Math.sign(s.E) * s.Imax;
    }
  });
  const sourceI = sources.map((s, k) => (limited[k] ? Icc[k] : s.a === s.b ? 0 : (s.E - (V[s.a] - V[s.b])) / s.r));
  return { V, sourceI, limited };
}

/** 선형 부분(G, I)에 접합을 접선으로 넣어 되풀이 풀기 */
function newton(G0: Float64Array[], I0: Float64Array, js: Junction[]): Float64Array {
  let V: Float64Array = new Float64Array(I0.length);
  for (let it = 0; it < 200; it++) {
    const G = G0.map((r) => Float64Array.from(r));
    const I = Float64Array.from(I0);
    for (const j of js) {
      if (j.a === j.b) continue;
      const e = Math.exp(j.vd / j.nVt);
      const g = (j.Is / j.nVt) * e + 1e-12;
      const Ieq = j.Is * (e - 1) - g * j.vd; // I(V) ≈ Ieq + g·V
      G[j.a][j.a] += g;
      G[j.b][j.b] += g;
      G[j.a][j.b] -= g;
      G[j.b][j.a] -= g;
      I[j.a] -= Ieq;
      I[j.b] += Ieq;
    }
    V = gauss(G, I);
    let done = true;
    for (const j of js) {
      const want = V[j.a] - V[j.b];
      // 접합 전압 제한: 지수 함수가 폭주하지 않도록 한 번에 조금씩만 올린다 (SPICE의 pnjlim과 같은 생각)
      let next = want;
      if (want > j.vd + 2 * j.nVt && want > 0.3) next = j.vd + 2 * j.nVt * Math.log(1 + (want - j.vd) / (2 * j.nVt));
      if (Math.abs(next - j.vd) > 1e-9) done = false;
      j.vd = next;
    }
    if (done) break;
  }
  return V;
}

/** 부분 피벗 가우스 소거 (마디 수가 작아 밀집 행렬로 충분) */
function gauss(A: Float64Array[], b: Float64Array): Float64Array {
  const n = b.length;
  const M = A.map((r) => Float64Array.from(r));
  const x = Float64Array.from(b);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    [x[c], x[p]] = [x[p], x[c]];
    const d = M[c][c];
    if (d === 0) continue;
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / d;
      if (!f) continue;
      for (let k = c; k < n; k++) M[r][k] -= f * M[c][k];
      x[r] -= f * x[c];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = M[r][r] ? s / M[r][r] : 0;
  }
  return x;
}

/**
 * 꼬마전구 필라멘트 (텅스텐)
 *   저항: R(T) = R₀ (T / 300 K)^1.2        (텅스텐 비저항은 온도에 거의 비례, 조금 더 빠르게 증가)
 *   열 평형: 전기 에너지 I²R = 복사 σεA(T⁴ − T₀⁴) + 전도(다리·기체) k(T − T₀)
 *     → 정격에서는 복사가 85 %, 낮은 전압(어두운 필라멘트)에서는 전도가 주로 열을 빼앗는다
 *   열용량 C: 켜는 순간(차가운 필라멘트, 저항 작음) 큰 전류가 흘렀다가 10 ms 남짓 만에 줄어든다 (돌입 전류)
 * 정격 3.8 V · 0.3 A에서 T ≈ 2700 K가 되도록 상수를 정했다.
 */
export class Filament {
  static readonly T0 = 300;
  /** 정격 전압·전류 */
  /**
   * @param tauCold 차가운(어두운) 필라멘트가 온도를 맞추는 시간 (s). 뜨거울수록 복사가 커서 훨씬 빨라진다 (정격에서 약 10 ms)
   */
  constructor(readonly Vr = 3.8, readonly Ir = 0.3, readonly Tr = 2700, tauCold = 0.25) {
    const Rhot = Vr / Ir;
    this.R0 = Rhot / Math.pow(Tr / Filament.T0, 1.2);
    const P = Vr * Ir;
    this.c = (0.85 * P) / (Tr ** 4 - Filament.T0 ** 4);
    this.k = (0.15 * P) / (Tr - Filament.T0);
    this.C = tauCold * this.k;
  }
  readonly R0: number;
  private readonly c: number;
  private readonly k: number;
  private readonly C: number;
  T = Filament.T0;

  get R(): number {
    return this.R0 * Math.pow(this.T / Filament.T0, 1.2);
  }

  /** 전류 I가 dt 동안 흐름 → 온도 변화 */
  heat(I: number, dt: number): void {
    const P = I * I * this.R - this.loss(this.T);
    this.T = Math.max(Filament.T0, this.T + (P / this.C) * dt);
  }

  /** 열 손실 (W): 복사 + 전도 */
  private loss(T: number): number {
    return this.c * (T ** 4 - Filament.T0 ** 4) + this.k * (T - Filament.T0);
  }

  /** 정상 상태에서 전압 V를 걸었을 때 전류 (이론 I–V 곡선용): I²R(T) = c(T⁴ − T₀⁴), V = I·R(T) */
  steadyCurrent(V: number): number {
    if (V <= 0) return 0;
    // T에 대한 이분법: V²/R(T) − 손실(T) = 0 (T가 오르면 앞쪽은 줄고 손실은 늘어난다)
    let lo = Filament.T0;
    let hi = 5000;
    const R = (T: number) => this.R0 * Math.pow(T / Filament.T0, 1.2);
    for (let i = 0; i < 60; i++) {
      const T = (lo + hi) / 2;
      if ((V * V) / R(T) > this.loss(T)) lo = T;
      else hi = T;
    }
    return V / R((lo + hi) / 2);
  }
}
