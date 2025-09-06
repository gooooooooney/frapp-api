// Shared audio processing and WebSocket utilities
import { optimizedBase64Decode, RingBuffer, createOptimizedWavBlob } from './wav_utils';
import { validateAndConsumeTicket } from '../store/kv';
import { OptimizedAudioStorage, createAudioSession, AudioChunk } from './audio-storage';

// WebSocket message types
export interface AudioStreamStartMessage {
  type: 'audio_stream_start';
}

export interface AudioChunkMessage {
  type: 'audio_chunk';
  data: string;
  vad_state?: 'start' | 'end' | 'cache_asr_trigger' | 'cache_asr_drop';
  vad_offset_ms?: number;
  asr_prompt?: string;
}

export interface AudioStreamEndMessage {
  type: 'audio_stream_end';
}

export type WebSocketMessage = AudioStreamStartMessage | AudioChunkMessage | AudioStreamEndMessage;

// Response message types
export interface TranscriptionResult {
  type: 'transcription_result';
  text: string;
  speechStartTimeMs: number;
  speechEndTimeMs: number;
  timestamp: string;
  is_prefetch?: boolean;
  performance: {
    total_processing_ms: number;
    wav_creation_ms: number;
    api_fetch_ms: number;
    worker_timestamp: string;
    provider: string;
  };
}

export interface TranscriptionError {
  type: 'transcription_error';
  error: string;
  details?: any;
  timestamp: string;
}

// Audio configuration constants
export const CHUNK_DURATION_MS = 128;
export const BYTES_PER_MS = 32; // 16kHz, 16bit, mono = 32000 bytes/sec = 32 bytes/ms

// Global variables for environment
let envVariables: {
  GROQ_API_KEY: string;
  FIREWORKS_API_KEY: string;
  OPENROUTER_API_KEY: string;
  GEMINI_API_KEY: string;
  USE_FIREWORKS: boolean;
  DEBUG_MODE: boolean;
} | null = null;

export function initializeAudioEnv(env: Env): void {
  envVariables = {
    GROQ_API_KEY: env.GROQ_API_KEY,
    FIREWORKS_API_KEY: env.FIREWORKS_API_KEY,
    OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    USE_FIREWORKS: env.USE_FIREWORKS === 'true',
    DEBUG_MODE: env.DEBUG_MODE === 'true',
  };
}

export function getAudioEnv() {
  if (!envVariables) {
    throw new Error('Audio environment not initialized');
  }
  return envVariables;
}

// User context interface for authenticated sessions
export interface AudioSessionContext {
  userId?: string;
  [key: string]: any;
}

