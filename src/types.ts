import { DateTime, Str } from "chanfana";
import type { Context } from "hono";
import { z } from "zod";

// Extended environment interface for the app
interface ExtendedEnv extends Env {
  // Clerk authentication
  CLERK_SECRET_KEY: string;
  CLERK_JWT_KEY: string;
  CLERK_AUTHORIZED_PARTIES: string;
  
  // Audio processing APIs
  GROQ_API_KEY: string;
  FIREWORKS_API_KEY: string;
  OPENROUTER_API_KEY: string;
  GEMINI_API_KEY: string;
  USE_FIREWORKS: string;
  DEBUG_MODE: string;
  
  // KV storage for WebSocket tickets
  WS_TICKETS_KV: KVNamespace;
  
  // R2 file storage
  FRAPP_FILES_STORE: R2Bucket;
}

export type AppContext = Context<{ Bindings: ExtendedEnv }>;

export const Task = z.object({
	name: Str({ example: "lorem" }),
	slug: Str(),
	description: Str({ required: false }),
	completed: z.boolean().default(false),
	due_date: DateTime(),
});
