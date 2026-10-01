/**
 * 칸막이 벽의 문 (주 실험실 ↔ 준비실)
 *
 * 문짝은 경첩(hinge)을 축으로 회전한다. 회전각 θ에 따라
 * 문짝 끝점의 위치는 (x, z) = (−w·sinθ, −w·cosθ) 만큼 경첩에서 떨어져 있다.
 * (닫힘 θ = 0 → 도면 위쪽(−z)을 향함, 열림 θ = −90° → 준비실(+x)을 향함)
 */
import * as THREE from 'three';
import { DOOR, DOOR_HEIGHT, PARTITION } from './layout';
import type { Action, Interactable } from './interactable';
import type { Vec2 } from '../player/collision';
import { grimeTexture } from '../render/textures';

const LEAF_THICKNESS = 0.05;
const OPEN_ANGLE = -Math.PI / 2;
const SWING_SPEED = 2.5; // rad/s

export class Door implements Interactable {
  readonly object: THREE.Group; // 경첩 위치에 놓인 회전축
  readonly hinge: Vec2;
  readonly width = DOOR.z2 - DOOR.z1;
  private angle = 0;
  private target = 0;

  constructor() {
    // 경첩: 칸막이 벽의 준비실 쪽 면, 문 구멍의 아래쪽 끝
    this.hinge = { x: PARTITION.x2 - LEAF_THICKNESS / 2, z: DOOR.z2 };

    this.object = new THREE.Group();
    this.object.position.set(this.hinge.x, 0, this.hinge.z);

    const leaf = new THREE.Mesh(
      new THREE.BoxGeometry(LEAF_THICKNESS, DOOR_HEIGHT, this.width),
      new THREE.MeshLambertMaterial({ map: grimeTexture(), color: 0x4e5a3c }),
    );
    leaf.position.set(0, DOOR_HEIGHT / 2, -this.width / 2);

    // 손잡이 (양쪽 면)
    const handleMat = new THREE.MeshLambertMaterial({ color: 0x2c2e29 });
    for (const side of [-1, 1]) {
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.14), handleMat);
      handle.position.set(side * 0.06, 1.0, -this.width + 0.12);
      this.object.add(handle);
    }
    this.object.add(leaf);
  }

  get isOpen(): boolean {
    return this.target !== 0;
  }

  actions(): Action[] {
    return [{ label: this.isOpen ? '문 닫기' : '문 열기', run: () => this.toggle() }];
  }

  toggle(): void {
    this.target = this.isOpen ? 0 : OPEN_ANGLE;
  }

  /** 매 프레임 호출: 목표 각도를 향해 일정한 각속도로 회전 */
  update(dt: number): void {
    const diff = this.target - this.angle;
    const step = SWING_SPEED * dt;
    this.angle = Math.abs(diff) <= step ? this.target : this.angle + Math.sign(diff) * step;
    this.object.rotation.y = this.angle;
  }

  /** 충돌 판정용: 문짝을 선분(경첩 → 끝점)으로 본다 */
  segment(): { a: Vec2; b: Vec2; thickness: number } {
    const w = this.width;
    return {
      a: this.hinge,
      b: { x: this.hinge.x - w * Math.sin(this.angle), z: this.hinge.z - w * Math.cos(this.angle) },
      thickness: LEAF_THICKNESS,
    };
  }
}