// WebSocket session handler
export async function handleAudioSession(websocket: WebSocket, context?: AudioSessionContext): Promise<void> {
  websocket.accept();
  
  const env = getAudioEnv();
  const userId = context?.userId || 'anonymous';
  
  let audioChunkCounter = 0;
  let globalTimeMs = 0;
  let isCaching = false;
  let speechAudioCache: Uint8Array[] = [];
  let previousChunkBuffer = new RingBuffer(256 * BYTES_PER_MS); // 256ms环形缓冲区
  let speechStartTimeMs = 0; // 记录语音开始的真实时间
  
  // 预构建静态消息模板，避免重复JSON.stringify
  const MESSAGE_TEMPLATES = {
    vad_cache_start: '{"type":"vad_cache_start"}',
    vad_cache_end_prefix: '{"type":"vad_cache_end","timestamp":"',
    stream_start_ack_prefix: '{"type":"audio_stream_start_ack","timestamp":"',
    stream_end_ack_prefix: '{"type":"audio_stream_end_ack","receivedChunks":',
  };

  websocket.addEventListener("message", async (event: MessageEvent) => {
    const data = event.data as string;
    {
      // Try to parse as JSON for our custom messages
      try {
        const parsedMessage: WebSocketMessage = JSON.parse(data);
        
        // Handle different message types
        switch (parsedMessage.type) {
          case 'audio_stream_start':
            audioChunkCounter = 0;
            globalTimeMs = 0;
            isCaching = false;
            speechAudioCache = [];
            previousChunkBuffer.clear();
            speechStartTimeMs = 0;
            const startTimestamp = new Date().toISOString();
            console.log(`Audio stream started for user: ${userId}`);
            websocket.send(MESSAGE_TEMPLATES.stream_start_ack_prefix + startTimestamp + '","userId":"' + userId + '"}');
            break;

          // --- 主要修改部分：实现 VAD 缓存逻辑 ---
          case 'audio_chunk':
            const { vad_state, vad_offset_ms } = parsedMessage; 
            audioChunkCounter++;
            
            // 优化的音频数据解码
            let currentChunk: Uint8Array | null = null;
            if (parsedMessage.data && parsedMessage.data.length > 0) {
                currentChunk = optimizedBase64Decode(parsedMessage.data);
            }
            
            // 1. 处理 VAD 'start' 信号
            if (vad_state === 'start') {
                isCaching = true;
                speechAudioCache = [];
                
                // 记录语音开始的真实时间（考虑offset）
                speechStartTimeMs = globalTimeMs + (vad_offset_ms || 0);
                
                // 从环形缓冲区获取前缀数据
                if (vad_offset_ms && vad_offset_ms < 0) {
                    const bufferData = previousChunkBuffer.getData();
                    if (bufferData.length > 0) {
                        const offsetBytes = Math.abs(vad_offset_ms) * BYTES_PER_MS;
                        const startByte = Math.max(0, bufferData.length - offsetBytes);
                        const prefixChunk = bufferData.slice(startByte);
                        speechAudioCache.push(prefixChunk);
                    }
                }
                
                websocket.send(MESSAGE_TEMPLATES.vad_cache_start);
            }

            // 2. 如果正在缓存且有数据，则将音频数据存入 cache（VAD end情况特殊处理）
            if (isCaching && currentChunk && vad_state !== 'end') {
                speechAudioCache.push(currentChunk);
            }
            
            // 使用环形缓冲区维护256ms滑动窗口
            if (currentChunk) {
                previousChunkBuffer.append(currentChunk);
            }
            globalTimeMs += CHUNK_DURATION_MS;
            
            // 3. 处理 VAD 'end' 信号
            if (vad_state === 'end' && isCaching) {
                // 计算语音结束的真实时间
                const speechEndTimeMs = globalTimeMs + (vad_offset_ms || 0);
                
                // 对于VAD end，需要截取当前chunk的前半部分（从开头到offset位置）
                if (currentChunk && vad_offset_ms && vad_offset_ms > 0) {
                    const endByte = Math.min(currentChunk.length, vad_offset_ms * BYTES_PER_MS);
                    const endChunk = currentChunk.slice(0, endByte);
                    speechAudioCache.push(endChunk);
                } else if (currentChunk) {
                    speechAudioCache.push(currentChunk);
                }
                
                isCaching = false;

                const cachedData = [...speechAudioCache];
                speechAudioCache = [];

                const vadEndTimestamp = new Date().toISOString();
                websocket.send(MESSAGE_TEMPLATES.vad_cache_end_prefix + vadEndTimestamp + '"}');
                
                // 调用ASR API，传递时间信息
                const asrFunction = env.USE_FIREWORKS ? processAudioWithFireworks : processAudioWithGroq;
                asrFunction(cachedData, websocket, speechStartTimeMs, speechEndTimeMs).catch(err => {
                    websocket.send(JSON.stringify({
                        type: 'transcription_error',
                        error: `Failed to process audio with ${env.USE_FIREWORKS ? 'Fireworks' : 'Groq'} API.`,
                        details: err.message,
                        timestamp: new Date().toISOString()
                    }));
                });
            }
            break;
          // --- 修改结束 ---

          case 'audio_stream_end':
            const endTimestamp = new Date().toISOString();
            websocket.send(MESSAGE_TEMPLATES.stream_end_ack_prefix + audioChunkCounter + ',"timestamp":"' + endTimestamp + '"}');
            break;
          default:
            // Unknown JSON message - send back a specific error message with the unknown message type
            const unknownMessage = parsedMessage as any;
            const unknownType = unknownMessage.type || 'undefined';
            const errorResponse = JSON.stringify({
              error: "Unknown message type received",
              unknownType: unknownType,
              receivedMessage: parsedMessage,
              timestamp: new Date().toISOString()
            });
            websocket.send(errorResponse);
        }
      } catch (parseError) {
        // Not JSON - send back a specific error message with parse details
        const err = parseError as Error;
        const errorResponse = JSON.stringify({
          error: "Failed to parse message as JSON",
          parseError: err.message,
          receivedData: typeof data === 'string' ? data.substring(0, 100) + (data.length > 100 ? '...' : '') : 'Non-string data',
          timestamp: new Date().toISOString()
        });
        websocket.send(errorResponse);
      }
    }
  })

  websocket.addEventListener("close", () => {
    websocket.close();
    console.log(`WebSocket connection closed for user: ${userId}`);
  })
}

