/**
 * 역학 레일 위의 수레 (1차원 운동) — 실험층
 *
 * 좌표 s: 레일 가운데를 0으로, 레일 방향(오른쪽 +)으로 잰 수레 중심 위치 (m)
 *
 * 1) 한 수레의 운동 (레일이 θ만큼 기울어 오른쪽 끝이 높을 때)
 *      a = −g·sinθ − μ·g·cosθ·sign(v)
 *    └ 경사면을 따라 내려가는 중력 성분   └ 구름 저항 (바퀴·축의 마찰, 운동 반대 방향, 크기 일정)
 *    멈춰 있을 때: |g·sinθ| ≤ μs·g·cosθ 이면 그대로 멈춰 있다 (μs = 정지 마찰 쪽 계수)
 *
 * 2) 충돌 (두 수레 i(왼쪽) · j(오른쪽)가 맞닿고 서로 다가갈 때)
 *    운동량 보존:  m_i·v_i + m_j·v_j = m_i·v_i' + m_j·v_j'
 *    반발 계수:    e = −(v_i' − v_j') / (v_i − v_j)     (떨어지는 속도 ÷ 다가오는 속도)
 *    두 식을 풀면
 *      v_i' = (m_i·v_i + m_j·v_j − m_j·e·(v_i − v_j)) / (m_i + m_j)
 *      v_j' = (m_i·v_i + m_j·v_j + m_i·e·(v_i − v_j)) / (m_i + m_j)
 *    e = 1: 탄성 충돌 (운동 에너지 보존), e = 0: 완전 비탄성 (붙어서 함께 움직임, 에너지 손실 최대)
 *    범퍼에 따라 e가 다르다: 자석끼리(서로 밀어내 닿지 않음) ≈ 0.95, 용수철 ≈ 0.85,
 *    벨크로끼리는 달라붙음(e = 0), 벨크로와 다른 것은 잘 튀지 않음 ≈ 0.3.
 *
 * 3) 레일 양 끝의 고무 멈추개: 벽과 충돌 (벽의 질량 = ∞) → v' = −e_end·v
 *
 * 센서(나중에 구현)가 읽을 수 있도록 수레마다 (t, s, v) 기록과 충돌 기록을 남긴다.
 */
import { G } from './pendulum';

export type Bumper = 'magnet' | 'spring' | 'velcro';
export const BUMPER_E: Record<Bumper, number> = { magnet: 0.95, spring: 0.85, velcro: 0.3 };
export const BUMPER_NAME: Record<Bumper, string> = { magnet: '자석 (거의 탄성)', spring: '용수철', velcro: '벨크로 (달라붙음)' };
const END_E = 0.5; // 고무 멈추개
const DT = 0.0005; // 적분 간격 (s) — 충돌을 놓치지 않게 짧게

export interface CartBody {
  id: number;
  mass: number; // kg
  length: number; // 범퍼 포함 길이 (m)
  bumper: Bumper;
  s: number;
  v: number;
  /** (t, s, v) 기록 — 10 ms마다, 최근 30초 */
  history: [number, number, number][];
}

export interface Collision {
  t: number;
  a: number; // 왼쪽 수레 id (−1 = 왼쪽 멈추개)
  b: number; // 오른쪽 수레 id (−2 = 오른쪽 멈추개)
  e: number;
  before: [number, number];
  after: [number, number];
}

export class TrackSim {
  /** 레일 기울기 θ (rad, + = 오른쪽 끝이 높음) */
  incline = 0;
  /** 구름 저항 계수 μ */
  friction = 0.004;
  /** 수레가 움직일 수 있는 구간 (멈추개 안쪽 면, m) */
  min = -0.58;
  max = 0.58;
  readonly carts: CartBody[] = [];
  readonly collisions: Collision[] = [];
  time = 0;
  /** 벨크로로 붙은 쌍 ("i-j") — 함께 움직인다 */
  private stuck = new Set<string>();
  private carry = 0;
  private lastLog = 0;

  /** 가속도 (충돌 제외) */
  private accel(c: CartBody): number {
    const gs = -G * Math.sin(this.incline);
    const fr = this.friction * G * Math.cos(this.incline);
    if (Math.abs(c.v) < 1e-4) {
      // 정지 마찰: 기울기 성분이 마찰보다 작으면 멈춰 있음 (정지 마찰 계수 ≈ 구름 저항의 1.5배로 둠)
      if (Math.abs(gs) <= 1.5 * fr) return 0;
      return gs - Math.sign(gs) * fr;
    }
    return gs - Math.sign(c.v) * fr;
  }

