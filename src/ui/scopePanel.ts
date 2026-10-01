/**
 * 오실로스코프 · 함수 발생기 패널
 * 파형을 보면서 발생기 주파수·진폭을 바로 바꾼다. 모든 조작은 명령(bus.set)으로 — 설정은 기구의 단순 필드라 되돌리기·멀티플레이어가 자동으로 따른다.
 * 커서(화면 위 흰 점선)는 내 화면에서만 쓰는 판독 도구라 명령으로 보내지 않는다.
 */
import { bus } from '../net/commands';
import { downloadCsv, stamp } from './plotKit';
import {
  GEN_F_MAX, GEN_F_MIN, SCOPE_N, T_DIVS, V_DIVS, drawScope, fmtFreq, fmtTime, fmtVolt, type Cursors, type FuncGen, type Oscilloscope,
} from '../equipment/scope';
import type { Wave } from '../sim/transient';

const W = 400;
const H = 320;

function stepIn(arr: number[], val: number, dir: number): number {
  let k = 0;
  for (let i = 0; i < arr.length; i++) if (Math.abs(Math.log(arr[i] / val)) < Math.abs(Math.log(arr[k] / val))) k = i;
  return arr[Math.min(arr.length - 1, Math.max(0, k + dir))];
}

const roundFreq = (f: number) => Math.min(GEN_F_MAX, Math.max(GEN_F_MIN, f >= 100 ? Math.round(f) : f >= 10 ? Math.round(f * 10) / 10 : Math.round(f * 100) / 100));
const sliderOf = (f: number) => (1000 * Math.log(f / GEN_F_MIN)) / Math.log(GEN_F_MAX / GEN_F_MIN);
const freqOf = (x: number) => GEN_F_MIN * (GEN_F_MAX / GEN_F_MIN) ** (x / 1000);

export class ScopePanel {
  readonly el = byId('sc-panel');
  target: Oscilloscope | null = null;
  gen: FuncGen | null = null;
  private screen = byId<HTMLCanvasElement>('sc-screen');
  private g = this.screen.getContext('2d')!;
  private cur: Cursors = { x: [null, null], y: [null, null] };
  private curMode: 't' | 'v' = 't';
  private next = { t: 0, v: 0 };
  private lastText = 0;
  private drawnKey = '';

