/**
 * 통신 계층: "방장 한 명 + 손님들" 별 모양 연결.
 *   - local : 같은 브라우저의 탭끼리 (BroadcastChannel) — 테스트·한 기기 두 창
 *   - peer  : WebRTC (PeerJS). 신호 서버는 연결을 맺을 때만 쓰고, 그 뒤 데이터는 기기끼리 직접 오간다
 * 통로는 둘: 'cmd' = 순서·도착 보장(명령·입장·스냅숏), 'fast' = 순서 보장 없음(아바타 자세·물리 상태).
 *   늦게 온 자세 하나가 명령을 막지 않게 하려는 것이다.
 * 방 코드 4글자 (헷갈리는 0/O, 1/I/L 제외).
 */
export type Channel = 'cmd' | 'fast';

export interface Link {
  /** 상대 id (방장 쪽에서는 손님의 연결 id, 손님 쪽에서는 'host') */
  readonly peer: string;
  send(ch: Channel, msg: unknown): void;
  close(): void;
}

export interface Handlers {
  /** 방장: 새 손님이 연결됨 */
  onLink(link: Link): void;
  onMessage(link: Link, ch: Channel, msg: unknown): void;
  onClose(link: Link): void;
}

export interface HostHandle {
  code: string;
  close(): void;
}

export interface Transport {
  readonly kind: 'local' | 'peer';
  host(h: Handlers): Promise<HostHandle>;
  join(code: string, h: Handlers): Promise<Link>;
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function randomCode(): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}
export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
const rid = () => Math.random().toString(36).slice(2, 10);


// ---------------------------------------------------------------- 메시지 크기
/**
 * PeerJS(1.5)의 JSON 통로는 한 메시지가 16 300바이트 이상이면 "Message too big"으로 버린다 (오류만 내고 보내지 않음).
 * 입장 때 세계 스냅숏(약 44 KB, 칠판 그림이 있으면 더 큼)이 여기에 걸려 손님이 영영 들어오지 못했다.
 * 같은 브라우저 통로(테스트)에도 같은 한도를 걸어, 큰 메시지가 생기면 테스트가 바로 실패하게 한다.
 */
export const MAX_FRAME = 16000;
const enc = new TextEncoder();
function checkFrame(msg: unknown): void {
  const n = enc.encode(JSON.stringify(msg)).length;
  if (n >= MAX_FRAME) throw new Error(`통신 메시지가 너무 큼: ${n} 바이트 (WebRTC 한도 ${MAX_FRAME})`);
}


/**
 * 큰 메시지 나누기: JSON 글자 수가 PART를 넘으면 조각 {k:'__part', id, i, n, c, s}로 나눠 'cmd'(순서·도착 보장)로 보내고
 * 받는 쪽에서 다 모이면 이어 붙여 원래 통로(c) 메시지로 넘긴다. PART 2500자 = 한 글자가 최악(이스케이프 6바이트)이어도 16 KB 아래.
 */
const PART = 2500;
interface Part { k: '__part'; id: number; i: number; n: number; c: Channel; s: string }

function framedSender(raw: (ch: Channel, msg: unknown) => void): (ch: Channel, msg: unknown) => void {
  let next = 0;
  return (ch, msg) => {
    const text = JSON.stringify(msg);
    if (text.length <= PART) { raw(ch, msg); return; }
    const id = ++next;
    const n = Math.ceil(text.length / PART);
    for (let i = 0; i < n; i++) raw('cmd', { k: '__part', id, i, n, c: ch, s: text.slice(i * PART, (i + 1) * PART) } satisfies Part);
  };
}

function framedReceiver(deliver: (ch: Channel, msg: unknown) => void): (ch: Channel, msg: unknown) => void {
  const bufs = new Map<number, { got: number; parts: string[] }>();
  return (ch, msg) => {
    const p = msg as Part | null;
    if (!p || p.k !== '__part') { deliver(ch, msg); return; }
    const b = bufs.get(p.id) ?? { got: 0, parts: new Array<string>(p.n) };
    bufs.set(p.id, b);
    if (b.parts[p.i] === undefined) { b.parts[p.i] = p.s; b.got++; }
    if (b.got === p.n) {
      bufs.delete(p.id);
      deliver(p.c, JSON.parse(b.parts.join('')));
    }
  };
}

// ---------------------------------------------------------------- 같은 브라우저 (BroadcastChannel)

interface Wire {
  to: string;
  from: string;
  t: 'join' | 'joined' | 'data' | 'bye';
  ch?: Channel;
  msg?: unknown;
}

export class LocalTransport implements Transport {
  readonly kind = 'local' as const;