export async function processAudioWithFireworks(audioDataChunks: Uint8Array[], websocket: WebSocket, speechStartTimeMs: number, speechEndTimeMs: number, isPrefetch: boolean = false): Promise<void> {
    const env = getAudioEnv();
    const startTime = Date.now();
    
    console.log(`🔥 Fireworks ASR called with ${audioDataChunks.length} chunks, speechTime: ${speechStartTimeMs}ms - ${speechEndTimeMs}ms`);
    
    if (!env.FIREWORKS_API_KEY) {
        console.error('❌ Fireworks ASR failed: FIREWORKS_API_KEY not set');
        throw new Error("FIREWORKS_API_KEY secret is not set in the worker environment.");
    }
    if (audioDataChunks.length === 0) {
        console.error('❌ Fireworks ASR aborted: empty audioDataChunks array');
        return;
    }

    // 1. 使用优化的WAV创建
    const wavStartTime = Date.now();
    const audioBlob = createOptimizedWavBlob(audioDataChunks);
    const wavEndTime = Date.now();
    
    // 发送音频数据回客户端供本地保存检查
    if (env.DEBUG_MODE) {
      const audioArrayBuffer = await audioBlob.arrayBuffer();
      const audioBase64 = btoa(String.fromCharCode(...new Uint8Array(audioArrayBuffer)));
      const debugTimestamp = new Date().toISOString();
      // 使用字符串拼接避免JSON.stringify
      websocket.send('{"type":"debug_audio","audioData":"' + audioBase64 + 
                     '","speechStartTimeMs":' + speechStartTimeMs + 
                     ',"speechEndTimeMs":' + speechEndTimeMs + 
                     ',"timestamp":"' + debugTimestamp + '"}');
    }

    // 2. 创建 FormData
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.wav');
    formData.append('model', 'whisper-v3-turbo');
    formData.append('temperature', '0');

    // 3. 发起 fetch 请求到 Fireworks API
    const apiStartTime = Date.now();
    const response = await fetch("https://audio-turbo.us-virginia-1.direct.fireworks.ai/v1/audio/transcriptions", {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${env.FIREWORKS_API_KEY}`,
        },
        body: formData,
    });

    // 4. 处理响应
    const result = await response.json() as any;
    const apiEndTime = Date.now();
    const totalEndTime = Date.now();

    if (!response.ok) {
        console.error("Fireworks API returned an error:", result);
        throw new Error(`Fireworks API error: ${response.status} ${response.statusText} - ${JSON.stringify(result)}`);
    }

    // 5. 健壮地检查并提取 text 字段
    if (result && result.text !== undefined) {
        const transcriptionResult: TranscriptionResult = {
            type: 'transcription_result',
            text: result.text,
            speechStartTimeMs: speechStartTimeMs,
            speechEndTimeMs: speechEndTimeMs,
            timestamp: new Date().toISOString(),
            is_prefetch: isPrefetch,
            performance: {
                total_processing_ms: totalEndTime - startTime,
                wav_creation_ms: wavEndTime - wavStartTime,
                api_fetch_ms: apiEndTime - apiStartTime,
                worker_timestamp: new Date().toISOString(),
                provider: 'fireworks'
            }
        };
        websocket.send(JSON.stringify(transcriptionResult));
    } else {
        const errorResult: TranscriptionError = {
            type: 'transcription_error',
            error: 'Invalid response format from Fireworks API.',
            details: result,
            timestamp: new Date().toISOString()
        };
        websocket.send(JSON.stringify(errorResult));
    }
}

export async function processAudioWithGroq(audioDataChunks: Uint8Array[], websocket: WebSocket, speechStartTimeMs: number, speechEndTimeMs: number, isPrefetch: boolean = false): Promise<void> {
    const env = getAudioEnv();
    const startTime = Date.now();
    
    console.log(`🤖 Groq ASR called with ${audioDataChunks.length} chunks, speechTime: ${speechStartTimeMs}ms - ${speechEndTimeMs}ms`);
    
    if (!env.GROQ_API_KEY) {
        console.error('❌ Groq ASR failed: GROQ_API_KEY not set');
        throw new Error("GROQ_API_KEY secret is not set in the worker environment.");
    }
    if (audioDataChunks.length === 0) {
        console.error('❌ Groq ASR aborted: empty audioDataChunks array');
        return;
    }

    // 1. 使用优化的WAV创建
    const wavStartTime = Date.now();
    const audioBlob = createOptimizedWavBlob(audioDataChunks);
    const wavEndTime = Date.now();
    
    // 发送音频数据回客户端供本地保存检查
    if (env.DEBUG_MODE) {
      const audioArrayBuffer = await audioBlob.arrayBuffer();
      const audioBase64 = btoa(String.fromCharCode(...new Uint8Array(audioArrayBuffer)));
      const debugTimestamp = new Date().toISOString();
      // 使用字符串拼接避免JSON.stringify
      websocket.send('{"type":"debug_audio","audioData":"' + audioBase64 + 
                     '","speechStartTimeMs":' + speechStartTimeMs + 
                     ',"speechEndTimeMs":' + speechEndTimeMs + 
                     ',"timestamp":"' + debugTimestamp + '"}');
    }

    // 2. 创建 FormData
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.wav');
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('response_format', 'verbose_json'); 

    // 3. 发起 fetch 请求到 Groq API
    const groqStartTime = Date.now();
    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${env.GROQ_API_KEY}`,
        },
        body: formData,
    });

    // 4. 处理响应
    const result = await response.json() as any;
    const groqEndTime = Date.now();
    const totalEndTime = Date.now();

    if (!response.ok) {
        // 如果 HTTP 状态码不是 2xx，则抛出错误
        console.error("Groq API returned an error:", result);
        throw new Error(`Groq API error: ${response.status} ${response.statusText} - ${JSON.stringify(result)}`);
    }

    // 5. 健壮地检查并提取 text 字段
    if (result && result.text !== undefined) {
        const transcriptionResult: TranscriptionResult = {
            type: 'transcription_result',
            text: result.text,
            speechStartTimeMs: speechStartTimeMs,
            speechEndTimeMs: speechEndTimeMs,
            timestamp: new Date().toISOString(),
            is_prefetch: isPrefetch,
            performance: {
                total_processing_ms: totalEndTime - startTime,
                wav_creation_ms: wavEndTime - wavStartTime,
                api_fetch_ms: groqEndTime - groqStartTime,
                worker_timestamp: new Date().toISOString(),
                provider: 'groq'
            }
        };
        websocket.send(JSON.stringify(transcriptionResult));
    } else {
        // 失败：返回的 JSON 中没有 text 字段，当作错误处理
        const errorResult: TranscriptionError = {
            type: 'transcription_error',
            error: 'Invalid response format from Groq API.',
            details: result,
            timestamp: new Date().toISOString()
        };
        websocket.send(JSON.stringify(errorResult));
    }
}

