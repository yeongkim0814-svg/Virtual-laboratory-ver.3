/**
 * 기하광학 계산 (광선 하나 기준) — 반사, 굴절(스넬), 전반사, 프레넬 반사율, 분산, 얇은 렌즈
 *
 * 반사:   d' = d − 2(d·n)n                              (입사각 = 반사각)
 * 굴절:   n₁ sinθ₁ = n₂ sinθ₂  (스넬 법칙)
 *         벡터로: η = n₁/n₂,  cosθ₁ = −d·n,  sin²θ₂ = η²(1 − cos²θ₁)
 *                d' = η d + (η cosθ₁ − cosθ₂) n
 *         sin²θ₂ > 1 이면 굴절한 빛이 없다 → 전반사 (임계각 sinθc = n₂/n₁)
 * 프레넬 반사율 (편광되지 않은 빛 = s·p 평균): 면에 닿은 빛 중 되비치는 비율. 수직 입사에서 ((n₁−n₂)/(n₁+n₂))² ≈ 4 %,
 *         임계각에 가까워질수록 100 %로 커진다.
 * 분산: 코시 식 n(λ) = A + B/λ²  (λ는 μm) — 파장이 짧을수록(보라) 굴절률이 커서 더 많이 꺾인다.
 * 얇은 렌즈 (이상적): 렌즈에 닿은 평행 광선은 모두 초점면의 한 점(렌즈 중심을 지나는 광선이 닿는 점)으로 모인다.
 *         볼록(f > 0)은 그 점으로, 오목(f < 0)은 그 점에서 나온 것처럼 퍼진다.
 */
import * as THREE from 'three';

export interface Glass {
  name: string;
  /** 코시 계수 (λ: μm) */
  A: number;
  B: number;
}

/** 아크릴(PMMA): n_D = 1.490 */
export const ACRYLIC: Glass = { name: '아크릴', A: 1.4786, B: 0.00406 };
/** 플린트 유리(F2 근사): n_D = 1.620, 분산이 커서 무지개가 넓게 퍼진다 */
export const FLINT: Glass = { name: '플린트 유리', A: 1.5943, B: 0.00885 };

export function refractiveIndex(g: Glass, nm: number): number {
  const um = nm / 1000;
  return g.A + g.B / (um * um);
}

/** 반사 방향 (n: 단위 법선) */
export function reflect(d: THREE.Vector3, n: THREE.Vector3): THREE.Vector3 {
  return d.clone().addScaledVector(n, -2 * d.dot(n));
}

/**
 * 굴절 방향. n은 빛이 오는 쪽을 향한 단위 법선 (d·n < 0). 전반사면 null
 */
export function refract(d: THREE.Vector3, n: THREE.Vector3, n1: number, n2: number): THREE.Vector3 | null {
  const eta = n1 / n2;
  const cosi = -d.dot(n);
  const sin2t = eta * eta * (1 - cosi * cosi);
  if (sin2t > 1) return null;
  const cost = Math.sqrt(1 - sin2t);
  return d.clone().multiplyScalar(eta).addScaledVector(n, eta * cosi - cost).normalize();
}

/** 프레넬 반사율 (편광 없는 빛). cosi: 입사각의 코사인 (> 0) */
export function fresnel(cosi: number, n1: number, n2: number): number {
  const sint = (n1 / n2) * Math.sqrt(Math.max(0, 1 - cosi * cosi));
  if (sint >= 1) return 1;
  const cost = Math.sqrt(1 - sint * sint);
  const rs = (n1 * cosi - n2 * cost) / (n1 * cosi + n2 * cost);
  const rp = (n2 * cosi - n1 * cost) / (n2 * cosi + n1 * cost);
  return 0.5 * (rs * rs + rp * rp);
}

/** 법선과 이루는 각 (도) */
export function angleToNormal(d: THREE.Vector3, n: THREE.Vector3): number {
  return THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.abs(d.dot(n)))));
}

/**
 * 이상적인 얇은 렌즈를 지난 방향
 * @param hit 렌즈에 닿은 점, c 렌즈 중심, axis 렌즈 광축 (빛이 나아가는 쪽), f 초점 거리 (m)
 */
export function thinLens(d: THREE.Vector3, hit: THREE.Vector3, c: THREE.Vector3, axis: THREE.Vector3, f: number): THREE.Vector3 {
  const ax = axis.dot(d) >= 0 ? axis : axis.clone().negate();
  const cos = d.dot(ax);
  if (cos < 1e-3) return d.clone();
  // 렌즈 중심을 지나는 (꺾이지 않는) 광선이 초점면(렌즈에서 광축 방향으로 f)에 닿는 점
  const P = c.clone().addScaledVector(d, f / cos);
  const out = f > 0 ? P.sub(hit) : hit.clone().sub(P);
  return out.normalize();
}

/** 백색광을 나눌 파장들 (nm): 400 ~ 700, 15 nm 간격 */
export const WHITE_LINES = Array.from({ length: 21 }, (_, i) => 400 + i * 15);
