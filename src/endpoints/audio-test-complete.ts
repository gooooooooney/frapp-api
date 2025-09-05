// 完整的WebSocket音频流测试页面 - 集成Clerk真实认证
import { z } from 'zod';
import { OpenAPIRoute } from 'chanfana';
import { AppContext } from '../types';

export class AudioTestComplete extends OpenAPIRoute {
  schema = {
    tags: ['Audio Testing'],
    summary: '完整的WebSocket音频流测试界面',
    description: '包含Clerk认证、WebSocket连接、音频录制和R2存储的完整测试流程',
    responses: {
      '200': {
        description: '测试页面HTML',
        content: {
          'text/html': {
            schema: z.string()
          }
        }
      }
    }
  };

  async handle(c: AppContext) {
    const host = c.req.header('host') || 'localhost:8787';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const wsProtocol = host.includes('localhost') ? 'ws' : 'wss';
    const publishableKey = c.env.CLERK_PUBLISHABLE_KEY || 'pk_test_your_key_here';

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🎵 完整音频流测试 - WebSocket + R2存储 (Clerk认证)</title>
    <script
        async
        crossorigin="anonymous"
        data-clerk-publishable-key="${publishableKey}"
        src="https://unpkg.com/@clerk/clerk-js@latest/dist/clerk.browser.js"
        type="text/javascript"
    ></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #333;
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px;
            padding: 30px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
        }
        
        .header {
            text-align: center;
            margin-bottom: 40px;
        }
        
        .header h1 {
            color: #4a5568;
            font-size: 2.5em;
            margin-bottom: 10px;
        }
        
        .step-container {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 25px;
            margin-bottom: 30px;
        }
        
        .step-card {
            background: white;
            border-radius: 15px;
            padding: 25px;
            border: 2px solid #e2e8f0;
            transition: all 0.3s ease;
        }
        
        .step-card.active {
            border-color: #4299e1;
            box-shadow: 0 0 20px rgba(66, 153, 225, 0.3);
        }
        
        .step-card.completed {
            border-color: #48bb78;
            background: linear-gradient(135deg, #f0fff4 0%, #c6f6d5 100%);
        }
        
        .step-header {
            display: flex;
            align-items: center;
            margin-bottom: 20px;
        }
        
        .step-number {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            margin-right: 15px;
            background: #edf2f7;
            color: #4a5568;
        }
        
        .step-card.active .step-number {
            background: #4299e1;
            color: white;
        }
        
        .step-card.completed .step-number {
            background: #48bb78;
            color: white;
        }
        
        .step-title {
            font-size: 1.3em;
            font-weight: bold;
            color: #2d3748;
        }
        
        .form-group {
            margin-bottom: 20px;
        }
        
        .form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #4a5568;
        }
        
        .form-group input, .form-group select {
            width: 100%;
            padding: 12px 16px;
            border: 2px solid #e2e8f0;
            border-radius: 8px;
            font-size: 16px;
            transition: border-color 0.3s;
        }
        
        .form-group input:focus, .form-group select:focus {
            outline: none;
            border-color: #4299e1;
        }
        
        .btn {
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            margin: 5px;
            min-width: 120px;
        }
        
        .btn-primary {
            background: #5d4fb3;
            color: white;
        }
        
        .btn-primary:hover {
            background: #4c3a9b;
            transform: translateY(-2px);
        }
        
        .btn-success {
            background: #48bb78;
            color: white;
        }
        
        .btn-danger {
            background: #f56565;
            color: white;
        }
        
