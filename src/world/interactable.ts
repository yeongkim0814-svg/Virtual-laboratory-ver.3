import type { Object3D } from 'three';

/** 물체에 할 수 있는 동작 하나 (예: "집기", "문 열기", "진자 실험") */
export interface Action {
  label: string;
  run(): void;
  /** 보조 동작 (예: 방향 돌리기) — 짧은 탭에서는 무시, 길게 누르면 뜨는 메뉴에만 나온다 */
  secondary?: boolean;
}

/**
 * "상호작용 가능한 물체"의 약속(인터페이스).
 * 문, 보관장 문, 실험 기구가 모두 이 형태를 따르면 조작 코드(main.ts)는
 * 물체의 종류를 몰라도 똑같이 다룰 수 있다.
 * 짧은 탭: 주 동작이 하나면 즉시 실행, 여러 개면 탭한 자리에 선택 메뉴.
 * 길게 누르기: 보조 동작까지 모두 담은 메뉴.
 */
export interface Interactable {
  /** 화면 터치/조준으로 맞힐 3D 물체 */
  object: Object3D;
  actions(): Action[];
}

/** 이 거리(m)보다 멀면 상호작용할 수 없다. */
export const INTERACT_RANGE = 2.5;
