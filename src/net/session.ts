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
export const PROTOCOL = 3; // 2: 큰 메시지 조각내기 (transport.ts framedSender), 3: 자세에 pitch · c
export const COLORS = [0xe8923a, 0x3a8fe8, 0x5cc15c, 0xd04c8c];

export interface PlayerInfo {
  id: string;
  name: string;
  color: number;
  /** 지금 열어 둔 실험 패널 이름 ("진자 실험 조작 중" 표시용, 없으면 빈 문자열) */
  focus?: string;
}
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** 시선 위아래 (rad, + = 위) · 앉은 정도 0 ~ 1 */
  pitch?: number;
  c?: number;
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
}

interface Msg {
  k: string;
  [key: string]: unknown;
}

const POSE_MS = 100;
/** 손님 소식이 이만큼 없으면 나간 것으로 본다 (모바일은 탭을 닫아도 연결 끊김 신호가 안 오거나 늦다) */
export const GHOST_MS = 10000;
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
  /** 손님: 방장에게서 마지막으로 무엇이든 받은 시각 (ms) */
  lastHost = 0;
  /** 손님: 방장 소식이 끊긴 상태 (방장 화면이 꺼졌거나 연결이 불안정) */
  hostSilent = false;
  /** 방장 화면이 꺼져 있음 (방장이 알려 줌) */
  hostHidden = false;

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
    document.addEventListener('visibilitychange', this.onVisibility);
    this.timers.push(
      window.setInterval(() => this.hostPoses(), POSE_MS),
      window.setInterval(() => this.broadcast('fast', { k: 'phys', s: this.hooks.physicsOut() }), PHYS_MS),
      window.setInterval(() => this.broadcast('cmd', { k: 'sum', n: this.seq, d: this.hooks.digest() }), SUM_MS),
      window.setInterval(() => this.reapGhosts(), 1000),
    );
    this.hooks.changed();
    // 칠판 그림(PNG) 첫 인코딩이 느려서(수백 ms) 손님이 들어올 때 끊기지 않게 미리 한 번 만들어 둔다
    window.setTimeout(() => this.hooks.snapshot(), 50);
    return this.code;
  }

  /** 방장 화면이 꺼지면(다른 앱·화면 잠금) 브라우저가 프레임 루프를 멈춰 모두의 세계가 멈춘다 → 알린다 */
  private onVisibility = (): void => {
    if (this.role === 'host') this.broadcast('cmd', { k: 'pause', on: document.hidden });
  };

  /** 내가 지금 열어 둔 패널 이름을 알린다 (닫으면 빈 문자열) */
  setFocus(label: string): void {
    const me = this.players.get(this.me);
    if (!me || me.focus === label) return;
    me.focus = label;
    if (this.role === 'host') this.broadcast('cmd', { k: 'focus', id: this.me, label });
    else if (this.role === 'client') this.up?.send('cmd', { k: 'focus', label });
    this.hooks.changed();
  }

  private broadcast(ch: Channel, msg: Msg): void {
    for (const l of this.links.values()) l.send(ch, msg);
  }

  private freeId(): string | null {
    for (let i = 1; i < MAX_PLAYERS; i++) if (!this.players.has(`p${i}`)) return `p${i}`;
    return null;
  }

  private seen = new Map<Link, number>();

  /** 소식이 GHOST_MS 넘게 없는 손님을 내보낸다 */
  private reapGhosts(): void {
    const now = performance.now();
    for (const [link, t] of this.seen) if (now - t > GHOST_MS) { link.close(); this.hostLost(link); }
  }

  private hostGot(link: Link, ch: Channel, m: Msg): void {
    this.seen.set(link, performance.now());
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
    } else if (m.k === 'focus') {
      const label = String(m.label ?? '').slice(0, 24);
      const p = this.players.get(id);
      if (p) p.focus = label;
      this.broadcast('cmd', { k: 'focus', id, label });
      this.hooks.changed();
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
    this.seen.delete(link);
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
    this.hooks.restore(w.world);
    window.addEventListener('pagehide', this.onPageHide);
    this.lastHost = performance.now();
    this.timers.push(
      window.setInterval(() => link.send('fast', { k: 'pose', p: this.hooks.pose() }), POSE_MS),
      window.setInterval(() => this.watchHost(), 1000),
    );
    this.hooks.changed();
  }

  private onWelcome: (m: Msg) => void = () => {};
  private onRefused: (e: Error) => void = () => {};

  /** 방장 소식이 4초 넘게 없으면 알린다 (방장은 0.07초마다 물리 상태를 보내므로 정상이면 끊길 수 없다) */
  private watchHost(): void {
    const silent = performance.now() - this.lastHost > 4000;
    if (silent === this.hostSilent) return;
    this.hostSilent = silent;
    this.hooks.notice(silent ? '방장에게서 소식이 없습니다 (방장 화면이 꺼졌거나 연결이 불안정)' : '방장과 다시 연결됨');
    this.hooks.changed();
  }

  private clientGot(ch: Channel, m: Msg): void {
    this.lastHost = performance.now();
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
      case 'pause':
        this.hostHidden = m.on === true;
        this.hooks.notice(this.hostHidden ? '방장 화면이 꺼져 세계가 멈췄습니다 — 방장이 돌아오면 이어집니다' : '방장이 돌아와 다시 진행됩니다');
        this.hooks.changed();
        break;
      case 'focus': {
        const p = this.players.get(String(m.id));
        if (p) p.focus = String(m.label ?? '');
        this.hooks.changed();
        break;
      }
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

  /** 탭을 닫거나 다른 페이지로 갈 때: 손님이면 나감 신호를 보낸다 (방장은 방이 끝남) */
  private onPageHide = (): void => { if (this.role !== 'solo') this.leave(); };

  /** 방을 나간다 (방장이 나가면 방이 끝난다) */
  leave(): void {
    for (const id of this.timers) clearInterval(id);
    this.timers = [];
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);
    this.seen.clear();
    this.hostSilent = this.hostHidden = false;
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
    this.role = 'solo';
    this.code = '';
    this.kind = '';
    this.me = this.bus.me = this.bus.actor = 'p0';
    this.resyncing = false;
    this.hooks.changed();
  }
}
