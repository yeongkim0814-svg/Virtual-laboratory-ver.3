/**
 * 레이저 광선 추적: 매 프레임, 빛이 나오는 레이저마다 빛이 어디로 가는지 따라간다.
 *
 *   레이저 출구 ──광선──▶ 처음 맞는 물체
 *     · 슬릿판: 맞은 점이 미세 조정 범위(±2 cm) 안이고 판이 너무 비스듬하지 않으면 통과
 *               → 회절·간섭된 빛이 계속 진행 (아니면 판에 막혀 빛 점)
 *     · 그 밖의 면(스크린·벽·책상·다른 기구): 빛이 닿은 자리에 "빛 무늬 데칼"이 비친다
 *
 * 빛 무늬 데칼: 닿은 면에 붙는 얇은 사각형. 텍셀마다 월드 위치를 구하고, 슬릿에서 본 방향으로
 * 파동 광학 식(sim/optics.ts)의 세기를 계산해 그린다. 해상도가 높아 가까이 가면 밝은 무늬 하나하나가 보인다.
 * 무늬 간격 Δy = λL/d 이므로 스크린을 멀리 둘수록(L이 클수록) 무늬가 넓어져 잘 보인다.
 *
 * 슬릿판이 빛에 대해 기울어 있으면: 이웃한 두 슬릿에 빛이 도착하는 시점부터 다르므로
 * 경로차 = d·(sinθ_나감 − sinθ_들어옴). 그래서 세기 계산에 들어온 빛의 가로 성분(inH)을 뺀다.
 */
import * as THREE from 'three';
import { HITBOX_MAT, type Item } from '../world/items';
import { isPickable, itemOf } from '../player/hand';
import { Laser, OpticScreen, SlitPlate, type LightPattern } from './optics';
import { intensity } from '../sim/optics';
import { Phototube } from './electrical';

const MAX_DIST = 12;
const DECAL_W = 512; // 데칼 텍스처 가로 텍셀
const DECAL_H = 32;

/** 면에 붙는 빛 무늬 */
class LightDecal {
  readonly mesh: THREE.Mesh;
  private tex: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private key = '';
  private basis = new THREE.Matrix4();

  constructor(scene: THREE.Scene) {
    const c = document.createElement('canvas');
    c.width = DECAL_W;
    c.height = DECAL_H;
    this.ctx = c.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: this.tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      }),
    );
    this.mesh.raycast = () => {};
    this.mesh.userData.noPick = true;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  hide(): void {
    this.mesh.visible = false;
  }

  /**
   * @param hit 빛이 닿은 점, n 그 면의 법선 (빛이 오는 쪽)
   */
  show(light: LightPattern, hit: THREE.Vector3, n: THREE.Vector3): void {
    // 크기: 슬릿을 지났으면 회절 봉투(중앙 무늬 폭 2λL/a)의 약 2배, 아니면 1.2 cm 점
    const W = light.ap ? THREE.MathUtils.clamp((4 * light.lambda * light.L) / light.ap.a, 0.04, 1.5) : 0.012;
    const H = light.ap ? 0.02 : 0.012;
    // 데칼의 가로축 = 무늬 방향을 면에 투영한 것
    const h = light.axisH.clone().addScaledVector(n, -light.axisH.dot(n));
    if (h.lengthSq() < 1e-6) h.set(0, 1, 0).cross(n);
    h.normalize();
    const vtc = new THREE.Vector3().crossVectors(n, h).normalize();
    this.basis.makeBasis(h, vtc, n);
    this.mesh.quaternion.setFromRotationMatrix(this.basis);
    this.mesh.position.copy(hit).addScaledVector(n, 0.0015);
    this.mesh.scale.set(W, H, 1);
    this.mesh.visible = true;

    const key = [light.lambda, light.ap?.d, light.ap?.a, light.ap?.kind, ...light.source.toArray(), ...hit.toArray(), ...n.toArray(), ...light.axisH.toArray()]
      .map((x) => (typeof x === 'number' ? x.toFixed(4) : String(x))).join();
    if (key !== this.key) {
      this.key = key;
      this.draw(light, hit, h, vtc, W, H);
    }
  }

  private draw(light: LightPattern, hit: THREE.Vector3, h: THREE.Vector3, vtc: THREE.Vector3, W: number, H: number): void {
    const img = this.ctx.createImageData(DECAL_W, DECAL_H);
    const sigma = Math.max(0.0015, (1.5 * H) / DECAL_H); // 빔 반지름 ≈ 1.5 mm
    const P = new THREE.Vector3();
    const rel = new THREE.Vector3();
    const { r: cr, g: cg, b: cb } = light.color;
    for (let j = 0; j < DECAL_H; j++) {
      const t = (0.5 - (j + 0.5) / DECAL_H) * H;
      for (let i = 0; i < DECAL_W; i++) {
        const s = ((i + 0.5) / DECAL_W - 0.5) * W;
        P.copy(hit).addScaledVector(h, s).addScaledVector(vtc, t);
        let I: number;
        if (light.ap) {
          rel.subVectors(P, light.source);
          const vert = rel.dot(light.axisV);
          const q = rel.normalize().dot(light.axisH) - light.inH; // sinθ_나감 − sinθ_들어옴
          I = intensity(light.ap, light.lambda, q) * Math.exp(-(vert * vert) / (2 * sigma * sigma));
        } else {
          I = Math.exp(-P.distanceToSquared(hit) / (2 * sigma * sigma));
        }
        const k = (j * DECAL_W + i) * 4;
        const e = Math.min(1, I * 2.2);
        const hot = 0.45 * e * e; // 밝은 곳은 하얗게 타는 느낌
        img.data[k] = 255 * Math.min(1, cr * e + hot);
        img.data[k + 1] = 255 * Math.min(1, cg * e + hot);
        img.data[k + 2] = 255 * Math.min(1, cb * e + hot);
        img.data[k + 3] = 255;
      }
    }
    this.ctx.putImageData(img, 0, 0);
    this.tex.needsUpdate = true;
  }
}

