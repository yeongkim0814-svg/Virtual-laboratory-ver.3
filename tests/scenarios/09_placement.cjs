// 실험 장비 배치 교재: 보관장 구역 코드(a-3)와 칸별 기구 목록이 실제 자리와 맞는가
module.exports = {
  name: '장비 배치 교재 (보관장 코드)',
  async run(t) {
    const r = await t.ev(() => {
      const { items, stock, doors } = window.lab;
      const book = stock.textbooks.find((b) => b.book.id === 'placement').book;
      const html = book.chapters.map((c) => c.html).join('');
      // 칸 표의 기구 수 (칸마다 data-n)
      const listed = [...html.matchAll(/data-n="(\d+)"/g)].reduce((n, m) => n + Number(m[1]), 0);
      const doorNames = doors.map((d) => d.name).filter(Boolean);
      return {
        chapters: book.chapters.map((c) => c.title),
        kitLaser: html.includes('레이저 <span class="code">a-7</span>'),
        kitRail: html.includes('역학 레일 <span class="code">b-1</span>'),
        kitHCl: html.includes('0.1 M <span class="code">c-3 · c-4</span>'),
        listed,
        total: items.length,
        doorA1: doorNames.includes('실험 기구 보관장 a-1'),
        doorB8: doorNames.includes('실험 기구 수납장 b-8'),
        doorD6: doorNames.includes('유리 기구 보관장 d-6'),
      };
    });
    t.check(r.chapters.length === 7, `장 7개: ${r.chapters.join(' / ')}`);
    t.check(r.kitLaser && r.kitRail && r.kitHCl, '실험별 준비물: 레이저 a-7, 레일 b-1, 0.1 M c-3 · c-4');
    // 칸 표 + 보관장 밖 목록 + 배치 교재 자신 = 보관장 기구 전부 (stock.items) — 빠짐·중복 없음
    const outside = await t.ev(() => {
      const { items, stock } = window.lab;
      const book = stock.textbooks.find((b) => b.book.id === 'placement').book;
      const li = book.chapters.find((c) => c.title.startsWith('교탁')).html.match(/<li>/g).length;
      return { li, stock: stock.items.length };
    });
    t.near(r.listed + outside.li + 1, outside.stock, 0, `칸 표 ${r.listed}개 + 보관장 밖 ${outside.li}개 + 배치 교재 1 = 기구 ${outside.stock}개`);
    t.check(r.doorA1 && r.doorB8 && r.doorD6, '문을 조준하면 코드 (a-1, b-8, d-6)');
  },
};
