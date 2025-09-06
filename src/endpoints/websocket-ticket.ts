// WebSocket ticket generation endpoint
import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { verifyToken } from '@clerk/backend';
import { type AppContext } from "../types";
import { TicketStorage, generateSecureTicket } from "../store/kv";

// Ticket response schema
const TicketResponseSchema = z.object({
  ticket: Str({ description: "Temporary WebSocket access ticket" }),
  expires_in: z.number({ description: "Ticket expiration time in seconds" })
});

export class WebSocketTicket extends OpenAPIRoute {
  schema = {
    tags: ["WebSocket"],
    summary: "Get WebSocket access ticket",
    description: "Generate a temporary ticket for WebSocket authentication",
    security: [{ Bearer: [] }],
    responses: {
      "200": {
        description: "Returns WebSocket ticket",
        content: {
          "application/json": {
            schema: TicketResponseSchema,
          },
        },
      },
      "401": {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: z.object({
              error: Str({ description: "Error message" }),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    // Get Authorization header
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing Authorization header' }, 401);
    }

    const token = authHeader.slice(7);
    const env = c.env;

    try {
      // Verify Clerk JWT token
      const payload = await verifyToken(token, {
        jwtKey: env.CLERK_JWT_KEY,
      });

      if (!payload.sub) {
        return c.json({ error: 'Invalid token' }, 401);
      }

      // Initialize ticket storage (KV in production, memory in dev)
      const storage = new TicketStorage(env.WS_TICKETS_KV);

      // Generate temporary ticket
      const ticket = generateSecureTicket();
      const expiresAt = Date.now() + (60 * 60 * 1000); // 60 minutes

      // Store ticket
      await storage.set(ticket, {
        userId: payload.sub,
        expires: expiresAt,
        used: false
      });

      console.log(`🎫 Generated WebSocket ticket for user: ${payload.sub} (${storage.getStorageType()} storage)`);

      return c.json({
        ticket,
        expires_in: 3600 // 60 minutes in seconds
      });

    } catch (error) {
      console.error('Ticket generation failed:', error);
      return c.json({ error: 'Token verification failed' }, 401);
    }
  }
}

