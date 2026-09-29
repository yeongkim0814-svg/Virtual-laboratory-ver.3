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
import { createBenchItems, HITBOX_MAT, Item, type Plug, type Socket } from './world/items';
import { equipmentBoxes } from './world/cable';
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
import { SupplyPanel } from './ui/supplyPanel';
import { TrackPanel } from './ui/trackPanel';
import { LoggerPanel } from './ui/loggerPanel';
import { SensorNetwork } from './equipment/sensors';
import { Rail } from './equipment/track';
import { Container, WasteCan, chemHooks } from './equipment/glassware';
import { PourBar } from './ui/pourBar';
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
const stock = stockEquipment(furniture.cabinets);
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
const supplyPanel = new SupplyPanel((open) => panelToggled(supplyPanel, open));
const trackPanel = new TrackPanel((open) => panelToggled(trackPanel, open));
const loggerPanel = new LoggerPanel((open) => panelToggled(loggerPanel, open));
const panels = [pendulumPanel, springPanel, slitPanel, photoPanel, supplyPanel, trackPanel, loggerPanel];
// 센서 ↔ 노트북 (USB)
const sensorNet = new SensorNetwork(scene, stock.laptops, [...stock.motionSensors, ...stock.phSensors]);
for (const l of stock.laptops) l.onOpenPanel = (lap) => loggerPanel.open(lap);

// ---------- 화학: 따르기 · 알림 · 폐액통 ----------
const pourBar = new PourBar();
const toastEl = $('toast');
let toastTimer = 0;
function toast(html: string): void {
  toastEl.innerHTML = html;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toastEl.hidden = true; }, 4500);
}
/** src에서 mL만큼 떠서 dst에 붓는다 (몰수는 같은 비율로 따라간다) */
function transfer(src: Container, dst: Container, mL: number): void {
  dst.solution.add(src.solution.take(mL / 1000));
  if (src.kind === 'burette') dst.titrantAdded += mL; // 적정 곡선의 가로축
  src.refresh();
  dst.refresh();
  const digits = Math.min(src.precision, dst.precision) < 0.1 ? 2 : 1;
  toast(`${src.name} → ${dst.name}: ${mL.toFixed(digits)} mL · ${dst.name} ${dst.solution.colorName(dst.pathCm)}`);
}
/** 뷰렛 끝 바로 아래(가로 거리 < 그릇 반지름, 40 cm 이내)에 입구가 있는 그릇 */
function containerBelow(b: Container): Container | null {
  b.object.updateWorldMatrix(true, false);
  const tip = b.object.localToWorld(new THREE.Vector3(0, 0, 0));
  let best: Container | null = null;
  let bestDy = 0.4;
  for (const c of stock.containers) {
    if (c === b || c.kind === 'bottle' || c.root().object.parent !== scene) continue;
    c.object.updateWorldMatrix(true, false);
    const base = c.object.getWorldPosition(new THREE.Vector3());
    const dy = tip.y - (base.y + c.height);
    if (dy < -0.02 || dy > bestDy) continue;
    if (Math.hypot(tip.x - base.x, tip.z - base.z) > c.radius) continue;
    best = c;
    bestDy = dy;
  }
  return best;
}
chemHooks.toast = toast;
chemHooks.pour = (src, dst) => {
  if (dst.free <= 0) return toast(`${dst.name}이(가) 가득 참`);
  if (src.volume <= 0) return toast(`${src.name}이(가) 비어 있음`);
  pourBar.open(src, dst, `${src.name} → ${dst.name}`, (mL) => transfer(src, dst, mL));
};
chemHooks.dispense = (b) => {
  const t = containerBelow(b);
  if (!t) return toast(`${b.name} 끝 바로 아래에 그릇이 없음 — 클램프 높이·그릇 위치를 맞추세요`);
  pourBar.open(b, t, `${b.name} → ${t.name} (적하)`, (mL) => transfer(b, t, mL));
};
/**
 * 뷰렛 콕이 열려 있으면 매 프레임 흘려보낸다 (속도 × 시간). 아래에 그릇이 없으면 책상에 흘러 버린다.
 */
