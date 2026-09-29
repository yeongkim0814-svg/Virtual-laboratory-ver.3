/**
 * 수용액 화학 (실험층) — 산·염기, pH, 지시약 색
 *
 * ■ 용액을 무엇으로 나타내나
 *   부피 V와, 반응해도 "총량이 변하지 않는" 성분들의 몰수만 기록한다.
 *     Na  : NaOH에서 온 Na⁺            (구경꾼 이온)
 *     Cl  : HCl에서 온 Cl⁻             (구경꾼 이온)
 *     Ac  : 아세트산 총량 = [CH₃COOH] + [CH₃COO⁻]
 *     N   : 암모니아 총량 = [NH₃] + [NH₄⁺]
 *     php·mo·btb : 지시약 총량 (페놀프탈레인·메틸 오렌지·BTB)
 *   H⁺·OH⁻는 기록하지 않는다 — 아래 전하 균형으로 매번 "계산"한다.
 *   그래서 섞기 = 부피와 몰수를 더하기만 하면 되고, 중화 반응은 저절로 반영된다.
 *   (HCl + NaOH → 물: Cl⁻ 0.001 mol, Na⁺ 0.001 mol이 같은 용액에 있으면 전하 균형의 해가 pH 7)
 *
 * ■ pH 풀이 — 전하 균형 (용액 전체는 전기적으로 중성)
 *     [H⁺] + [Na⁺] + [NH₄⁺] = [OH⁻] + [Cl⁻] + [CH₃COO⁻]
 *     [OH⁻] = Kw/h,  [CH₃COO⁻] = C_Ac·Ka/(Ka + h),  [NH₄⁺] = C_N·h/(Ka' + h)   (h = [H⁺])
 *   왼쪽 − 오른쪽은 h가 커질수록 커지는 함수 → 0이 되는 h를 이분법으로 찾는다.
 *   강산·약산·완충 용액·염의 가수분해를 모두 이 식 하나로 푼다.
 *   교과서의 근사식([H⁺] ≈ √(Ka·C), 헨더슨-하셀바흐 등)은 이 해의 특수한 경우다.
 *
 * ■ 모형의 한계 (어디서 깨지는가)
 *   - 이상 용액: 농도를 그대로 활동도로 쓴다. 약 0.1 M을 넘으면 실제 pH와 조금씩 어긋난다.
 *   - 부피 가산: 섞은 부피 = 부피의 합 (묽은 수용액은 거의 맞음)
 *   - 25 °C 고정: Kw = 1.0×10⁻¹⁴. 온도가 바뀌면 Kw·Ka도 바뀐다 (3.2 단계에서 다룸)
 *   - 지시약 자체의 산·염기 성질은 양이 아주 적어 pH 계산에서 뺀다 (색만 계산)
 */

export type Species = 'Na' | 'Cl' | 'Ac' | 'N' | 'php' | 'mo' | 'btb';

export const KW = 1.0e-14;
export const KA_ACETIC = 1.8e-5; // CH₃COOH ⇌ H⁺ + CH₃COO⁻
export const KA_AMMONIUM = 5.6e-10; // NH₄⁺ ⇌ H⁺ + NH₃  (Kb(NH₃) = Kw/Ka = 1.8×10⁻⁵)

/**
 * 지시약: HIn ⇌ H⁺ + In⁻,  pKa 근처에서 색이 바뀐다.
 * eps = 몰 흡광 계수 (L·mol⁻¹·cm⁻¹)를 빨강·초록·파랑 빛에 대해 나눈 것 — 그 색의 빛을 얼마나 흡수하는가.
 *   흡수한 빛의 보색이 보인다: 초록을 흡수 → 분홍, 파랑을 흡수 → 노랑, 빨강·주황을 흡수 → 파랑
 */
