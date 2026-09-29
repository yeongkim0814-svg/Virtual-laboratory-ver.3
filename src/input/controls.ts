/**
 * 입력 처리: 터치(태블릿) + 키보드·마우스(PC 테스트용)를 하나의 상태로 합친다.
 *
 * 태블릿 조작
 *   - 화면(16:9 무대) 왼쪽 40%: 손가락을 댄 곳에 조이스틱이 생긴다 → 이동
 *   - 나머지 영역 드래그: 시점 회전
 *   - 짧게 톡 치기(탭, 화면 어디든): 그 위치의 물체 집기 / 면에 놓기 / 문 열기
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
  /** 이번 프레임에 발생한 탭 위치들 (16:9 무대 기준 픽셀 좌표) */
  taps: { x: number; y: number }[];
  /** 이번 프레임에 "길게 누르기"가 확정된 위치들 */
  holds: { x: number; y: number }[];
  /** 이번 프레임에 E 키가 눌렸는가 */
  interactKey: boolean;
}

const JOYSTICK_ZONE = 0.4; // 화면 왼쪽 40%
const JOYSTICK_RADIUS = 60; // px
const TAP_MAX_MOVE = 10; // px — 이보다 많이 움직이면 드래그로 본다
const TAP_MAX_TIME = 300; // ms
const HOLD_TIME = 500; // ms — 움직이지 않고 이만큼 누르고 있으면 "길게 누르기"

interface Pointer {
  role: 'joystick' | 'look';
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startTime: number;
  moved: boolean;
  held: boolean; // 길게 누르기로 이미 처리됨
}

export class Controls {
  readonly state: InputState = { moveX: 0, moveY: 0, lookDX: 0, lookDY: 0, taps: [], holds: [], interactKey: false };

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
    // 길게 누르기: 움직이지 않은 채 HOLD_TIME이 지난 손가락
    const now = performance.now();
    for (const p of this.pointers.values()) {
      // (조이스틱에 엄지를 가만히 대고 있는 건 길게 누르기가 아님)
      if (p.role === 'look' && !p.held && !p.moved && now - p.startTime >= HOLD_TIME) {
        p.held = true;
        this.state.holds.push({ x: p.startX, y: p.startY });
      }
    }
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
    this.state.holds.length = 0;
    this.state.interactKey = false;
  }

  /** 브라우저 창 좌표 → 무대(캔버스) 안쪽 좌표. 16:9 레터박스 때문에 둘이 다르다. */
  private local(e: PointerEvent): { x: number; y: number } {
    const r = this.target.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown(e: PointerEvent): void {
    e.preventDefault();
    this.target.setPointerCapture(e.pointerId);
    const { x, y } = this.local(e);
    const isTouch = e.pointerType !== 'mouse';
    const inJoyZone = isTouch && x < this.target.clientWidth * JOYSTICK_ZONE;
    // 조이스틱은 한 손가락만
    const joyTaken = [...this.pointers.values()].some((p) => p.role === 'joystick');
    const role = inJoyZone && !joyTaken ? 'joystick' : 'look';
    this.pointers.set(e.pointerId, {
      role, startX: x, startY: y, lastX: x, lastY: y,
      startTime: performance.now(), moved: false, held: false,
    });
    if (role === 'joystick') {
      this.joyBase.style.left = `${x}px`;
      this.joyBase.style.top = `${y}px`;
      this.joyBase.classList.add('active');
      this.setKnob(0, 0);
    }
  }

  private onMove(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const { x, y } = this.local(e);
    if (Math.hypot(x - p.startX, y - p.startY) > TAP_MAX_MOVE) p.moved = true;

    if (p.role === 'joystick') {
      let dx = x - p.startX;
      let dy = y - p.startY;
      const len = Math.hypot(dx, dy);
      if (len > JOYSTICK_RADIUS) {
        dx *= JOYSTICK_RADIUS / len;
        dy *= JOYSTICK_RADIUS / len;
      }
      this.joyX = dx / JOYSTICK_RADIUS;
      this.joyY = -dy / JOYSTICK_RADIUS; // 화면 위쪽(−y)으로 밀면 앞으로
      this.setKnob(dx, dy);
    } else {
      this.state.lookDX += x - p.lastX;
      this.state.lookDY += y - p.lastY;
    }
    p.lastX = x;
    p.lastY = y;
  }

  private onUp(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (p.role === 'joystick') {
      this.joyX = this.joyY = 0;
      this.joyBase.classList.remove('active');
    }
    // 거의 움직이지 않고 짧게 뗐으면 탭 (조이스틱 영역에서도 — 화면 왼쪽의 물체도 탭할 수 있게)
    if (e.type === 'pointerup' && !p.moved && !p.held && performance.now() - p.startTime < TAP_MAX_TIME) {
      this.state.taps.push(this.local(e));
    }
  }

  private setKnob(dx: number, dy: number): void {
    this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }
}
