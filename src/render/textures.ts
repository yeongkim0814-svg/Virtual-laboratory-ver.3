/**
 * 저해상도 픽셀 텍스처 (이미지 파일 없이 캔버스에 직접 그림)
 *
 * - 크기가 32×32 정도로 작고, NearestFilter로 확대 → 픽셀이 그대로 보인다.
 * - 난수는 시드(seed)를 고정한 생성기를 써서, 새로고침해도 항상 같은 무늬가 나온다.
 * - worldUV(): 상자의 텍스처 좌표를 "실제 크기(m)" 기준으로 다시 계산한다.
 *   → 큰 벽이든 작은 서랍이든 1 m 당 같은 수의 픽셀이 찍혀, 무늬가 늘어나 보이지 않는다.
 */
import * as THREE from 'three';

/** 시드 고정 난수 (mulberry32) — 0 이상 1 미만 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, r: () => number) => void, seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, rng(seed));
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter; // 밉맵 없음 → 멀리서 픽셀이 반짝이는 것도 옛 게임 느낌
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 밝기 v(0~255)의 회색에 ±amp만큼 무작위 얼룩 점을 찍는다 */
function speckle(g: CanvasRenderingContext2D, r: () => number, w: number, h: number, base: number, amp: number): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round(base + (r() - 0.5) * 2 * amp);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x, y, 1, 1);
    }
  }
}

/** 바닥 타일: 32 px = 1 m (0.5 m 타일 2×2), 타일마다 색이 조금씩 다르고 때가 탐 */
export function floorTexture(): THREE.CanvasTexture {
  return canvasTexture(32, 32, (g, r) => {
    for (let ty = 0; ty < 2; ty++) {
      for (let tx = 0; tx < 2; tx++) {
        const tint = (r() - 0.5) * 14;
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) {
            let v = 176 + tint + (r() - 0.5) * 16;
            if (r() < 0.04) v -= 40; // 때 얼룩
            const px = tx * 16 + x;
            const py = ty * 16 + y;
            g.fillStyle = `rgb(${v | 0},${(v + 4) | 0},${(v - 10) | 0})`;
            g.fillRect(px, py, 1, 1);
          }
        }
        g.fillStyle = '#5d5c52'; // 줄눈
        g.fillRect(tx * 16, ty * 16, 16, 1);
        g.fillRect(tx * 16, ty * 16, 1, 16);
      }
    }
  }, 11);
}

/**
 * 벽: 가로 32 px = 1 m, 세로 96 px = 3 m (천장 높이 전체).
 * 아래 1 m는 짙은 녹회색 페인트(걸레받이 띠), 위는 바랜 크림색 + 아래로 갈수록 때.
 */
export function wallTexture(): THREE.CanvasTexture {
  return canvasTexture(32, 96, (g, r) => {
    for (let y = 0; y < 96; y++) {
      const fromFloor = (95 - y) / 32; // m
      for (let x = 0; x < 32; x++) {
        let R: number, G: number, B: number;
        if (fromFloor < 1.0) {
          const v = (r() - 0.5) * 12;
          R = 92 + v; G = 104 + v; B = 90 + v;
        } else {
          const grime = Math.max(0, 1.6 - fromFloor) * 30; // 띠 바로 위가 더 더러움
          const v = (r() - 0.5) * 10 - grime * r();
          R = 206 + v; G = 200 + v; B = 176 + v;
        }
        g.fillStyle = `rgb(${R | 0},${G | 0},${B | 0})`;
        g.fillRect(x, y, 1, 1);
      }
    }
    g.fillStyle = '#3c3f36'; // 띠 경계선
    g.fillRect(0, 95 - 32, 32, 1);
  }, 22);
}

/** 범용 얼룩 텍스처 (회색) — 재질 색과 곱해져서 캐비닛·상판·플라스틱 등에 쓴다. 32 px = 1 m */
export function grimeTexture(): THREE.CanvasTexture {
  return canvasTexture(32, 32, (g, r) => {
    speckle(g, r, 32, 32, 232, 14);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let i = 0; i < 6; i++) g.fillRect((r() * 32) | 0, (r() * 32) | 0, 1 + ((r() * 3) | 0), 1); // 흠집
  }, 33);
}

/** 나뭇결: 가로 줄무늬가 흔들리며 이어진다. 32 px = 1 m */
export function woodTexture(): THREE.CanvasTexture {
  return canvasTexture(32, 32, (g, r) => {
    for (let y = 0; y < 32; y++) {
      const band = Math.sin(y * 0.9 + r() * 0.8) * 16;
      for (let x = 0; x < 32; x++) {
        const v = 210 + band + (r() - 0.5) * 14;
        g.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
        g.fillRect(x, y, 1, 1);
      }
    }
  }, 44);
}

/** 천장 텍스타일: 60 cm 격자. 32 px = 1.2 m */
export function ceilingTexture(): THREE.CanvasTexture {
  return canvasTexture(32, 32, (g, r) => {
    speckle(g, r, 32, 32, 196, 10);
    g.fillStyle = '#8a8676';
    g.fillRect(0, 0, 32, 1);
    g.fillRect(0, 16, 32, 1);
    g.fillRect(0, 0, 1, 32);
    g.fillRect(16, 0, 1, 32);
  }, 55);
}

/**
 * 상자(BoxGeometry)의 텍스처 좌표를 월드 좌표(m)로 다시 계산한다.
 * 면의 방향(법선)에 따라 수평면은 (x, z), 수직면은 (x 또는 z, y)를 좌표로 쓴다.
 * @param offset 상자의 월드 위치 (회전하지 않은 상자 전제)
 * @param su, sv 텍스처 한 장이 덮는 크기 (m)
 */
export function worldUV(geo: THREE.BufferGeometry, offset: THREE.Vector3, su = 1, sv = su): void {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + offset.x;
    const y = pos.getY(i) + offset.y;
    const z = pos.getZ(i) + offset.z;
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    if (ny > 0.5) uv.setXY(i, x / su, z / sv);
    else if (nx > 0.5) uv.setXY(i, z / su, y / sv);
    else uv.setXY(i, x / su, y / sv);
  }
  uv.needsUpdate = true;
}
