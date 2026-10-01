// 되돌리기: 마지막 조작 하나 (놓기·이동·회전·끼우기·도선·전원·켜기·set), 화학은 되돌리지 않음, 다른 사람 조작 뒤 거절
module.exports = {
  name: '되돌리기 (마지막 조작 하나)',
  async run(t) {
    await t.clearBench();
    await t.put('볼록 렌즈 (f = +10', 9.0, 3.0);
    await t.put('스탠드', 9.6, 3.6);
    await t.put('클램프', 9.3, 3.8);
    await t.put('저항 47', 8.6, 2.2);
    await t.put('직류 전원', 8.9, 2.0);
    await t.put('레이저', 9.6, 2.4);
    // 명령을 실제 경로(bus.dispatch)로 내고, 되돌리기는 ↶ 버튼으로
    const H = `
      const { bus, items, hand, stock, THREE } = window.lab; const R = (o) => bus.registry.ref(o);
      const find = (n) => items.find((i) => i.name.startsWith(n));
      const act = (it, label, by = 'p0') => bus.dispatch({ t: 'act', by, target: R(it), label });
      const lens = find('볼록 렌즈 (f = +10');`;
    const ev = (body) => t.ev(`(() => { ${H} ${body} })()`);
    const undoBtn = async () => { await (await t.page.$('#btn-undo')).tap(); await t.wait(150); return t.page.$eval('#toast', (e) => e.textContent).catch(() => ''); };
    const undo = () => ev(`const ok = bus.dispatch({ t: 'undo', by: 'p0' }); return ok;`);

    // 1) 집기 → 놓기 → 되돌리기: 다시 손에. 한 번 더: 되돌릴 것 없음 (최근 하나만)
    await ev(`act(lens, '집기 · ' + lens.name); bus.dispatch({ t: 'place', by: 'p0', item: R(lens), p: [9.2, 0.85, 3.1] });`);
    t.check(await ev(`return hand.held === null && Math.abs(lens.object.position.x - 9.2) < 1e-9;`), '놓기 실행');
    await t.wait(300);
    t.check(await t.page.$eval('#btn-undo', (b) => !b.disabled && b.title.includes('놓기')), `↶ 버튼 켜짐 ("놓기")`);
    await undoBtn();
    t.check(await ev(`return hand.held === lens;`), '되돌리기 → 렌즈가 다시 손에');
    t.check((await undo()) === false, '두 번째 되돌리기는 없음 (최근 하나만, 다시 하기 없음)');
    await ev(`bus.dispatch({ t: 'place', by: 'p0', item: R(lens), p: [9.2, 0.85, 3.1] });`);

    // 2) 이동(1 mm) · 회전(0.1°) — 위치·방향이 정확히 돌아온다
    const p0 = await ev(`return lens.object.position.toArray();`);
    await ev(`bus.call(lens, 'nudge', 0.001, 0);`);
    await undo();
    const p1 = await ev(`return lens.object.position.toArray();`);
    t.near(Math.hypot(p1[0] - p0[0], p1[2] - p0[2]), 0, 1e-12, '이동 되돌림 (m)');
    await ev(`bus.call(lens, 'setYawDeg', 12.3);`);
    await undo();
    t.near(await ev(`return lens.yawDeg;`), 0, 1e-9, '회전 되돌림 (°)');

    // 3) 끼우기: 클램프 → 스탠드 막대. 되돌리면 손으로 (끼우기 직전 상태)
    const att = await ev(`
      const st = find('스탠드'), cl = items.find((i) => i.name.startsWith('클램프') && i.object.parent?.type === 'Scene' && Math.abs(i.object.position.x - 9.3) < 0.01);
      act(cl, '집기 · ' + cl.name);
      const s = st.sockets[0]; const ok = bus.dispatch({ t: 'attach', by: 'p0', item: R(cl), socket: R(s), plug: 0, p: s.worldPosition().toArray(), cam: [9, 1.6, 5] });
      window.__cl = cl; return ok && cl.attachedTo === s;`);
    t.check(att, '클램프를 스탠드에 끼움');
    await undo();
    t.check(await ev(`return hand.held === window.__cl && !window.__cl.attachedTo;`), '끼우기 되돌림 → 클램프가 다시 손에');
    await ev(`bus.dispatch({ t: 'place', by: 'p0', item: R(window.__cl), p: [9.3, 0.85, 3.8] });`);

    // 4) 도선 잇기 → 되돌리면 도선 없음
    const nw = await ev(`
      const { wires } = window.lab; const r = find('저항 47'), s = find('직류 전원');
      const ta = bus.registry.get(R(r) + '/t0'), tb = bus.registry.get(R(s) + '/t0');
      const n0 = wires.wires.length; bus.dispatch({ t: 'wire', by: 'p0', a: R(ta), b: R(tb) }); return [n0, wires.wires.length];`);
    t.check(nw[1] === nw[0] + 1, `도선 연결 (${nw[0]} → ${nw[1]})`);
    await undo();
    t.check(await ev(`return window.lab.wires.wires.length;`) === nw[0], '도선 연결 되돌림');

    // 5) 전원 연결 → 되돌림, 레이저 켜기 → 되돌림, set(출력) → 되돌림
    const L = await ev(`
      const L = stock.lasers[0]; window.lab.power.unplug(L); L.on = false;
      act(L, '전원 연결'); const plugged = !!L.port; bus.dispatch({ t: 'undo', by: 'p0' });
      const unplugged = !L.port;
      act(L, '전원 연결'); act(L, '레이저 켜기'); const on = L.on; bus.dispatch({ t: 'undo', by: 'p0' });
      const mw = L.powerMw; bus.set(L, 'powerMw', mw === 5 ? 1 : 5); bus.dispatch({ t: 'undo', by: 'p0' });
      return { plugged, unplugged, on, off: !L.on, stillPlugged: !!L.port, mw0: mw, mw1: L.powerMw };`);
    t.check(L.plugged && L.unplugged, '전원 연결 → 되돌리면 뽑힘');
    t.check(L.on && L.off && L.stillPlugged, '레이저 켜기 → 되돌리면 꺼짐 (전원은 그대로)');
    t.check(L.mw0 === L.mw1, `set(출력) 되돌림 ${L.mw0} mW`);

    // 6) 화학: 따르기는 되돌리지 않는다 (몰수 그대로)
    const chem = await ev(`
      const src = items.find((i) => i.name.startsWith('0.1 M 염산')), dst = items.find((i) => i.name.startsWith('비커 1'));
      const v0 = dst.solution.V; bus.dispatch({ t: 'pour', by: 'p0', src: R(src), dst: R(dst), mL: 10 });
      const v1 = dst.solution.V; const ok = bus.dispatch({ t: 'undo', by: 'p0' });
      return { dv: (v1 - v0) * 1000, after: (dst.solution.V - v0) * 1000, ok };`);
    t.near(chem.dv, 10, 1e-9, '따르기 10 mL');
    t.check(!chem.ok && Math.abs(chem.after - 10) < 1e-9, '따르기는 되돌리지 않음 (부피 그대로)');
    await undoBtn();
    t.check((await t.page.$eval('#toast', (e) => e.textContent)).includes('화학'), '안내: 화학 조작은 되돌리지 않음');

    // 7) 여럿: 내가 옮긴 뒤 다른 사람(p1)이 같은 렌즈를 옮기면 내 되돌리기는 거절
    const mp = await ev(`
      bus.call(lens, 'nudge', 0.002, 0);
      bus.dispatch({ t: 'call', by: 'p1', target: R(lens), method: 'nudge', args: [0, 0.002] });
      const ok = bus.dispatch({ t: 'undo', by: 'p0' }); return ok;`);
    t.check(mp === false, '다른 사람이 그 뒤에 바꾼 기구는 되돌리지 않음');
  },
};
