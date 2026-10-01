// 아바타 모양 검토용 스크린샷 (수동 실행, 테스트 아님): 앞 · 3/4 · 옆 + 옆에서 본 걸음 6장 + 1인칭
//   npm run build && npx vite preview --port 4173 &   →   node tests/avatarShots.cjs <출력 폴더> [속도 m/s]
const { open } = require('./lib.cjs');

(async () => {
  const out = process.argv[2] || '.';
  const v = Number(process.argv[3] || 1.4);
  const A = await open({ w: 960, h: 540 });
  const B = await A.newPeer();
  const code = await A.ev(() => window.lab.session.host(new window.lab.LocalTransport(), 'A'));
  await B.ev((c) => window.lab.session.join(new window.lab.LocalTransport(), c, 'B'), code);
  // 보는 사람(A)은 x 3.5, z 2.4에서 +z 쪽(yaw π)을 본다. 인형(B)은 2.2 m 앞
  await A.ev(() => { const p = window.lab.player; p.pos.x = 3.5; p.pos.z = 2.4; p.yaw = Math.PI; p.pitch = -0.12; });
  const views = [['front', 0], ['three_quarter', -Math.PI / 4], ['side', -Math.PI / 2], ['back', Math.PI]];
  for (const [name, yaw] of views) {
    await B.ev((yaw) => { const p = window.lab.player; p.pos.x = 3.5; p.pos.z = 4.6; p.yaw = yaw; }, yaw);
    await A.wait(1800);
    await A.shot(`${out}/${name}.png`);
  }
  // 옆에서 본 걸음: B가 +x로 v m/s (z 4.6 줄, x 2.5 → 4.5 반복), A는 제자리에서 본다
  await B.ev((v) => {
    const p = window.lab.player; p.pos.x = 2.5; p.pos.z = 4.6; p.yaw = -Math.PI / 2;
    window.__w = setInterval(() => { p.pos.x += v * 0.016; if (p.pos.x > 4.5) p.pos.x = 2.5; }, 16);
  }, v);
  await A.wait(1500);
  for (let i = 0; i < 6; i++) {
    await A.shot(`${out}/walk${i}.png`);
    await A.wait(120);
  }
  await B.ev(() => clearInterval(window.__w));
  // 1인칭 (B 화면): 기구를 든 모습은 시나리오마다 달라 여기서는 빈손만
  await B.shot(`${out}/first_person.png`);
  await A.browser.close();
})();
