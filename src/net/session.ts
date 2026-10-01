/**
 * 멀티플레이어 세션 (방장 권한 방식)
 *
 *   혼자(solo)   : 지금까지와 같다. dispatch → 바로 실행
 *   방장(host)   : 진짜 세계. 손님의 명령을 받아 실행하고, 성공한 명령에 순서 번호(n)를 붙여 모두에게 돌려준다.
 *   손님(client) : dispatch → 방장에게 보내기만 한다. 방장이 돌려준 명령을 순서대로 실행해 같은 세계를 만든다.
 *
 * 왜 방장만 판정하나: 두 사람이 같은 기구를 동시에 집으면 먼저 방장에게 닿은 쪽이 이긴다 (뒤의 명령은 거절).
 * 연속 운동(수레·진자 …)은 방장만 계산해 상태를 보낸다 (net/physicsSync.ts) — 기기마다 프레임 간격이 달라
 * 같은 식을 풀어도 결과가 갈라지기 때문이다.
 *
 * 메시지 (JSON)
 *   손님 → 방장  hello{name} · cmd{c} · pose · bye
 *   방장 → 손님  welcome{id, players, seq, world} · join{p} · leave{id} · do{n, c} · no{msg} · poses{list} · sum{n, d} · snap{...}
 * 연결이 순서를 보장하므로 do·sum은 번호 순서로 온다. sum(방장 상태 요약)이 내 것과 다르면 resync를 요청한다.
 */
import type { Command, CommandBus } from './commands';
import type { Channel, HostHandle, Link, Transport } from './transport';

export const MAX_PLAYERS = 4;
export const PROTOCOL = 1;
export const COLORS = [0xe8923a, 0x3a8fe8, 0x5cc15c, 0xd04c8c];

export interface PlayerInfo {
  id: string;
  name: string;
  color: number;
}
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}
export type Role = 'solo' | 'host' | 'client';

/** 세션이 세계와 닿는 곳 (main.ts가 채워 준다) */
export interface Hooks {
  /** 내 자세 (아바타용) */
  pose(): Pose;
  /** 참가자 목록·역할이 바뀜 */
  changed(): void;
  /** 다른 사람들의 자세가 왔다 (나 제외) */
  poses(list: { id: string; pose: Pose }[]): void;
  /** 사람이 나감 (아바타 지우기, 손에 든 것 내려놓기) */
  left(id: string): void;
  notice(msg: string): void;
  /** 방장: 세계 전체를 JSON으로 / 손님: 그것으로 세계를 맞춘다 */
  snapshot(): unknown;
  restore(world: unknown): void;
  /** 이산 상태(배치·도선·용액 …)의 요약 문자열 */
  digest(): string;
  /** 방장: 연속 운동 상태를 내보낸다 (초당 15번) / 손님: 받아 적용 */
  physicsOut(): unknown;
  physicsIn(state: unknown): void;
  /** 손님: 물리 계산을 끄고 받은 상태만 따른다 */
  followHost(on: boolean): void;
}

interface Msg {
  k: string;
  [key: string]: unknown;
}

const POSE_MS = 100;
const PHYS_MS = 66;
const SUM_MS = 2000;

export class Session {
  role: Role = 'solo';
  code = '';
  me = 'p0';
  readonly players = new Map<string, PlayerInfo>();
  /** 방장이 마지막으로 매긴 / 손님이 마지막으로 실행한 명령 번호 */
  seq = 0;
  /** 연결 종류 (화면 표시용) */
  kind: Transport['kind'] | '' = '';

  private links = new Map<string, Link>(); // 방장: 손님 id → 연결
  private linkIds = new Map<Link, string>();
  private poses = new Map<string, Pose>();
  private up: Link | null = null; // 손님: 방장과의 연결
  private handle: HostHandle | null = null;
  private timers: number[] = [];
  private resyncing = false;

  constructor(private bus: CommandBus, private hooks: Hooks) {
    // 방장: 실행에 성공한 모든 명령(내 것·손님 것)에 번호를 붙여 모두에게
    bus.listeners.push((c, ok) => {
      if (this.role !== 'host' || !ok) return;
      this.broadcast('cmd', { k: 'do', n: ++this.seq, c });
    });
  }

  get connected(): boolean {
    return this.role !== 'solo';
  }

  // ---------------------------------------------------------------- 방장