// Authentication message types for first-message auth
export interface AuthMessage {
  type: 'auth';
  ticket: string;
}

export interface AuthSuccessMessage {
  type: 'auth_success';
  userId: string;
  timestamp: string;
}

export interface AuthErrorMessage {
  type: 'auth_error';
  error: string;
  timestamp: string;
}

// Enhanced WebSocket session handler with First Message Authentication
export async function handleSecureAudioSession(websocket: WebSocket, env: any): Promise<void> {
  console.log('🔐 Accepting WebSocket connection...');
  websocket.accept();
  console.log('✅ WebSocket accepted successfully');
  
  let isAuthenticated = false;
  let userId: string | null = null;
  let audioStorage: OptimizedAudioStorage | null = null;
  const connectionStart = Date.now();

  // Add error and close handlers for debugging
  websocket.addEventListener('error', (event) => {
    console.error('❌ WebSocket error in handleSecureAudioSession:', event);
  });
  
  websocket.addEventListener('close', (event) => {
    console.log('🔌 WebSocket closed in handleSecureAudioSession:', event.code, event.reason);
    if (audioStorage) {
      console.log('🧹 Cleaning up audio storage...');
      audioStorage.cleanup().catch(err => console.error('❌ Audio storage cleanup failed:', err));
    }
  });
  
  websocket.addEventListener('open', () => {
    console.log('✅ WebSocket opened in handleSecureAudioSession');
  });

  // Authentication timeout (5 seconds)
  const authTimeout = setTimeout(() => {
    if (!isAuthenticated) {
      console.log('❌ WebSocket connection timed out - no authentication within 5 seconds');
      websocket.send(JSON.stringify({
        type: 'auth_error',
        error: 'Authentication timeout - connection closed',
        timestamp: new Date().toISOString()
      }));
      websocket.close(1008, 'Authentication timeout');
    }
  }, 5000);

  let audioChunkCounter = 0;
  let globalTimeMs = 0;
  let isCaching = false;
  let speechAudioCache: Uint8Array[] = [];
  let previousChunkBuffer = new RingBuffer(256 * BYTES_PER_MS);
  let speechStartTimeMs = 0;
  
  const MESSAGE_TEMPLATES = {
    vad_cache_start: '{"type":"vad_cache_start"}',
    vad_cache_end_prefix: '{"type":"vad_cache_end","timestamp":"',
    stream_start_ack_prefix: '{"type":"audio_stream_start_ack","timestamp":"',
    stream_end_ack_prefix: '{"type":"audio_stream_end_ack","receivedChunks":',
  };

  websocket.addEventListener("message", async (event: MessageEvent) => {
    const data = event.data as string;
    
    try {
      const parsedMessage = JSON.parse(data);
      
      // Handle authentication first
      if (!isAuthenticated) {
        if (parsedMessage.type === 'auth') {
          const authMessage = parsedMessage as AuthMessage;
          
          if (!authMessage.ticket) {
            websocket.send(JSON.stringify({
              type: 'auth_error',
              error: 'Missing ticket in authentication message',
              timestamp: new Date().toISOString()
            }));
            websocket.close(1008, 'Invalid authentication');
            return;
          }

          // Validate ticket
          const validation = await validateAndConsumeTicket(authMessage.ticket, env.WS_TICKETS_KV);
          
          if (!validation) {
            websocket.send(JSON.stringify({
              type: 'auth_error',
              error: 'Invalid or expired ticket',
              timestamp: new Date().toISOString()
            }));
            websocket.close(1008, 'Authentication failed');
            return;
          }

          // Authentication successful
          isAuthenticated = true;
          userId = validation.userId;
          clearTimeout(authTimeout);
          
          // 初始化音频存储 (优化的内存缓存方案)
          try {
            audioStorage = createAudioSession(userId, env.FRAPP_FILES_STORE, {
              windowSizeMs: 2 * 60 * 1000,      // 2分钟窗口
              uploadIntervalMs: 60 * 1000,      // 1分钟上传
              maxMemoryMB: 10,                  // 10MB限制
              enableDebug: env.DEBUG_MODE === 'true',
              storeOriginalAudio: true,         // 存储完整原始音频流
              storeVadSegments: false           // 不单独存储VAD片段
            });
            console.log(`🎵 Audio storage initialized for user: ${userId}`);
          } catch (error) {
            console.error('❌ Failed to initialize audio storage:', error);
            // 非致命错误，继续运行但不存储音频
          }
          
          console.log(`WebSocket authenticated for user: ${userId} (took ${Date.now() - connectionStart}ms)`);
          
          websocket.send(JSON.stringify({
            type: 'auth_success',
            userId: userId,
            timestamp: new Date().toISOString()
          }));
          
          return;
        } else {
          // Not authenticated and not an auth message
          websocket.send(JSON.stringify({
            type: 'auth_error',
            error: 'Must authenticate first with auth message',
            timestamp: new Date().toISOString()
          }));
          websocket.close(1008, 'Authentication required');
          return;
        }
      }

      // Handle audio messages (only after authentication)
      await handleAudioMessage(parsedMessage, websocket, {
        audioChunkCounter,
        globalTimeMs,
        isCaching,
        speechAudioCache,
        previousChunkBuffer,
        speechStartTimeMs,
        MESSAGE_TEMPLATES,
        userId: userId!,
        audioStorage
      });

    } catch (parseError) {
      const err = parseError as Error;
      const errorResponse = JSON.stringify({
        error: "Failed to parse message as JSON",
        parseError: err.message,
        receivedData: typeof data === 'string' ? data.substring(0, 100) + (data.length > 100 ? '...' : '') : 'Non-string data',
        timestamp: new Date().toISOString()
      });
      websocket.send(errorResponse);
    }
  });

  websocket.addEventListener("close", async () => {
    clearTimeout(authTimeout);
    
    // 清理音频存储资源
    if (audioStorage) {
      try {
        await audioStorage.cleanup();
        console.log(`🧹 Audio storage cleaned up for user: ${userId}`);
      } catch (error) {
        console.error('❌ Error during audio storage cleanup:', error);
      }
    }
    
    const status = isAuthenticated ? `authenticated user: ${userId}` : 'unauthenticated connection';
    console.log(`WebSocket connection closed for ${status}`);
  });
}

