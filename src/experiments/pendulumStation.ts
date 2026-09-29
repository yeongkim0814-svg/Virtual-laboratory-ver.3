/**
 * 단진자 실험 장치 (실험 테이블 1 위의 스탠드)
 *
 * - 추(매달 수 있는 물체)를 들고 스탠드를 탭하면 매달린다.
 * - 빈손(또는 매달 수 없는 물체)으로 탭하면 실험 패널이 열린다.
 * - 매달린 추를 탭하면 다시 손으로 가져온다.
 *
 * 흔들리는 평면은 x–y 평면이다. 테이블 앞(남쪽, +z)에서 북쪽을 보면 좌우로 흔들린다.
 * 받침점(pivot) 그룹을 z축으로 θ만큼 돌리면, 길이 L 아래 점 (0, −L)이 (L·sinθ, −L·cosθ)로 간다.
 */
import * as THREE from 'three';
import type { Interactable } from '../world/interactable';
import type { Item } from '../world/items';
import type { Hand } from '../player/hand';
import { PendulumSim } from '../sim/pendulum';

const TABLE_Y = 0.85;
const PIVOT_HEIGHT = 0.95; // 테이블 윗면에서 받침점까지 (m) → 최대 줄 길이 0.9 m까지 추가 테이블에 닿지 않음

export class PendulumStation implements Interactable {
  readonly object = new THREE.Group();
  readonly sim = new PendulumSim();
  bob: Item | null = null;
  onOpenPanel: () => void = () => {};

  private pivot = new THREE.Group(); // 받침점: 이 그룹을 회전 = 진자의 각도
  private string: THREE.Line;
  private stringGeo = new THREE.BufferGeometry();

  constructor(
    private hand: Hand,
    /** 스탠드 기둥 밑판의 위치 (테이블 위) */
    base: THREE.Vector3,
  ) {
    const metal = new THREE.MeshLambertMaterial({ color: 0x6f7470 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2e302c });

    // 밑판 + 기둥 + 가로 팔
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 0.28), dark);
    plate.position.set(base.x, TABLE_Y + 0.01, base.z);
    const rodH = PIVOT_HEIGHT + 0.12;
    // 기둥은 진자 뒤쪽(북쪽, −z)에 세우고 가로 팔을 관찰자 쪽(+z)으로 뻗는다 → 기둥이 추를 가리지 않음
    const rodZ = base.z - 0.08;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, rodH, 6), metal);
    rod.position.set(base.x, TABLE_Y + rodH / 2, rodZ);
    const armLen = 0.45;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.016, armLen), metal);
    arm.position.set(base.x, TABLE_Y + PIVOT_HEIGHT, rodZ + armLen / 2);
    const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), dark);
    clamp.position.set(base.x, TABLE_Y + PIVOT_HEIGHT, rodZ);
    this.object.add(plate, rod, arm, clamp);

    // 받침점: 가로 팔 끝
    this.pivot.position.set(base.x, TABLE_Y + PIVOT_HEIGHT, rodZ + armLen - 0.01);
    this.object.add(this.pivot);

    // 각도기: 받침점 뒤(북쪽)에 붙은 반원판 — 흔들리는 각도를 눈으로 읽을 수 있게
    const prot = new THREE.Mesh(
      new THREE.PlaneGeometry(0.36, 0.18),
      new THREE.MeshBasicMaterial({ map: protractorTexture(), transparent: true, depthWrite: false }),
    );
    prot.position.set(this.pivot.position.x, this.pivot.position.y - 0.09, this.pivot.position.z - 0.012);
    this.object.add(prot);

    // 줄: 1픽셀 선 (THREE.Line은 화면에서 항상 1픽셀 두께)
    this.stringGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -0.5, 0], 3));
    this.string = new THREE.Line(this.stringGeo, new THREE.LineBasicMaterial({ color: 0xe8e0c8 }));
    // 선은 광선 판정 폭이 기본 1 m라서 먼 곳의 탭까지 가로챈다 → 판정에서 제외
    this.string.raycast = () => {};
    this.pivot.add(this.string);
    this.string.visible = false;

    this.sim.reset();
  }

  label(): string {
    const held = this.hand.held;
    if (held && !this.bob) return held.hangable ? `추 매달기 · ${held.name}` : '이 물체는 매달 수 없음';
    return '단진자 실험 열기';
  }

  interact(): void {
    const held = this.hand.held;
    if (held && !this.bob) {
      if (!held.hangable) return;
      const item = this.hand.handOver();
      if (item) this.attach(item);
      return;
    }
    this.onOpenPanel();
  }

  private attach(item: Item): void {
    this.bob = item;
    this.pivot.add(item.object);
    this.sim.bob = { mass: item.mass, dragArea: item.dragArea };
    this.sim.reset();
    this.layout();
  }

  /** 줄 길이·추 위치를 현재 L에 맞춘다. L = 받침점 ~ 추의 중심 */
  layout(): void {
    const L = this.sim.length;
    const bob = this.bob;
    const h = bob?.height ?? 0;
    // 줄은 추의 윗면까지: L − h/2
    const pos = this.stringGeo.attributes.position as THREE.BufferAttribute;
    pos.setY(1, -(L - h / 2));
    pos.needsUpdate = true;
    this.stringGeo.computeBoundingSphere();
    this.string.visible = !!bob;
    // 물체의 원점은 바닥면 중심 → 바닥이 −(L + h/2)에 오게
    if (bob) bob.object.position.set(0, -(L + h / 2), 0);
  }

  /** 매 프레임: 시뮬레이션 진행 + 화면 각도 반영 */
  update(dt: number, speed: number): void {
    // 추를 손으로 가져갔으면 (다른 곳에 붙었으면) 실험 중단
    if (this.bob && this.bob.object.parent !== this.pivot) {
      this.bob = null;
      this.sim.bob = null;
      this.sim.reset();
      this.layout();
    }
    if (this.bob) this.sim.advance(dt * speed);
    this.pivot.rotation.z = this.bob ? this.sim.state.theta : 0;
  }
}

/** 각도기 텍스처: 받침점이 위 가운데, 아래로 −90°~+90° 눈금 (10° 간격, 30°마다 긴 눈금) */
function protractorTexture(): THREE.CanvasTexture {
  const W = 128;
  const H = 64;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const cx = W / 2;
  const R = 60;
  g.fillStyle = 'rgba(210,220,200,0.18)';
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
    const a = Math.PI / 2 + (d * Math.PI) / 180; // 아래쪽이 0°
    const len = d % 30 === 0 ? 10 : 5;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * R, Math.sin(a) * R);
    g.lineTo(cx + Math.cos(a) * (R - len), Math.sin(a) * (R - len));
    g.stroke();
  }
  g.beginPath(); // 연직선 (0°)
  g.moveTo(cx, 0);
  g.lineTo(cx, R);
  g.setLineDash([2, 2]);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}
