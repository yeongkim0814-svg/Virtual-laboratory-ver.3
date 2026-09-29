/**
 * 실: 클램프 집게에 윗끝을 물리면 아래로 늘어지고, 끝 고리에 추를 걸면 "진자"가 된다.
 *
 *   자유 상태  → 둘둘 말린 실 뭉치 (책상·선반 위)
 *   집게에 걸림 → 길이 ℓ의 실이 늘어짐, 끝 고리 사용 가능
 *   + 추       → 단진자: 이 실이 PendulumSim을 가지고 흔들림을 계산한다
 *
 * 진자 길이 L = 받침점(집게) ~ 추의 무게 중심 = ℓ + (추의 고리 ~ 무게 중심 거리)
 * 흔들리는 평면: 클램프 팔에 수직인 평면 (팔 방향 = 실의 z축 → z축 둘레로 회전)
 */
import * as THREE from 'three';
import { HITBOX_MAT, Item, Socket } from '../world/items';
import type { Action } from '../world/interactable';
import { PendulumSim } from '../sim/pendulum';

export class PendulumString extends Item {
  /** 실 길이 ℓ (집게 ~ 끝 고리), 사용자가 정한 값 */
  length = 0.5;
  /** 바닥(책상)에 닿지 않도록 허용되는 최대 ℓ */
  maxLength = 1.0;
  readonly sim = new PendulumSim();
  readonly hook: Socket;
  onOpenPanel: (s: PendulumString) => void = () => {};

  private swing = new THREE.Group();
  private coil = new THREE.Group();
  private lineGeo = new THREE.BufferGeometry();
  private line: THREE.Line;
  private clearanceTimer = 0;
  private ray = new THREE.Raycaster();

