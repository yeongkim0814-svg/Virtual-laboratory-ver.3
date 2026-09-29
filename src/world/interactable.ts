import type { Object3D } from 'three';

/**
 * "상호작용 가능한 물체"의 약속(인터페이스).
 * 문, 나중에 추가할 실험 기구(비커, 스위치, 진자 …)가 모두 이 형태를 따르면
 * 조작 코드(main.ts)는 물체의 종류를 몰라도 똑같이 다룰 수 있다.
 */
export interface Interactable {
  /** 화면 터치/조준으로 맞힐 3D 물체 */
  object: Object3D;
  /** 버튼에 표시할 동작 이름 (예: "문 열기") */
  label(): string;
  /** 실제 동작 */
  interact(): void;
}

/** 이 거리(m)보다 멀면 상호작용할 수 없다. */
export const INTERACT_RANGE = 2.5;
