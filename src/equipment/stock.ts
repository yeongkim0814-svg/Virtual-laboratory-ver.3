/**
 * 보관장에 기구 채워 넣기 (주 실험실 오른쪽 벽의 "실험 기구 보관장")
 *
 *   칸 0, 1 (긴 칸, 바닥)   : 스탠드 2개씩 (모두 4개)
 *   칸 2 (위 선반 2개)      : 클램프 2개씩 (모두 4개)
 *   칸 3                    : 실 2개, 각도기
 *   칸 4                    : 추 50 g · 100 g · 200 g
 *   칸 5                    : 쇠공, 추 100 g
 *   칸 6                    : 레이저 (650 · 532 · 405 nm 선택), 스크린
 *   칸 7                    : 이중 슬릿 d = 0.10 · 0.20 mm, 단일 슬릿 a = 0.10 mm
 */
import type { StorageCabinet } from '../world/cabinet';
import { at, type Item } from '../world/items';
import { Clamp, Stand, hangingMass, protractor, steelBall } from './mechanics';
import { PendulumString } from './pendulumString';
import { Laser, OpticScreen, SlitPlate } from './optics';

export interface Stock {
  items: Item[];
  strings: PendulumString[];
  lasers: Laser[];
}

export function stockEquipment(cab: StorageCabinet): Stock {
  const strings = [new PendulumString(), new PendulumString()];
  const lasers = [new Laser()];
  const items: Item[] = [
    at(new Stand(), cab.slot(0, 0, 0.2)),
    at(new Stand(), cab.slot(0, 0, 0.8)),
    at(new Stand(), cab.slot(1, 0, 0.2)),
    at(new Stand(), cab.slot(1, 0, 0.8)),
    // 클램프는 팔이 +z로 22 cm 뻗으므로 한 선반에 두 개를 z 방향으로 나란히
    at(new Clamp(), cab.slot(2, 2, 0.0)),
    at(new Clamp(), cab.slot(2, 2, 0.5)),
    at(new Clamp(), cab.slot(2, 3, 0.0)),
    at(new Clamp(), cab.slot(2, 3, 0.5)),
    at(strings[0], cab.slot(3, 2, 0.25)),
    at(strings[1], cab.slot(3, 2, 0.75)),
    at(protractor(), cab.slot(3, 3)),
    // 황동 추: 반지름·높이는 질량 = 8500 kg/m³ × πr²h 에서 정함
    at(hangingMass(50, 0.011, 0.0155), cab.slot(4, 2, 0.15)),
    at(hangingMass(100, 0.013, 0.022), cab.slot(4, 2, 0.5)),
    at(hangingMass(200, 0.016, 0.029), cab.slot(4, 2, 0.85)),
    at(steelBall(), cab.slot(5, 2, 0.3)),
    at(hangingMass(100, 0.013, 0.022), cab.slot(5, 2, 0.75)),
    // ---- 광학 ----
    at(lasers[0], cab.slot(6, 2, 0.5)),
    at(new OpticScreen(), cab.slot(6, 3)),
    // 슬릿 폭 a는 간격 d의 1/5 (학생용 슬릿과 비슷한 비율) → 회절 봉투 안에 밝은 무늬가 9개쯤
    at(new SlitPlate({ kind: 'double', d: 0.10e-3, a: 0.02e-3 }, '이중 슬릿 d 0.10 mm'), cab.slot(7, 2, 0.15)),
    at(new SlitPlate({ kind: 'double', d: 0.20e-3, a: 0.04e-3 }, '이중 슬릿 d 0.20 mm'), cab.slot(7, 2, 0.5)),
    at(new SlitPlate({ kind: 'single', d: 0, a: 0.10e-3 }, '단일 슬릿 a 0.10 mm'), cab.slot(7, 2, 0.85)),
  ];
  return { items, strings, lasers };
}
