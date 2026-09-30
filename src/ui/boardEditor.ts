/**
 * 칠판 쓰기 화면: 칠판을 정면으로 크게 보여 주고 손가락(펜)으로 쓴다.
 *  - 칠판이 매우 가로로 길어서(약 4.5 : 1) 절반씩 보며 쓰는 "보기" 선택 (왼쪽 · 가운데 · 오른쪽 · 전체)
 *  - 도구: 흰 분필 · 노란 분필 · 지우개, 전체 지우기
 *  - 쓰는 동안은 이 화면에만 미리 그리고, 손을 떼면 획 하나를 명령(call addStroke)으로 칠판에 보낸다
 */
import { bus } from '../net/commands';
import type { Chalkboard } from '../world/chalkboard';

const SIZE: Record<string, number> = { white: 0.012, yellow: 0.012, erase: 0.09 };
const PREVIEW: Record<string, string> = { white: '#ece9da', yellow: '#f2d65a', erase: 'rgba(31,53,39,0.9)' };
const VIEWS: Record<string, [number, number]> = { left: [0, 0.5], mid: [0.25, 0.75], right: [0.5, 1], all: [0, 1] };

export class BoardEditor {
  readonly el = byId('board-ed');
  private cv = byId<HTMLCanvasElement>('be-canvas');
  private g = this.cv.getContext('2d')!;
  private board: Chalkboard | null = null;
  private tool = 'white';
  private view: [number, number] = VIEWS.left;
  private shown = -1;
  private stroke: number[] | null = null;

  constructor(private onToggle: (open: boolean) => void) {
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
      b.addEventListener('click', () => { this.tool = b.dataset.tool!; this.refreshButtons(); });
    }
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-view]')) {
      b.addEventListener('click', () => { this.view = VIEWS[b.dataset.view!]; this.refreshButtons(); this.fit(); });
    }
    byId('be-clear').addEventListener('click', () => { if (this.board) bus.call(this.board, 'clearAll'); this.redraw(); });
    byId('be-close').addEventListener('click', () => this.close());
    this.cv.addEventListener('pointerdown', (e) => this.down(e));
    this.cv.addEventListener('pointermove', (e) => this.move(e));
    this.cv.addEventListener('pointerup', () => this.up());
    this.cv.addEventListener('pointercancel', () => this.up());
    window.addEventListener('resize', () => this.isOpen && this.fit());
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(board: Chalkboard, tool: string): void {
    this.board = board;
    this.tool = tool;
    this.el.hidden = false;
    this.onToggle(true);
    this.refreshButtons();
    this.fit();
  }

  close(): void {
    this.up();
    this.el.hidden = true;
    this.board = null;
    this.onToggle(false);
  }

  /** 매 프레임: 칠판이 바뀌었으면 (다른 사람의 획 등) 다시 그림 */
  update(): void {
    if (this.board && !this.stroke && this.board.version !== this.shown) this.redraw();
  }

  /** 보기 영역의 비율에 맞게 캔버스 크기 정하기 */
  private fit(): void {
    const b = this.board;
    if (!b) return;
    const wrap = byId('be-wrap');
    const aspect = (b.width * (this.view[1] - this.view[0])) / b.height;
    const W = wrap.clientWidth - 40; // 여백 10 px × 2 + 칠판 테두리 10 px × 2
    const H = wrap.clientHeight - 40;
    const w = Math.min(W, H * aspect);
    this.cv.style.width = `${w}px`;
    this.cv.style.height = `${w / aspect}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round((w / aspect) * dpr);
    this.redraw();
  }

  private redraw(): void {
    const b = this.board;
    if (!b) return;
    const src = b.canvas;
    const [u0, u1] = this.view;
    this.g.imageSmoothingEnabled = true;
    this.g.drawImage(src, u0 * src.width, 0, (u1 - u0) * src.width, src.height, 0, 0, this.cv.width, this.cv.height);
    this.shown = b.version;
  }

  private refreshButtons(): void {
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === this.tool));
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-view]')) b.setAttribute('aria-pressed', String(VIEWS[b.dataset.view!] === this.view));
  }

  /** 화면 좌표 → 칠판 비율 좌표 */
  private uv(e: PointerEvent): [number, number] {
    const r = this.cv.getBoundingClientRect();
    const [u0, u1] = this.view;
    return [u0 + ((e.clientX - r.left) / r.width) * (u1 - u0), (e.clientY - r.top) / r.height];
  }

  private down(e: PointerEvent): void {
    if (!this.board) return;
    e.preventDefault();
    this.cv.setPointerCapture(e.pointerId);
    const [u, v] = this.uv(e);
    this.stroke = [u, v];
    this.previewTo(u, v);
  }

  private move(e: PointerEvent): void {
    const s = this.stroke;
    if (!s) return;
    const [u, v] = this.uv(e);
    // 너무 촘촘한 점은 버린다 (명령이 가벼워지도록): 칠판 높이의 0.3 %
    const du = (u - s[s.length - 2]) * (this.board!.width / this.board!.height);
    const dv = v - s[s.length - 1];
    if (du * du + dv * dv < 0.003 ** 2) return;
    this.previewTo(u, v);
    s.push(u, v);
  }

  private up(): void {
    const s = this.stroke;
    this.stroke = null;
    if (!s || !this.board) return;
    bus.call(this.board, 'addStroke', this.tool, SIZE[this.tool], s.map((x) => Math.round(x * 1e4) / 1e4));
    this.redraw();
  }

  /** 쓰는 중: 이 화면에만 미리 그림 */
  private previewTo(u: number, v: number): void {
    const s = this.stroke!;
    const [u0, u1] = this.view;
    const X = (x: number) => ((x - u0) / (u1 - u0)) * this.cv.width;
    const Y = (y: number) => y * this.cv.height;
    const g = this.g;
    g.save();
    g.lineCap = g.lineJoin = 'round';
    g.strokeStyle = PREVIEW[this.tool];
    g.lineWidth = Math.max(1, SIZE[this.tool] * this.cv.height);
    g.beginPath();
    const n = s.length;
    g.moveTo(X(s[n - 2]), Y(s[n - 1]));
    g.lineTo(X(u) + (n === 2 ? 0.1 : 0), Y(v));
    g.stroke();
    g.restore();
  }
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
