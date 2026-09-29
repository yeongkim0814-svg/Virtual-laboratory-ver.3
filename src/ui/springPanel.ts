/**
 * 용수철 진자 패널: 당긴 거리 · 놓기 · 측정 주기 vs 이론 · y(t) 그래프 · 기록 → T²–m 그래프로 k와 m_s 구하기
 *
 * T² = (4π²/k)·m + (4π²/k)·(m_s/3)
 *   → 기울기 a = 4π²/k  →  k = 4π²/a
 *   → 절편 b = a·(m_s/3)  →  m_s = 3b/a   (그래프가 원점을 지나지 않는 이유 = 용수철 자신의 질량)
 */
import type { Spring } from '../equipment/spring';
import { G } from '../sim/pendulum';
import { linearFit } from '../sim/photoelectric';
import { downloadCsv, drawPlot, stamp, type Series } from './plotKit';

const LOG_KEY = 'vlab-spring-log-v1';
const COLORS: Record<number, string> = { 10: '#ffd27a', 25: '#7fd7ff' };

interface Row {
  k: number;
  ms: number;
  m: number;
  A: number;
  T: number;
  Ti: number;
  Tc: number;
}

export class SpringPanel {
  readonly el = byId('spring-panel');
  speed = 1;
  target: Spring | null = null;
  private log: Row[] = loadLog();
  private lastText = 0;
  private aInput = byId<HTMLInputElement>('sg-a');
  private dragInput = byId<HTMLInputElement>('sg-drag');

