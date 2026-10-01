/**
 * 설정 패널 (⚙ 버튼): 시점 감도, 이동 속도, 화면 해상도, PS1 떨림, 정보 표시
 * 설정값은 브라우저(localStorage)에 저장되어 다음에 들어와도 유지된다.
 */
const STORAGE_KEY = 'vlab-settings-v1';

export interface Settings {
  lookSensitivity: number;
  moveSpeed: number;
  /** 앉았을 때 눈높이 (m) */
  crouchEye: number;
  showDebug: boolean;
  /** 내 두 손 보이기 (1인칭) */
  showHands: boolean;
  /** 진동 피드백 (조작 결과·버튼 누름) */
  haptics: boolean;
  /** 터치 표시 (탭 물결·길게 누르기 고리) */
  touchMarks: boolean;
  /** 내부 렌더링 세로 픽셀 수 (240 / 270 / 360) — 작을수록 도트가 굵다 */
  pixelHeight: number;
  /** PS1식 정점 흔들림 */
  jitter: boolean;
}

const DEFAULTS: Settings = { lookSensitivity: 1.0, moveSpeed: 2.2, crouchEye: 1.0, showDebug: true, showHands: true, haptics: true, touchMarks: true, pixelHeight: 270, jitter: true };
const PIXEL_HEIGHTS = [240, 270, 360];

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    const s = { ...DEFAULTS, ...saved };
    if (!PIXEL_HEIGHTS.includes(s.pixelHeight)) s.pixelHeight = DEFAULTS.pixelHeight;
    return s;
  } catch {
    return { ...DEFAULTS };
  }
}

function save(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* 저장이 막힌 환경(시크릿 모드 등)에서는 저장만 생략 */
  }
}

/** 패널의 입력 요소와 settings 객체를 연결한다. */
export function bindSettingsPanel(settings: Settings, actions: { resetPosition(): void; applyGraphics(): void }): void {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const panel = $('settings');
  const sens = $<HTMLInputElement>('set-sens');
  const speed = $<HTMLInputElement>('set-speed');
  const debug = $<HTMLInputElement>('set-debug');
  const jitter = $<HTMLInputElement>('set-jitter');
  const hands = $<HTMLInputElement>('set-hands');
  const haptics = $<HTMLInputElement>('set-haptics');
  const marks = $<HTMLInputElement>('set-marks');
  const resButtons = [...document.querySelectorAll<HTMLButtonElement>('#set-res button')];
  const sensVal = $('set-sens-val');
  const speedVal = $('set-speed-val');
  const crouch = $<HTMLInputElement>('set-crouch');
  const crouchVal = $('set-crouch-val');

  const refresh = () => {
    sens.value = String(settings.lookSensitivity);
    speed.value = String(settings.moveSpeed);
    crouch.value = String(settings.crouchEye);
    crouchVal.textContent = settings.crouchEye.toFixed(2) + ' m';
    debug.checked = settings.showDebug;
    jitter.checked = settings.jitter;
    hands.checked = settings.showHands;
    haptics.checked = settings.haptics;
    marks.checked = settings.touchMarks;
    for (const b of resButtons) b.setAttribute('aria-pressed', String(Number(b.dataset.h) === settings.pixelHeight));
    sensVal.textContent = settings.lookSensitivity.toFixed(1) + '×';
    speedVal.textContent = settings.moveSpeed.toFixed(1) + ' m/s';
    $('debug').hidden = !settings.showDebug;
  };
  refresh();

  sens.addEventListener('input', () => { settings.lookSensitivity = Number(sens.value); refresh(); save(settings); });
  speed.addEventListener('input', () => { settings.moveSpeed = Number(speed.value); refresh(); save(settings); });
  crouch.addEventListener('input', () => { settings.crouchEye = Number(crouch.value); refresh(); save(settings); });
  debug.addEventListener('change', () => { settings.showDebug = debug.checked; refresh(); save(settings); });
  hands.addEventListener('change', () => { settings.showHands = hands.checked; refresh(); save(settings); });
  haptics.addEventListener('change', () => { settings.haptics = haptics.checked; refresh(); save(settings); });
  // 진동 시험: 설정과 상관없이 0.3 s 진동을 직접 호출하고 브라우저가 돌려준 값을 보여 준다 (안 느껴질 때 원인 구분용)
  $('set-vib-test').addEventListener('click', () => {
    const out = $('set-vib-status');
    if (!('vibrate' in navigator)) { out.textContent = '이 브라우저는 진동 API를 지원하지 않음 (크롬으로 열어 보세요)'; return; }
    let r = false;
    try { r = navigator.vibrate(300); } catch { /* 아래 문구 */ }
    out.textContent = r
      ? '진동을 요청함 (브라우저가 받아들임). 안 느껴지면 기기 설정의 진동 세기·방해 금지·절전 모드를 확인 — 갤럭시 탭 일부 모델은 진동 모터가 없음'
      : '브라우저가 진동 요청을 거부함 (화면을 한 번 더 탭한 뒤 다시 시도)';
  });
  marks.addEventListener('change', () => { settings.touchMarks = marks.checked; refresh(); save(settings); });
  jitter.addEventListener('change', () => { settings.jitter = jitter.checked; refresh(); save(settings); actions.applyGraphics(); });
  for (const b of resButtons) {
    b.addEventListener('click', () => { settings.pixelHeight = Number(b.dataset.h); refresh(); save(settings); actions.applyGraphics(); });
  }

  $('btn-settings').addEventListener('click', () => { panel.hidden = !panel.hidden; });
  $('set-close').addEventListener('click', () => { panel.hidden = true; });
  $('set-reset').addEventListener('click', () => { actions.resetPosition(); panel.hidden = true; });
  $('set-fullscreen').addEventListener('click', () => { void enterFullscreen(); });
}

/** 전체화면 + 가로 화면 고정 (안드로이드 크롬에서 동작, 실패해도 무시) */
export async function enterFullscreen(): Promise<void> {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    // lock()은 TS 기본 타입에 없는 브라우저가 있어 느슨하게 호출
    await (screen.orientation as unknown as { lock(o: string): Promise<void> }).lock('landscape');
  } catch {
    /* 지원하지 않는 브라우저 */
  }
}
