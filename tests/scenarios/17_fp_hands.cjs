// 1인칭 두 손: 빈손은 화면 밖, 기구를 들면 오른손이 기구 옆을 잡음, 손 뻗기 최고점에서 손–목표 거리, 레이어 1(광선 판정 제외)
module.exports = {
  name: '1인칭 두 손 (빈손 · 잡기 · 손 뻗기 · 레이어)',
  async run(t) {
    await t.clearBench();
    await t.ev(() => { const p = window.lab.player; p.pos.x = 4.5; p.pos.z = 3.0; p.yaw = 0; p.pitch = 0; });
    await t.wait(900);
    const tip = () => t.ev(() => { const v = window.lab.fpHands.handTip(1); return [v.x, v.y, v.z]; });

    // ---- 빈손: 어깨 아래 · 눈보다 뒤(z > −0.1) 에 있어 화면에 안 들어온다 ----
    const t0 = await tip();
    t.check(t0[1] < -0.6 && t0[2] > -0.1, `빈손 오른손 끝 (카메라 좌표) (${t0.map((x) => x.toFixed(2)).join(', ')}): 화면 아래 · 눈 뒤`);

    // ---- 레이어: 손 메시는 모두 레이어 1만 · 광선 판정(레이어 0) 제외 ----
    const lay = await t.ev(() => { let n = 0; let ok = true; window.lab.fpHands.root.traverse((o) => { if (o.isMesh) { n++; if (o.layers.mask !== 2 || !o.userData.noPick) ok = false; } }); return { n, ok }; });
    t.check(lay.ok && lay.n === 4, `손 메시 ${lay.n}개 모두 레이어 1 · noPick`);

    // ---- 들기: 오른손이 기구 오른쪽 옆(약 7 cm)으로 ----
    await t.ev(() => { const { items, bus } = window.lab; const it = items.find((i) => i.name.startsWith('저항 47')); bus.dispatch({ t: 'act', by: bus.me, target: bus.registry.ref(it), label: '집기 · ' + it.name }); });
    await t.wait(2200);
    const held = await t.ev(() => {
      const { hand, fpHands } = window.lab; const it = hand.held; if (!it) return null;
      const v = fpHands.handTip(1); const p = it.object.position;
      return { tip: [v.x, v.y, v.z], item: [p.x, p.y, p.z] };
    });
    t.check(!!held, '기구를 듦');
    const d = Math.hypot(held.tip[0] - held.item[0], held.tip[1] - held.item[1], held.tip[2] - held.item[2]);
    t.check(d < 0.2 && held.tip[0] > held.item[0], `든 기구 ↔ 오른손 끝 ${(d * 100).toFixed(1)} cm (< 20), 손이 기구 오른쪽 (${held.tip[0].toFixed(2)} > ${held.item[0].toFixed(2)})`);
    t.check(held.tip[2] < -0.3, `손이 눈앞 ${(-held.tip[2]).toFixed(2)} m에 보임 (빈손 때와 달리 시야 안)`);

    // ---- 놓고 빈손으로: 손이 다시 내려감 ----
    await t.ev(() => { window.lab.hand.handOver(); });
    await t.wait(1500);
    const t1 = await tip();
    t.check(t1[1] < -0.6 && t1[2] > -0.1, `놓은 뒤 손 다시 화면 밖 (${t1.map((x) => x.toFixed(2)).join(', ')})`);

    // ---- 손 뻗기: 실제 목표(눈 앞 0.45 m · 눈 아래 0.2 m)로 최고점에서 5 cm 안, 0.9 s 뒤 돌아옴 ----
    const r = await t.ev(() => new Promise((res) => {
      const { player, camera, fpHands, THREE } = window.lab;
      const fwd = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
      const target = new THREE.Vector3(camera.position.x + fwd.x * 0.45, camera.position.y - 0.2, camera.position.z + fwd.z * 0.45);
      const t0 = performance.now(); fpHands.reach(target);
      camera.updateMatrixWorld(true);
      const tc = target.clone().applyMatrix4(camera.matrixWorld.clone().invert());
      let best = Infinity; let after = null;
      const tick = () => {
        const age = (performance.now() - t0) / 1000;
        const v = fpHands.handTip(1); const dist = v.distanceTo(tc);
        if (age > 0.25 && age < 0.4) best = Math.min(best, dist);
        if (age > 1.1) { after = dist; res({ best, after }); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }));
    t.check(r.best < 0.05, `손 뻗기 최고점 손–목표 ${(r.best * 100).toFixed(1)} cm (< 5, 몸 앞 0.45 m)`);
    t.check(r.after > 0.4, `1.1 s 뒤 손이 돌아옴 (목표와 ${(r.after * 100).toFixed(0)} cm)`);
    t.check(t.errors.length === 0, '페이지 오류 없음');
  },
};