let spillWarned = false;
function updateBurettes(dt: number): void {
  for (const b of stock.containers) {
    if (b.kind !== 'burette') continue;
    let fall = 0.1;
    if (b.flowRate > 0) {
      if (!b.attachedTo || b.volume <= 0) {
        if (b.volume <= 0) toast(`${b.name}이(가) 비어 콕을 잠갔습니다`);
        b.flowRate = 0;
      } else {
        const t = containerBelow(b);
        const mL = Math.min(b.flowRate * Math.min(dt, 0.1), b.volume);
        const part = b.solution.take(mL / 1000);
        if (t && t.free > mL) {
          t.solution.add(part);
          t.titrantAdded += mL;
          t.refresh();
          const tip = b.object.localToWorld(new THREE.Vector3(0, 0, 0));
          fall = Math.max(0.01, tip.y - t.object.localToWorld(new THREE.Vector3(0, t.surfaceY, 0)).y);
          spillWarned = false;
        } else if (!spillWarned) {
          spillWarned = true;
          toast(`${b.name} 아래에 받을 그릇이 없어(또는 가득 차) 흘러 버리고 있습니다 — 콕을 잠그세요`);
        }
        b.refresh();
      }
    }
    b.animateDrip(dt, fall);
  }
}

const wasteCans = furniture.wasteCans.map((o, i) => new WasteCan(o, `폐액통 ${i + 1}`));
for (const w of wasteCans) w.getHeld = () => hand.held;
for (const s of stock.motionSensors) {
  // 레일 끝에 끼워져 있으면 레일의 재생 속도(느리게 보기)만큼 시간도 느리게 흐른다 → 측정값은 실제 물리량
  s.timeScale = () => (s.attachedTo?.owner instanceof Rail ? s.attachedTo.owner.speed : 1);
}
for (const r of stock.rails) r.onOpenPanel = (rail) => trackPanel.open(rail);
for (const s of stock.strings) s.onOpenPanel = (str) => pendulumPanel.open(str);
for (const s of stock.springs) s.onOpenPanel = (sp) => springPanel.open(sp);
for (const l of stock.lasers) l.onOpenPanel = (laser) => slitPanel.open(laser);

