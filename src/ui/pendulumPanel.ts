/**
 * 단진자 실험 패널: 조건 조절 · 실시간 측정값 · θ(t) 그래프 · 측정 기록 표
 * 직접 조립한 진자(클램프 → 실 → 추)의 추나 실을 탭하고 "진자 실험"을 고르면 그 진자에 연결된다.
 */
import { bus } from '../net/commands';
import type { PendulumString } from '../equipment/pendulumString';
import { G, exactPeriod, smallAnglePeriod } from '../sim/pendulum';
import { linearFit } from '../sim/photoelectric';
import { downloadCsv, drawPlot, stamp, type Series } from './plotKit';
import type { Method } from '../sim/integrators';

const DEG = Math.PI / 180;
const LOG_KEY = 'vlab-pendulum-log-v1';
const METHOD_NAME: Record<Method, string> = { rk4: 'RK4', semi: '반암시적', euler: '오일러' };

interface LogRow {
  L: number;
  th0: number; // °
  mass: number; // kg
  method: Method;
  dt: number;
  drag: boolean;
  T: number;
  T0: number;
  Te: number;
}

export class PendulumPanel {
  readonly el = byId('pend-panel');
  speed = 1;
  /** 지금 패널이 다루는 진자 (실) */
  target: PendulumString | null = null;
  private log: LogRow[] = loadLog();
  private graph = byId<HTMLCanvasElement>('pp-graph');
  private lastText = 0;
  private lenInput = byId<HTMLInputElement>('pp-l');
  private thInput = byId<HTMLInputElement>('pp-th');
  private dragInput = byId<HTMLInputElement>('pp-drag');
  private plotMode: 'L' | 'th' = 'L';

