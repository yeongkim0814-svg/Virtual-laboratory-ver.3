/**
 * 되돌리기: 사람마다 마지막 조작 하나 (다시 하기 없음)
 *
 * 명령마다 반대 명령을 따로 만들지 않는다. 명령을 실행하기 직전·직후의 "배치 상태"를 찍어 비교하고,
 * 바뀐 기구만 이전 상태로 적어 둔다 (act 명령은 이름으로 아무 동작이나 부르므로 반대 동작을 일일이 짤 수 없다).
 *   배치 상태 = 기구마다 { 어디에 붙었나(장면·소켓·손), 위치·방향, 미끄럼 소켓 높이, 전원 콘센트, 숫자·참거짓·글자 설정값 }
 *             + 도선 목록 + set 명령의 이전 값
 *   되돌리지 않는 것: 화학(용액의 부피·몰수가 바뀐 조작 — 되돌리기 기록을 지운다), 움직이는 중인 상태(속도·흔들림),
 *                    측정 기록, 칠판 글씨, 보관장 문
 * 여럿이 할 때: 기구마다 "마지막으로 바꾼 명령 번호"를 둔다. 내 조작 뒤에 다른 사람이 같은 기구를 바꿨으면 거절.
 * 실행은 방장 쪽 bus.execute 안(recorder)에서 일어나므로 멀티플레이어에서도 같은 자리에서 기록된다.
 */
import * as THREE from 'three';
import { applySet, type Command, type CommandBus } from './commands';
import type { Item, Plug, Socket } from '../world/items';
import type { Holdings } from './worldSync';
import type { Wire, WireSystem } from '../world/wires';
import type { OutletPort, PowerSystem } from '../world/power';

type Prim = number | string | boolean | null;

interface ItemState {
  /** 손에 들림 / 소켓에 끼워짐 / 그 밖의 부모(보통 장면) */
  where: 'hand' | 'socket' | 'parent';
  /** 손에 든 사람 */
  holder: string | null;
  socket: Socket | null;
  plug: Plug | null;
  parent: THREE.Object3D | null;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  /** 소켓에 끼웠을 때 개별 기준점(미끄럼 높이·돌린 방향) */
  anchorPos: THREE.Vector3 | null;
  anchorRotY: number;
  /** 전원 콘센트 (전원 기기만, 아니면 undefined) */
  port: OutletPort | null | undefined;
  fields: Record<string, Prim>;
}

interface Snapshot {
  items: Map<Item, ItemState>;
  wires: Set<Wire>;
  chem: string;
  /** set 명령의 이전 값 */
  set: { target: object; key: string; value: unknown } | null;
}

interface Record_ {
  seq: number;
  label: string;
  items: Map<Item, ItemState>;
  /** 이전 상태의 필드 중 바뀐 것만 */
  fields: Map<Item, Record<string, Prim>>;
  wiresAdded: Wire[];
  wiresRemoved: Wire[];
  set: { target: object; key: string; value: unknown } | null;
}

export interface UndoDeps {
  bus: CommandBus;
  items: Item[];
  /** 누가 무엇을 들고 있나 (나는 손, 남은 아바타) */
  holdings: Holdings & { heldOf(who: string): Item | null };
  wires: WireSystem;
  power: PowerSystem;
  /** 용액이 든 그릇 (화학 조작 감지용) */
  containers: { solution: { V: number; n: object } }[];
}

const METHOD: Record<string, string> = { nudge: '이동', setYawDeg: '회전', turnByDeg: '회전' };

export class UndoKeeper {
  private before: Snapshot | null = null;
  private seq = 0;
  private lastTouch = new Map<object, number>();
  /** 사람별 되돌릴 조작 하나 (blocked = 화학 조작 뒤라 되돌릴 수 없음) */
  private slots = new Map<string, Record_ | { blocked: string }>();
  /** 마지막 되돌리기 결과 문구 (화면 알림용) */
  message = '';

  constructor(private d: UndoDeps) {}

  /** 지금 되돌릴 수 있는 조작의 이름 (없으면 null) — 버튼 표시용 */
  pending(who: string): string | null {
    const s = this.slots.get(who);
    return s && 'label' in s ? s.label : null;
  }

