/**
 * 노트북 측정 프로그램 패널: 기록 시작·멈춤, 표본 속도, 기록 시간, 계산 창,
 * x–t · v–t · a–t 그래프, 커서 A·B 구간 분석, CSV 저장
 *
 * 운동 센서는 거리 x만 잰다. v·a는 x에서 계산한 값 (sim/logger.ts):
 * 창을 넓히면 매끄럽지만 충돌처럼 빠른 변화가 뭉개진다.
 */
import { bus } from '../net/commands';
import { MotionSensor, PHSensor, type DataSensor, type Laptop } from '../equipment/sensors';
import { analyzeTitration, derive, forceEpisodes, intervalStats, quadFit, type Derived } from '../sim/logger';
import { ForceSensor, Photogate, type GatePass } from '../equipment/dynamicsSensors';
import { downloadCsv, drawPlot, stamp, type Series } from './plotKit';

export class LoggerPanel {
  readonly el = byId('log-panel');
  target: Laptop | null = null;
  private sensor: DataSensor | null = null;
  private phMode: 'V' | 't' = 'V';
  private window = 7;
  private flip = false;
  private last = 0;
  private sensorKey = '';
  /** 힘 화면에서 고른 충돌 (−1 = 마지막) */
  private episode = -1;
  private episodeCount = -1;

