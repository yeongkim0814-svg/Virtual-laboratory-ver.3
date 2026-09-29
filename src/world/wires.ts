/**
 * 도선과 단자
 *
 * - 단자(Terminal): 전기 기구의 빨강(+)·검정(−) 꼭지. 탭해서 도선을 잇는다.
 * - 연결 방법: 단자를 탭 → "도선 연결 시작" → 다른 단자를 탭 → 도선이 생긴다.
 *   한 단자에 도선을 여러 개 꽂을 수 있다 (바나나 잭처럼 겹쳐 꽂기).
 * - 도선 길이는 최대 1.5 m. 기구를 그보다 멀리 떼어 놓으면 빠진다.
 * - 회로 해석은 "어떤 단자들이 도선으로 이어져 같은 전위(마디)가 되는가"만 알면 되므로
 *   union-find로 마디를 묶어 준다 (nodeOf).
 */
import * as THREE from 'three';
import { HITBOX_MAT, type Item } from './items';
import type { Action } from './interactable';
import { Cable, liftAboveFurniture } from './cable';

const WIRE_MAX = 1.5; // m
const KNOB_RED = new THREE.MeshLambertMaterial({ color: 0xc0302a });
const KNOB_BLACK = new THREE.MeshLambertMaterial({ color: 0x1a1a18 });

export class Terminal {
  readonly wires: Wire[] = [];
  private anchor = new THREE.Object3D();

  /**
   * @param owner 단자가 달린 기구, name 안내용 이름 (예: "양극(+)")
   * @param polarity '+'(빨강) 또는 '−'(검정)
   * @param local 기구 좌표에서의 위치, facing 단자가 튀어나온 방향 (기구 좌표)
   */
  constructor(readonly owner: Item, readonly name: string, readonly polarity: '+' | '-', local: THREE.Vector3, facing: THREE.Vector3) {
    this.anchor.position.copy(local);
    this.anchor.lookAt(local.clone().add(facing));
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.014, 6).rotateX(Math.PI / 2), polarity === '+' ? KNOB_RED : KNOB_BLACK);
    knob.position.z = 0.007;
    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 4), HITBOX_MAT); // 이웃 단자와 겹치지 않을 크기
    pad.position.z = 0.01;
    pad.userData.terminal = this;
    this.anchor.add(knob, pad);
    owner.object.add(this.anchor);
  }

  get label(): string {
    return `${this.owner.name} ${this.name}`;
  }

  /** 도선이 꽂히는 점 (월드) */
  worldPosition(): THREE.Vector3 {
    this.anchor.updateWorldMatrix(true, false);
    return this.anchor.localToWorld(new THREE.Vector3(0, 0, 0.014));
  }
}

export class Wire {
  readonly cable: Cable;
  private pts = Array.from({ length: 18 }, () => new THREE.Vector3());

  constructor(readonly a: Terminal, readonly b: Terminal, color: number) {
    this.cable = new Cable(this.pts.length, 0.005, color);
  }

  get line(): THREE.Object3D {
    return this.cable.mesh;
  }

  length(): number {
    return this.a.worldPosition().distanceTo(this.b.worldPosition());
  }

  /** 가운데가 처지는 곡선으로 다시 그린다 (책상 윗면·바닥 아래로는 내려가지 않고 그 위에 눕는다) */
  redraw(): void {
    const p = this.a.worldPosition();
    const q = this.b.worldPosition();
    const n = this.pts.length;
    const sag = 0.15 + 0.2 * p.distanceTo(q);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      this.pts[i].lerpVectors(p, q, t);
      this.pts[i].y -= sag * 4 * t * (1 - t);
    }
    liftAboveFurniture(this.pts, 0.006);
    this.cable.setPoints(this.pts);
  }
}

export class WireSystem {
  readonly wires: Wire[] = [];
  /** 연결을 시작한 단자 (다른 단자를 탭하기를 기다리는 중) */
  pending: Terminal | null = null;

  constructor(private scene: THREE.Scene) {}

  /** 단자를 탭했을 때의 동작 */
  actionsFor(t: Terminal): Action[] {
    const p = this.pending;
    if (p && p !== t) {
      const far = p.worldPosition().distanceTo(t.worldPosition()) > WIRE_MAX;
      return far
        ? [{ label: `도선이 닿지 않음 (최대 ${WIRE_MAX} m)`, run: () => { this.pending = null; } }]
        : [{ label: `도선 연결 → ${t.label}`, run: () => this.connect(p, t) }];
    }
    if (p === t) return [{ label: '도선 연결 취소', run: () => { this.pending = null; } }];
    const out: Action[] = [{ label: `도선 연결 시작 · ${t.label}`, run: () => { this.pending = t; } }];
    for (const w of t.wires) {
      const other = w.a === t ? w.b : w.a;
      out.push({ label: `도선 빼기 (↔ ${other.label})`, run: () => this.remove(w) });
    }
    return out;
  }

  connect(a: Terminal, b: Terminal): void {
    this.pending = null;
    if (a.wires.some((w) => w.a === b || w.b === b)) return; // 이미 이어져 있음
    // 빨강 선(+ 쪽이 끼면)·파랑 선. (검정 선은 검은 실험대 위에서 보이지 않아 교육용 키트처럼 파랑을 쓴다)
    const w = new Wire(a, b, a.polarity === '+' || b.polarity === '+' ? 0xe0463c : 0x3f7fd8);
    a.wires.push(w);
    b.wires.push(w);
    this.wires.push(w);
    this.scene.add(w.line);
    w.redraw();
  }

  remove(w: Wire): void {
    for (const t of [w.a, w.b]) t.wires.splice(t.wires.indexOf(w), 1);
    this.wires.splice(this.wires.indexOf(w), 1);
    w.line.removeFromParent();
  }

  /** 매 프레임: 너무 멀어진 도선은 빠지고, 나머지는 다시 그린다 */
  update(): void {
    for (const w of [...this.wires]) {
      if (w.length() > WIRE_MAX) this.remove(w);
      else w.redraw();
    }
  }

  /**
   * 마디(같은 전위로 묶인 단자 무리) 번호: 도선으로 이어진 단자는 같은 번호.
   * @param extra 이상적인 전류계처럼 "저항 0"으로 보고 함께 묶을 단자 쌍
   */
  nodeOf(extra: [Terminal, Terminal][] = []): (t: Terminal) => Terminal {
    const parent = new Map<Terminal, Terminal>();
    const find = (t: Terminal): Terminal => {
      let r = t;
      while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
      parent.set(t, r);
      return r;
    };
    const union = (a: Terminal, b: Terminal) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    for (const w of this.wires) union(w.a, w.b);
    for (const [a, b] of extra) union(a, b);
    return find;
  }
}
