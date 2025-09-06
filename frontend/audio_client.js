/**
 * 实时音频流处理模块 - 优化版本
 */

// 轻量级环形缓冲区实现
class RingBuffer {
    constructor(size, ArrayType = Int16Array) {
        this.buffer = new ArrayType(size);
        this.size = size;
        this.writePos = 0;
        this.readPos = 0;
        this.count = 0;
    }
    
    write(data) {
        const remaining = this.size - this.count;
        const toWrite = Math.min(data.length, remaining);
        
        for (let i = 0; i < toWrite; i++) {
            this.buffer[this.writePos] = data[i];
            this.writePos = (this.writePos + 1) % this.size;
        }
        this.count += toWrite;
        return toWrite;
    }
    
    read(output, length) {
        const toRead = Math.min(length, this.count);
        
        for (let i = 0; i < toRead; i++) {
            output[i] = this.buffer[this.readPos];
            this.readPos = (this.readPos + 1) % this.size;
        }
        this.count -= toRead;
        return toRead;
    }
    
    available() { return this.count; }
    reset() { this.writePos = this.readPos = this.count = 0; }
}


// 轻量级事件发射器
class MiniEventEmitter {
    constructor() { this.events = {}; }
    on(event, callback) { (this.events[event] = this.events[event] || []).push(callback); }
    emit(event, data) { (this.events[event] || []).forEach(cb => cb(data)); }
}

// WebSocket管理器类
class WebSocketManager {
    constructor() {
        this.ws = null;
        this.serverUrl = '';
        this.isConnected = false;
        this.isStreaming = false;
        this.messageCounter = 0;
        this.eventEmitter = new MiniEventEmitter();
        
        // 统计数据
        this.stats = {
            debugAudioCounter: 0,
            vadEndTimestamps: [],
            sentChunks: 0,
            receivedMessages: 0
        };
    }

    // 连接到WebSocket服务器
    async connect(serverUrl, ticket) {
        if (this.isConnected || this.ws) {
            console.warn('WebSocket已连接或正在连接中');
            return false;
        }

        // 转换相对路径为完整的WebSocket URL
        if (serverUrl.startsWith('/')) {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const host = window.location.host;
            serverUrl = `${protocol}//${host}${serverUrl}`;
        }

        this.serverUrl = serverUrl;
        
        return new Promise((resolve, reject) => {
            console.log(`🔌 正在连接WebSocket服务器: ${serverUrl}`);
            
            let resolved = false;  // 标记 Promise 是否已经解决
            let authTimeout = null; // 认证超时计时器
            
            this.ws = new WebSocket(serverUrl);
            
            this.ws.onopen = () => {
                if (resolved) return;
                
                console.log('✅ WebSocket连接已建立，正在进行ticket认证...');
                this.setupMessageHandler();
                
                // 发送认证票据作为第一条消息
                if (ticket && ticket.trim()) {
                    const authMessage = { 
                        type: "auth", 
                        ticket: ticket.trim() 
                    };
                    
                    try {
                        this.ws.send(JSON.stringify(authMessage));
                        console.log('🎫 已发送认证票据');
                        
                        // 设置认证超时（5秒）
                        authTimeout = setTimeout(() => {
                            if (!resolved) {
                                resolved = true;
                                console.error('❌ 认证超时');
                                this.ws.close();
                                reject(new Error('WebSocket认证超时'));
                            }
                        }, 5000);
                        
                    } catch (error) {
                        if (!resolved) {
                            resolved = true;
                            console.error('❌ 发送认证票据失败:', error);
                            this.ws.close();
                            reject(error);
                        }
                    }
                } else {
                    resolved = true;
                    console.error('❌ 未提供有效的WebSocket票据');
                    this.ws.close();
                    reject(new Error('未提供有效的WebSocket票据'));
                }
            };
            
            this.ws.onerror = (error) => {
                if (resolved) return;
                resolved = true;
                
                console.error('❌ WebSocket连接错误:', error);
                if (authTimeout) clearTimeout(authTimeout);
                this.eventEmitter.emit('error', error);
                reject(error);
            };
            
            this.ws.onclose = (event) => {
                console.log(`🔌 WebSocket连接已关闭: ${event.code} - ${event.reason}`);
                this.isConnected = false;
                this.isStreaming = false;
                this.ws = null;
                if (authTimeout) clearTimeout(authTimeout);
                this.eventEmitter.emit('disconnected', { code: event.code, reason: event.reason });
                
                // 如果 Promise 还没有被解决，说明连接失败了
                if (!resolved) {
                    resolved = true;
                    reject(new Error(`WebSocket连接被关闭: ${event.code} - ${event.reason}`));
                }
            };
            
            // 存储认证成功的回调，供消息处理器调用
            this._authResolve = (success) => {
                if (!resolved) {
                    resolved = true;
                    if (authTimeout) clearTimeout(authTimeout);
                    
                    if (success) {
                        console.log('✅ WebSocket认证成功');
                        this.isConnected = true;
                        this.eventEmitter.emit('connected', { serverUrl });
                        resolve(true);
                    } else {
                        console.error('❌ WebSocket认证失败');
                        this.ws.close();
                        reject(new Error('WebSocket认证失败'));
                    }
                }
            };
        });
    }

