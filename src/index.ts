import { fromHono } from "chanfana";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { clerkMiddleware, getAuth } from './middleware/auth'
import { LLMChat } from "./endpoints/llm";
import { Info } from "./endpoints/info";
import { WebSocketTicket } from "./endpoints/websocket-ticket";
import { handleWebSocket } from "./endpoints/websocket";
import { handleApiProxy } from "./endpoints/proxy";
import { handleTestPage } from "./endpoints/test";

// Start a Hono app
const app = new Hono<{ Bindings: Env }>();

// Add CORS middleware
app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

// Setup OpenAPI registry
const openapi = fromHono(app, {
  docs_url: "/",
  schema: {
    info: {
      title: "Frapp API",
      version: "1.0.0",
    },
  },
});

// Register Bearer security scheme
openapi.registry.registerComponent(
  'securitySchemes',
  'Bearer',
  {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  }
);


openapi.use('*', clerkMiddleware())
openapi.get('/api/', (c) => {
  const auth = getAuth(c)

  if (!auth?.userId) {
    return c.json({
      message: 'You are not logged in.',
    })
  }

  return c.json({
    message: 'You are logged in!',
    userId: auth.userId,
  })
})

// Register new OpenAPI endpoints
openapi.post("/api/llm", LLMChat);
openapi.get("/api/info", Info);
openapi.post("/api/ws/ticket", WebSocketTicket);

// Test page for Clerk authentication
app.get('/test', handleTestPage);



// Register non-OpenAPI routes directly on Hono
app.get('/api/ws', handleWebSocket);

// Proxy route for specific API paths only (not catch-all)
app.all('/v1/*', handleApiProxy);
app.all('/openai/*', handleApiProxy);

// Export the Hono app
export default app;
