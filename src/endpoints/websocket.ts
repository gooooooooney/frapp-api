// WebSocket endpoint with First Message Authentication (Best Practice)
import { initializeAudioEnv, handleSecureAudioSession } from '../app/audio-utils';
import type { Context } from 'hono';

export async function handleWebSocket(c: Context): Promise<Response> {
  const request = c.req.raw;
  const env = c.env;
  
  console.log('🔌 WebSocket connection attempt:', {
    url: request.url,
    headers: Object.fromEntries(request.headers.entries())
  });
  
  const upgradeHeader = request.headers.get("Upgrade");
  if (upgradeHeader !== "websocket") {
    console.error('❌ Invalid upgrade header:', upgradeHeader);
    return new Response("Expected websocket", { status: 400 });
  }

  // Origin validation with better debugging
  const origin = request.headers.get("Origin");
  console.log('🔍 Origin validation - Origin:', origin);
  
  // Use production-friendly origin validation
  const allowedOrigins = [
    'localhost',
    '127.0.0.1',
    'frapp-api-v1.frapp.ai',  // Production domain
    ...((env.CLERK_AUTHORIZED_PARTIES || '').split(',').filter(Boolean))
  ];
  
  console.log('🔍 Allowed origins:', allowedOrigins);
  
  if (origin) {
    const originHost = new URL(origin).hostname;
    console.log('🔍 Origin hostname:', originHost);
    
    const isAllowed = allowedOrigins.some(allowed => {
      const allowedHost = allowed.includes(':') ? allowed.split(':')[0] : allowed;
      const matches = originHost === allowedHost || originHost.endsWith('.' + allowedHost);
      console.log(`🔍 Checking ${originHost} against ${allowedHost}: ${matches}`);
      return matches;
    });
    
    if (!isAllowed) {
      console.error('❌ Origin not allowed:', originHost, 'Allowed:', allowedOrigins);
      return new Response("Forbidden: Invalid origin", { status: 403 });
    }
    
    console.log('✅ Origin validation passed:', originHost);
  }

  try {
    // Initialize audio environment
    console.log('🎵 Initializing audio environment...');
    initializeAudioEnv(env);

    // Create WebSocket pair
    console.log('🔌 Creating WebSocket pair...');
    const webSocketPair = new WebSocketPair();
    const [client, server] = [webSocketPair[0], webSocketPair[1]];
    
    // Add connection event handlers for debugging
    server.addEventListener('open', () => {
      console.log('✅ Server WebSocket opened');
    });
    
    server.addEventListener('error', (event) => {
      console.error('❌ Server WebSocket error:', event);
    });
    
    server.addEventListener('close', (event) => {
      console.log('🔌 Server WebSocket closed:', event.code, event.reason);
    });

    // Pass WebSocket to secure session handler (handles first-message auth)
    console.log('🔐 Setting up secure session handler...');
    handleSecureAudioSession(server, env);

    console.log('✅ WebSocket upgrade successful, returning client');
    
    // Note: server.accept() is called in handleSecureAudioSession()

    return new Response(null, {
      status: 101,
      webSocket: client
    });
    
  } catch (error) {
    console.error('❌ WebSocket setup failed:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(`WebSocket setup failed: ${errorMessage}`, { status: 500 });
  }
}