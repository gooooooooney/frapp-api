import { DateTime, Str } from "chanfana";
import type { Context } from "hono";
import { z } from "zod";

// Extended environment interface for the app
interface ExtendedEnv extends Env {

}

export type AppContext = Context<{ Bindings: ExtendedEnv }>;

export const Task = z.object({
	name: Str({ example: "lorem" }),
	slug: Str(),
	description: Str({ required: false }),
	completed: z.boolean().default(false),
	due_date: DateTime(),
});
