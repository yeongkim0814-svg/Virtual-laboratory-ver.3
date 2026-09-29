/**
 * 전선(케이블) 그리기 — 전원선과 도선이 함께 쓴다
 *
 * 1픽셀짜리 선(Line)은 480×270 저해상도 화면에서 책상 윗면과 깊이가 거의 같아 묻혀 버린다.
 * 그래서 반지름 몇 mm의 가느다란 관(tube) 메시로 그린다: 점 N개마다 둘레 R개의 꼭짓점 고리.
 * 점이 바뀌면 같은 버퍼의 좌표만 다시 채운다 (매 프레임 새 메시를 만들지 않음).
 *
 * 또 선이 가구를 뚫고 지나가지 않도록, 가운데 점들은 그 아래 가구 윗면보다 위로 올린다 (liftAboveFurniture).
 */
import * as THREE from 'three';
import { FURNITURE } from './layout';

const RING = 4; // 둘레 꼭짓점 수 (로우폴리)

export class Cable {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private nor: Float32Array;

  constructor(readonly count: number, private radius: number, color: number) {
    this.pos = new Float32Array(count * RING * 3);
    this.nor = new Float32Array(count * RING * 3);
    const idx: number[] = [];
    for (let i = 0; i < count - 1; i++) {
      for (let k = 0; k < RING; k++) {
        const a = i * RING + k;
        const b = i * RING + ((k + 1) % RING);
        idx.push(a, a + RING, b, b, a + RING, b + RING);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3));
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.35) }));
    this.mesh.raycast = () => {};
    this.mesh.frustumCulled = false;
    this.mesh.userData.noPick = true;
  }

  /** 점 count개를 지나는 관으로 모양을 바꾼다 */
  setPoints(p: THREE.Vector3[]): void {
    const t = new THREE.Vector3();
    const prevT = new THREE.Vector3(1, 0, 0);
    const n = new THREE.Vector3();
    const b = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < this.count; i++) {
      // 접선: 앞뒤 점을 잇는 방향 (길이 0이면 앞 고리 방향을 그대로)
      t.subVectors(p[Math.min(i + 1, this.count - 1)], p[Math.max(i - 1, 0)]);
      if (t.lengthSq() < 1e-12) t.copy(prevT);
      else t.normalize();
      prevT.copy(t);
      n.crossVectors(t, up);
      if (n.lengthSq() < 1e-6) n.set(1, 0, 0); // 수직으로 내려가는 구간
      n.normalize();
      b.crossVectors(t, n);
      for (let k = 0; k < RING; k++) {
        const a = (k / RING) * Math.PI * 2 + Math.PI / 4;
        const dx = Math.cos(a) * n.x + Math.sin(a) * b.x;
        const dy = Math.cos(a) * n.y + Math.sin(a) * b.y;
        const dz = Math.cos(a) * n.z + Math.sin(a) * b.z;
        const j = (i * RING + k) * 3;
        this.pos[j] = p[i].x + this.radius * dx;
        this.pos[j + 1] = p[i].y + this.radius * dy;
        this.pos[j + 2] = p[i].z + this.radius * dz;
        this.nor[j] = dx;
        this.nor[j + 1] = dy;
        this.nor[j + 2] = dz;
      }
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
  }
}

/** (x, z) 바로 아래 가구 윗면 높이 (없으면 바닥 0) */
export function surfaceBelow(x: number, z: number, maxY = Infinity): number {
  let y = 0;
  for (const f of FURNITURE) {
    const r = f.rect;
    if (f.height <= maxY && f.height > y && x >= r.x1 && x <= r.x2 && z >= r.z1 && z <= r.z2) y = f.height;
  }
  return y;
}

/**
 * 가운데 점들이 가구 윗면·바닥을 뚫지 않게 올린다 (양 끝점은 그대로).
 * 끝점보다 높은 가구(예: 보관장 위)로는 올라가지 않는다 — 선이 그 옆을 지나간다고 본다.
 */
export function liftAboveFurniture(pts: THREE.Vector3[], clearance: number): void {
  const top = Math.max(pts[0].y, pts[pts.length - 1].y) + 0.05;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    p.y = Math.max(p.y, surfaceBelow(p.x, p.z, top) + clearance);
  }
}