  constructor(private onToggle: (open: boolean) => void) {
    const changed = () => {
      const t = this.target;
      if (!t) return;
      t.sim.amplitude = Number(this.aInput.value);
      t.sim.airDrag = this.dragInput.checked;
      t.resetSim();
      this.refreshControls();
    };
    this.aInput.addEventListener('input', changed);
    this.dragInput.addEventListener('change', changed);
    for (const b of byId('sg-speed').querySelectorAll<HTMLButtonElement>('button')) {
      b.addEventListener('click', () => { this.speed = Number(b.dataset.v); this.refreshControls(); });
    }
    byId('sg-release').addEventListener('click', () => {
      const t = this.target;
      if (t?.isOscillator && !t.touchesTable) t.sim.release();
    });
    byId('sg-reset').addEventListener('click', () => this.target?.sim.reset());
    byId('sg-close').addEventListener('click', () => this.close());
    byId('sg-record').addEventListener('click', () => this.record());
    byId('sg-clear').addEventListener('click', () => { this.log = []; saveLog(this.log); this.renderLog(); });
    byId('sg-csv').addEventListener('click', () => downloadCsv(`spring-${stamp()}.csv`,
      ['k (N/m)', 'm_s (kg)', 'm (kg)', 'A (m)', 'T measured (s)', 'T^2 (s^2)', 'T ideal (s)', 'T corrected (s)'],
      this.log.map((r) => [r.k, r.ms, r.m, r.A, r.T.toFixed(5), (r.T * r.T).toFixed(5), r.Ti.toFixed(5), r.Tc.toFixed(5)])));
    this.renderLog();
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(target: Spring): void {
    this.target = target;
    this.aInput.value = String(target.sim.amplitude);
    this.dragInput.checked = target.sim.airDrag;
    this.refreshControls();
    this.el.hidden = false;
    this.onToggle(true);
    this.drawPlot(); // 숨겨져 있을 때는 캔버스 크기가 0이라 열 때 다시 그린다
  }

  close(): void {
    this.el.hidden = true;
    this.target = null;
    this.onToggle(false);
  }

  private refreshControls(): void {
    const t = this.target;
    if (!t) return;
    byId('sg-a-val').textContent = `${(t.sim.amplitude * 100).toFixed(1)} cm`;
    for (const b of byId('sg-speed').querySelectorAll<HTMLButtonElement>('button')) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.v) === this.speed));
    }
  }

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
    const sp = this.target!;
    const sim = sp.sim;
    const bob = sp.bob;
    const warn: string[] = [];
    let status: string;
    if (!sp.isHung) status = '용수철이 클램프에서 빠졌습니다';
    else if (!bob) status = '추가 없습니다 — 추를 들고 용수철 아래 고리를 탭하세요';
    else if (!sp.isOscillator) status = '용수철을 들고 있습니다 — 내려놓으세요';
    else status = `추: ${bob.name} (${(bob.mass * 1000).toFixed(0)} g)`;
    if (sp.touchesTable) warn.push('추가 책상에 닿습니다 — 클램프를 올리세요');
    if (sim.overLimit) warn.push(`탄성 한계(${(sim.spec.limit * 100).toFixed(0)} cm) 초과 — 실제라면 후크 법칙이 깨지고 용수철이 늘어난 채로 남습니다`);
    if (bob && sim.slackRisk) warn.push('A > x_eq: 위쪽 끝에서 용수철이 자연 길이보다 짧아져야 함 — 실제 밀착 코일은 더 줄지 않아 선형 모형이 깨집니다');
    byId('sg-status').textContent = [status, ...warn].join('\n');
    byId<HTMLButtonElement>('sg-release').disabled = !sp.isOscillator || sp.touchesTable;

    const s = sim.spec;
    byId('sg-spec').textContent = `k ${s.k} N/m · L0 ${(s.L0 * 100).toFixed(0)} cm · m_s ${(s.ms * 1000).toFixed(0)} g`;
    const xeq = sim.staticExtension();
    byId('sg-xeq').textContent = bob
      ? `${(xeq * 100).toFixed(2)} cm  (m_s 무시 mg/k = ${((sim.mass * G) / s.k * 100).toFixed(2)} cm)`
      : `${(xeq * 100).toFixed(2)} cm (자기 무게만)`;
    const T = sim.measuredPeriod();
    const Ti = sim.idealPeriod();
    const Tc = sim.correctedPeriod();
    byId('sg-t').textContent = sim.running || sim.time > 0 ? `${sim.time.toFixed(2)} s` : '— (놓기를 누르세요)';
    byId('sg-T').textContent = T ? `${T.toFixed(4)} s  (${sim.periods.length}회 평균)` : bob ? '측정 중…' : '—';
    byId('sg-Ti').textContent = bob ? `${Ti.toFixed(4)} s` : '—';
    byId('sg-Tc').textContent = bob ? `${Tc.toFixed(4)} s` : '—';
    byId('sg-ratio').textContent = T && bob ? `${(T / Ti).toFixed(4)}  (${fmtPct((T - Ti) / Ti)})` : '—';
    byId('sg-E').textContent = sim.running || sim.time > 0 ? fmtPct(sim.energyDrift(), 3) : '—';
    byId<HTMLButtonElement>('sg-record').disabled = !T;
  }

  private record(): void {
    const sim = this.target?.sim;
    const T = sim?.measuredPeriod();
    if (!sim || !T || !sim.bob) return;
    this.log.unshift({
      k: sim.spec.k, ms: sim.spec.ms, m: sim.mass, A: sim.amplitude, T, Ti: sim.idealPeriod(), Tc: sim.correctedPeriod(),
    });
    this.log = this.log.slice(0, 40);
    saveLog(this.log);
    this.renderLog();
  }

  private renderLog(): void {
    const body = byId('sg-log').querySelector('tbody')!;
    body.innerHTML = '';
    if (!this.log.length) {
      body.innerHTML = '<tr><td colspan="6" class="empty">추를 바꿔 가며 주기를 기록하세요.</td></tr>';
    }
    for (const r of this.log) {
      const tr = document.createElement('tr');
      for (const c of [`${r.k}`, (r.m * 1000).toFixed(0), (r.A * 100).toFixed(1), r.T.toFixed(4), (r.T * r.T).toFixed(4), fmtPct((r.T - r.Ti) / r.Ti)]) {
        const td = document.createElement('td');
        td.textContent = c;
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    this.drawPlot();
  }

  /** T²–m: 용수철(k)별로 점과 맞춤 직선. 기울기 → k, 절편 → m_s */
  private drawPlot(): void {
    const series: Series[] = [];
    const lines: string[] = [];
    let yMax = 0.2;
    let xMax = 0.25;
    for (const r of this.log) {
      yMax = Math.max(yMax, r.T * r.T * 1.15);
      xMax = Math.max(xMax, r.m * 1.1);
    }
    for (const k of [...new Set(this.log.map((r) => r.k))]) {
      const rows = this.log.filter((r) => r.k === k);
      const color = COLORS[k] ?? '#fff';
      series.push({ color, points: rows.map((r) => [r.m, r.T * r.T]) });
      const fit = linearFit(rows.map((r) => r.m), rows.map((r) => r.T * r.T));
      if (fit && new Set(rows.map((r) => r.m)).size >= 2) {
        series.push({ color, line: true, points: [[0, fit.b], [xMax, fit.a * xMax + fit.b]] });
        const kFit = (4 * Math.PI ** 2) / fit.a;
        const msFit = (3 * fit.b) / fit.a;
        lines.push(`k ${k} N/m 용수철: 기울기 4π²/k → k = ${kFit.toFixed(2)} N/m (${fmtPct((kFit - k) / k)}), `
          + `절편 → m_s = 3·절편/기울기 = ${(msFit * 1000).toFixed(1)} g (실제 ${(rows[0].ms * 1000).toFixed(0)} g)`);
      }
    }
    drawPlot(byId<HTMLCanvasElement>('sg-plot'), { x: [0, xMax], y: [0, yMax], grid: [0.05, 0.1], series });
    byId('sg-fit').textContent = lines.join('\n') || '서로 다른 질량으로 2번 이상 기록하면 맞춤 직선이 그려집니다.';
  }

  /** y(t): 실선 = 시뮬레이션, 점선 = 이상적 A·cos(2πt/T_ideal) */
  private drawGraph(): void {
    const sim = this.target!.sim;
    const WINDOW = 4;
    const t1 = Math.max(WINDOW, sim.time);
    const t0 = t1 - WINDOW;
    const amp = Math.max(sim.amplitude * 1.2, 0.002);
    const pts = sim.trace.filter(([t]) => t >= t0) as [number, number][];
    const ideal: [number, number][] = [];
    const Ti = sim.idealPeriod();
    if (Ti > 0) for (let t = Math.max(0, t0); t <= sim.time; t += 0.03) ideal.push([t, sim.amplitude * Math.cos((2 * Math.PI * t) / Ti)]);
    const amber = getComputedStyle(this.el).getPropertyValue('--amber').trim() || '#ff9a2e';
    drawPlot(byId<HTMLCanvasElement>('sg-graph'), {
      x: [t0, t1], y: [-amp, amp], grid: [1, 1e9],
      series: [{ color: amber, line: true, points: pts }, { color: 'rgba(255,240,215,0.9)', points: ideal, size: 1 }],
    });
  }
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function fmtPct(x: number, digits = 1): string {
  const p = x * 100;
  return `${p > 0 ? '+' : ''}${p.toFixed(digits)} %`;
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
