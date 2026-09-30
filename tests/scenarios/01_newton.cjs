// 도르래 + 추 + 운동 센서 → 뉴턴 2법칙 (M 500 g, m 50 g: 보정 이론 a ≈ 0.835 m/s²)
module.exports = {
  name: '뉴턴 2법칙 (도르래 + 추)',
  async run(t) {
    await t.clearBench();
    await t.put('역학 레일', 9.55, 3.0);
    await t.attach('수레 A', '역학 레일', '역학 레일');
    await t.put('노트북 1', 9.2, 3.5);
    await t.camera(9.6, 4.1, 0.35, -0.45);
    await t.wait(300);
    const r = await t.ev(() => {
      const { stock, items } = window.lab;
      const rail = stock.rails[0];
      const att = (name, socket) => { const it = items.find((i) => i.name.startsWith(name)); if (it.attachedTo) it.attachedTo.detach(it); it.object.removeFromParent(); socket.attach(it, it.plugs[0]); return it; };
      const pu = att('도르래', rail.mounts[1]);
      att('운동 센서 1', rail.mounts[0]);
      att('추 50 g', pu.hook);
      const lap = stock.laptops[0];
      lap.connect?.call(lap);
      return true;
    });
    await t.ev(() => {
      const { stock, bus } = window.lab;
      const lap = stock.laptops[0];
      const a = lap.actions().find((x) => x.label.includes('센서 연결 · 운동 센서 1'));
      bus.dispatch({ t: 'act', by: 'p0', target: bus.registry.ref(lap), label: a.label });
      lap.duration = 0; lap.rate = 30;
    });
    await t.wait(500);
    t.check(await t.ev(() => !!window.lab.stock.rails[0].sim.load), '추가 실에 걸려 하중이 생김');
    await t.ev(() => window.lab.stock.laptops[0].start());
    await t.wait(300);
    await t.ev(() => window.lab.bus.call(window.lab.stock.rails[0], 'release'));
    await t.wait(2200);
    const a = await t.ev(() => {
      // 출발(처음 2 mm 움직인 시점)부터 가장 멀리 간 시점(센서와 가장 가까운 x의 최댓값 = 도르래 쪽 끝) 전까지, 추가 바닥에 닿기 전 구간만
      const s = window.lab.stock.motionSensors[0].samples.filter((p) => p.x !== null);
      const t0 = s.find((p) => p.x > s[0].x + 0.002);
      const top = s.reduce((m, p, i) => (p.x > s[m].x ? i : m), 0);
      const L = window.lab.stock.rails[0].sim.load;
      const d = s.filter((p, i) => t0 && p.t >= t0.t && i <= top && p.x < s[0].x + 0.40);
      const n = d.length;
      if (n < 4) return { n, a: 0 };
      const t1 = d[0].t;
      const S = (k) => d.reduce((x, p) => x + (p.t - t1) ** k, 0);
      const T = (k) => d.reduce((x, p) => x + p.x * (p.t - t1) ** k, 0);
      const A = [[S(4), S(3), S(2)], [S(3), S(2), S(1)], [S(2), S(1), n]];
      const B = [T(2), T(1), T(0)];
      const det = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
      const Aa = [0, 1, 2].map((i) => [B[i], A[i][1], A[i][2]]);
      return { n, a: (2 * det(Aa)) / det(A), drop: L && L.drop };
    });
    t.check(a.n > 8, `가속 구간 표본 ${a.n}개`);
    t.near(Math.abs(a.a), 0.835, 0.04, 'x–t 2차 맞춤 가속도 (m/s²)');
  },
};
