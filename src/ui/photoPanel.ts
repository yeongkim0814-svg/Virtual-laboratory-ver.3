/**
 * 광전 효과 실험 패널
 *
 * 1. 전원 장치의 전압·극성을 바꾸며 전류계 값을 본다 → I–V 곡선이 자동으로 쌓인다
 * 2. 역전압을 키워 전류가 0이 되는 전압(정지 전압 V_s)을 찾아 "정지 전압 기록"
 * 3. 파장을 바꿔 여러 번 기록하면 V_s–f 그래프에 직선을 맞춰
 *      기울기 = h/e → 플랑크 상수 h,   절편 = −W/e → 일함수 W
 */
import type { DCPowerSupply, PhotoCircuitState } from '../equipment/electrical';
import { E_CHARGE, H, frequency, linearFit, photonEnergyEV } from '../sim/photoelectric';
import { wavelengthToRGB } from '../sim/optics';

const LOG_KEY = 'vlab-photo-log-v1';
const V_MIN = -1.5; // 가로축 왼쪽 끝 기본값 (역전압을 더 걸면 그만큼 넓힌다)
const V_MAX = 5;

interface Row {
  nm: number;
  metal: string;
  W: number;
  Vs: number;
}

export class PhotoPanel {
  readonly el = byId('pe-panel');
  target: DCPowerSupply | null = null;
  /** I–V 측정점: 조건(파장·음극·세기)별 */
  private series = new Map<string, { nm: number; pts: Map<number, number> }>();
  private log: Row[] = loadLog();
  private lastText = 0;
  private state: PhotoCircuitState | null = null;