// 전원: 실험 테이블 옆면의 콘센트 ↔ 전원이 필요한 기기(레이저)
const power = new PowerSystem(scene, furniture.outlets, [...stock.lasers, ...stock.supplies]);
for (const l of stock.lasers) l.powerActions = (laser) => power.deviceActions(laser);
for (const s of stock.supplies) {
  s.powerActions = (d) => power.deviceActions(d);
  s.onOpenPanel = (d) => photoPanel.open(d);
  s.onOpenControls = (d) => supplyPanel.open(d);
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
  if (wires.pending) hints.unshift(`도선 연결 중: ${wires.pending.label} → 이을 단자나 기구를 탭 (빈 곳을 탭하면 취소)`);
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
// 조작 방법 도움말: ? 버튼으로 열고 닫기
const helpEl = $('help');
$('btn-help').addEventListener('click', () => { helpEl.hidden = !helpEl.hidden; });
$('help-close').addEventListener('click', () => { helpEl.hidden = true; });
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

/** 기구에 달린 단자들 (자기 것만, 끼워진 다른 기구의 단자는 빼고) */
function terminalsOf(item: Item): Terminal[] {
  const out: Terminal[] = [];
  item.object.traverse((o) => {
    const t = o.userData.terminal as Terminal | undefined;
    if (t && t.owner === item) out.push(t);
  });
  return out;
}

/** 도선을 잇는 중: 단자를 탭하면 바로 연결, 기구를 탭하면 그 기구의 단자 고르기, 다른 곳은 취소 */
function pendingWireActions(hit: THREE.Intersection | null): Action[] {
  const p = wires.pending!;
  const term = hit ? terminalOf(hit.object) : null;
  if (term && term !== p) return wires.actionsFor(term);
  const owner = hit && ownerOf(hit.object);
  if (owner instanceof Item) {
    const ts = terminalsOf(owner).filter((t) => t !== p);
    if (ts.length) return ts.map((t) => wires.actionsFor(t)[0]);
  }
  return [{ label: '도선 연결 취소', run: () => { wires.pending = null; } }];
}

/**
 * 한 번 탭: 빈손이면 기구 집기 · 문/콘센트 동작, 들고 있으면 놓기
 * (도선 연결 중이면 이을 단자 고르기)
 */
function singleActionsAt(x: number, y: number): Action[] {
  const hit = raycast(x, y);
  if (wires.pending) return pendingWireActions(hit);
  const owner = hit && ownerOf(hit.object);
  if (hand.held) {
    if (owner && !(owner instanceof Item)) return owner.actions(); // 들고 있어도 문·콘센트는 다룰 수 있다
    const place = hand.findTarget(x, y);
    return place?.valid ? [{ label: '놓기', run: () => hand.place(place) }] : [];
  }
  if (owner instanceof Item) return owner.actions().filter((a) => a.kind === 'pick');
  return owner ? owner.actions() : [];
}

/**
 * 두 번 탭: 배치된 기구의 조작 전부
 *  - 빈손: 실험 열기, 전원, 켜기/끄기, 파장·세기, 회전, 높이, 도선 연결 시작/빼기
 *  - 들고 있음: 탭한 기구에 끼우기·매달기
 */
function doubleActionsAt(x: number, y: number): Action[] {
  const hit = raycast(x, y);
  if (wires.pending) return pendingWireActions(hit);
  if (!hit) return [];
  const held = hand.held;
  if (held) {
    // 들고 있는 것으로 탭한 기구에 할 수 있는 일 (따르기·지시약 떨어뜨리기 등) + 끼우기
    const target = ownerOf(hit.object);
    const use = target instanceof Item ? held.useOn(target) : [];
    const att = findAttach(held, hit);
    if (!att) return use;
    const point = hit.point.clone();
    // 막대에 끼울 때는 집게가 올 높이(책상 면 기준)를 미리 보여 준다 (레이저·슬릿 높이 맞추기용)
    const where = att.socket.opts.slide ? ` (높이 ${Math.round(att.socket.slideValue(hit.point) * 100)} cm)` : '';
    return [...use, {
      label: `연결 · ${held.name} → ${att.socket.label}${where}`,
      run: () => {
        const item = hand.handOver();
        if (item) att.socket.attach(item, att.plug, point, camera.getWorldPosition(camPos));
      },
    }];
  }
  const term = terminalOf(hit.object);
  if (term) return wires.actionsFor(term); // 단자를 직접 두 번 탭 → 그 단자에서 도선 시작
  const owner = ownerOf(hit.object);
  if (!(owner instanceof Item)) return [];
  const acts = owner.actions().filter((a) => a.kind !== 'pick');
  for (const t of terminalsOf(owner)) {
    acts.push({ label: `도선 연결 시작 · ${t.name}`, run: () => { wires.pending = t; } });
    for (const w of t.wires) {
      const other = w.a === t ? w.b : w.a;
      acts.push({ label: `도선 빼기 · ${t.name} ↔ ${other.label}`, secondary: true, run: () => wires.remove(w) });
    }
  }
  return acts;
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

/** 동작이 하나면 바로, 여럿이면 탭한 자리에 메뉴 */
function runActions(actions: Action[], x: number, y: number): void {
  if (actions.length === 1) actions[0].run();
  else if (actions.length > 1) showMenu(actions, x, y);
}

/**
 * 한 번 탭 / 두 번 탭 구별: 탭하면 0.3초 기다렸다가 두 번째 탭이 같은 자리(60 px 안)에 오면 두 번 탭.
 * 그 자리에 두 번 탭 동작이 없으면 기다리지 않고 바로 한 번 탭으로 처리한다 (반응이 늦지 않게).
 */
const DOUBLE_MS = 300;
let firstTap: { x: number; y: number; t: number; timer: number; run: () => void } | null = null;
function handleTap(px: number, py: number): void {
  const x = (px / stage.clientWidth) * 2 - 1;
  const y = -(py / stage.clientHeight) * 2 + 1;
  const now = performance.now();
  if (firstTap && now - firstTap.t < DOUBLE_MS && Math.hypot(px - firstTap.x, py - firstTap.y) < 60) {
    clearTimeout(firstTap.timer);
    firstTap = null;
    runActions(doubleActionsAt(x, y), px, py);
    return;
  }
  if (firstTap) { // 다른 자리를 탭함 → 앞의 탭은 한 번 탭으로 바로 처리
    clearTimeout(firstTap.timer);
    firstTap.run();
    firstTap = null;
  }
  const single = singleActionsAt(x, y);
  const run = () => runActions(single, px, py);
  if (wires.pending || !doubleActionsAt(x, y).length) {
    run();
    return;
  }
  firstTap = { x: px, y: py, t: now, run, timer: window.setTimeout(() => { firstTap = null; run(); }, DOUBLE_MS) };
}

// ---------- 메인 루프 ----------
let last = performance.now();
let fpsFrames = 0;
let fpsTime = 0;
let fps = 0;

/**
 * 전선이 돌아갈 장비 상자: 장면에 놓인 기구마다 보이는 부품을 합친 월드 상자 하나.
 * (손에 든 기구, 투명 판정용 원기둥, 단자 꼭지, 전선·실은 뺀다. 클램프처럼 떠 있는 기구는 cable.ts에서 높이로 거른다)
 */
const tmpBox = new THREE.Box3();
const itemBox = new THREE.Box3();
const toItem = new THREE.Matrix4();
const tmpM = new THREE.Matrix4();
function collectEquipmentBoxes(): void {
  equipmentBoxes.length = 0;
  if (!wires.wires.length && !power.hasCords()) return;
  for (const it of items) {
    const root = it.root();
    if (root.object.parent !== scene) continue;
    // 기구 자신의 좌표계에서 상자를 만든다 → 비스듬히 놓여도 딱 맞는 (돌려 놓인) 상자
    it.object.updateWorldMatrix(true, false);
    toItem.copy(it.object.matrixWorld).invert();
    itemBox.makeEmpty();
    const visit = (o: THREE.Object3D): void => {
      if (!o.visible || (o !== it.object && o.userData.item) || o.userData.noPick || o.userData.cableIgnore) return;
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material !== HITBOX_MAT) {
        const g = m.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        itemBox.union(tmpBox.copy(g.boundingBox!).applyMatrix4(tmpM.multiplyMatrices(toItem, m.matrixWorld)));
      }
      for (const c of o.children) visit(c);
    };
    visit(it.object);
    if (itemBox.isEmpty()) continue;
    const e = it.object.matrixWorld.elements;
    const c = itemBox.getCenter(new THREE.Vector3()).applyMatrix4(it.object.matrixWorld);
    const u = new THREE.Vector3(e[0], 0, e[2]).normalize();
    const v = new THREE.Vector3(e[8], 0, e[10]).normalize();
    const y0 = new THREE.Vector3(0, itemBox.min.y, 0).applyMatrix4(it.object.matrixWorld).y;
    const y1 = new THREE.Vector3(0, itemBox.max.y, 0).applyMatrix4(it.object.matrixWorld).y;
    equipmentBoxes.push({
      cx: c.x, cz: c.z, ux: u.x, uz: u.z, vx: v.x, vz: v.z,
      hx: (itemBox.max.x - itemBox.min.x) / 2, hz: (itemBox.max.z - itemBox.min.z) / 2,
      bottom: Math.min(y0, y1), top: Math.max(y0, y1), owner: root.object,
    });
  }
}

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
  for (const r of stock.rails) r.update(dt);
  updateBurettes(dt);
  sensorNet.update();
  for (const l of stock.laptops) l.update(dt, scene);
  updateLights(now / 1000);
  camera.updateMatrixWorld();
  collectEquipmentBoxes();
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

  // 조준점 아래: 조준한 장비의 이름만 (단자는 "기구 +"처럼). 조작 방법은 ? 버튼의 도움말 페이지에
  const aimHitObj = raycast(aimX, 0)?.object ?? null;
  const aimTerm = terminalOf(aimHitObj);
  const aimOwner = ownerOf(aimHitObj);
  const prompt = aimTerm ? aimTerm.label : aimOwner instanceof Item ? aimOwner.name : ((aimOwner as { name?: string } | null)?.name ?? '');
  if (promptEl.textContent !== prompt) promptEl.textContent = prompt;
  promptEl.hidden = !prompt;

  if (hand.held) heldEl.textContent = `들고 있음: ${hand.held.name}`;
  heldEl.hidden = !hand.held;

  // PC: E 키 → 조준점의 첫 번째 동작
  if (input.interactKey) singleActionsAt(aimX, 0)[0]?.run();

  // 화면 탭 (한 번 / 두 번 구별)
  for (const t of input.taps) handleTap(t.x, t.y);
  // 길게 누르기 = 두 번 탭과 같은 조작 메뉴
  for (const t of input.holds) {
    const x = (t.x / stage.clientWidth) * 2 - 1;
    const y = -(t.y / stage.clientHeight) * 2 + 1;
    const all = doubleActionsAt(x, y);
    if (all.length) showMenu(all, t.x, t.y);
  }
  // 도선 잇는 중: 단자에서 조준점까지 미리 보기 선
  const aimHit = wires.pending ? raycast(aimX, 0) : null;
  wires.updatePreview(wires.pending ? (aimHit?.point ?? camera.getWorldPosition(camPos).addScaledVector(camera.getWorldDirection(new THREE.Vector3()), 0.8)) : null);

  retro.render();
  minimap.draw();
  pendulumPanel.update();
  springPanel.update();
  slitPanel.update();
  photoPanel.update();
  supplyPanel.update();
  trackPanel.update();
  loggerPanel.update();
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
