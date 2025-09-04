# WebSocket Authentication with Clerk (First Message Auth)

本项目实现了基于 Clerk 的 WebSocket 鉴权，采用**First Message Authentication + Ticket System**的安全最佳实践。

## 🔐 架构说明

采用两阶段认证模式：
1. **HTTP Ticket 获取**：客户端通过 HTTP API 用 JWT token 换取临时 ticket
2. **WebSocket First Message**：连接后立即发送 ticket 进行认证

### 为什么选择 First Message 认证？

| 方案 | 安全性 | 日志泄漏 | DoS 防护 | 实现复杂度 |
|------|--------|----------|----------|------------|
| Query Parameter | ⚠️ 中等 | ❌ 高风险 | ✅ 好 | 简单 |
| **First Message** | ✅ **高** | ✅ **安全** | ✅ **好** | 中等 |

**安全优势：**
- ✅ 避免 token 出现在 URL/日志中
- ✅ 5秒连接超时防止 DoS 攻击  
- ✅ Origin 验证防止 CSRF
- ✅ 一次性 ticket 系统

## 配置环境变量

### 生产环境（Cloudflare）

```bash
# 设置 Clerk 相关密钥
wrangler secret put CLERK_SECRET_KEY
wrangler secret put CLERK_JWT_KEY  
wrangler secret put CLERK_AUTHORIZED_PARTIES

# 其他 API 密钥
wrangler secret put FIREWORKS_API_KEY  
wrangler secret put GEMINI_API_KEY
wrangler secret put GROQ_API_KEY
wrangler secret put OPENROUTER_API_KEY
```

### 开发环境（.dev.vars）

```
CLERK_SECRET_KEY=sk_test_your_clerk_secret_key
CLERK_JWT_KEY=your_jwt_verification_key
CLERK_AUTHORIZED_PARTIES=localhost:3000,your-frontend-domain.com
DEBUG_MODE=true
# ... 其他 API 密钥
```

## 获取 Clerk JWT Key

