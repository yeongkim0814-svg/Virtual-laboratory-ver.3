import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// base: './' → 어떤 주소(GitHub Pages 하위 경로 등)에 올려도 동작하도록 상대 경로 사용
// `npm run build:single` → 모든 코드를 HTML 한 파일에 넣은 버전(dist-single/)을 만든다.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: { chunkSizeWarningLimit: 1000, outDir: mode === 'single' ? 'dist-single' : 'dist' },
}));
