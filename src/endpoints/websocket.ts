// WebSocket endpoint with First Message Authentication (Best Practice)
import { initializeAudioEnv, handleSecureAudioSession } from '../app/audio-utils';
import type { Context } from 'hono';

export async function handleWebSocket(c: Context): Promise<Response> {
  const request = c.req.raw;
  const env = c.env;
  
  const upgradeHeader = request.headers.get("Upgrade");
  if (upgradeHeader !== "websocket") {
    return new Response("Expected websocket", { status: 400 });
  }

  // Origin validation (CSRF protection)
  const origin = request.headers.get("Origin");
  const allowedOrigins = (env.CLERK_AUTHORIZED_PARTIES || 'localhost:3000').split(',');
  
  if (origin) {
    const originHost = new URL(origin).hostname;
    const isAllowed = allowedOrigins.some(allowed => {
      const allowedHost = allowed.includes(':') ? allowed.split(':')[0] : allowed;
      return originHost === allowedHost || originHost.endsWith('.' + allowedHost);
    });
    
    if (!isAllowed) {
      return new Response("Forbidden: Invalid origin", { status: 403 });
    }
  }

  // Initialize audio environment
  initializeAudioEnv(env);

  const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
  
  // Pass WebSocket to secure session handler (handles first-message auth)
  handleSecureAudioSession(server, env);

  return new Response(null, {
    status: 101,
    webSocket: client
  });
}