// Extracted audio message handler for cleaner code
async function handleAudioMessage(
  parsedMessage: any,
  websocket: WebSocket,
  context: {
    audioChunkCounter: number;
    globalTimeMs: number;
    isCaching: boolean;
    speechAudioCache: Uint8Array[];
    previousChunkBuffer: RingBuffer;
    speechStartTimeMs: number;
    MESSAGE_TEMPLATES: any;
    userId: string;
    audioStorage: OptimizedAudioStorage | null;
  }
) {
  const env = getAudioEnv();

  switch (parsedMessage.type) {
    case 'audio_stream_start':
      context.audioChunkCounter = 0;
      context.globalTimeMs = 0;
      context.isCaching = false;
      context.speechAudioCache = [];
      context.previousChunkBuffer.clear();
      context.speechStartTimeMs = 0;
      const startTimestamp = new Date().toISOString();
      console.log(`Audio stream started for user: ${context.userId}`);
      websocket.send(context.MESSAGE_TEMPLATES.stream_start_ack_prefix + startTimestamp + '","userId":"' + context.userId + '"}');
      break;

    case 'audio_chunk':
      const { vad_state, vad_offset_ms } = parsedMessage;
      context.audioChunkCounter++;
      
      let currentChunk: Uint8Array | null = null;
      if (parsedMessage.data && parsedMessage.data.length > 0) {
        try {
          currentChunk = optimizedBase64Decode(parsedMessage.data);
          console.log(`🎵 Decoded audio chunk: ${parsedMessage.data.length} base64 chars -> ${currentChunk?.length || 0} bytes (VAD: ${vad_state || 'none'})`);
        } catch (decodeError) {
          console.error('❌ Base64 decode failed:', decodeError);
          currentChunk = null;
        }
        
        // 原始完整音频存储处理 (异步，不阻塞实时转录)
        // 存储所有音频块，不依赖VAD状态，保持完整音频流连续性
        if (currentChunk && context.audioStorage) {
          const audioChunk: AudioChunk = {
            timestamp: context.globalTimeMs,
            data: currentChunk,
            vadState: vad_state,
            vadOffset: vad_offset_ms
          };
          
          // 异步处理，不等待完成
          context.audioStorage.processAudioChunk(audioChunk).catch(err => {
            console.error('❌ Original audio storage processing error:', err);
          });
        }
      } else {
        console.log(`🎵 No audio data in message (data length: ${parsedMessage.data?.length || 0})`);
      }
      
      if (vad_state === 'start') {
        console.log(`🎵 VAD START event received - globalTimeMs: ${context.globalTimeMs}, vad_offset_ms: ${vad_offset_ms}`);
        
        context.isCaching = true;
        context.speechAudioCache = [];
        context.speechStartTimeMs = context.globalTimeMs + (vad_offset_ms || 0);
        
        // 处理负偏移（需要从ring buffer获取前缀数据）
        if (vad_offset_ms && vad_offset_ms < 0) {
          const bufferData = context.previousChunkBuffer.getData();
          console.log(`🎵 VAD START negative offset: ${vad_offset_ms}ms, ringBufferSize: ${bufferData.length} bytes`);
          
          if (bufferData.length > 0) {
            const offsetBytes = Math.abs(vad_offset_ms) * BYTES_PER_MS;
            const startByte = Math.max(0, bufferData.length - offsetBytes);
            const prefixChunk = bufferData.slice(startByte);
            context.speechAudioCache.push(prefixChunk);
            console.log(`🎵 Added prefix chunk: ${prefixChunk.length} bytes (startByte: ${startByte})`);
          }
        }
        
        console.log(`🎵 VAD START complete - speechStartTimeMs: ${context.speechStartTimeMs}, cacheLength: ${context.speechAudioCache.length}`);
        websocket.send(context.MESSAGE_TEMPLATES.vad_cache_start);
      }

      // 缓存中间音频块（VAD start到end之间）
      if (context.isCaching && currentChunk && vad_state !== 'end') {
        context.speechAudioCache.push(currentChunk);
        console.log(`🎵 Cached audio chunk: ${currentChunk.length} bytes (total cache: ${context.speechAudioCache.length} chunks)`);
      } else if (context.isCaching && !currentChunk && vad_state !== 'end') {
        console.log(`🎵 Skipping cache - no currentChunk (isCaching: ${context.isCaching}, vad_state: ${vad_state})`);
      } else if (!context.isCaching && vad_state !== 'end' && vad_state !== 'start') {
        console.log(`🎵 Skipping cache - not caching (isCaching: ${context.isCaching}, vad_state: ${vad_state})`);
      }
      
      if (currentChunk) {
        context.previousChunkBuffer.append(currentChunk);
      }
      context.globalTimeMs += CHUNK_DURATION_MS;
      
      // 处理 cache_asr_trigger 事件（prefetch模式）
      if (vad_state === 'cache_asr_trigger' && context.isCaching) {
        console.log(`🎵 VAD CACHE_ASR_TRIGGER event received - speechCacheLength: ${context.speechAudioCache.length}, currentChunkSize: ${currentChunk?.length || 0}`);
        
        const speechEndTimeMs = context.globalTimeMs + (vad_offset_ms || 0);
        
        // 创建当前缓存的副本进行prefetch ASR处理
        const cachedDataForPrefetch = [...context.speechAudioCache];
        
        // 添加当前chunk的trigger部分
        if (currentChunk && vad_offset_ms && vad_offset_ms > 0) {
          const endByte = Math.min(currentChunk.length, vad_offset_ms * BYTES_PER_MS);
          const triggerChunk = currentChunk.slice(0, endByte);
          cachedDataForPrefetch.push(triggerChunk);
          console.log(`🎵 Added trigger chunk for prefetch: ${triggerChunk.length} bytes (offset: ${vad_offset_ms}ms)`);
        } else if (currentChunk) {
          cachedDataForPrefetch.push(currentChunk);
          console.log(`🎵 Added full current chunk for prefetch: ${currentChunk.length} bytes`);
        }
        
        // 统计prefetch数据
        const totalBytes = cachedDataForPrefetch.reduce((sum, chunk) => sum + chunk.length, 0);
        const totalDurationMs = Math.round(totalBytes / BYTES_PER_MS);
        console.log(`🎵 Prefetch cache: ${cachedDataForPrefetch.length} chunks, ${totalBytes} bytes, ~${totalDurationMs}ms duration`);
        
        // 发送prefetch ASR请求（标记为预取）
        if (cachedDataForPrefetch.length > 0) {
          const asrProvider = env.USE_FIREWORKS ? 'Fireworks' : 'Groq';
          console.log(`🎵 Starting PREFETCH ASR with ${asrProvider} (${cachedDataForPrefetch.length} chunks)`);
          
          // 使用现有的ASR函数，传递prefetch标记
          const asrFunction = env.USE_FIREWORKS ? processAudioWithFireworks : processAudioWithGroq;
          
          asrFunction(cachedDataForPrefetch, websocket, context.speechStartTimeMs, speechEndTimeMs, true).catch(err => {
            console.error(`❌ Prefetch ASR processing failed:`, err);
            websocket.send(JSON.stringify({
              type: 'transcription_error',
              error: `Failed to process prefetch audio with ${asrProvider} API.`,
              details: err.message,
              is_prefetch: true,
              timestamp: new Date().toISOString()
            }));
          });
        } else {
          console.log(`⚠️ No data for prefetch ASR - cachedDataForPrefetch is empty`);
        }
        
        // 继续缓存，不清空speechAudioCache（与VAD end不同）
      }
      
      // 详细调试VAD end事件处理
      if (vad_state === 'end') {
        console.log(`🎵 VAD END event received - isCaching: ${context.isCaching}, speechCacheLength: ${context.speechAudioCache.length}, currentChunkSize: ${currentChunk?.length || 0}`);
        
        if (context.isCaching) {
          const speechEndTimeMs = context.globalTimeMs + (vad_offset_ms || 0);
          
          // 处理当前chunk的end部分
          let endChunkAdded = false;
          if (currentChunk && vad_offset_ms && vad_offset_ms > 0) {
            const endByte = Math.min(currentChunk.length, vad_offset_ms * BYTES_PER_MS);
            const endChunk = currentChunk.slice(0, endByte);
            context.speechAudioCache.push(endChunk);
            endChunkAdded = true;
            console.log(`🎵 Added VAD end chunk: ${endChunk.length} bytes (offset: ${vad_offset_ms}ms, endByte: ${endByte})`);
          } else if (currentChunk) {
            context.speechAudioCache.push(currentChunk);
            endChunkAdded = true;
            console.log(`🎵 Added full current chunk: ${currentChunk.length} bytes (no offset)`);
          } else {
            console.log(`🎵 No current chunk to add (currentChunk: ${currentChunk}, vad_offset_ms: ${vad_offset_ms})`);
          }
          
          context.isCaching = false;
          const cachedData = [...context.speechAudioCache];
          context.speechAudioCache = [];
          
          // 详细统计缓存数据
          const totalBytes = cachedData.reduce((sum, chunk) => sum + chunk.length, 0);
          const totalDurationMs = Math.round(totalBytes / BYTES_PER_MS);
          console.log(`🎵 Speech audio cache: ${cachedData.length} chunks, ${totalBytes} bytes, ~${totalDurationMs}ms duration`);
          
          const vadEndTimestamp = new Date().toISOString();
          websocket.send(context.MESSAGE_TEMPLATES.vad_cache_end_prefix + vadEndTimestamp + '"}');
          
          // 检查是否有数据进行ASR
          if (cachedData.length === 0) {
            console.error(`❌ No audio data cached for ASR! isCaching was true but cache is empty.`);
            websocket.send(JSON.stringify({
              type: 'transcription_error',
              error: 'No audio data cached for transcription',
              details: 'speechAudioCache was empty despite isCaching being true',
              timestamp: new Date().toISOString()
            }));
          } else {
            const asrProvider = env.USE_FIREWORKS ? 'Fireworks' : 'Groq';
            const asrFunction = env.USE_FIREWORKS ? processAudioWithFireworks : processAudioWithGroq;
            console.log(`🎵 Starting ASR with ${asrProvider} (${cachedData.length} chunks, ${totalBytes} bytes)`);
            
            asrFunction(cachedData, websocket, context.speechStartTimeMs, speechEndTimeMs).catch(err => {
              console.error(`❌ ASR processing failed:`, err);
              websocket.send(JSON.stringify({
                type: 'transcription_error',
                error: `Failed to process audio with ${asrProvider} API.`,
                details: err.message,
                timestamp: new Date().toISOString()
              }));
            });
          }
        } else {
          console.log(`🎵 VAD END ignored - not caching (isCaching: ${context.isCaching})`);
        }
      }
      break;

    case 'audio_stream_end':
      const endTimestamp = new Date().toISOString();
      websocket.send(context.MESSAGE_TEMPLATES.stream_end_ack_prefix + context.audioChunkCounter + ',"timestamp":"' + endTimestamp + '"}');
      break;

    default:
      const unknownType = parsedMessage.type || 'undefined';
      const errorResponse = JSON.stringify({
        error: "Unknown message type received",
        unknownType: unknownType,
        receivedMessage: parsedMessage,
        timestamp: new Date().toISOString()
      });
      websocket.send(errorResponse);
  }
}