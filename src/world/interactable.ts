import type { Object3D } from 'three';

/** 물체에 할 수 있는 동작 하나 (예: "집기", "문 열기", "진자 실험") */
export interface Action {
  label: string;
  run(): void;
  /** 보조 동작 (예: 방향 돌리기) — 메뉴에서 아래쪽에 놓인다 */
  secondary?: boolean;
  /** 'pick' = 집기. 배치된 기구는 한 번 탭하면 집기만, 나머지 조작은 두 번 탭 */
  kind?: 'pick';
}

/**
 * "상호작용 가능한 물체"의 약속(인터페이스).
 * 문, 보관장 문, 실험 기구가 모두 이 형태를 따르면 조작 코드(main.ts)는
 * 물체의 종류를 몰라도 똑같이 다룰 수 있다.
 * 기구: 한 번 탭 = 집기 / 두 번 탭 = 나머지 조작(회전·높이·전원·도선·실험 열기…) 메뉴.
 * 문·콘센트처럼 기구가 아닌 것은 한 번 탭으로 바로 동작.
 */
export interface Interactable {
  /** 화면 터치/조준으로 맞힐 3D 물체 */
  object: Object3D;
  actions(): Action[];
}

/** 이 거리(m)보다 멀면 상호작용할 수 없다. */
export const INTERACT_RANGE = 2.5;