  constructor(private onToggle: (open: boolean) => void) {
    // 조건을 바꾸면 추를 처음 각도로 되돌린다 (진행 중인 측정은 무효)
    const conditionChanged = () => {
      const t = this.target;
      if (!t) return;
      bus.set(t, 'length', Number(this.lenInput.value));
      bus.set(t, 'sim.theta0', Number(this.thInput.value) * DEG);
      bus.set(t, 'sim.airDrag', this.dragInput.checked);
      bus.call(t, 'resetSim');
      this.refreshControls();
    };
    this.lenInput.addEventListener('input', conditionChanged);
    this.thInput.addEventListener('input', conditionChanged);
    this.dragInput.addEventListener('change', conditionChanged);

    segmented('pp-method', (v) => { if (this.target) bus.set(this.target, 'sim.method', v as Method); conditionChanged(); });
    segmented('pp-dt', (v) => { if (this.target) bus.set(this.target, 'sim.dt', Number(v)); conditionChanged(); });
    segmented('pp-speed', (v) => { this.speed = Number(v); this.refreshControls(); });

    byId('pp-release').addEventListener('click', () => { if (this.target?.isPendulum) bus.call(this.target, 'releaseSim'); });
    byId('pp-reset').addEventListener('click', () => { if (this.target) bus.call(this.target, 'resetSimClock'); });
    byId('pp-close').addEventListener('click', () => this.close());
    byId('pp-record').addEventListener('click', () => this.record());
    byId('pp-clear').addEventListener('click', () => { this.log = []; saveLog(this.log); this.renderLog(); });
    byId('pp-csv').addEventListener('click', () => downloadCsv(`pendulum-${stamp()}.csv`,
      ['L (m)', 'theta0 (deg)', 'm (kg)', 'method', 'dt (s)', 'air drag', 'T measured (s)', 'T0 small angle (s)', 'T exact (s)'],
      this.log.map((r) => [r.L.toFixed(4), r.th0, r.mass, ({ rk4: 'RK4', semi: 'semi-implicit Euler', euler: 'Euler' } as Record<string, string>)[r.method], r.dt, r.drag ? 'yes' : 'no', r.T.toFixed(5), r.T0.toFixed(5), r.Te.toFixed(5)])));
    segmented('pp-plotmode', (v) => { this.plotMode = v as 'L' | 'th'; pressed('pp-plotmode', v); this.drawLogPlot(); });
    pressed('pp-plotmode', this.plotMode);
    this.renderLog();
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(target: PendulumString): void {
    this.target = target;
    const sim = target.sim;
    this.lenInput.value = String(target.length);
    this.thInput.value = String(Math.round(sim.theta0 / DEG));
    this.dragInput.checked = sim.airDrag;
    this.refreshControls();
    this.el.hidden = false;
    this.onToggle(true);
    this.drawLogPlot(); // 숨겨져 있을 때는 캔버스 크기가 0이라 열 때 다시 그린다
  }

  close(): void {
    this.el.hidden = true;
    this.target = null;
    this.onToggle(false);
  }

  private refreshControls(): void {
    const t = this.target;
    if (!t) return;
    const sim = t.sim;
    byId('pp-l-val').textContent = `${t.length.toFixed(2)} m`;
    byId('pp-th-val').textContent = `${Math.round(sim.theta0 / DEG)}°`;
    pressed('pp-method', sim.method);
    pressed('pp-dt', String(sim.dt));
    pressed('pp-speed', String(this.speed));
  }

  /** 매 프레임 호출 (열려 있을 때만) */
  update(): void {
    if (!this.isOpen || !this.target) return;
    const now = performance.now();
    if (now - this.lastText > 100) {
      this.lastText = now;
      this.updateText();
    }
    this.drawGraph();
  }

  private updateText(): void {
    const st = this.target!;
    const sim = st.sim;
    const bob = st.bob;
    let status: string;
    if (!st.isHung) status = '실이 클램프에서 빠졌습니다';
    else if (!bob) status = '추가 없습니다 — 추를 들고 실 끝을 탭하세요';
    else if (!st.isPendulum) status = '진자를 들고 있습니다 — 책상 위에 놓으세요';
    else status = `추: ${bob.name} (${(bob.mass * 1000).toFixed(0)} g)`;
    if (st.isPendulum && st.length > st.maxLength) {
      status += ` · 추가 닿아 실을 ${st.maxLength.toFixed(2)} m로 줄임 (클램프를 올리세요)`;
    }
    byId('pp-bob').textContent = status;
    byId<HTMLButtonElement>('pp-release').disabled = !st.isPendulum;
    const d = st.effectiveLength() - st.usedLength();
    byId('pp-Lr').textContent = `${st.effectiveLength().toFixed(3)} m  (ℓ ${st.usedLength().toFixed(2)} + ${(d * 100).toFixed(1)} cm)`;

    const T0 = smallAnglePeriod(sim.length);
    const Te = exactPeriod(sim.length, sim.theta0);
    const T = sim.measuredPeriod();
    byId('pp-t').textContent = sim.running || sim.time > 0 ? `${sim.time.toFixed(2)} s` : '— (놓기를 누르세요)';
    byId('pp-T').textContent = T ? `${T.toFixed(4)} s  (${sim.periods.length}회 평균)` : '측정 중…';
    byId('pp-T0').textContent = `${T0.toFixed(4)} s`;
    byId('pp-Te').textContent = sim.airDrag ? `${Te.toFixed(4)} s (공기 저항 없을 때)` : `${Te.toFixed(4)} s`;
    byId('pp-ratio').textContent = T ? `${(T / T0).toFixed(4)}  (${fmtPct((T - T0) / T0)})` : '—';
    const dE = sim.energyDrift();
    byId('pp-E').textContent = sim.running || sim.time > 0 ? fmtPct(dE) : '—';
    byId<HTMLButtonElement>('pp-record').disabled = !T;
  }

  private record(): void {
    const sim = this.target?.sim;
    if (!sim) return;
    const T = sim.measuredPeriod();
    if (!T || !sim.bob) return;
    this.log.unshift({
      L: sim.length, th0: Math.round(sim.theta0 / DEG), mass: sim.bob.mass, method: sim.method, dt: sim.dt,
      drag: sim.airDrag, T, T0: smallAnglePeriod(sim.length), Te: exactPeriod(sim.length, sim.theta0),
    });
    this.log = this.log.slice(0, 30);
    saveLog(this.log);
    this.renderLog();
  }

  private renderLog(): void {
    const body = byId('pp-log').querySelector('tbody')!;
    body.innerHTML = '';
    if (!this.log.length) {
      body.innerHTML = '<tr><td colspan="7" class="empty">아직 기록이 없습니다. 주기가 측정되면 "기록"을 누르세요.</td></tr>';
    }
    for (const r of this.log) {
      const tr = document.createElement('tr');
      const cells = [
        r.L.toFixed(2), `${r.th0}°`, `${(r.mass * 1000).toFixed(0)}`,
        `${METHOD_NAME[r.method]} ${r.dt * 1000}ms${r.drag ? ' +공기' : ''}`,
        r.T.toFixed(4), r.Te.toFixed(4), fmtPct((r.T - r.T0) / r.T0),
      ];
      for (const c of cells) {
        const td = document.createElement('td');
        td.textContent = c;
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    this.drawLogPlot();
  }

  /**
   * 기록 그래프
   *  T – √L : 작은 각이면 T = (2π/√g)·√L → 원점을 지나는 직선. 기울기 a에서 g = (2π/a)²
   *           (θ₀가 20° 이하인 기록만 맞춤 — 큰 각은 주기가 길어져 직선에서 벗어난다)
   *  T/T₀ – θ₀ : 진폭이 커지면 주기가 길어지는 정도. 곡선 = 타원 적분 이론 T(θ₀)/T₀
   */
  private drawLogPlot(): void {
    const c = byId<HTMLCanvasElement>('pp-plot');
    const series: Series[] = [];
    let fitText = '';
    if (this.plotMode === 'L') {
      const xMax = Math.max(1.05, ...this.log.map((r) => Math.sqrt(r.L) * 1.05));
      const small = this.log.filter((r) => r.th0 <= 20);
      const big = this.log.filter((r) => r.th0 > 20);
      series.push({ color: 'rgba(255,230,190,0.5)', line: true, points: [[0, 0], [xMax, (2 * Math.PI / Math.sqrt(G)) * xMax]] });
      series.push({ color: '#7fd7ff', points: big.map((r) => [Math.sqrt(r.L), r.T]) });
      series.push({ color: '#ffd27a', points: small.map((r) => [Math.sqrt(r.L), r.T]) });
      const fit = linearFit(small.map((r) => Math.sqrt(r.L)), small.map((r) => r.T));
      if (fit && new Set(small.map((r) => r.L.toFixed(3))).size >= 2) {
        series.push({ color: '#ffd27a', line: true, points: [[0, fit.b], [xMax, fit.a * xMax + fit.b]] });
        const g = (2 * Math.PI / fit.a) ** 2;
        fitText = `θ₀ ≤ 20° 기록 ${small.length}개 맞춤: 기울기 ${fit.a.toFixed(4)} s/√m, 절편 ${fit.b.toFixed(4)} s → g = (2π/기울기)² = ${g.toFixed(3)} m/s² (${fmtPct((g - G) / G)})`;
      } else fitText = 'θ₀ ≤ 20°로 L을 2가지 이상 바꿔 기록하면 g를 구합니다.';
      drawPlot(c, { x: [0, xMax], y: [0, (2 * Math.PI / Math.sqrt(G)) * xMax * 1.15], grid: [0.1, 0.5], series });
      byId('pp-plot-legend').textContent = '가로 √L (1칸 0.1 √m), 세로 T (1칸 0.5 s) · 노랑 = θ₀ ≤ 20°, 파랑 = 큰 각, 흐린 선 = 이론 2π√(L/g)';
    } else {
      const theory: [number, number][] = [];
      for (let d = 0; d <= 80; d += 2) theory.push([d, exactPeriod(1, d * DEG) / smallAnglePeriod(1)]);
      series.push({ color: 'rgba(255,230,190,0.6)', line: true, points: theory });
      series.push({ color: '#ffd27a', points: this.log.map((r) => [r.th0, r.T / r.T0]) });
      const yMax = Math.max(1.14, ...this.log.map((r) => r.T / r.T0 + 0.01));
      drawPlot(c, { x: [0, 80], y: [0.98, yMax], grid: [10, 0.02], series });
      byId('pp-plot-legend').textContent = '가로 θ₀ (1칸 10°), 세로 T/T₀ (1칸 0.02, 아래 끝 0.98) · 선 = 타원 적분 이론 (≈ 1 + θ₀²/16)';
      fitText = '같은 L에서 θ₀만 바꿔 기록하면 곡선을 따라갑니다. 20°에서 약 0.8 %, 60°에서 약 7 % 길어짐.';
    }
    byId('pp-fit').textContent = fitText;
  }

  /** θ(t) 그래프: 최근 8초. 실선 = 시뮬레이션, 점선 = 작은 각 근사 θ₀·cos(2πt/T₀) */
  private drawGraph(): void {
    const c = this.graph;
    const w = Math.max(1, Math.round(c.clientWidth / 2)); // 절반 해상도 → 도트 느낌
    const h = Math.max(1, Math.round(c.clientHeight / 2));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const g = c.getContext('2d')!;
    const sim = this.target!.sim;
    const css = getComputedStyle(this.el);
    const amber = css.getPropertyValue('--amber').trim() || '#ff9a2e';
    g.clearRect(0, 0, w, h);

    const WINDOW = 8;
    const t1 = Math.max(WINDOW, sim.time);
    const t0 = t1 - WINDOW;
    let amp = Math.abs(sim.theta0);
    for (const [, th] of sim.trace) amp = Math.max(amp, Math.abs(th));
    amp = Math.max(amp * 1.15, 1 * DEG);
    const X = (t: number) => ((t - t0) / WINDOW) * (w - 1);
    const Y = (th: number) => h / 2 - (th / amp) * (h / 2 - 1);

    // 눈금: 0선 + 1초마다 세로선
    g.fillStyle = 'rgba(255,154,46,0.22)';
    g.fillRect(0, Math.round(h / 2), w, 1);
    for (let s = Math.ceil(t0); s <= t1; s++) g.fillRect(Math.round(X(s)), 0, 1, h);

    // 작은 각 근사 (점선)
    const w0 = (2 * Math.PI) / smallAnglePeriod(sim.length);
    g.fillStyle = 'rgba(255,230,190,0.55)';
    for (let px = 0; px < w; px += 3) {
      const t = t0 + (px / (w - 1)) * WINDOW;
      if (t < 0 || t > sim.time) continue;
      g.fillRect(px, Math.round(Y(sim.theta0 * Math.cos(w0 * t))), 1, 1);
    }

    // 시뮬레이션 (실선)
    g.strokeStyle = amber;
    g.lineWidth = 1;
    g.beginPath();
    let started = false;
    for (const [t, th] of sim.trace) {
      if (t < t0) continue;
      const x = X(t) + 0.5;
      const y = Y(th) + 0.5;
      if (started) g.lineTo(x, y);
      else g.moveTo(x, y);
      started = true;
    }
    g.stroke();
  }
}

// ---------- 도우미 ----------
function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function segmented(id: string, onPick: (v: string) => void): void {
  for (const b of byId(id).querySelectorAll<HTMLButtonElement>('button')) {
    b.addEventListener('click', () => onPick(b.dataset.v!));
  }
}

function pressed(id: string, value: string): void {
  for (const b of byId(id).querySelectorAll<HTMLButtonElement>('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.v === value));
  }
}

function fmtPct(x: number): string {
  const p = x * 100;
  const s = Math.abs(p) < 0.001 ? '0.000' : p.toFixed(Math.abs(p) < 1 ? 3 : 2);
  return `${p > 0 ? '+' : ''}${s} %`;
}

function loadLog(): LogRow[] {
  try {
    const v = JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function saveLog(log: LogRow[]): void {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  } catch {
    /* 저장 불가 환경 */
  }
}
