/**
 * layout.ts의 도면 데이터로 3D 실험실(바닥·벽·천장·조명)을 만든다.
 * 아직 가구·실험 기구는 넣지 않는다 — 빈 방 구조만.
 */
import * as THREE from 'three';
import {
  DOOR, DOOR_HEIGHT, MAIN_ROOM, PARTITION, PREP_ROOM, ROOMS,
  WALLS, WALL_HEIGHT, WALL_THICKNESS, type Rect,
} from './layout';

export function buildLab(scene: THREE.Scene): void {
  scene.background = new THREE.Color(0x20242a);

  // ---- 바닥: 0.5 m 타일 무늬 (움직임을 눈으로 느끼게 해 준다) ----
  const T = WALL_THICKNESS;
  const floorW = PREP_ROOM.x2 - MAIN_ROOM.x1 + 2 * T;
  const floorD = MAIN_ROOM.z2 - MAIN_ROOM.z1 + 2 * T;
  const tile = makeTileTexture();
  tile.repeat.set(floorW / 0.5, floorD / 0.5);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(floorW, floorD),
    new THREE.MeshStandardMaterial({ map: tile, roughness: 0.85 }),
  );
  floor.rotation.x = -Math.PI / 2; // 세워진 평면을 눕힌다
  floor.position.set(MAIN_ROOM.x1 - T + floorW / 2, 0, MAIN_ROOM.z1 - T + floorD / 2);
  scene.add(floor);

  // ---- 천장 ----
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(floorW, floorD),
    // 천장은 아래를 향해 반구광의 어두운 '바닥 색'만 받으므로, 약간 스스로 빛나게 해서 보정
    new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 1, emissive: 0x6a6a66 }),
  );
  ceiling.rotation.x = Math.PI / 2; // 아래를 향하도록
  ceiling.position.set(floor.position.x, WALL_HEIGHT, floor.position.z);
  scene.add(ceiling);

  // ---- 벽: 충돌용 직사각형을 그대로 높이만 줘서 상자로 세운다 ----
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xeeebe3, roughness: 0.9 });
  for (const w of WALLS) addBox(scene, w, 0, WALL_HEIGHT, wallMat);

  // 문 위쪽 벽(상인방)과 문틀
  addBox(scene, { x1: PARTITION.x1, z1: DOOR.z1, x2: PARTITION.x2, z2: DOOR.z2 }, DOOR_HEIGHT, WALL_HEIGHT, wallMat);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.6 });
  const f = 0.06;
  addBox(scene, { x1: PARTITION.x1, z1: DOOR.z1, x2: PARTITION.x2, z2: DOOR.z1 + f }, 0, DOOR_HEIGHT, frameMat);
  addBox(scene, { x1: PARTITION.x1, z1: DOOR.z2 - f, x2: PARTITION.x2, z2: DOOR.z2 }, 0, DOOR_HEIGHT, frameMat);
  addBox(scene, { x1: PARTITION.x1, z1: DOOR.z1, x2: PARTITION.x2, z2: DOOR.z2 }, DOOR_HEIGHT - f, DOOR_HEIGHT, frameMat);

  // ---- 조명 ----
  // 반구광: 위(천장)에서 밝은 빛, 아래(바닥)에서 약한 반사광 → 실내의 은은한 전체 조명
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9a958a, 2.6));
  // 방향광: 벽면마다 밝기가 달라져 입체감이 생긴다
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(-4, 10, 6);
  scene.add(sun);

  // 천장 형광등 패널 (스스로 빛나는 사각형 — 실제 광원 계산은 하지 않음)
  const panelMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const { rect } of ROOMS) {
    const cols = Math.max(1, Math.round((rect.x2 - rect.x1) / 3));
    const rows = Math.max(1, Math.round((rect.z2 - rect.z1) / 3));
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), panelMat);
        panel.rotation.x = Math.PI / 2;
        panel.position.set(
          rect.x1 + ((i + 0.5) * (rect.x2 - rect.x1)) / cols,
          WALL_HEIGHT - 0.01,
          rect.z1 + ((j + 0.5) * (rect.z2 - rect.z1)) / rows,
        );
        scene.add(panel);
      }
    }
  }
}

/** 도면의 직사각형을 높이 y1~y2의 상자로 세운다. */
function addBox(scene: THREE.Scene, r: Rect, y1: number, y2: number, mat: THREE.Material): void {
  const box = new THREE.Mesh(new THREE.BoxGeometry(r.x2 - r.x1, y2 - y1, r.z2 - r.z1), mat);
  box.position.set((r.x1 + r.x2) / 2, (y1 + y2) / 2, (r.z1 + r.z2) / 2);
  scene.add(box);
}

/** 캔버스에 타일 한 장을 그려 텍스처로 만든다 (이미지 파일이 필요 없음). */
function makeTileTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c9c6bd';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#b3afa4';
  g.fillRect(0, 0, 128, 3); // 줄눈
  g.fillRect(0, 0, 3, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
