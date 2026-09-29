/**
 * 손으로 집고 놓을 수 있는 실험 물체
 *
 * 모든 물체는 "바닥면 중심"이 원점이 되도록 만든다.
 * → 어떤 면 위에 놓을 때 그 면의 높이 y에 그대로 두면 딱 올라앉는다.
 * mass(질량)는 화면에 표시하지 않고, 나중에 역학 실험에서 계산에 사용한다.
 */
import * as THREE from 'three';
import type { Interactable } from './interactable';

const HITBOX_MAT = new THREE.MeshBasicMaterial({ visible: false });

export class Item implements Interactable {
  onPick: (item: Item) => void = () => {};

  constructor(
    readonly object: THREE.Group,
    readonly name: string,
    /** 위에서 본 반지름 (m) — 겹침 판정용 */
    readonly radius: number,
    /** 질량 (kg) */
    readonly mass: number,
  ) {
    // 작은 물체도 손가락으로 쉽게 탭할 수 있도록, 보이지 않는 더 큰 원기둥을 터치 판정용으로 붙인다
    // (material.visible = false → 그려지지 않지만 광선(raycast)에는 맞는다)
    const box = new THREE.Box3().setFromObject(object);
    const h = Math.max(box.max.y - box.min.y, 0.08) + 0.02;
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(radius, 0.06), Math.max(radius, 0.06), h, 12), HITBOX_MAT);
    hit.position.y = h / 2;
    object.add(hit);
    object.userData.item = this;
  }

  label(): string {
    return `집기 · ${this.name}`; // 조준점 아래 안내 문구
  }

  interact(): void {
    this.onPick(this);
  }
}

// ---- 재질 ----
const glass = () =>
  new THREE.MeshLambertMaterial({ color: 0xcfe6e0, transparent: true, opacity: 0.4, depthWrite: false });
const liquid = (color: number) => new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.8 });

function beaker(liquidColor: number): THREE.Group {
  const g = new THREE.Group();
  const r = 0.04;
  const h = 0.1;
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 8, 1, true), glass());
  wall.position.y = h / 2;
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(r, 8), glass());
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = 0.002;
  const water = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.94, r * 0.94, h * 0.55, 8), liquid(liquidColor));
  water.position.y = (h * 0.55) / 2 + 0.003;
  g.add(water, wall, bottom);
  return g;
}

function flask(liquidColor: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.055, 0.1, 8, 1, true), glass());
  body.position.y = 0.05;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.06, 6, 1, true), glass());
  neck.position.y = 0.13;
  const water = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.052, 0.035, 8), liquid(liquidColor));
  water.position.y = 0.0185;
  g.add(water, body, neck);
  return g;
}

function hangingMass(): THREE.Group {
  const g = new THREE.Group();
  const brass = new THREE.MeshLambertMaterial({ color: 0xc9a54a });
  // 황동(밀도 ≈ 8500 kg/m³) 100 g → 부피 ≈ 11.8 cm³ → 반지름 1.3 cm, 높이 2.2 cm
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.022, 8), brass);
  body.position.y = 0.011;
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.007, 0.002, 4, 8), brass);
  hook.position.y = 0.03;
  g.add(body, hook);
  return g;
}

function woodBlock(): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.07), new THREE.MeshLambertMaterial({ color: 0xc89b62 }));
  m.position.y = 0.025;
  g.add(m);
  return g;
}

function steelBall(): THREE.Group {
  const g = new THREE.Group();
  const r = 0.025;
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), new THREE.MeshLambertMaterial({ color: 0xb4b8b6 }));
  m.position.y = r;
  g.add(m);
  return g;
}

/** 실험실에 처음 놓여 있는 물체들 (위치: 가구 윗면 위) */
export function createItems(): Item[] {
  const items: [THREE.Group, string, number, number, [number, number, number]][] = [
    // [모양, 이름, 반지름, 질량(kg), 위치(x, y, z)]
    // 질량 = 부피 × 밀도로 계산한 값 (예: 쇠공 4/3·π·(0.025 m)³ × 7850 kg/m³ ≈ 0.51 kg)
    [beaker(0x4a9fd8), '비커 (물)', 0.045, 0.38, [5.0, 0.85, 2.4]],
    [flask(0xd86a8a), '삼각 플라스크', 0.058, 0.17, [5.7, 0.85, 2.7]],
    [hangingMass(), '추 100 g', 0.015, 0.1, [8.5, 0.85, 2.3]],
    [woodBlock(), '나무 도막', 0.065, 0.21, [9.0, 0.85, 2.9]],
    [steelBall(), '쇠공', 0.03, 0.51, [9.4, 0.85, 2.3]],
    [beaker(0xe0c040), '비커 (용액)', 0.045, 0.38, [14.6, 0.85, 0.55]],
  ];
  return items.map(([g, name, r, m, [x, y, z]]) => {
    g.position.set(x, y, z);
    return new Item(g, name, r, m);
  });
}
