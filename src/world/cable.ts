/**
 * 전선(케이블) 그리기 — 전원선과 도선이 함께 쓴다
 *
 * 1픽셀짜리 선(Line)은 480×270 저해상도 화면에서 책상 윗면과 깊이가 거의 같아 묻혀 버린다.
 * 그래서 반지름 몇 mm의 가느다란 관(tube) 메시로 그린다: 점 N개마다 둘레 R개의 꼭짓점 고리.
 * 점이 바뀌면 같은 버퍼의 좌표만 다시 채운다 (매 프레임 새 메시를 만들지 않음).
 *
 * 선의 경로(장비를 돌아가기, 책상 가장자리 넘기)는 routing.ts로 정하고, settle()로 점을 고르게 나눈다.
 */
import * as THREE from 'three';
import { FURNITURE } from './layout';
import { edgeToward, rectBox, route2D, type Box2, type P2, type Rect2 } from './routing';

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

/** 장비 상자 하나: 위에서 본 (돌려 놓인) 직사각형 + 아래·윗면 높이. owner = 그 상자가 속한 기구 조립체 */
export interface Obstacle extends Box2 {
  bottom: number;
  top: number;
  owner?: THREE.Object3D;
}

/**
 * 장비 상자: main.ts가 매 프레임 장면에 놓인 기구마다 (보이는 부품을 합친) 상자 하나씩 채운다.
 * 전선은 같은 면 위에 놓인 장비를 옆으로 돌아간다.
 */
export const equipmentBoxes: Obstacle[] = [];

/** 높이 y의 면(책상·바닥) 위에 서 있는 장비들의 바닥 자리 */
export function obstaclesOn(y: number): Box2[] {
  return equipmentBoxes.filter((b) => b.bottom < y + 0.05 && b.bottom > y - 0.05 && b.top > y + 0.004);
}

/** 가구 바닥 자리 (바닥을 지나는 선이 돌아갈 장애물) */
export const FURNITURE_BOXES: Box2[] = FURNITURE.map((f) => rectBox(f.rect));

/** 점 p 아래에서 높이가 y인 가구 (없으면 null = 바닥) */
export function furnitureAt(x: number, z: number, y: number): Rect2 | null {
  const f = FURNITURE.find((f) => Math.abs(f.height - y) < 0.03
    && x >= f.rect.x1 && x <= f.rect.x2 && z >= f.rect.z1 && z <= f.rect.z2);
  return f ? f.rect : null;
}

/**
 * 완성된 경로를 out.length개의 점으로 고르게 다시 나누고, 안전 장치로
 * 가구 상판(두께 4.5 cm) 속에 들어간 점은 상판 위로, 바닥 아래 점은 바닥 위로 올린다. (양 끝점은 그대로)
 * 상판보다 훨씬 아래 점(상판 밑 콘센트 쪽)은 건드리지 않는다.
 */
export function settle(path: THREE.Vector3[], out: THREE.Vector3[], clearance: number): void {
  resample(path, out);
  for (let i = 1; i < out.length - 1; i++) {
    const p = out[i];
    for (const f of FURNITURE) {
      const r = f.rect;
      if (p.x > r.x1 && p.x < r.x2 && p.z > r.z1 && p.z < r.z2 && p.y < f.height + clearance && p.y > f.height - 0.045) {
        p.y = f.height + clearance;
      }
    }
    if (p.y < clearance) p.y = clearance;
  }
}

/**
 * 2D 경로 pts(xz)를 따라가며 높이를 y0 → y1로 바꾸고 가운데를 sag만큼 처지게 한 3D 점들 (바닥 아래로는 안 감)
 */
export function hangAlong(pts: P2[], y0: number, y1: number, sag: number, floor: number): THREE.Vector3[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const total = cum[cum.length - 1] || 1;
  const at = (x: number, z: number, d: number) => {
    const t = d / total;
    return new THREE.Vector3(x, Math.max(floor, y0 + (y1 - y0) * t - sag * 4 * t * (1 - t)), z);
  };
  const out: THREE.Vector3[] = [at(pts[0].x, pts[0].z, 0)];
  // 꺾인 점 사이도 5 cm마다 점을 찍어 처짐 곡선이 보이게
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const steps = Math.max(1, Math.ceil((cum[i] - cum[i - 1]) / 0.05));
    for (let k = 1; k <= steps; k++) {
      const f = k / steps;
      out.push(at(a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f, cum[i - 1] + (cum[i] - cum[i - 1]) * f));
    }
  }
  return out;
}

