/**
 * 따르기 막대: 옮길 부피를 슬라이더로 고른다.
 * 한 칸 = 두 그릇 중 더 정밀한 쪽의 눈금 단위 (눈금실린더 0.5 mL, 뷰렛 0.05 mL, 비커 5 mL …)
 * 최대 = min(따르는 그릇에 든 양, 받는 그릇의 남은 자리)
 */
import type { Container } from '../equipment/glassware';

export class PourBar {
  private el = byId('pour-bar');
  private slider = byId<HTMLInputElement>('pb-slider');
  private step = 1; // mL
  private max = 0; // 칸 수
  private onOk: ((mL: number) => void) | null = null;

  constructor() {
    this.slider.addEventListener('input', () => this.show());
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('button[data-k]')) {
      b.addEventListener('click', () => {
        this.slider.value = String(Math.min(this.max, Math.max(0, Number(this.slider.value) + Number(b.dataset.k))));
        this.show();
      });
    }
    byId('pb-ok').addEventListener('click', () => {
      const mL = Number(this.slider.value) * this.step;
      const f = this.onOk;
      this.close();
      if (f && mL > 0) f(mL);
    });
    byId('pb-cancel').addEventListener('click', () => this.close());
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** src → dst로 따르기 창을 연다. 확인하면 onOk(부피 mL) */
  open(src: Container, dst: Container, label: string, onOk: (mL: number) => void): void {
    this.step = Math.min(src.precision, dst.precision);
    const maxML = Math.min(src.volume, dst.free);
    this.max = Math.floor(maxML / this.step + 1e-6);
    this.slider.max = String(this.max);
    this.slider.value = String(Math.min(this.max, Math.round(10 / this.step)));
    this.onOk = onOk;
    byId('pb-name').textContent = label;
    this.el.hidden = false;
    this.show();
  }

  close(): void {
    this.el.hidden = true;
    this.onOk = null;
  }

  private show(): void {
    const mL = Number(this.slider.value) * this.step;
    const digits = this.step < 0.1 ? 2 : this.step < 1 ? 1 : 0;
    byId('pb-val').textContent = `${mL.toFixed(digits)} mL`;
  }
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
