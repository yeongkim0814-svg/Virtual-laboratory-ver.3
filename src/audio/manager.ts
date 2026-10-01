/**
 * Web Audio API를 사용한 음향 합성 (진동 대체)
 * 효과음: 집기·놓기·끼우기·거부·전등(켜기/꺼짐/떨림)·도선 연결 등
 * BGM 자리: 향후 MP3/OGG 대체 가능 (로드 로직만 추가)
 */

export interface SFX {
  name: string;
  freq: number | [number, number]; // Hz 또는 [시작, 끝]
  duration: number; // 초
  envelope: 'linear' | 'exp' | 'pulse';
  volume?: number; // 0..1, 기본 0.1
}

/** 효과음 정의 */
export const SFXS = {
  pick: { name: 'pick', freq: [400, 600], duration: 0.15, envelope: 'linear', volume: 0.08 } as SFX,
  place: { name: 'place', freq: [300, 150], duration: 0.2, envelope: 'linear', volume: 0.08 } as SFX,
  attach: { name: 'attach', freq: 500, duration: 0.05, envelope: 'pulse', volume: 0.1 } as SFX,
  reject: { name: 'reject', freq: 150, duration: 0.25, envelope: 'exp', volume: 0.12 } as SFX,
  bulbOn: { name: 'bulbOn', freq: 800, duration: 0.12, envelope: 'linear', volume: 0.09 } as SFX,
  bulbOff: { name: 'bulbOff', freq: 800, duration: 0.08, envelope: 'exp', volume: 0.09 } as SFX,
  wireConnect: { name: 'wireConnect', freq: [700, 900], duration: 0.15, envelope: 'linear', volume: 0.08 } as SFX,
  wireDisconnect: { name: 'wireDisconnect', freq: 700, duration: 0.1, envelope: 'exp', volume: 0.08 } as SFX,
  doorOpen: { name: 'doorOpen', freq: [250, 300], duration: 0.3, envelope: 'linear', volume: 0.06 } as SFX,
  doorClose: { name: 'doorClose', freq: [300, 250], duration: 0.25, envelope: 'linear', volume: 0.06 } as SFX,
} as const;

export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private bulbOscillators = new Map<string, OscillatorNode[]>(); // item.name → 떨림음 [60Hz, 120Hz]

  constructor(private enabled = true) {}

  private ensureContext(): AudioContext {
    if (!this.ctx) this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (!this.masterGain) {
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.15; // 마스터 음량 (SFX 집단 조절용)
      this.masterGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /** SFX 한 번 재생 */
  play(sfx: SFX): void {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!this.masterGain) return;
    const now = ctx.currentTime;
    const dur = sfx.duration;
    const vol = sfx.volume ?? 0.1;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(this.masterGain);

    // 주파수: 스윕 또는 고정
    if (typeof sfx.freq === 'number') {
      osc.frequency.value = sfx.freq;
    } else {
      const [f1, f2] = sfx.freq;
      osc.frequency.setValueAtTime(f1, now);
      osc.frequency.linearRampToValueAtTime(f2, now + dur);
    }

    // 엔벨로프 (ADSR 단순화)
    gain.gain.setValueAtTime(0, now);
    if (sfx.envelope === 'pulse') {
      gain.gain.linearRampToValueAtTime(vol, now + 0.02);
      gain.gain.setValueAtTime(0, now + 0.05);
    } else if (sfx.envelope === 'exp') {
      gain.gain.linearRampToValueAtTime(vol, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, now + dur);
    } else {
      // 'linear'
      gain.gain.linearRampToValueAtTime(vol, now + dur * 0.1);
      gain.gain.linearRampToValueAtTime(vol * 0.5, now + dur * 0.9);
      gain.gain.linearRampToValueAtTime(0.01, now + dur);
    }

    osc.start(now);
    osc.stop(now + dur);
  }

  /**
   * 전등 떨림음: 켜질 때 시작(40→60 Hz), 꺼질 때 종료(60→40 Hz)
   * itemId: 고유 식별자 (예: items[0].name)
   */
  bulbFlicker(itemId: string, enabled: boolean): void {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!this.masterGain) return;

    // 기존 떨림음 중단
    const existing = this.bulbOscillators.get(itemId);
    if (existing) {
      existing.forEach((o) => {
        o.stop(ctx.currentTime);
        o.disconnect();
      });
      this.bulbOscillators.delete(itemId);
    }

    if (!enabled) return; // 꺼질 때는 여기서 끝

    // 켜질 때: 60/120 Hz 떨림음 시작 (0.2 s 동안 주파수 변화)
    const now = ctx.currentTime;
    const dur = 0.2;
    const osc60 = ctx.createOscillator();
    const osc120 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc60.connect(gain);
    osc120.connect(gain);
    gain.connect(this.masterGain);

    // 40 Hz → 60 Hz로 상승
    osc60.frequency.setValueAtTime(40, now);
    osc60.frequency.linearRampToValueAtTime(60, now + dur);

    // 80 Hz → 120 Hz로 상승
    osc120.frequency.setValueAtTime(80, now);
    osc120.frequency.linearRampToValueAtTime(120, now + dur);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.04, now + dur);
    gain.gain.linearRampToValueAtTime(0.02, now + dur + 0.05); // 떨림 지속

    osc60.start(now);
    osc120.start(now);

    // 떨림음 유지 중단 신호 전까지 계속 재생
    this.bulbOscillators.set(itemId, [osc60, osc120]);
  }

  setMasterVolume(v: number): void {
    if (this.masterGain) this.masterGain.gain.value = Math.max(0, Math.min(1, v));
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}

export const audioManager = new AudioManager();
