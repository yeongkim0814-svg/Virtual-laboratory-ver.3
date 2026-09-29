/**
 * 입력 처리: 터치(태블릿) + 키보드·마우스(PC 테스트용)를 하나의 상태로 합친다.
 *
 * 태블릿 조작
 *   - 화면 왼쪽 40%: 손가락을 댄 곳에 조이스틱이 생긴다 → 이동
 *   - 나머지 영역 드래그: 시점 회전
 *   - 짧게 톡 치기(탭): 그 위치의 물체와 상호작용
 * PC 조작
 *   - WASD / 방향키: 이동,  마우스 드래그: 시점,  클릭: 상호작용,  E: 조준한 물체와 상호작용
 */

export interface InputState {
  /** 이동 입력 (-1~1). x: 오른쪽 +, y: 앞 + */
  moveX: number;
  moveY: number;
  /** 이번 프레임 동안 누적된 시점 드래그 양 (픽셀) */
  lookDX: number;
  lookDY: number;
  /** 이번 프레임에 발생한 탭 위치들 (화면 픽셀 좌표) */
  taps: { x: number; y: number }[];
  /** 이번 프레임에 E 키가 눌렸는가 */
  interactKey: boolean;
}

const JOYSTICK_ZONE = 0.4; // 화면 왼쪽 40%
const JOYSTICK_RADIUS = 60; // px
const TAP_MAX_MOVE = 10; // px — 이보다 많이 움직이면 드래그로 본다
const TAP_MAX_TIME = 300; // ms

interface Pointer {
  role: 'joystick' | 'look';
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startTime: number;
  moved: boolean;
}

export class Controls {
  readonly state: InputState = { moveX: 0, moveY: 0, lookDX: 0, lookDY: 0, taps: [], interactKey: false };

  private pointers = new Map<number, Pointer>();
  private joyX = 0;
  private joyY = 0;
  private keys = new Set<string>();
  private joyBase: HTMLElement;
  private joyKnob: HTMLElement;

  constructor(private target: HTMLElement) {
    this.joyBase = document.getElementById('joy-base')!;
    this.joyKnob = document.getElementById('joy-knob')!;

    target.addEventListener('pointerdown', (e) => this.onDown(e));
    target.addEventListener('pointermove', (e) => this.onMove(e));
    target.addEventListener('pointerup', (e) => this.onUp(e));
    target.addEventListener('pointercancel', (e) => this.onUp(e));
    target.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyE' && !e.repeat) this.state.interactKey = true;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** 매 프레임 시작 시 호출: 키보드·조이스틱을 합쳐 이동 입력을 계산 */
  poll(): void {
    const k = (code: string) => (this.keys.has(code) ? 1 : 0);
    const kx = k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft');
    const ky = k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown');
    let x = this.joyX + kx;
    let y = this.joyY + ky;
    // 대각선이 더 빨라지지 않도록 길이를 1 이하로 제한
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    this.state.moveX = x;
    this.state.moveY = y;
  }

  /** 매 프레임 끝에 호출: 한 번만 쓰는 값들을 비운다 */
  consume(): void {
    this.state.lookDX = 0;
    this.state.lookDY = 0;
    this.state.taps.length = 0;
    this.state.interactKey = false;
  }

  private onDown(e: PointerEvent): void {
    e.preventDefault();
    this.target.setPointerCapture(e.pointerId);
    const isTouch = e.pointerType !== 'mouse';
    const inJoyZone = isTouch && e.clientX < window.innerWidth * JOYSTICK_ZONE;
    // 조이스틱은 한 손가락만
    const joyTaken = [...this.pointers.values()].some((p) => p.role === 'joystick');
    const role = inJoyZone && !joyTaken ? 'joystick' : 'look';
    this.pointers.set(e.pointerId, {
      role, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY,
      startTime: performance.now(), moved: false,
    });
    if (role === 'joystick') {
      this.joyBase.style.left = `${e.clientX}px`;
      this.joyBase.style.top = `${e.clientY}px`;
      this.joyBase.classList.add('active');
      this.setKnob(0, 0);
    }
  }

  private onMove(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > TAP_MAX_MOVE) p.moved = true;

    if (p.role === 'joystick') {
      let dx = e.clientX - p.startX;
      let dy = e.clientY - p.startY;
      const len = Math.hypot(dx, dy);
      if (len > JOYSTICK_RADIUS) {
        dx *= JOYSTICK_RADIUS / len;
        dy *= JOYSTICK_RADIUS / len;
      }
      this.joyX = dx / JOYSTICK_RADIUS;
      this.joyY = -dy / JOYSTICK_RADIUS; // 화면 위쪽(−y)으로 밀면 앞으로
      this.setKnob(dx, dy);
    } else {
      this.state.lookDX += e.clientX - p.lastX;
      this.state.lookDY += e.clientY - p.lastY;
    }
    p.lastX = e.clientX;
    p.lastY = e.clientY;
  }

  private onUp(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (p.role === 'joystick') {
      this.joyX = this.joyY = 0;
      this.joyBase.classList.remove('active');
    } else if (e.type === 'pointerup' && !p.moved && performance.now() - p.startTime < TAP_MAX_TIME) {
      this.state.taps.push({ x: e.clientX, y: e.clientY });
    }
  }

  private setKnob(dx: number, dy: number): void {
    this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }
}
