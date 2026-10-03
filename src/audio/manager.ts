/**
 * Google Drive MP3 파일 기반 효과음 시스템
 * 각 파일은 Google Drive에서 직접 재생됨 (Web Audio 신타시스 제거)
 * BGM은 Google Drive에서 스트리밍
 */

export interface SFX {
  name: string;
  driveId: string; // Google Drive 파일 ID
  volume?: number; // 0..1, 기본 0.5
}

/** Google Drive 효과음 파일 맵 */
export const DRIVE_FILES = {
  pick: '1sYc2xSLvY5wWNXIc6aZAf9iUJ96VCl2q', // Object place.mp3 사용 (또는 새로운 pick 파일)
  place: '1NZd-XOOrcJ_1irgr-b9JZ-7v7W5_qBcq', // Object place.mp3
  attach: '14hzdObQPl-sOIpXTGLHZLHyds7aOd5pd', // Interface click.mp3
  reject: '1v6x_5Ra6OhGIDtNczTq0LOk9pZUZnGRN', // Negative Notification.mp3
  bulbOn: '1LsnP6s3ffY4K7K529EwDz44X7lZeRACZ', // Switch on.mp3
  bulbOff: '1Xx_SxkRHKcVMumYpiVbZIsYGd1RkzxVY', // Switch off.mp3
  bulbFlicker: '1wDaaE8NUzK_Yq5aD1J8Pxquyvgtz3aOU', // flickeringlight2.mp3
  wireConnect: '14hzdObQPl-sOIpXTGLHZLHyds7aOd5pd', // Interface click.mp3 (재사용)
  wireDisconnect: '1v6x_5Ra6OhGIDtNczTq0LOk9pZUZnGRN', // Negative Notification.mp3
  doorOpen: '1bg-wu3mX4-gqjGa8tBwSrCVck6OO0jfm', // Wood door open.mp3
  doorClose: '1sYc2xSLvY5wWNXIc6aZAf9iUJ96VCl2q', // Wood door close.mp3
  liquidPour: '10bDcT4w0JtGmsRnYotva_kssvRdz6U_Q', // Liquid pouring.mp3
  measureDone: '126houS5AWS92c832nGPQEPucIWSWaan2', // Measure done.mp3
} as const;

/** 효과음 정의 (로컬 MP3 파일) */
export const SFXS = {
  // 기본 인터랙션
  pick: { name: 'pick', driveId: '', volume: 0.7 } as SFX,                  // 물체 집기 (시약 제외)
  place: { name: 'place', driveId: '', volume: 0.7 } as SFX,                // 물체 놓기 (시약 제외)
  glass: { name: 'glass', driveId: '', volume: 0.7 } as SFX,                // 시약/유리 제품 집기/놓기
  liquidPour: { name: 'liquidPour', driveId: '', volume: 0.8 } as SFX,      // 액체 붓기

  // 문/캐비넷
  cabinetOpen: { name: 'Cabinet open', driveId: '', volume: 0.75 } as SFX,  // 캐비넷 열기
  cabinetClose: { name: 'Cabinet open', driveId: '', volume: 0.75 } as SFX, // 캐비넷 닫기 (같은 음)
  doorOpen: { name: 'Wood door open', driveId: '', volume: 0.65 } as SFX,    // 문 열기
  doorClose: { name: 'Wood door close', driveId: '', volume: 0.65 } as SFX,  // 문 닫기

  // 전원
  switchOn: { name: 'Switch on', driveId: '', volume: 0.8 } as SFX,         // 아날로그 기기 전원 ON
  generatorOn: { name: 'Generator on', driveId: '', volume: 0.8 } as SFX,   // 디지털 기기(오실로스코프 등) 전원 ON
  switchOff: { name: 'Switch off', driveId: '', volume: 0.8 } as SFX,       // 디지털 기기 전원 OFF

  // UI
  uiClick: { name: 'Interface click', driveId: '', volume: 0.7 } as SFX,    // UI 클릭 (점프 제외, 돋보기, 설정 등)
  reject: { name: 'Negative Notification', driveId: '', volume: 0.9 } as SFX, // 거부
  measureDone: { name: 'measureDone', driveId: '', volume: 0.8 } as SFX,    // 완료

  // 호환성 (기존 코드)
  attach: { name: 'Interface click', driveId: '', volume: 0.8 } as SFX,
  wireConnect: { name: 'Interface click', driveId: '', volume: 0.75 } as SFX,
  wireDisconnect: { name: 'reject', driveId: '', volume: 0.75 } as SFX,
  bulbOn: { name: 'Switch on', driveId: '', volume: 0.8 } as SFX,
  bulbOff: { name: 'Switch off', driveId: '', volume: 0.8 } as SFX,
} as const;

export class AudioManager {
  private audioCache = new Map<string, HTMLAudioElement>();
  private enabled = true;
  private masterVolume = 0.5;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  /**
   * 로컬 MP3 파일 재생 (public/audio/sfx/ 에서)
   */
  play(sfx: SFX): void {
    if (!this.enabled) return;
    try {
      // 파일명 정규화: 공백을 언더스코어로, 소문자 변환 (필요시)
      const filename = sfx.name.replace(/\s+/g, '_');
      const url = `audio/sfx/${filename}.mp3`;
      const audio = this.getOrCreateAudio(sfx.name);
      audio.src = url;
      audio.volume = (sfx.volume ?? 0.5) * this.masterVolume;
      audio.currentTime = 0;
      audio.play().catch((err) => console.log(`재생 실패 (${sfx.name}):`, err.message));
    } catch (e) {
      console.log(`SFX 재생 오류 (${sfx.name}):`, e);
    }
  }

  /** 오디오 엘리먼트 캐시 (재사용) */
  private getOrCreateAudio(name: string): HTMLAudioElement {
    if (!this.audioCache.has(name)) {
      const audio = new Audio();
      audio.preload = 'auto';
      this.audioCache.set(name, audio);
    }
    return this.audioCache.get(name)!;
  }

  /**
   * 전등 떨림음: 반복되는 버징음
   */
  bulbFlicker(itemId: string, enabled: boolean): void {
    if (!this.enabled) return;
    try {
      if (enabled) {
        const audio = this.getOrCreateAudio('bulbFlicker');
        audio.src = 'audio/sfx/bulbFlicker.mp3';
        audio.volume = 0.5 * this.masterVolume;
        audio.loop = true;
        audio.play().catch((err) => console.log('떨림음 재생 실패:', err.message));
      } else {
        // 중단 로직 (캐시된 오디오 정지)
        if (this.audioCache.has('bulbFlicker')) {
          this.audioCache.get('bulbFlicker')!.pause();
        }
      }
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
