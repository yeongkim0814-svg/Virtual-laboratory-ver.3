/**
 * 광학 패널: 광선 경로 (면마다 입사각 · 나간 각, 굴절률 계산), 프리즘 편향각, 간섭(경로차), 렌즈의 상,
 * 거울 · 반투명 거울 미세 조정 나사 (마이컬슨 간섭계)
 *
 * 각은 모두 "면의 법선"에서 잰 값. 광학 원판 위에서는 원판 눈금(1°)으로 같은 값을 직접 읽을 수 있다.
 */
import { bus } from '../net/commands';
import type { BeamSystem, LightSource, OpticEvent } from '../equipment/beams';
import type { OpticalElement } from '../equipment/opticalElements';

export class OpticsPanel {
  readonly el = byId('op-panel');
  private source: LightSource | null = null;
  private fine: OpticalElement | null = null;
  private last = 0;

  constructor(private onToggle: (open: boolean) => void, private beams: BeamSystem) {
    byId('op-close').addEventListener('click', () => this.close());
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('button[data-tilt]')) {
      b.addEventListener('click', () => this.nudge(Number(b.dataset.tilt), 0));
    }
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('button[data-shift]')) {
      b.addEventListener('click', () => this.nudge(0, Number(b.dataset.shift)));
    }
    byId<HTMLInputElement>('op-shift').addEventListener('input', (e) => {
      const f = this.fine;
      if (f) bus.call(f, 'setFine', f.fineTilt, Number((e.target as HTMLInputElement).value));
      this.refresh();
    });
    byId('op-fine-reset').addEventListener('click', () => { if (this.fine) bus.call(this.fine, 'setFine', 0, 0); this.refresh(); });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** 광원의 광선 경로 보기 */
  openSource(s: LightSource): void {
    this.source = s;
    this.fine = null;
    this.show();
  }

  /** 거울 · 반투명 거울 미세 조정 (광선 경로도 함께: 켜진 첫 광원) */
  openFine(e: OpticalElement): void {
    this.fine = e;
    this.source = [...this.beams.traces.keys()][0] ?? null;
    this.show();
  }

  private show(): void {
    this.el.hidden = false;
    this.onToggle(true);
    this.refresh();
  }

  close(): void {
    this.el.hidden = true;
    this.source = null;
    this.fine = null;
    this.onToggle(false);
  }

  private nudge(dTilt: number, dShift: number): void {
    const f = this.fine;
    if (!f) return;
    bus.call(f, 'setFine', f.fineTilt + dTilt, f.fineShift + dShift);
    this.refresh();
  }

  update(): void {
    if (!this.isOpen) return;
    const now = performance.now();
    if (now - this.last > 250) {
      this.last = now;
      this.refresh();
    }
  }

  private refresh(): void {
    // 미세 조정
    const f = this.fine;
    byId('op-fine').hidden = !f;
    if (f) {
      byId('op-fine-name').textContent = f.name;
      byId('op-tilt-val').textContent = `${f.fineTilt >= 0 ? '+' : ''}${f.fineTilt.toFixed(3)}°`;
      byId('op-shift-val').textContent = `${f.fineShift.toFixed(2)} μm`;
      const sl = byId<HTMLInputElement>('op-shift');
      if (document.activeElement !== sl) sl.value = String(f.fineShift);
    }
    // 광선 경로
    const src = this.source;
    const tr = src ? this.beams.traces.get(src) : undefined;
    byId('op-title').textContent = src ? `광선 경로 · ${src.name}` : '광학';
    byId('op-status').textContent = !src ? '켜진 광원이 없음 — 레이저나 백색 광원을 켜세요' : !tr ? '광원이 꺼져 있거나 손에 들려 있음' : '빛이 지나간 면들 (각은 법선에서 잰 값)';
    const body = byId('op-log').querySelector('tbody')!;
    body.innerHTML = '';
    const evs = tr ? pickEvents(tr.events) : [];
    if (!evs.length) body.innerHTML = '<tr><td colspan="5" class="empty">빛이 아직 광학 기구를 지나지 않았음</td></tr>';
    evs.forEach((e, i) => {
      const tr2 = document.createElement('tr');
      const nCalc = e.kind.startsWith('굴절') && e.outDeg !== null && e.outDeg > 0.05 && e.inDeg > 0.05
        ? sin(e.inDeg) / sin(e.outDeg) : null;
      const cells = [
        `${i + 1}`,
        `${e.el.replace(/ \(.*\)/, '')}${e.nm ? ` · ${e.nm} nm` : ''}`,
        e.kind.replace(' (반사 50 % + 투과 50 %)', ''),
        `${e.inDeg.toFixed(1)}° → ${e.outDeg === null ? '—' : `${e.outDeg.toFixed(1)}°`}`,
        nCalc === null ? (e.kind === '전반사' ? `임계각 ${deg(Math.asin(e.n2 / e.n1)).toFixed(1)}°` : '') : e.kind === '굴절 (들어감)' ? `n = ${nCalc.toFixed(3)}` : `n = ${(1 / nCalc).toFixed(3)}`,
      ];
      for (const c of cells) {
        const td = document.createElement('td');
        td.textContent = c;
        tr2.appendChild(td);
      }
      body.appendChild(tr2);
    });
    const lines: string[] = [];
    if (tr) {
      // 프리즘·블록을 지난 빛의 꺾인 각 (파장별)
      const ex = tr.exits.filter((x) => x.p > 0.02 || (x.nm && x.p > 0.004));
      // 백색광이 갈라졌으면 갈라진 조각만 (표면에서 되비친 흰 빛은 빼고)
      const split = ex.some((x) => x.nm > 0 && (x.nm - 400) % 15 === 0);
      const glassed = ex.filter((x) => x.dev > 0.2 && x.dev < 170 && (!split || x.nm > 0));
      if (glassed.length) {
        const byNm = new Map<number, number>();
        for (const x of glassed) if (!byNm.has(x.nm)) byNm.set(x.nm, x.dev);
        const list = [...byNm.entries()].sort((a, b) => a[0] - b[0]);
        if (list.length > 3) {
          const [nmA, dA] = list[0];
          const [nmB, dB] = list[list.length - 1];
          lines.push(`<dt>처음 방향에서 꺾인 각 (보라 ${nmA} nm · 빨강 ${nmB} nm)</dt><dd>${dA.toFixed(2)}° · ${dB.toFixed(2)}° (분산 ${(dA - dB).toFixed(2)}°)</dd>`);
        } else {
          for (const [nm, dv] of list) lines.push(`<dt>처음 방향에서 꺾인 각${nm ? ` (${nm} nm)` : ''}</dt><dd>${dv.toFixed(2)}°</dd>`);
        }
      }
      if (tr.interference) {
        const I = tr.interference;
        lines.push(`<dt>간섭 (${I.target}): 두 빛의 광경로차</dt><dd>${I.dOPL.toFixed(3)} μm = ${(I.dOPL * 1000 / I.lambda).toFixed(2)} λ</dd>`);
      }
      if (tr.image) {
        const m = tr.image;
        const sImg = Number.isFinite(m.sImg) ? `${(m.sImg * 100).toFixed(1)} cm${m.sImg < 0 ? ' (허상)' : ''}` : '∞ (물체가 초점에)';
        lines.push(`<dt>렌즈 f = ${(m.f * 100).toFixed(0)} cm: 물체 거리 s · 상 거리 s' = 1/(1/f − 1/s)</dt><dd>${(m.s * 100).toFixed(1)} cm · ${sImg}</dd>`,
          `<dt>렌즈 ~ 비친 면 거리 D, 스크린 위 배율 −D/s</dt><dd>${(m.D * 100).toFixed(1)} cm, ×${m.m.toFixed(2)} ${Number.isFinite(m.sImg) && m.sImg > 0 && Math.abs(m.D - m.sImg) < 0.01 ? '— 선명한 상!' : Number.isFinite(m.sImg) && m.sImg > 0 ? `— 스크린을 ${((m.sImg - m.D) * 100).toFixed(1)} cm 옮기면 선명` : ''}</dd>`);
      }
    }
    byId('op-sum').innerHTML = lines.join('');
  }
}

/** 표에 보일 사건: 너무 약한 갈래는 빼고, 백색광이 갈라진 조각(400 ~ 700 nm, 15 nm 간격)은 대표 파장(보라·초록·빨강)만 */
function pickEvents(evs: OpticEvent[]): OpticEvent[] {
  const keep = new Set([400, 550, 700]);
  const whitePiece = (nm: number) => nm >= 400 && nm <= 700 && (nm - 400) % 15 === 0;
  return evs
    .filter((e) => !(e.nm && whitePiece(e.nm) && !keep.has(e.nm)))
    .filter((e) => e.p >= 0.02 || (e.nm !== 0 && e.p > 0.004))
    .slice(0, 40);
}

const sin = (d: number) => Math.sin((d * Math.PI) / 180);
const deg = (r: number) => (r * 180) / Math.PI;

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
