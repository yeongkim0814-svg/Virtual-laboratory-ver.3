/**
 * 집기·놓기의 눈속임: 상태(누가 들었나·어디 놓였나)는 명령 순간에 바로 바뀌지만, 화면의 물체는 손 뻗기 시간표에 맞춰 옮겨 간다.
 *   집기 (시간표 PICK_SPEED배 빠름): 손이 닿아 멈춘 동안(0.2 s) 제자리 → 손이 돌아오는 동안(0.15 s) 따라온다
 *   놓기: 손에서 떠나 REACH_OUT 동안 놓을 자리로 (손이 같은 시간에 같은 곡선으로 뻗는다)
 * 논리(판정·digest·스냅숏·물리)는 언제나 최종 자리를 본다: 중간 위치는 그리기 직전(applyGlides)에만 덮어쓰고 직후(restoreGlides)에 되돌린다.
 * 그래서 기기마다 손 뻗기 시각이 달라도 세계 상태는 어긋나지 않는다 (멀티플레이어 digest).
 */
import * as THREE from 'three';
import type { Item } from '../world/items';
import { PICK_SPEED, REACH_BACK, REACH_HOLD, REACH_OUT } from '../net/avatarMotion';

interface Glide {
  parent: THREE.Object3D;
  fromP: THREE.Vector3;
  fromQ: THREE.Quaternion;
  /** 시작 시각 (performance.now, ms) — 손 뻗기와 같은 실제 시계 (프레임 dt 누적은 느린 프레임에서 dt 상한 때문에 뒤처짐) */
  t0: number;
  age: number;
  wait: number;
  dur: number;
  /** 그리는 동안만 덮어쓴 값 (되돌릴 최종 자리) */
  saved?: { p: THREE.Vector3; q: THREE.Quaternion };
}

const glides = new Map<Item, Glide>();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _ts = new THREE.Vector3();
const _toW = new THREE.Vector3();
const ease = (u: number) => 1 - (1 - u) * (1 - u);

/** item의 지금 세계 자세 (옮기기 전에 불러 `from`으로 쓴다) */
export function worldPose(item: Item): { p: THREE.Vector3; q: THREE.Quaternion } {
  item.object.updateWorldMatrix(true, false);
  return { p: item.object.getWorldPosition(new THREE.Vector3()), q: item.object.getWorldQuaternion(new THREE.Quaternion()) };
}

/** 최종 자리에 놓인 item을 from 자세에서 wait초 기다렸다가 dur초에 걸쳐 옮겨 오는 것처럼 그린다 */
export function startGlide(item: Item, from: { p: THREE.Vector3; q: THREE.Quaternion }, wait: number, dur: number): void {
  const parent = item.object.parent;
  if (!parent) return;
  glides.set(item, { parent, fromP: from.p, fromQ: from.q, t0: performance.now(), age: 0, wait, dur });
}

export const pickGlide = (item: Item, from: { p: THREE.Vector3; q: THREE.Quaternion }) => startGlide(item, from, (REACH_OUT + REACH_HOLD) / PICK_SPEED, REACH_BACK / PICK_SPEED);
export const placeGlide = (item: Item, from: { p: THREE.Vector3; q: THREE.Quaternion }) => startGlide(item, from, 0, REACH_OUT);

/** 진행 중인 눈속임을 버린다 (다시 집기·놓기·끼우기 앞) */
export function settleGlide(item: Item): void {
  glides.delete(item);
}

export function stepGlides(): void {
  const now = performance.now();
  for (const [item, g] of glides) {
    g.age = (now - g.t0) / 1000;
    if (g.age >= g.wait + g.dur || item.object.parent !== g.parent) glides.delete(item);
  }
}

/** 그리기 직전: 진행 중인 물체를 중간 자리로 (최종 자리는 저장) */
export function applyGlides(): void {
  for (const [item, g] of glides) {
    const o = item.object;
    g.saved = { p: o.position.clone(), q: o.quaternion.clone() };
    // 그리는 순간의 실제 시계로 (stepGlides 이후 시간이 지났어도 손 뻗기와 맞음)
    const age = (performance.now() - g.t0) / 1000;
    const e = ease(Math.min(1, Math.max(0, (age - g.wait) / g.dur)));
    g.parent.updateWorldMatrix(true, false);
    g.parent.matrixWorld.decompose(_p, _pq, _ts);
    _toW.copy(g.saved.p).applyMatrix4(g.parent.matrixWorld);
    _q.copy(_pq).multiply(g.saved.q); // 최종 세계 회전 = 부모 회전 · 로컬 회전
    o.position.copy(g.parent.worldToLocal(g.fromP.clone().lerp(_toW, e)));
    o.quaternion.copy(_pq.invert().multiply(g.fromQ.clone().slerp(_q, e)));
    o.updateMatrixWorld(true);
  }
}

/** 그린 직후: 최종 자리로 되돌린다 */
export function restoreGlides(): void {
  for (const [item, g] of glides) {
    if (!g.saved) continue;
    item.object.position.copy(g.saved.p);
    item.object.quaternion.copy(g.saved.q);
    item.object.updateMatrixWorld(true);
    g.saved = undefined;
  }
}
