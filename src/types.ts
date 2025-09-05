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

// 音频存储相关类型定义
export interface AudioStorageMetrics {
  sessionId: string;
  userId: string;
  totalChunks: number;
  memoryUsageMB: number;
  uploadsCompleted: number;
  uploadsFailed: number;
  isActive: boolean;
  lastUploadTime?: number;
}

export interface AudioFileInfo {
  sessionId: string;
  filename: string;
  size: number;
  uploadedAt: string;
  chunkId?: string;
  chunkCount?: string;
  metadata?: Record<string, string>;
}

export interface StorageCleanupResult {
  deletedFiles: number;
  freedSpaceBytes: number;
  freedSpaceMB: number;
  errors?: string[];
}

export const Task = z.object({
	name: Str({ example: "lorem" }),
	slug: Str(),
	description: Str({ required: false }),
	completed: z.boolean().default(false),
	due_date: DateTime(),
});
