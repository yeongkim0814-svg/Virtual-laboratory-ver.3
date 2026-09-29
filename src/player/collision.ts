/**
 * 충돌 판정 (위에서 내려다본 2차원 평면에서 계산)
 *
 * 플레이어는 반지름 r인 원, 벽은 직사각형, 문짝은 선분이다.
 * 원리는 하나다:
 *   1. 장애물 위에서 원의 중심과 "가장 가까운 점" P를 찾는다.
 *   2. 중심과 P 사이 거리 d가 r보다 작으면 겹친 것이다.
 *   3. 겹친 만큼(r − d) 중심을 P에서 멀어지는 방향으로 밀어낸다.
 * 이렇게 밀어내기만 하므로 벽을 따라 미끄러지는 움직임이 자연스럽게 생긴다.
 */
import type { Rect } from '../world/layout';

export interface Vec2 {
  x: number;
  z: number;
}

/** 원(pos, r)과 직사각형이 겹치면 pos를 밖으로 밀어낸다. */
export function pushOutOfRect(pos: Vec2, r: number, rect: Rect): void {
  // 직사각형 위에서 가장 가까운 점 = 좌표를 범위 안으로 잘라낸(clamp) 점
  const px = clamp(pos.x, rect.x1, rect.x2);
  const pz = clamp(pos.z, rect.z1, rect.z2);
  pushOutOfPoint(pos, r, px, pz);
}

/** 원과 선분(a→b, 두께 thickness)이 겹치면 밀어낸다. 문짝에 사용. */
export function pushOutOfSegment(pos: Vec2, r: number, a: Vec2, b: Vec2, thickness: number): void {
  // 선분 위의 가장 가까운 점: 벡터 AP를 AB에 정사영한 비율 t (0~1로 제한)
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lenSq = abx * abx + abz * abz;
  const t = lenSq === 0 ? 0 : clamp(((pos.x - a.x) * abx + (pos.z - a.z) * abz) / lenSq, 0, 1);
  pushOutOfPoint(pos, r + thickness / 2, a.x + t * abx, a.z + t * abz);
}

function pushOutOfPoint(pos: Vec2, r: number, px: number, pz: number): void {
  const dx = pos.x - px;
  const dz = pos.z - pz;
  const d = Math.hypot(dx, dz);
  if (d >= r) return; // 안 겹침
  if (d < 1e-6) {
    // 중심이 정확히 장애물 위에 있음 → 방향을 알 수 없으니 임의로 +x로 민다
    pos.x += r;
    return;
  }
  const push = (r - d) / d;
  pos.x += dx * push;
  pos.z += dz * push;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
