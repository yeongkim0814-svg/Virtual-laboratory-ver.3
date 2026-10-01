// 멀티플레이어 (같은 브라우저 탭 3개, BroadcastChannel): 방 만들기·들어가기, 아바타, 명령 복제, 동시 집기 충돌,
// 도중 입장(스냅숏), 상태 요약(digest)·재동기화, 나가기, 다른 사람의 되돌리기
module.exports = {
  name: '멀티플레이어 (방장 · 명령 복제 · 스냅숏)',
  async run(t) {
    const A = t; // 방장
    await A.clearBench();
    const B = await A.newPeer();

    // ---- 1) 방 만들기 · 들어가기
    const code = await A.ev(() => window.lab.session.host(new window.lab.LocalTransport(), '방장'));
    t.check(/^[A-Z0-9]{4}$/.test(code), `방 코드 4글자: ${code}`);
    await B.ev((code) => window.lab.session.join(new window.lab.LocalTransport(), code, '손님'), code);
    await A.wait(300);
    const roster = (T) => T.ev(() => [...window.lab.session.players.values()].map((p) => `${p.id}:${p.name}`).join(','));
    t.check((await roster(A)) === 'p0:방장,p1:손님', `방장 쪽 참가자 목록: ${await roster(A)}`);
    t.check((await roster(B)) === 'p0:방장,p1:손님', '손님 쪽 참가자 목록');
    t.check(await B.ev(() => window.lab.session.role === 'client' && window.lab.bus.me === 'p1' && !!window.lab.bus.router), '손님: 역할·id·명령 보내기 경로');

    // ---- 2) 아바타 (육면체) 와 자세
    await B.ev(() => { const { player } = window.lab; player.pos.x = 9.0; player.pos.z = 6.0; player.yaw = 0.5; });
    await A.ev(() => { const { player } = window.lab; player.pos.x = 5.0; player.pos.z = 6.0; player.yaw = -0.4; });
    await A.wait(2500); // 보조 탭은 타이머가 느려질 수 있어 넉넉히
    const av = (T, id) => T.ev((id) => {
      const g = window.lab.avatars.groupOf(id);
      return g && { x: g.position.x, z: g.position.z, yaw: g.rotation.y, vis: g.visible, boxes: (() => { let n = 0; g.traverse((o) => { if (o.isMesh && !o.userData.nameTag) n++; }); return n; })(), noPick: !!g.userData.noPick };
    }, id);
    const a1 = await av(A, 'p1');
    const b0 = await av(B, 'p0');
    t.check(a1 && a1.vis && a1.boxes === 10 && a1.noPick, '방장 화면에 손님 아바타: 상자 인형(몸 상자 10개), 광선 판정 제외');
    t.near(a1.x, 9.0, 0.05, '손님 아바타 x'); t.near(a1.z, 6.0, 0.05, '손님 아바타 z'); t.near(a1.yaw, 0.5, 0.05, '손님 아바타 방향');
    t.check(b0 && b0.vis, '손님 화면에 방장 아바타');
    t.near(b0.x, 5.0, 0.05, '방장 아바타 x');

    // ---- 3) 명령 복제: 손님이 집고 → 놓기
    const lens = '볼록 렌즈 (f = +10';
    const where = (T, name) => T.ev((name) => {
      const { items, holdings, bus } = window.lab;
      const it = items.find((i) => i.name.startsWith(name));
      const w = it.object.getWorldPosition(new window.lab.THREE.Vector3());
      return { holder: holdings.holderOf(it), onScene: it.object.parent === window.lab.scene, x: +w.x.toFixed(6), y: +w.y.toFixed(6), z: +w.z.toFixed(6), me: bus.me };
    }, name);
    const pick = (T, name) => T.ev((name) => {
      const { items, bus } = window.lab;
      const it = items.find((i) => i.name.startsWith(name));
      return bus.dispatch({ t: 'act', by: bus.me, target: bus.registry.ref(it), label: '집기 · ' + it.name });
    }, name);
    await pick(B, lens);
    await A.wait(300);
    t.check((await where(A, lens)).holder === 'p1', '손님이 집음 → 방장 화면: p1이 들고 있음');
    t.check((await where(B, lens)).holder === 'p1', '손님 화면: 내가 들고 있음');
    t.check(await A.ev(() => !!window.lab.avatars.heldBy('p1')), '방장 화면: 아바타 손에 기구');
    await B.ev((n) => {
      const { items, bus } = window.lab;
      const it = items.find((i) => i.name.startsWith(n));
      bus.dispatch({ t: 'place', by: bus.me, item: bus.registry.ref(it), p: [9.2, 0.85, 3.1] });
    }, lens);
    await A.wait(300);
    const pa = await where(A, lens); const pb = await where(B, lens);
    t.check(!pa.holder && pa.onScene && !pb.holder, '놓기 → 둘 다 장면 위');
    t.near(Math.hypot(pa.x - 9.2, pa.z - 3.1), 0, 1e-9, '방장 화면 위치');
    t.near(Math.hypot(pb.x - 9.2, pb.z - 3.1), 0, 1e-9, '손님 화면 위치 (명령 복제)');

    // ---- 4) 동시 집기: 정확히 한 사람만
    const target = '레이저';
    const both = await Promise.all([A.ev((n) => {
      const { items, bus } = window.lab; const it = items.find((i) => i.name.startsWith(n));
      return bus.dispatch({ t: 'act', by: bus.me, target: bus.registry.ref(it), label: '집기 · ' + it.name });
    }, target), B.ev((n) => {
      const { items, bus } = window.lab; const it = items.find((i) => i.name.startsWith(n));
      return bus.dispatch({ t: 'act', by: bus.me, target: bus.registry.ref(it), label: '집기 · ' + it.name });
    }, target)]);
    await A.wait(500);
    const la = await where(A, target); const lb = await where(B, target);
    t.check(!!la.holder && la.holder === lb.holder, `동시에 집어도 한 사람만 (${la.holder}), 두 화면이 같음`);
    // 든 사람이 놓는다 (다음 시험을 위해)
    const holderT = la.holder === 'p0' ? A : B;
    await holderT.ev((n) => {
      const { items, bus } = window.lab; const it = items.find((i) => i.name.startsWith(n));
      bus.dispatch({ t: 'place', by: bus.me, item: bus.registry.ref(it), p: [9.5, 0.85, 3.6] });
    }, target);
    await A.wait(300);
    // 남이 든 것은 집을 수 없다
    await pick(B, '추 50 g');
    await A.wait(300);
    const stolen = await A.ev(() => {
      const { items, bus } = window.lab; const it = items.find((i) => i.name.startsWith('추 50 g'));
      return bus.dispatch({ t: 'act', by: 'p0', target: bus.registry.ref(it), label: '집기 · ' + it.name });
    });
    t.check(stolen === false, '남이 든 기구는 집을 수 없음 (거절)');

    // ---- 5) 도선·전원·문·칠판·따르기가 복제된다
    // 저항·전원 장치를 명령(집기 → 놓기)으로 실험대에 옮긴 뒤 도선을 잇는다
    const carry = (T, name, p) => T.ev(([name, p]) => {
      const { items, bus } = window.lab; const it = items.find((i) => i.name.startsWith(name)); const R = bus.registry.ref(it);
      bus.dispatch({ t: 'act', by: bus.me, target: R, label: '집기 · ' + it.name });
      return R;
    }, [name, p]);
    await carry(A, '저항 47', [8.6, 0.85, 2.2]);
    await A.wait(300);
    await A.ev(() => { const { items, bus } = window.lab; const it = items.find((i) => i.name.startsWith('저항 47')); bus.dispatch({ t: 'place', by: 'p0', item: bus.registry.ref(it), p: [8.6, 0.85, 2.2] }); });
    await carry(A, '직류 전원', [8.9, 0.85, 2.0]);
    await A.wait(300);
    await A.ev(() => { const { items, bus } = window.lab; const it = items.find((i) => i.name.startsWith('직류 전원')); bus.dispatch({ t: 'place', by: 'p0', item: bus.registry.ref(it), p: [8.9, 0.85, 2.0] }); });
    await A.ev(() => {
      const { items, bus } = window.lab; const R = (o) => bus.registry.ref(o);
      const r = items.find((i) => i.name.startsWith('저항 47')); const s = items.find((i) => i.name.startsWith('직류 전원'));
      bus.dispatch({ t: 'wire', by: 'p0', a: R(r) + '/t0', b: R(s) + '/t0' });
    });
    await B.ev(() => {
      const { items, bus } = window.lab; const L = items.find((i) => i.name.startsWith('레이저'));
      bus.dispatch({ t: 'act', by: bus.me, target: bus.registry.ref(window.lab.doors[0]), label: window.lab.doors[0].actions()[0].label });
    });
    await A.ev(() => {
      const { bus, wasteCans } = window.lab; const board = window.lab.sync.d.boards[0];
      bus.dispatch({ t: 'call', by: 'p0', target: bus.registry.ref(board), method: 'addStroke', args: ['white', 0.01, [0.1, 0.1, 0.3, 0.3]] });
      const src = window.lab.items.find((i) => i.name.startsWith('0.1 M 염산')), dst = window.lab.items.find((i) => i.name.startsWith('비커 1'));
      bus.dispatch({ t: 'pour', by: 'p0', src: bus.registry.ref(src), dst: bus.registry.ref(dst), mL: 10 });
    });
    await A.wait(600);
    const facts = (T) => T.ev(() => {
      const { wires, items, bus } = window.lab; const b = items.find((i) => i.name.startsWith('비커 1'));
      return { wires: wires.wires.length, beaker: +(b.solution.V * 1000).toFixed(6), board: window.lab.sync.d.boards[0].version };
    });
    const fa = await facts(A); const fb = await facts(B);
    t.check(fa.wires === 1 && fb.wires === 1, '도선이 두 화면에 1개씩');
    t.near(fb.beaker, 10, 1e-6, '손님 화면의 비커 부피 (따르기 10 mL 복제)');
    t.check(fa.board === 1 && fb.board === 1, '칠판 획이 두 화면에 (version 1)');
    const doorsOpen = (T) => T.ev(() => window.lab.sync.d.doors.map((d) => (d.isOpen ? 1 : 0)).join(''));
    t.check((await doorsOpen(A)) === (await doorsOpen(B)) && (await doorsOpen(A)).includes('1'), `문 상태가 같음 (열린 문 ${(await doorsOpen(A)).split('1').length - 1}개)`);

    // ---- 6) 요약(digest)이 같다
    const dg = (T) => T.ev(() => window.lab.sync.digest());
    const same = (await dg(A)) === (await dg(B));
    if (!same) {
      const [da, db] = await Promise.all([A, B].map((T) => T.ev(() => JSON.stringify(window.lab.sync.describe()))));
      const pa = JSON.parse(da), pb = JSON.parse(db);
      pa.forEach((row, i) => { if (JSON.stringify(row) !== JSON.stringify(pb[i])) console.log('   다른 줄', i, JSON.stringify(row).slice(0, 160), '≠', JSON.stringify(pb[i]).slice(0, 160)); });
    }
    t.check(same, `digest 일치: ${await dg(A)}`);

    // ---- 7) 도중 입장: 세 번째 탭은 스냅숏으로 따라잡는다
    const C = await A.newPeer();
    await C.ev((code) => window.lab.session.join(new window.lab.LocalTransport(), code, '셋째'), code);
    await C.wait(800);
    t.check((await dg(C)) === (await dg(A)), '도중 입장: 스냅숏 후 digest 일치');
    const fc = await facts(C);
    t.check(fc.wires === 1 && Math.abs(fc.beaker - 10) < 1e-6, '도중 입장: 도선 1개 · 비커 10 mL');
    const lensC = await where(C, lens);
    t.near(Math.hypot(lensC.x - 9.2, lensC.z - 3.1), 0, 1e-9, '도중 입장: 렌즈 위치');
    t.check((await roster(C)).split(',').length === 3, '세 명');
    await A.wait(500);
    t.check((await A.ev(() => window.lab.avatars.count)) === 2, '방장 화면에 아바타 2개');
    // 들고 있던 기구도 넘어온다 (B가 든 추 50 g)
    t.check((await where(C, '추 50 g')).holder === 'p1', '도중 입장: B가 든 추를 C 화면에서도 B가 들고 있음');

    // ---- 8) 어긋나면 스냅숏을 다시 받는다 (손님 화면만 몰래 바꿈 → 2초 안팎에 digest 일치)
    await B.ev(() => {
      const it = window.lab.items.find((i) => i.name.startsWith('볼록 렌즈 (f = +10'));
      it.object.position.x += 0.05; it.object.updateMatrixWorld(true);
    });
    t.check((await dg(A)) !== (await dg(B)), '(일부러 어긋남) digest 다름');
    let ok = false;
    for (let i = 0; i < 12 && !ok; i++) { await A.wait(500); ok = (await dg(A)) === (await dg(B)); }
    t.check(ok, '재동기화: 스냅숏을 다시 받아 digest 일치');
    const back = await where(B, lens);
    t.near(Math.hypot(back.x - 9.2, back.z - 3.1), 0, 1e-9, '재동기화: 렌즈가 방장 자리로');

    // ---- 9) 다른 사람의 되돌리기: B가 렌즈를 옮기고 B가 되돌린다 → 모두 원래대로
    await B.ev((n) => {
      const { items, bus } = window.lab; const it = items.find((i) => i.name.startsWith(n));
      bus.call(it, 'nudge', 0.01, 0);
    }, lens);
    await A.wait(300);
    t.near((await where(A, lens)).x, 9.21, 1e-9, 'B의 이동 1 cm가 방장 화면에 반영');
    await B.ev(() => window.lab.bus.dispatch({ t: 'undo', by: window.lab.bus.me }));
    await A.wait(300);
    t.near((await where(A, lens)).x, 9.2, 1e-9, 'B의 되돌리기 → 방장 화면 원래 자리');
    t.near((await where(C, lens)).x, 9.2, 1e-9, 'B의 되돌리기 → 셋째 화면도 원래 자리');

    // ---- 10) 나가기: 든 기구는 서 있던 곳 아래에 내려지고 아바타는 사라진다
    await B.ev(() => window.lab.session.leave());
    await A.wait(500);
    const w = await where(A, '추 50 g');
    t.check(!w.holder && w.onScene, '나간 사람이 들던 기구는 장면에 내려짐');
    t.check((await roster(A)) === 'p0:방장,p2:셋째' || (await roster(A)).split(',').length === 2, `방장 목록: ${await roster(A)}`);
    t.check((await A.ev(() => window.lab.avatars.count)) === 1, '아바타 1개로 줄어듦');
    t.check(await B.ev(() => window.lab.session.role === 'solo' && window.lab.bus.me === 'p0' && !window.lab.bus.router), '나간 탭은 혼자 모드로 복귀');
    await C.ev(() => window.lab.session.leave());
    await A.ev(() => window.lab.session.leave());
    await B.end();
    await C.end();
  },
};
