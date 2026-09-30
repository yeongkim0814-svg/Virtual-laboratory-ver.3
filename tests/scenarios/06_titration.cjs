// 적정: 0.1 M 아세트산 25 mL + 0.1 M NaOH → 시작 pH 2.88, 당량점 25.0 mL, 반당량점 4.7
module.exports = {
  name: '적정 곡선 (pH 센서)',
  async run(t) {
    const r = await t.ev(async () => {
      const { items, stock } = window.lab;
      const find = (n) => items.find((i) => i.name === n);
      const fl = find('삼각 플라스크 1'), acid = find('0.1 M 아세트산'), naoh = find('0.1 M 수산화 나트륨');
      fl.solution.add(acid.solution.take(0.025)); fl.refresh();
      const ph = stock.phSensors[0];
      const start = fl.solution.pH();
      // 1 mL씩 적하하며 pH 읽기 (센서 지연 없이 용액 pH로 곡선을 계산)
      let prev = start, maxSlope = 0, eq = 0, half = null;
      const curve = [];
      for (let v = 0; v <= 40; v += 0.5) {
        const f = find('삼각 플라스크 1');
        const c = f.solution.pH();
        curve.push([v, c]);
        if (v === 12.5) half = c;
        if (v > 0 && (c - prev) / 0.5 > maxSlope) { maxSlope = (c - prev) / 0.5; eq = v - 0.25; }
        prev = c;
        f.solution.add(naoh.solution.take(0.0005));
      }
      return { start, eq, half };
    });
    t.near(r.start, 2.88, 0.02, '시작 pH');
    t.near(r.eq, 25, 0.5, '당량점 부피 (mL)');
    t.near(r.half, 4.74, 0.06, '반당량점 pH = pKa');
  },
};
