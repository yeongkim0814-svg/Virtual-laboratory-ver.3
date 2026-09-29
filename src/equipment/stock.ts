/**
 * 보관장에 기구 채워 넣기 (주 실험실 오른쪽 벽의 "실험 기구 보관장")
 *
 *   칸 0, 1 (긴 칸, 바닥)   : 스탠드 2개
 *   칸 2 (위 선반 2개)      : 클램프 2개
 *   칸 3                    : 실 2개, 각도기
 *   칸 4                    : 추 50 g · 100 g · 200 g
 *   칸 5                    : 쇠공, 추 100 g
 *   칸 6, 7                 : 비어 있음 (광학 기구 자리)
 */
import type { StorageCabinet } from '../world/cabinet';
import { at, type Item } from '../world/items';
import { Clamp, Stand, hangingMass, protractor, steelBall } from './mechanics';
import { PendulumString } from './pendulumString';

export interface Stock {
  items: Item[];
  strings: PendulumString[];
}

export function stockMechanics(cab: StorageCabinet): Stock {
  const strings = [new PendulumString(), new PendulumString()];
  const items: Item[] = [
    at(new Stand(), cab.slot(0, 0)),
    at(new Stand(), cab.slot(1, 0)),
    at(new Clamp(), cab.slot(2, 2, 0.15)),
    at(new Clamp(), cab.slot(2, 3, 0.15)),
    at(strings[0], cab.slot(3, 2, 0.25)),
    at(strings[1], cab.slot(3, 2, 0.75)),
    at(protractor(), cab.slot(3, 3)),
    // 황동 추: 반지름·높이는 질량 = 8500 kg/m³ × πr²h 에서 정함
    at(hangingMass(50, 0.011, 0.0155), cab.slot(4, 2, 0.15)),
    at(hangingMass(100, 0.013, 0.022), cab.slot(4, 2, 0.5)),
    at(hangingMass(200, 0.016, 0.029), cab.slot(4, 2, 0.85)),
    at(steelBall(), cab.slot(5, 2, 0.3)),
    at(hangingMass(100, 0.013, 0.022), cab.slot(5, 2, 0.75)),
  ];
  return { items, strings };
}
