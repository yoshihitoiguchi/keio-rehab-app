import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ビルドごとの識別子。公開中の画面が「新しい版が出たか」を知るために使う。
// （dist/version.json に書き出し、アプリ側の値と比べる）
const BUILD_ID = new Date().toISOString();

function versionFile() {
  return {
    name: "resprint-version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: BUILD_ID }) });
    },
  };
}

export default defineConfig({
  plugins: [react(), versionFile()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
});
