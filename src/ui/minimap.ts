/** 오른쪽 위 미니맵: 도면(layout.ts) + 가구 + 물체 + 문 + 내 위치와 시선 방향 */
import { Scene } from 'three';
import { FURNITURE, MAIN_ROOM, PREP_ROOM, ROOMS, WALLS } from '../world/layout';
import type { Door } from '../world/door';
import type { Player } from '../player/player';
import type { Item } from '../world/items';

const PAD = 0.4; // 도면 바깥 여백 (m)

export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private scale = 1; // px per m

  constructor(private canvas: HTMLCanvasElement, private player: Player, private door: Door, private items: Item[]) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resize(): void {
    const worldW = PREP_ROOM.x2 - MAIN_ROOM.x1 + 2 * PAD;
    const worldD = MAIN_ROOM.z2 - MAIN_ROOM.z1 + 2 * PAD;
    const cssW = this.canvas.clientWidth;
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.style.height = `${(cssW * worldD) / worldW}px`;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(((cssW * worldD) / worldW) * dpr);
    this.scale = this.canvas.width / worldW;
  }

  private tx = (x: number) => (x - MAIN_ROOM.x1 + PAD) * this.scale;
  private tz = (z: number) => (z - MAIN_ROOM.z1 + PAD) * this.scale;

  draw(): void {
    // HUD가 숨겨져 있던 동안에는 폭이 0이므로, 보이게 된 뒤 크기를 다시 잰다
    if (this.canvas.width !== Math.round(this.canvas.clientWidth * Math.min(window.devicePixelRatio, 2))) this.resize();
    const g = this.ctx;
    const s = this.scale;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);

    g.fillStyle = 'rgba(255,255,255,0.10)';
    for (const { rect: r } of ROOMS) g.fillRect(this.tx(r.x1), this.tz(r.z1), (r.x2 - r.x1) * s, (r.z2 - r.z1) * s);

    // 가구
    g.fillStyle = 'rgba(160,170,180,0.45)';
    for (const { rect: r } of FURNITURE) g.fillRect(this.tx(r.x1), this.tz(r.z1), (r.x2 - r.x1) * s, (r.z2 - r.z1) * s);

    // 바닥이나 가구 위에 놓인 물체 (들고 있는 물체는 제외)
    g.fillStyle = '#f5b04a';
    for (const it of this.items) {
      if (!(it.object.parent instanceof Scene)) continue; // 손에 든 물체는 카메라에 붙어 있음
      g.beginPath();
      g.arc(this.tx(it.object.position.x), this.tz(it.object.position.z), Math.max(2, 0.12 * s), 0, Math.PI * 2);
      g.fill();
    }

    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (const r of WALLS) g.fillRect(this.tx(r.x1), this.tz(r.z1), (r.x2 - r.x1) * s, (r.z2 - r.z1) * s);

    // 문짝
    const d = this.door.segment();
    g.strokeStyle = '#e0a060';
    g.lineWidth = Math.max(2, 0.08 * s);
    g.beginPath();
    g.moveTo(this.tx(d.a.x), this.tz(d.a.z));
    g.lineTo(this.tx(d.b.x), this.tz(d.b.z));
    g.stroke();

    // 나: 점 + 시선 방향 부채꼴
    const px = this.tx(this.player.pos.x);
    const pz = this.tz(this.player.pos.z);
    // 화면 각도: 앞 방향 (−sin yaw, −cos yaw) → atan2(z, x)
    const ang = Math.atan2(-Math.cos(this.player.yaw), -Math.sin(this.player.yaw));
    g.fillStyle = 'rgba(90,180,255,0.35)';
    g.beginPath();
    g.moveTo(px, pz);
    g.arc(px, pz, 1.6 * s, ang - 0.5, ang + 0.5);
    g.closePath();
    g.fill();
    g.fillStyle = '#5ab4ff';
    g.beginPath();
    g.arc(px, pz, Math.max(3, 0.25 * s), 0, Math.PI * 2);
    g.fill();
  }
}
