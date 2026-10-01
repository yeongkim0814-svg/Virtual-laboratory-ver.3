/**
 * 과도(시간에 따라 변하는) 회로 해석 — 축전기·코일·다이오드가 든 회로를 시간 간격 h로 한 걸음씩 푼다
 *
 * 원리: 축전기 i = C dv/dt, 코일 v = L di/dt 는 미분 방정식이라 마디 전압법(연립 일차식)에 바로 못 넣는다.
 *   그래서 한 걸음(t → t+h) 동안 변화율을 "처음과 끝의 평균"으로 본다 (사다리꼴 공식):
 *     축전기  i_n = (2C/h)(v_n − v_{n−1}) − i_{n−1}     → 저항 G = 2C/h ∥ 전류원 I_eq = G v_{n−1} + i_{n−1}
 *     코일    i_n = i_{n−1} + (h/2L)(v_n + v_{n−1})     → 저항 G = h/2L  ∥ 전류원 I_eq = i_{n−1} + G v_{n−1}
 *   이렇게 바꾸면 모든 소자가 "저항 + 전류원"이라 직류 회로와 똑같이 푼다 (sim/circuit.ts의 마디 전압법과 같은 생각).
 * 왜 사다리꼴인가: 에너지를 거의 보존한다. 손실 없는 LC 진동이 수백 번 돌아도 진폭이 줄지도 늘지도 않는다
 *   (뒤로 미분하는 오일러는 가짜 감쇠가 생겨 공명 곡선이 틀어진다). 한계: h가 회로의 가장 빠른 시간 상수보다
 *   훨씬 크면(뻣뻣한 회로) 축전기 전류에 가짜 진동이 남는다 — 전압은 맞다.
 * 다이오드(쇼클리 I = I_s(e^{V/nV_T} − 1))는 걸음마다 뉴턴 반복으로 푼다 (sim/circuit.ts와 같은 방식).
 * 마디 0 = 땅(0 V). 소자의 상태(축전기 전압·코일 전류)는 소자 객체 안에 두어 걸음이 이어진다.
 */

const GMIN = 1e-12;

export type Wave = 'sine' | 'square' | 'triangle';

/** 함수 발생기 출력 (V): offset + amp·모양(2π f t). 사각파·삼각파는 ±amp 사이 */
export function waveform(kind: Wave, f: number, amp: number, offset: number, t: number): number {
  const ph = f * t;
  const fr = ph - Math.floor(ph);
  if (kind === 'sine') return offset + amp * Math.sin(2 * Math.PI * ph);
  if (kind === 'square') return offset + (fr < 0.5 ? amp : -amp);
  // 삼각파: t = 0에서 0 V, 위로 올라가 1/4 주기에 +amp
  return offset + amp * (4 * Math.abs(fr - 0.25 - Math.floor(fr - 0.25) - 0.5) - 1);
}

export interface TR { kind: 'R'; a: number; b: number; R: number }
export interface TC { kind: 'C'; a: number; b: number; C: number; v: number; i: number }
export interface TL { kind: 'L'; a: number; b: number; L: number; v: number; i: number }
export interface TD { kind: 'D'; a: number; b: number; Is: number; nVt: number; vd: number; i: number }
/** 전압원 E(t)와 내부 저항 r (노턴 등가로 푼다) */
export interface TV { kind: 'V'; a: number; b: number; r: number; E: (t: number) => number; i: number }
export type TElement = TR | TC | TL | TD | TV;

export class Transient {
  t = 0;
  /** 마디 전위 (V). V[0] = 0 */
  readonly V: Float64Array;
  private readonly m: number;
  private readonly A0: Float64Array;
  private readonly b0: Float64Array;
  private readonly A: Float64Array;
  private readonly x: Float64Array;
  private readonly diodes: TD[];

  constructor(readonly n: number, readonly els: TElement[]) {
    this.m = Math.max(0, n - 1);
    const m = this.m;
    this.V = new Float64Array(n);
    this.A0 = new Float64Array(m * m);
    this.b0 = new Float64Array(m);
    this.A = new Float64Array(m * m);
    this.x = new Float64Array(m);
    this.diodes = els.filter((e): e is TD => e.kind === 'D');
  }

  /** 모든 소자의 상태를 0으로 (축전기 방전, 코일 전류 0) */
  reset(): void {
    this.t = 0;
    this.V.fill(0);
    for (const e of this.els) {
      if (e.kind === 'C' || e.kind === 'L') { e.v = 0; e.i = 0; }
      if (e.kind === 'D') { e.vd = 0; e.i = 0; }
      if (e.kind === 'V') e.i = 0;
    }
  }

  private stamp(a: number, b: number, g: number): void {
    const A = this.A0;
    const m = this.m;
    if (a > 0) A[(a - 1) * m + (a - 1)] += g;
    if (b > 0) A[(b - 1) * m + (b - 1)] += g;
    if (a > 0 && b > 0) {
      A[(a - 1) * m + (b - 1)] -= g;
      A[(b - 1) * m + (a - 1)] -= g;
    }
  }

