/**
 * 궤도 실험 패널: 레일 기울기 · 구름 저항 · 재생 속도, 수레마다 범퍼 · 미는 속력 · 밀기
 * 측정값(속도·가속도·운동량)은 일부러 보여 주지 않는다 — 나중에 센서로 잰다.
 */
import type { Cart, Rail } from '../equipment/track';
import { BUMPER_NAME, type Bumper } from '../sim/track';
import { G } from '../sim/pendulum';
import { Pulley } from '../equipment/track';

export class TrackPanel {
  readonly el = byId('track-panel');
  target: Rail | null = null;
  private cartKey = '';
  private last = 0;
  /** "처음 자리로": 마지막으로 밀기 직전의 위치 */
  private starts = new Map<Cart, number>();

  constructor(private onToggle: (open: boolean) => void) {
    const inc = byId<HTMLInputElement>('tr-inc');
    inc.addEventListener('input', () => { this.target?.setIncline(Number(inc.value)); this.refresh(); });
    for (const b of byId('tr-fric').querySelectorAll<HTMLButtonElement>('button')) {
      b.addEventListener('click', () => { if (this.target) this.target.sim.friction = Number(b.dataset.v); this.refresh(); });
    }
    for (const b of byId('tr-speed').querySelectorAll<HTMLButtonElement>('button')) {
      b.addEventListener('click', () => { if (this.target) this.target.speed = Number(b.dataset.v); this.refresh(); });
    }
    byId('tr-stop').addEventListener('click', () => this.target?.stopAll());
    byId('tr-reset').addEventListener('click', () => {
      const r = this.target;
      if (!r) return;
      for (const c of r.carts) {
        const s = this.starts.get(c);
        if (s !== undefined) r.place(c, s);
      }
      r.stopAll();
    });
    byId('tr-close').addEventListener('click', () => this.close());
    byId('tr-release').addEventListener('click', () => { this.remember(); this.target?.release(); this.refresh(); });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(target: Rail): void {
    this.target = target;
    this.cartKey = '';
    this.el.hidden = false;
    this.refresh();
    this.onToggle(true);
  }

  close(): void {
    this.el.hidden = true;
    this.target = null;
    this.onToggle(false);
  }

  /** 밀기 전에 모든 수레의 위치를 "처음 자리"로 기억 */
  private remember(): void {
    const r = this.target;
    if (!r) return;
    for (const c of r.carts) {
      const b = r.bodyOf(c);
      if (b) this.starts.set(c, b.s);
    }
  }

  update(): void {
    if (!this.isOpen || !this.target) return;
    const now = performance.now();
    if (now - this.last > 200) {
      this.last = now;
      this.refresh();
    }
  }

  private refresh(): void {
    const r = this.target;
    if (!r) return;
    const carts = r.carts;
    byId('tr-status').textContent = r.object.parent?.type !== 'Scene'
      ? '레일을 들고 있습니다 — 내려놓으세요'
      : carts.length ? `수레 ${carts.length}대 · 수레를 두 번 탭해도 밀 수 있습니다` : '레일에 수레가 없습니다 — 수레를 들고 레일을 두 번 탭';
    const inc = byId<HTMLInputElement>('tr-inc');
    if (document.activeElement !== inc) inc.value = String(r.inclineDeg);
    byId('tr-inc-val').textContent = `${r.inclineDeg.toFixed(1)}° (끝 높이 ${(120 * Math.sin(r.sim.incline)).toFixed(1)} cm)`;
    pressed('tr-fric', String(r.sim.friction));
    pressed('tr-speed', String(r.speed));

    // 도르래 + 추
    const li = r.loadInfo();
    byId('tr-pulley').hidden = !li;
    if (li) {
      const { m, M } = li;
      const th = r.sim.incline;
      const aIdeal = (m * G) / (M + m);
      const drive = li.dir * m * G - M * G * Math.sin(th);
      const resist = r.sim.friction * M * G * Math.cos(th) + Pulley.FRICTION;
      const aCorr = Math.abs(drive) > resist ? (drive - Math.sign(drive) * resist) / (M + m + Pulley.INERTIA) : 0;
      byId('tr-pl-mm').textContent = `${(m * 1000).toFixed(0)} g · ${li.cart.name} ${(M * 1000).toFixed(0)} g`;
      byId('tr-pl-ai').textContent = `${aIdeal.toFixed(3)} m/s²`;
      byId('tr-pl-ac').textContent = `${Math.abs(aCorr).toFixed(3)} m/s² (${(((Math.abs(aCorr) - aIdeal) / aIdeal) * 100).toFixed(1)} %)`;
      byId('tr-pl-t').textContent = `${(M * aIdeal).toFixed(3)} N  (추 무게 mg = ${(m * G).toFixed(3)} N)`;
      byId<HTMLButtonElement>('tr-release').disabled = !r.holding;
      byId('tr-release').textContent = r.holding ? '수레 놓기' : '움직이는 중 (처음 자리로 → 다시 잡힘)';
    }
    // 수레 목록이 바뀌면 줄을 다시 만든다
    const key = carts.map((c) => `${c.name}:${c.bumper}:${c.totalMass}`).join('|');
    if (key !== this.cartKey) {
      this.cartKey = key;
      this.buildRows(carts);
    }
  }

  private buildRows(carts: Cart[]): void {
    const box = byId('tr-carts');
    box.innerHTML = '';
    for (const c of carts) {
      const row = document.createElement('div');
      row.className = 'cart-row';
      row.innerHTML = `
        <h3>${c.name} · ${(c.totalMass * 1000).toFixed(0)} g</h3>
        <div class="segmented bumpers">${(Object.keys(BUMPER_NAME) as Bumper[])
          .map((b) => `<button data-b="${b}" aria-pressed="${b === c.bumper}">${BUMPER_NAME[b].split(' ')[0]}</button>`).join('')}</div>
        <label>미는 속력 <span class="val">${c.pushSpeed.toFixed(2)} m/s</span>
          <input type="range" min="0.05" max="1" step="0.05" value="${c.pushSpeed}" />
        </label>
        <div class="segmented">
          <button data-d="-1">← 밀기</button><button data-d="0">멈추기</button><button data-d="1">밀기 →</button>
        </div>`;
      for (const b of row.querySelectorAll<HTMLButtonElement>('button[data-b]')) {
        b.addEventListener('click', () => { c.setBumper(b.dataset.b as Bumper); this.refresh(); });
      }
      const slider = row.querySelector<HTMLInputElement>('input')!;
      slider.addEventListener('input', () => {
        c.pushSpeed = Number(slider.value);
        row.querySelector('.val')!.textContent = `${c.pushSpeed.toFixed(2)} m/s`;
      });
      for (const b of row.querySelectorAll<HTMLButtonElement>('button[data-d]')) {
        b.addEventListener('click', () => {
          const d = Number(b.dataset.d);
          if (d !== 0) this.remember();
          this.target?.push(c, d * c.pushSpeed);
        });
      }
      box.appendChild(row);
    }
  }
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function pressed(id: string, value: string): void {
  for (const b of byId(id).querySelectorAll<HTMLButtonElement>('button')) {
    b.setAttribute('aria-pressed', String(Number(b.dataset.v) === Number(value)));
  }
}
