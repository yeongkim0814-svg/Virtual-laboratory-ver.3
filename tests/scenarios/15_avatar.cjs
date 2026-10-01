// 앉기 + 캐릭터(상자 인형) 모션: 눈높이, 앉은 속도, 인형 골반 높이, 걷기·멈춤 각 진폭, 든 기구, 손 뻗기, 그리기 비용
module.exports = {
  name: '앉기 · 아바타 모션 (인형 관절)',
  async run(t) {
    const A = t; // 방장 (내 화면)
    await A.clearBench();
    const camY = () => A.ev(() => window.lab.camera.position.y);

    // ---- 1) 앉기: 버튼 → 눈높이 1.60 → 1.00 m → 다시 일어섬 ----
    t.near(await camY(), 1.6, 0.01, '서 있는 눈높이 (m)');
    await A.page.tap('#btn-crouch');
    await A.wait(900);
    t.near(await camY(), 1.0, 0.01, '앉은 눈높이 (m)');
    t.check(await A.page.$eval('#btn-crouch', (b) => b.getAttribute('aria-pressed') === 'true'), '앉기 버튼 눌림 표시');
    await A.page.tap('#btn-crouch');
    await A.wait(900);
    t.near(await camY(), 1.6, 0.01, '일어서면 다시 1.60 m');

    // ---- 2) 앉은 채 이동 속도 = 서서의 절반 ----
    const walkDist = async (crouch) => {
      await A.ev((crouch) => { const p = window.lab.player; p.pos.x = 3.5; p.pos.z = 6.4; p.yaw = 0; p.crouch = crouch; p.c = crouch ? 1 : 0; p.eye = crouch ? 1.0 : 1.6; }, crouch);
      await A.wait(500);
      const z0 = await A.ev(() => window.lab.player.pos.z);
      await A.page.keyboard.down('KeyW');
      await A.wait(1000);
      await A.page.keyboard.up('KeyW');
      return z0 - (await A.ev(() => window.lab.player.pos.z));
    };
    const dStand = await walkDist(false);
    const dCrouch = await walkDist(true);
    t.near(dCrouch / dStand, 0.5, 0.1, `앉은 이동 거리 / 선 이동 거리 (${dCrouch.toFixed(2)} / ${dStand.toFixed(2)} m)`);
    await A.ev(() => { const p = window.lab.player; p.crouch = false; });

    // ---- 3) 인형: 손님 탭 ----
    const B = await A.newPeer();
    const code = await A.ev(() => window.lab.session.host(new window.lab.LocalTransport(), '방장'));
    await B.ev((code) => window.lab.session.join(new window.lab.LocalTransport(), code, '손님'), code);
    await B.ev(() => { const p = window.lab.player; p.pos.x = 3.5; p.pos.z = 3.6; p.yaw = Math.PI; });
    await A.wait(1500);
    const rig = () => A.ev(() => {
      const r = window.lab.avatars.rigOf('p1');
      return r && { pelvisY: r.pelvis.position.y, hipL: r.hipL.rotation.x, hipR: r.hipR.rotation.x, shoulderR: r.shoulderR.rotation.x, elbowR: r.elbowR.rotation.x, head: r.head.rotation.x, anchorParent: r.elbowR.children.some((c) => c.children.length > 0 || c === window.lab.avatars.groupOf('p1')) };
    });
    let r = await rig();
    t.check(!!r, '손님 인형이 방장 화면에 있음');
    t.near(r.pelvisY, 0.96, 0.03, '서 있는 인형 골반 높이 (m)');

    // 앉기: 손님이 앉으면 골반 0.476 m (엉덩이 85° · 무릎 −130° → 다리 높이 0.39 + 0.09)
    await B.ev(() => { window.lab.player.crouch = true; });
    await A.wait(1500);
    r = await rig();
    t.near(r.pelvisY, 0.476, 0.04, '앉은 인형 골반 높이 (m)');
    t.near(r.hipL, 1.48, 0.1, '앉은 인형 엉덩이 각 (rad, 85°)');
    await B.ev(() => { window.lab.player.crouch = false; });
    await A.wait(1500);

    // 걷기: 손님이 1.4 m/s로 걸으면 엉덩이 각 폭 > 0.3 rad, 멈추면 1 s 뒤 < 0.05 rad
    await B.ev(() => { const p = window.lab.player; p.pos.x = 3.0; p.pos.z = 6.0; p.yaw = -Math.PI / 2; window.__w = setInterval(() => { p.pos.x += 1.4 * 0.016; if (p.pos.x > 11) p.pos.x = 3.0; }, 16); });
    await A.wait(1000);
    const sample = (ms) => A.ev((ms) => new Promise((res) => {
      let max = 0; const t0 = performance.now();
      const tick = () => { const r = window.lab.avatars.rigOf('p1'); max = Math.max(max, Math.abs(r.hipL.rotation.x), Math.abs(r.hipR.rotation.x)); if (performance.now() - t0 < ms) requestAnimationFrame(tick); else res(max); };
      requestAnimationFrame(tick);
    }), ms);
    const walking = await sample(1200);
    t.check(walking > 0.3, `걸을 때 엉덩이 각 최대 ${walking.toFixed(2)} rad (> 0.3, 이론 0.40)`);
    // 걸음 빈도: 3 s 동안 엉덩이 각이 0을 위로 지나는 횟수 / 3 = 0.9 Hz (1.4 m/s)
    const freq = await A.ev(() => new Promise((res) => {
      let prev = null; let n = 0; const t0 = performance.now();
      const tick = () => { const x = window.lab.avatars.rigOf('p1').hipL.rotation.x; if (prev !== null && prev < 0 && x >= 0) n++; prev = x; if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else res(n / 3); };
      requestAnimationFrame(tick);
    }));
    t.check(freq > 0.65 && freq < 1.2, `걸음 빈도 ${freq.toFixed(2)} Hz (1.4 m/s에서 사람은 약 0.9 Hz)`);
    await B.ev(() => { clearInterval(window.__w); });
    await A.wait(1500);
    const still = await sample(400);
    t.check(still < 0.05, `멈추고 1.5 s 뒤 엉덩이 각 ${still.toFixed(3)} rad (< 0.05)`);

    // 들기: 기구를 들면 오른팔 받침 자세 (위팔 +45°)
    await B.ev(() => { const { items, bus } = window.lab; const it = items.find((i) => i.name.startsWith('저항 47')); bus.dispatch({ t: 'act', by: bus.me, target: bus.registry.ref(it), label: '집기 · ' + it.name }); });
    await A.wait(1500);
    r = await rig();
    t.near(r.shoulderR, 0.79, 0.12, '든 인형 오른쪽 위팔 각 (rad, 45°)');
    t.check(await A.ev(() => !!window.lab.avatars.heldBy('p1')), '든 기구가 손님 손에 붙음');
    // 손 뻗기: 손님이 조작(놓기)하면 오른팔이 0.4 s 안에 더 앞으로
    await B.ev(() => { const { items, bus } = window.lab; const it = items.find((i) => i.name.startsWith('저항 47')); bus.dispatch({ t: 'place', by: bus.me, item: bus.registry.ref(it), p: [3.5, 0.85, 6.0] }); });
    await A.wait(3000);
    const reach = await A.ev(() => new Promise((res) => {
      window.lab.avatars.reach('p1');
      let max = 0; const t0 = performance.now();
      const tick = () => { max = Math.max(max, window.lab.avatars.rigOf('p1').shoulderR.rotation.x); if (performance.now() - t0 < 500) requestAnimationFrame(tick); else res(max); };
      requestAnimationFrame(tick);
    }));
    t.check(reach > 0.7, `조작하면 오른팔이 앞으로 뻗음: 위팔 최대 ${reach.toFixed(2)} rad (> 0.7)`);

    // 고개: 손님이 위를 보면 머리가 위를 본다 (몸통 기울기 보정 후)
    await B.ev(() => { window.lab.player.pitch = 0.5; });
    await A.wait(1500);
    r = await rig();
    t.near(r.head, 0.5, 0.1, '손님이 0.5 rad 위를 보면 인형 머리 각 (rad)');

    // ---- 4) 그리기 비용: 아바타 하나당 호출 ≤ 15 (아바타가 보이는 자리에서) ----
    await B.ev(() => { const p = window.lab.player; p.pos.x = 3.5; p.pos.z = 3.6; p.yaw = Math.PI; p.pitch = 0; });
    await A.camera(3.5, 6.4, 0, 0);
    await A.wait(1500);
    const calls = await A.ev(() => {
      const { avatars, renderer, scene, camera } = window.lab;
      const g = avatars.groupOf('p1'); const n = (v) => { renderer.info.reset(); g.visible = v; renderer.render(scene, camera); return renderer.info.render.calls; };
      const on = n(true); const off = n(false); g.visible = true; return { calls: on - off, on, off };
    });
    t.check(calls.calls > 5 && calls.calls <= 15, `아바타 하나 그리기 호출 ${calls.calls} (5 < n ≤ 15)`);
    t.check(t.errors.length === 0, `페이지 오류 없음${t.errors.length ? ': ' + t.errors[0].slice(0, 120) : ''}`);
    await B.end();
  },
};
