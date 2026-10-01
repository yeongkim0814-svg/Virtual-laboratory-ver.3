/**
 * 세계의 "이산 상태" 스냅숏과 요약(digest) — 멀티플레이어 입장·재동기화용
 *
 *   스냅숏 : 기구 하나하나의 배치(장면 위 / 소켓에 끼움 / 누군가의 손), 위치·방향, 콘센트, 숫자·참거짓·글자 설정값,
 *            용액(부피·몰수), 도선, 문 열림, 칠판 그림, 폐액량
 *   restore: 방장 스냅숏에 맞춘다. 같은 것은 건드리지 않는다 (재동기화가 진행 중인 실험을 흔들지 않게) —
 *            배치가 다른 기구만 떼었다가 다시 끼운다 (onAttached 같은 훅이 다시 불려 레일·진자 조립 상태도 맞는다)
 *   digest : 명령만으로 정해지는 상태의 요약. 방장이 2초마다 보내고, 손님 것과 다르면 스냅숏을 다시 받는다.
 *            물리가 계속 바꾸는 값(수레 위치, 필라멘트 온도 …)은 넣지 않는다.
 * 연속 운동 상태(수레·진자·용수철 …)는 net/physicsSync.ts.
 */
import * as THREE from 'three';
import type { CommandBus } from './commands';
import type { Item, Socket } from '../world/items';
import type { OutletPort } from '../world/power';
import type { WireSystem, Terminal } from '../world/wires';
import type { Chalkboard } from '../world/chalkboard';
import type { WasteCan } from '../equipment/glassware';
import { Container } from '../equipment/glassware';
import type { Solution } from '../sim/chem';

type Prim = number | string | boolean;

interface ItemSnap {
  /** s = 장면 위, k = 소켓에 끼움, h = 누군가의 손 */
  w: 's' | 'k' | 'h';
  /** 위치 xyz + 쿼터니언 xyzw (장면 위·소켓에 끼운 물체 모두 부모 기준) */
  at: number[];
  sk?: string;
  pl?: number;
  /** 소켓의 개별 기준점: 위치 xyz + y 회전 (미끄럼 소켓의 높이) */
  an?: number[];
  h?: string;
  port?: [number, number] | null;
  f: Record<string, Prim>;
  sol?: { V: number; n: Record<string, number> };
}

export interface WorldSnap {
  items: ItemSnap[];
  wires: [string, string][];
  doors: boolean[];
  boards: { v: number; img: string }[];
  waste: number[];
}

/** 누가 무엇을 들고 있나 (나는 손, 남은 아바타) — main.ts가 구현 */
export interface Holdings {
  holderOf(item: Item): string | null;
  hold(who: string, item: Item): void;
  /** 들고 있는 사람의 손에서 내려놓는다 (물체는 그대로 둠) */
  release(item: Item): void;
}

export interface SyncDeps {
  bus: CommandBus;
  scene: THREE.Scene;
  items: Item[];
  wires: WireSystem;
  outlets: { ports: OutletPort[] }[];
  doors: { isOpen: boolean; toggle(): void }[];
  boards: Chalkboard[];
  wasteCans: WasteCan[];
  holdings: Holdings;
  /** 전원 기기 꽂기·뽑기 */
  power: { plug(d: never, port: OutletPort): boolean; unplug(d: never): void };
}

/** digest에 넣는 설정값 (명령으로만 바뀌는 것) */
const DIGEST_FIELDS = new Set(['on', 'closed', 'burnt', 'reversed', 'nm', 'powerMw', 'flowRate', 'fineTilt', 'fineShift', 'yaw']);

const r5 = (x: number) => Math.round(x * 1e5) / 1e5;

export class WorldSync {
  constructor(private d: SyncDeps) {}

  private ref(o: object): string {
    return this.d.bus.registry.ref(o) ?? '';
  }

  private get<T>(r: string): T | null {
    return this.d.bus.registry.get<T>(r);
  }

  private portOf(it: Item): [number, number] | null | undefined {
    if (!('cordLength' in it)) return undefined;
    const port = (it as unknown as { port: OutletPort | null }).port;
    if (!port) return null;
    for (let i = 0; i < this.d.outlets.length; i++) {
      const k = this.d.outlets[i].ports.indexOf(port);
      if (k >= 0) return [i, k];
    }
    return null;
  }

  // ---------------------------------------------------------------- 만들기

