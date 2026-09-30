// 광학 정렬: 위치·방향 막대 — 빛–중심 거리 표시, 빛에 맞추기(렌즈 광축까지), 1 mm 이동, 책상 밖 이동 거부
module.exports = {
  name: '광학 정렬 (위치·방향 막대)',
  async run(t) {
    await t.clearBench();
    const LENS = '볼록 렌즈 (f = +10';
    // 레이저 빛은 +x, z = 3.000. 렌즈는 옆으로 7 mm, 3° 비뚤게
    await t.put('레이저', 9.3, 3.0);
    await t.put(LENS, 9.8, 3.007, { yaw: (3 * Math.PI) / 180 });
    await t.ev(() => {
      const { stock, power } = window.lab; const L = stock.lasers[0];
      if (!L.port) power.plug(L); L.on = true;
    });
    await t.camera(10.6, 3.0, Math.PI / 2, -0.7); // 테이블 오른쪽 끝에서 −x(레이저 쪽)를 본다
    await t.wait(700);
    // 렌즈는 두 번 탭 동작이 "위치·방향" 하나뿐이라 메뉴 없이 바로 열린다 (여럿이면 메뉴에서 고른다).
    // 헤드리스에서 프레임이 느리면 두 번 탭이 한 번 탭(집기)으로 읽힐 수 있다 → 제자리에 되돌리고 한 번 더
    const opened = () => t.page.$eval('#rotate-bar', (e) => !e.hidden);
    for (let k = 0; k < 3 && !(await opened()); k++) {
      if (k) {
        await t.ev(() => { const { hand } = window.lab; hand.handOver(); });
        await t.put(LENS, 9.8, 3.007, { yaw: (3 * Math.PI) / 180 });
        await t.wait(400);
      }
      await t.dbl(await t.screenOf(LENS, [0, 0.052, 0])); // 빛줄기·빛점을 피해 렌즈 윗부분
      if ((await t.menu()).length) await t.pick(/^위치·방향/);
    }
    await t.wait(300);
    const text = () => t.page.$eval('#rb-beam', (e) => e.textContent);
    const mm = async () => Number((await text()).replace('−', '-').match(/[-+][\d.]+/)[0]);
    t.check(await t.page.$eval('#rotate-bar', (e) => !e.hidden), '막대 열림');
    t.near(await mm(), -7.0, 0.05, '빛–중심 거리 (mm, 진행 방향 왼쪽 +)');
    t.check((await t.page.$eval('#rb-val', (e) => e.textContent)) === '3.0°', '방향 3.0° 표시');

    await (await t.page.$('#rb-align')).tap();
    await t.wait(500);
    const lens = () => t.ev((n) => {
      const it = window.lab.items.find((i) => i.name.startsWith(n));
      return { z: it.object.position.z, yaw: it.yawDeg };
    }, LENS);
    let s = await lens();
    t.near(s.z, 3.0, 1e-6, '빛에 맞추기 → 렌즈 중심 z = 빛줄기');
    t.check(s.yaw === 0 || s.yaw === 180, `렌즈 광축 ∥ 빛 (${s.yaw}°)`);
    t.near(await mm(), 0, 0.05, '맞춘 뒤 빛–중심 거리');

    // 1 mm 단위로 화면 왼쪽(−x를 볼 때 +z) 한 번 → 중심이 빛의 오른쪽(진행 +x 기준)으로 1 mm
    await (await t.page.$('#rotate-bar button[data-step="0.001"]')).tap();
    await (await t.page.$('#rotate-bar button[data-m="L"]')).tap();
    await t.wait(500);
    s = await lens();
    t.near(s.z, 3.001, 1e-6, '1 mm 이동');
    t.near(await mm(), -1.0, 0.05, '이동 후 빛–중심 거리');
    // 0.1° 회전
    await (await t.page.$('#rotate-bar button[data-d="0.1"]')).tap();
    await t.wait(200);
    t.near((await lens()).yaw % 180, 0.1, 1e-9, '+0.1° 회전');

    // 명령 버스 경유 + 책상 밖으로는 못 나감 (실험 테이블 2: x 7.8 ~ 10.1)
    const r = await t.ev((n) => {
      const { items, bus } = window.lab;
      const it = items.find((i) => i.name.startsWith(n));
      it.object.position.x = 10.095; it.object.updateMatrixWorld(true);
      const before = it.object.position.x;
      bus.call(it, 'nudge', 0.01, 0);
      const out = it.object.position.x;
      bus.call(it, 'nudge', -0.001, 0);
      return { before, out, back: it.object.position.x };
    }, LENS);
    t.check(r.out === r.before, '책상 가장자리 밖으로 1 cm → 거부');
    t.near(r.back, 10.094, 1e-9, '안쪽으로 1 mm → 이동');
    await (await t.page.$('#rb-done')).tap();
  },
};
