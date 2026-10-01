// 기하광학: 스넬 법칙, 전반사, 프리즘 분산, 렌즈 상, 마이컬슨 무늬
const SETUP = `
  const { scene, items, stock, power, THREE } = window.lab;
  const find = (n) => items.find((i) => i.name.startsWith(n));
  const put = (it, x, z, yaw = 0) => { if (it.attachedTo) it.attachedTo.detach(it); it.object.removeFromParent(); it.object.position.set(x, 0.85, z); it.object.rotation.set(0, yaw, 0); it.yaw = yaw; scene.add(it.object); it.object.updateMatrixWorld(true); };
  const aim = (it, from, to) => { const d = to.clone().sub(from); put(it, from.x, from.z, Math.atan2(-d.z, d.x)); if ('on' in it) { const sp = it.cordLength; const free = power.outlets.flatMap((o) => o.ports).filter((p) => !p.device).sort((a, b) => a.worldPosition().distanceTo(it.object.position) - b.worldPosition().distanceTo(it.object.position))[0]; if (!it.port || (it.port && it.port.worldPosition().distanceTo(it.object.position) > sp)) power.plug(it, free); it.on = true; } };
`;
module.exports = {
  name: '기하광학 (스넬 · 분산 · 렌즈 · 마이컬슨)',
  async run(t) {
    await t.clearBench();
    const ev = (body) => t.ev(`(() => { ${SETUP} ${body} })()`);
    // 광선 기록 (켜진 광원이 아직 계산 전이면 잠깐 기다렸다가 다시 읽는다)
    const trace = async (who) => {
      for (let i = 0; i < 6; i++) {
        const r = await t.ev((who) => {
          const { stock, beams } = window.lab; const s = who === 'laser' ? stock.lasers[0] : stock.lightBoxes[0];
          const tr = beams.traces.get(s); return tr ? { ev: tr.events.filter((e) => e.p > 0.02), exits: tr.exits, interf: tr.interference, image: tr.image } : null;
        }, who);
        if (r) return r;
        await t.wait(300);
      }
      throw new Error(who + ' 광선 기록 없음 (광원이 꺼져 있거나 손에 들려 있음?)');
    };
    // 1) 반원 블록: 곡면으로 가운데를 향해 30° → 굴절 19.6°
    await ev(`
      const C = new THREE.Vector3(9.0, 0.85, 3.0); const disc = find('광학 원판'); put(disc, C.x, C.z);
      const hd = find('반원형'); if (hd.attachedTo) hd.attachedTo.detach(hd); hd.object.removeFromParent(); disc.seat.attach(hd, hd.plugs[0]);
      const L = stock.lasers[0]; const a = 30 * Math.PI / 180; const d = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
      aim(L, C.clone().addScaledVector(d, -0.3), C); if (!L.port) power.plug(L); L.on = true;`);
    await t.wait(700);
    let r = await trace('laser');
    const enter = r.ev.find((e) => e.kind.startsWith('굴절 (들어감)'));
    t.near(enter.outDeg, 19.63, 0.1, '아크릴 30° → 굴절각');
    t.near(Math.sin(30 * Math.PI / 180) / Math.sin(enter.outDeg * Math.PI / 180), 1.49, 0.01, '굴절률 n = sin i / sin r');
    // 2) 유리 → 공기: 45°는 전반사, 38°는 나감
    const inside = (deg) => ev(`
      const C = new THREE.Vector3(9.0, 0.85, 3.0); const L = stock.lasers[0]; const a = ${deg} * Math.PI / 180;
      aim(L, C.clone().add(new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)).multiplyScalar(0.3)), C); L.on = true;`);
    await inside(45); await t.wait(700);
    r = await trace('laser');
    t.check(r.ev.some((e) => e.kind === '전반사'), '곡면 쪽 45° (임계각 42.2° 초과): 전반사');
    await inside(38); await t.wait(700);
    r = await trace('laser');
    t.check(!r.ev.some((e) => e.kind === '전반사'), '38°는 전반사 아님');
    // 3) 백색광 + 프리즘: 보라가 더 꺾임
    await ev(`
      const P = new THREE.Vector3(9.5, 0.85, 3.0); const disc = find('광학 원판'); put(disc, P.x, P.z);
      const hd = find('반원형'); put(hd, 7.0, 2.0);
      const pr = find('삼각 프리즘'); if (pr.attachedTo) pr.attachedTo.detach(pr); pr.object.removeFromParent(); disc.seat.attach(pr, pr.plugs[0]);
      stock.lasers[0].on = false;
      const nIn = new THREE.Vector3(Math.cos(120 * Math.PI / 180), 0, -Math.sin(120 * Math.PI / 180));
      const dirIn = nIn.clone().negate().applyAxisAngle(new THREE.Vector3(0, 1, 0), -50 * Math.PI / 180);
      const W = stock.lightBoxes[0]; aim(W, P.clone().addScaledVector(dirIn, -0.3), P); if (!W.port) power.plug(W); W.on = true; W.setMode('single');`);
    await t.wait(800);
    r = await trace('white');
    const dev = (nm) => r.exits.find((x) => x.nm === nm && x.dev > 1 && x.dev < 170)?.dev;
    t.check(dev(400) > dev(550) && dev(550) > dev(700), `분산: 400 nm ${dev(400)?.toFixed(1)}° > 550 nm ${dev(550)?.toFixed(1)}° > 700 nm ${dev(700)?.toFixed(1)}°`);
    t.near(dev(550), 48.94, 0.3, '550 nm 프리즘 꺾인 각');
    // 4) 볼록 렌즈 f = 10 cm, 물체 20 cm → 스크린 20 cm에서 배율 −1
    await ev(`
      for (const it of items) { const o = it.object; if (o.parent === scene && Math.abs(o.position.x - 9.5) < 1.2 && Math.abs(o.position.z - 3) < 1.2 && !it.name.includes('백색') && !it.name.includes('레이저')) o.position.x += 3; }
      const W = stock.lightBoxes[0]; put(W, 8.6, 3.0, 0); W.setMode('arrow');
      put(find('볼록 렌즈 (f = +10'), 8.6 + 0.085 + 0.2, 3.0, 0); put(find('스크린'), 8.6 + 0.085 + 0.4, 3.0, Math.PI);`);
    await t.wait(800);
    r = await trace('white');
    t.near(r.image.sImg, 0.2, 0.002, '상 거리 b = 1/(1/f − 1/a) (m)');
    t.near(r.image.m, -1, 0.01, '배율 −b/a');
    // 5) 마이컬슨: 두 팔의 빛이 스크린에서 간섭, 거울 이동에 따라 가운데 밝기가 λ/2 주기
    await ev(`
      for (const it of items) { const o = it.object; if (o.parent === scene && Math.abs(o.position.x - 9) < 1.2 && Math.abs(o.position.z - 3) < 1.2 && !it.name.includes('레이저')) o.position.x += 3; }
      const B = new THREE.Vector3(9.0, 0.85, 3.0); stock.lightBoxes[0].on = false;
      put(find('반투명'), B.x, B.z, Math.PI / 4); put(find('평면거울 1'), B.x + 0.15, B.z, Math.PI); put(find('평면거울 2'), B.x, B.z + 0.15, Math.PI / 2);
      const L = stock.lasers[0]; put(L, B.x - 0.45, B.z, 0); L.on = true; L.setWavelength(650);
      put(find('스크린'), B.x, B.z - 0.4, -Math.PI / 2); find('평면거울 2').setFine(0.03, 0);`);
    await t.wait(900);
    r = await trace('laser');
    t.check(!!r.interf, '두 팔의 빛이 스크린에서 간섭');
    const centers = [];
    for (let k = 0; k <= 4; k++) {
      await t.ev((k) => { const m = window.lab.items.find((i) => i.name.startsWith('평면거울 2')); m.setFine(0, k * 0.325 / 4); }, k);
      await t.wait(450);
      centers.push(await t.ev(() => { const d = window.lab.beams.interf.find((x) => x.mesh.visible); return d ? d.ctx.getImageData(d.N / 2, d.N / 2, 1, 1).data[0] : -1; }));
    }
    // 0, λ/8, λ/4, 3λ/8, λ/2 이동 (λ = 650 nm, 거울 이동 d → 경로차 2d): 0 → 밝음, λ/4 → 어두움, λ/2 → 밝음
    t.check(centers[2] < 60 && centers[0] > 150 && centers[4] > 150, `거울 λ/4 이동마다 밝기 교대 (${centers.join(' ')})`);
    // 6) 오목 렌즈로 넓힌 빔: 레이저로 되돌아온 빛이 방을 덮지 않고(빛 조각 ≤ 10 cm), 팔 길이 4 mm 차이면 동심원이 보인다
    await ev(`
      const B = new THREE.Vector3(9.0, 0.85, 3.0);
      find('평면거울 2').setFine(0, 0); put(find('평면거울 1'), B.x + 0.154, B.z, Math.PI); put(find('오목 렌즈'), B.x - 0.2, B.z, 0);`);
    await t.wait(900);
    const wide = await t.ev(() => {
      const { beams, THREE } = window.lab; const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      let maxSpot = 0; for (let i = 0; i < beams.spots.n; i++) { beams.spots.mesh.getMatrixAt(i, m); m.decompose(p, q, s); maxSpot = Math.max(maxSpot, s.x); }
      const decs = beams.interf.filter((x) => x.mesh.visible);
      const d = decs[0]; let peaks = 0;
      if (d) { const row = d.ctx.getImageData(0, d.N / 2, d.N, 1).data; for (let x = 1; x < d.N - 1; x++) if (row[x * 4] > row[x * 4 - 4] && row[x * 4] >= row[x * 4 + 4] && row[x * 4] > 100) peaks++; }
      return { maxSpot, maxDecal: Math.max(0, ...decs.map((x) => x.mesh.scale.x)), n: decs.length, peaks };
    });
    t.check(wide.maxSpot <= 0.1001 && wide.maxDecal <= 0.1001, `퍼진 빛 조각이 10 cm 이하 (점 ${wide.maxSpot.toFixed(3)}, 무늬 ${wide.maxDecal.toFixed(3)} m)`);
    t.check(wide.n === 1 && wide.peaks >= 3, `팔 길이 4 mm 차이: 동심원 무늬 (지름 방향 밝은 고리 ${wide.peaks}개)`);
  },
};
