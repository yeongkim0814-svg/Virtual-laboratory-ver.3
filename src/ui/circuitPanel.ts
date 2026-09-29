/**
 * 직류 회로 실험 패널
 *
 * 1. 전원 장치 전압을 바꾸며 전압계·전류계 값을 읽는다 (계기는 회로에 직접 연결해야 값이 나온다)
 *      전압계 = 재려는 부품과 병렬, 전류계 = 재려는 부품과 직렬
 * 2. "측정값 기록" 또는 "자동 측정(0 → 5 V)"으로 (V, I) 표를 만든다
 * 3. I–V 그래프에
 *      원점을 지나는 직선 I = V/R 맞춤 → 저항 R (옴의 법칙이면 점들이 이 직선 위)
 *      거듭제곱 I ∝ Vⁿ 맞춤 → n = 1이면 옴 소자, n < 1이면 전구처럼 전류가 커질수록 저항이 커지는 소자
 */
import { bus } from '../net/commands';
import type { DCPowerSupply } from '../equipment/electrical';
import { Ammeter, Led, Voltmeter, type DCCircuitState } from '../equipment/circuitParts';
import { downloadCsv, drawPlot, stamp, type Series } from './plotKit';

interface Row {
  V: number;
  I: number;
}

const SWEEP = Array.from({ length: 21 }, (_, i) => i * 0.25);
const SWEEP_WAIT = 600; // ms: 전구 필라멘트 온도가 자리 잡을 시간 (어두울 때 시간 상수 0.25 s의 2배 이상 — 뜨거울수록 훨씬 빠름)

export class CircuitPanel {
  readonly el = byId('dc-panel');
  target: DCPowerSupply | null = null;
  private state: DCCircuitState | null = null;
  private rows: Row[] = [];
  private lastText = 0;
  private sweep: { i: number; t: number } | null = null;

  constructor(private onToggle: (open: boolean) => void, private circuitOf: (s: DCPowerSupply) => DCCircuitState | null) {
    const slider = byId<HTMLInputElement>('dc-v');
    slider.addEventListener('input', () => this.setVoltage(Number(slider.value)));
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('button[data-dv]')) {
      b.addEventListener('click', () => this.target && this.setVoltage(this.target.voltage + Number(b.dataset.dv)));
    }
    byId('dc-power').addEventListener('click', () => {
      const t = this.target;
      if (t?.port) bus.set(t, 'on', !t.on);
      this.refresh(true);
    });
    byId('dc-close').addEventListener('click', () => this.close());
    byId('dc-record').addEventListener('click', () => this.record());
    byId('dc-sweep').addEventListener('click', () => this.startSweep());
    byId('dc-clear').addEventListener('click', () => { this.rows = []; this.refresh(true); });
    byId('dc-csv').addEventListener('click', () => {
      downloadCsv(`dc-iv-${stamp()}.csv`, ['V_V', 'I_mA', 'R_ohm'], this.rows.map((r) => [r.V.toFixed(3), (r.I * 1000).toFixed(2), r.I ? (r.V / r.I).toFixed(2) : '']));
    });
    byId('dc-theory-toggle').addEventListener('change', () => this.refresh(true));
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(target: DCPowerSupply): void {
    this.target = target;
    this.el.hidden = false;
    this.onToggle(true);
    this.refresh(true);
  }

  close(): void {
    this.el.hidden = true;
    this.target = null;
    this.sweep = null;
    this.onToggle(false);
  }

  private setVoltage(v: number): void {
    if (!this.target) return;
    bus.set(this.target, 'voltage', Math.round(Math.min(5, Math.max(0, v)) * 100) / 100);
    this.refresh(true);
  }

  /** 회로 속 (첫 번째) 전압계·전류계 */
  private meters(): { vm: Voltmeter | null; am: Ammeter | null } {
    const parts = this.state?.parts ?? [];
    return {
      vm: (parts.find((p) => p instanceof Voltmeter) as Voltmeter | undefined) ?? null,
      am: (parts.find((p) => p instanceof Ammeter) as Ammeter | undefined) ?? null,
    };
  }

  private record(): boolean {
    const { vm, am } = this.meters();
    if (!vm || !am) {
      byId('dc-status').textContent = '전압계와 전류계가 모두 회로에 있어야 기록할 수 있음';
      return false;
    }
    this.rows.push({ V: round(vm.reading, 3), I: round(am.reading, 4) });
    this.refresh(true);
    return true;
  }

  private startSweep(): void {
    const t = this.target;
    if (!t?.port) return;
    bus.set(t, 'on', true);
    this.rows = [];
    this.sweep = { i: 0, t: performance.now() };
    this.setVoltage(SWEEP[0]);
  }

