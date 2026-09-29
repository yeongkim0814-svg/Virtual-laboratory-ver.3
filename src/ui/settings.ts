/**
 * 설정 패널 (⚙ 버튼): 시점 감도, 이동 속도, 정보 표시
 * 설정값은 브라우저(localStorage)에 저장되어 다음에 들어와도 유지된다.
 */
const STORAGE_KEY = 'vlab-settings-v1';

export interface Settings {
  lookSensitivity: number;
  moveSpeed: number;
  showDebug: boolean;
}

const DEFAULTS: Settings = { lookSensitivity: 1.0, moveSpeed: 2.2, showDebug: true };

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return { ...DEFAULTS, ...saved };
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
export function bindSettingsPanel(settings: Settings, actions: { resetPosition(): void }): void {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const panel = $('settings');
  const sens = $<HTMLInputElement>('set-sens');
  const speed = $<HTMLInputElement>('set-speed');
  const debug = $<HTMLInputElement>('set-debug');
  const sensVal = $('set-sens-val');
  const speedVal = $('set-speed-val');

  const refresh = () => {
    sens.value = String(settings.lookSensitivity);
    speed.value = String(settings.moveSpeed);
    debug.checked = settings.showDebug;
    sensVal.textContent = settings.lookSensitivity.toFixed(1) + '×';
    speedVal.textContent = settings.moveSpeed.toFixed(1) + ' m/s';
    $('debug').hidden = !settings.showDebug;
  };
  refresh();

  sens.addEventListener('input', () => { settings.lookSensitivity = Number(sens.value); refresh(); save(settings); });
  speed.addEventListener('input', () => { settings.moveSpeed = Number(speed.value); refresh(); save(settings); });
  debug.addEventListener('change', () => { settings.showDebug = debug.checked; refresh(); save(settings); });

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
