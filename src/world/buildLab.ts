/**
 * layout.ts의 도면 데이터로 3D 실험실(바닥·벽·천장·조명)을 만든다.
 * 레트로 스타일: 저해상도 픽셀 텍스처 + 어둑한 점광원 + 안개.
 */
import * as THREE from 'three';
import {
  DOOR, DOOR_HEIGHT, MAIN_ROOM, PARTITION, PREP_ROOM, ROOMS,
  WALLS, WALL_HEIGHT, WALL_THICKNESS, type Rect,
} from './layout';
import { ceilingTexture, floorTexture, grimeTexture, wallTexture, worldUV } from '../render/textures';
import { COL } from '../render/palette';

const FOG_COLOR = 0x0e100a;

/** 실험실을 만들고, 매 프레임 호출할 조명 갱신 함수를 돌려준다 (형광등 깜빡임) */
export function buildLab(scene: THREE.Scene): (time: number) => void {
  scene.background = new THREE.Color(FOG_COLOR);
  // 안개: 4 m부터 옅어지기 시작해 20 m에서 완전히 가려짐 → 먼 곳이 어둠에 묻힌다
  scene.fog = new THREE.Fog(FOG_COLOR, 4, 20);

  const T = WALL_THICKNESS;
  const whole: Rect = { x1: MAIN_ROOM.x1 - T, z1: MAIN_ROOM.z1 - T, x2: PREP_ROOM.x2 + T, z2: MAIN_ROOM.z2 + T };

  // ---- 바닥·천장: 얇은 상자로 만들어 worldUV를 그대로 쓴다 ----
  addBox(scene, whole, -0.1, 0, new THREE.MeshLambertMaterial({ map: floorTexture() }), 1);
  addBox(scene, whole, WALL_HEIGHT, WALL_HEIGHT + 0.1, new THREE.MeshLambertMaterial({ map: ceilingTexture(), color: 0xc8c4ac }), 1.2);

  // ---- 벽 (텍스처 한 장 = 가로 1 m × 세로 3 m) ----
  const wallMat = new THREE.MeshLambertMaterial({ map: wallTexture() });
  for (const w of WALLS) addBox(scene, w, 0, WALL_HEIGHT, wallMat, 2, WALL_HEIGHT);

  // 문 위쪽 벽(상인방)과 문틀
  addBox(scene, { x1: PARTITION.x1, z1: DOOR.z1, x2: PARTITION.x2, z2: DOOR.z2 }, DOOR_HEIGHT, WALL_HEIGHT, wallMat, 2, WALL_HEIGHT);
  const frameMat = new THREE.MeshLambertMaterial({ map: grimeTexture(), color: COL.steelMid }); // 어두운 강철 문틀
  const f = 0.06;
  addBox(scene, { x1: PARTITION.x1, z1: DOOR.z1, x2: PARTITION.x2, z2: DOOR.z1 + f }, 0, DOOR_HEIGHT, frameMat, 1);
  addBox(scene, { x1: PARTITION.x1, z1: DOOR.z2 - f, x2: PARTITION.x2, z2: DOOR.z2 }, 0, DOOR_HEIGHT, frameMat, 1);
  addBox(scene, { x1: PARTITION.x1, z1: DOOR.z1, x2: PARTITION.x2, z2: DOOR.z2 }, DOOR_HEIGHT - f, DOOR_HEIGHT, frameMat, 1);

  // ---- 조명 ----
  // 약한 전체광: 불빛이 닿지 않는 곳도 완전히 새까맣지는 않게
  // 조명은 모든 레이어를 비춘다 (손에 든 물체는 레이어 1에서 따로 그려지므로)
  const ambient = new THREE.AmbientLight(0x7a8663, 0.5);
  ambient.layers.enableAll();
  scene.add(ambient);

  // 천장 형광등: 패널 하나마다 바로 아래에 점광원 하나 → 빛 웅덩이가 패널 위치와 정확히 일치
  // 광원 하나마다 모든 픽셀에서 계산이 늘어나므로(태블릿 성능) 패널은 약 4 m 간격으로 듬성듬성
  const fixtures: { panel: THREE.Mesh; light: THREE.PointLight }[] = [];
  for (const { rect } of ROOMS) {
    const cols = Math.max(1, Math.round((rect.x2 - rect.x1) / 4));
    const rows = Math.max(1, Math.round((rect.z2 - rect.z1) / 3.8));
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = rect.x1 + ((i + 0.5) * (rect.x2 - rect.x1)) / cols;
        const z = rect.z1 + ((j + 0.5) * (rect.z2 - rect.z1)) / rows;
        const panel = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.6), new THREE.MeshBasicMaterial({ color: 0xeedc9a }));
        panel.position.set(x, WALL_HEIGHT - 0.02, z);
        const light = new THREE.PointLight(0xf0d994, 8.5 + 3 * Math.abs(Math.sin(i * 12.9 + j * 78.2)), 11, 1.6); // 밝기가 형광등마다 조금씩 다름
        light.layers.enableAll(); // 손에 든 물체(레이어 1)도 비춘다
        light.position.set(x, WALL_HEIGHT - 0.25, z);
        scene.add(panel, light);
        fixtures.push({ panel, light });
      }
    }
  }

  // 준비실 안쪽 형광등 하나가 가끔 깜빡인다 (분위기용) — 패널 밝기와 광원이 함께 깜빡임
  const flicker = fixtures[fixtures.length - 1];
  const base = flicker.light.intensity;
  const panelColor = (flicker.panel.material as THREE.MeshBasicMaterial).color;
  const on = panelColor.clone();
  const off = on.clone().multiplyScalar(0.25);
  return (time: number) => {
    // 느린 사인파로 "깜빡일 시기"를 정하고, 그때만 빠르게 켜졌다 꺼졌다
    const phase = Math.sin(time * 0.7) + Math.sin(time * 1.9);
    const lit = phase < 1.6 || Math.sin(time * 47) > 0;
    flicker.light.intensity = lit ? base : base * 0.15;
    panelColor.copy(lit ? on : off);
  };
}

/** 도면의 직사각형을 높이 y1~y2의 상자로 세운다 (텍스처는 실제 크기 기준). */
function addBox(scene: THREE.Scene, r: Rect, y1: number, y2: number, mat: THREE.Material, su: number, sv = su): void {
  const geo = new THREE.BoxGeometry(r.x2 - r.x1, y2 - y1, r.z2 - r.z1);
  const box = new THREE.Mesh(geo, mat);
  box.position.set((r.x1 + r.x2) / 2, (y1 + y2) / 2, (r.z1 + r.z2) / 2);
  worldUV(geo, box.position, su, sv);
  scene.add(box);
}