  constructor(private onToggle: (open: boolean) => void) {
    byId('lg-close').addEventListener('click', () => this.close());
    byId('lg-rec').addEventListener('click', () => {
      const l = this.target;
      if (!l || !l.sensors.length) return;
      bus.call(l, l.recording ? 'stop' : 'start');
      this.refresh(true);
    });
    seg('lg-rate', (v) => { if (this.target) bus.set(this.target, 'rate', v); this.refresh(true); });
    seg('lg-dur', (v) => { if (this.target) bus.set(this.target, 'duration', v); this.refresh(true); });
    seg('lg-win', (v) => { this.window = v; this.refresh(true); });
    const flip = byId<HTMLInputElement>('lg-flip');
    flip.addEventListener('change', () => { this.flip = flip.checked; this.refresh(true); });
    for (const id of ['lg-ta', 'lg-tb']) byId(id).addEventListener('input', () => this.refresh(true));
    for (const b of byId('lg-ph-mode').querySelectorAll<HTMLButtonElement>('button')) {
      b.addEventListener('click', () => { this.phMode = b.dataset.v as 'V' | 't'; this.refresh(true); });
    }
    byId('lg-csv').addEventListener('click', () => {
      const s = this.sensor;
      if (!s) return;
      if (s instanceof ForceSensor) {
        downloadCsv(`force-${stamp()}.csv`, ['t (s)', 'F (N)'], s.samples.map((p) => [p.t.toFixed(4), p.F.toFixed(2)]));
        return;
      }
      if (s instanceof Photogate) {
        downloadCsv(`photogate-${stamp()}.csv`, ['gate', 't_on (s)', 't_off (s)', 'dt (ms)', 'v (m/s)'],
          this.gatePasses().map((p) => [p.gate, p.on.toFixed(5), p.off.toFixed(5), ((p.off - p.on) * 1000).toFixed(3), p.v.toFixed(4)]));
        return;
      }
      if (s instanceof PHSensor) {
        downloadCsv(`titration-${stamp()}.csv`, ['t (s)', 'V (mL)', 'pH'],
          s.samples.map((p) => [p.t.toFixed(2), p.V.toFixed(2), p.pH === null ? '' : p.pH.toFixed(2)]));
        return;
      }
      const d = this.data();
      downloadCsv(`motion-${stamp()}.csv`, ['t (s)', 'x (m)', 'v (m/s)', 'a (m/s^2)'],
        d.map((p) => [p.t.toFixed(3), p.x.toFixed(4), p.v?.toFixed(4) ?? '', p.a?.toFixed(3) ?? '']));
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(target: Laptop): void {
    this.target = target;
    this.sensor = target.sensors[0] ?? null;
    this.sensorKey = '';
    // 적정은 오래 걸리므로 pH 센서면 기록 시간 기본값(10 s)을 "계속"으로
    if (this.sensor instanceof PHSensor && target.duration === 10) bus.set(target, 'duration', 0);
    this.el.hidden = false;
    byId('lg-title').textContent = `측정 프로그램 · ${target.name}`;
    this.onToggle(true);
    this.refresh(true);
  }

  close(): void {
    this.el.hidden = true;
    this.target = null;
    this.onToggle(false);
  }

  /** 계산된 (x, v, a) — 방향 반대면 부호를 바꾼다 */
  private data(): Derived[] {
    const s = this.sensor;
    if (!(s instanceof MotionSensor)) return [];
    const k = this.flip ? -1 : 1;
    return derive(s.samples, this.window).map((p) => ({
      t: p.t, x: k * p.x, v: p.v === null ? null : k * p.v, a: p.a === null ? null : k * p.a,
    }));
  }

  update(): void {
    if (!this.isOpen) return;
    const now = performance.now();
    if (now - this.last > 150) {
      this.last = now;
      this.refresh(false);
    }
  }

  private refresh(force: boolean): void {
    const l = this.target;
    if (!l) return;
    // 센서 고르기 (2개 연결 시)
    if (this.sensor && !l.sensors.includes(this.sensor)) this.sensor = null;
    if (!this.sensor) this.sensor = l.sensors[0] ?? null;
    const key = l.sensors.map((s) => s.name).join('|');
    if (key !== this.sensorKey) {
      this.sensorKey = key;
      const box = byId('lg-sensors');
      box.innerHTML = '';
      for (const s of l.sensors) {
        const b = document.createElement('button');
        b.textContent = s.name;
        b.addEventListener('click', () => { this.sensor = s; this.refresh(true); });
        box.appendChild(b);
      }
    }
    for (const b of byId('lg-sensors').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.textContent === this.sensor?.name));

    byId('lg-status').textContent = !l.sensors.length
      ? '연결된 센서가 없습니다 — 센서를 두 번 탭해 "노트북에 연결"'
      : l.recording ? `기록 중 · ${l.clock.toFixed(2)} s` : `대기 · 센서 ${l.sensors.length}개`;
    const rec = byId<HTMLButtonElement>('lg-rec');
    rec.textContent = l.recording ? '■ 멈추기' : '● 기록 시작';
    rec.disabled = !l.sensors.length;
    pressed('lg-rate', l.rate);
    pressed('lg-dur', l.duration);
    pressed('lg-win', this.window);
    const ph = this.sensor instanceof PHSensor;
    const isForce = this.sensor instanceof ForceSensor;
    const gate = this.sensor instanceof Photogate;
    const motion = !ph && !isForce && !gate;
    byId('lg-ph').hidden = !ph;
    byId('lg-force').hidden = !isForce;
    byId('lg-gate').hidden = !gate;
    byId('lg-motion').hidden = !motion;
    byId('lg-motion-set').hidden = !motion;
    byId('lg-now').textContent = this.sensor ? this.sensor.display() : '—';
    for (const b of byId('lg-ph-mode').querySelectorAll('button')) b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.v === this.phMode));
    if (force || l.recording) {
      if (ph) this.drawPH();
      else if (isForce) this.drawForce();
      else if (gate) this.drawGates();
      else this.drawAll();
    }
  }

  /** 이 노트북에 이어진 포토게이트들의 가림 기록 (시간순) */
  private gatePasses(): GatePass[] {
    const gs = (this.target?.sensors ?? []).filter((x): x is Photogate => x instanceof Photogate);
    return gs.flatMap((g) => g.passes()).sort((a, b) => a.on - b.on);
  }

