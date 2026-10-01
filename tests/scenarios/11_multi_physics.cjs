// 멀티플레이어 연속 운동: 방장의 수레·진자·수치·용액 상태가 손님 화면에 덮어써진다 (몇 ms · 몇 mm 안)
module.exports = {
  name: '멀티플레이어 물리 (수레 · 진자 · 용액 · 수치)',
  async run(t) {
    const A = t;
    await A.clearBench();
    const B = await A.newPeer();
    const both = (fn, arg) => Promise.all([A.ev(fn, arg), B.ev(fn, arg)]);
    const code = await A.ev(() => window.lab.session.host(new window.lab.LocalTransport(), '방장'));
    await B.ev((c) => window.lab.session.join(new window.lab.LocalTransport(), c, '손님'), code);
    await A.wait(300);

    // ---- 레일 + 수레: 손님이 명령으로 밀면 두 화면의 수레가 같이 간다
    await Promise.all([A.put('역학 레일', 9.55, 3.0), B.put('역학 레일', 9.55, 3.0)]);
    await Promise.all([A.attach('수레 A', '역학 레일', '역학 레일'), B.attach('수레 A', '역학 레일', '역학 레일')]);
    await A.wait(500);
    const cart = (T) => T.ev(() => { const { stock } = window.lab; const b = stock.rails[0].bodyOf(stock.carts[0]); return b && { s: b.s, v: b.v }; });
    const c0 = await cart(A);
    t.check(c0 && (await cart(B)), '두 화면 모두 수레 몸체가 있음');
    await B.ev(() => window.lab.bus.call(window.lab.stock.rails[0], 'push', window.lab.stock.carts[0], 0.3));
    await A.wait(1200);
    // 시뮬레이션을 멈춰(speed 0) 두 화면의 값을 같은 상태에서 비교
    await both(() => { window.lab.stock.rails[0].speed = 0; });
    await A.wait(500);
    const ca = await cart(A); const cb = await cart(B);
    t.check(ca.s - c0.s > 0.2 && ca.s - c0.s < 0.33, `수레가 밀려 감: 이동 ${(ca.s - c0.s).toFixed(4)} m (이론 약 0.28 m)`);
    t.near(cb.s, ca.s, 1e-6, '손님 화면 수레 위치 = 방장 (m)');
    t.near(cb.v, ca.v, 1e-6, '손님 화면 수레 속도 = 방장 (m/s)');
    await both(() => { window.lab.stock.rails[0].speed = 1; });

    // ---- 손님 쪽이 어긋나면 바로잡힌다
    await A.ev(() => window.lab.bus.call(window.lab.stock.rails[0], 'push', window.lab.stock.carts[0], 0)); // 수레를 세운다 (움직이는 수레는 전달 지연만큼 늘 뒤처짐)
    await A.wait(400);
    await B.ev(() => { const { stock } = window.lab; const b = stock.rails[0].bodyOf(stock.carts[0]); b.s += 0.1; b.v = 0.2; });
    await A.wait(500);
    const fixed = await cart(B); const host = await cart(A);
    t.check(Math.abs(fixed.s - host.s) < 0.005, `어긋난 수레(+10 cm)가 방장 값으로 돌아옴: 차이 ${(Math.abs(fixed.s - host.s) * 1000).toFixed(2)} mm`);

    // ---- 진자: 스탠드 + 클램프 + 실 + 추를 두 화면에 똑같이 조립 → 방장이 놓으면 같이 흔들린다
    const build = () => {
      const { stock, items, scene } = window.lab;
      const st = items.find((i) => i.name.startsWith('스탠드')); const cl = items.find((i) => i.name.startsWith('클램프'));
      const str = stock.strings[0]; const bob = items.find((i) => i.name.startsWith('추 100 g'));
      const att = (it, s) => { it.attachedTo?.detach(it); it.object.removeFromParent(); s.attach(it, it.plugs[0]); };
      st.attachedTo?.detach(st); st.object.removeFromParent(); scene.add(st.object); st.object.position.set(9.0, 0.85, 4.2); st.object.updateMatrixWorld(true);
      att(cl, st.sockets[0]); att(str, cl.jaw); att(bob, str.hook);
      return str.isPendulum;
    };
    const built = await both(build);
    t.check(built[0] && built[1], '진자 조립 (두 화면)');
    await A.wait(500);
    await A.ev(() => window.lab.bus.call(window.lab.stock.strings[0], 'releaseSim'));
    await A.wait(1200);
    const pend = (T) => T.ev(() => { const s = window.lab.stock.strings[0].sim; return { th: s.state.theta, run: s.running, time: s.time }; });
    const samples = [];
    for (let i = 0; i < 4; i++) {
      const [pa, pb] = await Promise.all([pend(A), pend(B)]);
      samples.push(Math.abs(pa.th - pb.th));
      t.check(pa.run && pb.run, `진자 진행 중 (${i + 1}번째 표본, 방장 θ ${pa.th.toFixed(3)} · 손님 θ ${pb.th.toFixed(3)} rad)`);
      await A.wait(330);
    }
    // 방장 상태는 15 Hz(66 ms)로 오고 전달에 몇십 ms가 걸리므로, 흔들리는 중(ω ≈ 1 rad/s)의 손님 각도는 최대 ~0.1 s 분량(≈ 0.1 rad) 뒤질 수 있다.
    // 보조 탭(시험용)은 프레임이 느려 로컬 예측이 거의 없는 최악의 경우다
    t.check(Math.max(...samples) < 0.12, `진자 각도 차이 최대 ${Math.max(...samples).toFixed(4)} rad (< 0.12 ≈ ω × 0.1 s)`);

    // ---- 수치(LED 탄 여부 · 필라멘트)와 용액: 방장 값이 손님에게
    await A.ev(() => {
      const led = window.lab.stock.circuitParts.find((p) => 'burnt' in p);
      led.burnt = true;
      const bk = window.lab.items.find((i) => i.name.startsWith('비커 2'));
      bk.solution.V = 0.0123; bk.solution.n = { ...bk.solution.n, 'H+': 0.00045 };
    });
    await A.wait(500);
    const vals = (T) => T.ev(() => { const led = window.lab.stock.circuitParts.find((p) => 'burnt' in p); const bk = window.lab.items.find((i) => i.name.startsWith('비커 2')); return { burnt: led.burnt, V: bk.solution.V, h: bk.solution.n['H+'] }; });
    const vb = await vals(B);
    t.check(vb.burnt === true, 'LED 탄 상태가 손님에게');
    t.near(vb.V * 1000, 12.3, 1e-9, '용액 부피(mL)가 손님에게');
    t.near((vb.h ?? 0) * 1e5, 45, 1e-6, '용액 H⁺ 몰수가 손님에게 (×1e-5 mol)');
    await B.end();
    await A.ev(() => window.lab.session.leave());
  },
};
