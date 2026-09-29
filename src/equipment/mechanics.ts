/**
 * 역학 실험 기구: 스탠드, 클램프, 추, 쇠공, 각도기
 *
 * 연결 관계 (플러그 → 소켓)
 *   클램프 [rodMount] → 스탠드 막대 (탭한 높이에, 팔이 나를 향하게)
 *   실·추·쇠공·플라스크 [grip] → 클램프 집게 (단단히 고정)
 *   추·쇠공 [hook] → 실 끝 고리 (매달림 → 진자)
 *   각도기 [accessory] → 클램프 (받침점 뒤에 세워짐)
 */
import * as THREE from 'three';
import { Item, Socket } from '../world/items';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const METAL = new THREE.MeshLambertMaterial({ color: 0x6f7470 });
const DARK = new THREE.MeshLambertMaterial({ color: 0x2e302c });
const BRASS = new THREE.MeshLambertMaterial({ color: 0xc9a54a });
const STEEL = new THREE.MeshLambertMaterial({ color: 0xb4b8b6 });

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/** 스탠드: 밑판 + 수직 막대. 막대 전체가 클램프를 끼우는 미끄럼 소켓 */
export class Stand extends Item {
  static readonly ROD_H = 0.9;
  readonly rod: Socket;

  constructor() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.16, 0.02, 0.26), DARK, 0, 0.01, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, Stand.ROD_H, 6), METAL, 0, 0.02 + Stand.ROD_H / 2, -0.09));
    super(g, { name: '스탠드', radius: 0.15, mass: 1.2, touchPad: false });
    this.rod = new Socket(this, '스탠드 막대', ['rodMount'], v(0, 0.5, -0.09), {
      multi: true, slide: { min: 0.04, max: 0.88 }, hitRadius: 0.028, faceCamera: true,
    });
  }
}

/** 클램프: 막대에 끼우는 고정부 + 팔 + 끝의 집게 */
export class Clamp extends Item {
  static readonly ARM = 0.2;
  readonly jaw: Socket;
  readonly accessory: Socket;

  constructor() {
    const g = new THREE.Group();
    const A = Clamp.ARM;
    g.add(mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), DARK, 0, 0.02, 0)); // 고정부
    const knob = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.04, 6), METAL, 0.035, 0.02, 0); // 나사
    knob.rotation.z = Math.PI / 2;
    g.add(knob);
    g.add(mesh(new THREE.BoxGeometry(0.012, 0.012, A), METAL, 0, 0.02, 0.02 + A / 2)); // 팔
    g.add(mesh(new THREE.BoxGeometry(0.03, 0.008, 0.03), DARK, 0, 0.03, 0.02 + A)); // 집게 위
    g.add(mesh(new THREE.BoxGeometry(0.03, 0.008, 0.03), DARK, 0, 0.01, 0.02 + A)); // 집게 아래
    super(g, {
      name: '클램프', radius: 0.12, mass: 0.25, touchPad: false,
      plugs: [{ type: 'rodMount', point: v(0, 0.02, 0) }],
    });
    this.jaw = new Socket(this, '클램프 집게', ['grip'], v(0, 0.02, 0.02 + A), { hitRadius: 0.045 });
    // 각도기는 집게 바로 뒤(막대 쪽)에 — 줄이 각도기 앞에서 흔들리도록
    this.accessory = new Socket(this, '클램프', ['accessory'], v(0, 0.02, 0.02 + A - 0.015), { hitRadius: 0 });
  }
}

/**
 * 황동 추 (밀도 ≈ 8500 kg/m³): 반지름 r, 높이 h인 원기둥 + 위쪽 고리.
 * 질량 = ρ·πr²h  (예: 100 g → r = 1.3 cm, h = 2.2 cm)
 * 고리로 실에 걸 수도, 몸통을 클램프로 집을 수도 있다.
 */
export function hangingMass(grams: number, r: number, h: number): Item {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(r, r, h, 8), BRASS, 0, h / 2, 0));
  g.add(mesh(new THREE.TorusGeometry(0.007, 0.002, 4, 8), BRASS, 0, h + 0.008, 0));
  return new Item(g, {
    name: `추 ${grams} g`, radius: Math.max(r, 0.015), mass: grams / 1000, comY: h / 2,
    dragArea: 0.8 * 2 * r * h, // 옆에서 본 단면적 × 항력 계수(짧은 원기둥 ≈ 0.8)
    plugs: [
      { type: 'hook', point: v(0, h + 0.015, 0) },
      { type: 'grip', point: v(0, h / 2, 0) },
    ],
  });
}

/** 쇠공 (지름 5 cm, 고리 나사 달림): 4/3·π·(0.025)³ × 7850 kg/m³ ≈ 0.51 kg */
export function steelBall(): Item {
  const r = 0.025;
  const g = new THREE.Group();
  g.add(mesh(new THREE.SphereGeometry(r, 8, 6), STEEL, 0, r, 0));
  g.add(mesh(new THREE.TorusGeometry(0.006, 0.0018, 4, 8), METAL, 0, 2 * r + 0.006, 0));
  return new Item(g, {
    name: '쇠공', radius: 0.03, mass: 0.51, comY: r,
    dragArea: 0.47 * Math.PI * r * r, // 구의 항력 계수 0.47
    plugs: [
      { type: 'hook', point: v(0, 2 * r + 0.012, 0) },
      { type: 'grip', point: v(0, r, 0) },
    ],
  });
}

/** 각도기: 윗변 가운데가 받침점. 클램프에 붙이면 흔들리는 각도를 눈으로 읽을 수 있다 */
export function protractor(): Item {
  const W = 0.3;
  const H = 0.15;
  const g = new THREE.Group();
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.MeshBasicMaterial({ map: protractorTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide }),
  );
  plane.position.y = H / 2;
  g.add(plane);
  return new Item(g, {
    name: '각도기', radius: 0.15, mass: 0.05, touchPad: false,
    plugs: [{ type: 'accessory', point: v(0, H, 0) }],
  });
}

/** 각도기 텍스처: 위 가운데가 중심, 아래로 −90°~+90° 눈금 (10° 간격, 30°마다 긴 눈금) */
function protractorTexture(): THREE.CanvasTexture {
  const W = 128;
  const H = 64;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const cx = W / 2;
  const R = 62;
  g.fillStyle = 'rgba(210,220,200,0.2)';
  g.beginPath();
  g.moveTo(cx, 0);
  g.arc(cx, 0, R, 0, Math.PI);
  g.fill();
  g.strokeStyle = 'rgba(240,235,210,0.9)';
  g.lineWidth = 1;
  g.beginPath();
  g.arc(cx, 0, R, 0, Math.PI);
  g.stroke();
  for (let d = -90; d <= 90; d += 10) {
    const a = Math.PI / 2 + (d * Math.PI) / 180;
    const len = d % 30 === 0 ? 10 : 5;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * R, Math.sin(a) * R);
    g.lineTo(cx + Math.cos(a) * (R - len), Math.sin(a) * (R - len));
    g.stroke();
  }
  g.setLineDash([2, 2]);
  g.beginPath(); // 연직선 (0°)
  g.moveTo(cx, 0);
  g.lineTo(cx, R);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}
