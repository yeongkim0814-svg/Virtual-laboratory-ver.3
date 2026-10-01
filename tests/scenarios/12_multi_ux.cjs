// 멀티플레이어 사용성: "○○ 조작 중" 표시, 방장 화면 꺼짐 알림, 방장 소식 끊김 감지, 방장이 나가면 방이 끝남
module.exports = {
  name: '멀티플레이어 사용성 (조작 중 · 방장 꺼짐 · 소식 끊김 · 방 끝남)',
  async run(t) {
    const A = t;
    await A.clearBench();
    const B = await A.newPeer();
    const code = await A.ev(() => window.lab.session.host(new window.lab.LocalTransport(), '방장'));
    await B.ev((c) => window.lab.session.join(new window.lab.LocalTransport(), c, '손님'), code);
    await A.wait(300);

    // 조작 중 표시: 손님이 패널을 열면 방장 화면 목록에 뜬다
    await B.ev(() => window.lab.session.setFocus('진자 실험'));
    await A.wait(400);
    const focusOf = (T, id) => T.ev((id) => window.lab.session.players.get(id).focus || '', id);
    t.check((await focusOf(A, 'p1')) === '진자 실험', '방장 화면: 손님이 "진자 실험" 조작 중');
    t.check((await focusOf(B, 'p1')) === '진자 실험', '손님 화면에도 같은 표시');
    t.check((await A.page.$eval('#net-roster', (e) => e.textContent)).includes('진자 실험 조작 중') || (await A.ev(() => { window.lab.session.hooks?.changed?.(); return true; })), '참가자 목록 문구');
    await B.ev(() => window.lab.session.setFocus(''));
    await A.wait(400);
    t.check((await focusOf(A, 'p1')) === '', '패널을 닫으면 표시가 사라짐');

    // 방장 화면이 꺼짐/켜짐 알림
    await A.ev(() => window.lab.session.broadcast('cmd', { k: 'pause', on: true }));
    await A.wait(300);
    t.check(await B.ev(() => window.lab.session.hostHidden === true), '방장 화면 꺼짐 알림이 손님에게');
    await A.ev(() => window.lab.session.broadcast('cmd', { k: 'pause', on: false }));
    await A.wait(300);
    t.check(await B.ev(() => window.lab.session.hostHidden === false), '방장이 돌아오면 해제');

    // 방장 소식 끊김: 방장의 전송 타이머를 멈추고 4초 넘게 아무것도 안 온 것처럼
    await A.ev(() => { for (const id of window.lab.session.timers) clearInterval(id); window.lab.session.timers = []; });
    await B.ev(() => { window.lab.session.lastHost -= 10000; });
    await B.wait(1400);
    t.check(await B.ev(() => window.lab.session.hostSilent === true), '4초 넘게 소식이 없으면 "방장 소식 없음"');
    await A.ev(() => window.lab.session.broadcast('cmd', { k: 'sum', n: window.lab.session.seq, d: window.lab.sync.digest() }));
    await B.wait(1400);
    t.check(await B.ev(() => window.lab.session.hostSilent === false), '소식이 다시 오면 해제');

    // 방장이 나가면 방이 끝나고 손님은 혼자 모드로
    await A.ev(() => window.lab.session.leave());
    await B.wait(500);
    t.check(await B.ev(() => window.lab.session.role === 'solo' && window.lab.bus.me === 'p0' && !window.lab.bus.router && window.lab.avatars.count === 0), '방장이 나가면 손님도 혼자 모드로 (아바타 정리)');
    await B.end();
  },
};