  constructor(private onToggle: (open: boolean) => void, private circuitOf: (s: DCPowerSupply) => PhotoCircuitState | null) {
    const slider = byId<HTMLInputElement>('pe-v');
    slider.addEventListener('input', () => this.setVoltage(Number(slider.value)));
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('button[data-dv]')) {
      b.addEventListener('click', () => this.target && this.setVoltage(this.target.voltage + Number(b.dataset.dv)));
    }
    for (const b of byId('pe-pol').querySelectorAll<HTMLButtonElement>('button')) {
      b.addEventListener('click', () => { if (this.target) this.target.reversed = b.dataset.v === 'rev'; this.refresh(true); });
    }
    byId('pe-power').addEventListener('click', () => {
      const t = this.target;
      if (t?.port) t.on = !t.on;
      this.refresh(true);
    });
    byId('pe-theory-toggle').addEventListener('change', () => this.refresh(true));
    byId('pe-close').addEventListener('click', () => this.close());
    byId('pe-record').addEventListener('click', () => this.record());
    byId('pe-clear-iv').addEventListener('click', () => { this.series.clear(); this.refresh(true); });
    byId('pe-clear').addEventListener('click', () => { this.log = []; saveLog(this.log); this.refresh(true); });
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
    this.onToggle(false);
  }

  private setVoltage(v: number): void {
    if (!this.target) return;
    this.target.voltage = Math.round(Math.min(5, Math.max(0, v)) * 100) / 100;
    this.refresh(true);
  }

  /** 매 프레임: 측정점 쌓기 + 0.1초마다 글자 갱신 */
  update(): void {
    if (!this.isOpen || !this.target) return;
    this.state = this.circuitOf(this.target);
    this.sample();
    const now = performance.now();
    if (now - this.lastText > 100) {
      this.lastText = now;
      this.refresh(false);
    }
  }

  /** 지금 조건의 (V_AK, 전류계 값)을 I–V 곡선에 더한다 */
  private sample(): void {
    const st = this.state;
    const light = st?.tube?.light;
    if (!st?.tube || !st.ammeter || !light || !this.target?.on) return;
    const nm = Math.round(light.lambda * 1e9);
    const key = `${nm} nm · ${st.tube.metal} · ${(light.powerW * 1000).toFixed(2)} mW`;
    let s = this.series.get(key);
    if (!s) this.series.set(key, (s = { nm, pts: new Map() }));
    s.pts.set(Math.round(st.vAK * 100) / 100, Math.abs(st.ammeter.reading ?? 0));
  }

  private refresh(force: boolean): void {
    const t = this.target;
    if (!t) return;
    const st = this.state ?? this.circuitOf(t);
    const set = (id: string, text: string) => { byId(id).textContent = text; };
    const slider = byId<HTMLInputElement>('pe-v');
    if (force || document.activeElement !== slider) slider.value = String(t.voltage);
    set('pe-v-val', `${t.voltage.toFixed(2)} V`);
    byId('pe-power').textContent = !t.port ? '콘센트에 꽂혀 있지 않음' : t.on ? '끄기' : '켜기';
    byId<HTMLButtonElement>('pe-power').disabled = !t.port;
    for (const b of byId('pe-pol').querySelectorAll<HTMLButtonElement>('button')) {
      b.setAttribute('aria-pressed', String((b.dataset.v === 'rev') === t.reversed));
    }

    const tube = st?.tube ?? null;
    const light = tube?.light ?? null;
    let status = st?.problem ?? '';
    if (!t.port) status = '전원 장치를 콘센트에 꽂으세요 (전원 장치를 탭 → 전원 연결)';
    else if (!t.on) status = '전원 장치가 꺼져 있음';
    else if (tube && !light) status = '광전관에 빛이 닿지 않음 — 레이저를 광전관 유리에 비추세요';
    else if (!status) status = '측정 중';
    set('pe-status', status);

    const showTheory = byId<HTMLInputElement>('pe-theory-toggle').checked;
    if (light && tube) {
      const nm = Math.round(light.lambda * 1e9);
      const E = photonEnergyEV(light.lambda);
      set('pe-light', `${nm} nm, ${(light.powerW * 1000).toFixed(2)} mW (f = ${(frequency(light.lambda) / 1e14).toFixed(2)}×10¹⁴ Hz)`);
      set('pe-hf', `${E.toFixed(3)} eV`);
      set('pe-W', `${tube.metal}, ${tube.W.toFixed(2)} eV`);
      set('pe-theory', showTheory ? (E > tube.W ? `${(E - tube.W).toFixed(3)} V` : '0 (hf < W → 전자가 나오지 않음)') : '— (체크하면 보임)');
    } else {
      for (const id of ['pe-light', 'pe-hf', 'pe-theory']) set(id, '—');
      set('pe-W', tube ? `${tube.metal}, ${tube.W.toFixed(2)} eV` : '—');
    }
    set('pe-vak', st?.tube ? `${st.vAK >= 0 ? '+' : ''}${st.vAK.toFixed(2)} V ${st.vAK < 0 ? '(역전압)' : '(순방향)'}` : '—');
    const r = st?.ammeter?.reading;
    set('pe-i', r === undefined || r === null ? '—' : `${(r * 1e6).toFixed(3)} µA`);
    this.drawIV();
    this.drawVF();
    this.renderLog();
  }

  private record(): void {
    const st = this.state;
    const light = st?.tube?.light;
    const r = st?.ammeter?.reading;
    if (!st?.tube || !light || r === null || r === undefined) {
      byId('pe-status').textContent = '회로·빛·전류계가 모두 갖춰져야 기록할 수 있음';
      return;
    }
    if (Math.abs(r * 1e6) >= 0.0005 || st.vAK > 0) {
      byId('pe-status').textContent = '역전압을 더 키워 전류계가 0.000 µA가 되었을 때 기록하세요';
      return;
    }
    this.log.push({ nm: Math.round(light.lambda * 1e9), metal: st.tube.metal, W: st.tube.W, Vs: -st.vAK });
    saveLog(this.log);
    this.refresh(true);
  }

  private renderLog(): void {
    const body = byId('pe-log').querySelector('tbody')!;
    body.innerHTML = '';
    if (!this.log.length) {
      body.innerHTML = '<tr><td colspan="4" class="empty">전류가 0이 되는 역전압에서 "정지 전압 기록"을 누르세요.</td></tr>';
    }
    for (const r of this.log) {
      const tr = document.createElement('tr');
      for (const c of [`${r.nm}`, (frequency(r.nm * 1e-9) / 1e14).toFixed(3), r.metal, r.Vs.toFixed(2)]) {
        const td = document.createElement('td');
        td.textContent = c;
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    // 음극별 직선 맞춤 → h, W
    const lines: string[] = [];
    for (const metal of [...new Set(this.log.map((r) => r.metal))]) {
      const rows = this.log.filter((r) => r.metal === metal);
      const fit = linearFit(rows.map((r) => frequency(r.nm * 1e-9)), rows.map((r) => r.Vs));
      if (!fit || new Set(rows.map((r) => r.nm)).size < 2) {
        lines.push(`${metal}: 파장이 다른 기록이 2개 이상 필요`);
        continue;
      }
      const h = fit.a * E_CHARGE;
      lines.push(`${metal}: 기울기 h/e → h = ${(h * 1e34).toFixed(3)}×10⁻³⁴ J·s (참값 대비 ${fmtPct((h - H) / H)}), 절편 → W = ${(-fit.b).toFixed(2)} eV`);
    }
    byId('pe-fit').textContent = lines.join('\n');
  }

  /** I–V 곡선: 가로 V_AK (−1.5 ~ 5 V), 세로 전류 (µA) */
  private drawIV(): void {
    const { g, w, h } = prep(byId<HTMLCanvasElement>('pe-iv'));
    let maxI = 0.1e-6;
    for (const s of this.series.values()) for (const i of s.pts.values()) maxI = Math.max(maxI, i);
    // 가로축: 기록된 가장 큰 역전압(또는 지금 전압)까지 0.5 V 단위로 넓힌다 → 역전압 쪽 점이 그래프 밖으로 나가지 않음
    let lo = Math.min(V_MIN, this.state?.vAK ?? 0);
    for (const s of this.series.values()) for (const v of s.pts.keys()) lo = Math.min(lo, v);
    const vMin = Math.floor(lo * 2) / 2;
    const X = (v: number) => ((v - vMin) / (V_MAX - vMin)) * (w - 1);
    g.fillStyle = 'rgba(255,154,46,0.18)';
    for (let v = Math.ceil(vMin); v <= V_MAX; v++) if (v !== 0) g.fillRect(Math.round(X(v)), 0, 1, h);
    const Y = (i: number) => h - 2 - (i / (maxI * 1.1)) * (h - 4);
    axes(g, w, h, X(0), h - 2);
    for (const s of this.series.values()) {
      const [r, gg, b] = wavelengthToRGB(s.nm);
      const col = `rgb(${(255 * r) | 0},${(255 * gg) | 0},${(255 * b) | 0})`;
      // 전압 순으로 정렬해 선으로 잇고, 측정점은 2×2 점
      const pts = [...s.pts].sort((p, q) => p[0] - q[0]);
      g.strokeStyle = col;
      g.beginPath();
      pts.forEach(([v, i], k) => (k ? g.lineTo(X(v) + 0.5, Y(i) + 0.5) : g.moveTo(X(v) + 0.5, Y(i) + 0.5)));
      g.stroke();
      g.fillStyle = col;
      for (const [v, i] of pts) g.fillRect(Math.round(X(v)), Math.round(Y(i)) - 1, 2, 2);
    }
    // 지금 상태 표시
    const st = this.state;
    if (st?.tube && st.ammeter?.reading != null) {
      g.fillStyle = '#ffffff';
      g.fillRect(Math.round(X(st.vAK)) - 1, Math.round(Y(Math.abs(st.ammeter.reading))) - 1, 3, 3);
    }
    byId('pe-iv-max').textContent = `가로 ${vMin.toFixed(1)} ~ ${V_MAX} V (1칸 1 V) · 세로 최대 ${(maxI * 1.1 * 1e6).toFixed(2)} µA`;
  }

  /** V_s–f: 기록한 점 + 음극별 맞춤 직선 */
  private drawVF(): void {
    const { g, w, h } = prep(byId<HTMLCanvasElement>('pe-vf'));
    const F0 = 4.0e14;
    const F1 = 8.0e14;
    const VMAX = 1.5;
    const X = (f: number) => ((f - F0) / (F1 - F0)) * (w - 1);
    const Y = (v: number) => h - 2 - (v / VMAX) * (h - 4);
    axes(g, w, h, 0, Y(0));
    for (let f = 5e14; f < F1; f += 1e14) { g.fillStyle = 'rgba(255,154,46,0.22)'; g.fillRect(Math.round(X(f)), 0, 1, h); }
    const colors: Record<string, string> = { Cs: '#ffd27a', Na: '#7fd7ff' };
    for (const metal of [...new Set(this.log.map((r) => r.metal))]) {
      const rows = this.log.filter((r) => r.metal === metal);
      g.fillStyle = colors[metal] ?? '#fff';
      for (const r of rows) g.fillRect(Math.round(X(frequency(r.nm * 1e-9))) - 1, Math.round(Y(r.Vs)) - 1, 3, 3);
      const fit = linearFit(rows.map((r) => frequency(r.nm * 1e-9)), rows.map((r) => r.Vs));
      if (fit && new Set(rows.map((r) => r.nm)).size >= 2) {
        g.strokeStyle = colors[metal] ?? '#fff';
        g.beginPath();
        g.moveTo(X(F0), Y(fit.a * F0 + fit.b));
        g.lineTo(X(F1), Y(fit.a * F1 + fit.b));
        g.stroke();
      }
    }
  }
}

// ---------- 도우미 ----------
function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function prep(c: HTMLCanvasElement): { g: CanvasRenderingContext2D; w: number; h: number } {
  const w = Math.max(1, Math.round(c.clientWidth / 2));
  const h = Math.max(1, Math.round(c.clientHeight / 2));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}

function axes(g: CanvasRenderingContext2D, w: number, h: number, x0: number, y0: number): void {
  g.fillStyle = 'rgba(255,154,46,0.45)';
  g.fillRect(0, Math.round(y0), w, 1);
  g.fillRect(Math.round(x0), 0, 1, h);
}

function fmtPct(x: number): string {
  const p = x * 100;
  return `${p > 0 ? '+' : ''}${p.toFixed(1)} %`;
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