export const INDICATORS: Record<'php' | 'mo' | 'btb', { name: string; pKa: number; acid: number[]; base: number[]; dropMol: number }> = {
  // 페놀프탈레인 0.2 % 에탄올 용액 1방울(0.05 mL) ≈ 3×10⁻⁷ mol. 산성형은 무색, 염기형(λmax 553 nm) 분홍
  php: { name: '페놀프탈레인', pKa: 9.4, acid: [0, 0, 0], base: [3.0e3, 3.0e4, 1.0e4], dropMol: 3e-7 },
  // 메틸 오렌지 0.1 % ≈ 1.5×10⁻⁷ mol/방울. 산성형 빨강(505 nm), 염기형 노랑(465 nm)
  mo: { name: '메틸 오렌지', pKa: 3.7, acid: [2.0e3, 3.4e4, 2.2e4], base: [0, 4.0e3, 2.7e4], dropMol: 1.5e-7 },
  // BTB 0.1 % ≈ 8×10⁻⁸ mol/방울. 산성형 노랑(430 nm), 염기형 파랑(617 nm)
  //   중성(pH 7 부근)에서는 두 형태가 섞여 파랑·빨강 쪽을 함께 흡수 → 초록
  btb: { name: 'BTB', pKa: 7.1, acid: [0, 2.0e3, 2.8e4], base: [3.8e4, 1.2e4, 0], dropMol: 8e-8 },
};

export class Solution {
  /** 부피 (L) */
  V = 0;
  /** 성분 몰수 (mol) */
  n: Partial<Record<Species, number>> = {};

  static of(V: number, n: Partial<Record<Species, number>> = {}): Solution {
    const s = new Solution();
    s.V = V;
    s.n = { ...n };
    return s;
  }

  /** 몰 농도 (M) */
  conc(sp: Species): number {
    return this.V > 0 ? (this.n[sp] ?? 0) / this.V : 0;
  }

  /** dV(L)만큼 떠낸다 — 같은 비율로 모든 성분이 따라 나간다 (고르게 섞여 있다고 가정) */
  take(dV: number): Solution {
    const v = Math.min(dV, this.V);
    const f = this.V > 0 ? v / this.V : 0;
    const out = new Solution();
    out.V = v;
    for (const k of Object.keys(this.n) as Species[]) {
      const m = (this.n[k] ?? 0) * f;
      out.n[k] = m;
      this.n[k] = (this.n[k] ?? 0) - m;
    }
    this.V -= v;
    if (this.V < 1e-9) this.clear();
    return out;
  }

  /** 섞기: 부피와 몰수를 더한다 */
  add(s: Solution): void {
    this.V += s.V;
    for (const k of Object.keys(s.n) as Species[]) this.n[k] = (this.n[k] ?? 0) + (s.n[k] ?? 0);
  }

  addMol(sp: Species, mol: number): void {
    this.n[sp] = (this.n[sp] ?? 0) + mol;
  }

  clear(): void {
    this.V = 0;
    this.n = {};
  }

  /** [H⁺] (M) — 전하 균형을 이분법으로 푼다. 비어 있으면 null */
  hydrogen(): number | null {
    if (this.V <= 1e-9) return null;
    const na = this.conc('Na');
    const cl = this.conc('Cl');
    const ac = this.conc('Ac');
    const nh = this.conc('N');
    const f = (h: number) => h + na + (nh * h) / (KA_AMMONIUM + h) - KW / h - cl - (ac * KA_ACETIC) / (KA_ACETIC + h);
    let lo = -16; // log10 h
    let hi = 2;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (f(10 ** mid) > 0) hi = mid;
      else lo = mid;
    }
    return 10 ** ((lo + hi) / 2);
  }

  pH(): number | null {
    const h = this.hydrogen();
    return h === null ? null : -Math.log10(h);
  }

  /**
   * 보이는 색 (0~1 RGB): 비어-람베르트 법칙  A = ε·c·l,  투과율 T = 10^(−A)
   * 지시약 여러 개가 섞여 있으면 흡광도가 더해진다 → 색이 물리적으로 섞인다.
   * @param pathCm 빛이 지나는 액체 두께 (용기 지름)
   */
  color(pathCm: number): [number, number, number] {
    const A = [0, 0, 0];
    const h = this.hydrogen();
    if (h !== null) {
      for (const k of ['php', 'mo', 'btb'] as const) {
        const c = this.conc(k);
        if (c <= 0) continue;
        const ind = INDICATORS[k];
        const Ka = 10 ** -ind.pKa;
        const base = Ka / (Ka + h); // In⁻의 비율
        for (let i = 0; i < 3; i++) A[i] += (ind.acid[i] * (1 - base) + ind.base[i] * base) * c * pathCm;
      }
    }
    // 물 자체: 아주 옅은 청록 (빨강을 약간 흡수)
    return [0.93 * 10 ** -A[0], 0.97 * 10 ** -A[1], 1.0 * 10 ** -A[2]];
  }

  /** 색 이름 (관찰 기록용) */
  colorName(pathCm: number): string {
    return nameOfColor(this.color(pathCm));
  }
}

