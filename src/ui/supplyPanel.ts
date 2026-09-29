/**
 * 직류 전원 장치 패널: 켜기·끄기, 극성, 전압(0 ~ 5 V, 0.01 V 단위)
 * 광전 효과뿐 아니라 어떤 회로 실험에서든 쓰는 범용 조절 패널.
 * (광전관이 회로에 있으면 "광전 효과 실험" 패널이 측정 기능까지 함께 보여 준다)
 */
import { bus } from '../net/commands';
import type { DCPowerSupply } from '../equipment/electrical';

export class SupplyPanel {
  readonly el = byId('sup-panel');
  target: DCPowerSupply | null = null;
  private last = 0;

  constructor(private onToggle: (open: boolean) => void) {
    const slider = byId<HTMLInputElement>('sup-v');
    slider.addEventListener('input', () => this.setVoltage(Number(slider.value)));
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('button[data-dv]')) {
      b.addEventListener('click', () => this.target && this.setVoltage(this.target.voltage + Number(b.dataset.dv)));
    }
    for (const b of byId('sup-pol').querySelectorAll<HTMLButtonElement>('button')) {
      b.addEventListener('click', () => { if (this.target) bus.set(this.target, 'reversed', b.dataset.v === 'rev'); this.refresh(); });
    }
    byId('sup-power').addEventListener('click', () => {
      const t = this.target;
      if (t?.port) bus.set(t, 'on', !t.on);
      this.refresh();
    });
    byId('sup-close').addEventListener('click', () => this.close());
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(target: DCPowerSupply): void {
    this.target = target;
    this.el.hidden = false;
    this.refresh();
    this.onToggle(true);
  }

  close(): void {
    this.el.hidden = true;
    this.target = null;
    this.onToggle(false);
  }

  private setVoltage(v: number): void {
    if (!this.target) return;
    bus.set(this.target, 'voltage', Math.min(5, Math.max(0, Math.round(v * 100) / 100)));
    this.refresh();
  }

  update(): void {
    if (!this.isOpen) return;
    const now = performance.now();
    if (now - this.last > 150) {
      this.last = now;
      this.refresh();
    }
  }

  private refresh(): void {
    const t = this.target;
    if (!t) return;
    byId('sup-status').textContent = !t.port ? '콘센트에 꽂혀 있지 않습니다 — 기기를 두 번 탭해 "전원 연결"' : t.on ? '켜져 있음' : '꺼져 있음';
    byId('sup-power').textContent = !t.port ? '콘센트에 꽂혀 있지 않음' : t.on ? '끄기' : '켜기';
    byId<HTMLButtonElement>('sup-power').disabled = !t.port;
    for (const b of byId('sup-pol').querySelectorAll<HTMLButtonElement>('button')) {
      b.setAttribute('aria-pressed', String((b.dataset.v === 'rev') === t.reversed));
    }
    const slider = byId<HTMLInputElement>('sup-v');
    if (document.activeElement !== slider) slider.value = String(t.voltage);
    byId('sup-v-val').textContent = `${t.voltage.toFixed(2)} V`;
    byId('sup-out').textContent = `${t.output.toFixed(2)} V`;
    byId('sup-wires').textContent = `+ ${t.plus.wires.length}개 · − ${t.minus.wires.length}개`;
  }
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
