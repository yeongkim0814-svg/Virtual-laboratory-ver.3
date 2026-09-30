/**
 * 패널 그래프·기록 내보내기 도우미
 *  - 산점도 + 맞춤 직선/이론 곡선 (절반 해상도 캔버스 → 도트 느낌)
 *  - CSV 파일 저장: 머리글·값을 모두 영문·숫자(ASCII)로 쓰고 BOM을 붙이지 않는다
 *    (BOM(보이지 않는 표시 \uFEFF)을 붙이면 엑셀은 한글을 잘 읽지만, 구글 시트 등 일부 앱은 첫 칸 이름에 이상한 글자로 붙여 보여 준다.
 *     ASCII만 쓰면 어떤 앱에서 열어도 깨지지 않는다)
 */

export interface Series {
  color: string;
  points: [number, number][];
  /** 점을 잇는 선 (이론 곡선·맞춤 직선) — 점은 찍지 않음 */
  line?: boolean;
  /** 점 크기 (px, 기본 3) */
  size?: number;
  /** 선 아래(가로축 y = 0까지)를 칠함 — 넓이(충격량 등)를 보여 줄 때 */
  fill?: boolean;
}

export interface PlotSpec {
  x: [number, number];
  y: [number, number];
  series: Series[];
  /** x·y 눈금 간격 (그 간격마다 옅은 선) */
  grid?: [number, number];
}

export function drawPlot(c: HTMLCanvasElement, spec: PlotSpec): void {
  const w = Math.max(1, Math.round(c.clientWidth / 2));
  const h = Math.max(1, Math.round(c.clientHeight / 2));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, w, h);
  const [x0, x1] = spec.x;
  const [y0, y1] = spec.y;
  const X = (x: number) => ((x - x0) / (x1 - x0)) * (w - 3) + 1;
  const Y = (y: number) => h - 2 - ((y - y0) / (y1 - y0)) * (h - 4);
  if (spec.grid) {
    g.fillStyle = 'rgba(255,154,46,0.18)';
    const [gx, gy] = spec.grid;
    for (let x = Math.ceil(x0 / gx) * gx; x <= x1; x += gx) g.fillRect(Math.round(X(x)), 0, 1, h);
    for (let y = Math.ceil(y0 / gy) * gy; y <= y1; y += gy) g.fillRect(0, Math.round(Y(y)), w, 1);
  }
  g.fillStyle = 'rgba(255,154,46,0.5)';
  g.fillRect(Math.round(X(Math.max(x0, 0))), 0, 1, h);
  g.fillRect(0, Math.round(Y(Math.max(y0, 0))), w, 1);
  for (const s of spec.series) {
    if (s.fill && s.points.length > 1) {
      g.fillStyle = s.color;
      g.beginPath();
      g.moveTo(X(s.points[0][0]), Y(0));
      for (const [x, y] of s.points) g.lineTo(X(x), Y(y));
      g.lineTo(X(s.points[s.points.length - 1][0]), Y(0));
      g.closePath();
      g.fill();
      continue;
    }
    if (s.line) {
      g.strokeStyle = s.color;
      g.beginPath();
      // y가 NaN인 점에서 선을 끊는다 (측정 범위 밖 등 빈 구간)
      let pen = false;
      for (const [x, y] of s.points) {
        if (!Number.isFinite(y)) { pen = false; continue; }
        if (pen) g.lineTo(X(x) + 0.5, Y(y) + 0.5);
        else g.moveTo(X(x) + 0.5, Y(y) + 0.5);
        pen = true;
      }
      g.stroke();
    } else {
      g.fillStyle = s.color;
      const d = s.size ?? 3;
      const o = Math.floor(d / 2);
      for (const [x, y] of s.points) if (Number.isFinite(y)) g.fillRect(Math.round(X(x)) - o, Math.round(Y(y)) - o, d, d);
    }
  }
}

/** 표를 CSV 파일로 저장 (태블릿에서는 "다운로드" 폴더에 들어간다) */
export function downloadCsv(name: string, header: string[], rows: (string | number)[][]): void {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 오늘 날짜·시각을 파일 이름용으로 (예: 20260929-1432) */
export function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
