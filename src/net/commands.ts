/**
 * 명령(Command) 버스 — 멀티플레이어 대비
 *
 * 세계(실험실)의 상태를 바꾸는 조작은 모두 "명령 객체" 하나로 표현하고, 반드시 bus.dispatch()를 거쳐 실행한다.
 *   - 명령은 JSON으로 그대로 보낼 수 있다: 물체 대신 문자열 이름표(Ref, 예: "item12", "item12/t0")만 담는다.
 *   - 지금(혼자): dispatch → 바로 execute.
 *   - 나중(여럿): dispatch → 방장에게 전송 → 방장이 execute → 결과(상태)를 모두에게 전파.
 *     이때 바꿀 곳은 dispatch 한 곳뿐이다.
 * 패널을 여는 것, 확대 보기처럼 "내 화면에서만" 일어나는 일은 명령이 아니다 (Action.local).
 *
 * 명령 종류
 *   act    대상의 동작 목록에서 같은 이름(label)의 동작을 실행 (집기·문·전원·스위치·밀기 … 대부분)
 *   use    들고 있는 기구(item)를 대상(target)에 쓰기 (지시약 떨어뜨리기, pH 시험지 …)
 *   place  들고 있는 기구를 한 점에 놓기
 *   attach 들고 있는 기구를 소켓에 끼우기
 *   wire / unwire  두 단자 사이 도선 잇기 / 빼기
 *   pour   그릇 → 그릇으로 부피만큼 옮기기
 *   set    대상의 속성 바꾸기 (패널 슬라이더: 전압, 기울기 …) — key는 "sim.airDrag"처럼 점 경로 가능
 *   call   대상의 메서드 부르기 (패널 버튼: 놓기, 기록 시작 …) — 인자에 물체가 있으면 { ref } 로
 *   undo   그 사람이 마지막으로 한 조작 하나 되돌리기 (net/undo.ts — 실행 전후 상태 비교로 기록)
 * 멀티플레이어: 손님의 dispatch는 방장에게 보내기(router)만 한다. 방장이 apply(실행)하고 순서 번호를 붙여
 *   모두에게 돌려주면 각 기기가 applyRemote로 같은 명령을 같은 순서로 실행한다 (net/session.ts).
 * 이름(label)으로 동작을 다시 찾는 것은 일부러다: 실행하는 순간 상태가 달라져 그 동작이 없어졌다면
 * (예: 다른 사람이 먼저 문을 닫음) 명령은 거절된다 — 여럿이 동시에 조작할 때의 충돌 처리.
 */
import type { Action, Interactable } from '../world/interactable';

export type Ref = string;
export type Vec3 = [number, number, number];
export type Arg = number | string | boolean | null | { ref: Ref } | Arg[];

interface Base {
  /** 명령을 낸 사람 (지금은 항상 "p0") */
  by: string;
}

export type Command = Base &
  (
    | { t: 'act'; target: Ref; label: string }
    | { t: 'use'; item: Ref; target: Ref; label: string }
    | { t: 'place'; item: Ref; p: Vec3 }
    | { t: 'attach'; item: Ref; socket: Ref; plug: number; p: Vec3; cam: Vec3 }
    | { t: 'wire'; a: Ref; b: Ref }
    | { t: 'unwire'; a: Ref; b: Ref }
    | { t: 'pour'; src: Ref; dst: Ref; mL: number }
    | { t: 'set'; target: Ref; key: string; value: Arg }
    | { t: 'call'; target: Ref; method: string; args: Arg[] }
    | { t: 'undo' }
  );

type Of<T extends Command['t']> = Extract<Command, { t: T }>;
/** 명령을 실행하는 함수: 실행하면 true, 거절하면 false */
type Handler<T extends Command['t']> = (c: Of<T>) => boolean;

/** 이름표 ↔ 물체 */
export class Registry {
  private byRef = new Map<Ref, object>();
  private refs = new WeakMap<object, Ref>();

  add(ref: Ref, obj: object): void {
    if (this.byRef.has(ref)) throw new Error(`이름표 중복: ${ref}`);
    this.byRef.set(ref, obj);
    this.refs.set(obj, ref);
  }

  ref(obj: object): Ref | null {
    return this.refs.get(obj) ?? null;
  }

  get<T = unknown>(ref: Ref): T | null {
    return (this.byRef.get(ref) as T) ?? null;
  }

  get size(): number {
    return this.byRef.size;
  }
}

export class CommandBus {
  readonly registry = new Registry();
  /** 최근 명령 (디버그·재현용) */
  readonly log: Command[] = [];
  /** 나 (멀티플레이어에서는 접속 순서로 p0 ~ p3) */
  me = 'p0';
  /** 손님일 때만: 명령을 방장에게 보내는 함수 (net/session.ts가 단다) */
  router: ((c: Command) => void) | null = null;
  /** 명령이 나갈 때마다 부름 (나중에 네트워크 전송을 여기에 단다) */
  readonly listeners: ((c: Command, ok: boolean) => void)[] = [];
  /** 지금 실행 중인 명령을 낸 사람 — 폐액통처럼 "누가 들고 있는가"를 묻는 동작용 */
  actor = 'p0';
  private handlers: { [K in Command['t']]?: Handler<K> } = {};
  /** 실행 전후를 지켜보는 기록기 (되돌리기) — 방장 쪽 execute 안에서 불린다 */
  recorder: { begin(c: Command): void; end(c: Command, ok: boolean): void } | null = null;

