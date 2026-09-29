import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// base: './' → 어떤 주소(GitHub Pages 하위 경로 등)에 올려도 동작하도록 상대 경로 사용
//   npm run build        → dist/        (확인용)
//   npm run build:docs   → docs/        (GitHub Pages가 이 폴더를 그대로 웹에 올린다)
//   npm run build:single → dist-single/ (모든 코드를 HTML 한 파일에)
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: {
    chunkSizeWarningLimit: 1000,
    outDir: mode === 'single' ? 'dist-single' : mode === 'docs' ? 'docs' : 'dist',
    emptyOutDir: true,
  },
}));
