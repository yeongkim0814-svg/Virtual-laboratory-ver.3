/**
 * 프로그램 시작점: 모든 부품을 만들고 연결한 뒤, 매 프레임 루프를 돌린다.
 *
 * 매 프레임 순서
 *   1. 입력 읽기  →  2. 플레이어·문·기구 갱신  →  3. 상호작용 판정  →  4. 그리기  →  5. 입력 비우기
 *
 * 탭 한 번의 의미 (위에서부터 먼저 맞는 것)
 *   물체를 들고 있을 때: ① 맞는 소켓이면 연결  ② 문·보관장 문이면 열고 닫기  ③ 평평한 면이면 놓기
 *   빈손일 때: 탭한 물체의 동작 — 하나면 바로 실행, 여러 개면 탭한 자리에 선택 메뉴
 */
import * as THREE from 'three';
import './style.css';
import { buildLab } from './world/buildLab';
import { buildFurniture } from './world/buildFurniture';
import { Door } from './world/door';
import { createBenchItems, Item, type Plug, type Socket } from './world/items';
import { SPAWN, roomNameAt } from './world/layout';
import { INTERACT_RANGE, type Action, type Interactable } from './world/interactable';
import { Player } from './player/player';
import { Hand, isPickable } from './player/hand';
import { Controls } from './input/controls';
import { Minimap } from './ui/minimap';
import { bindSettingsPanel, enterFullscreen, loadSettings } from './ui/settings';
import { RetroPipeline, applyRetroMaterials } from './render/retro';
import { PendulumPanel } from './ui/pendulumPanel';
import { SpringPanel } from './ui/springPanel';
import { SlitPanel } from './ui/slitPanel';
import { stockEquipment } from './equipment/stock';
import { BeamSystem } from './equipment/beams';
import { PowerSystem } from './world/power';
import { WireSystem, type Terminal } from './world/wires';
import { solveCircuits, type PhotoCircuitState } from './equipment/electrical';
import { PhotoPanel } from './ui/photoPanel';
import { RotateBar } from './ui/rotateBar';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- 3D 기본 세팅 ----------
// 모든 화면 요소는 16:9 비율의 "무대(stage)" 안에 있다. 화면비가 다르면 위아래(또는 좌우)에 검은 띠가 생긴다.
const stage = $('stage');
const canvas = $<HTMLCanvasElement>('scene');
// 안티에일리어싱 끔: 계단 현상도 옛 게임 느낌의 일부
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 100);
camera.userData.noPick = true; // 카메라에 붙은 것(손에 든 물체)은 광선 판정에서 제외
scene.add(camera); // 카메라에 붙인 물체도 그려지도록 장면에 넣는다

const settings = loadSettings();
const retro = new RetroPipeline(renderer, scene, camera);

/**
 * 실험 패널이 오른쪽을 가리면, 시선 방향(화면 중심)을 남은 왼쪽 영역의 가운데로 옮긴다.
 * setViewOffset: 가로로 (W + 2d)만큼 넓은 가상 화면을 그리고 그중 오른쪽 W만 보여 주면
 * 가상 화면의 중심(W/2 + d)이 실제 화면의 W/2 − d 위치에 나타난다. (d = 옮길 거리)
 */
let aimShift = 0; // px
let aimX = 0; // 조준점의 ndc x 좌표 (패널이 없으면 0 = 화면 가운데)

function resize(): void {
  const W = stage.clientWidth || 16;
  const H = stage.clientHeight || 9;
  retro.setResolution(settings.pixelHeight, W / H); // 화면 크기와 무관하게 내부 해상도는 작게 고정
  const d = aimShift;
  camera.aspect = (W + 2 * d) / H; // 가로로 넓힌 가상 화면의 비율 (픽셀이 찌그러지지 않게)
  if (d > 0) camera.setViewOffset(W + 2 * d, H, 2 * d, 0, W, H);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
  aimX = (-2 * d) / W;
  stage.style.setProperty('--aim-shift', `${d}px`);
}
new ResizeObserver(resize).observe(stage);
resize();
retro.setJitter(settings.jitter);

// ---------- 실험실 만들기 ----------
const updateLights = buildLab(scene);
const furniture = buildFurniture(scene);
const door = new Door();
scene.add(door.object);

// 기구: 테이블 위의 비커 등 + 보관장 속 역학·광학 기구
const stock = stockEquipment(furniture.cabinets.get('실험 기구 보관장')!);
const items: Item[] = [...createBenchItems(), ...stock.items];
for (const it of items) scene.add(it.object);