  /** 힘 센서: 전체 F–t, 충돌 고르기, 확대(넓이 칠함), 충격량과 운동량 변화 비교 */
  private drawForce(): void {
    const s = this.sensor as ForceSensor;
    const S = s.samples;
    const eps = forceEpisodes(S);
    if (eps.length !== this.episodeCount) {
      this.episodeCount = eps.length;
      if (this.episode >= eps.length) this.episode = -1;
      const box = byId('lg-f-pick');
      box.innerHTML = '';
      eps.forEach((_, i) => {
        const b = document.createElement('button');
        b.textContent = `충돌 ${i + 1}`;
        b.dataset.i = String(i);
        b.addEventListener('click', () => { this.episode = i; this.refresh(true); });
        box.appendChild(b);
      });
    }
    const pick = eps.length ? (this.episode < 0 ? eps.length - 1 : this.episode) : -1;
    for (const b of byId('lg-f-pick').querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.i) === pick));

    // 전체 기록 (점이 많으면 솎아서)
    const step = Math.max(1, Math.floor(S.length / 3000));
    const all: [number, number][] = [];
    for (let i = 0; i < S.length; i += step) all.push([S[i].t, S[i].F]);
    const tMax = Math.max(1, S.length ? S[S.length - 1].t : 0);
    const fMax = Math.max(1, ...eps.map((e) => e.Fmax)) * 1.1;
    drawPlot(byId<HTMLCanvasElement>('lg-f-all'), {
      x: [0, tMax], y: [-0.1 * fMax, fMax], grid: [1, niceStep(fMax)],
      series: [
        ...eps.map((e, i) => ({ color: i === pick ? 'rgba(255,210,122,0.35)' : 'rgba(255,255,255,0.12)', line: true, points: [[e.tPeak, 0], [e.tPeak, e.Fmax]] as [number, number][] })),
        { color: '#ff9a7a', line: true, points: all },
      ],
    });
    byId('lg-f-leg').textContent = `가로 0 ~ ${tMax.toFixed(1)} s, 세로 ~ ${fMax.toFixed(1)} N`;

    const zoomEl = byId<HTMLCanvasElement>('lg-f-zoom');
    const stats = byId('lg-f-stats');
    if (pick < 0) {
      drawPlot(zoomEl, { x: [0, 0.2], y: [0, 1], series: [] });
      byId('lg-f-zoom-leg').textContent = '';
      stats.innerHTML = '<dt>충돌</dt><dd>아직 없음 — 기록을 시작하고 수레를 힘 센서 쪽으로 밀어 보세요</dd>';
      return;
    }
    const e = eps[pick];
    const dur = e.t1 - e.t0;
    const pad = Math.max(0.01, dur * 0.4);
    const z0 = e.t0 - pad;
    const z1 = e.t1 + pad;
    const win = S.filter((p) => p.t >= z0 && p.t <= z1).map((p) => [(p.t - e.t0) * 1000, p.F] as [number, number]);
    const area = S.filter((p) => p.t >= e.t0 && p.t <= e.t1).map((p) => [(p.t - e.t0) * 1000, p.F] as [number, number]);
    const yMax = e.Fmax * 1.15;
    drawPlot(zoomEl, {
      x: [-pad * 1000, (dur + pad) * 1000], y: [-0.08 * yMax, yMax], grid: [niceStep(dur * 1000 * 1.8), niceStep(yMax)],
      series: [
        { color: 'rgba(255,154,122,0.35)', points: area, fill: true },
        { color: '#ff9a7a', line: true, points: win },
        { color: '#ff9a7a', points: win, size: 2 },
        { color: 'rgba(255,255,255,0.5)', line: true, points: [[-pad * 1000, e.Fmax / 2], [(dur + pad) * 1000, e.Fmax / 2]] },
      ],
    });
    byId('lg-f-zoom-leg').textContent = `가로 ms (0 = 닿은 순간), 세로 0 ~ ${yMax.toFixed(1)} N, 흰 선 = 최대 힘의 절반`;

    // 충돌 전후 속도: 같은 노트북의 운동 센서 또는 포토게이트
    const m = s.cartMass;
    const rows: string[] = [];
    const ms = this.target?.sensors.find((x): x is MotionSensor => x instanceof MotionSensor);
    if (ms && m) {
      // 충돌 직전·직후 구간의 위치 x(t)를 2차식으로 맞춰, 닿는 순간·떨어지는 순간의 기울기(속도)를 읽는다.
      // (미분한 v는 계산 창이 충돌을 가로질러 뭉개지고, 구간 평균은 구름 저항으로 줄어든 만큼 작게 나온다)
      const k = this.flip ? -1 : 1;
      const at = (a: number, b: number, t: number) => {
        const q = ms.samples.filter((p) => p.t >= a && p.t <= b && p.x !== null);
        const f = quadFit(q.map((p) => p.t), q.map((p) => k * (p.x as number)));
        return f && q.length >= 4 ? f.c1 + 2 * f.c2 * (t - q[0].t) : null;
      };
      const v1 = at(e.t0 - 0.6, e.t0 - 0.01, e.t0);
      const v2 = at(e.t1 + 0.01, e.t1 + 0.6, e.t1);
      if (v1 !== null && v2 !== null) {
        const dp = m * Math.abs(v2 - v1);
        rows.push(`<dt>${ms.name}: 닿는 순간 · 떨어지는 순간 속도 (앞뒤 구간 x–t 2차 맞춤)</dt><dd>${v1.toFixed(3)} → ${v2.toFixed(3)} m/s</dd>`,
          `<dt>운동량 변화 |Δp| = m·|v₂ − v₁|</dt><dd>${dp.toFixed(4)} kg·m/s (J와 ${pct(e.J, dp)})</dd>`);
      }
    }
    const passes = this.gatePasses();
    if (passes.length && m) {
      const before = passes.filter((p) => p.off < e.t0).pop();
      const after = passes.find((p) => p.on > e.t1);
      if (before && after && before.gate === after.gate) {
        const dp = m * (before.v + after.v);
        rows.push(`<dt>${before.gate}: 충돌 전 · 후 속력 (방향이 바뀜)</dt><dd>${before.v.toFixed(3)} · ${after.v.toFixed(3)} m/s</dd>`,
          `<dt>운동량 변화 |Δp| = m·(v₁ + v₂)</dt><dd>${dp.toFixed(4)} kg·m/s (J와 ${pct(e.J, dp)})</dd>`,
          `<dt>반발 계수 e = v₂ / v₁</dt><dd>${(after.v / before.v).toFixed(3)}</dd>`);
      }
    }
    stats.innerHTML = `
      <dt>충돌 시간 Δt (힘이 0보다 큰 동안)</dt><dd>${(dur * 1000).toFixed(1)} ms</dd>
      <dt>최대 힘</dt><dd>${e.Fmax.toFixed(2)} N</dd>
      <dt>충격량 J = ∫F dt (넓이)</dt><dd>${e.J.toFixed(4)} N·s</dd>
      <dt>평균 힘 J / Δt</dt><dd>${(e.J / dur).toFixed(2)} N</dd>
      <dt>부딪힌 수레 질량 m</dt><dd>${m ? `${m.toFixed(3)} kg` : '—'}</dd>
      ${rows.join('')}`;
  }

  /** 포토게이트: 가림 기록 표, 속력, 두 게이트 사이 가속도 */
  private drawGates(): void {
    const ps = this.gatePasses();
    const body = byId('lg-gate-log').querySelector('tbody')!;
    body.innerHTML = ps.length ? '' : '<tr><td colspan="5" class="empty">기록을 시작하고 수레를 포토게이트 사이로 지나가게 하세요.</td></tr>';
    ps.forEach((p, i) => {
      const tr = document.createElement('tr');
      for (const c of [`${i + 1}`, p.gate.replace('포토게이트 ', 'PG '), p.on.toFixed(3), ((p.off - p.on) * 1000).toFixed(2), p.v.toFixed(3)]) {
        const td = document.createElement('td');
        td.textContent = c;
        tr.appendChild(td);
      }
      body.appendChild(tr);
    });
    // 서로 다른 게이트를 차례로 지난 쌍 → 가속도
    const gs = (this.target?.sensors ?? []).filter((x): x is Photogate => x instanceof Photogate);
    const dist = gs.length >= 2 && gs[0].gate && gs[1].gate ? Math.abs(gs[0].gate.s - gs[1].gate.s) : null;
    const rows: string[] = [];
    for (let i = 0; i + 1 < ps.length; i++) {
      const a = ps[i];
      const b = ps[i + 1];
      if (a.gate === b.gate || b.on - a.off > 5) continue;
      const tc = (b.on + b.off) / 2 - (a.on + a.off) / 2;
      const acc = (b.v - a.v) / tc;
      rows.push(`<dt>${i + 1} → ${i + 2}: a = Δv / Δt (속력 기준, − = 느려짐)</dt><dd>${acc.toFixed(3)} m/s² (Δt ${tc.toFixed(3)} s)</dd>`);
      if (dist) rows.push(`<dt>${i + 1} → ${i + 2}: a = (v₂² − v₁²) / 2d, d = ${(dist * 100).toFixed(1)} cm</dt><dd>${((b.v * b.v - a.v * a.v) / (2 * dist)).toFixed(3)} m/s²</dd>`);
    }
    byId('lg-gate-stats').innerHTML = rows.length ? rows.join('') : `<dt>두 게이트 사이 가속도</dt><dd>${gs.length < 2 ? '포토게이트 2개를 이 노트북에 연결하면 계산' : '두 게이트를 차례로 지나간 기록이 필요'}</dd>`;
    byId('lg-gate').querySelector('.table-wrap')!.scrollTop = 1e6;
  }

  /** pH 센서: 적정 곡선(pH–V) 또는 pH–t, 기울기 그래프, 당량점·반당량점 */
  private drawPH(): void {
    const s = this.sensor as PHSensor;
    const an = analyzeTitration(s.samples);
    const byV = this.phMode === 'V';
    const raw = s.samples.filter((p) => p.pH !== null).map((p) => [byV ? p.V : p.t, p.pH as number] as [number, number]);
    const xMax = Math.max(byV ? 5 : 10, ...raw.map(([x]) => x * 1.05));
    const series: Series[] = [{ color: '#9dffb8', line: true, points: raw }, { color: '#9dffb8', points: raw, size: 2 }];
    if (byV && an.eqV !== null) {
      series.unshift({ color: 'rgba(255,120,120,0.8)', line: true, points: [[an.eqV, 0], [an.eqV, 14]] });
      series.unshift({ color: 'rgba(255,255,255,0.5)', line: true, points: [[an.eqV / 2, 0], [an.eqV / 2, 14]] });
    }
    drawPlot(byId<HTMLCanvasElement>('lg-ph-plot'), { x: [0, xMax], y: [0, 14], grid: [byV ? 5 : 10, 1], series });
    byId('lg-ph-leg').textContent = byV ? `가로 V 0 ~ ${xMax.toFixed(1)} mL (1칸 5 mL), 세로 pH 0 ~ 14` : `가로 t 0 ~ ${xMax.toFixed(0)} s`;
    const sl = an.slope.map((p) => [p.V, p.pH] as [number, number]);
    const sMax = Math.max(1, ...sl.map(([, y]) => Math.abs(y)));
    drawPlot(byId<HTMLCanvasElement>('lg-dph'), {
      x: [0, byV ? xMax : Math.max(5, ...sl.map(([x]) => x * 1.05))], y: [0, sMax * 1.1], grid: [5, niceStep(sMax)],
      series: [{ color: '#ffd27a', line: true, points: sl }],
    });
    byId('lg-dph-leg').textContent = `가로 V (mL), 세로 0 ~ ${(sMax * 1.1).toFixed(1)} pH/mL`;
    byId('lg-ph-stats').innerHTML = `
      <dt>시작 pH</dt><dd>${fmt2(an.startPH)}</dd>
      <dt>당량점 V (기울기 최대)</dt><dd>${fmt2(an.eqV, ' mL')}</dd>
      <dt>당량점 pH</dt><dd>${fmt2(an.eqPH)}</dd>
      <dt>반당량점 pH (V_eq/2) — 약산이면 ≈ pKa</dt><dd>${fmt2(an.halfPH)}</dd>
      <dt>정돈된 점</dt><dd>${an.points.length}개</dd>`;
  }

  private drawAll(): void {
    const d = this.data();
    const tMax = Math.max(d.length ? d[d.length - 1].t : 0, 1);
    const ta = (Number(byId<HTMLInputElement>('lg-ta').value) / 1000) * tMax;
    const tb = (Number(byId<HTMLInputElement>('lg-tb').value) / 1000) * tMax;
    const plots: [string, 'x' | 'v' | 'a', string][] = [
      ['lg-x', 'x', '#9dffb8'],
      ['lg-v', 'v', '#ffd27a'],
      ['lg-a', 'a', '#7fd7ff'],
    ];
    // 센서가 범위 밖(값 없음)이던 시각 — 그 사이에서만 선을 끊는다 (프레임이 늦어 표본 간격이 벌어진 것은 잇는다)
    const missing = (this.sensor instanceof MotionSensor ? this.sensor.samples : []).filter((p) => p.x === null).map((p) => p.t);
    for (const [id, k, color] of plots) {
      const pts: [number, number][] = [];
      let prevT = -Infinity;
      let mi = 0;
      for (const p of d) {
        const y = p[k];
        if (y === null) continue;
        let broke = false;
        while (mi < missing.length && missing[mi] < p.t) {
          if (missing[mi] > prevT) broke = true;
          mi++;
        }
        if (broke && pts.length) pts.push([p.t, NaN]); // 빈 구간
        pts.push([p.t, y]);
        prevT = p.t;
      }
      let lo = Infinity;
      let hi = -Infinity;
      for (const [, y] of pts) {
        if (!Number.isFinite(y)) continue;
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
      if (lo === Infinity) { lo = -1; hi = 1; }
      if (k !== 'x') { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
      const span = Math.max(hi - lo, k === 'x' ? 0.02 : 0.05);
      lo -= span * 0.1;
      hi = lo + span * 1.2;
      const cursor = (t: number, c: string): Series => ({ color: c, line: true, points: [[t, lo], [t, hi]] });
      drawPlot(byId<HTMLCanvasElement>(id), {
        x: [0, tMax], y: [lo, hi], grid: [1, niceStep(hi - lo)],
        series: [
          cursor(ta, 'rgba(255,255,255,0.6)'), cursor(tb, 'rgba(255,120,120,0.75)'),
          { color, line: true, points: pts }, { color, points: pts, size: 2 },
        ],
      });
      const f = k === 'x' ? 3 : 2;
      byId(`${id}-leg`).textContent = `${lo.toFixed(f)} ~ ${hi.toFixed(f)} · 1칸 ${Number(niceStep(hi - lo).toPrecision(2))}`;
    }
    byId('lg-t-leg').textContent = `가로: 시간 0 ~ ${tMax.toFixed(1)} s (세로선 1 s마다)`;
    const at = (t: number) => d.reduce<Derived | null>((b, p) => (!b || Math.abs(p.t - t) < Math.abs(b.t - t) ? p : b), null);
    const A = at(ta);
    const B = at(tb);
    byId('lg-ta-val').textContent = A ? `${A.t.toFixed(2)} s · x ${A.x.toFixed(3)} · v ${fmt(A.v)} · a ${fmt(A.a)}` : '—';
    byId('lg-tb-val').textContent = B ? `${B.t.toFixed(2)} s · x ${B.x.toFixed(3)} · v ${fmt(B.v)} · a ${fmt(B.a)}` : '—';
    const st = intervalStats(d, ta, tb);
    byId('lg-stats').innerHTML = st
      ? `<dt>구간 A–B</dt><dd>${st.dt.toFixed(2)} s, ${st.n}점</dd>
         <dt>Δx</dt><dd>${st.dx.toFixed(3)} m</dd>
         <dt>평균 속도 Δx/Δt</dt><dd>${st.vAvg.toFixed(3)} m/s</dd>
         <dt>가속도: x–t 2차 맞춤 (x = x₀ + v₀t + ½at²)</dt><dd>${st.aQuad === null ? '—' : `${st.aQuad.toFixed(3)} m/s²`}</dd>
         <dt>가속도: v–t 기울기</dt><dd>${st.aFit === null ? '—' : `${st.aFit.toFixed(3)} m/s²`}</dd>
         <dt>a 평균</dt><dd>${st.aMean === null ? '—' : `${st.aMean.toFixed(3)} m/s²`}</dd>`
      : '<dt>구간 A–B</dt><dd>기록이 없습니다</dd>';
  }
}

/** 두 값의 차이 (%) */
function pct(a: number, b: number): string {
  return `${(((a - b) / b) * 100).toFixed(1)} % 차이`;
}

function fmt(x: number | null): string {
  return x === null ? '—' : x.toFixed(3);
}

function fmt2(x: number | null, unit = ''): string {
  return x === null ? '—' : `${x.toFixed(2)}${unit}`;
}

function niceStep(span: number): number {
  const raw = span / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function seg(id: string, onPick: (v: number) => void): void {
  for (const b of byId(id).querySelectorAll<HTMLButtonElement>('button')) b.addEventListener('click', () => onPick(Number(b.dataset.v)));
}

function pressed(id: string, value: number): void {
  for (const b of byId(id).querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.v) === value));
}
