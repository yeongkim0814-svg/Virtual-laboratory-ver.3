// 앉기 + 아바타(가운 연구자) 모션: 눈높이, 앉은 속도 · 발 디딤 걸음(미끄럼·역진자 골반·걸음 빈도·걷기/뛰기), 앉기, 몸 따라 돌기, 든 기구, 손 뻗기, 비용
// 숫자는 모두 그려진 관절(matrixWorld)에서 읽는다 (모션 계산값이 아니라 눈에 보이는 것)
module.exports = {
  name: '앉기 · 아바타 모션 (발 디딤 IK)',
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

    // ---- 3) 아바타: 손님 탭 ----
    const B = await A.newPeer();
    const code = await A.ev(() => window.lab.session.host(new window.lab.LocalTransport(), '방장'));
    await B.ev((code) => window.lab.session.join(new window.lab.LocalTransport(), code, '손님'), code);
    await B.ev(() => { const p = window.lab.player; p.pos.x = 3.5; p.pos.z = 3.6; p.yaw = Math.PI; });
    await A.wait(1800);
    t.check(await A.ev(() => !!window.lab.avatars.rigOf('p1')), '손님 인형이 방장 화면에 있음');
    const L_E = 0.98 * 0.8;
    const stdY = L_E + 0.07 + 0.06; // 서 있는 골반 = 곧은 다리(0.98 L) + 발목 + 0.06 = 0.914
    const pelvisY = () => A.ev(() => window.lab.avatars.rigOf('p1').pelvis.position.y);
    t.near(await pelvisY(), stdY, 0.02, `서 있는 인형 골반 높이 (m, 0.98·0.80 + 0.13 = ${stdY.toFixed(3)})`);

    // 한 번에 프레임마다 그려진 발목·엉덩이·골반을 모은다 (각 프레임: 시각, 발목 [왼, 오른], 엉덩이, 골반 y, 디딤·뜀 표시)
    const collect = (ms) => A.ev((ms) => new Promise((res) => {
      const { avatars } = window.lab; const m = avatars.motionOf('p1'); const g = avatars.groupOf('p1');
      const fr = []; const t0 = performance.now(); const c0 = m.cycles; const x0 = g.position.x; const z0 = g.position.z;
      const v3 = (v) => [v.x, v.y, v.z];
      const tick = () => {
        const a = avatars.anklesOf('p1');
        fr.push({ t: performance.now() / 1000, a: [v3(a[0]), v3(a[1])], h: [v3(avatars.jointOf('p1', 'hipL')), v3(avatars.jointOf('p1', 'hipR'))], py: avatars.rigOf('p1').pelvis.position.y, st: [...m.out.stance], fl: m.out.flight });
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        else res({ fr, dc: m.cycles - c0, dt: (performance.now() - t0) / 1000, dist: Math.hypot(g.position.x - x0, g.position.z - z0), beta: m.out.beta });
      };
      requestAnimationFrame(tick);
    }), ms);
    // 디딘 프레임 쌍의 발목 수평 이동 평균 속도 (cm/s)
    const slip = (fr) => {
      let d = 0; let T = 0;
      for (let j = 1; j < fr.length; j++) {
        const dt = fr[j].t - fr[j - 1].t; if (!(dt > 0)) continue;
        for (let k = 0; k < 2; k++) if (fr[j].st[k] && fr[j - 1].st[k]) { d += Math.hypot(fr[j].a[k][0] - fr[j - 1].a[k][0], fr[j].a[k][2] - fr[j - 1].a[k][2]); T += dt; }
      }
      return T > 0 ? (d / T) * 100 : NaN;
    };
    // 손님이 속도 v로 걷는다: 위치는 시각 기준(탭 타이머가 느려도 정확한 속도). 10 Hz 자세로 방장에 전달됨
    const walk = (v) => B.ev((v) => { clearInterval(window.__w); const p = window.lab.player; p.pos.x = 3; p.pos.z = 6; p.yaw = -Math.PI / 2; const t0 = performance.now(); window.__w = setInterval(() => { p.pos.x = 3 + v * (performance.now() - t0) / 1000; }, 16); }, v);
    const stopWalk = () => B.ev(() => { clearInterval(window.__w); });

    // 앉기: 서서 가만히 있다가 앉으면 골반 0.45 m, 그동안 디딘 발은 안 움직인다 (몸 아래 발 고정 + 무릎은 IK가 굽힘)
    await A.wait(800);
    await B.ev(() => { window.lab.player.crouch = true; });
    const crouch = await collect(1800);
    const lastY = crouch.fr[crouch.fr.length - 1].py;
    t.near(lastY, 0.45, 0.05, `앉은 인형 골반 높이 (m) ${lastY.toFixed(3)}`);
    let drift = 0;
    for (let k = 0; k < 2; k++) for (const f of crouch.fr) drift = Math.max(drift, Math.hypot(f.a[k][0] - crouch.fr[0].a[k][0], f.a[k][2] - crouch.fr[0].a[k][2]));
    t.check(drift < 0.01, `앉는 동안 발목 수평 이동 최대 ${(drift * 100).toFixed(2)} cm (< 1)`);
    await B.ev(() => { window.lab.player.crouch = false; });
    await A.wait(1200);

    // 걷기 1.4 m/s: 발 미끄럼 · 역진자 골반 원호 · 걸음 빈도 · 두 발 디딤 구간
    await walk(1.4);
    await A.wait(1200);
    const w = await collect(3000);
    const vW = w.dist / w.dt;
    const s14 = slip(w.fr);
    t.check(Math.abs(vW - 1.4) < 0.3, `손님 이동 속도 ${vW.toFixed(2)} m/s (1.4)`);
    t.check(s14 < 2, `디딘 발 미끄럼 ${s14.toFixed(2)} cm/s (< 2, 10 Hz 자세, 1.4 m/s)`);
    const f14 = w.dc / w.dt;
    t.check(f14 > 0.95 && f14 < 1.4, `실제 화면 걸음 빈도 ${f14.toFixed(2)} Hz (헤드리스 속도 흔들림 감안 0.95 ~ 1.4; 정확한 값은 아래 60 Hz 시뮬)`);
    // 결정적 시뮬(60 Hz, 일정한 속도): 그려진 다리(IK 결과의 발목)로 역진자 골반 원호 · 두 발 디딤/뜬 구간 · 디딘 발 미끄럼.
    // 헤드리스 프레임이 12 FPS 안팎이라 실제 화면 표본은 걸음 단계가 뭉개진다 → 같은 모듈을 직접 60 Hz로 돌려 식과 비교한다
    const simGait = (v) => A.ev((v) => {
      const { THREE, motion } = window.lab;
      const st = motion.newMotion(); const dt = 1 / 60; let x = 3; let tt = 0; const fr = [];
      const Yq = (psi) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), psi);
      for (let i = 0; i < 420; i++) {
        x += v * dt; tt += dt;
        const o = motion.stepMotion(st, { x, z: 6, vx: v, vz: 0, headYaw: -Math.PI / 2, pitch: 0, c: 0, holding: false, reachAge: Infinity, reachPoint: null, t: tt }, dt);
        if (i < 120) continue;
        const psi = o.bodyYaw;
        const ank = [0, 1].map((k) => {
          const side = k ? 1 : -1;
          const hip = new THREE.Vector3(x + Math.cos(psi) * side * motion.HIP_X, o.pelvisY - motion.HIP_DROP, 6 - Math.sin(psi) * side * motion.HIP_X);
          const l = new THREE.Vector3(0, -motion.THIGH, 0).applyQuaternion(o.hip[k]).add(new THREE.Vector3(0, -motion.SHIN, 0).applyQuaternion(o.hip[k].clone().multiply(o.knee[k])));
          return { hip, a: hip.clone().add(l.applyQuaternion(Yq(psi))) };
        });
        fr.push({ py: o.pelvisY, st: [...o.stance], fl: o.flight, ank });
      }
      const cycles = st.cycles; let err = 0; let mn = 9; let mx = 0; let n = 0; let dbl = 0; let fly = 0; let sd = 0; let sT = 0;
      for (let j = 0; j < fr.length; j++) {
        const f = fr[j];
        if (f.fl) fly++;
        if (f.st[0] && f.st[1]) dbl++;
        if (j > 0) for (let k = 0; k < 2; k++) if (f.st[k] && fr[j - 1].st[k]) { sd += Math.hypot(f.ank[k].a.x - fr[j - 1].ank[k].a.x, f.ank[k].a.z - fr[j - 1].ank[k].a.z); sT += dt; }
        if (f.st[0] === f.st[1]) continue;
        const k = f.st[0] ? 0 : 1; const dx = f.ank[k].a.x - f.ank[k].hip.x; const dz = f.ank[k].a.z - f.ank[k].hip.z;
        err = Math.max(err, Math.abs(f.py - (Math.sqrt(0.784 * 0.784 - dx * dx - dz * dz) + f.ank[k].a.y + 0.06)));
        mn = Math.min(mn, f.py); mx = Math.max(mx, f.py); n++;
      }
      return { n, err, amp: mx - mn, dbl, fly, total: fr.length, slip: sT > 0 ? sd / sT : 0, cyc: cycles / (420 * dt), fr: motion.gaitParams(v).fr };
    }, v);
    const g14 = await simGait(1.4);
    t.check(Math.abs(g14.cyc - 1.18) < 0.05, `걸음 빈도 ${g14.cyc.toFixed(2)} Hz (식 0.55 + 0.45 v = 1.18 ± 0.05)`);
    t.check(g14.n > 100 && g14.err < 0.01, `걷기 1.4 m/s 단일 디딤 ${g14.n}프레임, 그려진 발목 기준 역진자 √(L²−x²)+0.13 오차 ${(g14.err * 100).toFixed(2)} cm (< 1)`);
    t.check(g14.amp > 0.03 && g14.amp < 0.08, `단일 디딤 골반 위아래 폭 ${(g14.amp * 100).toFixed(1)} cm (3 ~ 8; 이론 L(1−cos θ), 디딤 x ≤ 0.24 m)`);
    t.check(g14.dbl / g14.total > 0.15 && g14.fly === 0, `걷기(Fr ${g14.fr.toFixed(2)}): 두 발 디딤 ${(100 * g14.dbl / g14.total).toFixed(0)} % (이론 2β−1 = 20 %) · 뜬 구간 ${g14.fly}`);
    t.check(g14.slip < 0.02, `시뮬 디딘 발 미끄럼 ${(g14.slip * 100).toFixed(3)} cm/s (< 2)`);
    await stopWalk();
    await A.wait(1500);

    // 뛰기 2.2 m/s: 두 발 다 뜬 구간
    await walk(2.2);
    await A.wait(900);
    const r2 = await collect(2200);
    const vR = r2.dist / r2.dt;
        t.check(Math.abs(vR - 2.2) < 0.4, `뛰기 손님 이동 속도 ${vR.toFixed(2)} m/s (2.2)`);
    const g22 = await simGait(2.2);
    t.check(g22.fly > 10 && g22.dbl === 0, `뛰기(Fr ${g22.fr.toFixed(2)}): 두 발 뜬 ${(100 * g22.fly / g22.total).toFixed(0)} % (이론 1−2β = 20 %) · 두 발 디딤 ${g22.dbl}프레임`);
    t.check(slip(r2.fr) < 3, `뛰기 디딘 발 미끄럼 ${slip(r2.fr).toFixed(2)} cm/s (< 3)`);
    await stopWalk();
    await A.wait(2500);
    const still = await collect(400);
    t.check(still.fr.every((f) => f.st[0] && f.st[1]) && Math.abs(still.fr[0].py - stdY) < 0.02, `멈추고 1.5 s 뒤 두 발 디딤, 골반 ${still.fr[0].py.toFixed(3)} m`);

    // 몸 따라 돌기: 서 있을 때 고개만 40° → 몸 그대로, 90° → 1 s 뒤 몸이 따라와 차이 < 10°
    const yaws = () => A.ev(() => { const m = window.lab.avatars.motionOf('p1'); const g = window.lab.avatars.groupOf('p1'); return { body: m.bodyYaw, head: g.rotation.y }; });
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    const y0 = await yaws();
    await B.ev((y) => { window.lab.player.yaw = y; }, y0.body + 0.698);
    await A.wait(1000);
    const y40 = await yaws();
    t.check(Math.abs(wrap(y40.head - y0.body) - 0.698) < 0.05 && Math.abs(wrap(y40.body - y0.body)) < 0.05, `고개 40° → 1 s 뒤 몸 그대로 (몸 변화 ${(wrap(y40.body - y0.body) * 57.3).toFixed(1)}°, 고개 − 몸 ${(wrap(y40.head - y40.body) * 57.3).toFixed(1)}°)`);
    await B.ev((y) => { window.lab.player.yaw = y; }, y0.body + Math.PI / 2);
    await A.wait(2000);
    const y90 = await yaws();
    t.check(Math.abs(wrap(y90.head - y90.body)) < 0.1745, `고개 90° → 2 s 뒤 고개 − 몸 ${(wrap(y90.head - y90.body) * 57.3).toFixed(1)}° (< 10°)`);

    // 들기: 기구를 들면 오른손 anchor에 붙고, 손은 몸 앞 0.30 m · 가슴 아래 0.25 m (몸통 좌표 (0.12, 0.20, −0.30))
    await B.ev(() => { const { items, bus } = window.lab; const it = items.find((i) => i.name.startsWith('저항 47')); bus.dispatch({ t: 'act', by: bus.me, target: bus.registry.ref(it), label: '집기 · ' + it.name }); });
    await A.wait(1500);
    const held = await A.ev(() => {
      const { avatars, THREE } = window.lab; const r = avatars.rigOf('p1'); const it = avatars.heldBy('p1');
      if (!it) return null;
      const hand = avatars.handOf('p1'); const ip = it.object.getWorldPosition(new THREE.Vector3());
      const local = r.torso.worldToLocal(hand.clone());
      const up = new THREE.Vector3(0, 1, 0).transformDirection(it.object.matrixWorld);
      return { onAnchor: it.object.parent === r.anchor && r.anchor.parent === r.elbowR && r.elbowR.parent === r.shoulderR, dist: ip.distanceTo(hand), local: [local.x, local.y, local.z], up: up.y };
    });
    t.check(held && held.onAnchor, '든 기구가 오른손 anchor(오른팔 관절)에 붙음');
    t.check(held && held.dist < 0.01 && held.up > 0.99, `기구 위치 = 오른손끝 (차이 ${(held.dist * 100).toFixed(2)} cm), 똑바로 (위쪽 ${held.up.toFixed(3)})`);
    t.check(held && Math.abs(held.local[0] - 0.12) < 0.03 && Math.abs(held.local[1] - 0.2) < 0.03 && Math.abs(held.local[2] + 0.3) < 0.03, `든 손 위치 몸통 좌표 (${held.local.map((x) => x.toFixed(2)).join(', ')}) ≈ (0.12, 0.20, −0.30)`);
    // 놓기 → 손 뻗기는 실제 목표로
    await B.ev(() => { const { items, bus } = window.lab; const it = items.find((i) => i.name.startsWith('저항 47')); bus.dispatch({ t: 'place', by: bus.me, item: bus.registry.ref(it), p: [3.5, 0.85, 6.0] }); });
    await A.wait(2500);
    // 어깨에서 앞 0.5 m 되는 점으로 뻗기: 최고점(0.25 s 뒤 ~ 0.4 s)에서 손끝 − 목표 < 5 cm
    const reach = await A.ev(() => new Promise((res) => {
      const { avatars, THREE } = window.lab; const m = avatars.motionOf('p1');
      const S = avatars.jointOf('p1', 'shoulderR'); const psi = m.bodyYaw;
      const tgt = new THREE.Vector3(S.x - Math.sin(psi) * 0.5, S.y - 0.1, S.z - Math.cos(psi) * 0.5);
      const d0 = avatars.handOf('p1').distanceTo(tgt);
      avatars.reach('p1', tgt);
      let min = 9; let peak = 0; const t0 = performance.now();
      const tick = () => {
        const d = avatars.handOf('p1').distanceTo(tgt); min = Math.min(min, d); peak = Math.max(peak, m.out.reachK);
        if (performance.now() - t0 < 900) requestAnimationFrame(tick); else res({ d0, min, peak, end: avatars.handOf('p1').distanceTo(tgt) });
      };
      requestAnimationFrame(tick);
    }));
    t.check(reach.peak > 0.99 && reach.min < 0.05, `손 뻗기(남): 쉴 때 손–목표 ${(reach.d0 * 100).toFixed(0)} cm → 최고점 ${(reach.min * 100).toFixed(1)} cm (< 5), 0.9 s 뒤 ${(reach.end * 100).toFixed(0)} cm (돌아옴)`);

    // 고개: 손님이 위를 보면 머리가 위를 본다 (몸통 0.3 + 목 0.7)
    await B.ev(() => { window.lab.player.pitch = 0.5; });
    await A.wait(1500);
    const pitch = await A.ev(() => { const { avatars, THREE } = window.lab; const f = new THREE.Vector3(0, 0, -1).transformDirection(avatars.rigOf('p1').head.matrixWorld); return Math.asin(f.y); });
    t.near(pitch, 0.5, 0.1, '손님이 0.5 rad 위를 보면 인형 머리 시선 위아래 각 (rad)');

    // ---- 4) 비용: 아바타 하나 그리기 호출 ≤ 14, 셋이면 ≤ 45, avatars.update 시간 ----
    await B.ev(() => { const p = window.lab.player; p.pos.x = 3.5; p.pos.z = 3.6; p.yaw = Math.PI; p.pitch = 0; });
    await A.camera(3.5, 6.4, 0, 0);
    await A.wait(1500);
    const cost = await A.ev(() => {
      const { avatars, renderer, scene, camera } = window.lab;
      const count = (gs, v) => { renderer.info.reset(); for (const g of gs) g.visible = v; renderer.render(scene, camera); return renderer.info.render.calls; };
      const g1 = avatars.groupOf('p1');
      const one = count([g1], true) - count([g1], false); g1.visible = true;
      // 가짜 아바타 둘을 더 세워 셋으로 (시야 안)
      for (const [id, x] of [['t1', 3.0], ['t2', 4.0]]) { const inf = { id, name: id, color: id === 't1' ? 0xc0504d : 0x4f81bd }; avatars.ensure(inf); avatars.setPose(inf, { x, y: 0, z: 3.9, yaw: 0.3 }); }
      avatars.update(0.016, camera);
      const gs = ['p1', 't1', 't2'].map((id) => avatars.groupOf(id));
      const three = count(gs, true) - count(gs, false); for (const g of gs) g.visible = true;
      let ms = 0; const N = 150;
      for (let i = 0; i < N; i++) { const t0 = performance.now(); avatars.update(0.016, camera); ms += performance.now() - t0; }
      avatars.remove('t1'); avatars.remove('t2');
      return { one, three, ms: ms / N };
    });
    t.check(cost.one > 5 && cost.one <= 14, `아바타 하나 그리기 호출 ${cost.one} (5 < n ≤ 14: 마디 13 + 이름표)`);
    t.check(cost.three <= 45, `아바타 셋 그리기 호출 ${cost.three} (≤ 45)`);
    t.check(cost.ms <= 0.3, `avatars.update 아바타 3개 ${cost.ms.toFixed(3)} ms/프레임 (≤ 0.3)`);
    t.check(t.errors.length === 0, `페이지 오류 없음${t.errors.length ? ': ' + t.errors[0].slice(0, 120) : ''}`);
    await B.end();
  },
};