        .btn-secondary {
            background: #a0aec0;
            color: white;
        }
        
        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }
        
        .status-display {
            background: #f7fafc;
            border-radius: 8px;
            padding: 15px;
            margin-top: 15px;
            border-left: 4px solid #4299e1;
        }
        
        .status-success {
            border-left-color: #48bb78;
            background: #f0fff4;
        }
        
        .status-error {
            border-left-color: #f56565;
            background: #fed7d7;
        }
        
        .status-warning {
            border-left-color: #ed8936;
            background: #fef5e7;
        }
        
        .user-info {
            background: #e3f2fd;
            padding: 15px;
            border-radius: 8px;
            margin: 15px 0;
            font-size: 14px;
        }
        
        .audio-controls {
            text-align: center;
            margin: 20px 0;
        }
        
        .audio-visualizer {
            width: 100%;
            height: 100px;
            background: #1a202c;
            border-radius: 8px;
            margin: 15px 0;
            position: relative;
            overflow: hidden;
        }
        
        .waveform {
            position: absolute;
            bottom: 50%;
            left: 0;
            right: 0;
            height: 2px;
            background: #48bb78;
            transform-origin: center;
            transition: transform 0.1s;
        }
        
        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-top: 20px;
        }
        
        .metric-item {
            background: white;
            padding: 15px;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
            text-align: center;
        }
        
        .metric-value {
            font-size: 2em;
            font-weight: bold;
            color: #4299e1;
            display: block;
        }
        
        .metric-label {
            color: #718096;
            font-size: 0.9em;
            margin-top: 5px;
        }
        
        .log-container {
            background: #1a202c;
            color: #e2e8f0;
            padding: 20px;
            border-radius: 8px;
            max-height: 300px;
            overflow-y: auto;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            margin-top: 20px;
        }
        
        .log-entry {
            margin: 5px 0;
            padding: 5px;
            border-radius: 4px;
        }
        
        .log-info { background: rgba(66, 153, 225, 0.1); }
        .log-success { background: rgba(72, 187, 120, 0.1); }
        .log-error { background: rgba(245, 101, 101, 0.1); }
        .log-warning { background: rgba(237, 137, 54, 0.1); }
        
        .progress-bar {
            width: 100%;
            height: 20px;
            background: #e2e8f0;
            border-radius: 10px;
            overflow: hidden;
            margin: 10px 0;
        }
        
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #4299e1, #48bb78);
            width: 0%;
            transition: width 0.3s ease;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        
        .recording {
            animation: pulse 1s infinite;
        }
        
        .vad-indicator {
            display: inline-block;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: #a0aec0;
            margin-right: 8px;
            transition: all 0.3s ease;
        }
        
        .vad-indicator.active {
            background: #48bb78;
            box-shadow: 0 0 10px rgba(72, 187, 120, 0.5);
        }
        
        .vad-indicator.inactive {
            background: #f56565;
        }

        .loading-screen {
            text-align: center;
            padding: 50px 20px;
        }

        .loading-spinner {
            border: 4px solid #f3f3f3;
            border-top: 4px solid #4299e1;
            border-radius: 50%;
            width: 50px;
            height: 50px;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎵 完整音频流测试系统</h1>
            <p>Clerk认证 → WebSocket连接 → 音频录制 → VAD处理 → R2存储</p>
        </div>

        <!-- 加载屏幕 -->
        <div id="loading-screen" class="loading-screen">
            <div class="loading-spinner"></div>
            <p>正在加载 Clerk SDK...</p>
        </div>

        <!-- 主要内容 -->
        <div id="main-content" style="display: none;">
            <div class="step-container">
                <!-- Step 1: Clerk认证 -->
                <div class="step-card" id="step-auth">
                    <div class="step-header">
                        <div class="step-number">1</div>
                        <div class="step-title">Clerk 用户认证</div>
                    </div>
                    
                    <div id="signed-out" style="display: none;">
                        <p>请先登录您的账户以继续测试</p>
                        <button class="btn btn-primary" onclick="signIn()">🔐 登录</button>
                        <button class="btn btn-secondary" onclick="signUp()">📝 注册</button>
                    </div>
                    
                    <div id="signed-in" style="display: none;">
                        <p>✅ 已成功登录</p>
                        <div id="user-info" class="user-info"></div>
                        <button class="btn btn-primary" id="btn-get-token">🎫 获取JWT Token</button>
                        <button class="btn btn-secondary" onclick="signOutUser()">🚪 退出登录</button>
                    </div>
                    
                    <div class="status-display" id="auth-status" style="display: none;"></div>
                </div>

                <!-- Step 2: WebSocket Ticket -->
                <div class="step-card" id="step-ticket">
                    <div class="step-header">
                        <div class="step-number">2</div>
                        <div class="step-title">WebSocket凭证</div>
                    </div>
                    <p>使用认证Token获取WebSocket连接凭证</p>
                    <button class="btn btn-primary" id="btn-ticket" disabled>🎫 获取WebSocket Ticket</button>
                    <div class="status-display" id="ticket-status" style="display: none;"></div>
                </div>

                <!-- Step 3: WebSocket连接 -->
                <div class="step-card" id="step-websocket">
                    <div class="step-header">
                        <div class="step-number">3</div>
                        <div class="step-title">WebSocket连接</div>
                    </div>
                    <div class="form-group">
                        <label for="wsUrl">WebSocket地址</label>
                        <input type="text" id="wsUrl" value="${wsProtocol}://${host}/api/ws" readonly>
                    </div>
                    <button class="btn btn-primary" id="btn-connect" disabled>🔌 建立WebSocket连接</button>
                    <div class="status-display" id="ws-status" style="display: none;"></div>
                </div>

                <!-- Step 4: 音频录制 -->
                <div class="step-card" id="step-audio">
                    <div class="step-header">
                        <div class="step-number">4</div>
                        <div class="step-title">音频录制与传输</div>
                    </div>
                    
                    <div class="audio-controls">
                        <button class="btn btn-success" id="btn-start-audio" disabled>🎤 开始录音</button>
                        <button class="btn btn-danger" id="btn-stop-audio" disabled>⏹️ 停止录音</button>
                    </div>
                    
                    <div class="audio-visualizer" id="audioVisualizer">
                        <div class="waveform" id="waveform"></div>
                    </div>
                    
                    <div class="form-group">
                        <label>
                            <span class="vad-indicator" id="vadIndicator"></span>
                            VAD状态: <span id="vadStatus">未检测</span>
                        </label>
                    </div>
                    
                    <div class="status-display" id="audio-status" style="display: none;"></div>
                </div>
            </div>

            <!-- 实时监控面板 -->
            <div class="step-card">
                <div class="step-header">
                    <div class="step-number">📊</div>
                    <div class="step-title">实时监控</div>
                </div>
                
                <div class="metrics-grid">
                    <div class="metric-item">
                        <span class="metric-value" id="chunksCount">0</span>
                        <div class="metric-label">音频块数量</div>
                    </div>
                    <div class="metric-item">
                        <span class="metric-value" id="vadDetections">0</span>
                        <div class="metric-label">VAD检测次数</div>
                    </div>
                    <div class="metric-item">
                        <span class="metric-value" id="transcriptions">0</span>
                        <div class="metric-label">转录完成数</div>
                    </div>
                    <div class="metric-item">
                        <span class="metric-value" id="storageUploads">0</span>
                        <div class="metric-label">存储上传数</div>
                    </div>
                    <div class="metric-item">
                        <span class="metric-value" id="sessionDuration">0s</span>
                        <div class="metric-label">会话时长</div>
                    </div>
                    <div class="metric-item">
                        <span class="metric-value" id="dataTransferred">0 KB</span>
                        <div class="metric-label">传输数据量</div>
                    </div>
                </div>
                
                <div class="audio-controls">
                    <button class="btn btn-secondary" id="btn-check-storage">📦 检查R2存储</button>
                    <button class="btn btn-secondary" id="btn-clear-logs">🧹 清空日志</button>
                    <button class="btn btn-secondary" id="btn-reset-test">🔄 重置测试</button>
                </div>
            </div>

            <!-- 日志面板 -->
            <div class="log-container" id="logContainer">
                <div class="log-entry log-info">🎵 音频流测试系统已加载，请先完成Clerk认证...</div>
            </div>
        </div>
    </div>

    <script>
        class AudioStreamTester {
            constructor() {
                this.authToken = null;
                this.wsTicket = null;
                this.websocket = null;
                this.mediaRecorder = null;
                this.audioStream = null;
                this.audioContext = null;
                this.audioSource = null;
                this.audioProcessor = null;
                this.isRecording = false;
                this.sessionStartTime = null;
                this.currentUser = null;
                
                // 统计数据
                this.stats = {
                    chunksCount: 0,
                    vadDetections: 0,
                    transcriptions: 0,
                    storageUploads: 0,
                    dataTransferred: 0
                };
                
                // 音频参数
                this.audioConfig = {
                    sampleRate: 16000,
                    chunkDuration: 128,
                    vadEnabled: true
                };
                
                this.initializeClerk();
            }

            async initializeClerk() {
                try {
                    // 等待 Clerk SDK 加载
                    if (!window.Clerk) {
                        await new Promise((resolve) => {
                            const checkClerk = () => {
                                if (window.Clerk) {
                                    resolve();
                                } else {
                                    setTimeout(checkClerk, 100);
                                }
                            };
                            checkClerk();
                        });
                    }

                    await window.Clerk.load();
                    console.log('ClerkJS loaded successfully');

                    // 隐藏加载屏幕
                    document.getElementById('loading-screen').style.display = 'none';
                    document.getElementById('main-content').style.display = 'block';

                    this.logInfo('🔐 Clerk SDK 加载成功');
                    this.initializeEventListeners();
                    this.checkAuthState();

                    // 监听认证状态变化
                    window.Clerk.addListener(() => this.checkAuthState());

                } catch (error) {
                    console.error('Clerk initialization failed:', error);
                    this.logError('❌ Clerk SDK 加载失败: ' + error.message);
                    document.getElementById('loading-screen').innerHTML = 
                        '<p style="color: #f56565;">Clerk SDK 加载失败，请检查网络连接和配置</p>';
                }
            }
            
            initializeEventListeners() {
                document.getElementById('btn-get-token').addEventListener('click', () => this.getClerkToken());
                document.getElementById('btn-ticket').addEventListener('click', () => this.getWebSocketTicket());
                document.getElementById('btn-connect').addEventListener('click', () => this.connectWebSocket());
                document.getElementById('btn-start-audio').addEventListener('click', () => this.startAudioRecording());
                document.getElementById('btn-stop-audio').addEventListener('click', () => this.stopAudioRecording());
                document.getElementById('btn-check-storage').addEventListener('click', () => this.checkR2Storage());
                document.getElementById('btn-clear-logs').addEventListener('click', () => this.clearLogs());
                document.getElementById('btn-reset-test').addEventListener('click', () => this.resetTest());
            }

            checkAuthState() {
                const user = window.Clerk.user;
                const session = window.Clerk.session;
                
                if (user && session) {
                    this.currentUser = user;
                    document.getElementById('signed-out').style.display = 'none';
                    document.getElementById('signed-in').style.display = 'block';
                    
                    // 显示用户信息
                    const userInfo = document.getElementById('user-info');
                    userInfo.innerHTML = 
                        '<strong>用户ID:</strong> ' + user.id + '<br>' +
                        '<strong>邮箱:</strong> ' + (user.primaryEmailAddress?.emailAddress || 'N/A') + '<br>' +
                        '<strong>姓名:</strong> ' + (user.fullName || 'N/A');
                    
                    this.logSuccess('✅ 用户已登录: ' + (user.fullName || user.id));
                    this.setStepActive('step-auth');
                    
                } else {
                    this.currentUser = null;
                    this.authToken = null;
                    document.getElementById('signed-out').style.display = 'block';
                    document.getElementById('signed-in').style.display = 'none';
                    this.logInfo('👤 用户未登录，请先完成认证');
                    this.resetAllSteps();
                }
            }

            async getClerkToken() {
                if (!window.Clerk.session) {
                    this.logError('❌ 没有活动会话，请重新登录');
                    return;
                }

                this.logInfo('🎫 正在获取Clerk JWT Token...');

                try {
                    // 获取默认token
                    const token = await window.Clerk.session.getToken();
                    
                    if (!token) {
                        throw new Error('无法获取JWT Token');
                    }

                    this.authToken = token;
                    this.logSuccess('✅ JWT Token获取成功: ' + token.substring(0, 30) + '...');
                    this.showStatus('auth-status', 'JWT Token获取成功！', 'success');
                    
                    // 自动复制token到剪贴板
                    try {
                        await navigator.clipboard.writeText(token);
                        this.logInfo('📋 Token已复制到剪贴板');
                    } catch (e) {
                        console.log('无法自动复制token');
                    }

                    this.setStepCompleted('step-auth');
                    this.enableStep('step-ticket');
                    
                } catch (error) {
                    this.logError('❌ Token获取失败: ' + error.message);
                    this.showStatus('auth-status', 'Token获取失败: ' + error.message, 'error');
                }
            }
            
            async getWebSocketTicket() {
                if (!this.authToken) {
                    this.logError('❌ 请先获取JWT Token');
                    return;
                }
                
                this.logInfo('🎫 获取WebSocket连接凭证...');
                this.setStepActive('step-ticket');
                
                try {
                    const response = await fetch('/api/ws/ticket', {
                        method: 'POST',
                        headers: {
                            'Authorization': 'Bearer ' + this.authToken,
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    if (!response.ok) {
                        const errorData = await response.text();
                        throw new Error('HTTP ' + response.status + ': ' + errorData);
                    }
                    
                    const data = await response.json();
                    this.wsTicket = data.ticket;
                    
                    this.logSuccess('✅ WebSocket Ticket获取成功: ' + data.ticket.substring(0, 20) + '...');
                    this.showStatus('ticket-status', 'Ticket获取成功，有效期: ' + data.expires_in + '秒', 'success');
                    this.setStepCompleted('step-ticket');
                    this.enableStep('step-websocket');
                    
                } catch (error) {
                    this.logError('❌ Ticket获取失败: ' + error.message);
                    this.showStatus('ticket-status', '获取失败: ' + error.message, 'error');
                }
            }
            
            async connectWebSocket() {
                if (!this.wsTicket) {
                    this.logError('❌ 请先获取WebSocket Ticket');
                    return;
                }
                
                const wsUrl = document.getElementById('wsUrl').value;
                this.logInfo('🔌 连接WebSocket: ' + wsUrl);
                this.setStepActive('step-websocket');
                
                try {
                    this.websocket = new WebSocket(wsUrl);
                    
                    this.websocket.onopen = () => {
                        this.logInfo('🔌 WebSocket连接已建立，发送认证ticket...');
                        
                        const authMessage = {
                            type: 'auth',
                            ticket: this.wsTicket
                        };
                        this.websocket.send(JSON.stringify(authMessage));
                    };
                    
                    this.websocket.onmessage = (event) => {
                        this.handleWebSocketMessage(event);
                    };
                    
                    this.websocket.onclose = (event) => {
                        this.logWarning('🔌 WebSocket连接已关闭: ' + event.code + ' - ' + event.reason);
                        this.showStatus('ws-status', '连接已关闭: ' + event.reason, 'warning');
                        this.resetAudioState();
                    };
                    
                    this.websocket.onerror = (error) => {
                        this.logError('❌ WebSocket错误: ' + error);
                        this.showStatus('ws-status', 'WebSocket连接错误', 'error');
                    };
                    
                } catch (error) {
                    this.logError('❌ WebSocket连接失败: ' + error.message);
                    this.showStatus('ws-status', '连接失败: ' + error.message, 'error');
                }
            }
            
            handleWebSocketMessage(event) {
                try {
                    const message = JSON.parse(event.data);
                    
                    switch (message.type) {
                        case 'auth_success':
                            this.logSuccess('✅ WebSocket认证成功，用户: ' + message.userId);
                            this.showStatus('ws-status', '认证成功，连接已建立', 'success');
                            this.setStepCompleted('step-websocket');
                            this.enableStep('step-audio');
                            break;
                            
                        case 'auth_error':
                            this.logError('❌ WebSocket认证失败: ' + message.error);
                            this.showStatus('ws-status', '认证失败: ' + message.error, 'error');
                            break;
                            
                        case 'audio_stream_start_ack':
                            this.logInfo('🎤 音频流开始确认');
                            this.sessionStartTime = Date.now();
                            break;
                            
                        case 'vad_cache_start':
                            this.logInfo('🎯 VAD检测开始');
                            this.updateVADStatus('start');
                            this.stats.vadDetections++;
                            break;
                            
                        case 'vad_cache_end':
                            this.logInfo('🎯 VAD检测结束，开始转录...');
                            this.updateVADStatus('end');
                            break;
                            
                        case 'transcription_result':
                            this.logSuccess('📝 转录结果: "' + message.text + '"');
                            this.logInfo('⏱️ 处理时间: ' + message.performance.total_processing_ms + 'ms (' + message.performance.provider + ')');
                            this.stats.transcriptions++;
                            break;
                            
                        case 'transcription_error':
                            this.logError('❌ 转录错误: ' + message.error);
                            break;
                            
                        case 'audio_stream_end_ack':
                            this.logInfo('🎤 音频流结束，共处理 ' + message.receivedChunks + ' 个音频块');
                            break;
                            
                        case 'debug_audio':
                            this.logInfo('🔍 调试音频数据: ' + Math.round(message.audioData.length/1024) + 'KB');
                            break;
                            
                        default:
                            this.logWarning('⚠️ 未知消息类型: ' + message.type);
                    }
                    
                    this.updateMetrics();
                    
                } catch (error) {
                    this.logError('❌ 消息解析错误: ' + error.message);
                }
            }
            
            async startAudioRecording() {
                if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
                    this.logError('❌ WebSocket未连接，请先建立连接');
                    return;
                }
                
                this.logInfo('🎤 请求麦克风权限...');
                
                try {
                    // 获取音频流
                    this.audioStream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            sampleRate: this.audioConfig.sampleRate,
                            channelCount: 1,
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true
                        }
                    });
                    
                    this.logSuccess('✅ 麦克风权限获取成功');
                    this.setStepActive('step-audio');
                    
                    // 使用AudioContext进行实时音频处理
                    this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                        sampleRate: this.audioConfig.sampleRate
                    });
                    
                    this.setupRealtimeAudioProcessing();
                    
                    this.isRecording = true;
                    
                    const startMessage = { type: 'audio_stream_start' };
                    this.websocket.send(JSON.stringify(startMessage));
                    
                    document.getElementById('btn-start-audio').disabled = true;
                    document.getElementById('btn-stop-audio').disabled = false;
                    document.getElementById('step-audio').classList.add('recording');
                    
                    this.logSuccess('🎤 录音已开始，实时音频处理中...');
                    this.showStatus('audio-status', '录音进行中...', 'success');
                    
                } catch (error) {
                    this.logError('❌ 录音启动失败: ' + error.message);
                    this.showStatus('audio-status', '录音失败: ' + error.message, 'error');
                }
            }
            
            setupRealtimeAudioProcessing() {
                // 创建音频源节点
                this.audioSource = this.audioContext.createMediaStreamSource(this.audioStream);
                
                // 使用ScriptProcessorNode进行实时音频处理 (兼容性更好)
                const bufferSize = 4096;
                this.audioProcessor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
                
                let audioBuffer = [];
                let bufferDuration = 0;
                const targetDuration = this.audioConfig.chunkDuration; // 128ms
                
                this.audioProcessor.onaudioprocess = (event) => {
                    if (!this.isRecording) return;
                    
                    const inputBuffer = event.inputBuffer;
                    const inputData = inputBuffer.getChannelData(0);
                    
                    // 转换为16位PCM
                    const pcmData = new Int16Array(inputData.length);
                    for (let i = 0; i < inputData.length; i++) {
                        pcmData[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
                    }
                    
                    // 添加到缓冲区
                    audioBuffer.push(pcmData);
                    bufferDuration += (inputData.length / this.audioConfig.sampleRate) * 1000;
                    
                    // 当缓冲区达到目标时长时发送
                    if (bufferDuration >= targetDuration) {
                        this.sendAudioChunk(audioBuffer);
                        
                        // 重置缓冲区
                        audioBuffer = [];
                        bufferDuration = 0;
                    }
                    
                    // 更新可视化 (使用原始音频数据)
                    this.updateAudioVisualizerFromFloat32(inputData);
                };
                
                // 连接音频处理管道
                this.audioSource.connect(this.audioProcessor);
                this.audioProcessor.connect(this.audioContext.destination);
                
                this.logSuccess('✅ 实时音频处理管道已建立');
            }
            
            sendAudioChunk(audioBuffer) {
                try {
                    // 合并所有音频块
                    let totalLength = 0;
                    for (const chunk of audioBuffer) {
                        totalLength += chunk.length;
                    }
                    
                    const combinedBuffer = new Int16Array(totalLength);
                    let offset = 0;
                    for (const chunk of audioBuffer) {
                        combinedBuffer.set(chunk, offset);
                        offset += chunk.length;
                    }
                    
                    // 检测VAD
                    const vadState = this.detectVAD(combinedBuffer.buffer);
                    
                    // 转换为base64
                    const base64Data = this.arrayBufferToBase64(combinedBuffer.buffer);
                    
                    // 发送WebSocket消息
                    const audioMessage = {
                        type: 'audio_chunk',
                        data: base64Data,
                        vad_state: vadState,
                        vad_offset_ms: vadState ? 0 : undefined
                    };
                    
                    this.websocket.send(JSON.stringify(audioMessage));
                    
                    // 更新统计
                    this.stats.chunksCount++;
                    this.stats.dataTransferred += base64Data.length;
                    
                    this.logInfo('📡 音频块传输: ' + Math.round(base64Data.length/1024) + 'KB VAD:' + (vadState||'none'));
                    
                } catch (error) {
                    this.logError('❌ 音频块发送失败: ' + error.message);
                }
            }
            
            updateAudioVisualizerFromFloat32(float32Data) {
                let sum = 0;
                for (let i = 0; i < float32Data.length; i++) {
                    sum += Math.abs(float32Data[i]);
                }
                
                const average = sum / float32Data.length;
                const percentage = Math.min(100, (average * 100));
                
                const waveform = document.getElementById('waveform');
                waveform.style.transform = 'scaleY(' + Math.max(1, percentage * 10) + ')';
                waveform.style.background = percentage > 0.01 ? '#48bb78' : '#a0aec0';
            }
            
            // 保留webmToPCM方法以防需要 (但不再使用)
            async webmToPCM(webmBlob) {
                try {
                    const audioContext = new (window.AudioContext || window.webkitAudioContext)({
                        sampleRate: this.audioConfig.sampleRate
                    });
                    
                    const arrayBuffer = await webmBlob.arrayBuffer();
                    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                    
                    const pcmData = new Int16Array(audioBuffer.length);
                    const channelData = audioBuffer.getChannelData(0);
                    
                    for (let i = 0; i < channelData.length; i++) {
                        pcmData[i] = Math.max(-32768, Math.min(32767, channelData[i] * 32768));
                    }
                    
                    await audioContext.close();
                    return pcmData.buffer;
                    
                } catch (error) {
                    this.logWarning('⚠️ WebM转PCM失败，使用模拟数据: ' + error.message);
                    const sampleCount = Math.floor(this.audioConfig.sampleRate * this.audioConfig.chunkDuration / 1000);
                    const pcmData = new Int16Array(sampleCount);
                    for (let i = 0; i < sampleCount; i++) {
                        pcmData[i] = Math.random() * 2000 - 1000;
                    }
                    return pcmData.buffer;
                }
            }
            
            detectVAD(audioBuffer) {
                const int16Array = new Int16Array(audioBuffer);
                let sum = 0;
                let peak = 0;
                
                for (let i = 0; i < int16Array.length; i++) {
                    const abs = Math.abs(int16Array[i]);
                    sum += abs;
                    peak = Math.max(peak, abs);
                }
                
                const average = sum / int16Array.length;
                const threshold = 500;
                
                if (Math.random() < 0.1) {
                    return Math.random() < 0.5 ? 'start' : 'end';
                }
                
                return average > threshold ? (Math.random() < 0.3 ? 'start' : undefined) : undefined;
            }
            
            updateAudioVisualizer(audioBuffer) {
                const int16Array = new Int16Array(audioBuffer);
                let sum = 0;
                
                for (let i = 0; i < int16Array.length; i++) {
                    sum += Math.abs(int16Array[i]);
                }
                
                const average = sum / int16Array.length;
                const percentage = Math.min(100, (average / 32768) * 100);
                
                const waveform = document.getElementById('waveform');
                waveform.style.transform = 'scaleY(' + Math.max(1, percentage) + ')';
                waveform.style.background = percentage > 10 ? '#48bb78' : '#a0aec0';
            }
            
            updateVADStatus(state) {
                const vadIndicator = document.getElementById('vadIndicator');
                const vadStatus = document.getElementById('vadStatus');
                
                if (state === 'start') {
                    vadIndicator.className = 'vad-indicator active';
                    vadStatus.textContent = '检测到语音开始';
                } else if (state === 'end') {
                    vadIndicator.className = 'vad-indicator inactive';
                    vadStatus.textContent = '语音结束';
                } else {
                    vadIndicator.className = 'vad-indicator';
                    vadStatus.textContent = '未检测到语音';
                }
            }
            
            stopAudioRecording() {
                if (this.isRecording) {
                    this.logInfo('⏹️ 停止录音...');
                    
                    this.isRecording = false;
                    
                    // 清理音频处理组件
                    if (this.audioProcessor) {
                        this.audioProcessor.disconnect();
                        this.audioProcessor = null;
                    }
                    
                    if (this.audioSource) {
                        this.audioSource.disconnect();
                        this.audioSource = null;
                    }
                    
                    if (this.audioContext && this.audioContext.state !== 'closed') {
                        this.audioContext.close().catch(err => 
                            console.warn('AudioContext close failed:', err)
                        );
                        this.audioContext = null;
                    }
                    
                    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
                        const endMessage = { type: 'audio_stream_end' };
                        this.websocket.send(JSON.stringify(endMessage));
                    }
                    
                    this.resetAudioState();
                    this.logSuccess('✅ 录音已停止');
                    this.showStatus('audio-status', '录音已停止', 'success');
                    this.setStepCompleted('step-audio');
                }
            }
            
            resetAudioState() {
                // 清理音频处理组件
                if (this.audioProcessor) {
                    this.audioProcessor.disconnect();
                    this.audioProcessor = null;
                }
                
                if (this.audioSource) {
                    this.audioSource.disconnect();
                    this.audioSource = null;
                }
                
                if (this.audioContext && this.audioContext.state !== 'closed') {
                    this.audioContext.close().catch(err => 
                        console.warn('AudioContext cleanup failed:', err)
                    );
                    this.audioContext = null;
                }
                
                if (this.audioStream) {
                    this.audioStream.getTracks().forEach(track => track.stop());
                    this.audioStream = null;
                }
                
                // 清理MediaRecorder (如果存在)
                if (this.mediaRecorder) {
                    this.mediaRecorder = null;
                }
                
                document.getElementById('btn-start-audio').disabled = false;
                document.getElementById('btn-stop-audio').disabled = true;
                document.getElementById('step-audio').classList.remove('recording');
                
                this.updateVADStatus(null);
            }
            
            async checkR2Storage() {
                if (!this.authToken || !this.currentUser) {
                    this.logError('❌ 请先完成认证');
                    return;
                }

                const userId = this.currentUser.id;
                this.logInfo('📦 检查用户 ' + userId + ' 的R2存储状态...');
                
                try {
                    const response = await fetch('/api/audio-storage/files/' + userId + '?limit=10', {
                        headers: {
                            'Authorization': 'Bearer ' + this.authToken
                        }
                    });
                    
                    if (!response.ok) {
                        throw new Error('HTTP ' + response.status);
                    }
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        this.logSuccess('📦 R2存储检查成功:');
                        this.logInfo('   - 文件数量: ' + data.data.totalFiles);
                        this.logInfo('   - 总大小: ' + Math.round(data.data.totalSize/1024) + 'KB');
                        
                        data.data.files.forEach((file, index) => {
                            this.logInfo('   [' + (index+1) + '] ' + file.filename + ' (' + Math.round(file.size/1024) + 'KB)');
                        });
                        
                        this.stats.storageUploads = data.data.totalFiles;
                        this.updateMetrics();
                        
                    } else {
                        this.logWarning('⚠️ ' + data.error);
                    }
                    
                } catch (error) {
                    this.logError('❌ R2存储检查失败: ' + error.message);
                }
            }
            
            updateMetrics() {
                document.getElementById('chunksCount').textContent = this.stats.chunksCount;
                document.getElementById('vadDetections').textContent = this.stats.vadDetections;
                document.getElementById('transcriptions').textContent = this.stats.transcriptions;
                document.getElementById('storageUploads').textContent = this.stats.storageUploads;
                document.getElementById('dataTransferred').textContent = Math.round(this.stats.dataTransferred/1024) + ' KB';
                
                if (this.sessionStartTime) {
                    const duration = Math.round((Date.now() - this.sessionStartTime) / 1000);
                    document.getElementById('sessionDuration').textContent = duration + 's';
                }
            }
            
            arrayBufferToBase64(buffer) {
                const bytes = new Uint8Array(buffer);
                let binary = '';
                for (let i = 0; i < bytes.byteLength; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                return btoa(binary);
            }
            
            setStepActive(stepId) {
                document.querySelectorAll('.step-card').forEach(card => {
                    card.classList.remove('active');
                });
                document.getElementById(stepId).classList.add('active');
            }
            
            setStepCompleted(stepId) {
                const step = document.getElementById(stepId);
                step.classList.remove('active');
                step.classList.add('completed');
            }
            
            enableStep(stepId) {
                const buttons = document.querySelectorAll('#' + stepId + ' button');
                buttons.forEach(btn => btn.disabled = false);
            }
            
            showStatus(statusId, message, type) {
                const status = document.getElementById(statusId);
                status.style.display = 'block';
                status.textContent = message;
                status.className = 'status-display status-' + type;
            }

            resetAllSteps() {
                // 重置所有步骤状态
                document.querySelectorAll('.step-card').forEach(card => {
                    card.classList.remove('active', 'completed');
                });
                
                // 禁用后续步骤的按钮
                document.getElementById('btn-ticket').disabled = true;
                document.getElementById('btn-connect').disabled = true;
                document.getElementById('btn-start-audio').disabled = false;
                document.getElementById('btn-stop-audio').disabled = true;
                
                // 清除状态显示
                document.querySelectorAll('.status-display').forEach(status => {
                    status.style.display = 'none';
                });
            }
            
            logInfo(message) { this.addLogEntry(message, 'info'); }
            logSuccess(message) { this.addLogEntry(message, 'success'); }
            logWarning(message) { this.addLogEntry(message, 'warning'); }
            logError(message) { this.addLogEntry(message, 'error'); }
            
            addLogEntry(message, type) {
                const container = document.getElementById('logContainer');
                const entry = document.createElement('div');
                const timestamp = new Date().toLocaleTimeString();
                
                entry.className = 'log-entry log-' + type;
                entry.textContent = '[' + timestamp + '] ' + message;
                
                container.appendChild(entry);
                container.scrollTop = container.scrollHeight;
                
                console.log('[' + type.toUpperCase() + '] ' + message);
            }
            
            clearLogs() {
                document.getElementById('logContainer').innerHTML = '';
                this.logInfo('🧹 日志已清空');
            }
            
            resetTest() {
                if (this.isRecording) {
                    this.stopAudioRecording();
                }
                
                if (this.websocket) {
                    this.websocket.close();
                    this.websocket = null;
                }
                
                this.wsTicket = null;
                
                this.stats = {
                    chunksCount: 0,
                    vadDetections: 0,
                    transcriptions: 0,
                    storageUploads: 0,
                    dataTransferred: 0
                };
                
                this.resetAllSteps();
                this.updateMetrics();
                this.clearLogs();
                this.logInfo('🔄 测试环境已重置，Token保持有效');
            }
        }

        // Clerk 全局函数
        function signIn() {
            try {
                window.Clerk.openSignIn();
            } catch (error) {
                console.error('登录失败:', error);
            }
        }
        
        function signUp() {
            try {
                window.Clerk.openSignUp();
            } catch (error) {
                console.error('注册失败:', error);
            }
        }
        
        async function signOutUser() {
            try {
                await window.Clerk.signOut();
            } catch (error) {
                console.error('退出失败:', error);
            }
        }
        
        // 初始化测试系统
        const audioTester = new AudioStreamTester();
        
        window.addEventListener('load', () => {
            console.log('🎵 Audio Stream Tester with Clerk Auth loaded successfully');
        });
    </script>
</body>
</html>`;

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html',
      },
    });
  }
}