  host(h: Handlers): Promise<HostHandle> {
    const code = randomCode();
    const bc = new BroadcastChannel(`vlab-room-${code}`);
    const links = new Map<string, Link>();
    const recv = new Map<string, (ch: Channel, msg: unknown) => void>();
    bc.onmessage = (e: MessageEvent<Wire>) => {
      const m = e.data;
      if (m.to !== 'host') return;
      if (m.t === 'join') {
        let closed = false;
        const link: Link = {
          peer: m.from,
          send: framedSender((ch, msg) => { if (!closed) { checkFrame(msg); bc.postMessage({ to: m.from, from: 'host', t: 'data', ch, msg } satisfies Wire); } }),
          close: () => {
            if (closed) return;
            closed = true;
            bc.postMessage({ to: m.from, from: 'host', t: 'bye' } satisfies Wire);
          },
        };
        links.set(m.from, link);
        recv.set(m.from, framedReceiver((ch, msg) => h.onMessage(link, ch, msg)));
        bc.postMessage({ to: m.from, from: 'host', t: 'joined' } satisfies Wire);
        h.onLink(link);
      } else if (m.t === 'data') {
        recv.get(m.from)?.(m.ch!, m.msg);
      } else if (m.t === 'bye') {
        const link = links.get(m.from);
        if (link) {
          links.delete(m.from);
          h.onClose(link);
        }
      }
    };
    return Promise.resolve({
      code,
      close: () => {
        for (const l of links.values()) l.close();
        links.clear();
        bc.close();
      },
    });
  }

  join(code: string, h: Handlers): Promise<Link> {
    const bc = new BroadcastChannel(`vlab-room-${code}`);
    const me = rid();
    return new Promise((resolve, reject) => {
      let link: Link | null = null;
      let closed = false;
      const recv = framedReceiver((ch, msg) => link && h.onMessage(link, ch, msg));
      const timer = setTimeout(() => {
        bc.close();
        reject(new Error('방을 찾지 못함 (같은 브라우저에서 만든 방만 보임)'));
      }, 3000);
      bc.onmessage = (e: MessageEvent<Wire>) => {
        const m = e.data;
        if (m.to !== me) return;
        if (m.t === 'joined' && !link) {
          clearTimeout(timer);
          link = {
            peer: 'host',
            send: framedSender((ch, msg) => { if (!closed) { checkFrame(msg); bc.postMessage({ to: 'host', from: me, t: 'data', ch, msg } satisfies Wire); } }),
            close: () => {
              if (closed) return;
              closed = true;
              bc.postMessage({ to: 'host', from: me, t: 'bye' } satisfies Wire);
              bc.close();
            },
          };
          resolve(link);
        } else if (m.t === 'data' && link) recv(m.ch!, m.msg);
        else if (m.t === 'bye' && link && !closed) {
          closed = true;
          bc.close();
          h.onClose(link);
        }
      };
      bc.postMessage({ to: 'host', from: me, t: 'join' } satisfies Wire);
    });
  }
}

// ---------------------------------------------------------------- WebRTC (PeerJS)

/**
 * ICE 서버: STUN은 두 기기가 서로의 바깥 주소를 알아내 직접 연결하게 돕는다 (대부분의 가정·학교 Wi-Fi끼리는 이것으로 충분).
 * 서로 다른 망이 엄격한 NAT(통신사 CGNAT·학교 방화벽)에 막히면 직접 연결이 안 되고, 이때는 TURN(중계) 서버가 필요하다.
 * TURN은 무료로 안정적인 공개 서버가 없어 직접 계정(Metered · Cloudflare 등)을 만들어 넣는다:
 *   빌드 시  VITE_TURN_URLS="turn:서버:3478,turns:서버:443"  VITE_TURN_USER=...  VITE_TURN_CRED=...
 *   또는 브라우저 localStorage 'vlab-turn' = {"urls":["turn:..."],"username":"...","credential":"..."}
 */
function iceServers(): { urls: string | string[]; username?: string; credential?: string }[] {
  const list: { urls: string | string[]; username?: string; credential?: string }[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];
  const env = import.meta.env as Record<string, string | undefined>;
  if (env.VITE_TURN_URLS) list.push({ urls: env.VITE_TURN_URLS.split(','), username: env.VITE_TURN_USER, credential: env.VITE_TURN_CRED });
  try {
    const raw = localStorage.getItem('vlab-turn');
    if (raw) list.push(JSON.parse(raw));
  } catch { /* 저장소를 못 쓰거나 형식이 틀리면 무시 */ }
  return list;
}

/**
 * 신호 서버: 기본은 PeerJS 공개 서버. 직접 띄운 서버(npx peerjs --port 9000)를 쓰려면
 * localStorage 'vlab-peer-server' = {"host":"192.168.0.10","port":9000,"path":"/","secure":false}
 */