  snapshot(): WorldSnap {
    const { items, wires, doors, boards, wasteCans, holdings } = this.d;
    return {
      items: items.map((it) => this.snapItem(it, holdings.holderOf(it))),
      wires: wires.wires.map((w) => [this.ref(w.a), this.ref(w.b)] as [string, string]),
      doors: doors.map((x) => x.isOpen),
      boards: boards.map((b) => ({ v: b.version, img: this.boardImage(b) })),
      waste: wasteCans.map((w) => w.volume),
    };
  }

  /** 칠판 그림(PNG) — 인코딩이 느려서(약 100 ms) 획이 늘었을 때만 다시 만든다 */
  private boardCache = new Map<Chalkboard, { v: number; img: string }>();
  private boardImage(b: Chalkboard): string {
    const c = this.boardCache.get(b);
    if (c && c.v === b.version) return c.img;
    const img = b.canvas.toDataURL('image/png');
    this.boardCache.set(b, { v: b.version, img });
    return img;
  }

  private snapItem(it: Item, holder: string | null): ItemSnap {
    const o = it.object;
    const f: Record<string, Prim> = {};
    for (const [k, v] of Object.entries(it)) {
      if (typeof v === 'number' ? Number.isFinite(v) : typeof v === 'string' || typeof v === 'boolean') f[k] = v as Prim;
    }
    const s: ItemSnap = {
      w: holder ? 'h' : it.attachedTo ? 'k' : 's',
      at: [...o.position.toArray(), ...o.quaternion.toArray()],
      f,
    };
    if (holder) s.h = holder;
    if (it.attachedTo && it.attachedPlug) {
      s.sk = this.ref(it.attachedTo);
      s.pl = it.plugs.indexOf(it.attachedPlug);
      const a = o.parent!;
      s.an = [...a.position.toArray(), a.rotation.y];
    }
    const port = this.portOf(it);
    if (port !== undefined) s.port = port;
    if (it instanceof Container) s.sol = { V: it.solution.V, n: { ...(it.solution.n as Record<string, number>) } };
    return s;
  }

  // ---------------------------------------------------------------- 맞추기

  restore(snap: WorldSnap): void {
    const { items, scene, holdings, wires, doors, boards, wasteCans, power } = this.d;
    const want = snap.items;
    // 1) 배치가 다른 기구는 모두 떼어 낸다 (끼울 곳이 먼저 비도록)
    const changed: number[] = [];
    items.forEach((it, i) => {
      const s = want[i];
      if (!s) return;
      if (!this.samePlace(it, s)) {
        changed.push(i);
        holdings.release(it);
        it.detachFromParent();
        scene.add(it.object);
      }
    });
    // 2) 원하는 자리에 놓는다
    for (const i of changed) {
      const it = items[i];
      const s = want[i];
      if (s.w === 'h') {
        holdings.hold(s.h!, it);
      } else if (s.w === 'k') {
        const socket = this.get<Socket>(s.sk!);
        const plug = it.plugs[s.pl ?? 0];
        if (socket && plug) {
          it.object.removeFromParent();
          socket.attach(it, plug);
          this.setTransform(it, s);
        }
      } else {
        this.setTransform(it, s);
      }
    }
    // 장면 위 기구가 같은 자리면서 위치만 다른 경우 (nudge 등) — 값만 맞춘다
    items.forEach((it, i) => {
      const s = want[i];
      if (s && s.w === 's' && !changed.includes(i)) this.setTransform(it, s);
    });
    // 3) 설정값·용액
    items.forEach((it, i) => {
      const s = want[i];
      if (!s) return;
      const rec = it as unknown as Record<string, Prim>;
      for (const [k, v] of Object.entries(s.f)) if (k in it && typeof rec[k] === typeof v && rec[k] !== v) rec[k] = v;
      if (s.sol && it instanceof Container) {
        const sol: Solution = it.solution;
        sol.V = s.sol.V;
        sol.n = { ...s.sol.n };
        it.refresh();
      }
    });
    // 4) 전원
    items.forEach((it, i) => {
      const s = want[i];
      if (!s || s.port === undefined) return;
      const dev = it as unknown as never;
      const cur = this.portOf(it);
      if (JSON.stringify(cur) === JSON.stringify(s.port)) return;
      power.unplug(dev);
      if (s.port) {
        const port = this.d.outlets[s.port[0]]?.ports[s.port[1]];
        if (port && !port.device) power.plug(dev, port);
      }
    });
    // 5) 도선
    const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const wantWires = new Set(snap.wires.map(([a, b]) => key(a, b)));
    for (const w of [...wires.wires]) if (!wantWires.has(key(this.ref(w.a), this.ref(w.b)))) wires.remove(w);
    const have = new Set(wires.wires.map((w) => key(this.ref(w.a), this.ref(w.b))));
    for (const [a, b] of snap.wires) {
      if (have.has(key(a, b))) continue;
      const ta = this.get<Terminal>(a);
      const tb = this.get<Terminal>(b);
      if (ta && tb) wires.connect(ta, tb);
    }
    // 6) 문·칠판·폐액
    doors.forEach((x, i) => {
      if (snap.doors[i] !== undefined && x.isOpen !== snap.doors[i]) x.toggle();
    });
    boards.forEach((b, i) => {
      const s = snap.boards[i];
      if (s && s.v !== b.version) void loadBoard(b, s);
    });
    wasteCans.forEach((w, i) => {
      if (snap.waste[i] !== undefined) w.volume = snap.waste[i];
    });
  }