  update(): void {
    if (!this.isOpen || !this.target) return;
    this.state = this.circuitOf(this.target);
    const now = performance.now();
    const sw = this.sweep;
    if (sw && now - sw.t > SWEEP_WAIT) {
      if (!this.record()) this.sweep = null;
      else if (++sw.i < SWEEP.length) {
        sw.t = now;
        this.setVoltage(SWEEP[sw.i]);
      } else this.sweep = null;
    }
    if (now - this.lastText > 120) {
      this.lastText = now;
      this.refresh(false);
    }
  }

  private refresh(force: boolean): void {
    const t = this.target;
    if (!t) return;
    const st = this.state ?? this.circuitOf(t);
    const set = (id: string, text: string) => { byId(id).textContent = text; };
    const slider = byId<HTMLInputElement>('dc-v');
    if (force || document.activeElement !== slider) slider.value = String(t.voltage);
    set('dc-v-val', `${t.voltage.toFixed(2)} V`);
    byId('dc-power').textContent = !t.port ? '콘센트에 꽂혀 있지 않음' : t.on ? '끄기' : '켜기';
    byId<HTMLButtonElement>('dc-power').disabled = !t.port;
    const sweepBtn = byId<HTMLButtonElement>('dc-sweep');
    sweepBtn.disabled = !t.port || !!this.sweep;
    sweepBtn.textContent = this.sweep ? `자동 측정 중… ${SWEEP[this.sweep.i].toFixed(2)} V` : '자동 측정 (0 → 5 V)';

    const { vm, am } = this.meters();
    let status = '측정 중';
    if (!t.port) status = '전원 장치를 콘센트에 꽂으세요 (전원 장치를 두 번 탭 → 전원 연결)';
    else if (!t.on) status = '전원 장치가 꺼져 있음';
    else if (st?.limited) status = `전류 제한(CC) 동작 중 — 회로 저항이 너무 작음 (단락?). 전원이 ${(st.current).toFixed(2)} A만 흘려 보냄`;
    else if (!vm || !am) status = `${!vm ? '전압계' : ''}${!vm && !am ? '·' : ''}${!am ? '전류계' : ''}를 회로에 연결하세요 (전압계 = 병렬, 전류계 = 직렬)`;
    set('dc-status', status);

    set('dc-out', st && t.on ? `${st.terminalV.toFixed(2)} V · ${(st.current * 1000).toFixed(1)} mA` : '—');
    // 계기가 여러 개면 모두 보여 준다 (키르히호프 법칙: 갈래 전류의 합, 고리 전압의 합 확인)
    const parts = st?.parts ?? [];
    const vms = parts.filter((p): p is Voltmeter => p instanceof Voltmeter);
    const ams = parts.filter((p): p is Ammeter => p instanceof Ammeter);
    set('dc-vm', vms.length ? vms.map((m) => `${vms.length > 1 ? `${m.name.slice(-1)}: ` : ''}${m.reading.toFixed(3)} V`).join(' · ') : '— (회로에 없음)');
    set('dc-am', ams.length ? ams.map((m) => `${ams.length > 1 ? `${m.name.slice(-1)}: ` : ''}${(m.reading * 1000).toFixed(1)} mA`).join(' · ') : '— (회로에 없음)');

    // 이론값(숨김): 부품마다 실제 전압·전류·저항
    const theory = byId('dc-theory');
    const show = byId<HTMLInputElement>('dc-theory-toggle').checked;
    theory.hidden = !show;
    if (show && st) {
      theory.textContent = st.parts
        .filter((p) => !(p instanceof Voltmeter) && !(p instanceof Ammeter))
        .map((p) => {
          const R = p.resistance();
          if (p instanceof Led) {
            return `${p.name}: ${p.voltage.toFixed(3)} V, ${(p.current * 1000).toFixed(1)} mA, ${p.burnt ? '탐 (끊어짐)' : `접합 온도 ${p.Tj.toFixed(0)} °C (150 °C 넘으면 탐)`}`;
          }
          return `${p.name}: ${p.voltage.toFixed(3)} V, ${(p.current * 1000).toFixed(1)} mA, R = ${R === null ? '∞ (열림)' : `${R.toFixed(2)} Ω`}`;
        })
        .join('\n');
    }
    this.renderLog();
    this.drawIV();
  }

