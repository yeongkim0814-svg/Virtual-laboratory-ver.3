// 오실로스코프 · 함수 발생기: 과도 회로 해석(RC · LC · RLC · 정류) 이론값 비교
module.exports = {
  name: '오실로스코프 (RC · RLC · 정류 · 리사주)',
  async run(t) {
    await t.clearBench();
    // ---- 0) 해석기 자체 (브라우저 안에서 sim/transient.ts를 직접) ----
    const pure = await t.ev(() => {
      const { Transient, waveform } = window.lab.sim;
      const out = {};
      {
        const tau = 1e-3;
        const s = new Transient(3, [{ kind: 'V', a: 1, b: 0, r: 1e-3, E: () => 5, i: 0 }, { kind: 'R', a: 1, b: 2, R: 1000 }, { kind: 'C', a: 2, b: 0, C: 1e-6, v: 0, i: 0 }]);
        for (let k = 0; k < 1000; k++) s.step(tau / 1000);
        out.rc = s.V[2];
      }
      {
        const L = 10e-3, C = 1e-6, T = 2 * Math.PI * Math.sqrt(L * C);
        const els = [{ kind: 'L', a: 1, b: 0, L, v: 1, i: 0 }, { kind: 'C', a: 1, b: 0, C, v: 1, i: 0 }];
        const s = new Transient(2, els);
        for (let k = 0; k < 200 * 100; k++) s.step(T / 200);
        out.lc = (0.5 * C * els[1].v ** 2 + 0.5 * L * els[0].i ** 2) / (0.5 * C);
      }
      out.tri = [waveform('triangle', 1, 2, 0, 0), waveform('triangle', 1, 2, 0, 0.25), waveform('triangle', 1, 2, 0, 0.75)];
      return out;
    });
    t.near(pure.rc, 5 * (1 - Math.exp(-1)), 0.005, 'RC 계단 응답 t = τ에서 V = E(1 − 1/e) (V)');
    t.near(pure.lc, 1, 0.005, 'LC 100주기 뒤 에너지 비 (사다리꼴: 에너지 보존)');
    t.check(Math.abs(pure.tri[0]) < 1e-9 && Math.abs(pure.tri[1] - 2) < 1e-9 && Math.abs(pure.tri[2] + 2) < 1e-9, '삼각파: 0, +진폭, −진폭');

    // ---- 도우미 ----
    await t.ev(() => {
      const { items, power, wires, scene } = window.lab;
      const F = (n) => items.find((i) => i.name.startsWith(n));
      const put = (it, x, z) => { if (it.attachedTo) it.attachedTo.detach(it); it.object.removeFromParent(); it.object.position.set(x, 0.85, z); it.object.rotation.set(0, 0, 0); it.yaw = 0; scene.add(it.object); it.object.updateMatrixWorld(true); };
      const plug = (d) => { if (d.port) return; const p = power.outlets.flatMap((o) => o.ports).filter((q) => !q.device).sort((a, b) => a.worldPosition().distanceTo(d.object.position) - b.worldPosition().distanceTo(d.object.position))[0]; power.plug(d, p); };
      window.H = {
        F,
        /** 회로 만들기: parts = [[이름, x, z]], links = [[부품 A, 단자, 부품 B, 단자]] (단자 이름은 속성 이름) */
        build(parts, links, gen, scope) {
          for (const w of [...wires.wires]) wires.remove(w);
          for (const [n, x, z] of parts) put(F(n), x, z);
          const G = F('함수 발생기'); const S = F('오실로스코프');
          put(G, 9.0, 2.0); put(S, 9.0, 2.7); plug(G); plug(S);
          for (const [a, ta, b, tb] of links) wires.connect(F(a)[ta], F(b)[tb]);
          Object.assign(G, { on: true }, gen); Object.assign(S, { on: true, hold: false, mode: 'yt', show1: true, show2: true, trigCh: 1, trigLevel: 0, trigRise: true }, scope);
        },
        async settle(ms) {
          const s = F('오실로스코프').sim; const t0 = performance.now(); const seq0 = s.seq;
          while (performance.now() - t0 < ms && !(s.settled >= 2 && s.seq > seq0 + 1)) await new Promise((r) => setTimeout(r, 100));
          return true;
        },
        read() {
          const s = F('오실로스코프').sim;
          return { has: s.has, trig: s.triggered, m1: s.m1, m2: s.m2, phase: s.phase, dt: s.dt, ch1: Array.from(s.ch1), ch2: Array.from(s.ch2), gens: s.gens.length, note: s.note };
        },
      };
    });
    const run = async (parts, links, gen, scope, ms = 9000) => {
      await t.ev(([p, l, g, s]) => window.H.build(p, l, g, s), [parts, links, gen, scope]);
      await t.ev((ms) => window.H.settle(ms), ms);
      return t.ev(() => window.H.read());
    };

    // ---- 1) RC 계단 응답: 사각파 100 Hz, R = 10 kΩ, C = 0.1 μF → τ = (R + 50 Ω) C = 1.005 ms ----
    let r = await run(
      [['저항 10 kΩ', 9.4, 2.3], ['축전기 0.1', 9.4, 2.6]],
      [['함수 발생기', 'out', '저항 10 kΩ', 'a'], ['저항 10 kΩ', 'b', '축전기 0.1', 'a'], ['축전기 0.1', 'b', '함수 발생기', 'com'], ['오실로스코프', 'ch1', '함수 발생기', 'out'], ['오실로스코프', 'ch2', '저항 10 kΩ', 'b']],
      { wave: 'square', freq: 100, amp: 2, offset: 0 }, { tdiv: 2e-3, vdiv1: 1, vdiv2: 1 });
    t.check(r.has && r.trig && r.gens === 1, `RC: 파형 있음, 트리거 잡힘, 발생기 인식 (${r.note})`);
    const at = (arr, ms) => arr[Math.round(ms * 1e-3 / r.dt)];
    // 세 표본(간격 d)의 차이 비 = e^{−d/τ} → 점근값을 몰라도 τ를 구한다
    const d = 1.0;
    const v0 = at(r.ch2, 0.3); const v1 = at(r.ch2, 0.3 + d); const v2 = at(r.ch2, 0.3 + 2 * d);
    const tau = -d / Math.log((v2 - v1) / (v1 - v0));
    t.near(tau, 1.005, 0.02, 'RC 충전: 시간 상수 τ = (R + R_출력) C (ms)');
    t.near(r.m1.freq, 100, 0.5, '자동 측정: 사각파 주파수 (Hz)');

    // ---- 2) RC 사인파: f = 1/(2πRC) = 159.15 Hz에서 위상 45° 지연, 진폭 비 1/√2 ----
    r = await run(
      [['저항 1 kΩ', 9.4, 2.3], ['축전기 1 μF', 9.4, 2.6]],
      [['함수 발생기', 'out', '저항 1 kΩ', 'a'], ['저항 1 kΩ', 'b', '축전기 1 μF', 'a'], ['축전기 1 μF', 'b', '함수 발생기', 'com'], ['오실로스코프', 'ch1', '함수 발생기', 'out'], ['오실로스코프', 'ch2', '저항 1 kΩ', 'b']],
      { wave: 'sine', freq: 159.15, amp: 2, offset: 0 }, { tdiv: 2e-3 });
    t.near(r.phase, 45, 1.0, 'RC 사인파: CH2가 CH1보다 늦는 위상 (도, 이론 arctan(ωRC) = 45°)');
    t.near(r.m2.vpp / r.m1.vpp, Math.SQRT1_2, 0.012, 'RC 사인파: 진폭 비 |H| = 1/√(1 + (ωRC)²)');
    // 리사주(X-Y): 타원의 y 절편 / 최댓값 = sin φ
    await t.ev(() => { Object.assign(window.H.F('오실로스코프'), { mode: 'xy' }); });
    await t.wait(1500);
    r = await t.ev(() => window.H.read());
    let y0 = null; let ymax = 0;
    for (let i = 1; i < r.ch1.length; i++) {
      ymax = Math.max(ymax, Math.abs(r.ch2[i]));
      if (y0 === null && r.ch1[i - 1] < 0 && r.ch1[i] >= 0) y0 = Math.abs(r.ch2[i]);
    }
    t.near((Math.asin(y0 / ymax) * 180) / Math.PI, 45, 2.5, '리사주 타원: φ = arcsin(y절편 / y최대) (도)');

    // ---- 3) RLC 직렬 공명: L 10 mH(2 Ω) · C 1 μF · R 100 Ω, f₀ = 1591.5 Hz ----
    const f0 = 1 / (2 * Math.PI * Math.sqrt(0.01 * 1e-6));
    const rlc = [];
    for (const k of [0.8, 0.9, 1.0, 1.1, 1.25]) {
      r = await run(
        [['코일 10 mH', 9.4, 2.2], ['축전기 1 μF', 9.4, 2.45], ['저항 100 Ω', 9.4, 2.7]],
        [['함수 발생기', 'out', '코일 10 mH', 'a'], ['코일 10 mH', 'b', '축전기 1 μF', 'a'], ['축전기 1 μF', 'b', '저항 100 Ω', 'a'], ['저항 100 Ω', 'b', '함수 발생기', 'com'], ['오실로스코프', 'ch1', '함수 발생기', 'out'], ['오실로스코프', 'ch2', '저항 100 Ω', 'a']],
        { wave: 'sine', freq: Math.round(f0 * k * 10) / 10, amp: 2, offset: 0 }, { tdiv: 0.2e-3 });
      rlc.push({ k, ratio: r.m2.vpp / r.m1.vpp, phase: r.phase });
    }
    const best = rlc.reduce((a, b) => (b.ratio > a.ratio ? b : a));
    t.check(best.k === 1.0, `공명: 저항 전압이 f₀에서 최대 (${rlc.map((x) => `${x.k}f₀ ${x.ratio.toFixed(3)}`).join(', ')})`);
    t.near(rlc[2].ratio, 100 / 102, 0.01, 'f₀에서 V_R / V_입력 = R / (R + R_L)');
    for (const x of rlc) {
      const w = 2 * Math.PI * f0 * x.k;
      const th = (Math.atan((w * 0.01 - 1 / (w * 1e-6)) / 102) * 180) / Math.PI;
      t.near(x.phase, th, 2.5, `RLC ${x.k} f₀: 위상 = arctan((ωL − 1/ωC)/(R + R_L)) (도, 이론 ${th.toFixed(1)}°)`);
    }

    // ---- 4) 반파 정류 + 평활 ----
    r = await run(
      [['정류 다이오드', 9.4, 2.3], ['저항 1 kΩ', 9.4, 2.6]],
      [['함수 발생기', 'out', '정류 다이오드', 'a'], ['정류 다이오드', 'b', '저항 1 kΩ', 'a'], ['저항 1 kΩ', 'b', '함수 발생기', 'com'], ['오실로스코프', 'ch1', '함수 발생기', 'out'], ['오실로스코프', 'ch2', '저항 1 kΩ', 'a']],
      { wave: 'sine', freq: 100, amp: 5, offset: 0 }, { tdiv: 5e-3 });
    t.check(r.m2.vmin > -0.05 && r.m2.vmax > 3.9 && r.m2.vmax < 4.5, `반파 정류: 음의 반주기 차단, 최댓값 = 5 V − 다이오드 강하 (${r.m2.vmin.toFixed(3)} ~ ${r.m2.vmax.toFixed(2)} V)`);
    r = await run(
      [['정류 다이오드', 9.4, 2.3], ['저항 1 kΩ', 9.4, 2.6], ['축전기 100', 9.7, 2.6]],
      [['함수 발생기', 'out', '정류 다이오드', 'a'], ['정류 다이오드', 'b', '저항 1 kΩ', 'a'], ['저항 1 kΩ', 'b', '함수 발생기', 'com'], ['축전기 100', 'a', '저항 1 kΩ', 'a'], ['축전기 100', 'b', '저항 1 kΩ', 'b'], ['오실로스코프', 'ch1', '함수 발생기', 'out'], ['오실로스코프', 'ch2', '저항 1 kΩ', 'a']],
      { wave: 'sine', freq: 100, amp: 5, offset: 0 }, { tdiv: 5e-3 }, 14000);
    const rip = r.m2.vpp; const upper = (r.m2.vmax / 1000) / (100 * 100e-6);
    t.check(rip < upper && rip > 0.5 * upper, `평활 축전기 100 μF: 리플 ${rip.toFixed(3)} V (상한 I/(fC) = ${upper.toFixed(3)} V)`);

    // ---- 5) 접지 단락: 오실로스코프 GND를 발생기 출력에 이으면 그 마디가 0 V ----
    r = await run(
      [['저항 1 kΩ', 9.4, 2.3]],
      [['함수 발생기', 'out', '저항 1 kΩ', 'a'], ['오실로스코프', 'ch1', '함수 발생기', 'out'], ['오실로스코프', 'gnd', '저항 1 kΩ', 'a']],
      { wave: 'sine', freq: 1000, amp: 2, offset: 0 }, { tdiv: 0.2e-3 }, 4000);
    t.check(r.m1.vpp < 1e-3, `GND를 출력 마디에 이으면 CH1은 0 V (Vpp ${(r.m1.vpp * 1000).toFixed(3)} mV)`);

    // ---- 6) 꺼짐 · 연결 안내 ----
    r = await run([], [], { on: true }, { tdiv: 1e-3 }, 500);
    t.check(!r.has && /프로브/.test(r.note), `프로브가 안 이어지면 안내 ("${r.note}")`);
    await t.ev(() => { window.H.F('오실로스코프').on = false; });
    await t.wait(500);
    r = await t.ev(() => window.H.read());
    t.check(!r.has, '오실로스코프를 끄면 파형이 사라짐');
    t.check(t.errors.length === 0, `페이지 오류 없음${t.errors.length ? ': ' + t.errors[0].slice(0, 120) : ''}`);
  },
};