/**
 * 두 점 사이 전선 경로 (A와 B는 이미 면 위에 내려놓은 점, sA·sB는 그 면의 높이)
 *  - 같은 높이의 면: 그 면 위의 장비를 옆으로 돌아가는 길 (면에 눕는다)
 *  - 높이가 다르면: 높은 쪽 면 위에서 장비를 돌아 가장자리(1.5 cm 바깥)까지 → 거기서 가구를 돌아가며 낮은 쪽으로 늘어진다
 */
export function cablePath(A: THREE.Vector3, sA: number, B: THREE.Vector3, sB: number, clr: number): THREE.Vector3[] {
  if (Math.abs(sA - sB) < 0.03) {
    const y = Math.max(A.y, B.y);
    return route2D(p2(A), p2(B), obstaclesOn(Math.max(sA, sB)), 0.015).map((p) => new THREE.Vector3(p.x, y, p.z));
  }
  const flip = sB > sA;
  const [H, sH, L] = flip ? [B, sB, A] : [A, sA, B];
  const out: THREE.Vector3[] = [];
  let from: THREE.Vector3 = H;
  const top = furnitureAt(H.x, H.z, sH);
  if (top) {
    const { edge, inner } = edgeToward(top, p2(L), 0.015);
    for (const p of route2D(p2(H), inner, obstaclesOn(sH), 0.015)) out.push(new THREE.Vector3(p.x, H.y, p.z));
    from = new THREE.Vector3(edge.x, H.y, edge.z);
  }
  // 늘어지는 부분: 가구와, 낮은 쪽 면 위의 장비를 돌아간다
  const hang = route2D(p2(from), p2(L), [...FURNITURE_BOXES, ...obstaclesOn(sA < sB ? sA : sB)], 0.01);
  const len = hang.reduce((d, p, i) => (i ? d + Math.hypot(p.x - hang[i - 1].x, p.z - hang[i - 1].z) : 0), 0);
  out.push(...hangAlong(hang, from.y, L.y, 0.12 * len, clr));
  return flip ? out.reverse() : out;
}

/**
 * 두 끝점(단자·포트)을 잇는 선: 각 끝에서 바깥 방향(facing)으로 3 cm 뻗은 뒤 놓인 면으로 내려가,
 * 면 위의 장비를 옆으로 돌아서(길찾기) 다른 끝으로 간다. 면 높이가 다르면 가장자리를 넘어 늘어진다.
 */
export function endToEndPath(p: THREE.Vector3, fp: THREE.Vector3, q: THREE.Vector3, fq: THREE.Vector3, clr: number): THREE.Vector3[] {
  const ps = p.clone().addScaledVector(fp, 0.03);
  const qs = q.clone().addScaledVector(fq, 0.03);
  const sp = surfaceBelow(ps.x, ps.z, ps.y + 0.02);
  const sq = surfaceBelow(qs.x, qs.z, qs.y + 0.02);
  const A = new THREE.Vector3(ps.x, Math.min(ps.y, sp + clr), ps.z);
  const B = new THREE.Vector3(qs.x, Math.min(qs.y, sq + clr), qs.z);
  return [p, ps, ...cablePath(A, sp, B, sq, clr), qs, q];
}

function p2(v: THREE.Vector3): P2 {
  return { x: v.x, z: v.z };
}

/** 꺾인 선 path를 out.length개의 점으로 호의 길이 기준 고르게 나눈다 */
function resample(path: THREE.Vector3[], out: THREE.Vector3[]): void {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + path[i].distanceTo(path[i - 1]));
  const total = cum[cum.length - 1] || 1;
  let j = 0;
  for (let k = 0; k < out.length; k++) {
    const s = (k / (out.length - 1)) * total;
    while (j < path.length - 2 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    out[k].lerpVectors(path[j], path[j + 1], Math.min(1, (s - cum[j]) / seg));
  }
}
