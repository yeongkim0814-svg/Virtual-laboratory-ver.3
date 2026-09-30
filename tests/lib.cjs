/**
 * 테스트 공통 도구 (Playwright, 헤드리스 크롬 + 모바일 터치)
 *   실행: npm test            (전체)   |   node tests/run.cjs optics   (이름에 포함된 것만)
 *   시나리오 파일: tests/scenarios/*.cjs → module.exports = { name, run(t) }, 실패하면 t.check가 던진다.
 *
 * 브라우저 쪽에서는 #debug 해시가 window.lab을 열어 준다:
 *   lab = { THREE, scene, camera, player, hand, items, stock, power, wires, doors, bus, beams, opticsPanel,
 *           doubleActionsAt, singleActionsAt }
 */
const { chromium } = require('playwright');

const URL = process.env.LAB_URL || 'http://localhost:4173/#debug';

async function open(opts = {}) {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: opts.w || 1280, height: opts.h || 800 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL);
  await page.waitForTimeout(600);
  await page.tap('#btn-enter');
  await page.waitForTimeout(400);
  return new T(browser, page, errors);
}

class T {
  constructor(browser, page, errors) {
    this.browser = browser;
    this.page = page;
    this.errors = errors;
    this.fails = [];
  }

  /** 실패를 모아 둔다 (끝에서 한꺼번에 보고) */
  check(cond, msg) {
    if (!cond) this.fails.push(msg);
    console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
    return cond;
  }

  /** 근사 비교 */
  near(actual, expected, tol, msg) {
    return this.check(Math.abs(actual - expected) <= tol, `${msg}: ${Number(actual).toFixed(4)} (기대 ${expected} ± ${tol})`);
  }

  wait(ms) {
    return this.page.waitForTimeout(ms);
  }

  /** 브라우저 안에서 함수 실행 (인자는 JSON으로 전달) */
  ev(fn, arg) {
    return this.page.evaluate(fn, arg);
  }

  /** 이름이 name으로 시작하는 기구를 (x, z)에 놓는다. 끼워져 있던 것은 뗀다 */
  put(name, x, z, { yaw = 0, y = 0.85 } = {}) {
    return this.ev(([name, x, z, yaw, y]) => {
      const { scene, items } = window.lab;
      const it = items.find((i) => i.name.startsWith(name));
      if (!it) throw new Error('기구 없음: ' + name);
      if (it.attachedTo) it.attachedTo.detach(it);
      it.object.removeFromParent();
      it.object.position.set(x, y, z);
      it.object.rotation.set(0, yaw, 0);
      it.yaw = yaw;
      scene.add(it.object);
      it.object.updateMatrixWorld(true);
      return true;
    }, [name, x, z, yaw, y]);
  }

  /** 기구 A를 기구 B의 소켓에 끼운다 (소켓 번호 또는 이름 일부) */
  attach(name, toName, socket = 0) {
    return this.ev(([name, toName, socket]) => {
      const { items } = window.lab;
      const it = items.find((i) => i.name.startsWith(name));
      const to = items.find((i) => i.name.startsWith(toName));
      const s = typeof socket === 'number' ? to.sockets[socket] : to.sockets.find((q) => q.label.includes(socket));
      if (it.attachedTo) it.attachedTo.detach(it);
      it.object.removeFromParent();
      s.attach(it, it.plugs[0]);
      return s.label;
    }, [name, toName, socket]);
  }

  /** 실험대 위(x 8.5 ~ 10.3, z 2 ~ 4) 다른 기구를 치워 자리를 비운다 */
  clearBench(keep = []) {
    return this.ev((keep) => {
      const { scene, items } = window.lab;
      for (const it of items) {
        const o = it.object;
        if (o.parent !== scene || keep.some((k) => it.name.startsWith(k))) continue;
        if (Math.abs(o.position.x - 9.4) < 1.3 && Math.abs(o.position.z - 3) < 1.3) o.position.x += 3;
      }
    }, keep);
  }

  camera(x, z, yaw, pitch) {
    return this.ev(([x, z, yaw, pitch]) => {
      const p = window.lab.player;
      p.pos.x = x; p.pos.z = z; p.yaw = yaw; p.pitch = pitch;
    }, [x, z, yaw, pitch]);
  }

  /** 기구 위 한 점(물체 좌표)의 화면 좌표 */
  screenOf(name, [lx, ly, lz] = [0, 0.03, 0]) {
    return this.ev(([name, lx, ly, lz]) => {
      const { THREE, camera, items } = window.lab;
      const it = items.find((i) => i.name.startsWith(name));
      const w = it.object.localToWorld(new THREE.Vector3(lx, ly, lz));
      camera.updateMatrixWorld();
      const v = w.project(camera);
      const st = document.getElementById('stage').getBoundingClientRect();
      return { x: st.x + ((v.x + 1) / 2) * st.width, y: st.y + ((1 - v.y) / 2) * st.height };
    }, [name, lx, ly, lz]);
  }

  /** 한 번 탭: 두 번 탭 동작이 있는 기구는 0.3 s + 한 프레임 뒤에 실행되므로 넉넉히 기다린다 */
  async tap(p) {
    await this.page.touchscreen.tap(p.x, p.y);
    await this.wait(900);
  }

  async dbl(p) {
    await this.page.touchscreen.tap(p.x, p.y);
    await this.wait(90);
    await this.page.touchscreen.tap(p.x, p.y);
    await this.wait(500);
  }

  /** 열려 있는 동작 메뉴의 글자들 */
  menu() {
    return this.page.$$eval('#action-menu button', (bs) => bs.filter((b) => b.offsetParent).map((b) => b.textContent));
  }

  /** 메뉴에서 정규식에 맞는 첫 동작 누르기 */
  async pick(re) {
    for (const bt of await this.page.$$('#action-menu button')) {
      if (re.test(await bt.textContent())) {
        await bt.tap();
        await this.wait(250);
        return true;
      }
    }
    return false;
  }

  hold(name) {
    return this.ev((name) => {
      const { items, hand } = window.lab;
      hand.pickUp(items.find((i) => i.name.startsWith(name) && !i.attachedTo));
      return hand.held && hand.held.name;
    }, name);
  }

  async shot(file) {
    await this.page.screenshot({ path: file });
  }

  async close() {
    const errs = this.errors.filter((e) => !/ResizeObserver/.test(e));
    this.check(errs.length === 0, `페이지 오류 없음${errs.length ? ': ' + errs[0].slice(0, 120) : ''}`);
    await this.browser.close();
    return this.fails;
  }
}

module.exports = { open, T };