  constructor() {
    const g = new THREE.Group();
    // 실 뭉치 (자유 상태일 때만 보임) — 바닥면 중심이 원점
    const coil = new THREE.Group();
    const torus = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.006, 4, 10), new THREE.MeshLambertMaterial({ color: 0xd8d0b8 }));
    torus.rotation.x = Math.PI / 2;
    torus.position.y = 0.006;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8), HITBOX_MAT);
    pad.position.y = 0.04;
    coil.add(torus, pad);
    g.add(coil);
    super(g, {
      name: '실', radius: 0.035, mass: 0.002, touchPad: false,
      plugs: [{ type: 'grip', point: new THREE.Vector3(0, 0, 0) }], // 윗끝을 집게에 물린다
    });
    this.coil = coil;

    // 늘어진 실 (걸렸을 때만 보임): swing 그룹이 z축 둘레로 θ만큼 돈다
    this.lineGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -0.5, 0], 3));
    this.line = new THREE.Line(this.lineGeo, new THREE.LineBasicMaterial({ color: 0xe8e0c8 }));
    this.line.raycast = () => {}; // 선은 광선 판정 폭이 기본 1 m라 탭을 가로챔 → 제외
    this.swing.add(this.line);
    this.swing.visible = false;
    g.add(this.swing);

    this.hook = new Socket(this, '실 끝 고리', ['hook'], new THREE.Vector3(0, -0.5, 0), {
      hitRadius: 0.035,
      enabled: () => this.isHung,
    }, this.swing);
    this.sim.length = this.effectiveLength();
  }

  /** 집게에 걸려 있는가 */
  get isHung(): boolean {
    return this.attachedTo !== null;
  }

  get bob(): Item | null {
    return this.hook.children[0] ?? null;
  }

  /** 받침점 ~ 추 무게 중심 거리 L */
  effectiveLength(): number {
    const bob = this.bob;
    const plug = bob?.attachedPlug;
    return this.usedLength() + (bob && plug ? plug.point.y - bob.comY : 0);
  }

  /** 실제로 쓰이는 실 길이 (책상에 닿으면 짧아짐) */
  usedLength(): number {
    return Math.min(this.length, this.maxLength);
  }

  /** 진자 조건: 걸려 있고, 추가 있고, 조립체가 장면에 놓여 있음 (손에 들고 있지 않음) */
  get isPendulum(): boolean {
    return this.isHung && !!this.bob && this.root().object.parent?.type === 'Scene';
  }

  experimentActions(): Action[] {
    return this.isPendulum ? [{ label: '진자 실험', run: () => this.onOpenPanel(this) }] : [];
  }

  onAttached(): void {
    this.coil.visible = false;
    this.swing.visible = true;
    this.resetSim();
  }

  onDetached(): void {
    this.coil.visible = true;
    this.swing.visible = false;
    this.swing.rotation.z = 0;
    this.resetSim();
  }

  onChildAttached(): void {
    this.resetSim();
  }

  onChildDetached(): void {
    this.resetSim();
  }

  /** 조건이 바뀌면 시뮬레이션을 처음 상태로 */
  resetSim(): void {
    const bob = this.bob;
    this.sim.bob = bob ? { mass: bob.mass, dragArea: bob.dragArea } : null;
    this.layout();
    this.sim.reset();
    this.clearanceTimer = 0;
  }

  /** 실 길이·고리 위치를 반영 */
  layout(): void {
    const l = this.usedLength();
    const pos = this.lineGeo.attributes.position as THREE.BufferAttribute;
    pos.setY(1, -l);
    pos.needsUpdate = true;
    this.lineGeo.computeBoundingSphere();
    this.hook.anchor.position.y = -l;
    this.sim.length = this.effectiveLength();
  }

  /**
   * 받침점 아래로 광선을 쏴서 책상(또는 바닥)까지의 거리를 재고,
   * 추가 닿지 않는 최대 실 길이를 구한다.
   */
  private updateClearance(): void {
    if (!this.isHung) return;
    const scene = this.root().object.parent;
    if (!scene) return;
    const from = this.object.getWorldPosition(new THREE.Vector3());
    this.ray.set(from, new THREE.Vector3(0, -1, 0));
    // 실을 문 클램프(집게 날 포함)와 실 자신은 제외
    const own = this.attachedTo?.owner.object ?? this.object;
    const hit = this.ray.intersectObjects(scene.children, true).find((h) => {
      for (let o: THREE.Object3D | null = h.object; o; o = o.parent) {
        if (o === own || o.userData.noPick || !o.visible) return false;
      }
      return !(h.object as THREE.Mesh).material || (h.object as THREE.Mesh).material !== HITBOX_MAT;
    });
    const clearance = hit ? hit.distance : 3;
    const bob = this.bob;
    const below = bob?.attachedPlug ? bob.attachedPlug.point.y : 0; // 고리 ~ 추 바닥
    const max = Math.max(0.05, Math.floor((clearance - below - 0.01) * 100) / 100);
    if (max !== this.maxLength) {
      const wasLimited = this.length > this.maxLength;
      this.maxLength = max;
      // 실제로 쓰이는 길이가 바뀌면 진행 중인 측정은 무효 → 처음부터 (L이 도중에 바뀌면 주기가 섞인다)
      if (wasLimited || this.length > max) this.resetSim();
      else this.layout();
    }
  }

  /**
   * 매 프레임
   * @param preview 패널이 열려 있고 멈춘 상태면 추를 처음 각도 θ₀로 당겨서 보여 준다
   */
  update(dt: number, speed: number, preview: boolean): void {
    if (this.isHung && (this.clearanceTimer -= dt) <= 0) {
      this.clearanceTimer = 0.3;
      this.updateClearance();
    }
    if (!this.isPendulum) {
      if (this.sim.running) this.sim.reset();
      this.swing.rotation.z = 0;
      return;
    }
    this.sim.advance(dt * speed);
    const theta = this.sim.running || this.sim.time > 0 ? this.sim.state.theta : preview ? this.sim.theta0 : 0;
    this.swing.rotation.z = theta;
  }
}