1. 登录 [Clerk Dashboard](https://clerk.com)
2. 进入你的应用设置
3. 在 **API Keys** 部分找到 JWT verification key
4. 复制 PEM 格式的公钥用作 `CLERK_JWT_KEY`

## 🚀 客户端使用示例

### React + Clerk 客户端（推荐）

```typescript
import { useAuth } from '@clerk/clerk-react';
import { useState } from 'react';

interface WSTicketResponse {
  ticket: string;
  expires_in: number;
}

function AudioStreamComponent() {
  const { getToken } = useAuth();
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [authStatus, setAuthStatus] = useState<'disconnected' | 'connecting' | 'authenticating' | 'connected'>('disconnected');
  
  const connectWebSocket = async () => {
    try {
      setAuthStatus('connecting');
      
      // 第一步：获取 WebSocket ticket
      const token = await getToken();
      if (!token) {
        throw new Error('用户未认证');
      }
      
      const ticketResponse = await fetch('/api/ws/ticket', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!ticketResponse.ok) {
        throw new Error('获取 WebSocket ticket 失败');
      }
      
      const ticketData: WSTicketResponse = await ticketResponse.json();
      console.log(`获得 ticket，有效期：${ticketData.expires_in}秒`);
      
      // 第二步：建立 WebSocket 连接
      const wsUrl = `wss://your-worker.your-subdomain.workers.dev/api/ws`;
      const websocket = new WebSocket(wsUrl);
      
      websocket.onopen = () => {
        console.log('WebSocket 连接已建立，开始认证...');
        setAuthStatus('authenticating');
        
        // 第三步：立即发送认证消息（First Message Auth）
        websocket.send(JSON.stringify({
          type: 'auth',
          ticket: ticketData.ticket
        }));
        
        // 设置认证超时保护
        setTimeout(() => {
          if (authStatus !== 'connected') {
            console.error('认证超时');
            websocket.close();
          }
        }, 5000);
      };
      
      websocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
          case 'auth_success':
            console.log(`认证成功！用户ID: ${data.userId}`);
            setAuthStatus('connected');
            
            // 认证成功后开始音频流
            websocket.send(JSON.stringify({ type: 'audio_stream_start' }));
            break;
            
          case 'auth_error':
            console.error('认证失败:', data.error);
            setAuthStatus('disconnected');
            websocket.close();
            break;
            
          case 'audio_stream_start_ack':
            console.log(`音频流已启动，用户ID: ${data.userId}`);
            break;
            
          case 'transcription_result':
            console.log('转录结果:', data.text);
            console.log('性能数据:', data.performance);
            break;
            
          case 'transcription_error':
            console.error('转录错误:', data.error);
            break;
            
          default:
            console.log('未知消息类型:', data.type);
        }
      };
      
      websocket.onerror = (error) => {
        console.error('WebSocket 错误:', error);
        setAuthStatus('disconnected');
      };
      
      websocket.onclose = (event) => {
        console.log(`WebSocket 连接已关闭 (code: ${event.code}, reason: ${event.reason})`);
        setAuthStatus('disconnected');
        setWs(null);
      };
      
      setWs(websocket);
      
    } catch (error) {
      console.error('连接失败:', error);
      setAuthStatus('disconnected');
    }
  };
  
  const disconnect = () => {
    if (ws) {
      ws.close();
    }
  };
  
  return (
    <div>
      <div>状态: {authStatus}</div>
      {authStatus === 'disconnected' ? (
        <button onClick={connectWebSocket}>
          连接音频流
        </button>
      ) : (
        <button onClick={disconnect}>
          断开连接
        </button>
      )}
    </div>
  );
}
```

### 发送音频数据示例

```typescript
// 发送音频数据块
const sendAudioChunk = (ws: WebSocket, audioData: string, vadState?: 'start' | 'end', vadOffset?: number) => {
  ws.send(JSON.stringify({
    type: 'audio_chunk',
    data: audioData, // Base64 编码的音频数据
    vad_state: vadState,
    vad_offset_ms: vadOffset
  }));
};