    // 设置消息处理器
    setupMessageHandler() {
        this.ws.onmessage = (event) => {
            this.messageCounter++;
            this.stats.receivedMessages++;
            
            try {
                const data = JSON.parse(event.data);
                this.handleServerMessage(data);
            } catch (error) {
                console.error('WebSocket消息解析失败:', error);
                console.log('原始消息:', event.data);
            }
        };
    }

    // 处理服务器消息
    handleServerMessage(data) {
        const messageType = data.type;
        
        switch (messageType) {
            case 'auth_ack':
                console.log(`<-- RECV AUTH_ACK: ${data.success ? '成功' : '失败'}`);
                if (this._authResolve) {
                    this._authResolve(data.success === true);
                    this._authResolve = null;
                }
                break;
                
            case 'auth_success':
                console.log(`<-- RECV AUTH_SUCCESS: 用户 ${data.userId}`);
                if (this._authResolve) {
                    this._authResolve(true); // auth_success 表示认证成功
                    this._authResolve = null;
                }
                break;
                
            case 'audio_stream_start_ack':
                console.log(`<-- RECV START_ACK: ${data.timestamp}`);
                break;
                
            case 'audio_stream_end_ack':
                console.log(`<-- RECV END_ACK: ${data.timestamp}`);
                // 如果正在等待结束确认，触发回调
                if (this._waitingForEndAck && this._endAckCallback) {
                    this._endAckCallback();
                }
                break;
                
            case 'vad_cache_start':
                console.log(`<-- RECV VAD_CACHE_START`);
                break;
                
            case 'vad_cache_end':
                this.stats.vadEndTimestamps.push(Date.now());
                console.log(`<-- RECV VAD_CACHE_END: ${data.timestamp}`);
                // 触发 VAD end 事件，让页面处理 prefetch 转换
                window.dispatchEvent(new CustomEvent('vadEnd', { detail: { timestamp: data.timestamp } }));
                break;
                
            case 'transcription_result':
                this.handleTranscriptionResult(data);
                break;
                
            case 'debug_audio':
                this.handleDebugAudio(data);
                break;
                
            case 'performance_metrics':
                this.handlePerformanceMetrics(data);
                break;
                
            default:
                if (data.error) {
                    console.error(`<-- RECV ERROR: ${data.error}`);
                    if (data.unknownType) console.error(`    未知消息类型: ${data.unknownType}`);
                    if (data.parseError) console.error(`    解析错误: ${data.parseError}`);
                } else {
                    console.log(`<-- RECV UNKNOWN:`, data);
                }
        }
    }

