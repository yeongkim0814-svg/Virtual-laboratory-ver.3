/**
 * 실험 장비 배치 교재 (교탁 위): 보관장 구역(a, b, …)·칸 코드(a-3)별로 처음 들어 있는 기구를 적는다.
 * 본문은 stock.ts가 기구를 채운 뒤 실제 위치(StorageCabinet.locate)에서 만든다 → 배치를 바꾸면 교재도 저절로 맞는다.
 */
import type { Book, Chapter } from './books';
import type { StorageCabinet } from '../world/cabinet';
import type { Item } from '../world/items';
import { FURNITURE, MAIN_ROOM, PREP_ROOM, DOOR } from '../world/layout';

export interface Zone {
  cab: StorageCabinet;
  /** 구역 문자 */
  zone: string;
  /** 보관장 이름 (도면 이름과 같게) */
  title: string;
  /** 어디 있는지 한 줄 */
  where: string;
}

/** 실험별 준비물: 기구 이름의 앞부분으로 찾는다 */
const KITS: [string, string[]][] = [
  ['단진자', ['스탠드', '클램프', '실', '추 ', '쇠공', '각도기']],
  ['용수철 진자', ['스탠드', '클램프', '용수철', '추 ']],
  ['빛의 간섭 · 회절', ['레이저', '이중 슬릿', '단일 슬릿', '스크린', '스탠드', '클램프']],
  ['광전 효과', ['레이저', '광전관', '직류 전원', '마이크로전류계']],
  ['수레 충돌 · 경사면', ['역학 레일', '수레', '질량 막대', '운동 센서', '노트북']],
  ['뉴턴 운동 제2법칙', ['역학 레일', '수레', '도르래', '추 ', '운동 센서', '노트북']],
  ['충격량', ['역학 레일', '수레', '힘 센서', '포토게이트', '노트북']],
  ['직류 회로 · LED', ['직류 전원', '저항', '꼬마전구', '스위치', '전압계', '전류계', 'LED']],
  ['기하광학 · 마이컬슨', ['레이저', '백색 광원', '광학 원판', '평면거울', '반투명 거울', '반원형', '삼각 프리즘', '볼록 렌즈', '오목 렌즈', '스크린']],
  ['산 · 염기 적정', ['0.1 M', '증류수', '페놀프탈레인', '뷰렛', '비커', '삼각 플라스크', '눈금실린더', 'pH 센서', '스탠드', '클램프', '노트북']],
];

const SHELF = ['바닥', '1단', '2단', '3단', '4단'];

export function buildPlacementBook(zones: Zone[], items: Item[]): Book {
  for (const z of zones) z.cab.setZone(z.zone, z.title);
  // 기구 → 처음 자리
  const home = new Map<Item, { code: string; section: number; shelf: number; zone: Zone } | null>();
  for (const it of items) {
    let found = null;
    for (const z of zones) {
      const l = z.cab.locate(it.object.position);
      if (l) { found = { ...l, zone: z }; break; }
    }
    home.set(it, found);
  }
  const chapters: Chapter[] = [{ title: '0. 찾는 법 · 구역 지도', html: guide(zones) }];
  for (const z of zones) {
    const rows: string[] = [];
    let emptyFrom = -1; // 이어진 빈 칸은 한 줄로 (b-9 ~ b-15)
    const flushEmpty = (end: number) => {
      if (emptyFrom < 0) return;
      const c = emptyFrom === end ? z.cab.code(end) : `${z.cab.code(emptyFrom)} ~ ${z.cab.code(end)}`;
      rows.push(`<tr><td class="code">${c}</td><td>—</td><td class="dim">(빈 칸)</td></tr>`);
      emptyFrom = -1;
    };
    for (let i = 0; i < z.cab.sectionCount; i++) {
      const here = items.filter((it) => home.get(it)?.zone === z && home.get(it)!.section === i);
      const shelves = [...new Set(here.map((it) => home.get(it)!.shelf))].sort((a, b) => b - a); // 위 선반부터
      if (!shelves.length) {
        if (emptyFrom < 0) emptyFrom = i;
        continue;
      }
      flushEmpty(i - 1);
      shelves.forEach((sh, k) => {
        const on = here.filter((it) => home.get(it)!.shelf === sh);
        rows.push(`<tr>${k ? '' : `<td class="code" rowspan="${shelves.length}">${z.cab.code(i)}</td>`}<td>${SHELF[sh] ?? sh + '단'}</td><td data-n="${on.length}">${count(on.map((it) => it.name))}</td></tr>`);
      });
    }
    flushEmpty(z.cab.sectionCount - 1);
    chapters.push({
      title: `${z.zone}. ${z.title}`,
      html: `<p>${z.where}</p><table class="place"><tr><th>코드</th><th>선반</th><th>기구</th></tr>${rows.join('')}</table>`,
    });
  }
  const outside = items.filter((it) => !home.get(it));
  chapters.push({
    title: '교탁 · 칠판 (보관장 밖)',
    html: `<ul>${outside.map((it) => `<li>${it.name}</li>`).join('')}</ul><p class="note">교탁 위 노트북 2대·교재 3권, 스탠딩 테이블 위 노트북 1대, 칠판 아래 받침의 분필·지우개.</p>`,
  });
  // 실험별 준비물: 이름 앞부분 → 코드 목록
  const codeOf = (it: Item) => home.get(it)?.code ?? '교탁';
  const kitRows = KITS.map(([exp, keys]) => {
    const parts = keys.map((k) => {
      const found = items.filter((it) => it.name.startsWith(k));
      if (!found.length) return '';
      const codes = [...new Set(found.map(codeOf))].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true })).join(' · ');
      return `${k.trim()} <span class="code">${codes}</span>`;
    }).filter(Boolean);
    return `<h3>${exp}</h3><p>${parts.join(', ')}</p>`;
  });
  chapters.push({ title: '실험별 준비물 위치', html: kitRows.join('') });
  return { id: 'placement', title: '실험 장비 배치', subtitle: '보관장 코드 · 칸별 기구 · 실험별 준비물', chapters };
}