  /** 되돌릴 수 없는 까닭 (화학 조작 뒤 등). 없으면 null — 버튼을 눌러 이유를 볼 수 있게 */
  blocked(who: string): string | null {
    const s = this.slots.get(who);
    return s && 'blocked' in s ? s.blocked : null;
  }

  begin(c: Command): void {
    this.before = c.t === 'undo' ? null : this.snapshot(c);
  }

  end(c: Command, ok: boolean): void {
    const b = this.before;
    this.before = null;
    if (!ok || !b) return;
    const a = this.snapshot(null);
    const seq = ++this.seq;
    if (a.chem !== b.chem) {
      // 화학은 되돌리지 않는다 (실제 실험처럼). 그 전 조작도 이 그릇과 얽혔을 수 있으니 기록을 지운다
      this.slots.set(c.by, { blocked: '화학 조작(따르기·지시약 등)은 되돌리지 않음' });
      return;
    }
    const rec: Record_ = { seq, label: this.label(c), items: new Map(), fields: new Map(), wiresAdded: [], wiresRemoved: [], set: b.set };
    for (const [it, s0] of b.items) {
      const s1 = a.items.get(it)!;
      const f: Record<string, Prim> = {};
      for (const k of new Set([...Object.keys(s0.fields), ...Object.keys(s1.fields)])) {
        // 둘 다 단순 값일 때만 (null ↔ 물체로 바뀐 칸은 붙음·전원 같은 구조라 위에서 따로 되돌린다)
        if (k in s0.fields && k in s1.fields && s0.fields[k] !== s1.fields[k]) f[k] = s0.fields[k];
      }
      const moved = !samePlace(s0, s1);
      if (moved) rec.items.set(it, s0);
      if (Object.keys(f).length) rec.fields.set(it, f);
      if (moved || Object.keys(f).length) this.lastTouch.set(it, seq);
    }
    for (const w of a.wires) if (!b.wires.has(w)) rec.wiresAdded.push(w);
    for (const w of b.wires) if (!a.wires.has(w)) rec.wiresRemoved.push(w);
    for (const w of [...rec.wiresAdded, ...rec.wiresRemoved]) for (const it of [w.a.owner, w.b.owner]) this.lastTouch.set(it, seq);
    if (rec.set) this.lastTouch.set(rec.set.target, seq);
    const empty = !rec.items.size && !rec.fields.size && !rec.wiresAdded.length && !rec.wiresRemoved.length && !rec.set;
    if (!empty) this.slots.set(c.by, rec); // 아무것도 안 바뀐 조작(문 열기 등)은 앞의 기록을 그대로 둔다
  }

  /** undo 명령 처리 (방장 쪽). 되돌렸으면 true */
  undo(who0: string): boolean {
    const who = who0;
    const s = this.slots.get(who);
    if (!s) return this.fail('되돌릴 조작이 없음');
    if ('blocked' in s) return this.fail(s.blocked);
    const touched = [...s.items.keys(), ...s.fields.keys(), ...(s.set ? [s.set.target] : []),
      ...[...s.wiresAdded, ...s.wiresRemoved].flatMap((w) => [w.a.owner, w.b.owner])];
    if (touched.some((o) => (this.lastTouch.get(o) ?? 0) > s.seq)) return this.fail('다른 사람이 그 뒤에 같은 기구를 바꿈');
    const { holdings, wires, power } = this.d;
    // 1) 도선: 새로 생긴 것은 빼고, 빠진 것은 다시 잇는다
    for (const w of s.wiresAdded) if (wires.wires.includes(w)) wires.remove(w);
    for (const w of s.wiresRemoved) wires.connect(w.a, w.b);
    // 2) 기구 자리: 장면 → 소켓 → 손 순서 (끼울 곳이 먼저 제자리에 있도록)
    const order = (st: ItemState) => (st.where === 'parent' ? 0 : st.where === 'socket' ? 1 : 2);
    for (const [it, st] of [...s.items].sort((x, y) => order(x[1]) - order(y[1]))) {
      if (st.where === 'hand') {
        const who = st.holder ?? who0;
        const cur = holdings.heldOf(who);
        if (cur && cur !== it) return this.fail(`손에 든 것(${cur.name})을 먼저 내려놓아야 함`);
        if (cur !== it) holdings.hold(who, it);
        continue;
      }
      holdings.release(it);
      it.detachFromParent();
      if (st.where === 'socket' && st.socket && st.plug) {
        st.socket.attach(it, st.plug);
        const anchor = it.object.parent!;
        if (st.anchorPos) anchor.position.copy(st.anchorPos);
        anchor.rotation.y = st.anchorRotY;
      } else {
        st.parent?.add(it.object);
      }
      it.object.position.copy(st.pos);
      it.object.quaternion.copy(st.quat);
      it.object.updateMatrixWorld(true);
    }
    // 3) 전원 콘센트
    for (const [it, st] of s.items) {
      if (st.port === undefined) continue;
      const dev = it as unknown as Parameters<PowerSystem['plug']>[0];
      if (st.port && !st.port.device) power.plug(dev, st.port);
      else if (!st.port) power.unplug(dev);
    }
    // 4) 설정값 (숫자·참거짓·글자)과 set 명령의 이전 값
    for (const [it, f] of s.fields) {
      for (const [k, v] of Object.entries(f)) {
        (it as unknown as Record<string, Prim>)[k] = v;
      }
    }
    if (s.set) applySet(s.set.target, s.set.key, s.set.value);
    this.slots.delete(who); // 다시 하기 없음, 최근 하나만
    this.message = `되돌림: ${s.label}`;
    return true;
  }

