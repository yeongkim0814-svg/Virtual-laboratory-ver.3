/**
 * 레트로(PS1 / 90년대 후반) 스타일 렌더링
 *
 * 1. 저해상도 렌더링: 장면을 480×270 같은 작은 해상도로 그린 뒤,
 *    CSS `image-rendering: pixelated`로 화면에 확대 → 픽셀이 뭉개지지 않고 네모나게 보인다.
 * 2. 후처리(포스트 프로세싱) 셰이더: 한 번 그린 화면(텍스처)을 다시 가공한다.
 *    - 외곽선: 깊이(카메라까지 거리)가 급격히 바뀌는 곳 = 물체의 테두리 → 어둡게
 *    - 색 보정: 채도를 낮추고 대비를 올리고 누런 초록빛으로 물들임 + 가장자리 어둡게(비네팅)
 *    - 색 단계 줄이기 + 디더링: 채널당 색을 18단계로 줄이고, 4×4 바이어(Bayer) 행렬로
 *      점무늬를 섞어 계단 현상을 흩뜨린다 (옛 콘솔의 적은 색 수를 흉내)
 * 3. 정점 흔들림(PS1 jitter): 꼭짓점의 화면 위치를 거친 격자에 맞춰 반올림한다.
 *    PS1은 소수점 없는 정수 좌표로 그려서 물체가 미세하게 "떨리는" 느낌이 있었다.
 */
import * as THREE from 'three';

// ---------- 정점 흔들림 (모든 재질에 셰이더 코드 한 줄을 끼워 넣는다) ----------
const snapRes = { value: new THREE.Vector2(240, 135) };
const jitterOn = { value: 1 };
const patched = new WeakSet<THREE.Material>();

function patchMaterial(m: THREE.Material): void {
  if (patched.has(m)) return;
  patched.add(m);
  // 곡면도 평평한 면으로 음영 → 각진 로우폴리 느낌
  if (m instanceof THREE.MeshLambertMaterial) m.flatShading = true;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSnap = snapRes;
    shader.uniforms.uJitter = jitterOn;
    shader.vertexShader =
      'uniform vec2 uSnap;\nuniform float uJitter;\n' +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        if (uJitter > 0.5 && gl_Position.w > 0.0) {
          // 화면 좌표(−1~1)를 uSnap 칸 격자에 맞춰 반올림
          vec2 ndc = gl_Position.xy / gl_Position.w;
          ndc = floor(ndc * uSnap + 0.5) / uSnap;
          gl_Position.xy = ndc * gl_Position.w;
        }`,
      );
  };
}

/** 장면의 모든 재질에 정점 흔들림을 적용한다 (재질이 처음 쓰이기 전에 호출) */
export function applyRetroMaterials(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(patchMaterial);
    }
  });
}

// ---------- 후처리 셰이더 ----------
const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const POST_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 res;
uniform float near;
uniform float far;
uniform float levels;
varying vec2 vUv;

// 깊이 버퍼 값(0~1, 비선형) → 카메라까지 실제 거리(m)
float linDepth(vec2 uv) {
  float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
  return (2.0 * near * far) / (far + near - z * (far - near));
}

// 4×4 바이어 행렬: 이웃 픽셀끼리 문턱값이 고르게 흩어져 있다
float bayer4(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  int i = int(q.x + q.y * 4.0);
  float t[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  return (t[i] + 0.5) / 16.0;
}

void main() {
  vec3 col = texture2D(tColor, vUv).rgb;

  // 1) 외곽선: 상하좌우 이웃과의 깊이 차이가 (자기 깊이 대비) 크면 테두리
  vec2 px = 1.0 / res;
  float dc = linDepth(vUv);
  float dd = 0.0;
  dd = max(dd, abs(linDepth(vUv + vec2(px.x, 0.0)) - dc));
  dd = max(dd, abs(linDepth(vUv - vec2(px.x, 0.0)) - dc));
  dd = max(dd, abs(linDepth(vUv + vec2(0.0, px.y)) - dc));
  dd = max(dd, abs(linDepth(vUv - vec2(0.0, px.y)) - dc));
  float edge = smoothstep(0.04, 0.12, dd / dc);
  col *= 1.0 - 0.55 * edge;

  // 2) 선형 색 → 화면(sRGB) 색으로 바꾼 뒤 보정
  vec3 c = linearToOutputTexel(vec4(col, 1.0)).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 0.72);             // 채도 낮춤
  c = (c - 0.5) * 1.12 + 0.5;            // 대비 올림
  c *= vec3(1.0, 0.99, 0.86);            // 누런 초록빛
  vec2 d = vUv - 0.5;
  c *= 1.0 - dot(d, d) * 1.1;            // 비네팅

  // 3) 디더링 + 색 단계 줄이기
  float b = bayer4(gl_FragCoord.xy) - 0.5;
  c = floor(c * levels + b + 0.5) / levels;

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export class RetroPipeline {
  private target: THREE.WebGLRenderTarget;
  private post: THREE.ShaderMaterial;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  width = 480;
  height = 270;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
  ) {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture: new THREE.DepthTexture(1, 1),
    });
    this.post = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        res: { value: new THREE.Vector2() },
        near: { value: camera.near },
        far: { value: camera.far },
        levels: { value: 18 },
      },
      depthTest: false,
      depthWrite: false,
    });
    // 화면 전체를 덮는 사각형 (−1~1)
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post));
  }

  /** 내부 해상도 설정: 세로 픽셀 수(예: 270)와 화면비로 가로를 정한다 */
  setResolution(height: number, aspect: number): void {
    this.height = Math.round(height);
    this.width = Math.round(height * aspect);
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.width, this.height, false); // 캔버스 버퍼 자체를 작게 (CSS로 확대)
    this.target.setSize(this.width, this.height);
    this.post.uniforms.res.value.set(this.width, this.height);
    // 흔들림 격자: 내부 해상도의 절반 → 2픽셀 단위로 꼭짓점이 튄다
    snapRes.value.set(this.width / 2, this.height / 2);
  }

  setJitter(on: boolean): void {
    jitterOn.value = on ? 1 : 0;
  }

  render(): void {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    // 1) 레이어 0: 실험실 전체
    this.camera.layers.set(0);
    r.render(this.scene, this.camera);
    // 2) 레이어 1: 손에 든 물체 — 깊이만 지우고 위에 덧그린다 (벽에 파묻히지 않음)
    //    배경색이 설정돼 있으면 three.js가 autoClear와 상관없이 화면을 지워 버리므로 잠시 끈다
    const bg = this.scene.background;
    this.scene.background = null;
    r.autoClear = false;
    r.clearDepth();
    this.camera.layers.set(1);
    r.render(this.scene, this.camera);
    r.autoClear = true;
    this.scene.background = bg;
    this.camera.layers.set(0);
    r.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCam);
  }
}
