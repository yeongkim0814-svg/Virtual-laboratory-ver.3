// 손님 화면의 손 뻗기(applyRemote도 리스너를 부름) · 미세 조정 모션(keep) · 터치 피드백(물결·고리·진동)
module.exports = {
  name: '손님 손 뻗기 · 미세 조정 모션 · 터치 피드백',
  async run(t) {
    const A = t;
    await A.clearBench();
    const B = await A.newPeer();
    const code = await A.ev(() => window.lab.session.host(new window.lab.LocalTransport(), '방장'));
    await B.ev((c) => window.lab.session.join(new window.lab.LocalTransport(), c, '손님'), code);
    await A.wait(400);
    const R = '저항 47';
    const pick = (T) => T.ev((R) => { const { items, bus } = window.lab; const it = items.find((i) => i.name.startsWith(R)); bus.dispatch({ t: 'act', by: bus.me, target: bus.registry.ref(it), label: '집기 · ' + it.name }); }, R);
    // reachK 표본: 시간표에서 바로 계산하는 getter를 10 ms마다 읽는다 (헤드리스는 프레임이 느려 rAF 표본은 봉우리를 놓침)
    const sampleAvatar = (T, ms) => T.ev((ms) => new Promise((res) => {
      const out = []; const t0 = performance.now();
      const h = setInterval(() => { out.push({ t: performance.now() - t0, k: window.lab.avatars.reachK('p0') }); if (performance.now() - t0 > ms) { clearInterval(h); res(out); } }, 10);
    }), ms);

    // ---- 1: 방장이 집으면 손님 화면의 방장 아바타가 손을 뻗음 ----
    const s1 = sampleAvatar(B, 1200);
    await A.wait(100);
    await pick(A);
    const o1 = await s1;
    const max1 = Math.max(...o1.map((o) => o.k));
    t.check(max1 > 0.9, `손님 화면: 방장 아바타 reachK 최대 ${max1.toFixed(2)} (> 0.9)`);

    // ---- 1b: 손님이 집으면 손님 자신의 1인칭 손이 뻗음 (방장이 순서를 정해 돌려준 명령을 applyRemote로 실행할 때) ----
    const spot = [3.5, 0.85, 6.0];
    const place = (T) => T.ev((p) => { const { items, bus } = window.lab; const it = items.find((i) => i.name.startsWith('저항 47')); bus.dispatch({ t: 'place', by: bus.me, item: bus.registry.ref(it), p }); }, spot);
    await place(A);
    await A.wait(900);
    // 헤드리스는 프레임이 느려 0.35 s짜리 동작을 표본으로 잡기 어렵다 → fpHands.reach 호출을 가로채 센다 (고친 곳: 손님도 리스너를 부름)
    await B.ev(() => { const h = window.lab.fpHands; window.__reach = []; const o = h.reach.bind(h); h.reach = (p, sp, k) => { window.__reach.push({ sp, hasPoint: !!p, k: !!k }); return o(p, sp, k); }; });
    await pick(B);
    await B.wait(700);
    const rc = await B.ev(() => window.__reach);
    t.check(rc.length === 1 && rc[0].sp === 2 && rc[0].hasPoint, `손님 자신의 1인칭 손: 집기 한 번에 reach 호출 ${rc.length}회 (빠른 시간표 ×${rc[0] && rc[0].sp}, 목표점 있음)`);
    await B.wait(500);
    await place(B);
    await B.wait(900);

    // ---- 2: 미세 조정 (60 ms 간격) → 뻗은 채 유지, 끝나면 돌아옴 ----
    // (a) 끝에서 끝: 방장이 5번 미세 조정 → 손님 화면의 방장 아바타가 뻗었다가, 마지막 호출 1 s 안에 돌아옴
    const s2 = sampleAvatar(B, 2500);
    await A.wait(150);
    await A.ev(async () => {
      const { items, bus } = window.lab; const it = items.find((i) => i.name.startsWith('저항 47'));
      for (let i = 0; i < 5; i++) { bus.call(it, 'nudge', 0.001, 0); await new Promise((r) => setTimeout(r, 60)); }
    });
    const o2 = await s2;
    const max2 = Math.max(...o2.map((o) => o.k));
    const upAt = o2.find((o) => o.k > 0.9);
    const lastUp = [...o2].reverse().find((o) => o.k > 0.5);
    const endK = o2[o2.length - 1].k;
    t.check(max2 > 0.9, `미세 조정: 손님 화면 방장 아바타 reachK 최대 ${max2.toFixed(2)} (> 0.9)`);
    t.check(lastUp && o2[o2.length - 1].t - lastUp.t > 300 && endK < 0.01, `끝나면 돌아옴 (뻗음 ${upAt && upAt.t.toFixed(0)}~${lastUp && lastUp.t.toFixed(0)} ms, 마지막 reachK ${endK.toFixed(2)})`);
    // (b) keep 동작 확인: 가짜 시계로 60 ms 간격 12번 호출 — 호출 사이 reachK가 0.8 아래로 안 내려가고, keep 없이는 내려감 (프레임 속도와 무관)
    const keepTest = (keep) => A.ev((keep) => {
      const real = performance.now.bind(performance); let now = real();
      performance.now = () => now;
      try {
        const { fpHands, avatars, THREE } = window.lab; const P = new THREE.Vector3(3.5, 0.9, 6);
        const tick = () => { now += 10; };
        fpHands.reach(P, 2); avatars.reach('p1', P, 2);
        let minF = 9, minA = 9;
        for (let i = 0; i < 13; i++) {
          for (let k = 0; k < 6; k++) { tick(); if (i > 0) { minF = Math.min(minF, fpHands.reachK()); minA = Math.min(minA, avatars.reachK('p1')); } }
          fpHands.reach(P, 2, keep); avatars.reach('p1', P, 2, keep);
        }
        // 마지막 호출 뒤 1 s 안에 0으로
        let endF = 9, endA = 9;
        for (let k = 0; k < 100; k++) tick();
        endF = fpHands.reachK(); endA = avatars.reachK('p1');
        return { minF, minA, endF, endA };
      } finally { performance.now = real; }
    }, keep);
    const kp = await keepTest(true);
    const nk = await keepTest(false);
    t.check(kp.minF >= 0.8 && kp.minA >= 0.8, `keep: 60 ms 간격 12회 동안 reachK 최소 내 손 ${kp.minF.toFixed(2)} · 아바타 ${kp.minA.toFixed(2)} (≥ 0.8)`);
    t.check(nk.minF < 0.5 && nk.minA < 0.5, `keep 없이는 매번 처음부터라 내려감 (최소 ${nk.minF.toFixed(2)} · ${nk.minA.toFixed(2)})`);
    t.check(kp.endF === 0 && kp.endA === 0, `마지막 호출 1 s 뒤 0으로 돌아옴 (${kp.endF} · ${kp.endA})`);

    // ---- 4: 터치 피드백 (방장 탭에서) ----
    await A.ev(() => { window.__vib = []; navigator.vibrate = (p) => { window.__vib.push(p); return true; }; });
    await A.page.tap('#btn-crouch');
    await A.wait(100);
    let vib = await A.ev(() => window.__vib.slice());
    t.check(vib.includes(25), `앉기 버튼 누름 → 진동 25 (${JSON.stringify(vib)})`);
    await A.ev(() => { window.lab.player.crouch = false; });
    await A.page.tap('#btn-crouch'); await A.wait(100); await A.ev(() => { window.lab.player.crouch = false; });
    await A.camera(9.0, 6.2, Math.PI / 2, 0);
    const st = await A.ev(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const pt = { x: Math.round(st.x + st.w * 0.7), y: Math.round(st.y + st.h * 0.2) }; // 벽 쪽 빈 곳 (조이스틱 영역 밖)
    await A.page.touchscreen.tap(pt.x, pt.y);
    await A.wait(60);
    const rip = await A.ev(() => { const e = document.querySelector('#hud .tap-ripple'); if (!e) return null; const r = e.getBoundingClientRect(); return { n: document.querySelectorAll('#hud .tap-ripple').length, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; });
    t.check(!!rip, '탭 직후 .tap-ripple 생김');
    t.check(rip && Math.hypot(rip.cx - pt.x, rip.cy - pt.y) < 3, `물결 중심이 탭 자리 (오차 ${rip ? Math.hypot(rip.cx - pt.x, rip.cy - pt.y).toFixed(1) : '-'} px)`);
    await A.wait(500);
    t.check((await A.ev(() => document.querySelectorAll('#hud .tap-ripple').length)) === 0, '500 ms 뒤 물결이 사라짐');

    // 두 번 탭 → 고리 2개
    await A.page.touchscreen.tap(pt.x, pt.y);
    await A.wait(90);
    await A.page.touchscreen.tap(pt.x, pt.y);
    await A.wait(30);
    const nDbl = await A.ev(() => document.querySelectorAll('#hud .tap-ripple').length);
    t.check(nDbl >= 2, `두 번 탭: 고리 ${nDbl}개 이상`);
    await A.wait(900);

    // 길게 누르기 진행 고리
    const cdp = await A.page.context().newCDPSession(A.page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y, id: 1 }] });
    await A.wait(300);
    const ringOn = await A.ev(() => { const e = document.querySelector('#hud .hold-ring'); return !!e && e.classList.contains('on') && getComputedStyle(e).display !== 'none'; });
    t.check(ringOn, '길게 누르는 중(0.3 s) 진행 고리가 보임');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await A.wait(900);
    t.check(!(await A.ev(() => document.querySelector('#hud .hold-ring').classList.contains('on'))), '손을 떼면 진행 고리가 사라짐');
    // 움직이면 취소
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y, id: 1 }] });
    await A.wait(250);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pt.x + 40, y: pt.y, id: 1 }] });
    await A.wait(80);
    t.check(!(await A.ev(() => document.querySelector('#hud .hold-ring').classList.contains('on'))), '손가락이 움직이면 진행 고리 취소');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await A.wait(300);

    // 거부된 명령 → [20,40,20] + 붉은 고리 (직전 탭 자리)
    await A.ev(() => { window.__vib.length = 0; });
    await A.page.touchscreen.tap(pt.x, pt.y);
    await A.ev(() => { const { items, bus } = window.lab; const it = items[0]; bus.dispatch({ t: 'act', by: bus.me, target: bus.registry.ref(it), label: '없는 동작' }); });
    vib = await A.ev(() => window.__vib.slice());
    t.check(vib.some((p) => Array.isArray(p) && p.join() === '50,60,50'), `거부된 명령 → 진동 [50,60,50] (${JSON.stringify(vib)})`);
    t.check((await A.ev(() => document.querySelectorAll('#hud .tap-ripple.bad').length)) === 1, '붉은 고리 표시');
    await A.wait(500);
    // 성공한 명령 → 10, 집기 → 15
    await A.ev(() => { window.__vib.length = 0; });
    await pick(A);
    vib = await A.ev(() => window.__vib.slice());
    t.check(vib.includes(40), `집기 성공 → 진동 40 (${JSON.stringify(vib)})`);

    // 설정: 진동 끄기 → 앉기 눌러도 진동 없음
    await A.ev(() => { const c = document.getElementById('set-haptics'); c.checked = false; c.dispatchEvent(new Event('change')); window.__vib.length = 0; });
    await A.page.tap('#btn-crouch');
    await A.wait(100);
    t.check((await A.ev(() => window.__vib.length)) === 0, '진동 피드백 끄면 진동 없음');
    await A.ev(() => { window.lab.player.crouch = false; const c = document.getElementById('set-marks'); c.checked = false; c.dispatchEvent(new Event('change')); });
    await A.page.touchscreen.tap(pt.x, pt.y);
    await A.wait(60);
    t.check((await A.ev(() => document.querySelectorAll('#hud .tap-ripple').length)) === 0, '터치 표시 끄면 물결 없음');
    await A.ev(() => { for (const id of ['set-haptics', 'set-marks']) { const c = document.getElementById(id); c.checked = true; c.dispatchEvent(new Event('change')); } });

    await B.end();
    t.check(t.errors.length === 0, `페이지 오류 없음${t.errors.length ? ': ' + t.errors[0].slice(0, 120) : ''}`);
  },
};
