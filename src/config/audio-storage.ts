// 音频存储系统配置常量
export const AUDIO_STORAGE_CONFIG = {
  // 内存管理
  DEFAULT_WINDOW_SIZE_MS: 2 * 60 * 1000,      // 2分钟滑动窗口
  DEFAULT_UPLOAD_INTERVAL_MS: 60 * 1000,      // 1分钟上传间隔
  MAX_MEMORY_PER_SESSION_MB: 10,              // 每个会话最大内存使用
  EMERGENCY_CLEANUP_THRESHOLD_MB: 8,          // 紧急清理阈值
  
  // 存储路径
  AUDIO_SESSIONS_PREFIX: 'audio-sessions/',   // R2存储前缀
  
  // 文件命名
  FILENAME_TEMPLATE: 'session_{sessionId}_chunk_{chunkId}.wav',
  
  // 性能优化
  MAX_CONCURRENT_UPLOADS: 3,                  // 最大并发上传数
  UPLOAD_RETRY_ATTEMPTS: 3,                   // 上传重试次数
  UPLOAD_TIMEOUT_MS: 30 * 1000,              // 上传超时时间
  
  // 清理策略
  DEFAULT_MAX_AGE_DAYS: 30,                   // 默认文件保留天数
  CLEANUP_BATCH_SIZE: 100,                    // 清理批次大小
  
  // 监控
  HEALTH_CHECK_INTERVAL_MS: 5 * 60 * 1000,   // 健康检查间隔
  STATS_UPDATE_INTERVAL_MS: 30 * 1000,       // 统计更新间隔
  
  // Worker限制
  WORKER_MEMORY_LIMIT_MB: 128,               // Worker总内存限制
  ISOLATE_MEMORY_OVERHEAD_MB: 50,            // Isolate开销预留
  MAX_CONCURRENT_SESSIONS: 20,               // 最大并发会话数
  
  // 音频格式
  SAMPLE_RATE: 16000,                        // 采样率
  BIT_DEPTH: 16,                             // 位深度
  CHANNELS: 1,                               // 单声道
  CHUNK_DURATION_MS: 128,                    // 音频块持续时间
  
  // 文件大小估算 (基于上述音频格式)
  BYTES_PER_MS: 32,                          // 32 bytes/ms (16kHz, 16bit, mono)
  ESTIMATED_FILE_SIZE_2MIN_MB: 3.84,         // 2分钟音频文件大小
  ESTIMATED_FILE_SIZE_5MIN_MB: 9.6,          // 5分钟音频文件大小
} as const;

// 音频存储错误代码
export const AUDIO_STORAGE_ERRORS = {
  INITIALIZATION_FAILED: 'INIT_FAILED',
  MEMORY_LIMIT_EXCEEDED: 'MEMORY_EXCEEDED',
  UPLOAD_FAILED: 'UPLOAD_FAILED',
  DOWNLOAD_FAILED: 'DOWNLOAD_FAILED',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  CLEANUP_FAILED: 'CLEANUP_FAILED',
  INVALID_SESSION: 'INVALID_SESSION',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
} as const;

// 音频存储状态
export const AUDIO_STORAGE_STATUS = {
  INACTIVE: 'inactive',
  ACTIVE: 'active',
  UPLOADING: 'uploading',
  ERROR: 'error',
  CLEANUP: 'cleanup',
} as const;

// 环境配置键
export const AUDIO_STORAGE_ENV_KEYS = {
  ENABLE_DEBUG: 'AUDIO_STORAGE_DEBUG',
  MAX_MEMORY_MB: 'AUDIO_STORAGE_MAX_MEMORY_MB',
  UPLOAD_INTERVAL_MS: 'AUDIO_STORAGE_UPLOAD_INTERVAL_MS',
  MAX_AGE_DAYS: 'AUDIO_STORAGE_MAX_AGE_DAYS',
  ENABLE_AUTO_CLEANUP: 'AUDIO_STORAGE_AUTO_CLEANUP',
} as const;

