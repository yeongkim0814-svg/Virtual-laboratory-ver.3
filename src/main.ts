/**
 * 프로그램 시작점: 모든 부품을 만들고 연결한 뒤, 매 프레임 루프를 돌린다.
 *
 * 매 프레임 순서
 *   1. 입력 읽기  →  2. 플레이어·문 갱신  →  3. 상호작용 판정  →  4. 그리기  →  5. 입력 비우기
 */
import * as THREE from 'three';
import './style.css';
import { buildLab } from './world/buildLab';
import { Door } from './world/door';
import { SPAWN, roomNameAt } from './world/layout';
import { INTERACT_RANGE, type Interactable } from './world/interactable';
import { Player } from './player/player';
import { Controls } from './input/controls';
import { Minimap } from './ui/minimap';
import { bindSettingsPanel, enterFullscreen, loadSettings } from './ui/settings';

// ---------- 3D 기본 세팅 ----------
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
// 태블릿의 고해상도 화면을 그대로 쓰면 무거우므로 픽셀 비율을 1.5로 제한
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 100);

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- 실험실 만들기 ----------
buildLab(scene);
const door = new Door();
scene.add(door.object);

/** 상호작용 가능한 물체 목록 — 실험 기구가 생기면 여기에 추가된다 */
const interactables: Interactable[] = [door];

// ---------- 플레이어·입력·UI ----------
const settings = loadSettings();
const player = new Player(camera, door, SPAWN);
const controls = new Controls(canvas);
const minimap = new Minimap(document.getElementById('minimap') as HTMLCanvasElement, player, door);
bindSettingsPanel(settings, { resetPosition: () => player.reset() });

const roomLabel = document.getElementById('room')!;
const debugEl = document.getElementById('debug')!;
const interactBtn = document.getElementById('btn-interact') as HTMLButtonElement;

// 시작 화면
document.getElementById('btn-enter')!.addEventListener('click', () => {
  document.getElementById('start')!.hidden = true;
  document.getElementById('hud')!.hidden = false;
  void enterFullscreen();
});

// ---------- 상호작용 (조준·탭) ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

/** 화면 좌표(ndc: −1~1)에서 광선을 쏴서 맞은 상호작용 물체를 찾는다 (벽에 가려지면 없음) */
function pick(x: number, y: number): Interactable | null {
  ndc.set(x, y);
  raycaster.setFromCamera(ndc, camera);
  raycaster.far = INTERACT_RANGE;
  const hit = raycaster.intersectObjects(scene.children, true)[0];
  if (!hit) return null;
  // 맞은 부분(예: 문 손잡이)에서 부모를 따라 올라가며 주인을 찾는다
  for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
    const found = interactables.find((it) => it.object === o);
    if (found) return found;
  }
  return null;
}

let focused: Interactable | null = null;
interactBtn.addEventListener('click', () => focused?.interact());

// ---------- 메인 루프 ----------
let last = performance.now();
let fpsFrames = 0;
let fpsTime = 0;
let fps = 0;

renderer.setAnimationLoop(() => {
  const now = performance.now();
  // 탭 전환 등으로 오래 멈췄다 돌아오면 dt가 커져 벽을 뚫을 수 있으므로 0.1초로 제한
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  controls.poll();
  const input = controls.state;

  player.update(dt, input, settings);
  door.update(dt);

  // 화면 중앙(조준점)에 있는 물체 → 상호작용 버튼 표시
  focused = pick(0, 0);
  interactBtn.hidden = !focused;
  if (focused) interactBtn.textContent = focused.label();
  if (input.interactKey) focused?.interact();

  // 화면을 탭한 위치에 있는 물체 → 바로 상호작용
  for (const t of input.taps) {
    pick((t.x / window.innerWidth) * 2 - 1, -(t.y / window.innerHeight) * 2 + 1)?.interact();
  }

  renderer.render(scene, camera);
  minimap.draw();
  roomLabel.textContent = roomNameAt(player.pos.x, player.pos.z);

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    fps = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0;
    fpsTime = 0;
  }
  if (settings.showDebug) {
    const deg = (((player.yaw * 180) / Math.PI) % 360 + 360) % 360;
    debugEl.textContent = `${fps} FPS · x ${player.pos.x.toFixed(2)} m, z ${player.pos.z.toFixed(2)} m · 방향 ${deg.toFixed(0)}°`;
  }

  controls.consume();
});
