// 힘 센서·포토게이트: 충격량 J = ∫F dt = 운동량 변화, 두 게이트 사이 가속도 = −μg
module.exports = {
  name: '힘 센서 · 포토게이트 (충격량)',
  async run(t) {
    await t.clearBench();
    await t.put('역학 레일', 9.4, 3.0);
    await t.ev(() => {
      const { stock, items, THREE } = window.lab;
      const r = stock.rails[0]; r.object.updateMatrixWorld(true);
      const A = stock.carts[0]; if (A.attachedTo) A.attachedTo.detach(A); A.object.removeFromParent();
      r.track.attach(A, A.plugs[0], new THREE.Vector3(9.15, 0.9, 3.0));
      const att = (it, s, p) => { it.object.removeFromParent(); s.attach(it, it.plugs[0], p); };
      att(stock.forceSensors[0], r.mounts[1]);
      att(stock.motionSensors[0], r.mounts[0]);
      att(stock.photogates[0], r.gateTrack, new THREE.Vector3(9.4, 0.86, 3.0));
      att(stock.photogates[1], r.gateTrack, new THREE.Vector3(9.7, 0.86, 3.0));
    });
    await t.put('노트북 1', 9.2, 3.45);
    await t.ev(() => {
      const { stock, bus } = window.lab; const lap = stock.laptops[0];
      for (const s of [stock.forceSensors[0], stock.motionSensors[0], stock.photogates[0], stock.photogates[1]]) {
        const a = lap.actions().find((x) => x.label === `센서 연결 · ${s.name}`);
        if (a) bus.dispatch({ t: 'act', by: 'p0', target: bus.registry.ref(lap), label: a.label });
      }
      lap.duration = 0; lap.rate = 30; lap.start();
    });
    await t.wait(300);
    t.check(await t.ev(() => window.lab.stock.laptops[0].sensors.length) === 4, '센서 4개 연결');
    await t.ev(() => window.lab.stock.rails[0].push(window.lab.stock.carts[0], 0.5));
    await t.wait(3500);
    await t.ev(() => window.lab.stock.laptops[0].stop());
    const r = await t.ev(() => {
      const { stock } = window.lab;
      const F = stock.forceSensors[0].samples;
      let J = 0, Fmax = 0, t0 = -1, t1 = -1;
      for (let i = 1; i < F.length; i++) {
        if (F[i].F > 0.3 && t0 < 0) t0 = F[i].t;
        if (F[i].F > 0.3) { t1 = F[i].t; J += 0.5 * (F[i].F + F[i - 1].F) * (F[i].t - F[i - 1].t); }
        Fmax = Math.max(Fmax, F[i].F);
      }
      const g1 = stock.photogates[0].passes(), g2 = stock.photogates[1].passes();
      return { n: F.length, J, Fmax, dur: t1 - t0, g1: g1.map((p) => p.v), g2: g2.map((p) => p.v), m: stock.forceSensors[0].cartMass };
    });
    t.check(r.n > 1500, `힘 표본 ${r.n}개 (1 kHz)`);
    t.check(r.g1.length >= 2 && r.g2.length >= 2, '게이트가 왕복을 각각 두 번 잼');
    // 포토게이트 속력으로 구한 Δp와 J 비교 (되튐: m(v₁ + v₂))
    const dp = r.m * (r.g2[0] + r.g2[1]);
    t.near(r.J / dp, 1, 0.04, `충격량 / 운동량 변화 (J ${r.J.toFixed(3)}, Δp ${dp.toFixed(3)})`);
    t.near(r.dur * 1000, 98, 10, '용수철 범퍼 충돌 시간 (ms)');
    const a = (r.g2[0] ** 2 - r.g1[0] ** 2) / (2 * 0.3);
    t.near(a, -0.039, 0.01, '두 게이트 사이 가속도 = −μg (m/s²)');
  },
};