  /** 전류 i를 마디 b에서 a로 밀어 넣는다 (a로 들어가고 b에서 나옴) */
  private inject(a: number, b: number, i: number, rhs: Float64Array): void {
    if (a > 0) rhs[a - 1] += i;
    if (b > 0) rhs[b - 1] -= i;
  }

  /** 한 걸음 h (s) 나아간다 */
  step(h: number): void {
    const m = this.m;
    if (m === 0) { this.t += h; return; }
    const tn = this.t + h;
    this.A0.fill(0);
    this.b0.fill(0);
    for (let i = 0; i < m; i++) this.A0[i * m + i] = GMIN;
    for (const e of this.els) {
      if (e.a === e.b) continue;
      switch (e.kind) {
        case 'R': this.stamp(e.a, e.b, 1 / e.R); break;
        case 'V': {
          const g = 1 / e.r;
          this.stamp(e.a, e.b, g);
          this.inject(e.a, e.b, e.E(tn) * g, this.b0);
          break;
        }
        case 'C': {
          const G = (2 * e.C) / h;
          this.stamp(e.a, e.b, G);
          this.inject(e.a, e.b, G * e.v + e.i, this.b0);
          break;
        }
        case 'L': {
          const G = h / (2 * e.L);
          this.stamp(e.a, e.b, G);
          this.inject(e.a, e.b, -(e.i + G * e.v), this.b0);
          break;
        }
        case 'D': break;
      }
    }
    const solve = (): void => {
      this.A.set(this.A0);
      this.x.set(this.b0);
      solveFlat(this.A, this.x, m);
    };
    if (!this.diodes.length) solve();
    else this.newton(solve);
    this.V[0] = 0;
    for (let k = 1; k < this.n; k++) this.V[k] = this.x[k - 1];
    // 상태 갱신 (이전 상태로 I_eq를 만든 뒤에)
    for (const e of this.els) {
      const v = this.V[e.a] - this.V[e.b];
      if (e.kind === 'C') {
        const G = (2 * e.C) / h;
        e.i = G * (v - e.v) - e.i;
        e.v = v;
      } else if (e.kind === 'L') {
        const G = h / (2 * e.L);
        e.i = e.i + G * (e.v + v);
        e.v = v;
      } else if (e.kind === 'V') {
        e.i = (e.E(tn) - v) / e.r;
      }
    }
    this.t = tn;
  }

  /** 선형 부분(A0, b0)에 다이오드를 접선으로 더해 되풀이 푼다 */
  private newton(solve: () => void): void {
    const m = this.m;
    const A0 = Float64Array.from(this.A0);
    const b0 = Float64Array.from(this.b0);
    for (let it = 0; it < 100; it++) {
      this.A0.set(A0);
      this.b0.set(b0);
      for (const d of this.diodes) {
        if (d.a === d.b) continue;
        const e = Math.exp(Math.min(d.vd, 2) / d.nVt);
        const g = (d.Is / d.nVt) * e + 1e-12;
        const Ieq = d.Is * (e - 1) - g * d.vd; // I(V) ≈ Ieq + g·V
        this.stamp(d.a, d.b, g);
        this.inject(d.a, d.b, -Ieq, this.b0);
      }
      solve();
      let done = true;
      for (const d of this.diodes) {
        const va = d.a > 0 ? this.x[d.a - 1] : 0;
        const vb = d.b > 0 ? this.x[d.b - 1] : 0;
        const want = va - vb;
        let next = want;
        if (want > d.vd + 2 * d.nVt && want > 0.3) next = d.vd + 2 * d.nVt * Math.log(1 + (want - d.vd) / (2 * d.nVt));
        if (Math.abs(next - d.vd) > 1e-9) done = false;
        d.vd = next;
      }
      if (done) break;
    }
    this.A0.set(A0);
    this.b0.set(b0);
    for (const d of this.diodes) d.i = d.Is * (Math.exp(Math.min(d.vd, 2) / d.nVt) - 1);
    void m;
  }
}

/** 부분 피벗 가우스 소거 (밀집 행렬, A는 망가진다, x는 우변 → 해) */
function solveFlat(A: Float64Array, x: Float64Array, m: number): void {
  for (let c = 0; c < m; c++) {
    let p = c;
    let best = Math.abs(A[c * m + c]);
    for (let r = c + 1; r < m; r++) {
      const v = Math.abs(A[r * m + c]);
      if (v > best) { best = v; p = r; }
    }
    if (p !== c) {
      for (let k = c; k < m; k++) { const t = A[c * m + k]; A[c * m + k] = A[p * m + k]; A[p * m + k] = t; }
      const t = x[c]; x[c] = x[p]; x[p] = t;
    }
    const d = A[c * m + c];
    if (d === 0) continue;
    for (let r = c + 1; r < m; r++) {
      const f = A[r * m + c] / d;
      if (!f) continue;
      for (let k = c; k < m; k++) A[r * m + k] -= f * A[c * m + k];
      x[r] -= f * x[c];
    }
  }
  for (let r = m - 1; r >= 0; r--) {
    let s = x[r];
    for (let k = r + 1; k < m; k++) s -= A[r * m + k] * x[k];
    const d = A[r * m + r];
    x[r] = d ? s / d : 0;
  }
}
