/**
 * 전선 길찾기 (위에서 본 2D 평면)
 *
 * 장애물(장비의 바닥 자리, 가구)을 직사각형으로 보고, 선이 그 둘레를 "옆으로 돌아가는" 가장 짧은 길을 찾는다.
 *
 * 가시성 그래프(visibility graph): 장애물 직사각형을 여유(pad)만큼 키운 뒤,
 *   시작점·끝점·직사각형 꼭짓점들을 마디로 두고, 서로 "보이는"(사이에 장애물이 없는) 마디끼리 잇는다.
 *   볼록한 장애물 사이의 최단 경로는 반드시 이 꼭짓점들만 거쳐 가므로,
 *   이 그래프에서 다익스트라로 최단 경로를 찾으면 된다. (고무줄을 장애물에 걸어 당긴 모양)
 * 마지막으로 꺾인 곳을 2 cm 이내로 깎아 부드럽게 만든다.
 */

export interface P2 {
  x: number;
  z: number;
}

export interface Rect2 {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

/**
 * 돌려 놓인 직사각형 (위에서 본 장비 자리): 중심 c, 장비의 가로축 u·세로축 v(단위 벡터), 반폭 hx·hz
 * 장비가 비스듬히 놓여도 딱 맞게 감싼다 (축에 나란한 상자는 비스듬한 장비보다 훨씬 커진다)
 */
export interface Box2 {
  cx: number;
  cz: number;
  ux: number;
  uz: number;
  vx: number;
  vz: number;
  hx: number;
  hz: number;
}

export function rectBox(r: Rect2): Box2 {
  return { cx: (r.x1 + r.x2) / 2, cz: (r.z1 + r.z2) / 2, ux: 1, uz: 0, vx: 0, vz: 1, hx: (r.x2 - r.x1) / 2, hz: (r.z2 - r.z1) / 2 };
}

const EPS = 1e-4;

/** 상자 좌표로: (u 방향 성분, v 방향 성분) */
function local(p: P2, b: Box2): P2 {
  const dx = p.x - b.cx;
  const dz = p.z - b.cz;
  return { x: dx * b.ux + dz * b.uz, z: dx * b.vx + dz * b.vz };
}

function inside(p: P2, b: Box2, pad: number): boolean {
  const l = local(p, b);
  return Math.abs(l.x) < b.hx + pad && Math.abs(l.z) < b.hz + pad;
}

/** 선분 pq가 (pad만큼 키운) 상자의 안쪽(경계 제외)을 지나는가 — 상자 좌표에서 리앙-바스키 선분 자르기 */
function hits(p: P2, q: P2, b: Box2, pad: number): boolean {
  const lp = local(p, b);
  const lq = local(q, b);
  const X = b.hx + pad - EPS;
  const Z = b.hz + pad - EPS;
  let t0 = 0;
  let t1 = 1;
  const dx = lq.x - lp.x;
  const dz = lq.z - lp.z;
  const clip = (pp: number, qq: number): boolean => {
    if (pp === 0) return qq > 0;
    const t = qq / pp;
    if (pp < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return clip(-dx, lp.x + X) && clip(dx, X - lp.x) && clip(-dz, lp.z + Z) && clip(dz, Z - lp.z) && t1 - t0 > 1e-6;
}

/**
 * a에서 b까지 장애물을 피해 가는 꺾은선 [a, …, b]
 * @param pad 장애물에서 띄울 거리 (m)
 * 시작점·끝점을 품은 장애물은 무시한다 (선이 그 기구에서 나오는 중이므로).
 * 길이 없으면 직선 [a, b].
 */
export function route2D(a: P2, b: P2, boxes: Box2[], pad: number): P2[] {
  const reach = Math.hypot(b.x - a.x, b.z - a.z) / 2 + 1;
  const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  const ex = boxes.filter((o) => Math.hypot(o.cx - mid.x, o.cz - mid.z) < reach + o.hx + o.hz
    && !inside(a, o, pad) && !inside(b, o, pad));
  const clear = (p: P2, q: P2) => !ex.some((o) => hits(p, q, o, pad));
  if (clear(a, b)) return [a, b];

  // 마디: 시작, 끝, 키운 상자의 꼭짓점 (다른 장애물 안에 든 꼭짓점은 뺀다)
  const nodes: P2[] = [a, b];
  const o = 1e-3;
  for (const r of ex) {
    const X = r.hx + pad + o;
    const Z = r.hz + pad + o;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const c = { x: r.cx + sx * X * r.ux + sz * Z * r.vx, z: r.cz + sx * X * r.uz + sz * Z * r.vz };
      if (!ex.some((s) => inside(c, s, pad))) nodes.push(c);
    }
  }
  // 다익스트라 (마디 수가 수십 개라 간선은 그때그때 검사)
  const n = nodes.length;
  const dist = new Array(n).fill(Infinity);
  const prev = new Array(n).fill(-1);
  const done = new Array(n).fill(false);
  dist[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || u === 1) break;
    done[u] = true;
    for (let v = 0; v < n; v++) {
      if (done[v]) continue;
      const d = dist[u] + Math.hypot(nodes[v].x - nodes[u].x, nodes[v].z - nodes[u].z);
      if (d < dist[v] && clear(nodes[u], nodes[v])) {
        dist[v] = d;
        prev[v] = u;
      }
    }
  }
  if (prev[1] < 0) return [a, b];
  const path: P2[] = [];
  for (let i = 1; i >= 0; i = prev[i]) path.unshift(nodes[i]);
  return smooth(path, 0.02);
}

/** 꺾인 곳마다 양쪽으로 최대 d만큼 물러난 두 점으로 바꾼다 (모서리 깎기 — 장애물 여유보다 작게) */
function smooth(pts: P2[], d: number): P2[] {
  if (pts.length < 3) return pts;
  const out: P2[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    for (const q of [pts[i - 1], pts[i + 1]]) {
      const len = Math.hypot(q.x - p.x, q.z - p.z) || 1;
      const s = Math.min(d, len * 0.3) / len;
      out.push({ x: p.x + (q.x - p.x) * s, z: p.z + (q.z - p.z) * s });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** 직사각형 r의 테두리에서 target에 가장 가까운 점을 바깥으로 out만큼 민 점 (선이 책상 가장자리를 넘어갈 자리) */
export function edgeToward(r: Rect2, target: P2, out: number): { edge: P2; inner: P2 } {
  const cx = Math.min(Math.max(target.x, r.x1), r.x2);
  const cz = Math.min(Math.max(target.z, r.z1), r.z2);
  // target이 직사각형 안이면 가장 가까운 변으로
  const d = [cx - r.x1, r.x2 - cx, cz - r.z1, r.z2 - cz];
  let k = 0;
  if (target.x > r.x1 && target.x < r.x2 && target.z > r.z1 && target.z < r.z2) {
    for (let i = 1; i < 4; i++) if (d[i] < d[k]) k = i;
  } else {
    // 바깥이면 target이 있는 쪽 변 (가장 멀리 벗어난 방향)
    const over = [r.x1 - target.x, target.x - r.x2, r.z1 - target.z, target.z - r.z2];
    for (let i = 1; i < 4; i++) if (over[i] > over[k]) k = i;
  }
  const n = [{ x: -1, z: 0 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: 0, z: 1 }][k];
  const px = k === 0 ? r.x1 : k === 1 ? r.x2 : Math.min(Math.max(cx, r.x1 + 0.03), r.x2 - 0.03);
  const pz = k === 2 ? r.z1 : k === 3 ? r.z2 : Math.min(Math.max(cz, r.z1 + 0.03), r.z2 - 0.03);
  return {
    edge: { x: px + n.x * out, z: pz + n.z * out },
    inner: { x: px - n.x * 0.03, z: pz - n.z * 0.03 },
  };
}
