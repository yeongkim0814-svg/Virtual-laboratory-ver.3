/**
 * 간섭무늬 관찰 패널 (영의 이중 슬릿 실험)
 *
 * 스크린에 비친 무늬를 확대해서 보여 주고, 직접 재서 빛의 파장을 구한다.
 *   1. 확대 화면을 탭해 커서 A, B를 밝은 무늬에 놓는다 ("무늬에 맞춤"을 켜면 가장 가까운 밝은 무늬로 붙음)
 *   2. A와 B 사이의 무늬 간격 수 n을 정한다 → Δy = |B − A| / n
 *   3. λ = d·Δy / L 로 파장을 계산해 레이저의 실제 파장과 비교
 * 여러 칸을 한 번에 재면(n을 크게) 한 칸의 눈금 오차가 n으로 나뉘어 작아진다.
 */
import type { OpticScreen, ScreenLight } from '../equipment/optics';
import { fringeSpacing, intensityAt } from '../sim/optics';

const LOG_KEY = 'vlab-slit-log-v1';

interface Row {
  nm: number;
  kind: string;
  d: number; // mm
  L: number; // m
  n: number;
  dy: number; // mm (측정)
  est: number; // nm (추정)
}

export class SlitPanel {
  readonly el = byId('slit-panel');
  target: OpticScreen | null = null;
  private view = byId<HTMLCanvasElement>('sp-view');
  private graph = byId<HTMLCanvasElement>('sp-graph');
  private range = 25;
  private cursors: (number | null)[] = [null, null]; // mm
  private nextCursor = 0;
  private n = 4;
  private snap = true;
  private log: Row[] = loadLog();
  private lastKey = '';
  private lastText = 0;

