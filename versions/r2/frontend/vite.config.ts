import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      // バックエンドのファイル変更でHMRがトリガーされないように、絶対パスで無視設定を強化
      ignored: [
        path.resolve(__dirname, 'cloudrun_api')
      ],
    },
  },
})