    // 处理转录结果
    handleTranscriptionResult(data) {
        const isPrefetch = data.is_prefetch === true;
        
        // 构建日志标识
        let typeIndicator = '';
        if (isPrefetch) {
            typeIndicator = ' [PREFETCH]';
        } else {
            typeIndicator = ' [REPROCESSED]';
        }
        
        console.log(`<-- RECV TRANSCRIPTION ${typeIndicator}: "${data.text}"`);
        
        if (data.performance) {
            const perf = data.performance;
            const provider = perf.provider?.toUpperCase() || 'unknown';
            console.log(`    处理时间: 总计=${perf.total_processing_ms}ms (WAV=${perf.wav_creation_ms}ms, ${provider}=${perf.api_fetch_ms}ms)`);
        }
        
        // 触发ASR结果事件（序号管理交给前端处理）
        const now = new Date();
        const timeString = now.toLocaleTimeString('zh-CN', { 
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }) + '.' + now.getMilliseconds().toString().padStart(3, '0');
        
        const asrData = {
            text: data.text || '',
            performance: data.performance,
            timestamp: timeString,
            isPrefetch: isPrefetch
        };
        
        // 使用自定义事件通知页面
        window.dispatchEvent(new CustomEvent('asrResult', { detail: asrData }));
    }

    // 处理调试音频
    handleDebugAudio(data) {
        this.stats.debugAudioCounter++;
        console.log(`<-- RECV DEBUG_AUDIO: ${data.speechStartTimeMs}ms - ${data.speechEndTimeMs}ms`);
        
        // 下载调试音频
        if (data.audioData) {
            this.downloadDebugAudio(data.audioData, `debug_audio_${this.stats.debugAudioCounter}.wav`);
        }
    }

