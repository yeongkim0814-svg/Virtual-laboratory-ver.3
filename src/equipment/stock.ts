/**
 * 보관장에 기구 채워 넣기 (주 실험실 오른쪽 벽의 "실험 기구 보관장")
 *
 *   칸 0, 1 (긴 칸, 바닥)   : 스탠드 2개씩 (모두 4개)
 *   칸 2 (위 선반 2개)      : 클램프 2개씩 (모두 4개)
 *   칸 3                    : 실 2개, 각도기
 *   칸 3 아래 선반          : 용수철 2개 (k = 10 · 25 N/m)
 *   칸 4                    : 추 50 g · 100 g · 200 g, 아래 선반에 추 20 g · 150 g
 *   칸 5                    : 쇠공, 추 100 g
 *   칸 6                    : 레이저 (650 · 532 · 405 nm 선택), 스크린
 *   칸 7                    : 이중 슬릿 d = 0.10 · 0.20 mm, 단일 슬릿 a = 0.10 mm
 *   칸 6, 7 아래 선반 (불투명 문 안) : 직류 전원 장치, 마이크로전류계, 광전관 2개 (Cs · Na 음극)
 *
 * 뒤쪽 벽 낮은 수납장: 칸 0(가로로 긴 칸, 문을 아래로 젖혀 엶) 역학 레일 1.2 m, 칸 1 수레 2대 + 선반에 질량 막대 250 g × 4, 칸 2 운동 센서 2개
 * 칠판 앞 교탁: 노트북 1·2, 스탠딩 테이블: 노트북 3 (측정 프로그램)
 * 준비실 (화학 실험용):
 *   시약장 유리문 칸: 0.1 M HCl · NaOH · CH₃COOH · NH₃, 증류수 2병, 지시약 3종(페놀프탈레인·메틸 오렌지·BTB), 만능 pH 시험지
 *   유리 기구 보관장: 뷰렛 2 · 스탠드·클램프(긴 칸), 비커 6, 삼각 플라스크 2, 눈금실린더 2, pH 센서 2
 */
import type { StorageCabinet } from '../world/cabinet';
import { at, type Item } from '../world/items';
import { Clamp, Stand, hangingMass, protractor, steelBall } from './mechanics';
import { PendulumString } from './pendulumString';
import { Spring } from './spring';
import { Laser, OpticScreen, SlitPlate } from './optics';
import { DCPowerSupply, Microammeter, Phototube } from './electrical';
import { Cart, Pulley, Rail, massBar } from './track';
import { Laptop, MotionSensor, PHSensor } from './sensors';
import { Container, DropperBottle, PHPaper, REAGENTS, beaker, burette, cylinder, flask, reagentBottle } from './glassware';
import * as THREE from 'three';

export interface Stock {
  items: Item[];
  strings: PendulumString[];
  springs: Spring[];
  lasers: Laser[];
  supplies: DCPowerSupply[];
  ammeters: Microammeter[];
  tubes: Phototube[];
  rails: Rail[];
  carts: Cart[];
  laptops: Laptop[];
  motionSensors: MotionSensor[];
  phSensors: PHSensor[];
  /** 용액을 담는 그릇 전부 (시약병 포함) */
  containers: Container[];
}

