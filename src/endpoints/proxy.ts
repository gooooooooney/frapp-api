// API proxy handler for proxying requests to external APIs
import type { Context } from 'hono';

export async function handleApiProxy(c: Context): Promise<Response> {
  const request = c.req.raw;
  const OPENAI_API_HOST = "api.groq.com";
  const newUrl = new URL(request.url);
  newUrl.hostname = OPENAI_API_HOST;

  const modifiedRequest = new Request(newUrl, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });

  return await fetch(modifiedRequest);
}