/** RGB를 한국어 색 이름으로 (대략) */
export function nameOfColor([r, g, b]: [number, number, number]): string {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 0.12) return max < 0.35 ? '거의 검정' : '무색 투명';
  const d = max - min;
  let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  const pale = min > 0.55 ? '옅은 ' : '';
  if (hue < 12 || hue >= 340) return min > 0.45 ? `${pale}분홍` : '빨강';
  if (hue < 38) return `${pale}주황`;
  if (hue < 68) return `${pale}노랑`;
  if (hue < 100) return `${pale}연두`;
  if (hue < 160) return `${pale}초록`;
  if (hue < 200) return `${pale}청록`;
  if (hue < 255) return `${pale}파랑`;
  if (hue < 290) return `${pale}보라`;
  return `${pale}자주·분홍`;
}

/** 만능 pH 시험지 색 (pH 1 ~ 14) — 빨강 → 주황 → 노랑 → 초록 → 파랑 → 보라 */
export function universalColor(pH: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [1, [0.85, 0.1, 0.12]], [3, [0.95, 0.45, 0.1]], [5, [0.95, 0.85, 0.15]], [7, [0.35, 0.75, 0.25]],
    [9, [0.15, 0.55, 0.65]], [11, [0.2, 0.25, 0.7]], [14, [0.4, 0.15, 0.55]],
  ];
  const p = Math.min(14, Math.max(1, pH));
  for (let i = 1; i < stops.length; i++) {
    if (p <= stops[i][0]) {
      const [p0, c0] = stops[i - 1];
      const [p1, c1] = stops[i];
      const t = (p - p0) / (p1 - p0);
      return [0, 1, 2].map((k) => c0[k] + (c1[k] - c0[k]) * t) as [number, number, number];
    }
  }
  return stops[stops.length - 1][1];
}

/** 시약 목록: 시약병에 담는 원액 (1 L당 몰수) */
export interface Reagent {
  id: string;
  name: string;
  label: string; // 라벨 글자
  perL: Partial<Record<Species, number>>;
}

export const REAGENTS: Reagent[] = [
  { id: 'HCl', name: '0.1 M 염산', label: 'HCl 0.1M', perL: { Cl: 0.1 } },
  { id: 'NaOH', name: '0.1 M 수산화 나트륨', label: 'NaOH 0.1M', perL: { Na: 0.1 } },
  { id: 'AcOH', name: '0.1 M 아세트산', label: 'CH3COOH 0.1M', perL: { Ac: 0.1 } },
  { id: 'NH3', name: '0.1 M 암모니아수', label: 'NH3 0.1M', perL: { N: 0.1 } },
  { id: 'H2O', name: '증류수', label: 'H2O', perL: {} },
];

/** 시약 V(L)만큼의 용액 */
export function reagentSolution(r: Reagent, V: number): Solution {
  const n: Partial<Record<Species, number>> = {};
  for (const k of Object.keys(r.perL) as Species[]) n[k] = (r.perL[k] ?? 0) * V;
  return Solution.of(V, n);
}