// 结束音频流
const endAudioStream = (ws: WebSocket) => {
  ws.send(JSON.stringify({ type: 'audio_stream_end' }));
};
```

## 🔄 认证流程详解

### 第一阶段：HTTP Ticket 获取
1. **POST** `/api/ws/ticket` with `Authorization: Bearer {jwt_token}`
2. 服务端验证 Clerk JWT token
3. 生成临时 ticket（5分钟有效期）
4. 返回 `{ ticket: "abc123...", expires_in: 300 }`

### 第二阶段：WebSocket 认证
1. **连接建立**：`new WebSocket(ws://api.domain.com/api/ws)`
2. **Origin 验证**：检查请求来源防止 CSRF
3. **First Message**：5秒内必须发送 `{type: "auth", ticket: "abc123..."}`
4. **Ticket 验证**：一次性使用，验证后立即失效
5. **认证成功**：返回 `{type: "auth_success", userId: "user_xxx"}`

### 安全机制
- 🔒 **连接超时**：5秒内未认证自动断开
- 🎫 **一次性票据**：每个 ticket 只能使用一次  
- 🌐 **Origin 校验**：防止跨域攻击
- ⏰ **票据过期**：5分钟自动过期

## 🛡️ 安全优势

### vs 传统 Query Parameter 方案

| 安全特性 | Query Parameter | **First Message + Ticket** |
|----------|-----------------|---------------------------|
| 日志泄漏风险 | ❌ 高（URL 记录） | ✅ 低（内存传输） |
| DoS 防护 | ✅ 连接前验证 | ✅ 5秒超时 + 一次性票据 |
| CSRF 防护 | ⚠️ 依赖 Origin | ✅ Origin + 临时票据 |
| 令牌重用 | ❌ 可能被重放 | ✅ 一次性使用 |
| 实现复杂度 | 简单 | 中等 |

### 多层安全防护

1. **传输加密**：强制 WSS (TLS) 协议
2. **认证隔离**：JWT → Ticket → WebSocket 三层验证
3. **时间限制**：5分钟 Ticket + 5秒连接超时
4. **来源验证**：Origin header 检查
5. **状态管理**：连接状态跟踪

## ⚠️ 错误处理

### HTTP Ticket 获取错误

| 状态码 | 错误 | 原因 | 解决方案 |
|--------|------|------|----------|
| 401 | Missing Authorization header | 缺少 Bearer token | 添加 `Authorization: Bearer {token}` |
| 401 | Invalid token | JWT 验证失败 | 检查 token 是否过期或无效 |
| 500 | Token verification failed | 服务器配置错误 | 检查 CLERK_JWT_KEY 配置 |

### WebSocket 连接错误

| Close Code | 原因 | 客户端处理 |
|------------|------|------------|
| 400 | Expected websocket | 检查协议是否正确 |
| 403 | Forbidden: Invalid origin | 检查域名是否在允许列表中 |
| 1008 | Authentication timeout | 5秒内未发送认证消息 |
| 1008 | Authentication failed | Ticket 无效或已过期 |
| 1008 | Authentication required | 非认证消息被拒绝 |

### 认证消息错误

```json
{
  "type": "auth_error",
  "error": "Invalid or expired ticket",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

## 📊 监控和日志

### 服务端日志记录

```javascript
// 连接和认证
✅ WebSocket authenticated for user: user_2abc123 (took 245ms)
✅ Audio stream started for user: user_2abc123
⚠️ WebSocket connection timed out - no authentication within 5 seconds
❌ WebSocket connection closed for unauthenticated connection

// 音频处理
🎤 VAD cache start for user: user_2abc123
🎤 Processing audio with Fireworks API for user: user_2abc123
✅ Transcription completed: "Hello world" (user: user_2abc123)
```

### 性能指标

客户端可获取详细性能数据：

```json
{
  "type": "transcription_result", 
  "text": "Hello world",
  "performance": {
    "total_processing_ms": 1234,
    "wav_creation_ms": 56,
    "api_fetch_ms": 890,
    "provider": "fireworks"
  }
}
```

## 🎯 最佳实践总结

### ✅ 推荐做法

1. **总是使用 First Message 认证**：更安全，避免日志泄漏
2. **实现重连逻辑**：处理网络中断和认证过期
3. **状态管理**：跟踪连接、认证、音频流状态  
4. **错误处理**：针对不同错误类型提供用户友好提示
5. **性能监控**：记录认证时间和音频处理延迟

### 🔄 连接生命周期

```
1. HTTP GET /api/ws/ticket (with JWT) → ticket
2. WebSocket connect to /api/ws
3. Send {type: "auth", ticket} within 5s  
4. Receive {type: "auth_success", userId}
5. Send {type: "audio_stream_start"}
6. Exchange audio messages...
7. Connection closes gracefully
```

### 🚀 生产环境检查清单

**Secrets 配置**
- [ ] 配置所有环境变量 secrets  
- [ ] 设置正确的 `CLERK_AUTHORIZED_PARTIES`

**KV 存储配置**
- [ ] 创建 KV namespace: `wrangler kv:namespace create "WS_TICKETS_KV"`
- [ ] 更新 `wrangler.jsonc` 中的 KV binding ID
- [ ] 验证 KV 存储工作正常

**网络和安全**
- [ ] 启用 WSS (TLS) 协议
- [ ] 配置正确的 Origin 验证
- [ ] 测试跨域访问策略

**应用层面**
- [ ] 实施连接重试和错误恢复
- [ ] 添加用户界面状态指示
- [ ] 实现优雅的错误处理

**监控和运维**
- [ ] 配置日志监控和告警
- [ ] 设置性能指标监控
- [ ] 测试票据过期和清理机制

---

**🔐 安全第一**：First Message 认证是 WebSocket 安全的最佳实践，相比 Query Parameter 方案显著降低了安全风险。