// WebSocket Ticket Storage - KV and Memory Adapter
// Handles ticket storage with Cloudflare KV (production) and memory fallback (development)

export interface TicketData {
  userId: string;
  expires: number;
  used: boolean;
}

/**
 * Ticket Storage Adapter
 * Automatically uses KV in production, memory in development
 */
export class TicketStorage {
  private kv?: KVNamespace;

  constructor(kv?: KVNamespace) {
    this.kv = kv;
  }

  /**
   * Store a ticket with TTL
   * @param ticket - Unique ticket identifier
   * @param data - Ticket data with user info and expiration
   */
  async set(ticket: string, data: TicketData): Promise<void> {
    if (this.kv) {
      // Production: Use Cloudflare KV with automatic TTL
      await this.kv.put(
        `ticket:${ticket}`, 
        JSON.stringify(data),
        { expirationTtl: 300 } // 5 minutes TTL
      );
      console.log(`KV: Stored ticket for user ${data.userId} (expires in 5min)`);
    } else {
      // Development: Use memory store with manual cleanup
      memoryStore.set(ticket, data);
      console.log(`Memory: Stored ticket for user ${data.userId} (dev mode)`);
    }
  }

  /**
   * Retrieve a ticket
   * @param ticket - Ticket identifier
   * @returns Ticket data or null if not found/expired
   */
  async get(ticket: string): Promise<TicketData | null> {
    if (this.kv) {
      const data = await this.kv.get(`ticket:${ticket}`);
      return data ? JSON.parse(data) : null;
    } else {
      // In memory mode, check manual expiration
      const data = memoryStore.get(ticket);
      if (data && data.expires < Date.now()) {
        memoryStore.delete(ticket);
        return null;
      }
      return data || null;
    }
  }

  /**
   * Delete a ticket (for one-time use)
   * @param ticket - Ticket identifier
   */
  async delete(ticket: string): Promise<void> {
    if (this.kv) {
      await this.kv.delete(`ticket:${ticket}`);
    } else {
      memoryStore.delete(ticket);
    }
  }

  /**
   * Get storage type for debugging
   */
  getStorageType(): 'kv' | 'memory' {
    return this.kv ? 'kv' : 'memory';
  }
}

// Development fallback (memory store)
const memoryStore = new Map<string, TicketData>();

// Cleanup expired tickets in memory mode (runs every minute)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [ticket, data] of memoryStore) {
      if (data.expires < now || data.used) {
        memoryStore.delete(ticket);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`Memory cleanup: removed ${cleaned} expired tickets`);
    }
  }, 60000); // Clean every minute
}

/**
 * Generate cryptographically secure ticket
 * @returns 64-character hex string
 */
export function generateSecureTicket(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Validate and consume a ticket (one-time use)
 * @param ticket - Ticket to validate
 * @param kv - Optional KV namespace
 * @returns User info if valid, null if invalid/expired/used
 */
export async function validateAndConsumeTicket(ticket: string, kv?: KVNamespace): Promise<{ userId: string } | null> {
  const storage = new TicketStorage(kv);
  const ticketData = await storage.get(ticket);
  
  if (!ticketData) {
    console.log(`Ticket validation failed: ticket not found (${ticket.slice(0, 8)}...)`);
    return null;
  }

  // Check expiration (double-check even though KV has TTL)
  if (ticketData.expires < Date.now()) {
    console.log(`Ticket validation failed: expired (${ticket.slice(0, 8)}...)`);
    await storage.delete(ticket);
    return null;
  }

  // Check if already used
  if (ticketData.used) {
    console.log(`Ticket validation failed: already used (${ticket.slice(0, 8)}...)`);
    return null;
  }

  // Mark as used by deleting (one-time use)
  await storage.delete(ticket);
  console.log(`✅ Ticket validated and consumed for user: ${ticketData.userId} (${storage.getStorageType()} storage)`);
  
  return { userId: ticketData.userId };
}