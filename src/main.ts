/**
 * 프로그램 시작점: 모든 부품을 만들고 연결한 뒤, 매 프레임 루프를 돌린다.
 *
 * 매 프레임 순서
 *   1. 입력 읽기  →  2. 플레이어·문·손 갱신  →  3. 상호작용 판정  →  4. 그리기  →  5. 입력 비우기
 */
import * as THREE from 'three';
import './style.css';
import { buildLab } from './world/buildLab';
import { buildFurniture } from './world/buildFurniture';
import { Door } from './world/door';
import { createItems, Item } from './world/items';
import { SPAWN, roomNameAt } from './world/layout';
import { INTERACT_RANGE, type Interactable } from './world/interactable';
import { Player } from './player/player';
import { Hand, isNoPick } from './player/hand';
import { Controls } from './input/controls';
import { Minimap } from './ui/minimap';
import { bindSettingsPanel, enterFullscreen, loadSettings } from './ui/settings';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- 3D 기본 세팅 ----------
// 모든 화면 요소는 16:9 비율의 "무대(stage)" 안에 있다. 화면비가 다르면 위아래(또는 좌우)에 검은 띠가 생긴다.
const stage = $('stage');
const canvas = $<HTMLCanvasElement>('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
// 태블릿의 고해상도 화면을 그대로 쓰면 무거우므로 픽셀 비율을 1.5로 제한
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 100);
camera.userData.noPick = true; // 카메라에 붙은 것(손에 든 물체)은 광선 판정에서 제외
scene.add(camera); // 카메라에 붙인 물체도 그려지도록 장면에 넣는다

function resize(): void {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

// ---------- 실험실 만들기 ----------
buildLab(scene);
buildFurniture(scene);
const door = new Door();
scene.add(door.object);
const items = createItems();
for (const it of items) scene.add(it.object);

/** 상호작용 가능한 물체 목록 */
const interactables: Interactable[] = [door, ...items];

// ---------- 플레이어·손·입력·UI ----------
const settings = loadSettings();
const player = new Player(camera, door, SPAWN);
const hand = new Hand(scene, camera, items);
for (const it of items) it.onPick = (item) => hand.pickUp(item);
const controls = new Controls(canvas);
const minimap = new Minimap($<HTMLCanvasElement>('minimap'), player, door, items);
bindSettingsPanel(settings, { resetPosition: () => player.reset() });

const roomLabel = $('room');
const debugEl = $('debug');
const heldEl = $('held');
const interactBtn = $<HTMLButtonElement>('btn-interact');
const placeBtn = $<HTMLButtonElement>('btn-place');

$('btn-enter').addEventListener('click', () => {
  $('start').hidden = true;
  $('hud').hidden = false;
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
  const hit = raycaster.intersectObjects(scene.children, true).find((h) => !isNoPick(h.object));
  if (!hit) return null;
  // 맞은 부분(예: 문 손잡이)에서 부모를 따라 올라가며 주인을 찾는다
  for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
    const found = interactables.find((it) => it.object === o);
    if (found) return found;
  }
  return null;
}

/** 손에 물체를 들고 있으면 다른 물체는 집을 수 없다 (문은 열 수 있음) */
function usable(target: Interactable | null): Interactable | null {
  return hand.held && target instanceof Item ? null : target;
}

let focused: Interactable | null = null;
interactBtn.addEventListener('click', () => focused?.interact());
placeBtn.addEventListener('click', () => hand.place(hand.aim));

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
  camera.updateMatrixWorld();
  hand.update();

  // 화면 중앙(조준점)에 있는 물체 → 상호작용 버튼
  focused = usable(pick(0, 0));
  interactBtn.hidden = !focused;
  if (focused) interactBtn.textContent = focused.label();

  // 들고 있는 물체 → 놓기 버튼 (놓을 수 있는 면을 조준할 때만 활성)
  placeBtn.hidden = !hand.held;
  if (hand.held) {
    const ok = !!hand.aim?.valid;
    placeBtn.disabled = !ok;
    placeBtn.textContent = ok ? '놓기' : '놓을 곳 조준';
    heldEl.textContent = `손에 든 물체: ${hand.held.name} · ${(hand.held.mass * 1000).toFixed(0)} g`;
  }
  heldEl.hidden = !hand.held;

  // PC: E 키 → 조준한 물체와 상호작용, 없으면 들고 있는 물체 내려놓기
  if (input.interactKey) {
    if (focused) focused.interact();
    else hand.place(hand.aim);
  }

  // 화면 탭: 그 위치의 물체와 상호작용, 들고 있을 때는 탭한 면에 내려놓기
  for (const t of input.taps) {
    const x = (t.x / stage.clientWidth) * 2 - 1;
    const y = -(t.y / stage.clientHeight) * 2 + 1;
    const target = usable(pick(x, y));
    if (target) target.interact();
    else if (hand.held) hand.place(hand.findTarget(x, y));
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
