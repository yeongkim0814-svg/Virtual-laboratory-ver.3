/**
 * 아트 디렉션 팔레트 — 이 세계는 "한 무명 기관의 낡은 산업 시설 실험실, 늦은 밤"이다.
 * 모든 기구·가구·벽은 이 색 계열(올리브 · 카키 · 숯색 · 때 낀 베이지 + 절제된 산화 주황·호박 불빛)에서만 고른다.
 * 쓰면 안 되는 것: 순백, 채도 높은 파랑, 반짝이는 크롬, 네온. 기능 색(저항 색띠 · LED · 시약 · 지시약 · 도선 · 레이저)은 예외 — 교육 내용이다.
 * 후처리(render/retro.ts)가 채도를 한 번 더 낮추고 올리브 노랑으로 물들이므로 여기 값은 "화면에 나오기 전" 색이다.
 */
import * as THREE from 'three';

export const COL = {
  // ---- 도장 금속 (보관장·문·기구 몸체) ----
  oliveMid: 0x59603f, // 군용 올리브
  oliveDark: 0x363d2a, // 어두운 탁한 초록
  khaki: 0x8d8761, // 먼지 낀 카키
  khakiDark: 0x6c694a,
  // ---- 철·고무·전자 ----
  steelDark: 0x2c2e29, // 어두운 강철 (다리·틀)
  steelMid: 0x4b4f44,
  aluminum: 0x8c8f82, // 삭은 알루미늄 (레일·클램프)
  brass: 0xa68a45, // 닳은 놋쇠
  charcoal: 0x242523, // 숯색 (전자부품 하우징)
  rubber: 0x1a1b19,
  // ---- 작업대·바닥·벽 ----
  laminate: 0xa59c79, // 긁힌 베이지 라미네이트
  laminateDark: 0x857a5a,
  benchTop: 0x34372b, // 어두운 올리브 회색 금속 (레이저 빛 대비 유지)
  woodDark: 0x4a3b2a, // 낡은 짙은 나무 포인트
  wallStain: 0xa59d82, // 니코틴 베이지
  floorTile: 0x7b816b, // 회녹색 타일
  grout: 0x2e3228,
  // ---- 유리 ----
  glass: 0x7f9a98, // 연기 낀 청록 회색
  glassDark: 0x5d7673,
  // ---- 경고·표시 (조금만) ----
  hazardOrange: 0xc4701c, // 산화 주황
  hazardYellow: 0xb9a02c, // 바랜 안전 노랑
  amber: 0xd89a2e, // 어두운 호박
  cyan: 0x6fc4c0,
  green: 0x7fbf6a,
  red: 0xc0452e, // 경고·잘못된 배치에만
} as const;

/** 공용 재질: 같은 재질 하나를 여러 곳이 쓰면 후처리 패치도 한 번만 적용된다 */
const cache = new Map<number, THREE.MeshLambertMaterial>();
export function lambert(color: number): THREE.MeshLambertMaterial {
  let m = cache.get(color);
  if (!m) cache.set(color, (m = new THREE.MeshLambertMaterial({ color })));
  return m;
}

/** 연기 낀 유리 재질 (불투명도 0.38, 청록 회색) */
export function smokyGlass(opacity = 0.38): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color: COL.glass, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
}
