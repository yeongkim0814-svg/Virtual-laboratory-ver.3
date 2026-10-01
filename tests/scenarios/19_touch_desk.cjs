// 오른쪽 아래 버튼(앉기·되돌리기·확대) · 조이스틱을 누른 채 두 번째 손가락으로 앉기 · 탁상시계·온습도계 기구
module.exports = {
  name: '오른쪽 아래 버튼 · 걸으면서 앉기 · 탁상시계/온습도계',
  async run(t) {
    await t.clearBench();
    const page = t.page;
    // ---- 버튼 자리: 화면 오른쪽 아래 ----
    const vp = page.viewportSize();
    const rects = await page.evaluate(() => ['btn-crouch', 'btn-undo', 'btn-zoom'].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { id, x: r.x, y: r.y, w: r.width, h: r.height }; }));
    const st = await page.evaluate(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const ok = rects.every((r) => st.y + st.h - (r.y + r.h) < 20 && r.x - st.x > st.w * 0.7 && r.w >= 56);
    t.check(ok, `세 버튼이 무대 오른쪽 아래 (${rects.map((r) => `${r.id.slice(4)} 오른쪽 ${Math.round(st.x + st.w - r.x - r.w)} · 아래 ${Math.round(st.y + st.h - r.y - r.h)} px, ${Math.round(r.w)} px`).join(' · ')}; 무대 ${Math.round(st.w)}×${Math.round(st.h)})`);

    // ---- 걸으면서 앉기: 손가락 1 = 조이스틱(앞으로), 손가락 2 = 앉기 버튼 ----
    await t.camera(9.0, 6.2, Math.PI / 2, 0);
    await t.ev(() => { window.lab.player.crouch = false; document.getElementById('btn-crouch').setAttribute('aria-pressed', 'false'); });
    const cdp = await page.context().newCDPSession(page);
    const joy = { x: Math.round(st.x + st.w * 0.15), y: Math.round(st.y + st.h * 0.7), id: 1 };
    const c = rects[0];
    const btn = { x: Math.round(c.x + c.w / 2), y: Math.round(c.y + c.h / 2), id: 2 };
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id })) });
    await touch('touchStart', [joy]);
    for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ ...joy, y: joy.y - i * 10 }]); await t.wait(30); }
    const held = { ...joy, y: joy.y - 60 };
    await t.wait(300);
    const p0 = await t.ev(() => ({ x: window.lab.player.pos.x, z: window.lab.player.pos.z }));
    await touch('touchStart', [held, btn]);
    await t.wait(80);
    await touch('touchMove', [held]); // 버튼 손가락만 뗌: 이전 이벤트에서 빠진 점 = 뗀 손가락 (CDP), 조이스틱은 계속
    await t.wait(700);
    const p1 = await t.ev(() => ({ x: window.lab.player.pos.x, z: window.lab.player.pos.z, crouch: window.lab.player.crouch, c: window.lab.player.c }));
    await touch('touchMove', [{ ...held, y: held.y - 2 }]);
    await t.wait(300);
    const p2 = await t.ev(() => ({ x: window.lab.player.pos.x, z: window.lab.player.pos.z }));
    await touch('touchEnd', []);
    const d01 = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    const d12 = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    t.check(p1.crouch === true && p1.c > 0.8, `조이스틱을 누른 채 두 번째 손가락으로 앉기 (앉은 정도 ${p1.c.toFixed(2)})`);
    t.check(d01 > 0.3 && d12 > 0.1, `앉는 동안·앉은 뒤에도 계속 이동 (0.78 s 동안 ${d01.toFixed(2)} m, 이후 0.3 s ${d12.toFixed(2)} m)`);
    await t.ev(() => { window.lab.player.crouch = false; });

    // ---- 탁상시계 · 온습도계: 기구로 집고 다른 테이블에 놓기 ----
    const info = await t.ev(() => {
      const { items } = window.lab;
      const ck = items.find((i) => i.name === '탁상시계'); const hy = items.find((i) => i.name === '온습도계');
      const fw = (o) => { const v = new window.lab.THREE.Vector3(0, 0, 1).applyQuaternion(o.getWorldQuaternion(new window.lab.THREE.Quaternion())); return v.toArray(); };
      return ck && hy && { last: items.indexOf(hy) === items.length - 1, cp: ck.object.position.toArray(), hp: hy.object.position.toArray(), cf: fw(ck.object), hf: fw(hy.object), reading: hy.reading };
    });
    t.check(!!info, '탁상시계·온습도계가 기구 목록에 있음');
    t.check(info && info.last, '기구 목록 맨 끝 (기존 기구의 명령 이름표 그대로)');
    t.check(info && [info.cp, info.hp].every((p) => Math.abs(p[1] - 0.9) < 0.001 && p[2] > 7.05 && p[2] < 7.6 && p[0] > 2.15 && p[0] < 12), `처음 자리 실험 기구 수납장(b) 윗면 (높이 ${info && info.cp[1].toFixed(3)} m, x ${info && info.cp[0].toFixed(2)}, z ${info && info.cp[2].toFixed(2)})`);
    t.check(info && [info.cf, info.hf].every((f) => f[2] < -0.99), `문자판이 방 쪽(-z)을 봄 (앞 방향 z ${info && info.cf[2].toFixed(2)})`);
    t.check(info && /^2[0-9]\.\d °C \d+ %RH$/.test(info.reading), `온습도 표시 "${info && info.reading}"`);
    const cmd = (fn, arg) => t.ev(fn, arg);
    await cmd(() => { const { items, bus } = window.lab; const it = items.find((i) => i.name === '탁상시계'); bus.dispatch({ t: 'act', by: bus.me, target: bus.registry.ref(it), label: '집기 · ' + it.name }); });
    await t.wait(200);
    t.check(await t.ev(() => window.lab.hand.held?.name === '탁상시계'), '탁상시계를 집음');
    await cmd(() => { const { items, bus } = window.lab; const it = items.find((i) => i.name === '탁상시계'); bus.dispatch({ t: 'place', by: bus.me, item: bus.registry.ref(it), p: [9.9, 0.85, 1.6] }); });
    await t.wait(200);
    const placed = await t.ev(() => window.lab.items.find((i) => i.name === '탁상시계').object.getWorldPosition(new window.lab.THREE.Vector3()).toArray());
    t.check(Math.hypot(placed[0] - 9.9, placed[2] - 1.6) < 0.001 && Math.abs(placed[1] - 0.85) < 0.001, `실험 테이블 2에 놓임 (${placed.map((v) => v.toFixed(2)).join(', ')})`);
    // 표시는 세계 상태가 아님: 1.2 s 동안 문자판은 다시 그려지지만 digest는 그대로
    const face = () => t.ev(() => { const ck = window.lab.items.find((i) => i.name === '탁상시계'); let url = ''; ck.object.traverse((o) => { if (o.material?.map?.image?.toDataURL) url = o.material.map.image.toDataURL(); }); return url; });
    const d0 = await t.ev(() => window.lab.sync.digest()); const f0 = await face();
    await t.wait(1200);
    const d1 = await t.ev(() => window.lab.sync.digest()); const f1 = await face();
    t.check(f0 !== f1, '1.2 s 뒤 초침이 움직여 문자판이 다시 그려짐');
    t.check(d0 === d1, 'digest는 그대로 (시각·온습도는 세계 상태가 아님 → 멀티 재동기화 없음)');
    t.check(t.errors.length === 0, '페이지 오류 없음');
  },
};