  advance(elapsed: number): void {
    this.carry += Math.min(elapsed, 0.1);
    while (this.carry >= DT) {
      this.step();
      this.carry -= DT;
    }
  }

  private step(): void {
    const cs = this.carts;
    // 붙은 쌍은 하나의 물체로: 가속도를 질량 가중 평균
    for (const c of cs) {
      const a = this.accel(c);
      const nv = c.v + a * DT;
      // 마찰로 멈추는 순간 반대로 넘어가지 않게
      c.v = Math.abs(c.v) > 1e-4 && Math.sign(nv) !== Math.sign(c.v) && Math.abs(G * Math.sin(this.incline)) <= 1.5 * this.friction * G * Math.cos(this.incline) ? 0 : nv;
      c.s += c.v * DT;
    }
    this.time += DT;
    cs.sort((p, q) => p.s - q.s);
    for (let k = 0; k < cs.length - 1; k++) {
      const i = cs[k];
      const j = cs[k + 1];
      const gap = j.s - j.length / 2 - (i.s + i.length / 2);
      const key = `${Math.min(i.id, j.id)}-${Math.max(i.id, j.id)}`;
      if (this.stuck.has(key)) {
        // 붙어 있으면 같은 속도 (운동량 보존)
        const v = (i.mass * i.v + j.mass * j.v) / (i.mass + j.mass);
        i.v = j.v = v;
        const mid = (i.s * i.mass + j.s * j.mass) / (i.mass + j.mass);
        const half = (i.length + j.length) / 2;
        i.s = mid - half * (j.mass / (i.mass + j.mass));
        j.s = mid + half * (i.mass / (i.mass + j.mass));
        continue;
      }
      if (gap < 0) {
        if (i.v > j.v) {
          const stick = i.bumper === 'velcro' && j.bumper === 'velcro';
          const e = stick ? 0 : Math.min(BUMPER_E[i.bumper], BUMPER_E[j.bumper]);
          const P = i.mass * i.v + j.mass * j.v;
          const M = i.mass + j.mass;
          const rel = i.v - j.v;
          const vi = (P - j.mass * e * rel) / M;
          const vj = (P + i.mass * e * rel) / M;
          this.collisions.push({ t: this.time, a: i.id, b: j.id, e, before: [i.v, j.v], after: [vi, vj] });
          if (this.collisions.length > 50) this.collisions.shift();
          i.v = vi;
          j.v = vj;
          if (stick) this.stuck.add(key);
        }
        // 겹친 만큼 질량 반비례로 떼어 놓기
        const M = i.mass + j.mass;
        i.s += gap * (j.mass / M);
        j.s -= gap * (i.mass / M);
      }
    }
    // 양 끝 멈추개
    const first = cs[0];
    const last = cs[cs.length - 1];
    if (first && first.s - first.length / 2 < this.min) {
      first.s = this.min + first.length / 2;
      if (first.v < 0) {
        this.collisions.push({ t: this.time, a: -1, b: first.id, e: END_E, before: [0, first.v], after: [0, -END_E * first.v] });
        first.v = -END_E * first.v;
      }
    }
    if (last && last.s + last.length / 2 > this.max) {
      last.s = this.max - last.length / 2;
      if (last.v > 0) {
        this.collisions.push({ t: this.time, a: last.id, b: -2, e: END_E, before: [last.v, 0], after: [-END_E * last.v, 0] });
        last.v = -END_E * last.v;
      }
    }
    if (this.time - this.lastLog >= 0.01) {
      this.lastLog = this.time;
      for (const c of cs) {
        c.history.push([this.time, c.s, c.v]);
        if (c.history.length > 3000) c.history.shift();
      }
    }
  }

  /** 수레를 떼면 그 수레가 낀 붙음도 푼다 */
  unstick(id: number): void {
    for (const k of [...this.stuck]) if (k.split('-').map(Number).includes(id)) this.stuck.delete(k);
  }

  /** 총 운동량 (kg·m/s)과 운동 에너지 (J) — 검증·센서용 */
  totals(): { p: number; K: number } {
    let p = 0;
    let K = 0;
    for (const c of this.carts) {
      p += c.mass * c.v;
      K += 0.5 * c.mass * c.v * c.v;
    }
    return { p, K };
  }
}
