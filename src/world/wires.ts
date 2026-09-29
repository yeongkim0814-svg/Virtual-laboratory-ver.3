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
import { Cable, endToEndPath, settle } from './cable';

const WIRE_MAX = 1.5; // m
const KNOB_RED = new THREE.MeshLambertMaterial({ color: 0xc0302a });
const KNOB_BLACK = new THREE.MeshLambertMaterial({ color: 0x1a1a18 });
const KNOB_BRASS = new THREE.MeshLambertMaterial({ color: 0xc8a040 });

export class Terminal {
  readonly wires: Wire[] = [];
  private anchor = new THREE.Object3D();

  /**
   * @param owner 단자가 달린 기구, name 안내용 이름 (예: "양극(+)")
   * @param polarity '+'(빨강) 또는 '−'(검정), 'n'(놋쇠: 극성 없는 저항·전구·스위치)
   * @param local 기구 좌표에서의 위치, facing 단자가 튀어나온 방향 (기구 좌표)
   */
  constructor(readonly owner: Item, readonly name: string, readonly polarity: '+' | '-' | 'n', local: THREE.Vector3, facing: THREE.Vector3) {
    this.anchor.position.copy(local);
    this.anchor.lookAt(local.clone().add(facing));
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.014, 6).rotateX(Math.PI / 2), polarity === '+' ? KNOB_RED : polarity === '-' ? KNOB_BLACK : KNOB_BRASS);
    knob.position.z = 0.007;
    knob.userData.cableIgnore = true; // 도선이 넘어가야 할 장애물로 보지 않음
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

  /** 단자가 튀어나온 방향 (월드, 단위 벡터) */
  worldFacing(): THREE.Vector3 {
    this.anchor.updateWorldMatrix(true, false);
    return new THREE.Vector3(0, 0, 1).transformDirection(this.anchor.matrixWorld);
  }
}

export class Wire {
  readonly cable: Cable;
  // 점 간격이 가장자리 여유(3 cm)보다 촘촘하도록: 최대 1.5 m + 처짐 → 72점
  private pts = Array.from({ length: 72 }, () => new THREE.Vector3());

  constructor(readonly a: Terminal, readonly b: Terminal, color: number) {
    this.cable = new Cable(this.pts.length, 0.005, color);
  }

  get line(): THREE.Object3D {
    return this.cable.mesh;
  }

  length(): number {
    return this.a.worldPosition().distanceTo(this.b.worldPosition());
  }

  /**
   * 단자에서 바깥으로 3 cm 뻗은 뒤 놓인 면으로 내려가, 그 면 위의 장비를 옆으로 돌아서(길찾기) 다른 단자로 간다.
   * 높이가 다른 면(책상 ↔ 바닥)이면 책상 가장자리를 넘어 늘어진다.
   */
  redraw(): void {
    const CLR = 0.006;
    const path = endToEndPath(this.a.worldPosition(), this.a.worldFacing(), this.b.worldPosition(), this.b.worldFacing(), CLR);
    settle(path, this.pts, CLR);
    this.cable.setPoints(this.pts);
  }
}

export class WireSystem {
  readonly wires: Wire[] = [];
  /** 연결을 시작한 단자 (다른 단자를 탭하기를 기다리는 중) */
  pending: Terminal | null = null;
  /** 도선 잇기·빼기를 실제로 하는 곳 — main이 명령 버스로 바꿔 끼운다 (기본은 바로 실행) */
  requestConnect: (a: Terminal, b: Terminal) => void = (a, b) => this.connect(a, b);
  requestRemove: (w: Wire) => void = (w) => this.remove(w);
  /** 연결 중일 때 단자 → 조준점까지 보여 주는 미리 보기 선 */
  private preview = new Cable(20, 0.004, 0xffd27a);
  private previewPts = Array.from({ length: 20 }, () => new THREE.Vector3());

  constructor(private scene: THREE.Scene) {
    this.preview.mesh.visible = false;
    scene.add(this.preview.mesh);
  }

  /** 미리 보기 선을 조준점 to까지 (null이면 숨김) */
  updatePreview(to: THREE.Vector3 | null): void {
    const p = this.pending;
    this.preview.mesh.visible = !!(p && to);
    if (!p || !to) return;
    const a = p.worldPosition();
    const n = this.previewPts.length;
    const sag = 0.1 * a.distanceTo(to);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      this.previewPts[i].lerpVectors(a, to, t).y -= sag * 4 * t * (1 - t);
    }
    this.preview.setPoints(this.previewPts);
  }

  /** 단자를 탭했을 때의 동작 */
  actionsFor(t: Terminal): Action[] {
    const p = this.pending;
    if (p && p !== t) {
      const far = p.worldPosition().distanceTo(t.worldPosition()) > WIRE_MAX;
      return far
        ? [{ label: `도선이 닿지 않음 (최대 ${WIRE_MAX} m)`, local: true, run: () => { this.pending = null; } }]
        : [{ label: `도선 연결 → ${t.label}`, run: () => { this.pending = null; this.requestConnect(p, t); } }];
    }
    // 연결 시작·취소는 내 손의 상태일 뿐 (도선이 실제로 생기는 순간만 명령)
    if (p === t) return [{ label: '도선 연결 취소', local: true, run: () => { this.pending = null; } }];
    const out: Action[] = [{ label: `도선 연결 시작 · ${t.label}`, local: true, run: () => { this.pending = t; } }];
    for (const w of t.wires) {
      const other = w.a === t ? w.b : w.a;
      out.push({ label: `도선 빼기 (↔ ${other.label})`, run: () => this.requestRemove(w) });
    }
    return out;
  }

  connect(a: Terminal, b: Terminal): void {
    this.pending = null;
    if (a.wires.some((w) => w.a === b || w.b === b)) return; // 이미 이어져 있음
    // 빨강 선(+ 쪽이 끼면)·파랑 선. (검정 선은 검은 실험대 위에서 보이지 않아 교육용 키트처럼 파랑을 쓴다)
    // 극성 없는 단자끼리(저항·전구 사이)는 노랑 선
    const color = a.polarity === '+' || b.polarity === '+' ? 0xe0463c : a.polarity === '-' || b.polarity === '-' ? 0x3f7fd8 : 0xe0b030;
    const w = new Wire(a, b, color);
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
