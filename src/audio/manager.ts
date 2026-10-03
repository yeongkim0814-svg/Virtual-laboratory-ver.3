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

/** 효과음 정의 (Google Drive 파일) */
export const SFXS = {
  pick: { name: 'pick', driveId: DRIVE_FILES.pick, volume: 0.7 } as SFX,
  place: { name: 'place', driveId: DRIVE_FILES.place, volume: 0.7 } as SFX,
  attach: { name: 'attach', driveId: DRIVE_FILES.attach, volume: 0.8 } as SFX,
  reject: { name: 'reject', driveId: DRIVE_FILES.reject, volume: 0.9 } as SFX,
  bulbOn: { name: 'bulbOn', driveId: DRIVE_FILES.bulbOn, volume: 0.8 } as SFX,
  bulbOff: { name: 'bulbOff', driveId: DRIVE_FILES.bulbOff, volume: 0.8 } as SFX,
  wireConnect: { name: 'wireConnect', driveId: DRIVE_FILES.wireConnect, volume: 0.75 } as SFX,
  wireDisconnect: { name: 'wireDisconnect', driveId: DRIVE_FILES.wireDisconnect, volume: 0.75 } as SFX,
  doorOpen: { name: 'doorOpen', driveId: DRIVE_FILES.doorOpen, volume: 0.65 } as SFX,
  doorClose: { name: 'doorClose', driveId: DRIVE_FILES.doorClose, volume: 0.65 } as SFX,
} as const;

export class AudioManager {
  private audioCache = new Map<string, HTMLAudioElement>();
  private enabled = true;
  private masterVolume = 0.5;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  /**
   * Google Drive에서 MP3 재생
   * 파일 ID를 사용해 재생 URL 생성 후 HTMLAudioElement로 재생
   */
  play(sfx: SFX): void {
    if (!this.enabled) return;
    try {
      const url = `https://drive.google.com/uc?export=download&id=${sfx.driveId}`;
      const audio = this.getOrCreateAudio(sfx.driveId);
      audio.src = url;
      audio.volume = (sfx.volume ?? 0.5) * this.masterVolume;
      audio.currentTime = 0;
      audio.play().catch((err) => console.log(`재생 실패 (${sfx.name}):`, err.message));
    } catch (e) {
      console.log(`SFX 재생 오류 (${sfx.name}):`, e);
    }
  }

  /** 오디오 엘리먼트 캐시 (재사용) */
  private getOrCreateAudio(driveId: string): HTMLAudioElement {
    if (!this.audioCache.has(driveId)) {
      const audio = new Audio();
      audio.preload = 'auto';
      // CORS 문제 방지
      audio.crossOrigin = 'anonymous';
      this.audioCache.set(driveId, audio);
    }
    return this.audioCache.get(driveId)!;
  }

  /**
   * 전등 떨림음: 반복되는 버징음
   * itemId: 고유 식별자 (예: items[0].name)
   */
  bulbFlicker(itemId: string, enabled: boolean): void {
    if (!this.enabled) return;
    try {
      if (enabled) {
        const audio = this.getOrCreateAudio('bulbFlicker');
        audio.src = `https://drive.google.com/uc?export=download&id=${DRIVE_FILES.bulbFlicker}`;
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
