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
 * 4) 도르래 + 추 (뉴턴 운동 제2법칙): 레일 끝 도르래에 걸린 추(질량 m)가 실로 가장 가까운 수레(M)를 끈다.
 *    실이 팽팽한 동안 수레와 추는 한 덩어리로 같은 가속도로 움직인다:
 *      (M + m + I/r²)·a = m·g − M·g·sinθ − μ·M·g·cosθ·sign(v) − f_도르래·sign(v)
 *      I/r² : 도르래 바퀴도 함께 돌아야 하므로 관성이 더해진다 (얇은 원판 I = ½·m_p·r² → I/r² = m_p/2)
 *    이상적(마찰·도르래 없음, 수평)이면  a = m·g/(M + m),  실의 장력 T = M·a = M·m·g/(M + m) < m·g
 *    추가 바닥(또는 책상)에 닿으면 실이 느슨해져 수레는 그때의 속도로 굴러간다 (구름 저항만).
 *
 * 센서가 읽을 수 있도록 수레마다 (t, s, v) 기록과 충돌 기록을 남긴다.
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
  /** 손으로 잡고 있음 (도르래 실험 시작 전) — 움직이지 않는다 */
  locked?: boolean;
}

/** 도르래에 걸린 추 */
export interface HangingLoad {
  cartId: number; // 실이 묶인 수레
  dir: 1 | -1; // 도르래 쪽 방향 (+1 = 레일 오른쪽 끝)
  m: number; // 추 질량 (kg)
  inertia: number; // 도르래 관성 I/r² (kg)
  fp: number; // 도르래 축 마찰력 (N)
  drop: number; // 추가 도르래 아래로 내려간 거리 (m)
  minDrop: number; // 이보다 올라가면 도르래에 닿음
  maxDrop: number; // 이보다 내려가면 바닥에 닿음
  taut: boolean; // 실이 팽팽한가
  sRest: number; // 추가 바닥에 닿았을 때 수레 위치 (느슨해진 실이 다시 팽팽해지는 기준)
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
  /** 도르래에 걸린 추 (없으면 null) */
  load: HangingLoad | null = null;
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

  /** 추와 함께 움직이는 수레의 가속도 (실이 팽팽할 때) */
  private accelLoaded(c: CartBody, L: HangingLoad): number {
    const Mtot = c.mass + L.m + L.inertia;
    const drive = L.dir * L.m * G - c.mass * G * Math.sin(this.incline); // 추의 무게 − 경사 성분
    const resist = this.friction * c.mass * G * Math.cos(this.incline) + L.fp; // 구름 저항 + 도르래 마찰
    if (Math.abs(c.v) < 1e-4) {
      if (Math.abs(drive) <= 1.5 * resist) return 0; // 정지 마찰을 못 이김
      return (drive - Math.sign(drive) * resist) / Mtot;
    }
    return (drive - Math.sign(c.v) * resist) / Mtot;
  }

  /** 충돌 계산에 쓰는 질량: 팽팽한 실로 추와 이어진 수레는 추 질량까지 */
  private inertMass(c: CartBody): number {
    const L = this.load;
    return L && L.taut && L.cartId === c.id ? c.mass + L.m + L.inertia : c.mass;
  }

  private step(): void {
    const cs = this.carts;
    const L = this.load;
    for (const c of cs) {
      if (c.locked) {
        c.v = 0;
        continue;
      }
      const tied = L && L.cartId === c.id;
      const a = tied && L.taut ? this.accelLoaded(c, L) : this.accel(c);
      const nv = c.v + a * DT;
      if (Math.abs(c.v) > 1e-4 && Math.sign(nv) !== Math.sign(c.v)) {
        // 속도가 0을 지나감: 멈춘 상태에서 정지 마찰을 이기지 못하면 그대로 멈춘다 (반대로 넘어가지 않게)
        const rest = { ...c, v: 0 };
        const a0 = tied && L.taut ? this.accelLoaded(rest, L) : this.accel(rest);
        c.v = a0 === 0 ? 0 : nv;
      } else c.v = nv;
      c.s += c.v * DT;
      if (tied) this.moveLoad(c, L);
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
          const mi = this.inertMass(i);
          const mj = this.inertMass(j);
          const P = mi * i.v + mj * j.v;
          const M = mi + mj;
          const rel = i.v - j.v;
          const vi = (P - mj * e * rel) / M;
          const vj = (P + mi * e * rel) / M;
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

  /**
   * 실로 이어진 추 움직이기: 수레가 도르래 쪽으로 가면 추가 내려간다 (실 길이 일정).
   * 바닥에 닿으면 실이 느슨해지고, 수레가 다시 멀어져 실이 팽팽해지면 추가 들린다.
   */
  private moveLoad(c: CartBody, L: HangingLoad): void {
    if (L.taut) {
      L.drop += L.dir * c.v * DT;
      if (L.drop >= L.maxDrop) {
        L.drop = L.maxDrop;
        L.taut = false; // 추가 바닥에 닿음 → 실이 느슨
        L.sRest = c.s;
      } else if (L.drop <= L.minDrop) {
        L.drop = L.minDrop; // 추가 도르래에 닿음 → 더 끌려오지 않게 수레를 멈춤
        if (L.dir * c.v < 0) c.v = 0;
      }
    } else if (L.dir * (c.s - L.sRest) < 0) {
      // 수레가 추를 다시 들어 올림: 실이 팽팽해지는 순간 운동량을 나눠 가짐 (완전 비탄성)
      L.taut = true;
      L.drop = L.maxDrop + L.dir * (c.s - L.sRest);
      c.v = (c.mass * c.v) / (c.mass + L.m + L.inertia);
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