  constructor(private onToggle: (open: boolean) => void, private gens: FuncGen[]) {
    this.screen.width = W;
    this.screen.height = H;
    const sc = () => this.target;
    const set = (key: string, value: number | boolean | string) => { const t = sc(); if (t) bus.set(t, key, value); this.refresh(); };
    byId('sc-close').addEventListener('click', () => this.close());
    byId('sc-power').addEventListener('click', () => { const t = sc(); if (t?.port) set('on', !t.on); });
    for (const b of byId('sc-mode').querySelectorAll<HTMLButtonElement>('button[data-v]')) b.addEventListener('click', () => set('mode', b.dataset.v!));
    byId('sc-hold').addEventListener('click', () => { const t = sc(); if (t) set('hold', !t.hold); });
    byId('sc-t-minus').addEventListener('click', () => { const t = sc(); if (t) set('tdiv', stepIn(T_DIVS, t.tdiv, -1)); });
    byId('sc-t-plus').addEventListener('click', () => { const t = sc(); if (t) set('tdiv', stepIn(T_DIVS, t.tdiv, 1)); });
    for (const n of [1, 2] as const) {
      byId<HTMLInputElement>(`sc-show${n}`).addEventListener('change', (e) => set(`show${n}`, (e.target as HTMLInputElement).checked));
      byId(`sc-v${n}-minus`).addEventListener('click', () => { const t = sc(); if (t) set(`vdiv${n}`, stepIn(V_DIVS, n === 1 ? t.vdiv1 : t.vdiv2, -1)); });
      byId(`sc-v${n}-plus`).addEventListener('click', () => { const t = sc(); if (t) set(`vdiv${n}`, stepIn(V_DIVS, n === 1 ? t.vdiv1 : t.vdiv2, 1)); });
      const pos = (d: number) => { const t = sc(); if (t) set(`pos${n}`, Math.min(4, Math.max(-4, Math.round(((n === 1 ? t.pos1 : t.pos2) + d) * 2) / 2))); };
      byId(`sc-p${n}-minus`).addEventListener('click', () => pos(-0.5));
      byId(`sc-p${n}-plus`).addEventListener('click', () => pos(0.5));
    }
    for (const b of byId('sc-trigch').querySelectorAll<HTMLButtonElement>('button')) b.addEventListener('click', () => set('trigCh', Number(b.dataset.v)));
    for (const b of byId('sc-trigslope').querySelectorAll<HTMLButtonElement>('button')) b.addEventListener('click', () => set('trigRise', b.dataset.v === 'rise'));
    byId<HTMLInputElement>('sc-tl').addEventListener('input', (e) => set('trigLevel', Math.round(Number((e.target as HTMLInputElement).value) * 100) / 100));
    for (const b of byId('sc-curmode').querySelectorAll<HTMLButtonElement>('button[data-v]')) b.addEventListener('click', () => { this.curMode = b.dataset.v as 't' | 'v'; this.refresh(); });
    byId('sc-curclear').addEventListener('click', () => { this.cur = { x: [null, null], y: [null, null] }; this.next = { t: 0, v: 0 }; this.drawnKey = ''; this.refresh(); });
    this.screen.addEventListener('pointerdown', (e) => {
      const r = this.screen.getBoundingClientRect();
      const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const fy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      if (this.curMode === 't') { this.cur.x[this.next.t] = fx; this.next.t = 1 - this.next.t; }
      else { this.cur.y[this.next.v] = fy; this.next.v = 1 - this.next.v; }
      this.drawnKey = '';
      this.refresh();
    });
    byId('sc-csv').addEventListener('click', () => {
      const t = sc();
      if (!t?.sim.has) return;
      const rows: (string | number)[][] = [];
      for (let i = 0; i < SCOPE_N; i++) rows.push([(i * t.sim.dt).toExponential(6), t.sim.ch1[i].toFixed(5), t.sim.ch2[i].toFixed(5)]);
      downloadCsv(`scope-${stamp()}.csv`, ['t_s', 'ch1_V', 'ch2_V'], rows);
    });

    // ---- 함수 발생기 ----
    const gset = (key: string, value: number | boolean | string) => { if (this.gen) bus.set(this.gen, key, value); this.refresh(); };
    byId('fg-power').addEventListener('click', () => { const g = this.gen; if (g?.port) gset('on', !g.on); });
    for (const b of byId('fg-wave').querySelectorAll<HTMLButtonElement>('button')) b.addEventListener('click', () => gset('wave', b.dataset.v as Wave));
    byId<HTMLInputElement>('fg-f').addEventListener('input', (e) => gset('freq', roundFreq(freqOf(Number((e.target as HTMLInputElement).value)))));
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('button[data-df]')) {
      b.addEventListener('click', () => { if (this.gen) gset('freq', roundFreq(this.gen.freq * Number(b.dataset.df))); });
    }
    byId<HTMLInputElement>('fg-f-num').addEventListener('change', (e) => {
      const x = Number((e.target as HTMLInputElement).value);
      if (Number.isFinite(x) && x > 0) gset('freq', roundFreq(x));
    });
    byId<HTMLInputElement>('fg-a').addEventListener('input', (e) => gset('amp', Math.round(Number((e.target as HTMLInputElement).value) * 100) / 100));
    byId<HTMLInputElement>('fg-o').addEventListener('input', (e) => gset('offset', Math.round(Number((e.target as HTMLInputElement).value) * 100) / 100));
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(target: Oscilloscope, gen?: FuncGen): void {
    this.target = target;
    this.gen = gen ?? target.sim.gens[0] ?? this.gens[0] ?? null;
    this.el.hidden = false;
    this.drawnKey = '';
    this.refresh();
    this.onToggle(true);
  }

  close(): void {
    this.el.hidden = true;
    this.target = null;
    this.onToggle(false);
  }

  update(): void {
    if (!this.isOpen || !this.target) return;
    const t = this.target;
    const key = [t.sim.seq, t.on, t.mode, t.show1, t.show2, t.vdiv1, t.vdiv2, t.pos1, t.pos2, t.trigLevel, t.trigCh, t.trigRise, t.tdiv, this.cur.x, this.cur.y].join('|');
    if (key !== this.drawnKey) {
      this.drawnKey = key;
      drawScope(this.g, W, H, t, false, this.cur);
    }
    const now = performance.now();
    if (now - this.lastText > 150) {
      this.lastText = now;
      this.refresh();
    }
  }

