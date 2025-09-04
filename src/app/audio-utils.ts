// Shared audio processing and WebSocket utilities
import { optimizedBase64Decode, RingBuffer, createOptimizedWavBlob } from './wav_utils';

// WebSocket message types
export interface AudioStreamStartMessage {
  type: 'audio_stream_start';
}

export interface AudioChunkMessage {
  type: 'audio_chunk';
  data: string;
  vad_state?: 'start' | 'end';
  vad_offset_ms?: number;
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

// WebSocket session handler
export async function handleAudioSession(websocket: WebSocket): Promise<void> {
  websocket.accept();
  
  const env = getAudioEnv();
  
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
            websocket.send(MESSAGE_TEMPLATES.stream_start_ack_prefix + startTimestamp + '"}');
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
    console.log("WebSocket connection closed");
  })
}

export async function processAudioWithFireworks(audioDataChunks: Uint8Array[], websocket: WebSocket, speechStartTimeMs: number, speechEndTimeMs: number): Promise<void> {
    const env = getAudioEnv();
    const startTime = Date.now();
    
    if (!env.FIREWORKS_API_KEY) {
        throw new Error("FIREWORKS_API_KEY secret is not set in the worker environment.");
    }
    if (audioDataChunks.length === 0) {
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

export async function processAudioWithGroq(audioDataChunks: Uint8Array[], websocket: WebSocket, speechStartTimeMs: number, speechEndTimeMs: number): Promise<void> {
    const env = getAudioEnv();
    const startTime = Date.now();
    
    if (!env.GROQ_API_KEY) {
        throw new Error("GROQ_API_KEY secret is not set in the worker environment.");
    }
    if (audioDataChunks.length === 0) {
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