/** 레이저 한 대의 화면 표현: 광선(최대 2토막) + 빛 무늬 데칼 */
class BeamVisual {
  readonly line: THREE.LineSegments;
  readonly decal: LightDecal;
  private pos = new Float32Array(12);

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5 }));
    this.line.raycast = () => {};
    this.line.frustumCulled = false;
    this.line.userData.noPick = true;
    this.line.visible = false;
    scene.add(this.line);
    this.decal = new LightDecal(scene);
  }

  setSegments(segs: [THREE.Vector3, THREE.Vector3][], color: THREE.Color): void {
    this.pos.fill(0);
    segs.forEach(([a, b], i) => {
      a.toArray(this.pos, i * 6);
      b.toArray(this.pos, i * 6 + 3);
    });
    (this.line.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.line.geometry.setDrawRange(0, segs.length * 2);
    (this.line.material as THREE.LineBasicMaterial).color.copy(color);
    this.line.visible = segs.length > 0;
  }

  hide(): void {
    this.line.visible = false;
    this.decal.hide();
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
    for (const item of this.items) if (item instanceof Phototube) item.light = null;
    for (const item of this.items) {
      if (!(item instanceof Laser)) continue;
      let vis = this.visuals.get(item);
      if (!vis) this.visuals.set(item, (vis = new BeamVisual(this.scene)));
      item.updateLed();
      // 빛이 나오고, 손에 들고 있지 않을 때만 (조립체가 장면에 놓여 있음)
      if (!item.emitting || item.root().object.parent !== this.scene) {
        vis.hide();
        item.pattern = null;
        item.alignHint = null;
        continue;
      }
      this.trace(item, vis);
    }
  }

  private trace(laser: Laser, vis: BeamVisual): void {
    laser.object.updateWorldMatrix(true, false);
    const origin = laser.object.localToWorld(laser.aperture.clone());
    const dir = new THREE.Vector3(1, 0, 0).transformDirection(laser.object.matrixWorld);
    const segs: [THREE.Vector3, THREE.Vector3][] = [];
    const m = laser.object.matrixWorld;
    let light: LightPattern = {
      lambda: laser.lambda, color: laser.color, ap: null, source: origin, dir,
      axisH: new THREE.Vector3(0, 0, 1).transformDirection(m), axisV: new THREE.Vector3(0, 1, 0).transformDirection(m),
      inH: 0, L: 0, surface: '',
    };

    let hit = this.cast(origin, dir, laser.object);
    let from = origin;
    laser.alignHint = null;
    const plate = hit && itemOf(hit.object);
    if (hit && plate instanceof SlitPlate) {
      plate.object.updateWorldMatrix(true, false);
      const pm = plate.object.matrixWorld;
      const normal = new THREE.Vector3(1, 0, 0).transformDirection(pm);
      const local = plate.object.worldToLocal(hit.point.clone());
      const facing = Math.abs(normal.dot(dir)) > 0.5;
      if (!plate.inWindow(local)) laser.alignHint = plate.missHint(local);
      else if (!facing) laser.alignHint = '슬릿판이 빛에 대해 너무 비스듬함 (60° 넘게 돌아감)';
      // 미세 조정 범위 안 + 판이 빛에 대해 60°보다 덜 기울었을 때만 통과
      if (!laser.alignHint) {
        segs.push([from, hit.point.clone()]);
        const axisH = new THREE.Vector3(0, 0, 1).transformDirection(pm);
        light = {
          ...light, ap: plate.ap, source: hit.point.clone(), axisH,
          axisV: new THREE.Vector3(0, 1, 0).transformDirection(pm), inH: dir.dot(axisH),
        };
        from = hit.point.clone().addScaledVector(dir, 0.003);
        hit = this.cast(from, dir, plate.object);
      }
    }

    if (!hit) {
      segs.push([from, from.clone().addScaledVector(dir, MAX_DIST)]);
      vis.setSegments(segs, laser.color);
      vis.decal.hide();
      laser.pattern = null;
      return;
    }
    segs.push([from, hit.point.clone()]);
    vis.setSegments(segs, laser.color);

    const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : dir.clone().negate();
    if (n.dot(dir) > 0) n.negate(); // 빛이 오는 쪽을 향하게
    const target = itemOf(hit.object);
    light.L = hit.point.distanceTo(light.source);
    light.surface = target instanceof OpticScreen ? '스크린' : target ? target.name : '벽·가구 면';
    laser.pattern = light;
    // 광전관에 닿으면 음극에 빛이 들어간다 (슬릿을 지난 빛은 대부분 막혀 약 5 %만)
    if (target instanceof Phototube) {
      const powerW = laser.powerMw * 1e-3 * (light.ap ? 0.05 : 1);
      target.light = { lambda: laser.lambda, powerW: (target.light?.powerW ?? 0) + powerW };
    }
    vis.decal.show(light, hit.point, n);
  }
}
