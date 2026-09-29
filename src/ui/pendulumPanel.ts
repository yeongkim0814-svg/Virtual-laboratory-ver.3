/**
 * 단진자 실험 패널: 조건 조절 · 실시간 측정값 · θ(t) 그래프 · 측정 기록 표
 */
import type { PendulumStation } from '../experiments/pendulumStation';
import { exactPeriod, smallAnglePeriod } from '../sim/pendulum';
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
  private log: LogRow[] = loadLog();
  private graph = byId<HTMLCanvasElement>('pp-graph');
  private lastText = 0;

  constructor(private station: PendulumStation, private onToggle: (open: boolean) => void) {
    const sim = station.sim;
    const L = byId<HTMLInputElement>('pp-L');
    const th = byId<HTMLInputElement>('pp-th');
    const drag = byId<HTMLInputElement>('pp-drag');

    // 조건을 바꾸면 추를 처음 각도로 되돌린다 (진행 중인 측정은 무효)
    const conditionChanged = () => {
      sim.length = Number(L.value);
      sim.theta0 = Number(th.value) * DEG;
      sim.airDrag = drag.checked;
      sim.reset();
      station.layout();
      this.refreshControls();
    };
    L.addEventListener('input', conditionChanged);
    th.addEventListener('input', conditionChanged);
    drag.addEventListener('change', conditionChanged);

    segmented('pp-method', (v) => { sim.method = v as Method; conditionChanged(); });
    segmented('pp-dt', (v) => { sim.dt = Number(v); conditionChanged(); });
    segmented('pp-speed', (v) => { this.speed = Number(v); this.refreshControls(); });

    byId('pp-release').addEventListener('click', () => { if (station.bob) sim.release(); });
    byId('pp-reset').addEventListener('click', () => { sim.reset(); });
    byId('pp-close').addEventListener('click', () => this.close());
    byId('pp-record').addEventListener('click', () => this.record());
    byId('pp-clear').addEventListener('click', () => { this.log = []; saveLog(this.log); this.renderLog(); });

    L.value = String(sim.length);
    th.value = String(Math.round(sim.theta0 / DEG));
    drag.checked = sim.airDrag;
    this.refreshControls();
    this.renderLog();
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(): void {
    this.el.hidden = false;
    this.onToggle(true);
  }

  close(): void {
    this.el.hidden = true;
    this.onToggle(false);
  }

  private refreshControls(): void {
    const sim = this.station.sim;
    byId('pp-L-val').textContent = `${sim.length.toFixed(2)} m`;
    byId('pp-th-val').textContent = `${Math.round(sim.theta0 / DEG)}°`;
    pressed('pp-method', sim.method);
    pressed('pp-dt', String(sim.dt));
    pressed('pp-speed', String(this.speed));
  }

  /** 매 프레임 호출 (열려 있을 때만) */
  update(): void {
    if (!this.isOpen) return;
    const now = performance.now();
    if (now - this.lastText > 100) {
      this.lastText = now;
      this.updateText();
    }
    this.drawGraph();
  }

  private updateText(): void {
    const st = this.station;
    const sim = st.sim;
    byId('pp-bob').textContent = st.bob
      ? `추: ${st.bob.name} (${(st.bob.mass * 1000).toFixed(0)} g)`
      : '추가 없습니다 — 테이블 위의 추를 들고 스탠드를 탭하세요';
    byId<HTMLButtonElement>('pp-release').disabled = !st.bob;

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
    const sim = this.station.sim;
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
      return;
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
    const sim = this.station.sim;
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