// 문·보관장 문은 광선에 맞은 부분에서 주인을 찾을 수 있게 표시해 둔다 (기구는 userData.item)
const doors: (Interactable & { update(dt: number): void })[] = [door, ...furniture.doors];
for (const d of doors) d.object.userData.interactable = d;

// ---------- 플레이어·손 ----------
const player = new Player(camera, door, SPAWN);
const hand = new Hand(scene, camera, items);
const rotateBar = new RotateBar();
for (const it of items) {
  it.onPick = (item) => hand.pickUp(item);
  it.onRotate = (item) => rotateBar.open(item);
}

// ---------- 실험 패널 (한 번에 하나만 열림, 화면 오른쪽) ----------
function panelToggled(panel: { el: HTMLElement }, open: boolean): void {
  if (open) for (const p of panels) if (p !== panel && p.isOpen) p.close();
  const shown = panels.find((p) => p.isOpen);
  stage.classList.toggle('panel-open', !!shown);
  aimShift = shown ? (shown.el.offsetWidth + 12) / 2 : 0;
  resize();
}
const pendulumPanel = new PendulumPanel((open) => panelToggled(pendulumPanel, open));
const springPanel = new SpringPanel((open) => panelToggled(springPanel, open));
const slitPanel = new SlitPanel((open) => panelToggled(slitPanel, open));
// 광전 효과: 도선으로 이은 회로를 매 프레임 해석한 결과
const wires = new WireSystem(scene);
let circuits: PhotoCircuitState[] = [];
const photoPanel = new PhotoPanel((open) => panelToggled(photoPanel, open), (s) => circuits.find((c) => c.supply === s) ?? null);
const panels = [pendulumPanel, springPanel, slitPanel, photoPanel];
for (const s of stock.strings) s.onOpenPanel = (str) => pendulumPanel.open(str);
for (const s of stock.springs) s.onOpenPanel = (sp) => springPanel.open(sp);
for (const l of stock.lasers) l.onOpenPanel = (laser) => slitPanel.open(laser);

// 전원: 실험 테이블 옆면의 콘센트 ↔ 전원이 필요한 기기(레이저)
const power = new PowerSystem(scene, furniture.outlets, [...stock.lasers, ...stock.supplies]);
for (const l of stock.lasers) l.powerActions = (laser) => power.deviceActions(laser);
for (const s of stock.supplies) {
  s.powerActions = (d) => power.deviceActions(d);
  s.onOpenPanel = (d) => photoPanel.open(d);
}

// 레이저 광선 추적
const beams = new BeamSystem(scene, items);

// ---------- 입력·UI ----------
const controls = new Controls(canvas);
const minimap = new Minimap($<HTMLCanvasElement>('minimap'), player, door, items);
bindSettingsPanel(settings, {
  resetPosition: () => player.reset(),
  applyGraphics: () => {
    resize();
    retro.setJitter(settings.jitter);
  },
});
applyRetroMaterials(scene); // 모든 재질에 PS1 정점 흔들림 적용 (첫 렌더 전에)

const roomLabel = $('room');
const debugEl = $('debug');
const heldEl = $('held');
const promptEl = $('prompt');
const menuEl = $('action-menu');
const dockEl = $('exp-dock');
let dockKey = '';

/** 왼쪽 위 "실험 바로 열기" 버튼: 지금 조립되어 있는 실험마다 하나씩 */
function updateDock(): void {
  const actions = items.flatMap((it) => it.experimentActions());
  // 정렬 안내: 레이저 빛이 슬릿판에 닿았지만 슬릿을 지나지 못할 때
  const hints = stock.lasers.map((l) => l.alignHint).filter((h): h is string => !!h);
  if (wires.pending) hints.unshift(`도선 연결 중: ${wires.pending.label} → 이을 단자를 탭하세요`);
  const key = actions.map((a) => a.label).join('|') + '#' + hints.join('|');
  if (key === dockKey) return;
  dockKey = key;
  dockEl.innerHTML = '';
  for (const h of hints) {
    const p = document.createElement('p');
    p.className = 'dock-hint';
    p.textContent = `⚠ ${h}`;
    dockEl.appendChild(p);
  }
  for (const a of actions) {
    const b = document.createElement('button');
    b.textContent = `▸ ${a.label}`;
    b.addEventListener('click', () => {
      // 버튼을 누른 순간의 최신 동작으로 실행 (목록은 매 프레임 바뀔 수 있음)
      const now = items.flatMap((it) => it.experimentActions());
      now[actions.indexOf(a)]?.run();
    });
    dockEl.appendChild(b);
  }
}

