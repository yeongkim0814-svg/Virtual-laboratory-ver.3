// 아트 디렉션: 구조 재질이 팔레트(순백·고채도 파랑·네온 없음)를 지키는지, 점광원 수·그리기 호출·UI 색을 숫자로 확인
module.exports = {
  name: '아트 디렉션 (팔레트 · 점광원 · 그리기 비용 · UI)',
  async run(t) {
    await t.clearBench();
    const r = await t.ev(() => {
      const { scene } = window.lab; let lights = 0; const bad = [];
      scene.traverse((o) => {
        if (o.isPointLight) lights++;
        const ms = o.material ? [].concat(o.material) : [];
        for (const m of ms) {
          if (!m.color || m.isMeshBasicMaterial || m.isSpriteMaterial || m.map || m.transparent || m.isLineBasicMaterial) continue;
          const c = m.color; const hsl = {}; c.getHSL(hsl);
          const mx = Math.max(c.r, c.g, c.b);
          if (mx > 0.9 && hsl.s < 0.3) bad.push('white:' + (o.name || o.parent?.name || o.type) + c.getHexString() + (m.emissive ? 'e' + m.emissive.getHexString() : '') + (m.transparent ? 't' : ''));
        }
      });
      return { lights, bad: [...new Set(bad)].slice(0, 5) };
    });
    t.check(r.lights <= 12, `점광원 ${r.lights}개 (≤ 12)`);
    t.check(r.bad.length === 0, `순백에 가까운 구조 재질 없음 ${r.bad.join(',')}`);
    const css = await t.ev(() => { const s = getComputedStyle(document.documentElement); return { amber: s.getPropertyValue('--amber').trim(), text: s.getPropertyValue('--text').trim() }; });
    t.check(css.amber === '#d89a2e' && css.text === '#cfc89a', `UI 팔레트 변수 ${css.amber} / ${css.text}`);
    const calls = await t.ev(() => { const { renderer, scene, camera } = window.lab; renderer.info.reset(); renderer.render(scene, camera); return renderer.info.render.calls; });
    t.check(calls < 900, `그리기 호출 ${calls} (< 900)`);
    t.check(t.errors.length === 0, '페이지 오류 없음');
  },
};
