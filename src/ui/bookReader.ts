/**
 * 교재 읽기 화면: 왼쪽 차례, 오른쪽 본문(장 하나), 아래 이전·다음
 * 마지막으로 읽던 장은 기기에 기억해 둔다 (localStorage, 실패해도 무시)
 */
import type { Book } from '../content/books';

export class BookReader {
  readonly el = byId('book');
  private book: Book | null = null;
  private page = 0;

  constructor(private onToggle: (open: boolean) => void) {
    byId('book-close').addEventListener('click', () => this.close());
    byId('book-prev').addEventListener('click', () => this.go(this.page - 1));
    byId('book-next').addEventListener('click', () => this.go(this.page + 1));
    byId('book-toc-toggle').addEventListener('click', () => this.el.classList.toggle('toc-open'));
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(book: Book): void {
    this.book = book;
    this.el.dataset.book = book.id;
    byId('book-title').textContent = book.title;
    byId('book-sub').textContent = book.subtitle;
    const toc = byId('book-toc');
    toc.innerHTML = '';
    book.chapters.forEach((ch, i) => {
      const b = document.createElement('button');
      b.textContent = ch.title;
      b.addEventListener('click', () => { this.go(i); this.el.classList.remove('toc-open'); });
      toc.appendChild(b);
    });
    let saved = 0;
    try {
      saved = Number(localStorage.getItem(`vlab-book-${book.id}`) ?? 0) || 0;
    } catch { /* 저장소를 못 쓰면 첫 장부터 */ }
    this.el.hidden = false;
    this.onToggle(true);
    this.go(saved);
  }

  close(): void {
    this.el.hidden = true;
    this.el.classList.remove('toc-open');
    this.onToggle(false);
  }

  private go(i: number): void {
    const book = this.book;
    if (!book) return;
    this.page = Math.max(0, Math.min(book.chapters.length - 1, i));
    const ch = book.chapters[this.page];
    const body = byId('book-body');
    body.innerHTML = `<h2>${ch.title}</h2>${ch.html}`;
    body.scrollTop = 0;
    byId('book-toc').querySelectorAll('button').forEach((b, k) => b.setAttribute('aria-current', String(k === this.page)));
    byId<HTMLButtonElement>('book-prev').disabled = this.page === 0;
    byId<HTMLButtonElement>('book-next').disabled = this.page === book.chapters.length - 1;
    byId('book-page').textContent = `${this.page + 1} / ${book.chapters.length}`;
    try {
      localStorage.setItem(`vlab-book-${book.id}`, String(this.page));
    } catch { /* 무시 */ }
  }
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
