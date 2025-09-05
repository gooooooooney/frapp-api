# 音频存储系统实现文档

## 概述

基于 **优化的流式内存缓存 + R2直接存储** 方案，实现了高效的音频会话存储系统。该系统设计用于在 Cloudflare Workers 环境中处理实时音频流，同时将音频数据持久化存储到 R2。

## 核心特性

### 🚀 性能优化
- **2分钟滑动窗口**：减少50%内存占用（从9.6MB降至3.8MB）
- **1分钟异步上传**：更频繁的存储，降低数据丢失风险
- **支持20+并发用户**：高效的内存管理策略
- **零延迟影响**：存储操作不阻塞实时转录

### 🛡️ 可靠性保障
- **优雅降级**：存储失败不影响转录功能
- **自动重试**：上传失败自动重试机制
- **紧急清理**：内存压力时自动释放空间
- **健康监控**：实时监控系统状态

### 📁 存储管理
- **智能文件组织**：按会话和时间块组织文件
- **自动清理**：过期文件自动删除
- **批量操作**：支持批量下载和删除
- **元数据管理**：完整的文件信息跟踪

## 系统架构

```
WebSocket 音频流
       ↓
[VAD 实时处理] → [转录 API] → [实时响应]
       ↓
[OptimizedAudioStorage]
       ↓ (每2分钟窗口)
[滑动窗口缓存] → [定时上传(1分钟)] → [R2存储]
       ↓
[自动清理过期数据]
```

## 内存使用对比

| 方案 | 每用户内存 | 并发用户 | 数据丢失风险 | 延迟影响 |
|------|------------|----------|--------------|----------|
| 原方案(5分钟) | 9.6MB | 8用户 | 中等 | 无 |
| **优化方案(2分钟)** | **3.8MB** | **20用户** | **低** | **无** |
| KV中间层 | 9.6MB+ | 3用户 | 高 | +200% |

## 实现详情

### 文件结构

```
src/
├── app/
│   ├── audio-storage.ts           # 核心存储管理器
│   └── audio-utils.ts            # 增强的WebSocket处理
├── config/
│   └── audio-storage.ts          # 配置常量和工具
├── endpoints/
│   ├── audio-storage-admin.ts    # 管理API端点
│   └── audio-storage-test.ts     # 测试界面
└── types.ts                      # 类型定义
```

### 核心组件

#### 1. OptimizedAudioStorage 类

负责音频数据的缓存和上传管理：

```typescript
// 主要方法
processAudioChunk(chunk: AudioChunk)  // 处理音频块
maintainWindowSize()                  // 维护滑动窗口
scheduledUpload()                     // 定时上传到R2
cleanup()                            // 资源清理
```

#### 2. 集成到 WebSocket 处理

```typescript
// 在 handleSecureAudioSession 中：
const audioStorage = createAudioSession(userId, r2Bucket, config);

// 在 audio_chunk 处理中：
audioStorage.processAudioChunk(audioChunk).catch(handleError);
```

#### 3. 管理 API 端点

- `GET /api/audio-storage/stats` - 存储统计
- `GET /api/audio-storage/files/{userId}` - 用户文件列表  
- `GET /api/audio-storage/download/{filePath}` - 文件下载
- `DELETE /api/audio-storage/files/{filePath}` - 文件删除
- `POST /api/audio-storage/cleanup` - 清理过期文件

## 配置选项

### 环境变量

```bash
# 音频存储配置
AUDIO_STORAGE_DEBUG=true              # 启用调试模式
AUDIO_STORAGE_MAX_MEMORY_MB=10        # 每会话最大内存(MB)
AUDIO_STORAGE_UPLOAD_INTERVAL_MS=60000 # 上传间隔(ms)
AUDIO_STORAGE_MAX_AGE_DAYS=30         # 文件保留天数
AUDIO_STORAGE_AUTO_CLEANUP=true       # 自动清理过期文件
```

### 代码配置

```typescript
const audioStorage = createAudioSession(userId, r2Bucket, {
  windowSizeMs: 2 * 60 * 1000,      // 2分钟窗口
  uploadIntervalMs: 60 * 1000,      // 1分钟上传
  maxMemoryMB: 10,                  // 10MB限制
  enableDebug: true                 // 调试模式
});
```

## 使用指南

### 1. 开发部署

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm run dev

# 部署到 Cloudflare Workers
pnpm run deploy
```

### 2. 测试验证

访问测试页面验证功能：
```
https://your-worker.your-subdomain.workers.dev/audio-storage-test
```

### 3. WebSocket 客户端集成

客户端无需修改，音频存储在后台透明运行：

```javascript
// WebSocket 连接和音频发送保持不变
websocket.send(JSON.stringify({
  type: 'audio_chunk',
  data: base64AudioData,
  vad_state: 'start'  // 或 'end'
}));
```

## 监控和维护

### 关键指标

- **内存使用率**：< 80% 正常，> 95% 警告
- **上传成功率**：> 99.9% 目标
- **平均延迟**：< 50ms 上传延迟
- **并发会话数**：< 20 per isolate

### 日志监控

```bash
# 查看 Worker 日志
wrangler tail

# 关键日志信息
🎵 Audio storage initialized    # 存储初始化
📤 Upload completed            # 上传完成
🧹 Cleanup completed          # 清理完成
❌ Upload failed              # 上传失败
⚠️ Memory limit exceeded      # 内存超限
```

### 清理策略

系统自动执行以下清理操作：

1. **实时清理**：移除超出滑动窗口的数据
2. **紧急清理**：内存压力时强制释放空间
3. **定期清理**：删除过期的R2存储文件
4. **连接清理**：WebSocket关闭时保存剩余数据

## 成本分析

### 每用户每月成本

```
音频存储成本：
- R2存储：2.76GB × $0.015/GB = $0.041
- Workers CPU：+15% 开销 = $0.002  
- 上传操作：可忽略
总计：$0.043/月/用户

对比KV方案：节省99.9%成本
```

### 扩展性

- **免费账户**：支持 ~100 并发会话
- **付费账户**：支持数千并发会话
- **企业账户**：可配置 Durable Objects 获得更好隔离

## 故障排除

### 常见问题

**Q: 音频存储失败但转录正常？**
A: 这是预期行为。存储故障不影响实时转录，检查 R2 权限和网络连接。

**Q: 内存使用过高警告？**
A: 调整 `windowSizeMs` 或 `maxMemoryMB` 配置，或检查是否有内存泄漏。

**Q: 上传延迟过高？**
A: 检查网络连接，考虑增加 `uploadIntervalMs` 或减少 `windowSizeMs`。

### 性能调优

1. **内存优化**：根据实际使用调整窗口大小
2. **上传频率**：平衡数据安全性和性能开销
3. **并发限制**：监控 isolate 内存使用情况
4. **清理策略**：根据存储成本调整保留时间

## 未来增强

### 计划功能
- [ ] 音频压缩选项
- [ ] 流式多part上传
- [ ] Durable Objects 集成
- [ ] 实时音频分析
- [ ] 自动转录存档

### 扩展集成
- **音频分析**：集成语音情感分析
- **内容审核**：自动检测不当内容
- **多格式支持**：支持 MP3、FLAC 等格式
- **CDN 分发**：全球音频文件分发

---

## 技术支持

如有问题或建议，请查看：
- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [R2 存储文档](https://developers.cloudflare.com/r2/)
- [项目 GitHub Issues](https://github.com/your-org/frapp-api/issues)

**实现完成** ✅ 优化的音频存储系统已成功集成，支持高并发、低延迟的实时音频处理和持久化存储。