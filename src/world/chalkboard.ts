/**
 * 칠판 (직접 쓰기) + 분필 · 지우개
 *
 * 칠판 면은 캔버스 하나를 텍스처로 쓴다. 쓰기는 "획(stroke)" 단위:
 *   분필을 든 채 칠판을 탭 → 쓰기 화면(ui/boardEditor.ts)에서 손가락으로 쓴다 →
 *   손을 뗄 때마다 명령 call(board, 'addStroke', 색, 굵기, [x0, y0, x1, y1, …])로 칠판에 그린다.
 *   좌표는 칠판 폭·높이에 대한 비율(0 ~ 1)이라 해상도와 무관하고, 명령으로 그대로 보낼 수 있다 (멀티플레이어 대비).
 * 지우개 = 칠판 바탕색을 반투명으로 굵게 칠한다 → 완전히 지워지지 않고 옅은 자국이 남는다 (진짜 칠판처럼).
 */
import * as THREE from 'three';
import { Item } from './items';
import type { Action, Interactable } from './interactable';

const BG = '#1f3527';
export const CHALK_COLORS: Record<string, string> = { white: '#ece9da', yellow: '#f2d65a' };
/** 캔버스 가로 해상도 (px). 세로는 칠판 비율대로 */
const RES = 1600;

export class Chalkboard implements Interactable {
  readonly object: THREE.Mesh;
  readonly canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  /** 획이 더해질 때마다 1씩 → 쓰기 화면이 다시 그릴 때를 안다 */
  version = 0;
  getHeld: () => Item | null = () => null;
  onWrite: (b: Chalkboard, tool: string) => void = () => {};

  constructor(readonly width: number, readonly height: number) {
    this.canvas.width = RES;
    this.canvas.height = Math.round((RES * height) / width);
    this.g = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.object = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshLambertMaterial({ map: this.tex }));
    this.object.name = '칠판';
    this.object.userData.interactable = this;
    this.blank();
    this.writeIntro();
    document.fonts?.load('30px Galmuri11').then(() => { if (this.version === 0) { this.blank(); this.writeIntro(); } }, () => {});
  }

  get name(): string {
    return '칠판';
  }

  private blank(): void {
    this.g.fillStyle = BG;
    this.g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.tex.needsUpdate = true;
  }

  /** 처음 칠판에 적혀 있는 글 */
  private writeIntro(): void {
    const g = this.g;
    const k = RES / 320; // 320 px 칠판 기준 좌표를 키움 — 글씨는 왼쪽 위 구석에 작게 (나머지는 직접 쓰는 자리)
    g.fillStyle = 'rgba(150,170,150,0.06)'; // 지운 자국
    g.fillRect(120 * k, 6 * k, 70 * k, 16 * k);
    g.fillStyle = '#e6e4d6';
    g.font = `${6 * k}px Galmuri11, monospace`;
    g.fillText('가상 실험실', 8 * k, 11 * k);
    g.fillText('단진자의 주기  T = 2π√(L/g)', 8 * k, 20 * k);
    g.fillStyle = '#a9ad9e';
    g.fillText('sin θ ≈ θ 는 어디까지 맞을까?', 8 * k, 29 * k);
    this.tex.needsUpdate = true;
  }

  /**
   * 획 하나 그리기 (명령 call로 불린다)
   * @param tool 'white' · 'yellow' (분필) 또는 'erase' (지우개)
   * @param size 굵기: 칠판 높이에 대한 비율
   * @param pts [x0, y0, x1, y1, …] — 칠판 폭·높이 비율 (0 ~ 1)
   */
  addStroke(tool: string, size: number, pts: number[]): void {
    if (pts.length < 2) return;
    const g = this.g;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const erase = tool === 'erase';
    g.save();
    g.lineCap = g.lineJoin = 'round';
    g.lineWidth = Math.max(1, size * H);
    g.strokeStyle = erase ? 'rgba(31,53,39,0.88)' : (CHALK_COLORS[tool] ?? CHALK_COLORS.white);
    g.globalAlpha = erase ? 1 : 0.92;
    g.beginPath();
    g.moveTo(pts[0] * W, pts[1] * H);
    if (pts.length === 2) g.lineTo(pts[0] * W + 0.1, pts[1] * H); // 점 하나
    for (let i = 2; i + 1 < pts.length; i += 2) g.lineTo(pts[i] * W, pts[i + 1] * H);
    g.stroke();
    g.restore();
    this.tex.needsUpdate = true;
    this.version++;
  }

  /** 칠판 전체 지우기 (지우개로 싹 닦은 것처럼 옅은 자국만) */
  clearAll(): void {
    this.blank();
    this.g.fillStyle = 'rgba(150,170,150,0.05)';
    for (let i = 0; i < 6; i++) this.g.fillRect(((i * 0.17 + 0.02) % 1) * this.canvas.width, 0, this.canvas.width * 0.12, this.canvas.height);
    this.tex.needsUpdate = true;
    this.version++;
  }

  actions(): Action[] {
    const h = this.getHeld();
    if (h instanceof Chalk) return [{ label: `칠판에 쓰기 (${h.name})`, local: true, run: () => this.onWrite(this, h.color) }];
    if (h instanceof BoardEraser) {
      return [
        { label: '칠판 지우기 (문질러 지우기)', local: true, run: () => this.onWrite(this, 'erase') },
        { label: '칠판 전체 지우기', secondary: true, run: () => this.clearAll() },
      ];
    }
    return [];
  }
}

/** 분필: 칠판 받침에 놓여 있다. 들고 칠판을 탭하면 쓰기 */
export class Chalk extends Item {
  constructor(readonly color: 'white' | 'yellow') {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.08, 6).rotateZ(Math.PI / 2), new THREE.MeshLambertMaterial({ color: CHALK_COLORS[color] }));
    m.position.y = 0.0055;
    g.add(m);
    super(g, { name: color === 'white' ? '흰 분필' : '노란 분필', radius: 0.04, mass: 0.01 });
  }
}

/** 칠판 지우개: 펠트 + 나무 손잡이 */
export class BoardEraser extends Item {
  constructor() {
    const g = new THREE.Group();
    const felt = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.05), new THREE.MeshLambertMaterial({ color: 0x3a3f46 }));
    felt.position.y = 0.006;
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.022, 0.05), new THREE.MeshLambertMaterial({ color: 0xb08a58 }));
    top.position.y = 0.023;
    g.add(felt, top);
    super(g, { name: '칠판 지우개', radius: 0.06, mass: 0.08 });
  }
}
