/**
 * 멀티플레이어 패널 (오른쪽 위 👥): 방 만들기 · 코드로 들어가기 · 참가자 목록 · 나가기
 * 연결은 PeerJS(WebRTC). 주소에 #local 이 있으면 같은 브라우저 탭끼리 (BroadcastChannel)
 */
import type { Session } from '../net/session';
import { LocalTransport, PeerTransport, normalizeCode, type Transport } from '../net/transport';

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function makeTransport(): Transport {
  return location.hash.includes('local') ? new LocalTransport() : new PeerTransport();
}

export class NetPanel {
  private el = byId('net-panel');
  private name = byId<HTMLInputElement>('net-name');
  private code = byId<HTMLInputElement>('net-code');
  private status = byId('net-status');
  private busy = false;

  constructor(private session: Session) {
    let saved = '';
    try { saved = localStorage.getItem('vlab-name') ?? ''; } catch { /* 무시 */ }
    this.name.value = saved || `실험자${1 + Math.floor(Math.random() * 99)}`;
    byId('btn-net').addEventListener('click', () => { this.el.hidden = !this.el.hidden; this.refresh(); });
    byId('net-close').addEventListener('click', () => { this.el.hidden = true; });
    byId('net-host').addEventListener('click', () => void this.run(async () => {
      this.setStatus('방을 만드는 중…');
      const code = await session.host(makeTransport(), this.nick());
      this.setStatus(`방 코드 ${code} — 친구에게 알려 주세요`);
    }));
    byId('net-join').addEventListener('click', () => void this.run(async () => {
      const code = normalizeCode(this.code.value);
      if (code.length !== 4) throw new Error('방 코드 4글자를 입력');
      this.setStatus('들어가는 중…');
      await session.join(makeTransport(), code, this.nick());
      this.setStatus('');
    }));
    byId('net-leave').addEventListener('click', () => { session.leave(); this.setStatus(''); });
    this.code.addEventListener('input', () => { this.code.value = normalizeCode(this.code.value); });
  }

  private nick(): string {
    const n = this.name.value.trim().slice(0, 12) || '실험자';
    try { localStorage.setItem('vlab-name', n); } catch { /* 무시 */ }
    return n;
  }

  private async run(f: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await f();
    } catch (e) {
      this.setStatus(`⚠ ${(e as Error).message}`);
    } finally {
      this.busy = false;
      this.refresh();
    }
  }

  private setStatus(s: string): void {
    this.status.textContent = s;
  }

  /** 역할·참가자가 바뀔 때마다 */
  refresh(): void {
    const s = this.session;
    byId('net-solo').hidden = s.connected;
    byId('net-room').hidden = !s.connected;
    byId('btn-net').classList.toggle('on', s.connected);
    if (!s.connected) return;
    byId('net-room-code').textContent = s.code;
    byId('net-role').textContent =
      s.role === 'host' ? '방장 (물리 계산을 맡음 — 화면을 켜 두세요)' : `참가자 (방장의 세계를 따라감)${s.hostHidden ? ' · 방장 화면 꺼짐' : s.hostSilent ? ' · 방장 소식 없음' : ''}`;
    const list = byId('net-roster');
    list.innerHTML = '';
    for (const p of s.players.values()) {
      const li = document.createElement('li');
      const dot = document.createElement('i');
      dot.style.background = `#${p.color.toString(16).padStart(6, '0')}`;
      li.append(dot, `${p.name}${p.id === s.me ? ' (나)' : ''}${p.id === 'p0' ? ' · 방장' : ''}${p.focus ? ` — ${p.focus} 조작 중` : ''}`);
      list.appendChild(li);
    }
  }
}
