/**
 * 용수철: 윗고리를 클램프 집게에 물리고, 아래 고리에 추를 걸면 "용수철 진자"가 된다.
 *
 *   자유 상태   → 자연 길이 L0로 선반·책상 위에 세워져 있음
 *   집게에 걸림 → 아래로 늘어짐 (자기 무게만큼 아주 조금)
 *   + 추        → 정적 늘어남 x_eq = (m + m_s/2)g/k 만큼 늘어나 평형, 당겼다 놓으면 위아래로 진동
 *
 * 물체 좌표: 윗고리 끝이 (0, top, 0), 아래 고리 끝이 (0, bottom, 0). 늘어나면 bottom이 아래로 내려간다.
 * 코일은 관(Cable) 모양의 나선으로 그려서 늘어날 때마다 점만 다시 계산한다.
 */
import * as THREE from 'three';
import { HITBOX_MAT, Item, Socket } from '../world/items';
import type { Action } from '../world/interactable';
import { Cable, surfaceBelow } from '../world/cable';
import { SpringSim, type SpringSpec } from '../sim/spring';

const TURNS = 16;
const PER_TURN = 6;
const COIL_R = 0.013;
const HOOK = 0.012; // 위아래 고리 길이

export class Spring extends Item {
  readonly sim = new SpringSim();
  readonly hook: Socket;
  onOpenPanel: (s: Spring) => void = () => {};
  /** 추가 책상에 닿는가 (가장 많이 늘어났을 때) */
  touchesTable = false;

  private cable: Cable;
  private pts: THREE.Vector3[];
  private pad: THREE.Mesh;
  private top: number;
  private shownExt = -1;

  constructor(readonly spec: SpringSpec, color: number, label: string) {
    const g = new THREE.Group();
    const top = spec.L0 + 2 * HOOK;
    // 탭 판정: 코일을 감싸는 원기둥 (늘어나면 같이 늘림). super 전에 넣어 두어야 높이가 계산된다
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 6).translate(0, -0.5, 0), HITBOX_MAT);
    pad.position.y = top;
    pad.scale.y = top;
    g.add(pad);
    super(g, {
      name: label, radius: 0.02, mass: spec.ms, touchPad: false,
      plugs: [{ type: 'grip', point: new THREE.Vector3(0, top, 0) }], // 윗고리를 집게에 물린다
    });
    this.top = top;
    this.sim.spec = spec;
    const n = TURNS * PER_TURN + 1 + 4;
    this.pts = Array.from({ length: n }, () => new THREE.Vector3());
    this.cable = new Cable(n, 0.0018, color);
    g.add(this.cable.mesh);
    this.pad = pad;

    this.hook = new Socket(this, `${label} 아래 고리`, ['hook'], new THREE.Vector3(0, 0, 0), {
      hitRadius: 0.03,
      enabled: () => this.isHung,
    });
    this.shape(0);
  }

  get isHung(): boolean {
    return this.attachedTo !== null;
  }

  get bob(): Item | null {
    return this.hook.children[0] ?? null;
  }

  /** 진동 조건: 걸려 있고, 추가 있고, 손에 들고 있지 않음 */
  get isOscillator(): boolean {
    return this.isHung && !!this.bob && this.root().object.parent?.type === 'Scene';
  }

  experimentActions(): Action[] {
    return this.isOscillator ? [{ label: '용수철 진자 실험', run: () => this.onOpenPanel(this) }] : [];
  }

  onAttached(): void {
    this.resetSim();
  }

  onDetached(): void {
    this.resetSim();
  }

  onChildAttached(): void {
    this.resetSim();
  }

  onChildDetached(): void {
    this.resetSim();
  }

  resetSim(): void {
    const bob = this.bob;
    this.sim.bob = bob ? { mass: bob.mass, dragArea: bob.dragArea } : null;
    this.sim.reset();
  }

  /** 패널 "놓기"·"초기화" (명령 call로 불린다) */
  releaseSim(): void {
    this.sim.release();
  }

  resetSimClock(): void {
    this.sim.reset();
  }

  /** 자연 길이보다 ext만큼 늘어난 모양으로 다시 그린다 */
  private shape(ext: number): void {
    if (Math.abs(ext - this.shownExt) < 1e-5) return;
    this.shownExt = ext;
    const L = this.spec.L0 + ext;
    const yTop = this.top;
    const yCoilTop = yTop - HOOK;
    const yBottom = yCoilTop - L - HOOK;
    const p = this.pts;
    let i = 0;
    p[i++].set(0, yTop, 0);
    p[i++].set(0, yTop - HOOK * 0.6, 0);
    const n = TURNS * PER_TURN;
    for (let k = 0; k <= n; k++) {
      const a = (k / PER_TURN) * Math.PI * 2;
      // 양 끝 반 바퀴는 반지름을 줄여 가운데 축으로 모인다
      const r = COIL_R * Math.min(1, k / 3, (n - k) / 3);
      p[i++].set(r * Math.cos(a), yCoilTop - (k / n) * L, r * Math.sin(a));
    }
    p[i++].set(0, yBottom + HOOK * 0.4, 0);
    p[i++].set(0, yBottom, 0);
    this.cable.setPoints(p);
    this.hook.anchor.position.y = yBottom;
    this.pad.scale.y = yTop - yBottom;
  }

  /** 가장 많이 늘어났을 때 추 바닥이 아래 면에 닿는지 (0.3초마다) */
  private checkTimer = 0;
  private updateClearance(): void {
    const bob = this.bob;
    const plug = bob?.attachedPlug;
    if (!this.isHung || !bob || !plug) {
      this.touchesTable = false;
      return;
    }
    this.object.updateWorldMatrix(true, false);
    const topW = this.object.localToWorld(new THREE.Vector3(0, this.top, 0));
    const lowest = this.top - HOOK * 2 - this.spec.L0 - this.sim.staticExtension() - this.sim.amplitude - plug.point.y;
    const lowW = topW.y - (this.top - lowest);
    this.touchesTable = lowW < surfaceBelow(topW.x, topW.z, topW.y) + 0.003;
  }

  /**
   * 매 프레임
   * @param preview 패널이 열려 있고 멈춘 상태면 처음 당긴 위치를 보여 준다
   */
  update(dt: number, speed: number, preview: boolean): void {
    if ((this.checkTimer -= dt) <= 0) {
      this.checkTimer = 0.3;
      this.updateClearance();
    }
    const sim = this.sim;
    if (!this.isHung) {
      this.shape(0);
      return;
    }
    if (!this.isOscillator) {
      if (sim.running) sim.reset();
      // 걸려 있기만 하면 자기 무게로 x = m_s·g/(2k) 만큼, 추를 들고 있는 중이면 그 무게까지
      this.shape(sim.staticExtension());
      return;
    }
    if (this.touchesTable && sim.running) sim.reset();
    sim.advance(dt * speed);
    const y = sim.running || sim.time > 0 ? sim.state.theta : preview ? sim.amplitude : 0;
    this.shape(Math.max(-this.spec.L0 * 0.5, sim.staticExtension() + y));
  }
}