// 性能监控指标阈值
export const PERFORMANCE_THRESHOLDS = {
  UPLOAD_LATENCY_WARNING_MS: 5000,           // 上传延迟警告阈值
  UPLOAD_LATENCY_ERROR_MS: 10000,            // 上传延迟错误阈值
  MEMORY_USAGE_WARNING_PERCENT: 80,          // 内存使用警告阈值
  MEMORY_USAGE_ERROR_PERCENT: 95,            // 内存使用错误阈值
  SESSION_DURATION_WARNING_MIN: 30,          // 会话时长警告阈值
  SESSION_DURATION_ERROR_MIN: 60,            // 会话时长错误阈值
} as const;

// 类型定义
export type AudioStorageError = keyof typeof AUDIO_STORAGE_ERRORS;
export type AudioStorageStatus = typeof AUDIO_STORAGE_STATUS[keyof typeof AUDIO_STORAGE_STATUS];
export type AudioStorageEnvKey = keyof typeof AUDIO_STORAGE_ENV_KEYS;

/**
 * 根据环境变量获取配置值
 */
export function getAudioStorageConfig(env: any) {
  return {
    windowSizeMs: parseInt(env[AUDIO_STORAGE_ENV_KEYS.UPLOAD_INTERVAL_MS]) || AUDIO_STORAGE_CONFIG.DEFAULT_WINDOW_SIZE_MS,
    uploadIntervalMs: parseInt(env[AUDIO_STORAGE_ENV_KEYS.UPLOAD_INTERVAL_MS]) || AUDIO_STORAGE_CONFIG.DEFAULT_UPLOAD_INTERVAL_MS,
    maxMemoryMB: parseInt(env[AUDIO_STORAGE_ENV_KEYS.MAX_MEMORY_MB]) || AUDIO_STORAGE_CONFIG.MAX_MEMORY_PER_SESSION_MB,
    enableDebug: env[AUDIO_STORAGE_ENV_KEYS.ENABLE_DEBUG] === 'true' || env.DEBUG_MODE === 'true',
    maxAgeDays: parseInt(env[AUDIO_STORAGE_ENV_KEYS.MAX_AGE_DAYS]) || AUDIO_STORAGE_CONFIG.DEFAULT_MAX_AGE_DAYS,
    enableAutoCleanup: env[AUDIO_STORAGE_ENV_KEYS.ENABLE_AUTO_CLEANUP] === 'true',
    storeOriginalAudio: true,  // 默认存储完整原始音频流
    storeVadSegments: false,   // 默认不单独存储VAD片段
  };
}

/**
 * 计算估计的内存使用量 (MB)
 */
export function calculateEstimatedMemoryUsage(windowSizeMs: number): number {
  return (windowSizeMs * AUDIO_STORAGE_CONFIG.BYTES_PER_MS) / (1024 * 1024);
}

/**
 * 计算并发会话限制
 */
export function calculateMaxConcurrentSessions(perSessionMemoryMB: number): number {
  const availableMemory = AUDIO_STORAGE_CONFIG.WORKER_MEMORY_LIMIT_MB - AUDIO_STORAGE_CONFIG.ISOLATE_MEMORY_OVERHEAD_MB;
  return Math.floor(availableMemory / perSessionMemoryMB);
}

/**
 * 验证配置参数
 */
export function validateAudioStorageConfig(config: any): string[] {
  const errors: string[] = [];
  
  if (config.windowSizeMs <= 0 || config.windowSizeMs > 10 * 60 * 1000) {
    errors.push('Window size must be between 1ms and 10 minutes');
  }
  
  if (config.uploadIntervalMs <= 0 || config.uploadIntervalMs > config.windowSizeMs) {
    errors.push('Upload interval must be positive and less than window size');
  }
  
  if (config.maxMemoryMB <= 0 || config.maxMemoryMB > 50) {
    errors.push('Max memory must be between 1MB and 50MB');
  }
  
  const estimatedMemory = calculateEstimatedMemoryUsage(config.windowSizeMs);
  if (estimatedMemory > config.maxMemoryMB) {
    errors.push(`Estimated memory usage (${estimatedMemory.toFixed(2)}MB) exceeds limit (${config.maxMemoryMB}MB)`);
  }
  
  return errors;
}