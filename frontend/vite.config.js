import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8787', // Wrangler dev server default port
        changeOrigin: true,
        ws: true, // Enable WebSocket proxying
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            console.log('proxy error', err);
          });
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            console.log('Sending Request to the Target:', req.method, req.url);
            // Forward cookies from the original request for authentication
            if (req.headers.cookie) {
              proxyReq.setHeader('cookie', req.headers.cookie);
            }
            // Forward Authorization header if present
            if (req.headers.authorization) {
              proxyReq.setHeader('authorization', req.headers.authorization);
            }
          });
          proxy.on('proxyRes', (proxyRes, req, res) => {
            console.log('Received Response from the Target:', proxyRes.statusCode, req.url);
            // Forward Set-Cookie headers back to the client
            if (proxyRes.headers['set-cookie']) {
              res.setHeader('set-cookie', proxyRes.headers['set-cookie']);
            }
          });
        },
      }
    }
  }
})