  private setTransform(it: Item, s: ItemSnap): void {
    const o = it.object;
    if (s.an && o.parent && o.parent !== it.attachedTo?.anchor) o.parent.position.set(s.an[0], s.an[1], s.an[2]); // 미끄럼 소켓의 개별 기준점
    if (s.an && o.parent) o.parent.rotation.y = s.an[3];
    o.position.set(s.at[0], s.at[1], s.at[2]);
    o.quaternion.set(s.at[3], s.at[4], s.at[5], s.at[6]);
    o.updateMatrixWorld(true);
  }

  /** 지금 배치가 스냅숏과 같은가 (끼운 곳·누가 들었나·장면 위인지) */
  private samePlace(it: Item, s: ItemSnap): boolean {
    const holder = this.d.holdings.holderOf(it);
    if (s.w === 'h') return holder === s.h;
    if (holder) return false;
    if (s.w === 'k') return !!it.attachedTo && this.ref(it.attachedTo) === s.sk && it.plugs.indexOf(it.attachedPlug!) === s.pl;
    return !it.attachedTo && it.object.parent === this.d.scene;
  }

  // ---------------------------------------------------------------- 요약

  /** 명령만으로 정해지는 상태의 요약 (방장과 손님이 같은 명령을 같은 순서로 실행했다면 같다) */
  digest(): string {
    return fnv(JSON.stringify(this.describe()));
  }

  /** digest의 원료 (어긋났을 때 어디가 다른지 보려고 따로 둠) */
  describe(): unknown[] {
    const { items, wires, doors, boards, wasteCans, holdings } = this.d;
    const parts: unknown[] = [];
    const flowing = items.some((it) => it instanceof Container && it.flowRate > 0);
    for (const it of items) {
      const holder = holdings.holderOf(it);
      const o = it.object;
      const row: unknown[] = [holder ?? (it.attachedTo ? `${this.ref(it.attachedTo)}#${it.plugs.indexOf(it.attachedPlug!)}` : 's')];
      if (!holder && !it.attachedTo) row.push(r5(o.position.x), r5(o.position.y), r5(o.position.z), r5(o.rotation.y));
      const port = this.portOf(it);
      if (port !== undefined) row.push(port);
      for (const k of DIGEST_FIELDS) {
        const v = (it as unknown as Record<string, unknown>)[k];
        if (typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string') row.push(typeof v === 'number' ? r5(v) : v);
      }
      // 용액은 뷰렛에서 흐르는 동안은 시간에 따라 바뀌므로 뺀다
      if (!flowing && it instanceof Container) row.push(Math.round(it.solution.V * 1e7), JSON.stringify(roundN(it.solution.n as Record<string, number>)));
      parts.push(row);
    }
    parts.push(wires.wires.map((w) => [this.ref(w.a), this.ref(w.b)].sort().join('|')).sort());
    parts.push(doors.map((d) => d.isOpen));
    parts.push(boards.map((b) => b.version));
    parts.push(wasteCans.map((w) => Math.round(w.volume * 1e4)));
    return parts;
  }
}

function roundN(n: Record<string, number>): Record<string, number> {
  const o: Record<string, number> = {};
  for (const k of Object.keys(n).sort()) o[k] = Math.round(n[k] * 1e9);
  return o;
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16) + ':' + s.length;
}

async function loadBoard(b: Chalkboard, s: { v: number; img: string }): Promise<void> {
  b.importImage(s.img, s.v);
}
