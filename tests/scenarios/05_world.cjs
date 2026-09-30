// 세계: 문 겹침 없음, 폐액 분류, 명령 버스, 칠판 쓰기
module.exports = {
  name: '세계 (문 · 폐액 · 명령 · 칠판)',
  async run(t) {
    // 모든 보관장 문을 열어도 서로 겹치지 않는다
    const hits = await t.ev(async () => {
      const { doors, THREE } = window.lab;
      doors.forEach((d) => d.toggle());
      await new Promise((r) => setTimeout(r, 1500));
      const boxes = doors.map((d) => { d.object.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(d.object.children[0]); });
      const out = [];
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const I = boxes[i].clone().intersect(boxes[j]);
        if (!I.isEmpty()) { const s = I.getSize(new THREE.Vector3()); if (s.x > 0.001 && s.y > 0.001 && s.z > 0.001) out.push([i, j]); }
      }
      doors.forEach((d) => d.toggle());
      return { n: doors.length, out };
    });
    t.check(hits.out.length === 0, `문 ${hits.n}개 겹침 없음${hits.out.length ? ' ' + JSON.stringify(hits.out.slice(0, 3)) : ''}`);

    // 폐액 분류: 염산 → 유기통은 거부(알림), 무기통은 버려짐 (통 위치는 장면에서 읽는다)
    const can = (kind) => t.ev((kind) => {
      const c = window.lab.wasteCans.find((w) => w.kind === kind);
      return c.object.getWorldPosition(new window.lab.THREE.Vector3()).toArray();
    }, kind);
    const waste = async (bottle, kind) => {
      await t.ev(([bottle]) => {
        const { items, hand } = window.lab;
        const bk = items.find((i) => i.name === '비커 1'); const b = items.find((i) => i.name === bottle);
        bk.solution.clear(); bk.solution.add(b.solution.take(0.02)); bk.refresh(); hand.pickUp(bk);
        document.getElementById('alert').hidden = true;
      }, [bottle]);
      const [x] = await can(kind);
      await t.camera(x, 6.4, Math.PI, -0.45);
      await t.wait(400);
      await t.page.touchscreen.tap(640, 400);
      await t.wait(500);
      const r = { alert: await t.page.$eval('#alert', (e) => !e.hidden), vol: await t.ev(() => window.lab.items.find((i) => i.name === '비커 1').volume) };
      await t.ev(() => { document.getElementById('alert').hidden = true; });
      return r;
    };
    let w = await waste('0.1 M 염산', 'organic');
    t.check(w.alert && w.vol > 0, `염산 → 유기통: 알림, 버려지지 않음 (${JSON.stringify(w)})`);
    w = await waste('0.1 M 염산', 'inorganic');
    t.check(!w.alert && w.vol === 0, `염산 → 무기통: 버려짐 (${JSON.stringify(w)})`);
    w = await waste('0.1 M 아세트산', 'inorganic');
    t.check(w.alert && w.vol > 0, `아세트산 → 무기통: 알림 (${JSON.stringify(w)})`);
    w = await waste('0.1 M 아세트산', 'organic');
    t.check(!w.alert && w.vol === 0, `아세트산 → 유기통: 버려짐 (${JSON.stringify(w)})`);
    await t.ev(() => { const h = window.lab.hand; if (h.held) h.place({ point: new window.lab.THREE.Vector3(13.4, 0.9, 6.0), valid: true }); });

    // 명령 버스: 집기 → 로그에 act
    await t.put('추 100 g', 9.5, 3.3);
    await t.ev(() => { const h = window.lab.hand; if (h.held) h.place({ point: new window.lab.THREE.Vector3(9.5, 0.85, 3.6), valid: true }); });
    await t.camera(10.3, 3.3, Math.PI / 2, -0.8);
    await t.wait(300);
    await t.tap(await t.screenOf('추 100 g', [0, 0.01, 0]));
    t.check(await t.ev(() => window.lab.bus.log.some((c) => c.t === 'act' && c.label.startsWith('집기'))), '탭 → 명령 버스(act)로 집기 실행');
    t.check(await t.ev(() => window.lab.bus.registry.size) > 100, '명령 이름표 등록');

    // 칠판: 획 명령이 칠판 버전을 올린다
    const v0 = await t.ev(() => window.lab.bus.registry.get('board0').version);
    await t.ev(() => window.lab.bus.call(window.lab.bus.registry.get('board0'), 'addStroke', 'white', 0.012, [0.1, 0.5, 0.2, 0.5]));
    t.check((await t.ev(() => window.lab.bus.registry.get('board0').version)) === v0 + 1, '칠판 획 추가 (call addStroke)');
  },
};
