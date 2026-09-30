/**
 * 위치·방향 막대: 책상 위 기구를 미세하게 돌리고 옮긴다 (광학 정렬용).
 *  - 회전: 슬라이더(15°의 배수 ±2° 안이면 붙음), ±15° · ±1° · ±0.1° 버튼
 *  - 이동: 화면 기준 왼쪽·오른쪽·멀리·가까이 (가까운 세계 축으로 맞춤), 1 cm / 1 mm 단위
 *  - 광학 기구: 들어오는 빛줄기와 중심의 옆 거리(mm)를 보여 주고, "빛에 맞추기"로 중심을 빛 위에 놓는다
 *    (렌즈는 광축도 빛과 나란히). 모든 조작은 명령 버스(call)로 → 되돌리기·멀티플레이어에 그대로 쓰인다
 */
import * as THREE from 'three';
import { bus } from '../net/commands';
import type { Item } from '../world/items';
import { OpticalElement, ThinLens } from '../equipment/opticalElements';
import type { BeamSystem } from '../equipment/beams';

/** 15°의 배수에서 ±2° 안이면 그 배수로 */
export function snapAngle(deg: number): number {
  const r = Math.round(deg / 15) * 15;
  return Math.abs(deg - r) <= 2 ? r : deg;
}

const norm = (d: number) => (((Math.round(d * 10) / 10) % 360) + 360) % 360;
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class PlaceBar {
  private el = byId('rotate-bar');
  private slider = byId<HTMLInputElement>('rb-slider');
  private target: Item | null = null;
  private step = 0.01;
  private blocked = 0;
  beams: BeamSystem | null = null;

  constructor(private camera: THREE.Camera) {
    this.slider.addEventListener('input', () => this.set(snapAngle(Number(this.slider.value))));
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('button[data-d]')) {
      b.addEventListener('click', () => this.target && this.set(this.target.yawDeg + Number(b.dataset.d)));
    }
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('button[data-m]')) {
      b.addEventListener('click', () => this.move(b.dataset.m!));
    }
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('button[data-step]')) {
      b.addEventListener('click', () => {
        this.step = Number(b.dataset.step);
        this.refresh();
      });
    }
    byId('rb-align').addEventListener('click', () => this.align());
    byId('rb-done').addEventListener('click', () => this.close());
  }

  open(item: Item): void {
    this.target = item;
    byId('rb-name').textContent = item.name;
    this.el.hidden = false;
    this.refresh();
  }

  close(): void {
    this.el.hidden = true;
    this.target = null;
  }

  private set(deg: number): void {
    if (this.target) bus.call(this.target, 'setYawDeg', norm(deg));
    this.refresh();
  }

  /** 화면 기준 방향 → 가장 가까운 세계 축 (책상이 축에 나란하므로 1 mm씩 옮겨도 좌표가 깔끔) */
  private move(dir: string): void {
    const t = this.target;
    if (!t) return;
    const f = new THREE.Vector3();
    this.camera.getWorldDirection(f);
    const fwd = Math.abs(f.x) > Math.abs(f.z) ? new THREE.Vector3(Math.sign(f.x), 0, 0) : new THREE.Vector3(0, 0, Math.sign(f.z));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const v = { L: right.clone().negate(), R: right, F: fwd, B: fwd.clone().negate() }[dir as 'L' | 'R' | 'F' | 'B'];
    const before = t.root().object.position.clone();
    bus.call(t, 'nudge', v.x * this.step, v.z * this.step);
    if (t.root().object.position.equals(before)) this.blocked = performance.now();
    this.refresh();
  }

  /** 대상(또는 그 조립체)의 광학 기구 — 원판을 골라도 위의 렌즈·블록을 본다 */
  private element(): OpticalElement | null {
    const t = this.target;
    if (!t) return null;
    if (t instanceof OpticalElement) return t;
    for (const it of t.root().assembly()) if (it instanceof OpticalElement) return it;
    return null;
  }

  private align(): void {
    const el = this.element();
    const b = el && this.beams?.beamOffset(el);
    if (!el || !b) return;
    if (el instanceof ThinLens) {
      // 광축(optic x)을 빛과 나란히: 앞뒤 중 가까운 쪽으로 도는 각
      const ax = el.frame().ax.setY(0).normalize();
      const d = ax.dot(b.dir) >= 0 ? b.dir : b.dir.clone().negate();
      const turn = Math.atan2(ax.z * d.x - ax.x * d.z, ax.dot(d));
      if (Math.abs(turn) > 1e-6) bus.call(el, 'turnByDeg', THREE.MathUtils.radToDeg(turn));
    }
    bus.call(el, 'nudge', b.move.x, b.move.z);
    this.refresh();
  }

  private refresh(): void {
    const t = this.target;
    if (!t) return;
    const d = t.yawDeg;
    this.slider.value = String(Math.round(d));
    byId('rb-val').textContent = `${d.toFixed(1)}°`;
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('button[data-step]')) {
      b.classList.toggle('on', Number(b.dataset.step) === this.step);
    }
    const el = this.element();
    const off = el ? this.beams?.beamOffset(el) : null;
    const info = byId('rb-beam');
    const align = byId<HTMLButtonElement>('rb-align');
    align.hidden = !el;
    align.disabled = !off;
    if (performance.now() - this.blocked < 1200) info.textContent = '받침이 없어 못 옮김';
    else if (!el) info.textContent = '';
    else if (!off) info.textContent = '빛이 5 cm 안에 없음';
    else info.textContent = `빛–중심 ${off.off >= 0 ? '+' : '−'}${Math.abs(off.off * 1000).toFixed(1)} mm`;
  }

  /** 매 프레임: 대상이 손에 들리는 등 돌릴 수 없게 되면 닫고, 빛 정보를 새로 읽는다 */
  update(): void {
    if (this.target && !this.target.rotateAction().length) this.close();
    else if (this.target) this.refresh();
  }
}
