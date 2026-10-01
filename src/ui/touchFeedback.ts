/**
 * 터치 피드백: 탭 물결 · 두 번 탭 겹고리 · 길게 누르기 진행 고리 · 결과(거부) 붉은 고리 · 진동.
 * 한 번 탭은 0.3 s 뒤에, 길게 누르기는 HOLD_TIME 뒤에 실행되므로 "닿았다"는 반응을 바로 보여 준다.
 * DOM만 쓴다 (Three 객체·점광원 없음). 놀고 있을 때는 아무것도 하지 않는다.
 */
import type { Settings } from './settings';

/** 진동 길이 (ms): 8~15 ms는 갤럭시 탭 진동 모터가 거의 못 낸다 → 확실히 느껴지는 25 ms 이상 */
export const HAPTIC = { press: 25, ok: 30, grab: 40, reject: [50, 60, 50] } as const;

const RING_MS = 300; // 물결이 퍼져 사라지는 시간 (style.css tap-ripple과 같게)

export class TouchFeedback {
  /** 마지막 탭 자리 (무대 안쪽 px) — 거부된 명령의 붉은 고리를 거기에 띄운다 */
  lastX = 0;
  lastY = 0;
  lastAt = -Infinity;
  private hold: HTMLElement;

  constructor(private layer: HTMLElement, private settings: Settings) {
    this.hold = document.createElement('div');
    this.hold.className = 'hold-ring';
    this.hold.innerHTML = '<svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="18" pathLength="100"/></svg>';
    layer.appendChild(this.hold);
    // 눌린 모양: :active는 pointerdown을 막은 버튼에서 안 켜질 수 있어 클래스로도 켠다
    layer.addEventListener('pointerdown', (e) => {
      const b = (e.target as HTMLElement).closest?.('button');
      if (b) this.press(b);
    });
  }

  /** 진동 (설정이 꺼져 있으면 아무것도 안 함) */
  haptic(pattern: number | number[]): void {
    if (!this.settings.haptics) return;
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* 지원하지 않는 환경 */
    }
  }

  /** 버튼 눌림: 진동 + 눌린 모양 (손가락이 떨어지면 해제) */
  press(el: HTMLElement): void {
    this.haptic(HAPTIC.press);
    el.classList.add('pressed');
    const off = () => {
      el.classList.remove('pressed');
      window.removeEventListener('pointerup', off, true);
      window.removeEventListener('pointercancel', off, true);
    };
    window.addEventListener('pointerup', off, true);
    window.addEventListener('pointercancel', off, true);
  }

  private ring(x: number, y: number, cls: string, delay = 0): void {
    if (!this.settings.touchMarks) return;
    const r = document.createElement('div');
    r.className = `tap-ripple ${cls}`;
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    if (delay) r.style.animationDelay = `${delay}ms`;
    const done = () => r.remove();
    r.addEventListener('animationend', done);
    setTimeout(done, RING_MS + delay + 60); // 애니메이션이 안 돌 때(백그라운드 탭)도 지운다
    this.layer.appendChild(r);
  }

  /** 탭이 끝났다 */
  tap(x: number, y: number): void {
    this.lastX = x;
    this.lastY = y;
    this.lastAt = performance.now();
    this.ring(x, y, '');
  }

  /** 두 번째 탭으로 판정됨 → 두 번째 고리를 80 ms 늦게 */
  double(x: number, y: number): void {
    this.ring(x, y, '', 80);
  }

  /** 내 명령이 거부됨: 마지막 탭 자리(3 s 안)에 붉은 고리 + 진동 */
  rejected(): void {
    this.haptic([...HAPTIC.reject]);
    if (performance.now() - this.lastAt < 3000) this.ring(this.lastX, this.lastY, 'bad');
  }

  /** 길게 누르는 중: 고리가 차오른다 (fillMs 동안). 이미 켜져 있으면 그대로 */
  holdStart(x: number, y: number, fillMs: number): void {
    if (!this.settings.touchMarks || this.hold.classList.contains('on')) return;
    const h = this.hold;
    h.style.left = `${x}px`;
    h.style.top = `${y}px`;
    h.style.setProperty('--fill-ms', `${fillMs}ms`);
    h.classList.remove('fire');
    h.classList.add('on');
  }

  /** 길게 누르기가 실행됨 → 한 번 맥박 */
  holdFire(): void {
    if (!this.hold.classList.contains('on')) return;
    this.hold.classList.add('fire');
    this.haptic(HAPTIC.grab);
    setTimeout(() => this.holdCancel(), 220);
  }

  /** 손가락이 움직이거나 일찍 뗌 → 고리 숨김 */
  holdCancel(): void {
    this.hold.classList.remove('on', 'fire');
  }
}