function peerServer(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem('vlab-peer-server');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** 연결 시도 제한 시간 (ms) — 학교·통신사 망은 느리게 붙기도 한다 */
const PEER_TIMEOUT = 15000;
const ID_PREFIX = 'vlab3-';

export class PeerTransport implements Transport {
  readonly kind = 'peer' as const;

  private async open(id?: string) {
    const { Peer } = await import('peerjs');
    return new Promise<InstanceType<typeof Peer>>((resolve, reject) => {
      const config = { ...peerServer(), config: { iceServers: iceServers() } };
      const peer = id ? new Peer(id, config) : new Peer(config);
      const timer = setTimeout(() => {
        peer.destroy();
        reject(new Error('신호 서버에 연결하지 못함 (인터넷 연결 확인)'));
      }, PEER_TIMEOUT);
      peer.on('open', () => {
        clearTimeout(timer);
        resolve(peer);
      });
      peer.on('error', (err: { type?: string }) => {
        clearTimeout(timer);
        peer.destroy();
        reject(Object.assign(new Error(err.type === 'unavailable-id' ? '방 코드 겹침' : `연결 오류: ${err.type ?? err}`), { type: err.type }));
      });
    });
  }

  async host(h: Handlers): Promise<HostHandle> {
    let peer: Awaited<ReturnType<PeerTransport['open']>> | null = null;
    let code = '';
    for (let i = 0; i < 6 && !peer; i++) {
      code = randomCode();
      try {
        peer = await this.open(ID_PREFIX + code);
      } catch (e) {
        if ((e as { type?: string }).type !== 'unavailable-id') throw e;
      }
    }
    if (!peer) throw new Error('방 코드를 만들지 못함');
    type Conn = ReturnType<typeof peer.connect>;
    const slots = new Map<string, { cmd?: Conn; fast?: Conn; link?: Link; recv?: (ch: Channel, msg: unknown) => void }>();
    peer.on('connection', (conn: Conn) => {
      const cid = (conn.metadata as { cid: string }).cid;
      const slot = slots.get(cid) ?? {};
      slots.set(cid, slot);
      const ch = conn.label as Channel;
      slot[ch] = conn;
      const ready = () => {
        if (ch === 'cmd' && !slot.link) {
          const link: Link = {
            peer: cid,
            send: framedSender((c, msg) => {
              const target = c === 'fast' && slot.fast?.open ? slot.fast : slot.cmd;
              if (target?.open) target.send(msg);
            }),
            close: () => {
              slot.cmd?.close();
              slot.fast?.close();
            },
          };
          slot.link = link;
          slot.recv = framedReceiver((c, msg) => h.onMessage(link, c, msg));
          h.onLink(link);
        }
      };
      conn.on('open', ready);
      conn.on('data', (d: unknown) => slot.recv?.(ch, d));
      conn.on('error', (e: unknown) => console.warn('[통신] 연결 오류', ch, e));
      conn.on('close', () => {
        if (ch === 'cmd' && slot.link) {
          const l = slot.link;
          slots.delete(cid);
          h.onClose(l);
        }
      });
    });
    return { code, close: () => peer!.destroy() };
  }

  async join(code: string, h: Handlers): Promise<Link> {
    const peer = await this.open();
    const cid = peer.id;
    const target = ID_PREFIX + code;
    const cmd = peer.connect(target, { label: 'cmd', reliable: true, serialization: 'json', metadata: { cid } });
    const fast = peer.connect(target, { label: 'fast', reliable: false, serialization: 'json', metadata: { cid } });
    const link: Link = {
      peer: 'host',
      send: framedSender((c, msg) => {
        const t = c === 'fast' && fast.open ? fast : cmd;
        if (t.open) t.send(msg);
      }),
      close: () => peer.destroy(),
    };
    const recv = framedReceiver((c, msg) => h.onMessage(link, c, msg));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        peer.destroy();
        reject(new Error('방에 연결하지 못함 (코드 확인 · 같은 망이 아니면 막힐 수 있음)'));
      }, PEER_TIMEOUT);
      cmd.on('open', () => {
        clearTimeout(timer);
        resolve();
      });
      peer.on('error', (err: { type?: string }) => {
        clearTimeout(timer);
        peer.destroy();
        reject(new Error(err.type === 'peer-unavailable' ? '그 코드의 방이 없음' : `연결 오류: ${err.type ?? err}`));
      });
    });
    cmd.on('data', (d: unknown) => recv('cmd', d));
    fast.on('data', (d: unknown) => recv('fast', d));
    for (const c of [cmd, fast]) c.on('error', (e: unknown) => console.warn('[통신] 연결 오류', c.label, e));
    cmd.on('close', () => h.onClose(link));
    return link;
  }
}