// 확대 보기: 시야각 70° ↔ 18° (약 4배 확대) — 480×270 화면에서 mm 단위 무늬·눈금을 보려면 필요
const zoomBtn = $('btn-zoom');
zoomBtn.addEventListener('click', () => {
  const on = zoomBtn.getAttribute('aria-pressed') !== 'true';
  zoomBtn.setAttribute('aria-pressed', String(on));
  camera.fov = on ? 18 : 70;
  camera.updateProjectionMatrix();
});

$('btn-enter').addEventListener('click', () => {
  $('start').hidden = true;
  $('hud').hidden = false;
  void enterFullscreen();
});

// ---------- 상호작용 판정 ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const camPos = new THREE.Vector3();

/** 화면 좌표(ndc)에서 광선을 쏴서 처음 맞는 것 (손이 닿는 거리 안) */
function raycast(x: number, y: number): THREE.Intersection | null {
  ndc.set(x, y);
  raycaster.setFromCamera(ndc, camera);
  raycaster.far = INTERACT_RANGE;
  return raycaster.intersectObjects(scene.children, true).find((h) => isPickable(h.object)) ?? null;
}

/** 맞은 부분에서 부모를 따라 올라가며 가장 가까운 주인(기구·문)을 찾는다 */
function ownerOf(o: THREE.Object3D | null): Interactable | null {
  for (; o; o = o.parent) {
    if (o.userData.item) return o.userData.item as Item;
    if (o.userData.interactable) return o.userData.interactable as Interactable;
  }
  return null;
}

/**
 * 들고 있는 물체를 끼울 소켓 찾기: 맞은 부분에서 위로 올라가며
 *  - 소켓 판정 영역을 직접 맞혔으면 그 소켓
 *  - 기구를 맞혔으면 그 기구의 소켓 중 받을 수 있는, 맞은 점에서 가장 가까운 것
 */
function findAttach(held: Item, hit: THREE.Intersection): { socket: Socket; plug: Plug } | null {
  for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
    const direct = o.userData.socket as Socket | undefined;
    if (direct) {
      const plug = direct.accept(held);
      if (plug) return { socket: direct, plug };
    }
    const item = o.userData.item as Item | undefined;
    if (!item) continue;
    let best: { socket: Socket; plug: Plug } | null = null;
    let bestD = Infinity;
    for (const s of item.sockets) {
      const plug = s.accept(held);
      if (!plug) continue;
      const d = s.opts.slide ? 0 : s.worldPosition().distanceTo(hit.point);
      if (d < bestD) {
        bestD = d;
        best = { socket: s, plug };
      }
    }
    if (best) return best;
  }
  return null;
}

/** 이 화면 위치를 탭하면 할 수 있는 동작들 */
/** 맞은 부분에서 위로 올라가며 단자(도선 꼭지)를 찾는다 */
function terminalOf(o: THREE.Object3D | null): Terminal | null {
  for (; o; o = o.parent) if (o.userData.terminal) return o.userData.terminal as Terminal;
  return null;
}

function actionsAt(x: number, y: number): Action[] {
  const hit = raycast(x, y);
  const held = hand.held;
  // 빈손으로 단자를 탭하면 도선 동작, 도선 연결 중에 다른 곳을 탭하면 취소
  const term = !held && hit ? terminalOf(hit.object) : null;
  if (term) return wires.actionsFor(term);
  if (wires.pending) return [{ label: '도선 연결 취소', run: () => { wires.pending = null; } }];
  if (held) {
    const att = hit && findAttach(held, hit);
    if (att) {
      const point = hit!.point.clone();
      // 막대에 끼울 때는 집게가 올 높이(책상 면 기준)를 미리 보여 준다.
      // 집게에 물린 물체는 잡힌 점이 집게 높이에 오므로 = 레이저 빛 높이 / 슬릿 중심 높이 (레이저·슬릿 높이 맞추기용)
      const where = att.socket.opts.slide ? ` (높이 ${Math.round(att.socket.slideValue(hit!.point) * 100)} cm)` : '';
      return [{
        label: `연결 · ${held.name} → ${att.socket.label}${where}`,
        run: () => {
          const item = hand.handOver();
          if (item) att.socket.attach(item, att.plug, point, camera.getWorldPosition(camPos));
        },
      }];
    }
    const owner = hit && ownerOf(hit.object);
    if (owner && !(owner instanceof Item)) return owner.actions(); // 들고 있어도 문은 열 수 있다
    const place = hand.findTarget(x, y);
    return place?.valid ? [{ label: '놓기', run: () => hand.place(place) }] : [];
  }
  const owner = hit && ownerOf(hit.object);
  return owner ? owner.actions() : [];
}

