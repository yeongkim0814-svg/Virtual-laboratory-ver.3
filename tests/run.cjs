/**
 * 전체(또는 이름이 맞는 것만) 시나리오 실행.   node tests/run.cjs [이름조각 ...]
 * 미리 빌드해서 미리보기 서버를 띄워 둔다:  npm run build && npx vite preview --port 4173 &
 * (서버가 없으면 이 스크립트가 직접 띄운다)
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { open } = require('./lib.cjs');

const only = process.argv.slice(2);
const dir = path.join(__dirname, 'scenarios');

function up() {
  return new Promise((res) => http.get('http://localhost:4173', () => res(true)).on('error', () => res(false)));
}

(async () => {
  let server = null;
  if (!(await up())) {
    server = spawn('npx', ['vite', 'preview', '--port', '4173'], { cwd: path.join(__dirname, '..'), stdio: 'ignore', detached: true });
    for (let i = 0; i < 30 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.cjs') && (!only.length || only.some((o) => f.includes(o)))).sort();
  const summary = [];
  for (const f of files) {
    const sc = require(path.join(dir, f));
    console.log(`\n■ ${sc.name} (${f})`);
    let fails = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const t = await open();
      try {
        await sc.run(t);
      } catch (e) {
        t.check(false, '예외: ' + String(e.message).split('\n')[0]);
      }
      fails = await t.close();
      if (!fails.length) break;
      if (attempt === 0) console.log('  … 다시 시도 (헤드리스 입력 지연 대비)');
    }
    summary.push([sc.name, fails]);
  }
  console.log('\n=== 요약 ===');
  let bad = 0;
  for (const [n, f] of summary) {
    console.log(`${f.length ? 'FAIL' : 'ok  '} ${n}${f.length ? '\n       ' + f.join('\n       ') : ''}`);
    bad += f.length ? 1 : 0;
  }
  if (server) process.kill(-server.pid);
  process.exit(bad ? 1 : 0);
})();
