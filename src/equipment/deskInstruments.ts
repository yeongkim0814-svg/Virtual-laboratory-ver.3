/**
 * 책상 위에 올려 두는 탁상시계 · 디지털 온습도계 (예전에는 벽에 붙은 장식)
 * 집어서 원하는 테이블에 놓는다. 표시값은 세계 상태가 아니다:
 *   시계 = 기기의 실제 시각, 온습도 = Date.now()로 정한 느린 변화(22.5 °C ± 0.3, 45 %RH ± 2, 5분 주기)
 *   → 모든 기기에서 같은 값이 보이고 명령·동기화가 필요 없다.
 * 매 초 다시 그릴 때 쓰는 값은 기구 필드가 아닌 하위 객체(sim)에 둔다 (숫자 필드는 스냅숏·digest·되돌리기에 들어감).
 */
import * as THREE from 'three';
import { Item } from '../world/items';

const CASE = new THREE.MeshLambertMaterial({ color: 0x59603f });
const TRIM = new THREE.MeshLambertMaterial({ color: 0x2a2c22 });

function canvasFace(w: number, h: number, pxW: number, pxH: number): { mesh: THREE.Mesh; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture } {
  const c = document.createElement('canvas');
  c.width = pxW;
  c.height = pxH;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
  return { mesh, ctx: c.getContext('2d')!, tex };
}

/** 온습도 (Date.now() 기준, 모든 기기 같음) */
export function roomClimate(ms = Date.now()): { temp: number; humidity: number } {
  const ph = ((ms / 1000) / 300) * Math.PI * 2;
  return { temp: 22.5 + 0.3 * Math.sin(ph), humidity: 45 + 2 * Math.cos(ph) };
}

/** 탁상시계: 앞(+z)을 보는 둥근 문자판 */
export class DeskClock extends Item {
  private face: ReturnType<typeof canvasFace>;
  readonly sim = { lastSec: -1 };

  constructor() {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.06), TRIM);
    base.position.y = 0.01;
    g.add(base);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.035, 16), CASE);
    body.rotation.x = Math.PI / 2;
    body.position.y = 0.08;
    g.add(body);
    super(g, { name: '탁상시계', radius: 0.065, mass: 0.3 });
    this.face = canvasFace(0.105, 0.105, 64, 64);
    this.face.mesh.position.set(0, 0.08, 0.0181);
    g.add(this.face.mesh);
    this.tick();
  }

  /** 초가 바뀌었을 때만 다시 그린다 */
  tick(): void {
    const now = new Date();
    const s = now.getSeconds();
    if (s === this.sim.lastSec) return;
    this.sim.lastSec = s;
    const { ctx, tex } = this.face;
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = '#d8cfae';
    ctx.beginPath();
    ctx.arc(32, 32, 31, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2a2c22';
    ctx.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(32 + Math.sin(a) * 25, 32 - Math.cos(a) * 25);
      ctx.lineTo(32 + Math.sin(a) * 29, 32 - Math.cos(a) * 29);
      ctx.stroke();
    }
    const hand = (frac: number, len: number, width: number, color: string) => {
      const a = frac * Math.PI * 2;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(32, 32);
      ctx.lineTo(32 + Math.sin(a) * len, 32 - Math.cos(a) * len);
      ctx.stroke();
    };
    const m = now.getMinutes();
    hand(((now.getHours() % 12) + m / 60) / 12, 15, 3, '#2a2c22');
    hand((m + s / 60) / 60, 23, 2, '#2a2c22');
    hand(s / 60, 26, 1, '#b8402a');
    tex.needsUpdate = true;
  }
}

/** 디지털 온습도계: 세운 작은 상자, 앞(+z)에 두 줄 표시창 */
export class Hygrometer extends Item {
  private lcd: ReturnType<typeof canvasFace>;
  readonly sim = { lastText: '' };

  constructor() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.03), CASE);
    body.position.y = 0.055;
    g.add(body);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.008, 0.05), TRIM);
    foot.position.y = 0.004;
    g.add(foot);
    super(g, { name: '온습도계', radius: 0.055, mass: 0.12 });
    this.lcd = canvasFace(0.075, 0.06, 64, 48);
    this.lcd.mesh.position.set(0, 0.065, 0.0151);
    g.add(this.lcd.mesh);
    this.tick();
  }

  /** 표시 문자열 (테스트·교재용) */
  get reading(): string {
    const { temp, humidity } = roomClimate();
    return `${temp.toFixed(1)} °C ${humidity.toFixed(0)} %RH`;
  }

  tick(): void {
    const { temp, humidity } = roomClimate();
    const t = `${temp.toFixed(1)}°C`;
    const h = `${humidity.toFixed(0)}%RH`;
    if (t + h === this.sim.lastText) return;
    this.sim.lastText = t + h;
    const { ctx, tex } = this.lcd;
    ctx.fillStyle = '#1f3a24';
    ctx.fillRect(0, 0, 64, 48);
    ctx.fillStyle = '#9dff9a';
    ctx.font = '14px Galmuri11, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(t, 32, 20);
    ctx.fillText(h, 32, 40);
    tex.needsUpdate = true;
  }
}