// ---------- 동작 선택 메뉴 (동작이 여러 개일 때 탭한 자리에) ----------
function showMenu(actions: Action[], x: number, y: number): void {
  menuEl.innerHTML = '';
  // 주 동작을 위에, 보조 동작(파장·회전·전원 뽑기 등)을 아래에
  const ordered = [...actions.filter((a) => !a.secondary), ...actions.filter((a) => a.secondary)];
  for (const a of ordered) {
    const b = document.createElement('button');
    b.textContent = a.label;
    b.addEventListener('click', () => {
      hideMenu();
      a.run();
    });
    menuEl.appendChild(b);
  }
  menuEl.hidden = false;
  // 무대 밖으로 나가지 않게
  const w = menuEl.offsetWidth;
  const h = menuEl.offsetHeight;
  menuEl.style.left = `${Math.min(Math.max(8, x + 12), stage.clientWidth - w - 8)}px`;
  menuEl.style.top = `${Math.min(Math.max(8, y - h / 2), stage.clientHeight - h - 8)}px`;
}
function hideMenu(): void {
  menuEl.hidden = true;
}
canvas.addEventListener('pointerdown', hideMenu); // 다른 곳을 만지면 닫힘

/** 짧은 탭: 주 동작이 하나면 바로, 여럿이면 메뉴 (보조 동작도 함께 보여 줌) */
function runActions(actions: Action[], x: number, y: number): void {
  const primary = actions.filter((a) => !a.secondary);
  if (primary.length === 1) primary[0].run();
  else if (primary.length > 1) showMenu(actions, x, y);
}

// ---------- 메인 루프 ----------
let last = performance.now();
let fpsFrames = 0;
let fpsTime = 0;
let fps = 0;

// 테스트용: 주소 끝이 #debug일 때만 내부 객체를 노출 (자동 테스트가 조립을 빠르게 재현하는 데 씀)
if (location.hash === '#debug') {
  (window as unknown as Record<string, unknown>).lab = { THREE, scene, camera, player, hand, items, stock, power, wires, doors: furniture.doors };
}

renderer.setAnimationLoop(() => {
  const now = performance.now();
  // 탭 전환 등으로 오래 멈췄다 돌아오면 dt가 커져 벽을 뚫을 수 있으므로 0.1초로 제한
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  controls.poll();
  const input = controls.state;

  player.update(dt, input, settings);
  for (const d of doors) d.update(dt);
  for (const s of stock.strings) {
    s.update(dt, pendulumPanel.speed, pendulumPanel.target === s);
  }
  for (const s of stock.springs) s.update(dt, springPanel.speed, springPanel.target === s);
  updateLights(now / 1000);
  camera.updateMatrixWorld();
  power.update();
  wires.update();
  circuits = solveCircuits(wires, stock.supplies, stock.ammeters, stock.tubes);
  for (const s of stock.supplies) {
    s.update();
    s.hasTube = circuits.some((c) => c.supply === s && c.tube);
  }
  for (const a of stock.ammeters) a.update();
  beams.update();
  rotateBar.update();
  hand.update(aimX);

  // 조준점 아래 안내 문구: 지금 탭하면 일어날 일 (동작이 더 있으면 "…")
  const aimed = actionsAt(aimX, 0).filter((a) => !a.secondary);
  let prompt = '';
  if (aimed.length) prompt = `[탭] ${aimed[0].label}${aimed.length > 1 ? ' …' : ''}`;
  else if (hand.held && hand.aim) prompt = '여기에는 놓을 수 없음';
  if (promptEl.textContent !== prompt) promptEl.textContent = prompt;
  promptEl.hidden = !prompt;

  if (hand.held) heldEl.textContent = `들고 있음: ${hand.held.name}`;
  heldEl.hidden = !hand.held;

  // PC: E 키 → 조준점의 첫 번째 동작
  if (input.interactKey) aimed[0]?.run();

  // 화면 탭
  for (const t of input.taps) {
    const x = (t.x / stage.clientWidth) * 2 - 1;
    const y = -(t.y / stage.clientHeight) * 2 + 1;
    runActions(actionsAt(x, y), t.x, t.y);
  }
  // 길게 누르기: 보조 동작(방향 돌리기 등)까지 모두 담은 메뉴
  for (const t of input.holds) {
    const x = (t.x / stage.clientWidth) * 2 - 1;
    const y = -(t.y / stage.clientHeight) * 2 + 1;
    const all = actionsAt(x, y);
    if (all.length) showMenu(all, t.x, t.y);
  }

  retro.render();
  minimap.draw();
  pendulumPanel.update();
  springPanel.update();
  slitPanel.update();
  photoPanel.update();
  updateDock();
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