export function stockEquipment(cabs: Map<string, StorageCabinet>): Stock {
  const cab = cabs.get('실험 기구 보관장')!;
  const low = cabs.get('실험 기구 수납장')!; // 뒤쪽 벽 낮은 수납장
  const chem = cabs.get('시약장')!;
  const glass = cabs.get('유리 기구 보관장')!;
  const bottles = REAGENTS.map((r) => reagentBottle(r));
  const water2 = reagentBottle(REAGENTS.find((r) => r.id === 'H2O')!);
  const beakers = [1, 2, 3, 4, 5, 6].map((n) => beaker(n));
  const flasks = [1, 2].map((n) => flask(n));
  const cylinders = [1, 2].map((n) => cylinder(n));
  const burettes = [1, 2].map((n) => burette(n));
  const phSensors = [new PHSensor('pH 센서 1'), new PHSensor('pH 센서 2')];
  const containers: Container[] = [...bottles, water2, ...beakers, ...flasks, ...cylinders, ...burettes];
  const strings = [new PendulumString(), new PendulumString()];
  // 용수철: k, 자연 길이, 자기 질량, 탄성 한계 늘어남
  const springs = [
    new Spring({ k: 10, L0: 0.1, ms: 0.012, limit: 0.35 }, 0xb8bcc0, '용수철 k 10 N/m'),
    new Spring({ k: 25, L0: 0.08, ms: 0.02, limit: 0.3 }, 0xc9a456, '용수철 k 25 N/m'),
  ];
  const lasers = [new Laser()];
  const supplies = [new DCPowerSupply()];
  const ammeters = [new Microammeter()];
  // 일함수: 세슘 2.14 eV (문턱 파장 579 nm), 나트륨 2.28 eV (544 nm) → 빨강 650 nm로는 둘 다 전자가 안 나옴
  const tubes = [new Phototube('Cs', 2.14), new Phototube('Na', 2.28)];
  const rails = [new Rail()];
  const carts = [new Cart('수레 A', 0x2f6fb0), new Cart('수레 B', 0xd07a2a)];
  // 교탁(높이 0.76 m): 화면이 실험실 쪽(+x)을 보게 90° 돌려 놓는다. 스탠딩 테이블(1.05 m): 교사 쪽(−x)을 보게
  const laptops = [new Laptop('노트북 1'), new Laptop('노트북 2'), new Laptop('노트북 3')];
  const motionSensors = [new MotionSensor('운동 센서 1'), new MotionSensor('운동 센서 2')];
  const desk = (it: Item, x: number, z: number, yaw: number, y = 0.76) => {
    at(it, new THREE.Vector3(x, y, z));
    it.object.rotation.y = yaw;
    it.yaw = yaw;
    return it;
  };
  const items: Item[] = [
    desk(laptops[0], 2.2, 2.2, Math.PI / 2),
    desk(laptops[1], 2.2, 3.3, Math.PI / 2),
    desk(laptops[2], 2.15, 4.92, -Math.PI / 2, 1.05),
    // 뒤쪽 벽 수납장: 칸 0(가로로 긴 칸, 젖히는 문) 레일, 칸 1 수레(바닥)·질량 막대(선반), 칸 2 운동 센서
    at(rails[0], low.slot(0, 0, 0.5)),
    at(carts[0], low.slot(1, 0, 0.25)),
    at(carts[1], low.slot(1, 0, 0.75)),
    ...[0.15, 0.38, 0.62, 0.85].map((t) => at(massBar(), low.slot(1, 1, t))),
    // 시약장 (유리문 칸, 선반 2): 칸 2 = HCl·NaOH·증류수, 칸 3 = CH₃COOH·NH₃·증류수, 칸 4 = 지시약·시험지
    at(bottles[0], chem.slot(2, 2, 0.1)),
    at(bottles[1], chem.slot(2, 2, 0.5)),
    at(bottles[4], chem.slot(2, 2, 0.9)),
    at(bottles[2], chem.slot(3, 2, 0.1)),
    at(bottles[3], chem.slot(3, 2, 0.5)),
    at(water2, chem.slot(3, 2, 0.9)),
    at(new DropperBottle('php', 0xe8e8e8), chem.slot(4, 2, 0.1)),
    at(new DropperBottle('mo', 0xd8602a), chem.slot(4, 2, 0.37)),
    at(new DropperBottle('btb', 0x3a6fd0), chem.slot(4, 2, 0.63)),
    at(new PHPaper(), chem.slot(4, 2, 0.9)),
    // 유리 기구 보관장: 긴 칸 0 = 뷰렛, 긴 칸 1 = 스탠드·클램프, 유리문 칸 = 비커·플라스크·눈금실린더
    at(burettes[0], glass.slot(0, 0, 0.3)),
    at(burettes[1], glass.slot(0, 0, 0.7)),
    at(new Stand(), glass.slot(1, 0, 0.5)),
    at(new Clamp(), glass.slot(4, 1, 0.5)),
    ...beakers.slice(0, 4).map((b, i) => at(b, glass.slot(2, 2, 0.1 + i * 0.27))),
    ...beakers.slice(4).map((b, i) => at(b, glass.slot(2, 1, 0.2 + i * 0.6))),
    at(flasks[0], glass.slot(3, 2, 0.2)),
    at(flasks[1], glass.slot(3, 2, 0.8)),
    at(cylinders[0], glass.slot(4, 2, 0.25)),
    at(cylinders[1], glass.slot(4, 2, 0.75)),
    at(phSensors[0], glass.slot(5, 2, 0.3)),
    at(phSensors[1], glass.slot(5, 2, 0.7)),
    at(motionSensors[0], low.slot(2, 0, 0.25)),
    at(motionSensors[1], low.slot(2, 0, 0.75)),
    at(new Pulley(), low.slot(3, 0, 0.5)),
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
    at(springs[0], cab.slot(3, 1, 0.3)),
    at(springs[1], cab.slot(3, 1, 0.7)),
    at(hangingMass(20, 0.009, 0.011), cab.slot(4, 1, 0.3)),
    at(hangingMass(150, 0.015, 0.026), cab.slot(4, 1, 0.7)),
    at(steelBall(), cab.slot(5, 2, 0.3)),
    at(hangingMass(100, 0.013, 0.022), cab.slot(5, 2, 0.75)),
    // ---- 광학 ----
    at(lasers[0], cab.slot(6, 2, 0.5)),
    at(new OpticScreen(), cab.slot(6, 3)),
    // 슬릿 폭 a는 간격 d의 1/5 (학생용 슬릿과 비슷한 비율) → 회절 봉투 안에 밝은 무늬가 9개쯤
    at(new SlitPlate({ kind: 'double', d: 0.10e-3, a: 0.02e-3 }, '이중 슬릿 d 0.10 mm'), cab.slot(7, 2, 0.15)),
    at(new SlitPlate({ kind: 'double', d: 0.20e-3, a: 0.04e-3 }, '이중 슬릿 d 0.20 mm'), cab.slot(7, 2, 0.5)),
    at(new SlitPlate({ kind: 'single', d: 0, a: 0.10e-3 }, '단일 슬릿 a 0.10 mm'), cab.slot(7, 2, 0.85)),
    // ---- 광전 효과 (아래 선반, 높이 0.52 m) ----
    at(supplies[0], cab.slot(6, 1, 0.5)),
    at(ammeters[0], cab.slot(7, 1, 0.15)),
    at(tubes[0], cab.slot(7, 1, 0.55)),
    at(tubes[1], cab.slot(7, 1, 0.85)),
  ];
  return { items, strings, springs, lasers, supplies, ammeters, tubes, rails, carts, laptops, motionSensors, phSensors, containers };
}
