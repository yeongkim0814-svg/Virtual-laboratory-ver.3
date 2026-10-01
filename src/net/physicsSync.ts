/**
 * 연속 운동 상태의 동기화 (방장 → 손님, 초당 15번, 순서 보장 없는 통로)
 *
 * 모든 기기가 같은 시뮬레이션을 돌리되(그래서 손님 화면도 매끄럽다), 방장이 진짜 상태를 계속 보내
 * 손님 쪽 상태를 그 값으로 덮어써서 어긋남이 쌓이지 않게 한다 (프레임 간격이 달라 생기는 적분 오차,
 * 충돌 시각 차이는 몇 ms ~ 몇 mm 안에서 매번 바로잡힌다).
 *   수레(위치 s·속도 v)·추 매달림(drop·taut) · 진자·용수철(θ·ω·경과 시간·진행 중) ·
 *   회로 부품·전원 장치의 수치(필라멘트 온도·LED 접합 온도·탄 여부 …) · 용액(뷰렛이 흘리는 동안 부피·몰수)
 * 패킷을 잃어도 되도록 매번 현재 값 전체를 보내고(수레·진자 …), 수치·용액은 바뀌었거나 1초가 지난 것만 보낸다.
 * 손님 쪽에서 새로 시작하는 일은 없다: 명령(시작·밀기 …)은 방장이 순서를 정해 모두에게 같이 실행시킨다.
 */
import type { CommandBus } from './commands';
import type { Stock } from '../equipment/stock';
import { Container } from '../equipment/glassware';
import type { Item } from '../world/items';

type Prim = number | boolean;

export interface PhysState {
  rails: { r: string; time: number; carts: [string, number, number][]; load: [number, number, number] | null }[];
  /** [ref, running, time, theta, omega] */
  strings: [string, number, number, number, number][];
  springs: [string, number, number, number, number][];
  items: [string, Record<string, Prim>][];
  /** [ref, V, n, titrantAdded, flowRate] */
  sols: [string, number, Record<string, number>, number, number][];
}

/** 같은 값이어도 이만큼(ms)마다 다시 보낸다 — 패킷 손실 복구 */
const REFRESH_MS = 1000;

export class PhysicsSync {
  private sent = new Map<string, { json: string; t: number }>();

  constructor(private bus: CommandBus, private stock: Stock) {}

  private ref(o: object): string {
    return this.bus.registry.ref(o) ?? '';
  }

  private due(key: string, json: string, now: number): boolean {
    const prev = this.sent.get(key);
    if (prev && prev.json === json && now - prev.t < REFRESH_MS) return false;
    this.sent.set(key, { json, t: now });
    return true;
  }

  // ---------------------------------------------------------------- 방장

  out(): PhysState {
    const { stock } = this;
    const now = performance.now();
    const st: PhysState = { rails: [], strings: [], springs: [], items: [], sols: [] };
    for (const rail of stock.rails) {
      const L = rail.sim.load;
      st.rails.push({
        r: this.ref(rail),
        time: rail.sim.time,
        carts: rail.carts.flatMap((c) => {
          const b = rail.bodyOf(c);
          return b ? [[this.ref(c), b.s, b.v] as [string, number, number]] : [];
        }),
        load: L ? [L.drop, L.taut ? 1 : 0, L.sRest] : null,
      });
    }
    for (const s of stock.strings) st.strings.push([this.ref(s), s.sim.running ? 1 : 0, s.sim.time, s.sim.state.theta, s.sim.state.omega]);
    for (const s of stock.springs) st.springs.push([this.ref(s), s.sim.running ? 1 : 0, s.sim.time, s.sim.state.theta, s.sim.state.omega]);
    for (const it of [...stock.circuitParts, ...stock.supplies, ...stock.ammeters] as Item[]) {
      const f: Record<string, Prim> = {};
      for (const [k, v] of Object.entries(it)) if ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean') f[k] = v;
      const r = this.ref(it);
      if (this.due(r, JSON.stringify(f), now)) st.items.push([r, f]);
    }
    for (const c of stock.containers) {
      const n = c.solution.n as Record<string, number>;
      const r = this.ref(c);
      if (this.due(r, `${c.solution.V}|${JSON.stringify(n)}|${c.titrantAdded}|${c.flowRate}`, now)) st.sols.push([r, c.solution.V, { ...n }, c.titrantAdded, c.flowRate]);
    }
    return st;
  }

  // ---------------------------------------------------------------- 손님

  apply(st: PhysState): void {
    if (!st) return;
    const get = <T,>(r: string) => this.bus.registry.get<T>(r);
    for (const r of st.rails) {
      const rail = get<(typeof this.stock.rails)[number]>(r.r);
      if (!rail) continue;
      rail.sim.time = r.time;
      for (const [cr, s, v] of r.carts) {
        const cart = get<(typeof this.stock.carts)[number]>(cr);
        const b = cart && rail.bodyOf(cart);
        if (b) {
          b.s = s;
          b.v = v;
        }
      }
      const L = rail.sim.load;
      if (L && r.load) {
        L.drop = r.load[0];
        L.taut = r.load[1] === 1;
        L.sRest = r.load[2];
      }
    }
    for (const [list, rows] of [[this.stock.strings, st.strings], [this.stock.springs, st.springs]] as const) {
      for (const [r, running, time, theta, omega] of rows) {
        const o = get<(typeof list)[number]>(r);
        if (!o) continue;
        o.sim.running = running === 1;
        o.sim.time = time;
        o.sim.state.theta = theta;
        o.sim.state.omega = omega;
      }
    }
    for (const [r, f] of st.items) {
      const it = get<Item>(r);
      if (!it) continue;
      const rec = it as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(f)) if (k in it && typeof rec[k] === typeof v) rec[k] = v;
    }
    for (const [r, V, n, ta, flow] of st.sols) {
      const c = get<Container>(r);
      if (!c) continue;
      c.solution.V = V;
      c.solution.n = { ...n };
      c.titrantAdded = ta;
      c.flowRate = flow;
      c.refresh();
    }
  }
}