  private renderLog(): void {
    const body = byId('dc-log').querySelector('tbody')!;
    body.innerHTML = '';
    if (!this.rows.length) body.innerHTML = '<tr><td colspan="4" class="empty">"측정값 기록"이나 "자동 측정"을 누르세요.</td></tr>';
    this.rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      for (const c of [`${i + 1}`, r.V.toFixed(3), (r.I * 1000).toFixed(1), Math.abs(r.I) > 1e-5 ? (r.V / r.I).toFixed(2) : '—']) {
        const td = document.createElement('td');
        td.textContent = c;
        tr.appendChild(td);
      }
      body.appendChild(tr);
    });
    body.parentElement!.parentElement!.scrollTop = 1e6;
    byId('dc-fit').textContent = fitText(this.rows);
  }

  private drawIV(): void {
    const pts = this.rows.map((r) => [r.V, r.I * 1000] as [number, number]);
    const vMax = Math.max(1, ...pts.map((p) => p[0])) * 1.05;
    const iMax = Math.max(10, ...pts.map((p) => p[1])) * 1.1;
    const series: Series[] = [{ color: '#ffd27a', points: pts }];
    const f = fits(this.rows);
    if (f.R) series.push({ color: '#7ad0ff', points: [[0, 0], [vMax, (vMax / f.R) * 1000]], line: true });
    if (f.n && f.k) {
      const curve: [number, number][] = [];
      for (let i = 1; i <= 40; i++) {
        const V = (vMax * i) / 40;
        curve.push([V, f.k * V ** f.n * 1000]);
      }
      series.push({ color: '#ff8a5a', points: curve, line: true });
    }
    drawPlot(byId<HTMLCanvasElement>('dc-plot'), { x: [0, vMax], y: [0, iMax], series, grid: [1, niceStep(iMax)] });
    byId('dc-plot-range').textContent = `가로 V 0 ~ ${vMax.toFixed(1)} V, 세로 I 0 ~ ${iMax.toFixed(0)} mA`;
  }
}

/** 원점 지나는 직선 I = V/R (최소 제곱) + 거듭제곱 I = k Vⁿ (로그–로그 직선 맞춤) */
function fits(rows: Row[]): { R: number | null; r2: number | null; n: number | null; k: number | null } {
  const use = rows.filter((r) => r.V > 0.02 && r.I > 1e-5);
  if (use.length < 2) return { R: null, r2: null, n: null, k: null };
  const sVI = use.reduce((s, r) => s + r.V * r.I, 0);
  const sVV = use.reduce((s, r) => s + r.V * r.V, 0);
  const g = sVI / sVV; // I = g V
  const mean = use.reduce((s, r) => s + r.I, 0) / use.length;
  const ssr = use.reduce((s, r) => s + (r.I - g * r.V) ** 2, 0);
  const sst = use.reduce((s, r) => s + (r.I - mean) ** 2, 0);
  const xs = use.map((r) => Math.log(r.V));
  const ys = use.map((r) => Math.log(r.I));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
  const n = sxx > 0 ? sxy / sxx : null;
  return { R: 1 / g, r2: sst > 0 ? 1 - ssr / sst : null, n, k: n === null ? null : Math.exp(my - n * mx) };
}

function fitText(rows: Row[]): string {
  const f = fits(rows);
  if (f.R === null) return '기록이 2개 이상(전압 > 0) 있으면 맞춤 결과가 나옵니다.';
  const lines = [`파랑 직선 I = V/R 맞춤: R = ${f.R.toFixed(2)} Ω (결정 계수 R² = ${f.r2?.toFixed(4) ?? '—'})`];
  if (f.n !== null) {
    lines.push(`주황 곡선 I ∝ Vⁿ 맞춤: n = ${f.n.toFixed(3)}`);
    lines.push(Math.abs(f.n - 1) < 0.03
      ? '→ n ≈ 1: 전류가 전압에 비례 (옴의 법칙을 따르는 소자)'
      : f.n < 1
        ? '→ n < 1: 전압을 올릴수록 V/I(저항)가 커짐 — 전구 필라멘트가 뜨거워지며 저항이 증가'
        : '→ n > 1: 전압을 올릴수록 저항이 작아지는 소자 (다이오드·LED: 문턱을 넘으면 전류가 급격히 증가)');
    const th = threshold(rows);
    if (f.n > 1.3 && th !== null) lines.push(`문턱 전압(전류 1 mA가 되는 전압) ≈ ${th.toFixed(2)} V → e·V = ${th.toFixed(2)} eV. 빛알 에너지 hc/λ(빨강 620 nm 2.00 · 초록 525 nm 2.36 · 파랑 465 nm 2.67 eV)와 비교 — 문턱을 어디로 잡느냐에 따라 조금 작게 나온다`);
  }
  return lines.join('\n');
}

/** 전류가 처음 1 mA를 넘는 전압 (이웃 두 점 사이 직선 보간) */
function threshold(rows: Row[]): number | null {
  const r = [...rows].sort((a, b) => a.V - b.V);
  for (let i = 1; i < r.length; i++) {
    if (r[i - 1].I < 1e-3 && r[i].I >= 1e-3) return r[i - 1].V + ((1e-3 - r[i - 1].I) / (r[i].I - r[i - 1].I)) * (r[i].V - r[i - 1].V);
  }
  return null;
}

function niceStep(max: number): number {
  const raw = max / 5;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
}

function round(x: number, d: number): number {
  const p = 10 ** d;
  return Math.round(x * p) / p;
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
