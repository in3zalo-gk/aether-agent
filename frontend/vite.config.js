import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import {fileURLToPath,URL} from 'node:url'
export default defineConfig({
 root:fileURLToPath(new URL('.',import.meta.url)),
 plugins:[react()],
 build:{target:'es2022',outDir:'dist',emptyOutDir:true},
 server:{host:'127.0.0.1',proxy:{'/api':{target:'http://127.0.0.1:8787',changeOrigin:true}}}
})