  private refresh(): void {
    const t = this.target;
    if (!t) return;
    const s = t.sim;
    byId('sc-status').textContent = !t.port ? '콘센트에 꽂혀 있지 않습니다 — 기기를 두 번 탭해 "전원 연결"' : !t.on ? '꺼져 있음' : s.has ? (t.hold ? '정지됨' : t.mode === 'xy' ? 'X-Y 모드: CH1 = 가로, CH2 = 세로' : s.triggered ? '트리거 잡힘' : '트리거 못 잡음 — 레벨·채널을 확인') : s.note;
    byId('sc-power').textContent = !t.port ? '콘센트에 꽂혀 있지 않음' : t.on ? '끄기' : '켜기';
    byId<HTMLButtonElement>('sc-power').disabled = !t.port;
    const press = (root: HTMLElement, pred: (b: HTMLButtonElement) => boolean) => { for (const b of root.querySelectorAll<HTMLButtonElement>('button[data-v]')) b.setAttribute('aria-pressed', String(pred(b))); };
    press(byId('sc-mode'), (b) => b.dataset.v === t.mode);
    press(byId('sc-curmode'), (b) => b.dataset.v === this.curMode);
    press(byId('sc-trigch'), (b) => Number(b.dataset.v) === t.trigCh);
    press(byId('sc-trigslope'), (b) => (b.dataset.v === 'rise') === t.trigRise);
    byId('sc-hold').setAttribute('aria-pressed', String(t.hold));
    byId<HTMLInputElement>('sc-show1').checked = t.show1;
    byId<HTMLInputElement>('sc-show2').checked = t.show2;
    byId('sc-tdiv-val').textContent = `${fmtTime(t.tdiv)} / 칸`;
    byId('sc-v1-val').textContent = `${fmtVolt(t.vdiv1)} / 칸`;
    byId('sc-v2-val').textContent = `${fmtVolt(t.vdiv2)} / 칸`;
    byId('sc-p1-val').textContent = `${t.pos1 > 0 ? '+' : ''}${t.pos1} 칸`;
    byId('sc-p2-val').textContent = `${t.pos2 > 0 ? '+' : ''}${t.pos2} 칸`;
    const tl = byId<HTMLInputElement>('sc-tl');
    if (document.activeElement !== tl) tl.value = String(t.trigLevel);
    byId('sc-tl-val').textContent = `${t.trigLevel.toFixed(2)} V`;
    // 판독
    const rows: [string, string][] = [];
    const ch = (name: string, m: typeof s.m1, on: boolean) => {
      if (!on || !s.has) return;
      rows.push([`${name} 최대−최소`, fmtVolt(m.vpp)], [`${name} 실효값 · 평균`, `${fmtVolt(m.rms)} · ${fmtVolt(m.mean)}`], [`${name} 주파수 · 주기`, m.freq ? `${fmtFreq(m.freq)} · ${fmtTime(m.period!)}` : '—']);
    };
    ch('CH1', s.m1, t.show1);
    ch('CH2', s.m2, t.show2);
    if (s.has && s.phase !== null) rows.push(['위상 (CH2가 CH1보다 늦음)', `${s.phase.toFixed(1)}°`]);
    if (this.cur.x[0] !== null && this.cur.x[1] !== null) {
      const dt = Math.abs(this.cur.x[1] - this.cur.x[0]) * 10 * t.tdiv;
      rows.push(['커서 Δt · 1/Δt', `${fmtTime(dt)} · ${dt > 0 ? fmtFreq(1 / dt) : '—'}`]);
    }
    if (this.cur.y[0] !== null && this.cur.y[1] !== null) {
      const vd = t.show1 || !t.show2 ? t.vdiv1 : t.vdiv2;
      rows.push([`커서 ΔV (${t.show1 || !t.show2 ? 'CH1' : 'CH2'} 눈금)`, fmtVolt(Math.abs(this.cur.y[1] - this.cur.y[0]) * 8 * vd)]);
    }
    byId('sc-read').innerHTML = rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
    // 발생기
    const g = this.gen;
    byId('fg-box').hidden = !g;
    byId('fg-status').textContent = !g ? '함수 발생기가 없습니다' : !g.port ? '콘센트에 꽂혀 있지 않습니다 — 발생기를 두 번 탭해 "전원 연결"' : s.gens.includes(g) ? (g.on ? '켜져 있음 · 회로에 연결됨' : '꺼져 있음') : `${g.on ? '켜져 있음' : '꺼져 있음'} · 이 오실로스코프의 회로에 연결되지 않음`;
    if (!g) return;
    byId('fg-power').textContent = !g.port ? '콘센트에 꽂혀 있지 않음' : g.on ? '끄기' : '켜기';
    byId<HTMLButtonElement>('fg-power').disabled = !g.port;
    for (const b of byId('fg-wave').querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-pressed', String(b.dataset.v === g.wave));
    const fs = byId<HTMLInputElement>('fg-f');
    if (document.activeElement !== fs) fs.value = String(sliderOf(g.freq));
    byId('fg-f-val').textContent = fmtFreq(g.freq);
    const num = byId<HTMLInputElement>('fg-f-num');
    if (document.activeElement !== num) num.value = String(g.freq);
    const as = byId<HTMLInputElement>('fg-a');
    if (document.activeElement !== as) as.value = String(g.amp);
    byId('fg-a-val').textContent = `${g.amp.toFixed(2)} V (최대−최소 ${(2 * g.amp).toFixed(2)} V)`;
    const os = byId<HTMLInputElement>('fg-o');
    if (document.activeElement !== os) os.value = String(g.offset);
    byId('fg-o-val').textContent = `${g.offset.toFixed(2)} V`;
  }
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
