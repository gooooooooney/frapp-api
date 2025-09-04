// WebSocket endpoint for audio streaming
import { initializeAudioEnv, handleAudioSession, } from '../app/audio-utils';
import type { Context } from 'hono';

export async function handleWebSocket(c: Context): Promise<Response> {
  const request = c.req.raw;
  const env = c.env;
  
  const upgradeHeader = request.headers.get("Upgrade");
  if (upgradeHeader !== "websocket") {
    return new Response("Expected websocket", { status: 400 });
  }

  // Initialize audio environment
  initializeAudioEnv(env);

  const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
  handleAudioSession(server);

  return new Response(null, {
    status: 101,
    webSocket: client
  });
}