  async host(t: Transport, name: string): Promise<string> {
    if (this.role !== 'solo') throw new Error('이미 방에 있음');
    this.kind = t.kind;
    this.handle = await t.host({
      onLink: () => {},
      onMessage: (link, ch, msg) => this.hostGot(link, ch, msg as Msg),
      onClose: (link) => this.hostLost(link),
    });
    this.role = 'host';
    this.code = this.handle.code;
    this.me = this.bus.me = this.bus.actor = 'p0';
    this.players.clear();
    this.players.set('p0', { id: 'p0', name, color: COLORS[0] });
    this.seq = 0;
    this.timers.push(
      window.setInterval(() => this.hostPoses(), POSE_MS),
      window.setInterval(() => this.broadcast('fast', { k: 'phys', s: this.hooks.physicsOut() }), PHYS_MS),
      window.setInterval(() => this.broadcast('cmd', { k: 'sum', n: this.seq, d: this.hooks.digest() }), SUM_MS),
    );
    this.hooks.changed();
    return this.code;
  }

  private broadcast(ch: Channel, msg: Msg): void {
    for (const l of this.links.values()) l.send(ch, msg);
  }

  private freeId(): string | null {
    for (let i = 1; i < MAX_PLAYERS; i++) if (!this.players.has(`p${i}`)) return `p${i}`;
    return null;
  }

  private hostGot(link: Link, ch: Channel, m: Msg): void {
    const id = this.linkIds.get(link);
    if (m.k === 'hello') {
      const pid = this.freeId();
      if (!pid || m.v !== PROTOCOL) {
        link.send('cmd', { k: 'full', msg: m.v !== PROTOCOL ? '버전이 다름 (새로고침)' : `방이 가득 참 (${MAX_PLAYERS}명)` });
        return;
      }
      const info: PlayerInfo = { id: pid, name: String(m.name || pid).slice(0, 12), color: COLORS[Number(pid.slice(1)) % COLORS.length] };
      this.players.set(pid, info);
      this.links.set(pid, link);
      this.linkIds.set(link, pid);
      // 환영 + 세계 전체: 같은 연결에서 곧바로 이어 오는 명령(do)은 이 스냅숏 이후의 것이다
      link.send('cmd', { k: 'welcome', id: pid, players: [...this.players.values()], seq: this.seq, world: this.hooks.snapshot() });
      this.broadcastExcept(link, { k: 'join', p: info });
      this.hooks.notice(`${info.name} 님이 들어옴`);
      this.hooks.changed();
      return;
    }
    if (!id) return;
    if (m.k === 'cmd') {
      const c = m.c as Command;
      if (!c || c.by !== id) return; // 남의 이름으로 보낸 명령은 버린다
      const ok = this.bus.apply(c);
      if (!ok) link.send('cmd', { k: 'no', msg: '다른 조작이 먼저 처리되어 거절됨' });
    } else if (m.k === 'pose') {
      this.poses.set(id, m.p as Pose);
    } else if (m.k === 'resync') {
      link.send('cmd', { k: 'snap', seq: this.seq, world: this.hooks.snapshot() });
    } else if (m.k === 'bye') {
      this.hostLost(link);
    }
  }

  private broadcastExcept(except: Link, msg: Msg): void {
    for (const l of this.links.values()) if (l !== except) l.send('cmd', msg);
  }

  private hostLost(link: Link): void {
    const id = this.linkIds.get(link);
    if (!id) return;
    this.linkIds.delete(link);
    this.links.delete(id);
    const info = this.players.get(id);
    this.players.delete(id);
    this.poses.delete(id);
    this.hooks.left(id);
    this.broadcast('cmd', { k: 'leave', id });
    if (info) this.hooks.notice(`${info.name} 님이 나감`);
    this.hooks.changed();
  }

  private hostPoses(): void {
    if (!this.links.size) return;
    const list: [string, Pose][] = [['p0', this.hooks.pose()], ...this.poses];
    this.broadcast('fast', { k: 'poses', list });
    this.hooks.poses(list.filter(([id]) => id !== 'p0').map(([id, pose]) => ({ id, pose })));
  }

  // ---------------------------------------------------------------- 손님