  private fail(msg: string): boolean {
    this.message = msg;
    return false;
  }

  private snapshot(c: Command | null): Snapshot {
    const { items, holdings, wires, containers, bus } = this.d;
    const map = new Map<Item, ItemState>();
    for (const it of items) {
      const o = it.object;
      const fields: Record<string, Prim> = {};
      for (const [k, v] of Object.entries(it)) {
        if (v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') fields[k] = v as Prim;
      }
      const anchor = it.attachedTo ? o.parent : null;
      map.set(it, {
        where: holdings.holderOf(it) ? 'hand' : it.attachedTo ? 'socket' : 'parent',
        holder: holdings.holderOf(it),
        socket: it.attachedTo,
        plug: it.attachedPlug,
        parent: o.parent,
        pos: o.position.clone(),
        quat: o.quaternion.clone(),
        anchorPos: anchor ? anchor.position.clone() : null,
        anchorRotY: anchor ? anchor.rotation.y : 0,
        port: 'port' in it ? ((it as { port: OutletPort | null }).port ?? null) : undefined,
        fields,
      });
    }
    let set: Snapshot['set'] = null;
    if (c?.t === 'set') {
      const target = bus.registry.get<object>(c.target);
      if (target) set = { target, key: c.key, value: readPath(target, c.key) };
    }
    return {
      items: map,
      wires: new Set(wires.wires),
      chem: containers.map((x) => `${x.solution.V.toExponential(9)}${JSON.stringify(x.solution.n)}`).join('|'),
      set,
    };
  }

  private label(c: Command): string {
    const name = (r: string) => this.d.bus.registry.get<{ name?: string }>(r)?.name ?? '';
    switch (c.t) {
      case 'act':
      case 'use':
        return c.label;
      case 'place':
        return `놓기 · ${name(c.item)}`;
      case 'attach':
        return `연결 · ${name(c.item)}`;
      case 'wire':
        return '도선 연결';
      case 'unwire':
        return '도선 빼기';
      case 'set':
        return `설정 · ${name(c.target)}`;
      case 'call':
        return `${METHOD[c.method] ?? c.method} · ${name(c.target)}`;
      default:
        return c.t;
    }
  }
}

function samePlace(a: ItemState, b: ItemState): boolean {
  return a.where === b.where && a.holder === b.holder && a.socket === b.socket && a.plug === b.plug && a.parent === b.parent && a.port === b.port &&
    a.pos.equals(b.pos) && a.quat.equals(b.quat) && a.anchorRotY === b.anchorRotY &&
    (a.anchorPos === b.anchorPos || (!!a.anchorPos && !!b.anchorPos && a.anchorPos.equals(b.anchorPos)));
}

function readPath(target: object, key: string): unknown {
  let o: unknown = target;
  for (const k of key.split('.')) o = o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined;
  return o;
}