  constructor(private onToggle: (open: boolean) => void) {
    byId('sp-close').addEventListener('click', () => this.close());
    for (const b of byId('sp-range').querySelectorAll<HTMLButtonElement>('button')) {
      b.addEventListener('click', () => { this.range = Number(b.dataset.v); this.redraw(); });
    }
    byId('sp-n-minus').addEventListener('click', () => { this.n = Math.max(1, this.n - 1); this.redraw(); });
    byId('sp-n-plus').addEventListener('click', () => { this.n = Math.min(20, this.n + 1); this.redraw(); });
    byId<HTMLInputElement>('sp-snap').addEventListener('change', (e) => { this.snap = (e.target as HTMLInputElement).checked; });
    byId('sp-clear-cursors').addEventListener('click', () => { this.cursors = [null, null]; this.nextCursor = 0; this.redraw(); });
    byId('sp-record').addEventListener('click', () => this.record());
    byId('sp-clear').addEventListener('click', () => { this.log = []; saveLog(this.log); this.renderLog(); });
    // 확대 화면 탭 → 커서 놓기 (A, B 번갈아)
    this.view.addEventListener('pointerdown', (e) => {
      const light = this.target?.light;
      if (!light?.ap) return;
      const r = this.view.getBoundingClientRect();
      let y = ((e.clientX - r.left) / r.width - 0.5) * 2 * this.range; // mm
      if (this.snap) y = this.snapToPeak(light, y);
      this.cursors[this.nextCursor] = y;
      this.nextCursor = 1 - this.nextCursor;
      this.redraw();
    });
    this.renderLog();
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(target: OpticScreen): void {
    if (this.target !== target) this.cursors = [null, null];
    this.target = target;
    this.el.hidden = false;
    this.onToggle(true);
    this.redraw();
  }

  close(): void {
    this.el.hidden = true;
    this.target = null;
    this.onToggle(false);
  }

  /** 매 프레임: 조건(파장·슬릿·거리)이 바뀌었을 때만 다시 그린다 */
  update(): void {
    if (!this.isOpen || !this.target) return;
    const l = this.target.light;
    const key = l ? `${l.lambda}|${l.ap?.d}|${l.ap?.a}|${l.L.toFixed(3)}` : '';
    const now = performance.now();
    if (key !== this.lastKey || now - this.lastText > 500) {
      if (key !== this.lastKey) this.cursors = [null, null];
      this.lastKey = key;
      this.lastText = now;
      this.redraw();
    }
  }

  /** 가장 가까운 밝은 무늬(세기의 극대)로 옮긴다 — 0.01 mm 간격으로 ±간격 절반 안을 찾음 */
  private snapToPeak(l: ScreenLight, y: number): number {
    const ap = l.ap!;
    const half = (fringeSpacing(l.lambda, l.L, ap.kind === 'double' ? ap.d : ap.a) * 1000) / 2;
    let best = y;
    let bestI = -1;
    for (let t = y - half; t <= y + half; t += 0.01) {
      const I = intensityAt(ap, l.lambda, t / 1000, l.L);
      if (I > bestI) { bestI = I; best = t; }
    }
    return Math.round(best * 100) / 100;
  }

  private redraw(): void {
    const t = this.target;
    const l = t?.light ?? null;
    for (const b of byId('sp-range').querySelectorAll<HTMLButtonElement>('button')) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.v) === this.range));
    }
    byId('sp-n').textContent = String(this.n);
    this.drawView(l);
    this.drawGraph(l);

    const set = (id: string, text: string) => { byId(id).textContent = text; };
    if (!l?.ap) {
      set('sp-status', '레이저 빛이 슬릿을 지나 이 스크린에 닿아야 무늬가 생깁니다');
      for (const id of ['sp-lambda', 'sp-slit', 'sp-L', 'sp-theory', 'sp-dist', 'sp-dy', 'sp-est']) set(id, '—');
      byId<HTMLButtonElement>('sp-record').disabled = true;
      return;
    }
    const ap = l.ap;
    set('sp-status', ap.kind === 'double' ? '이중 슬릿 간섭무늬' : '단일 슬릿 회절무늬');
    set('sp-lambda', `${(l.lambda * 1e9).toFixed(0)} nm (레이저 표시값)`);
    set('sp-slit', ap.kind === 'double' ? `d = ${(ap.d * 1e3).toFixed(2)} mm, a = ${(ap.a * 1e3).toFixed(2)} mm` : `a = ${(ap.a * 1e3).toFixed(2)} mm`);
    set('sp-L', `${(l.L * 100).toFixed(1)} cm`);
    const spacing = ap.kind === 'double' ? fringeSpacing(l.lambda, l.L, ap.d) : fringeSpacing(l.lambda, l.L, ap.a);
    set('sp-theory', ap.kind === 'double'
      ? `λL/d = ${(spacing * 1000).toFixed(3)} mm`
      : `λL/a = ${(spacing * 1000).toFixed(3)} mm (중앙 무늬 폭은 2배)`);
    const [A, B] = this.cursors;
    if (A !== null && B !== null) {
      const dist = Math.abs(B - A);
      const dy = dist / this.n;
      const slitSize = ap.kind === 'double' ? ap.d : ap.a;
      const est = (slitSize * (dy / 1000)) / l.L; // λ = d·Δy / L
      set('sp-dist', `${dist.toFixed(2)} mm`);
      set('sp-dy', `${dy.toFixed(3)} mm`);
      set('sp-est', `${(est * 1e9).toFixed(1)} nm  (${fmtPct((est - l.lambda) / l.lambda)})`);
      byId<HTMLButtonElement>('sp-record').disabled = false;
    } else {
      set('sp-dist', A === null ? '확대 화면을 탭해 A를 놓으세요' : 'B를 놓으세요');
      set('sp-dy', '—');
      set('sp-est', '—');
      byId<HTMLButtonElement>('sp-record').disabled = true;
    }
  }

  /** 확대 화면: 스크린 가운데 ±range mm, 무늬 + mm 눈금 + 커서 */
  private drawView(l: ScreenLight | null): void {
    const c = this.view;
    const w = Math.max(1, Math.round(c.clientWidth / 2));
    const h = Math.max(1, Math.round(c.clientHeight / 2));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext('2d')!;
    g.fillStyle = '#0c0b08';
    g.fillRect(0, 0, w, h);
    const R = this.range;
    const X = (mm: number) => ((mm / R + 1) / 2) * w;
    if (l?.ap) {
      const img = g.createImageData(w, h);
      const cy = h * 0.42;
      const sig = h * 0.12;
      for (let i = 0; i < w; i++) {
        const y = ((i + 0.5) / w - 0.5) * 2 * R;
        const I = Math.min(1, intensityAt(l.ap, l.lambda, y / 1000, l.L) * 1.3);
        for (let j = 0; j < h * 0.84; j++) {
          const e = I * Math.exp(-((j - cy) ** 2) / (2 * sig * sig));
          const k = (j * w + i) * 4;
          img.data[k] = 12 + 243 * Math.min(1, l.color.r * e + 0.2 * e * e);
          img.data[k + 1] = 11 + 244 * Math.min(1, l.color.g * e + 0.2 * e * e);
          img.data[k + 2] = 8 + 247 * Math.min(1, l.color.b * e + 0.2 * e * e);
          img.data[k + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
    }
    // 자: 1 mm 짧은 눈금, 5 mm 중간, 10 mm 긴 눈금 + 숫자
    const minor = R <= 10 ? 1 : R <= 25 ? 1 : 2;
    g.fillStyle = 'rgba(255,200,120,0.8)';
    g.font = '6px monospace';
    for (let mm = -R; mm <= R; mm += minor) {
      const x = Math.round(X(mm));
      const len = mm % 10 === 0 ? 6 : mm % 5 === 0 ? 4 : 2;
      g.fillRect(x, h - len, 1, len);
      if (mm % 10 === 0) g.fillText(String(mm), x + 1, h - 7);
    }
    // 커서
    this.cursors.forEach((mm, i) => {
      if (mm === null) return;
      g.fillStyle = i === 0 ? '#7fd7ff' : '#ffe27a';
      g.fillRect(Math.round(X(mm)), 0, 1, h - 8);
      g.fillText(i === 0 ? 'A' : 'B', Math.round(X(mm)) + 2, 8);
    });
  }

  /** 세기 그래프 I(y) */
  private drawGraph(l: ScreenLight | null): void {
    const c = this.graph;
    const w = Math.max(1, Math.round(c.clientWidth / 2));
    const h = Math.max(1, Math.round(c.clientHeight / 2));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,154,46,0.22)';
    g.fillRect(0, h - 1, w, 1);
    g.fillRect(Math.round(w / 2), 0, 1, h);
    if (!l?.ap) return;
    g.strokeStyle = '#ff9a2e';
    g.beginPath();
    for (let i = 0; i < w; i++) {
      const y = ((i + 0.5) / w - 0.5) * 2 * this.range;
      const I = intensityAt(l.ap, l.lambda, y / 1000, l.L);
      const py = h - 1 - I * (h - 3);
      if (i) g.lineTo(i + 0.5, py);
      else g.moveTo(i + 0.5, py);
    }
    g.stroke();
  }

  private record(): void {
    const l = this.target?.light;
    const [A, B] = this.cursors;
    if (!l?.ap || A === null || B === null) return;
    const dy = Math.abs(B - A) / this.n;
    const size = l.ap.kind === 'double' ? l.ap.d : l.ap.a;
    this.log.unshift({
      nm: Math.round(l.lambda * 1e9), kind: l.ap.kind === 'double' ? '이중' : '단일', d: size * 1000, L: l.L, n: this.n, dy,
      est: ((size * (dy / 1000)) / l.L) * 1e9,
    });
    this.log = this.log.slice(0, 30);
    saveLog(this.log);
    this.renderLog();
  }

  private renderLog(): void {
    const body = byId('sp-log').querySelector('tbody')!;
    body.innerHTML = '';
    if (!this.log.length) {
      body.innerHTML = '<tr><td colspan="7" class="empty">커서 A, B를 놓고 "기록"을 누르면 여기에 쌓입니다.</td></tr>';
      return;
    }
    for (const r of this.log) {
      const tr = document.createElement('tr');
      for (const c of [`${r.nm}`, `${r.kind} ${r.d.toFixed(2)}`, (r.L * 100).toFixed(1), String(r.n), r.dy.toFixed(3), r.est.toFixed(1), fmtPct((r.est - r.nm) / r.nm)]) {
        const td = document.createElement('td');
        td.textContent = c;
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
  }
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function fmtPct(x: number): string {
  const p = x * 100;
  return `${p > 0 ? '+' : ''}${p.toFixed(Math.abs(p) < 1 ? 2 : 1)} %`;
}

function loadLog(): Row[] {
  try {
    const v = JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function saveLog(log: Row[]): void {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  } catch {
    /* 저장 불가 환경 */
  }
}
