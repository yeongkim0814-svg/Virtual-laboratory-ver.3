/**
 * 회전 막대: 기구를 세로축 둘레로 1° 단위로 돌린다.
 *  - 슬라이더: 15°의 배수에서 ±2° 안이면 그 배수로 붙는다 (0°, 15°, 30° … 를 맞추기 쉽게)
 *  - ±1° 버튼: 붙지 않고 정확히 1°씩 (미세 조정)
 *  - ±15° 버튼: 15°씩
 */
import type { Item } from '../world/items';

/** 15°의 배수에서 ±2° 안이면 그 배수로 */
export function snapAngle(deg: number): number {
  const r = Math.round(deg / 15) * 15;
  return Math.abs(deg - r) <= 2 ? r : deg;
}

const norm = (d: number) => ((Math.round(d) % 360) + 360) % 360;

export class RotateBar {
  private el = document.getElementById('rotate-bar')!;
  private slider = document.getElementById('rb-slider') as HTMLInputElement;
  private target: Item | null = null;

  constructor() {
    this.slider.addEventListener('input', () => this.set(snapAngle(Number(this.slider.value))));
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('button[data-d]')) {
      b.addEventListener('click', () => this.target && this.set(this.target.yawDeg + Number(b.dataset.d)));
    }
    document.getElementById('rb-done')!.addEventListener('click', () => this.close());
  }

  open(item: Item): void {
    this.target = item;
    document.getElementById('rb-name')!.textContent = item.name;
    this.el.hidden = false;
    this.refresh();
  }

  close(): void {
    this.el.hidden = true;
    this.target = null;
  }

  private set(deg: number): void {
    this.target?.setYawDeg(norm(deg));
    this.refresh();
  }

  private refresh(): void {
    if (!this.target) return;
    const d = this.target.yawDeg;
    this.slider.value = String(d);
    document.getElementById('rb-val')!.textContent = `${d}°`;
  }

  /** 대상이 손에 들리는 등 돌릴 수 없게 되면 닫는다 */
  update(): void {
    if (this.target && !this.target.rotateAction().length) this.close();
  }
}