  async join(t: Transport, code: string, name: string): Promise<void> {
    if (this.role !== 'solo') throw new Error('이미 방에 있음');
    this.kind = t.kind;
    const welcome = new Promise<Msg>((resolve, reject) => {
      this.onWelcome = resolve;
      this.onRefused = reject;
    });
    const link = await t.join(code, {
      onLink: () => {},
      onMessage: (_l, ch, msg) => this.clientGot(ch, msg as Msg),
      onClose: () => this.clientLost(),
    });
    this.up = link;
    link.send('cmd', { k: 'hello', name, v: PROTOCOL });
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('방장이 응답하지 않음')), 8000));
    let w: Msg;
    try {
      w = await Promise.race([welcome, timeout]);
    } catch (e) {
      link.close();
      this.up = null;
      throw e;
    }
    this.role = 'client';
    this.code = code;
    this.me = this.bus.me = this.bus.actor = String(w.id);
    this.players.clear();
    for (const p of w.players as PlayerInfo[]) this.players.set(p.id, p);
    this.seq = Number(w.seq);
    this.bus.router = (c) => link.send('cmd', { k: 'cmd', c });
    this.hooks.followHost(true);
    this.hooks.restore(w.world);
    this.timers.push(window.setInterval(() => link.send('fast', { k: 'pose', p: this.hooks.pose() }), POSE_MS));
    this.hooks.changed();
  }

  private onWelcome: (m: Msg) => void = () => {};
  private onRefused: (e: Error) => void = () => {};

  private clientGot(ch: Channel, m: Msg): void {
    switch (m.k) {
      case 'welcome':
        this.onWelcome(m);
        break;
      case 'full':
        this.onRefused(new Error(String(m.msg)));
        break;
      case 'do': {
        if (this.resyncing) break; // 스냅숏을 기다리는 동안 온 것은 스냅숏에 이미 들어 있거나 곧 다시 온다
        const n = Number(m.n);
        if (n !== this.seq + 1) {
          this.askResync();
          break;
        }
        this.seq = n;
        this.bus.applyRemote(m.c as Command);
        break;
      }
      case 'no':
        this.hooks.notice(String(m.msg));
        break;
      case 'poses':
        this.hooks.poses((m.list as [string, Pose][]).filter(([id]) => id !== this.me).map(([id, pose]) => ({ id, pose })));
        break;
      case 'phys':
        this.hooks.physicsIn(m.s);
        break;
      case 'join': {
        const p = m.p as PlayerInfo;
        this.players.set(p.id, p);
        this.hooks.notice(`${p.name} 님이 들어옴`);
        this.hooks.changed();
        break;
      }
      case 'leave': {
        const id = String(m.id);
        const p = this.players.get(id);
        this.players.delete(id);
        this.hooks.left(id);
        if (p) this.hooks.notice(`${p.name} 님이 나감`);
        this.hooks.changed();
        break;
      }
      case 'sum':
        // 번호가 같을 때만 비교 (같은 연결에서 do가 먼저 도착했으므로 n번까지 실행한 상태)
        if (Number(m.n) === this.seq && m.d !== this.hooks.digest()) this.askResync();
        break;
      case 'snap':
        this.hooks.restore(m.world);
        this.seq = Number(m.seq);
        this.resyncing = false;
        break;
    }
  }

  private askResync(): void {
    if (this.resyncing) return;
    this.resyncing = true;
    this.up?.send('cmd', { k: 'resync' });
    // 스냅숏이 오지 않으면 다시 시도할 수 있게
    window.setTimeout(() => { this.resyncing = false; }, 4000);
  }

  private clientLost(): void {
    if (this.role !== 'client') return;
    this.hooks.notice('방장과 연결이 끊어졌습니다 — 방이 끝났습니다');
    this.leave();
  }

  // ---------------------------------------------------------------- 공통

  /** 방을 나간다 (방장이 나가면 방이 끝난다) */
  leave(): void {
    for (const id of this.timers) clearInterval(id);
    this.timers = [];
    if (this.role === 'client') this.up?.send('cmd', { k: 'bye' });
    this.up?.close();
    this.up = null;
    this.handle?.close();
    this.handle = null;
    for (const id of [...this.players.keys()]) if (id !== this.me) this.hooks.left(id);
    this.links.clear();
    this.linkIds.clear();
    this.poses.clear();
    this.players.clear();
    this.bus.router = null;
    this.hooks.followHost(false);
    this.role = 'solo';
    this.code = '';
    this.kind = '';
    this.me = this.bus.me = this.bus.actor = 'p0';
    this.resyncing = false;
    this.hooks.changed();
  }
}
