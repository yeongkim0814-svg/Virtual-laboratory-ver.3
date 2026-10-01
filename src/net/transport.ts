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
    bc.onmessage = (e: MessageEvent<Wire>) => {
      const m = e.data;
      if (m.to !== 'host') return;
      if (m.t === 'join') {
        const link: Link = {
          peer: m.from,
          send: (ch, msg) => bc.postMessage({ to: m.from, from: 'host', t: 'data', ch, msg } satisfies Wire),
          close: () => bc.postMessage({ to: m.from, from: 'host', t: 'bye' } satisfies Wire),
        };
        links.set(m.from, link);
        bc.postMessage({ to: m.from, from: 'host', t: 'joined' } satisfies Wire);
        h.onLink(link);
      } else if (m.t === 'data') {
        const link = links.get(m.from);
        if (link) h.onMessage(link, m.ch!, m.msg);
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
        bc.close();
      },
    });
  }

  join(code: string, h: Handlers): Promise<Link> {
    const bc = new BroadcastChannel(`vlab-room-${code}`);
    const me = rid();
    return new Promise((resolve, reject) => {
      let link: Link | null = null;
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
            send: (ch, msg) => bc.postMessage({ to: 'host', from: me, t: 'data', ch, msg } satisfies Wire),
            close: () => {
              bc.postMessage({ to: 'host', from: me, t: 'bye' } satisfies Wire);
              bc.close();
            },
          };
          resolve(link);
        } else if (m.t === 'data' && link) h.onMessage(link, m.ch!, m.msg);
        else if (m.t === 'bye' && link) {
          bc.close();
          h.onClose(link);
        }
      };
      bc.postMessage({ to: 'host', from: me, t: 'join' } satisfies Wire);
    });
  }
}

// ---------------------------------------------------------------- WebRTC (PeerJS)

/** 연결 시도 제한 시간 (ms) — 학교·통신사 망은 느리게 붙기도 한다 */
const PEER_TIMEOUT = 15000;
const ID_PREFIX = 'vlab3-';

export class PeerTransport implements Transport {
  readonly kind = 'peer' as const;

  private async open(id?: string) {
    const { Peer } = await import('peerjs');
    return new Promise<InstanceType<typeof Peer>>((resolve, reject) => {
      const peer = id ? new Peer(id) : new Peer();
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
    const slots = new Map<string, { cmd?: Conn; fast?: Conn; link?: Link }>();
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
            send: (c, msg) => {
              const target = c === 'fast' && slot.fast?.open ? slot.fast : slot.cmd;
              if (target?.open) target.send(msg);
            },
            close: () => {
              slot.cmd?.close();
              slot.fast?.close();
            },
          };
          slot.link = link;
          h.onLink(link);
        }
      };
      conn.on('open', ready);
      conn.on('data', (d: unknown) => slot.link && h.onMessage(slot.link, ch, d));
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
      send: (c, msg) => {
        const t = c === 'fast' && fast.open ? fast : cmd;
        if (t.open) t.send(msg);
      },
      close: () => peer.destroy(),
    };
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
    cmd.on('data', (d: unknown) => h.onMessage(link, 'cmd', d));
    fast.on('data', (d: unknown) => h.onMessage(link, 'fast', d));
    cmd.on('close', () => h.onClose(link));
    return link;
  }
}
