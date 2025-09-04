import { fromHono } from "chanfana";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { clerkMiddleware, getAuth } from '@hono/clerk-auth'
import { TaskCreate } from "./endpoints/taskCreate";
import { TaskDelete } from "./endpoints/taskDelete";
import { TaskFetch } from "./endpoints/taskFetch";
import { TaskList } from "./endpoints/taskList";
import { LLMChat } from "./endpoints/llm";
import { Info } from "./endpoints/info";
import { handleWebSocket } from "./endpoints/websocket";
import { handleApiProxy } from "./endpoints/proxy";

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
});


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

// Register OpenAPI endpoints for tasks
openapi.get("/api/tasks", TaskList);
openapi.post("/api/tasks", TaskCreate);
openapi.get("/api/tasks/:taskSlug", TaskFetch);
openapi.delete("/api/tasks/:taskSlug", TaskDelete);

// Register new OpenAPI endpoints
openapi.post("/api/llm", LLMChat);
openapi.get("/api/info", Info);

// Register non-OpenAPI routes directly on Hono
app.get('/api/ws', handleWebSocket);

// Catch-all proxy route for other paths (should be last)
app.all('*', handleApiProxy);

// Export the Hono app
export default app;
