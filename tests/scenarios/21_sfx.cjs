// 효과음 구분: 대상 종류(유리·일반 기구·문)별로 다른 소리, 클릭음은 다른 소리와 겹치지 않음
module.exports = {
  name: '효과음 구분 (유리·기구·문 · 클릭음 겹침 없음)',
  async run(t) {
    await t.clearBench();
    await t.ev(() => {
      window.__snd = [];
      HTMLMediaElement.prototype.play = function () { window.__snd.push(decodeURIComponent(this.src.split('/').pop()).replace('.mp3', '') + '@' + this.playbackRate); return Promise.resolve(); };
    });
    const run = (fn, arg) => t.ev(fn, arg).then(async (r) => { await t.wait(50); return r; });
    const take = () => t.ev(() => { const s = window.__snd; window.__snd = []; return s; });
    const act = (pred, label) => run(([p, l]) => {
      const { items, bus } = window.lab; const it = items.find(new Function('i', 'return ' + p));
      bus.dispatch({ t: 'act', by: bus.me, target: bus.registry.ref(it), label: l + it.name });
    }, [pred, label]);

    await act("i.name.startsWith('저항 47')", '집기 · ');
    const a = await take();
    t.check(a.join() === 'Object_place@1.25', `일반 기구 집기: ${a}`);
    await t.wait(400);
    await act("!!i.solution", '집기 · ');
    const b = await take();
    t.check(b.join() === 'Glass@1.15', `유리 기구 집기: ${b}`);
    await t.wait(400);
    const doorCmd = (ref, label) => run(([r, l]) => { const { bus } = window.lab; bus.dispatch({ t: 'act', by: bus.me, target: r, label: l }); }, [ref, label]);
    await doorCmd('door1', '보관장 문 열기');
    t.check((await take()).join() === 'Cabinet_open@1', '보관장 열기: Cabinet open, 기본 음높이');
    await doorCmd('door1', '보관장 문 닫기');
    t.check((await take()).join() === 'Cabinet_open@0.8', '보관장 닫기: Cabinet open, 낮은 음높이');
    await doorCmd('door0', '문 열기');
    t.check((await take()).join() === 'Wood_door_open@1', '문 열기: Wood door open');
    await doorCmd('door0', '문 닫기');
    t.check((await take()).join() === 'Wood_door_close@1', '문 닫기: Wood door close');

    // 클릭음: 다른 소리 직후에는 생략, 조용할 때만 울림, 클릭 중 다른 소리가 오면 끊김
    await t.wait(600);
    const r = await t.ev(async () => {
      const { audioManager: am } = window.lab; const S = window.lab.SFXS;
      const out = {};
      window.__snd = []; am.play(S.uiClick); out.alone = window.__snd.length;
      window.__snd = []; am.play(S.pick); am.play(S.uiClick); out.afterOther = window.__snd.filter((s) => s.startsWith('Interface')).length;
      await new Promise((r) => setTimeout(r, 500));
      return out;
    });
    t.check(r.alone === 1, `조용할 때 클릭음 울림 (${r.alone})`);
    t.check(r.afterOther === 0, `다른 소리 직후 클릭음 생략 (${r.afterOther})`);
    t.check(t.errors.length === 0, `페이지 오류 없음${t.errors.length ? ': ' + t.errors[0].slice(0, 120) : ''}`);
  },
};
