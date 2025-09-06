# Frontend Vite服务设置

这个前端项目现在使用Vite作为开发服务器，支持本地代理、Clerk身份认证和WebSocket票据认证。

## 快速开始

### 1. 安装依赖
```bash
cd frontend
pnpm install
```

### 2. 配置Clerk认证（可选）
如果您想要使用完整的认证功能，需要设置Clerk：

1. 在 `index.html` 中找到以下行：
   ```javascript
   const clerkKey = 'pk_test_your_key_here';
   ```
2. 将 `pk_test_your_key_here` 替换为您的实际Clerk Publishable Key
3. 确保后端也配置了相应的Clerk密钥

**注意**: 如果不配置Clerk Key，系统会显示警告但仍可正常运行。可以手动输入WebSocket票据进行测试。

### 3. 启动后端服务 
在项目根目录启动Cloudflare Workers开发服务器：
```bash
pnpm run dev
```
这将在 `http://localhost:8787` 启动后端服务。

### 4. 启动前端开发服务器
在frontend目录中：
```bash
pnpm run dev
```
这将在 `http://localhost:3000` 启动前端服务。

## 主要功能

### 1. Clerk身份认证系统
- **完整的用户认证流程**: 支持登录、注册、退出登录
- **JWT Token管理**: 自动获取和管理用户的JWT Token
- **会话状态监控**: 实时监控用户登录状态变化
- **安全的WebSocket认证**: 使用JWT Token获取WebSocket连接票据

### 2. WebSocket连接系统
- **地址**: `/api/ws` (通过Vite代理转发到后端)
- **票据认证**: 需要先通过Clerk认证获取JWT Token，再获取WebSocket票据
- **自动状态管理**: 自动处理连接、断开和重连逻辑

### 3. Vite代理配置
`vite.config.js` 配置了完整的代理规则：
- 所有 `/api/*` 请求代理到 `http://localhost:8787`
- 支持WebSocket代理 (`ws: true`)
- **Cookie转发**: 自动转发认证Cookie和Authorization头
- **响应头转发**: 将Set-Cookie头返回给客户端

## 使用流程

### 完整的认证和使用流程：

1. **启动服务**:
   - 启动后端服务 (`pnpm run dev` 在根目录)
   - 启动前端服务 (`pnpm run dev` 在frontend目录)

2. **访问应用**: 打开 `http://localhost:3000`

3. **身份认证**（有两种方式）:

   **方式A: 使用Clerk认证（推荐）**:
   - 等待Clerk SDK加载完成
   - 点击"🔐 登录"或"📝 注册"完成身份认证
   - 登录成功后会显示用户信息
   - 点击"🎫 获取Token"获取JWT Token
   - 点击"🎫 获取票据"获取WebSocket连接票据

   **方式B: 手动输入票据（测试用）**:
   - 如果未配置Clerk，会显示"Clerk认证不可用"警告
   - 可以直接点击"🎫 获取票据"尝试无认证获取（如果后端允许）
   - 或者手动在"WS Ticket"输入框中输入有效的票据

4. **开始使用**: 获取到WebSocket票据后，点击"开始录音"即可使用实时语音识别功能

### 认证状态指示：

- **🔄 加载中**: Clerk SDK正在初始化
- **⚠️ Clerk不可用**: 未配置有效的Publishable Key，可手动输入票据
- **🔐 未登录**: 需要登录或注册
- **✅ 已登录**: 显示用户信息和Token获取按钮
- **🎫 Token已获取**: 可以获取WebSocket票据
- **🚀 系统就绪**: 可以开始录音

## 技术架构

### 认证流程
1. **Clerk SDK初始化** → 检查用户登录状态
2. **用户登录** → 获取Clerk会话
3. **JWT Token获取** → 从Clerk会话中提取JWT Token
4. **WebSocket票据获取** → 使用JWT Token向后端请求WebSocket连接票据
5. **WebSocket连接** → 使用票据建立认证的WebSocket连接

### 数据流
```
前端 (Clerk Auth) → JWT Token → 后端 (/api/ws/ticket) → WebSocket Ticket → WebSocket连接 → 音频流
```

## 配置文件说明

### `vite.config.js`
- **端口**: 3000
- **代理目标**: `http://localhost:8787`
- **Cookie转发**: 支持认证Cookie和Authorization头的双向转发
- **WebSocket支持**: 完整的WebSocket代理支持

### `index.html`
- **Clerk SDK**: 自动加载最新版本的Clerk JavaScript SDK
- **认证UI**: 完整的登录/注册/退出登录界面
- **状态管理**: 实时显示认证状态和用户信息
- **Token管理**: 自动获取和管理JWT Token

## 故障排除

### 常见问题

1. **Clerk SDK加载失败**:
   - 检查网络连接
   - 确认Clerk Publishable Key是否正确设置

2. **JWT Token获取失败**:
   - 确保用户已正确登录
   - 检查Clerk会话是否有效

3. **WebSocket票据获取失败**:
   - 确认JWT Token已获取
   - 检查后端服务是否正常运行
   - 查看浏览器控制台的错误信息

4. **WebSocket连接失败**:
   - 确认票据是否有效且未过期
   - 检查后端WebSocket服务状态
   - 确认Vite代理配置正确

### 调试工具

- **实时日志**: 设置面板中的实时日志显示所有操作状态
- **浏览器控制台**: 查看详细的错误信息和调试日志
- **网络面板**: 监控API请求和WebSocket连接状态

## 安全注意事项

- JWT Token会自动复制到剪贴板，注意保护敏感信息
- WebSocket票据有时效性，过期后需要重新获取
- 所有认证信息都存储在浏览器会话中，关闭浏览器后需要重新认证
- Clerk Publishable Key可以公开，但不要泄露Secret Key