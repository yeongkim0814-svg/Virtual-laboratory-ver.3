/**
 * 효과음 (public/audio/sfx/*.mp3, HTMLAudioElement)
 * ui 효과음(버튼 클릭)은 다른 효과음과 겹치지 않는다: 다른 소리가 나는 중·직후에는 울리지 않고, 울리는 중에 다른 소리가 오면 끊긴다.
 */

export interface SFX {
  name: string; // 파일 이름 (공백은 _ 로 바뀜)
  volume?: number; // 0..1, 기본 0.5
  rate?: number; // 재생 속도 (같은 파일로 음높이를 달리해 구분), 기본 1
  ui?: boolean; // 버튼 클릭음 — 다른 효과음과 겹치지 않음
}

const sfx = (name: string, volume: number, rate = 1, ui = false): SFX => ({ name, volume, rate, ui });

export const SFXS = {
  // 물체: 같은 "Object place" 파일을 집기는 높게(빠르게), 놓기는 기본 음높이로
  pick: sfx('Object place', 0.7, 1.25),
  place: sfx('Object place', 0.7),
  // 시약·유리 기구
  glassPick: sfx('Glass', 0.7, 1.15),
  glassPlace: sfx('Glass', 0.7),
  liquidPour: sfx('liquidPour', 0.8),
  // 보관장·문 (보관장 "닫기"는 열기 파일을 낮게)
  cabinetOpen: sfx('Cabinet open', 0.75),
  cabinetClose: sfx('Cabinet open', 0.75, 0.8),
  doorOpen: sfx('Wood door open', 0.65),
  doorClose: sfx('Wood door close', 0.65),
  // 전원
  switchOn: sfx('Switch on', 0.8),
  generatorOn: sfx('Generator on', 0.8),
  switchOff: sfx('Switch off', 0.8),
  // 끼우기·도선 (클릭음과 다르게 "놓기" 파일을 높게)
  attach: sfx('Object place', 0.6, 1.6),
  wireConnect: sfx('Object place', 0.6, 1.6),
  wireDisconnect: sfx('Object place', 0.6, 1.9),
  // UI·알림
  uiClick: sfx('Interface click', 0.7, 1, true),
  reject: sfx('Negative Notification', 0.9),
  measureDone: sfx('measureDone', 0.8),
  bulbOn: sfx('Switch on', 0.8),
  bulbOff: sfx('Switch off', 0.8),
} as const;

const UI_GUARD_MS = 350; // 다른 소리 직후 이 시간 안의 버튼 클릭음은 생략

export class AudioManager {
  private audioCache = new Map<string, HTMLAudioElement>();
  private enabled = true;
  private masterVolume = 0.5;
  private lastOtherAt = -Infinity;
  private uiKeys = new Set<string>();

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  /** 지금 울리는 (반복 아닌) 비-UI 효과음이 있는가 */
  private otherPlaying(): boolean {
    for (const [k, a] of this.audioCache) if (!this.uiKeys.has(k) && !a.loop && !a.paused && !a.ended) return true;
    return false;
  }

  play(s: SFX): void {
    if (!this.enabled) return;
    try {
      const key = `${s.name}@${s.rate ?? 1}`;
      const now = performance.now();
      if (s.ui) {
        if (now - this.lastOtherAt < UI_GUARD_MS || this.otherPlaying()) return;
        this.uiKeys.add(key);
      } else {
        this.lastOtherAt = now;
        for (const k of this.uiKeys) this.audioCache.get(k)?.pause(); // 울리던 클릭음은 끊는다
      }
      const audio = this.getOrCreateAudio(key, s.name);
      audio.volume = Math.min(1, (s.volume ?? 0.5) * this.masterVolume * 2);
      audio.playbackRate = s.rate ?? 1;
      audio.currentTime = 0;
      audio.play().catch((err) => console.log(`재생 실패 (${s.name}):`, err.message));
    } catch (e) {
      console.log(`SFX 재생 오류 (${s.name}):`, e);
    }
  }

  private getOrCreateAudio(key: string, name: string): HTMLAudioElement {
    let a = this.audioCache.get(key);
    if (!a) {
      a = new Audio(`audio/sfx/${name.replace(/\s+/g, '_')}.mp3`);
      a.preload = 'auto';
      a.preservesPitch = false; // 속도 = 음높이
      this.audioCache.set(key, a);
    }
    return a;
  }

  /** 전등 떨림음: 반복되는 버징음 */
  bulbFlicker(_itemId: string, enabled: boolean): void {
    if (!this.enabled) return;
    try {
      const a = this.getOrCreateAudio('bulbFlicker@1', 'bulbFlicker');
      if (enabled) {
        a.volume = 0.5 * this.masterVolume;
        a.loop = true;
        a.play().catch((err) => console.log('떨림음 재생 실패:', err.message));
      } else a.pause();
    } catch (e) {
      console.log('떨림음 오류:', e);
    }
  }

  setMasterVolume(v: number): void {
    this.masterVolume = Math.max(0, Math.min(1, v));
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}

export const audioManager = new AudioManager();