/** 같은 이름이 여럿이면 "× n" */
function count(names: string[]): string {
  const m = new Map<string, number>();
  for (const n of names) m.set(n, (m.get(n) ?? 0) + 1);
  return [...m].map(([n, c]) => (c > 1 ? `${n} × ${c}` : n)).join(', ');
}

/** 찾는 법 + 위에서 본 도면 (구역 강조) */
function guide(zones: Zone[]): string {
  const S = 40; // 1 m = 40 px
  const W = PREP_ROOM.x2 * S;
  const H = MAIN_ROOM.z2 * S;
  const r = (x1: number, z1: number, x2: number, z2: number, cls: string) =>
    `<rect class="${cls}" x="${x1 * S}" y="${z1 * S}" width="${(x2 - x1) * S}" height="${(z2 - z1) * S}" />`;
  const names = new Set(zones.map((z) => z.title));
  const parts: string[] = [r(0, 0, MAIN_ROOM.x2, MAIN_ROOM.z2, 'room'), r(PREP_ROOM.x1, 0, PREP_ROOM.x2, PREP_ROOM.z2, 'room')];
  for (const f of FURNITURE) {
    if (names.has(f.name)) continue;
    const { x1, z1, x2, z2 } = f.rect;
    parts.push(r(x1, z1, x2, z2, 'furn'));
    if (Math.min(x2 - x1, z2 - z1) > 0.4) parts.push(`<text class="s" x="${((x1 + x2) / 2) * S}" y="${((z1 + z2) / 2) * S + 5}">${f.name}</text>`);
  }
  for (const z of zones) {
    const f = FURNITURE.find((q) => q.name === z.title)!;
    const { x1, z1, x2, z2 } = f.rect;
    parts.push(r(x1, z1, x2, z2, 'zone'));
    parts.push(`<text class="z" x="${((x1 + x2) / 2) * S}" y="${((z1 + z2) / 2) * S + 9}">${z.zone}</text>`);
  }
  parts.push(`<rect class="door" x="${MAIN_ROOM.x2 * S}" y="${DOOR.z1 * S}" width="${(PREP_ROOM.x1 - MAIN_ROOM.x2) * S}" height="${(DOOR.z2 - DOOR.z1) * S}" />`);
  const svg = `<svg class="plan" viewBox="-4 -4 ${W + 8} ${H + 8}">${parts.join('')}</svg>`;
  const list = zones.map((z) => `<li><b>${z.zone}</b> — ${z.title}: ${z.where} (칸 ${z.cab.code(0)} ~ ${z.cab.code(z.cab.sectionCount - 1)})</li>`).join('');
  return `
<h3>코드 읽는 법</h3>
<p><b>a-3</b> = 구역 <b>a</b>(보관장 하나)의 <b>3번째 칸</b>. 칸 번호는 보관장 앞에 서서 <b>왼쪽부터</b> 1, 2, 3 …</p>
<p>코드 판은 칸마다 <b>맨 위 문</b>의 경첩 쪽 위 모서리에 붙어 있고, 문을 조준하면 화면 가운데 아래에도 뜬다.</p>
<p>선반: 바닥 → 1단 → 2단 … (위로 갈수록 숫자가 커진다).</p>
${svg}
<ul>${list}</ul>
<p class="note">쓴 기구는 같은 코드 칸에 돌려놓자. 다음 실험에서 찾기 쉽다.</p>`;
}
