# 生产环境存储配置指南

## 📊 存储方案对比分析

### WebSocket Ticket 存储场景特点

- **数据类型**：临时认证票据
- **生命周期**：5分钟后自动过期
- **访问模式**：写一次，读一次，删除
- **并发要求**：多 Worker 实例共享
- **一致性要求**：最终一致性即可

## 🏆 推荐方案：Cloudflare KV

### 为什么选择 KV

```
✅ 专为此场景设计    ✅ 原生 TTL 支持
✅ 全球边缘分布      ✅ 零运维成本  
✅ 免费额度充足      ✅ 无冷启动延迟
✅ 简单集成          ✅ 自动扩容
```

### 性能特征

- **写入延迟**: ~10-50ms
- **读取延迟**: ~5-100ms (边缘缓存)
- **TTL精度**: 秒级
- **免费额度**: 100,000 reads/day, 1,000 writes/day

## 🚀 KV 配置步骤

### 1. 创建 KV Namespace

```bash
# 创建 KV namespace
wrangler kv:namespace create "WS_TICKETS_KV"

# 输出示例:
# 🌀  Creating namespace with title "frapp-api-WS_TICKETS_KV"
# ✨  Success!
# Add the following to your configuration file in your kv_namespaces array:
# { binding = "WS_TICKETS_KV", id = "abc123def456" }

# 创建预览环境 namespace (可选)
wrangler kv:namespace create "WS_TICKETS_KV" --preview
```

### 2. 更新 wrangler.jsonc

```jsonc
{
  "kv_namespaces": [
    {
      "binding": "WS_TICKETS_KV",
      "id": "your_actual_kv_id_here",
      "preview_id": "your_preview_kv_id_here"
    }
  ]
}
```

### 3. 代码自动适配

代码已实现自动适配：

```typescript
// 生产环境：使用 KV
const storage = new TicketStorage(env.WS_TICKETS_KV);

// 开发环境：自动降级到内存存储
const storage = new TicketStorage(); // KV 为 undefined
```

## 🔄 替代方案对比

### Plan B: Redis

**适用场景**：需要极高性能和强一致性

```typescript
// Redis 实现示例 (需要外部 Redis 服务)
class RedisTicketStorage {
  constructor(private redis: RedisClient) {}
  
  async set(ticket: string, data: TicketData): Promise<void> {
    await this.redis.setex(`ticket:${ticket}`, 300, JSON.stringify(data));
  }
  
  async get(ticket: string): Promise<TicketData | null> {
    const data = await this.redis.get(`ticket:${ticket}`);
    return data ? JSON.parse(data) : null;
  }
}
```

**优势**：
- ⚡ 超低延迟 (~1ms)
- 🔒 强一致性
- 📊 丰富数据结构

**劣势**：
- 💰 需要 Redis 服务 (Upstash, Redis Cloud)
- 🔧 增加基础设施复杂度
- 🌍 可能需要多区域部署

### Plan C: Durable Objects

**适用场景**：需要复杂状态管理

```typescript
export class TicketManager {
  constructor(state: DurableObjectState) {
    this.storage = state.storage;
  }
  
  async setTicket(ticket: string, data: TicketData) {
    await this.storage.put(ticket, data, { 
      expirationTtl: 300 
    });
  }
}
```

**优势**：
- 🔒 强一致性
- ⚡ 极低延迟
- 🎯 精确状态控制

**劣势**：
- 💰💰 成本较高
- 🔧 实现复杂度高
- 📍 单点部署限制

## 📈 成本对比 (月)

| 方案 | 10万次/天 | 100万次/天 | 优势 |
|------|-----------|------------|------|
| **KV** | **免费** | **$5** | 免费额度大 |
| Redis (Upstash) | $10 | $50+ | 性能最佳 |
| Durable Objects | $15+ | $100+ | 一致性最强 |

## 🛠️ 环境配置

### 开发环境

```bash
# 无需额外配置，自动使用内存存储
npm run dev
```

### 生产环境

```bash
# 1. 创建 KV namespace
wrangler kv:namespace create "WS_TICKETS_KV"

# 2. 更新 wrangler.jsonc 中的 id

# 3. 部署
npm run deploy
```

### 混合环境策略

```typescript
// 支持优雅降级的存储策略
class AdaptiveTicketStorage {
  async set(ticket: string, data: TicketData): Promise<void> {
    try {
      // 优先使用 KV
      if (this.kv) {
        await this.kv.put(`ticket:${ticket}`, JSON.stringify(data), {
          expirationTtl: 300
        });
        return;
      }
    } catch (error) {
      console.warn('KV unavailable, falling back to memory:', error);
    }
    
    // 降级到内存存储
    memoryStore.set(ticket, data);
  }
}
```

## 🔍 监控建议

### KV 指标监控

```typescript
// 在票据操作中添加性能监控
const start = Date.now();
await storage.set(ticket, data);
const duration = Date.now() - start;

if (duration > 100) {
  console.warn(`KV write took ${duration}ms - consider optimization`);
}
```

### 告警设置

- KV 写入延迟 > 200ms
- KV 读取延迟 > 100ms
- 票据验证失败率 > 5%
- 内存存储降级事件

## 🎯 最佳实践总结

### ✅ 推荐做法

1. **生产环境使用 KV**：自动 TTL + 全球分布
2. **开发环境内存存储**：快速迭代无依赖
3. **实现优雅降级**：KV 不可用时使用内存
4. **监控存储性能**：及时发现问题
5. **合理设置 TTL**：5分钟适合认证场景

### ❌ 避免做法

1. 生产环境使用内存存储（数据丢失风险）
2. 过短的 TTL 设置（用户体验差）
3. 没有错误处理机制（系统脆弱）
4. 忽视存储性能监控

---

**结论**：对于 WebSocket 认证票据这种临时数据存储，Cloudflare KV 是性价比最高的选择，完美匹配使用场景且运维成本极低。