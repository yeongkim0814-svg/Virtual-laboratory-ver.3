/**
 * 레이저 광선 추적: 매 프레임, 켜진 레이저마다 빛이 어디로 가는지 따라간다.
 *
 *   레이저 출구 ──광선──▶ 처음 맞는 물체
 *     · 슬릿판: 맞은 점이 슬릿 창 안이면 통과 → 회절·간섭된 빛이 계속 진행 (창 밖이면 판에 막힘)
 *     · 스크린: 빛(점 또는 간섭무늬)이 비친다
 *     · 그 밖의 면(벽·책상·다른 기구): 작은 빛 점이 찍힌다
 *
 * 광선은 "빛의 중심선"만 따라가고, 실제 무늬의 모양은 스크린이 파동 광학 식(sim/optics.ts)으로 계산한다.
 */
import * as THREE from 'three';
import { HITBOX_MAT, type Item } from '../world/items';
import { isPickable, itemOf } from '../player/hand';
import { Laser, OpticScreen, SlitPlate, type ScreenLight } from './optics';

const MAX_DIST = 12;

class BeamVisual {
  readonly line: THREE.LineSegments;
  readonly spot: THREE.Mesh;
  private pos = new Float32Array(12);

  constructor(scene: THREE.Scene, color: THREE.Color) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 }));
    this.line.raycast = () => {};
    this.line.frustumCulled = false;
    this.spot = new THREE.Mesh(
      new THREE.CircleGeometry(0.006, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.spot.raycast = () => {};
    for (const o of [this.line, this.spot]) {
      o.userData.noPick = true;
      o.visible = false;
      scene.add(o);
    }
  }

  /** 선분 최대 2개 (레이저 → 슬릿, 슬릿 → 스크린) */
  setSegments(segs: [THREE.Vector3, THREE.Vector3][]): void {
    this.pos.fill(0);
    segs.forEach(([a, b], i) => {
      a.toArray(this.pos, i * 6);
      b.toArray(this.pos, i * 6 + 3);
    });
    const attr = this.line.geometry.attributes.position as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.line.geometry.setDrawRange(0, segs.length * 2);
    this.line.visible = segs.length > 0;
  }

  showSpot(point: THREE.Vector3 | null, normal?: THREE.Vector3): void {
    this.spot.visible = !!point;
    if (!point || !normal) return;
    this.spot.position.copy(point).addScaledVector(normal, 0.002);
    this.spot.lookAt(point.clone().add(normal));
  }

  hide(): void {
    this.line.visible = false;
    this.spot.visible = false;
  }
}

export class BeamSystem {
  private raycaster = new THREE.Raycaster();
  private visuals = new Map<Laser, BeamVisual>();

  constructor(private scene: THREE.Scene, private items: Item[]) {}

  /** 광선이 처음 맞는 면 (제외: 보이지 않는 판정 영역, 표시용 물체, exclude 안의 물체) */
  private cast(origin: THREE.Vector3, dir: THREE.Vector3, exclude: THREE.Object3D): THREE.Intersection | null {
    this.raycaster.set(origin, dir);
    this.raycaster.far = MAX_DIST;
    for (const h of this.raycaster.intersectObjects(this.scene.children, true)) {
      if (!isPickable(h.object)) continue;
      if ((h.object as THREE.Mesh).material === HITBOX_MAT) continue;
      let inside = false;
      for (let o: THREE.Object3D | null = h.object; o; o = o.parent) if (o === exclude) inside = true;
      if (!inside) return h;
    }
    return null;
  }

  update(): void {
    const lit = new Map<OpticScreen, ScreenLight>();
    for (const item of this.items) {
      if (!(item instanceof Laser)) continue;
      let vis = this.visuals.get(item);
      if (!vis) this.visuals.set(item, (vis = new BeamVisual(this.scene, item.color)));
      // 켜져 있고, 손에 들고 있지 않을 때만 (조립체가 장면에 놓여 있음)
      if (!item.on || item.root().object.parent !== this.scene) {
        vis.hide();
        continue;
      }
      this.trace(item, vis, lit);
    }
    for (const it of this.items) if (it instanceof OpticScreen) it.setLight(lit.get(it) ?? null);
  }

  private trace(laser: Laser, vis: BeamVisual, lit: Map<OpticScreen, ScreenLight>): void {
    laser.object.updateWorldMatrix(true, false);
    const origin = laser.object.localToWorld(laser.aperture.clone());
    const dir = new THREE.Vector3(1, 0, 0).transformDirection(laser.object.matrixWorld);
    const segs: [THREE.Vector3, THREE.Vector3][] = [];

    let hit = this.cast(origin, dir, laser.object);
    let from = origin;
    let light: Omit<ScreenLight, 'L'> = {
      lambda: laser.lambda, color: laser.color, ap: null, source: origin, dir,
      axisH: new THREE.Vector3(0, 0, 1).transformDirection(laser.object.matrixWorld),
      axisV: new THREE.Vector3(0, 1, 0),
    };

    // 슬릿판을 만나면: 창 안이면 통과시키고 한 번 더 추적
    const plate = hit && itemOf(hit.object);
    if (hit && plate instanceof SlitPlate && plate.inWindow(plate.object.worldToLocal(hit.point.clone()))) {
      segs.push([from, hit.point.clone()]);
      plate.object.updateWorldMatrix(true, false);
      const m = plate.object.matrixWorld;
      // 무늬는 슬릿에 수직인 방향(판의 가로 = 물체 z축)으로 퍼진다
      light = {
        ...light,
        ap: plate.ap,
        source: plate.object.localToWorld(new THREE.Vector3(0, hit.point.clone().applyMatrix4(m.clone().invert()).y, 0)),
        axisH: new THREE.Vector3(0, 0, 1).transformDirection(m),
        axisV: new THREE.Vector3(0, 1, 0).transformDirection(m),
      };
      from = hit.point.clone().addScaledVector(dir, 0.003);
      hit = this.cast(from, dir, plate.object);
    }

    if (!hit) {
      segs.push([from, from.clone().addScaledVector(dir, MAX_DIST)]);
      vis.setSegments(segs);
      vis.showSpot(null);
      return;
    }
    segs.push([from, hit.point.clone()]);
    vis.setSegments(segs);

    const target = itemOf(hit.object);
    if (target instanceof OpticScreen && hit.object === target.face) {
      lit.set(target, { ...light, L: hit.point.distanceTo(light.source) });
      vis.showSpot(null);
    } else {
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : dir.clone().negate();
      vis.showSpot(hit.point, n);
    }
  }
}
