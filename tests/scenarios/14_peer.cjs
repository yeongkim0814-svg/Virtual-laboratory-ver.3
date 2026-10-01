// 실제 WebRTC(PeerJS)로 방 만들기 · 들어가기 — 로컬 신호 서버(127.0.0.1:9000, devDependency 'peer')를 띄워 시험한다.
// 10~12번은 같은 브라우저 통로(BroadcastChannel)라 PeerJS의 한 메시지 16 KB 한도를 못 잡았다 → 입장 스냅숏(약 44 KB)이 버려져
// 손님이 "방장이 응답하지 않음"으로 끝났다. 이 시나리오는 진짜 PeerJS 데이터 통로를 지난다.
module.exports = {
  name: '멀티플레이어 실제 WebRTC (PeerJS 입장 · 큰 메시지 조각내기)',
  async run(t) {
    let server = null;
    try {
      const express = require('express');
      const http = require('http');
      const { ExpressPeerServer } = require('peer');
      const app = express();
      server = http.createServer(app);
      // 포트를 먼저 연다 (이미 쓰는 중이면 여기서 잡혀 건너뜀) → 그다음 PeerJS 서버를 붙인다
      await new Promise((res, rej) => { server.once('error', rej); server.listen(9000, '127.0.0.1', res); });
      app.use('/', ExpressPeerServer(server, { path: '/' }));
    } catch (e) {
      console.log(`  (건너뜀: 로컬 신호 서버를 못 띄움 — ${String(e).slice(0, 80)})`);
      server?.close();
      return;
    }
    try {
      await t.ev(() => localStorage.setItem('vlab-peer-server', JSON.stringify({ host: '127.0.0.1', port: 9000, path: '/', secure: false })));
      const B = await t.newPeer();
      const code = await t.ev(() => window.lab.session.host(new window.lab.PeerTransport(), '방장'));
      t.check(/^[A-Z0-9]{4}$/.test(code), `방 코드 ${code}`);
      const t0 = Date.now();
      const joined = await B.ev((code) => window.lab.session.join(new window.lab.PeerTransport(), code, '손님').then(() => 'ok', (e) => e.message), code);
      t.check(joined === 'ok', `손님 입장 (${joined}, ${Date.now() - t0} ms) — 입장 스냅숏은 16 KB 넘어 조각으로 감`);
      const size = await t.ev(() => new TextEncoder().encode(JSON.stringify(window.lab.sync.snapshot())).length);
      t.check(size > 16000, `입장 스냅숏 ${(size / 1000).toFixed(1)} KB > PeerJS 한 메시지 한도 16.3 KB (조각내기가 실제로 쓰임)`);
      await t.ev(() => window.lab.bus.set(window.lab.stock.supplies[0], 'voltage', 3.3));
      await t.wait(2500);
      const a = await t.ev(() => ({ n: window.lab.session.players.size, d: window.lab.sync.digest() }));
      const b = await B.ev(() => ({ role: window.lab.session.role, n: window.lab.session.players.size, d: window.lab.sync.digest(), v: window.lab.stock.supplies[0].voltage }));
      t.check(a.n === 2 && b.n === 2 && b.role === 'client', `두 화면 모두 2명 (방장 ${a.n}, 손님 ${b.n}, ${b.role})`);
      t.near(b.v, 3.3, 1e-9, '방장의 명령(전압 3.3 V)이 손님에게 복제');
      t.check(a.d === b.d, '세계 요약(digest) 일치');
      await B.end();
    } finally {
      server.close();
    }
  },
};
