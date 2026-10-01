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

/** 바닥 타일: 32 px = 1 m (0.5 m 타일 2×2), 회녹색 산업 타일 — 타일마다 색이 다르고, 어두운 줄눈, 때·긁힘 */
export function floorTexture(): THREE.CanvasTexture {
  return canvasTexture(32, 32, (g, r) => {
    for (let ty = 0; ty < 2; ty++) {
      for (let tx = 0; tx < 2; tx++) {
        const tint = (r() - 0.5) * 16;
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) {
            let v = 130 + tint + (r() - 0.5) * 14;
            if (r() < 0.05) v -= 34; // 때 얼룩
            if (r() < 0.012) v += 22; // 긁힘
            const px = tx * 16 + x;
            const py = ty * 16 + y;
            g.fillStyle = `rgb(${(v - 4) | 0},${(v + 2) | 0},${(v - 18) | 0})`;
            g.fillRect(px, py, 1, 1);
          }
        }
        g.fillStyle = '#2e3228'; // 어두운 줄눈
        g.fillRect(tx * 16, ty * 16, 16, 1);
        g.fillRect(tx * 16, ty * 16, 1, 16);
      }
    }
  }, 11);
}

/**
 * 벽: 가로 64 px = 2 m (패널 2장), 세로 96 px = 3 m (천장 높이 전체). 가로 이음매가 있는 설비 패널 + 때 묻은 페인트.
 *   아래 0.9 m = 어두운 올리브 걸레받이 띠, 위 = 니코틴 베이지(위로 갈수록 누렇게, 아래로 갈수록 때), 패널 이음매 · 리벳,
 *   물 얼룩 줄무늬, 두 번째 패널 아래에 바랜 주황·검정 경고 줄무늬.
 */
export function wallTexture(): THREE.CanvasTexture {
  return canvasTexture(64, 96, (g, r) => {
    const streak = [9, 23, 41, 55].map((x) => ({ x, len: 14 + ((r() * 26) | 0), top: 20 + ((r() * 30) | 0) }));
    for (let y = 0; y < 96; y++) {
      const fromFloor = (95 - y) / 32; // m
      for (let x = 0; x < 64; x++) {
        const panel = x < 32 ? 0 : 1;
        const pv = panel ? -6 : 3; // 패널마다 페인트 바램이 다름
        let R: number, G: number, B: number;
        if (fromFloor < 0.9) {
          const v = (r() - 0.5) * 10 + pv;
          R = 66 + v; G = 74 + v; B = 54 + v; // 어두운 올리브 띠
        } else {
          const grime = Math.max(0, 1.7 - fromFloor) * 26; // 띠 바로 위가 더 더러움
          const nic = Math.max(0, fromFloor - 2.3) * 22; // 천장 쪽 니코틴 누런 기
          const v = (r() - 0.5) * 9 + pv - grime * r();
          R = 168 + v - nic * 0.3; G = 160 + v - nic * 0.6; B = 128 + v - nic; // 니코틴 베이지
        }
        g.fillStyle = `rgb(${R | 0},${G | 0},${B | 0})`;
        g.fillRect(x, y, 1, 1);
      }
    }
    // 물 얼룩: 위에서 아래로 흐른 어두운 줄
    for (const s of streak) {
      for (let k = 0; k < s.len; k++) {
        g.fillStyle = `rgba(60,52,34,${0.22 - (k / s.len) * 0.18})`;
        g.fillRect(s.x + (r() < 0.2 ? 1 : 0), s.top + k, 1, 1);
      }
    }
    // 가로 이음매 (띠 경계 · 1.95 m · 2.7 m) + 세로 이음매 (패널 경계)
    g.fillStyle = '#2f3328';
    g.fillRect(0, 95 - 29, 64, 1);
    g.fillStyle = '#6f6a52';
    g.fillRect(0, 95 - 62, 64, 1);
    g.fillRect(0, 95 - 86, 64, 1);
    g.fillStyle = '#4a4b3c';
    g.fillRect(0, 0, 1, 96);
    g.fillRect(32, 0, 1, 96);
    // 리벳 (패널 모서리)
    g.fillStyle = '#4e4d3b';
    for (const px of [2, 29, 34, 61]) for (const py of [95 - 61, 95 - 85, 95 - 28]) g.fillRect(px, py, 1, 1);
    // 경고 줄무늬: 두 번째 패널 아래쪽 (바랜 산화 주황 + 검정, 대각선)
    for (let y = 95 - 24; y < 95 - 17; y++) {
      for (let x = 36; x < 60; x++) {
        const stripe = ((x + y) >> 1) % 2 === 0;
        g.fillStyle = stripe ? `rgb(${150 + ((r() * 14) | 0)},${92 + ((r() * 10) | 0)},38)` : '#26261f';
        g.fillRect(x, y, 1, 1);
      }
    }
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

/** 천장 패널: 60 cm 격자, 올리브 회색 + 얼룩. 32 px = 1.2 m */
export function ceilingTexture(): THREE.CanvasTexture {
  return canvasTexture(32, 32, (g, r) => {
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const v = 150 + (r() - 0.5) * 12 - (r() < 0.04 ? 26 : 0);
        g.fillStyle = `rgb(${(v - 2) | 0},${(v - 1) | 0},${(v - 18) | 0})`;
        g.fillRect(x, y, 1, 1);
      }
    }
    g.fillStyle = '#4e4e3c';
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
