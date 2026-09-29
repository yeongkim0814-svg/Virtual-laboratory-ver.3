/**
 * 1인칭 플레이어: 위치·시선 방향·이동·충돌
 *
 * 시선 방향은 두 각도로 표현한다.
 *   yaw   : 좌우 회전 (y축 기준).  yaw = 0 → −z 방향을 본다.
 *   pitch : 위아래 회전 (±85°로 제한 — 90°가 되면 "위"가 어딘지 정의가 깨진다)
 *
 * yaw 방향의 단위벡터
 *   앞(forward) = (−sin yaw, −cos yaw)
 *   오른쪽(right) = ( cos yaw, −sin yaw)
 * 이동 입력 (mx, my)는 속도 v = speed · (mx·right + my·forward) 로 바뀐다.
 */
import * as THREE from 'three';
import { FURNITURE, WALLS } from '../world/layout';
import type { Door } from '../world/door';
import { pushOutOfRect, pushOutOfSegment, clamp, type Vec2 } from './collision';
import type { InputState } from '../input/controls';

export const EYE_HEIGHT = 1.6; // m
const RADIUS = 0.3; // 몸통 반지름 (m)
const MAX_PITCH = (85 * Math.PI) / 180;
const LOOK_DEG_PER_PX = 0.25; // 감도 1.0일 때 1픽셀 드래그당 회전 각도
const ACCEL = 12; // 속도가 목표 속도에 다가가는 빠르기 (1/s)

export interface PlayerSettings {
  lookSensitivity: number;
  moveSpeed: number; // m/s
}

export class Player {
  readonly pos: Vec2;
  yaw: number;
  pitch = 0;
  private vel: Vec2 = { x: 0, z: 0 };

  constructor(
    private camera: THREE.PerspectiveCamera,
    private door: Door,
    private spawn: { x: number; z: number; yaw: number },
  ) {
    this.pos = { x: spawn.x, z: spawn.z };
    this.yaw = spawn.yaw;
    camera.rotation.order = 'YXZ'; // 먼저 좌우(Y), 그다음 위아래(X)
  }

  reset(): void {
    this.pos.x = this.spawn.x;
    this.pos.z = this.spawn.z;
    this.yaw = this.spawn.yaw;
    this.pitch = 0;
    this.vel.x = this.vel.z = 0;
  }

  update(dt: number, input: InputState, settings: PlayerSettings): void {
    // ---- 1. 시점 회전 ----
    // 확대 중에는 시야각에 비례해 천천히 돈다 (같은 드래그로 화면 위 같은 거리만큼 움직이도록)
    const k = ((LOOK_DEG_PER_PX * Math.PI) / 180) * settings.lookSensitivity * (this.camera.fov / 70);
    this.yaw -= input.lookDX * k; // 오른쪽으로 드래그 → 오른쪽으로 돈다
    this.pitch = clamp(this.pitch - input.lookDY * k, -MAX_PITCH, MAX_PITCH);

    // ---- 2. 목표 속도 ----
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    const targetX = settings.moveSpeed * (input.moveX * c - input.moveY * s);
    const targetZ = settings.moveSpeed * (-input.moveX * s - input.moveY * c);

    // 속도를 목표값으로 부드럽게 접근 (지수 감쇠: 갑자기 멈추거나 튀지 않게)
    const a = 1 - Math.exp(-ACCEL * dt);
    this.vel.x += (targetX - this.vel.x) * a;
    this.vel.z += (targetZ - this.vel.z) * a;

    // ---- 3. 이동 + 충돌 ----
    // 한 번에 크게 움직이면 얇은 벽을 뚫을 수 있으므로 5 cm 이하로 쪼개서 움직인다
    const dist = Math.hypot(this.vel.x, this.vel.z) * dt;
    const steps = Math.max(1, Math.ceil(dist / 0.05));
    for (let i = 0; i < steps; i++) {
      this.pos.x += (this.vel.x * dt) / steps;
      this.pos.z += (this.vel.z * dt) / steps;
      this.resolveCollisions();
    }

    // ---- 4. 카메라에 반영 ----
    this.camera.position.set(this.pos.x, EYE_HEIGHT, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  private resolveCollisions(): void {
    const seg = this.door.segment();
    // 여러 장애물이 동시에 닿는 모서리에서는 한 번으론 부족할 수 있어 2회 반복
    for (let iter = 0; iter < 2; iter++) {
      pushOutOfSegment(this.pos, RADIUS, seg.a, seg.b, seg.thickness);
      for (const w of WALLS) pushOutOfRect(this.pos, RADIUS, w);
      for (const f of FURNITURE) pushOutOfRect(this.pos, RADIUS, f.rect);
    }
  }
}
