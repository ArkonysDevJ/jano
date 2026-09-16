import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Plain Vite dev/build config for now -- no Tauri dependency yet (see
 * apps/desktop/README.md). Pre-set to the conventions `tauri init`
 * expects so adding Tauri later needs zero changes here:
 * - Fixed, strict port (1420, the create-tauri-app/Tauri convention) --
 *   `tauri.conf.json`'s `build.devUrl` will point at
 *   `http://localhost:1420` once `src-tauri/` exists.
 * - `clearScreen: false` so Vite doesn't wipe Rust/Tauri's own
 *   terminal output once both run side by side.
 */
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
});