    // 下载调试音频
    downloadDebugAudio(base64Data, filename) {
        try {
            const audioData = atob(base64Data);
            const bytes = new Uint8Array(audioData.length);
            for (let i = 0; i < audioData.length; i++) {
                bytes[i] = audioData.charCodeAt(i);
            }
            
            const blob = new Blob([bytes], { type: 'audio/wav' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            console.log(`💾 调试音频已下载: ${filename}`);
        } catch (error) {
            console.error('❌ 下载调试音频失败:', error);
        }
    }

    // 处理性能指标
    handlePerformanceMetrics(data) {
        const metrics = data.metrics || {};
        const times = [];
        
        if (metrics.base64_decode) {
            times.push(`B64=${metrics.base64_decode.total_ms?.toFixed(1)}ms`);
        }
        if (metrics.sliding_window) {
            times.push(`Cache=${metrics.sliding_window.total_ms?.toFixed(1)}ms`);
        }
        if (metrics.vad_start) {
            times.push(`VAD_Start=${metrics.vad_start.total_ms?.toFixed(1)}ms`);
        }
        if (metrics.vad_end) {
            times.push(`VAD_End=${metrics.vad_end.total_ms?.toFixed(1)}ms`);
        }
        
        if (times.length > 0) {
            const vadInfo = data.vad_state ? `VAD=${data.vad_state}` : '';
            console.log(`<-- PERF #${data.chunk_counter}: ${times.join(', ')} ${vadInfo}`);
        }
    }

    // 发送消息
    async sendMessage(message) {
        if (!this.isConnected || !this.ws) {
            console.warn('WebSocket未连接，无法发送消息:', message);
            return false;
        }
        
        try {
            const jsonMessage = JSON.stringify(message);
            this.ws.send(jsonMessage);
            console.log(`--> SENT: ${message.type}`);
            return true;
        } catch (error) {
            console.error('❌ 发送消息失败:', error);
            return false;
        }
    }

    // 开始音频流
    async startAudioStream() {
        if (!this.isConnected) {
            console.warn('WebSocket未连接，无法开始音频流');
            return false;
        }
        
        const startMessage = { type: "audio_stream_start" };
        const success = await this.sendMessage(startMessage);
        
        if (success) {
            this.isStreaming = true;
            this.resetStats();
            console.log('🎙️ WebSocket音频流已开始');
        }
        
        return success;
    }

    // 发送音频块
    async sendAudioChunk(audioData, vadEvent = null, vadOffsetMs = null, asrPrompt = null) {
        if (!this.isConnected || !this.isStreaming) {
            return false;
        }
        
        try {
            // 将Int16Array转换为base64
            const audioBuffer = new Uint8Array(audioData.buffer);
            const base64Data = this.arrayBufferToBase64(audioBuffer.buffer);
            
            const chunkMessage = {
                type: "audio_chunk",
                data: base64Data
            };
            
            // 添加ASR prompt信息
            if (asrPrompt && asrPrompt.trim()) {
                chunkMessage.asr_prompt = asrPrompt.trim();
            }
            
            // 添加VAD状态信息
            if (vadEvent && vadEvent !== 'none') {
                if (vadEvent === 'start') {
                    chunkMessage.vad_state = 'start';
                } else if (vadEvent === 'end') {
                    chunkMessage.vad_state = 'end';
                } else if (vadEvent === 'cache_asr_trigger') {
                    chunkMessage.vad_state = 'cache_asr_trigger';
                } else if (vadEvent === 'cache_asr_drop') {
                    chunkMessage.vad_state = 'cache_asr_drop';
                }
                
                if (vadOffsetMs !== null && vadOffsetMs !== undefined) {
                    chunkMessage.vad_offset_ms = vadOffsetMs;
                }
            }
            
            const success = await this.sendMessage(chunkMessage);
            if (success) {
                this.stats.sentChunks++;
            }
            
            return success;
        } catch (error) {
            console.error('❌ 发送音频块失败:', error);
            return false;
        }
    }

    // 结束音频流
    async endAudioStream() {
        if (!this.isStreaming) {
            return false;
        }
        
        return new Promise((resolve) => {
            // 设置一个标记，等待 audio_stream_end_ack 响应
            this._waitingForEndAck = true;
            this._endAckCallback = () => {
                this.isStreaming = false;
                this._waitingForEndAck = false;
                this._endAckCallback = null;
                console.log('🎙️ WebSocket音频流已结束 (已收到确认)');
                
                // 收到确认后，关闭WebSocket连接
                setTimeout(() => {
                    this.disconnect();
                    console.log('🎙️ WebSocket连接已关闭 (确认后自动关闭)');
                }, 50); // 给一点时间确保消息处理完成
                
                resolve(true);
            };
            
            // 设置超时，防止永远等待
            const timeout = setTimeout(() => {
                if (this._waitingForEndAck) {
                    console.log('⚠️ 等待音频流结束确认超时');
                    this.isStreaming = false;
                    this._waitingForEndAck = false;
                    this._endAckCallback = null;
                    
                    // 超时后也关闭连接
                    this.disconnect();
                    console.log('🎙️ WebSocket连接已关闭 (超时后关闭)');
                    
                    resolve(true);
                }
            }, 2000); // 2秒超时
            
            const endMessage = { type: "audio_stream_end" };
            this.sendMessage(endMessage).then((success) => {
                if (!success) {
                    clearTimeout(timeout);
                    this._waitingForEndAck = false;
                    this._endAckCallback = null;
                    
                    // 发送失败也关闭连接
                    this.disconnect();
                    console.log('🎙️ WebSocket连接已关闭 (发送失败后关闭)');
                    
                    resolve(false);
                }
            });
        });
    }

    // 断开连接
    disconnect() {
        if (this.ws) {
            this.isStreaming = false;
            this.ws.close(1000, '用户主动断开');
            this.ws = null;
            this.isConnected = false;
        }
    }

    // 重置统计数据
    resetStats() {
        this.stats = {
            debugAudioCounter: 0,
            vadEndTimestamps: [],
            sentChunks: 0,
            receivedMessages: 0
        };
    }

    // ArrayBuffer转base64
    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    // 获取状态
    getStatus() {
        return {
            isConnected: this.isConnected,
            isStreaming: this.isStreaming,
            serverUrl: this.serverUrl,
            stats: { ...this.stats }
        };
    }
}

// 音频流处理器类
class AudioStreamProcessor {
    constructor() {
        this.config = {
            sampleRate: 16000,
            channels: 1,
            chunkDurationMs: 128,
            get chunkSamples() { return Math.floor(this.sampleRate * this.chunkDurationMs / 1000); }
        };
        
        this.audioContext = null;
        this.mediaStream = null;
        this.sourceNode = null;
        this.processorNode = null;
        this.isRecording = false;
        
        this.ringBuffer = new RingBuffer(this.config.chunkSamples * 10);
        this.eventEmitter = new MiniEventEmitter();
        this.chunkCounter = 0;
        
        // 集成WebSocket管理器
        this.wsManager = new WebSocketManager();
    }
    
    async init() {
        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: { 
                    sampleRate: this.config.sampleRate, 
                    channelCount: this.config.channels, 
                    echoCancellation: false, 
                    noiseSuppression: false, 
                    autoGainControl: false 
                }
            });
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: this.config.sampleRate });
            return true;
        } catch (error) {
            console.error('❌ 音频流初始化失败:', error);
            throw error;
        }
    }
    
    async startRecording() {
        if (this.isRecording) {
            console.warn('无法开始录音: 已在录音中');
            return false;
        }
        
        // 如果未初始化，先进行初始化
        if (!this.audioContext || !this.mediaStream) {
            try {
                await this.init();
            } catch (error) {
                console.error('录音初始化失败:', error);
                return false;
            }
        }
        
        this.ringBuffer.reset();
        this.chunkCounter = 0;
        
        // 如果WebSocket已连接，开始音频流
        if (this.wsManager.isConnected) {
            await this.wsManager.startAudioStream();
        }
        
        this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
        this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
        
        this.processorNode.onaudioprocess = (event) => {
            if (!this.isRecording) return;
            
            const inputData = event.inputBuffer.getChannelData(0);
            const tempBuffer = new Int16Array(inputData.length);
            
            for (let i = 0; i < inputData.length; i++) {
                tempBuffer[i] = Math.max(-32768, Math.min(32767, Math.round(inputData[i] * 32767)));
            }
            this.ringBuffer.write(tempBuffer);
            this.processAudio();
        };
        
        this.sourceNode.connect(this.processorNode);
        this.processorNode.connect(this.audioContext.destination);
        
        this.isRecording = true;
        return true;
    }
    
    async stopRecording() {
        if (!this.isRecording) return;
        
        this.isRecording = false;
        
        if (this.sourceNode) {
            this.sourceNode.disconnect();
            this.sourceNode = null;
        }
        
        if (this.processorNode) {
            this.processorNode.disconnect();
            this.processorNode = null;
        }
        
        this.processAudio(true);
        
        // 如果WebSocket正在流式传输，结束音频流
        if (this.wsManager.isStreaming) {
            await this.wsManager.endAudioStream();
        }
    }
    
    processAudio(isLastChunk = false) {
        if (isLastChunk) {
            const remaining = this.ringBuffer.available();
            if (remaining > 0) {
                const chunkArray = new Int16Array(this.config.chunkSamples);
                this.ringBuffer.read(chunkArray, remaining);
                chunkArray.fill(0, remaining);
                this.chunkVAD(chunkArray, this.chunkCounter * this.config.chunkDurationMs, true);
                this.ringBuffer.reset();
            }
        } else {
            while (this.ringBuffer.available() >= this.config.chunkSamples) {
                const chunkArray = new Int16Array(this.config.chunkSamples);
                this.ringBuffer.read(chunkArray, this.config.chunkSamples);
                this.chunkVAD(chunkArray, this.chunkCounter * this.config.chunkDurationMs);
                this.chunkCounter++;
            }
        }
    }
    
    emitEvent(chunkTimeMs, event, eventTimeMs = 0) {
        const now = new Date();
        const timeString = now.toLocaleTimeString('zh-CN', { 
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }) + '.' + now.getMilliseconds().toString().padStart(3, '0');
        
        const eventInfo = {
            chunkTimeMs,
            offsetMs: eventTimeMs,
            absoluteTimeMs: Math.max(0, chunkTimeMs + eventTimeMs),
            event,
            timestamp: timeString
        };
        
        if (window.vadEvents) window.vadEvents.push(eventInfo);
        window.dispatchEvent(new CustomEvent('vadEvent', { detail: eventInfo }));
    }
    
    chunkVAD(chunkArray, chunkTimeMs, isLastChunk = false) {
        if (!window.globalStreamingVAD?.isInitialized) return;
        
        try {
            const result = window.globalStreamingVAD.processAudio(chunkArray);
            
            // 发送音频数据到WebSocket服务器
            if (this.wsManager.isStreaming) {
                let vadEvent = null;
                let vadOffsetMs = null;
                let asrPrompt = null;
                
                // 如果有VAD事件，设置相应的参数
                if (result.event !== window.VADEvent.NONE) {
                    vadEvent = result.event; // 'start', 'end', 'cache_asr_trigger', 'cache_asr_drop'
                    vadOffsetMs = result.eventTimeMs;
                    console.log(`📤 发送VAD事件: ${vadEvent}, offset: ${vadOffsetMs}ms`);
                    
                    // 在VAD trigger和end时处理ASR prompt
                    if (vadEvent === 'cache_asr_trigger' || vadEvent === 'end') {
                        const asrPromptTemplate = document.getElementById('asrPrompt').value;
                        if (asrPromptTemplate && asrPromptTemplate.trim()) {
                            asrPrompt = window.processASRPrompt(asrPromptTemplate.trim());
                            console.log(`📤 发送ASR Prompt: "${asrPrompt}"`);
                        }
                    }
                }
                
                // 总是发送音频块（与test.py行为一致）
                this.wsManager.sendAudioChunk(chunkArray, vadEvent, vadOffsetMs, asrPrompt);
            }
            
            // 触发页面VAD事件显示
            if (result.event !== window.VADEvent.NONE) {
                this.emitEvent(chunkTimeMs, result.event, result.eventTimeMs);
            }
            
            if (isLastChunk && window.globalStreamingVAD.isSpeaking()) {
                // 如果录音结束时VAD仍在speaking状态，发送手动结束事件
                if (this.wsManager.isStreaming) {
                    const endChunk = {
                        type: "audio_chunk",
                        data: "",
                        vad_state: "end"
                    };
                    this.wsManager.sendMessage(endChunk);
                    console.log('📤 发送手动VAD结束事件');
                }
                
                this.emitEvent(chunkTimeMs + this.config.chunkDurationMs, '录音强制结束');
                window.updateEventsDisplay?.();
            }
        } catch (error) {
            console.error(`Time ${chunkTimeMs}ms VAD处理错误:`, error);
        }
    }
    
    // WebSocket相关方法
    async connectWebSocket(serverUrl, ticket) {
        return await this.wsManager.connect(serverUrl, ticket);
    }
    
    disconnectWebSocket() {
        this.wsManager.disconnect();
    }
    
    isWebSocketConnected() {
        return this.wsManager.isConnected;
    }
    
    isWebSocketStreaming() {
        return this.wsManager.isStreaming;
    }
    
    getWebSocketStatus() {
        return this.wsManager.getStatus();
    }

    async cleanup() {
        await this.stopRecording();
        
        // 断开WebSocket连接
        this.wsManager.disconnect();
        
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }
        
        if (this.audioContext) {
            await this.audioContext.close();
            this.audioContext = null;
        }
        
        this.ringBuffer.reset();
        this.chunkCounter = 0;
    }

    getStatus() {
        return {
            isRecording: this.isRecording,
            isInitialized: !!(this.audioContext && this.mediaStream),
            chunkCounter: this.chunkCounter,
            bufferLength: this.ringBuffer.available(),
            bufferCapacity: this.ringBuffer.size,
            sampleRate: this.audioContext ? this.audioContext.sampleRate : null,
            config: this.config,
            websocket: this.getWebSocketStatus()
        };
    }

}

const audioProcessor = new AudioStreamProcessor();

Object.assign(window, {
    initAudioStream: () => audioProcessor.init(),
    startRecording: () => audioProcessor.startRecording(),
    stopRecording: () => audioProcessor.stopRecording(),
    getAudioStreamStatus: () => audioProcessor.getStatus(),
    
    // WebSocket相关全局接口
    connectWebSocket: (serverUrl, ticket) => audioProcessor.connectWebSocket(serverUrl, ticket),
    disconnectWebSocket: () => audioProcessor.disconnectWebSocket(),
    isWebSocketConnected: () => audioProcessor.isWebSocketConnected(),
    
    audioProcessor
});