  on<T extends Command['t']>(t: T, h: Handler<T>): void {
    (this.handlers as Record<string, unknown>)[t] = h;
  }

  /** 명령을 낸다 (지금은 곧바로 실행) */
  dispatch(c: Command): boolean {
    // 보낼 수 있는 모양인지 (JSON으로 왕복해도 같아야 한다) — 개발 중 실수를 바로 잡도록
    if (import.meta.env.DEV && JSON.stringify(JSON.parse(JSON.stringify(c))) !== JSON.stringify(c)) {
      console.warn('직렬화할 수 없는 명령', c);
    }
    // 손님: 방장에게 보내고 여기서는 실행하지 않는다 (방장이 순서를 정해 모두에게 돌려주면 그때 실행)
    if (this.router) {
      this.router(c);
      return true;
    }
    return this.apply(c);
  }

  /** 실행 + 기록 + 알림 (혼자·방장). 방장은 손님이 보낸 명령도 여기로 실행한다 → 리스너가 모두에게 퍼뜨린다 (손 뻗기 모션도 리스너) */
  apply(c: Command): boolean {
    const ok = this.execute(c);
    this.record(c);
    for (const l of this.listeners) l(c, ok);
    return ok;
  }

  /** 손님 쪽: 방장이 순서를 정해 보낸 명령을 실행 (다시 보내지 않는다 — session 리스너는 방장일 때만 퍼뜨린다). 리스너는 불러야 손님 화면에도 손 뻗기 모션이 나온다 */
  applyRemote(c: Command): boolean {
    const ok = this.execute(c);
    this.record(c);
    for (const l of this.listeners) l(c, ok);
    return ok;
  }

  private record(c: Command): void {
    this.log.push(c);
    if (this.log.length > 500) this.log.shift();
  }

  /** 명령 실행 (방장 쪽) */
  execute(c: Command): boolean {
    const h = this.handlers[c.t] as Handler<typeof c.t> | undefined;
    if (!h) {
      console.warn('처리기가 없는 명령', c);
      return false;
    }
    this.actor = c.by;
    this.recorder?.begin(c);
    let ok = false;
    try {
      ok = h(c as never);
      return ok;
    } finally {
      this.recorder?.end(c, ok);
      this.actor = this.me;
    }
  }

  // ---------- 편의 함수: 물체를 받아 이름표로 바꿔 명령을 만든다 ----------

  private need(obj: object): Ref {
    const r = this.registry.ref(obj);
    if (!r) throw new Error('등록되지 않은 물체로 명령을 만들 수 없음');
    return r;
  }

  /** 대상의 동작 하나를 명령으로 감싼다. 내 화면에서만 일어나는 동작(local)은 그대로 */
  wrap(target: Interactable, a: Action): Action {
    if (a.local || !this.registry.ref(target)) return a;
    return { ...a, run: () => { this.dispatch({ t: 'act', by: this.me, target: this.need(target), label: a.label }); } };
  }

  wrapUse(item: object, target: object, a: Action): Action {
    if (a.local) return a;
    return { ...a, run: () => { this.dispatch({ t: 'use', by: this.me, item: this.need(item), target: this.need(target), label: a.label }); } };
  }

  set(target: object, key: string, value: Arg): boolean {
    return this.dispatch({ t: 'set', by: this.me, target: this.need(target), key, value });
  }

  call(target: object, method: string, ...args: unknown[]): boolean {
    return this.dispatch({ t: 'call', by: this.me, target: this.need(target), method, args: args.map((a) => this.encode(a)) });
  }

  encode(a: unknown): Arg {
    if (a === null || a === undefined) return null;
    if (typeof a === 'number' || typeof a === 'string' || typeof a === 'boolean') return a;
    if (Array.isArray(a)) return a.map((x) => this.encode(x));
    if (typeof a === 'object') return { ref: this.need(a) };
    throw new Error(`명령 인자로 쓸 수 없음: ${String(a)}`);
  }

  decode(a: Arg): unknown {
    if (Array.isArray(a)) return a.map((x) => this.decode(x));
    if (a && typeof a === 'object') return this.registry.get(a.ref);
    return a;
  }
}

export const bus = new CommandBus();

/** set 명령 처리: 점 경로("sim.airDrag")를 따라가 원시값만 바꾼다 */
export function applySet(target: object, key: string, value: unknown): boolean {
  const path = key.split('.');
  let o = target as Record<string, unknown>;
  for (const k of path.slice(0, -1)) {
    const next = o[k];
    if (!next || typeof next !== 'object') return false;
    o = next as Record<string, unknown>;
  }
  const last = path[path.length - 1];
  if (!(last in o) || typeof o[last] === 'function') return false;
  o[last] = value;
  return true;
}
