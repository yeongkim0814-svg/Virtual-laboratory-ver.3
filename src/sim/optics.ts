/**
 * 파동 광학: 슬릿을 지난 빛의 세기 분포 (프라운호퍼 회절 — 스크린이 슬릿에서 충분히 멀 때)
 *
 * 스크린 위의 한 점이 슬릿에서 본 각도 θ에 있을 때, 이웃한 두 슬릿에서 온 빛의 경로차는 d·sinθ.
 * 경로차가 파장의 정수배(d·sinθ = mλ)면 보강 간섭 → 밝은 무늬.
 *
 *   이중 슬릿 세기:  I(θ) = I₀ · cos²(α) · (sin β / β)²
 *     α = π·d·sinθ / λ   ← 두 슬릿 사이의 간섭 (무늬 간격을 정함)
 *     β = π·a·sinθ / λ   ← 슬릿 하나의 폭 a에 의한 회절 (무늬 전체의 "봉투"를 정함)
 *   단일 슬릿:       I(θ) = I₀ · (sin β / β)²
 *
 * 작은 각에서 sinθ ≈ tanθ = y/L 이므로 밝은 무늬 사이 간격  Δy = λL/d
 * → 실험에서 Δy, L, d를 재면 빛의 파장을 구할 수 있다:  λ = d·Δy / L  (영의 실험)
 */

export interface Aperture {
  kind: 'double' | 'single';
  /** 슬릿 사이 간격 (중심 ~ 중심, m) — 이중 슬릿만 */
  d: number;
  /** 슬릿 하나의 폭 (m) */
  a: number;
}

/** 슬릿 통과 후 각도 θ 방향의 상대 세기 (0~1, θ = 0에서 1) */
export function intensity(ap: Aperture, lambda: number, sinT: number): number {
  const beta = (Math.PI * ap.a * sinT) / lambda;
  const env = Math.abs(beta) < 1e-9 ? 1 : (Math.sin(beta) / beta) ** 2;
  if (ap.kind === 'single') return env;
  const alpha = (Math.PI * ap.d * sinT) / lambda;
  return Math.cos(alpha) ** 2 * env;
}

/** 스크린 위 위치 y (중앙에서의 거리)에서의 세기 — 기울기 없이 정확한 sinθ = y/√(y²+L²) 사용 */
export function intensityAt(ap: Aperture, lambda: number, y: number, L: number): number {
  return intensity(ap, lambda, y / Math.hypot(y, L));
}

/** 이론 무늬 간격 Δy = λL/d (이중 슬릿, 작은 각 근사) */
export function fringeSpacing(lambda: number, L: number, d: number): number {
  return (lambda * L) / d;
}

/** 단일 슬릿 중앙 밝은 무늬의 폭 (첫 어두운 무늬 사이) = 2λL/a */
export function centralWidth(lambda: number, L: number, a: number): number {
  return (2 * lambda * L) / a;
}

/**
 * 파장(nm) → 눈에 보이는 색 (sRGB 0~1). 가시광 380~780 nm 근사 (Dan Bruton의 방법)
 * 양 끝(보라·진한 빨강)은 눈의 감도가 낮아 어둡게 줄인다.
 */
export function wavelengthToRGB(nm: number): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  if (nm >= 380 && nm < 440) { r = -(nm - 440) / 60; b = 1; }
  else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
  else if (nm < 510) { g = 1; b = -(nm - 510) / 20; }
  else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
  else if (nm < 645) { r = 1; g = -(nm - 645) / 65; }
  else if (nm <= 780) { r = 1; }
  let f = 1;
  if (nm < 420) f = 0.3 + (0.7 * (nm - 380)) / 40;
  else if (nm > 700) f = 0.3 + (0.7 * (780 - nm)) / 80;
  return [r * f, g * f, b * f];
}
