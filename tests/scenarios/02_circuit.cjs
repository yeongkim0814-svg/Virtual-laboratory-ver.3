// 직류 회로: 옴의 법칙, 키르히호프(KCL·KVL), LED 과열
module.exports = {
  name: '직류 회로 (옴 · 키르히호프 · LED)',
  async run(t) {
    await t.clearBench();
    const setup = () => t.ev(() => {
      const { scene, stock, wires, power } = window.lab;
      for (const w of [...wires.wires]) wires.remove(w);
      const put = (it, x, z) => { it.object.removeFromParent(); it.object.position.set(x, 0.85, z); it.object.rotation.set(0, 0, 0); scene.add(it.object); };
      const P = (n) => stock.circuitParts.find((p) => p.name.startsWith(n));
      const s = stock.supplies[1];
      put(s, 9.3, 2.9); put(P('전류계 1'), 9.55, 3.1); put(P('전류계 2'), 9.8, 3.25); put(P('저항 47'), 9.8, 2.95);
      put(P('저항 100'), 10.0, 3.4); put(P('꼬마전구 1'), 9.55, 3.4); put(P('전압계 1'), 9.3, 3.3); put(P('전압계 2'), 10.0, 3.1);
      put(P('LED 빨강'), 9.0, 3.6);
      power.plug(s); s.on = true; s.voltage = 3;
      return { A1: P('전류계 1'), A2: P('전류계 2'), R47: P('저항 47'), R100: P('저항 100'), L: P('꼬마전구 1'), V1: P('전압계 1'), V2: P('전압계 2'), led: P('LED 빨강') };
    });
    // 1) 직렬: 전원 → 전류계 → 47 Ω → 전원, 전압계 병렬 → 63.7 mA
    await setup();
    await t.ev(() => {
      const { stock, wires } = window.lab; const P = (n) => stock.circuitParts.find((p) => p.name.startsWith(n)); const s = stock.supplies[1];
      wires.connect(s.plus, P('전류계 1').a); wires.connect(P('전류계 1').b, P('저항 47').a); wires.connect(P('저항 47').b, s.minus);
      wires.connect(P('전압계 1').a, P('저항 47').a); wires.connect(P('전압계 1').b, P('저항 47').b);
    });
    await t.wait(400);
    const one = await t.ev(() => { const P = (n) => window.lab.stock.circuitParts.find((p) => p.name.startsWith(n)); return { I: P('전류계 1').reading * 1000, V: P('전압계 1').reading }; });
    t.near(one.I, 3 / (47 + 0.05 + 0.01) * 1000, 0.3, '47 Ω, 3 V: 전류 (mA)');
    t.near(one.V, 3 * 47 / 47.06, 0.02, '전압계 (V)');
    // 2) 병렬 + 전구: KCL, KVL
    await setup();
    await t.ev(() => {
      const { stock, wires } = window.lab; const P = (n) => stock.circuitParts.find((p) => p.name.startsWith(n)); const s = stock.supplies[1];
      s.voltage = 5;
      wires.connect(s.plus, P('전류계 1').a); wires.connect(P('전류계 1').b, P('저항 47').a); wires.connect(P('전류계 1').b, P('전류계 2').a);
      wires.connect(P('전류계 2').b, P('저항 100').a); wires.connect(P('저항 100').b, P('저항 47').b);
      wires.connect(P('저항 47').b, P('꼬마전구 1').a); wires.connect(P('꼬마전구 1').b, s.minus);
    });
    await t.wait(800);
    const k = await t.ev(() => { const P = (n) => window.lab.stock.circuitParts.find((p) => p.name.startsWith(n)); return { a1: P('전류계 1').reading, a2: P('전류계 2').reading, i47: P('저항 47').current }; });
    t.near(k.a1 - k.a2 - k.i47, 0, 1e-6, 'KCL: A1 − A2 − I(47 Ω)');
    // 3) LED: 저항 없이 2.4 V → 탐
    await setup();
    await t.ev(() => {
      const { stock, wires } = window.lab; const P = (n) => stock.circuitParts.find((p) => p.name.startsWith(n)); const s = stock.supplies[1];
      s.voltage = 2.0; wires.connect(s.plus, P('LED 빨강').a); wires.connect(P('LED 빨강').b, s.minus);
    });
    await t.wait(900);
    const ok = await t.ev(() => { const l = window.lab.stock.circuitParts.find((p) => p.name === 'LED 빨강'); return { mA: l.current * 1000, burnt: l.burnt }; });
    t.near(ok.mA, 20, 2, 'LED 빨강 2.0 V (저항 없음): 전류 (mA)');
    t.check(!ok.burnt, '2.0 V에서는 안 탐');
    await t.ev(() => { window.lab.stock.supplies[1].voltage = 2.4; });
    await t.wait(1500);
    t.check(await t.ev(() => window.lab.stock.circuitParts.find((p) => p.name === 'LED 빨강').burnt), '2.4 V에서 과열로 탐');
  },
};
