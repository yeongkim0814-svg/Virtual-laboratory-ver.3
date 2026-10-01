// 이름 바꾸기 동기화 + 집기·놓기가 손 뻗기에 맞춰 옮겨 감 (물체가 손보다 먼저 순간이동하지 않음)
module.exports = {
  name: '이름 변경 동기화 · 집기/놓기 손 뻗기 연동',
  async run(t) {
    const A = t;
    await A.clearBench();
    const B = await A.newPeer();
    const code = await A.ev(() => window.lab.session.host(new window.lab.LocalTransport(), '방장'));
    await B.ev((c) => window.lab.session.join(new window.lab.LocalTransport(), c, '손님'), code);
    await A.wait(400);

    // ---- 이름: 손님이 바꾸면 방장·아바타 이름표에, 방장이 바꾸면 손님에게 ----
    const tagText = (T, id) => T.ev((id) => { const g = window.lab.avatars.groupOf(id); const m = g && g.children.find((c) => c.userData.nameTag); return m ? m.material.map.image.toDataURL() : null; }, id);
    const tag0 = await tagText(A, 'p1');
    await B.ev(() => window.lab.session.setName('새이름'));
    await A.wait(400);
    t.check((await A.ev(() => window.lab.session.players.get('p1').name)) === '새이름', '손님이 바꾼 이름이 방장에게');
    t.check((await tagText(A, 'p1')) !== tag0, '방장 화면의 아바타 이름표가 다시 그려짐');
    await A.ev(() => window.lab.session.setName('방장2'));
    await B.wait(400);
    t.check((await B.ev(() => window.lab.session.players.get('p0').name)) === '방장2', '방장이 바꾼 이름이 손님에게');
    const C = await A.newPeer();
    await C.ev((c) => window.lab.session.join(new window.lab.LocalTransport(), c, '셋째'), code);
    await A.wait(500);
    t.check((await C.ev(() => window.lab.session.players.get('p1').name)) === '새이름', '나중에 들어온 사람도 바뀐 이름을 봄');
    await C.end();

    // ---- 집기·놓기: 부모가 바뀐 프레임을 0초로 잡고 프레임마다 위치를 기록 (헤드리스 지연과 무관) ----
    const R = '저항 47';
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const startWatch = (T) => T.ev((R) => {
      const { items, THREE } = window.lab;
      const it = items.find((i) => i.name.startsWith(R));
      const parent0 = it.object.parent;
      // 그려지는 자리: 논리는 최종 자리를 보므로, 그리기 직전과 같이 눈속임을 적용해 읽고 되돌린다
      const at = (shown) => { if (shown) window.lab.glide.applyGlides(); const p = it.object.getWorldPosition(new THREE.Vector3()); if (shown) window.lab.glide.restoreGlides(); return [p.x, p.y, p.z]; };
      const home = at(false);
      return new Promise((res) => {
        const out = [];
        let t0 = null;
        const f = () => {
          const now = performance.now();
          if (t0 === null && it.object.parent !== parent0) t0 = now;
          if (t0 !== null) out.push({ t: (now - t0) / 1000, p: at(true), logic: at(false) });
          if (t0 !== null && now - t0 > 1200) res({ home, out });
          else requestAnimationFrame(f);
        };
        f();
      });
    }, R);
    // 시계열에서 시각 s(초)에 가장 가까운 표본
    const near = (out, s) => out.reduce((b, o) => (Math.abs(o.t - s) < Math.abs(b.t - s) ? o : b));
    const run = async (T, fire, doer) => {
      const w = startWatch(T);          // 감시를 먼저 걸고
      await T.wait(50);
      await doer.ev(fire.fn, fire.arg); // 명령을 낸다
      return w;
    };
    const pickCmd = { fn: (R) => { const { items, bus } = window.lab; const it = items.find((i) => i.name.startsWith(R)); bus.dispatch({ t: 'act', by: bus.me, target: bus.registry.ref(it), label: '집기 · ' + it.name }); }, arg: R };
    const spot = [3.5, 0.85, 6.0];
    const placeCmd = { fn: ({ R, p }) => { const { items, bus } = window.lab; const it = items.find((i) => i.name.startsWith(R)); bus.dispatch({ t: 'place', by: bus.me, item: bus.registry.ref(it), p }); }, arg: { R, p: spot } };

    // 남이 집기 (방장 화면)
    const w1 = await run(A, pickCmd, B);
    const e1 = w1.out[0]; // 부모가 바뀐 첫 프레임 (헤드리스는 한 프레임 ~0.15 s라 시각을 정해 고르면 기다림 0.2 s를 넘기 쉽다)
    t.check(dist(e1.p, w1.home) < 0.02, `남이 집을 때 ${e1.t.toFixed(2)} s: 물체는 제자리 (이동 ${(dist(e1.p, w1.home) * 100).toFixed(1)} cm)`);
    const l1 = w1.out[w1.out.length - 1];
    // 빨라진 집기 (시간표 ×2): 0.2 s 멈춤 + 0.15 s → 0.4 s면 손에 들어와 있다
    const in1 = w1.out.find((o) => o.t >= 0.4);
    t.check(in1 && dist(in1.p, in1.logic) < 0.01, `집기 ${in1 && in1.t.toFixed(2)} s 뒤 이미 손에 (그려진 자리–손 ${in1 && (dist(in1.p, in1.logic) * 100).toFixed(2)} cm, 예전 0.55 s)`);
    t.check(dist(w1.out[0].logic, w1.out[0].p) > 0.05 && dist(l1.logic, l1.p) < 0.001, `논리 위치는 처음부터 손에 있고(그려진 자리와 ${(dist(w1.out[0].logic, w1.out[0].p) * 100).toFixed(0)} cm 차) 끝나면 같음`);
    const handNow = await A.ev(() => { const { avatars, THREE } = window.lab; const it = avatars.heldBy('p1'); return [it.object.getWorldPosition(new THREE.Vector3()).distanceTo(avatars.handOf('p1'))]; });
    t.check(handNow[0] < 0.01, `${l1.t.toFixed(2)} s 뒤에는 손끝에 (차이 ${(handNow[0] * 100).toFixed(2)} cm)`);

    // 남이 놓기: 손에서 출발해 REACH_OUT(0.25 s) 뒤 자리에
    const w2 = await run(A, placeCmd, B);
    const m2 = w2.out[0]; // 부모가 바뀐 첫 프레임 (헤드리스 프레임이 느려 시각을 정해 고르면 0.25 s를 넘길 수 있다)
    const f2 = w2.out[w2.out.length - 1];
    t.check(dist(m2.p, spot) > 0.1, `놓은 ${m2.t.toFixed(2)} s 뒤: 아직 자리에 안 닿음 (자리까지 ${(dist(m2.p, spot) * 100).toFixed(0)} cm)`);
    t.check(dist(f2.p, spot) < 0.005, `${f2.t.toFixed(2)} s 뒤 놓을 자리에 (오차 ${(dist(f2.p, spot) * 1000).toFixed(1)} mm)`);

    // 내 손(1인칭)으로 집기
    await A.ev(() => { window.lab.player.pos.x = 3.5; window.lab.player.pos.z = 5.2; });
    // (두 페이지가 뜨면 헤드리스 프레임이 ~1 s까지 늘어 rAF 표본으로는 0.35 s 보간을 못 잡는다 → 명령 직후 같은 호출 안에서, 그리고 실제 시간 0.5 s 뒤에 그려질 자리를 읽는다)
    const my = await A.ev((R) => new Promise((res) => {
      const { items, bus, THREE } = window.lab; const it = items.find((i) => i.name.startsWith(R));
      const pos = (shown) => { if (shown) window.lab.glide.applyGlides(); const p = it.object.getWorldPosition(new THREE.Vector3()); if (shown) window.lab.glide.restoreGlides(); return p; };
      const home = pos(false);
      bus.dispatch({ t: 'act', by: bus.me, target: bus.registry.ref(it), label: '집기 · ' + it.name });
      const t0 = performance.now();
      const early = pos(true).distanceTo(home);
      setTimeout(() => res({ early, lateGap: pos(true).distanceTo(pos(false)), late: (performance.now() - t0) / 1000 }), 500);
    }), R);
    t.check(my.early < 0.01, `내가 집은 직후: 물체는 제자리 (이동 ${(my.early * 100).toFixed(1)} cm)`);
    t.check(my.lateGap < 0.01, `내가 집기 ${my.late.toFixed(2)} s 뒤 이미 들림 위치 (차이 ${(my.lateGap * 100).toFixed(2)} cm)`);
    const inCam = await A.ev((R) => { const { items, camera } = window.lab; const it = items.find((i) => i.name.startsWith(R)); return it.object.parent === camera && it.object.position.length() > 0.3; }, R);
    t.check(inCam, '1.2 s 뒤에는 카메라 앞 손 자리에 들림');
    await B.end();
  },
};
