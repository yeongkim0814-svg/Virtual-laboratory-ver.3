/**
 * 실험 교재 (교탁 위): 한 번 탭 = 집기, 두 번 탭 = 펼쳐 읽기
 * 표지는 캔버스로 그린 제목 (레트로 화면에서도 읽히도록 큰 글씨)
 */
import * as THREE from 'three';
import { Item } from '../world/items';
import type { Action } from '../world/interactable';
import type { Book } from '../content/books';

export class Textbook extends Item {
  onOpen: (b: Textbook) => void = () => {};

  constructor(readonly book: Book, color: number) {
    const W = 0.19;
    const D = 0.26;
    const T = 0.028;
    const g = new THREE.Group();
    const coverMat = new THREE.MeshLambertMaterial({ map: coverTexture(book, color) });
    const side = new THREE.MeshLambertMaterial({ color });
    const pages = new THREE.MeshLambertMaterial({ color: 0xece4cc });
    // 상자 면 순서: +x, −x, +y, −y, +z, −z → 윗면만 표지 그림, 책등(−x)은 색, 나머지 세 옆면은 종이
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, T, D), [pages, side, coverMat, side, pages, pages]);
    body.position.y = T / 2;
    g.add(body);
    super(g, { name: book.title, radius: 0.13, mass: 0.6 });
  }

  extraActions(): Action[] {
    return [{ label: '교재 펼치기', run: () => this.onOpen(this) }];
  }
}

function coverTexture(book: Book, color: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 176;
  const g = c.getContext('2d')!;
  g.fillStyle = `#${new THREE.Color(color).getHexString()}`;
  g.fillRect(0, 0, 128, 176);
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.fillRect(0, 0, 10, 176); // 책등 쪽 띠
  g.strokeStyle = '#f2e6c8';
  g.lineWidth = 2;
  g.strokeRect(16, 14, 104, 148);
  g.fillStyle = '#f7ecd0';
  g.textAlign = 'center';
  g.font = 'bold 24px Galmuri11, monospace';
  g.fillText(book.title.slice(0, 2), 68, 62); // "물리" · "화학"
  g.font = '15px Galmuri11, monospace';
  g.fillText(book.title.slice(3), 68, 88); // "실험 교재"
  g.font = '10px Galmuri11, monospace';
  g.fillText(book.id === 'physics' ? 'F = ma · V = IR' : 'pH = −log[H⁺]', 68, 140);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}
