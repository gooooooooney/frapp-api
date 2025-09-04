// WAV头模板缓存和音频处理优化工具
const SAMPLE_RATE = 16000;
const BIT_DEPTH = 16;
const CHANNELS = 1;
const BYTES_PER_SAMPLE = 2;

// 预计算的WAV头模板 (44字节)
const WAV_HEADER_TEMPLATE = new ArrayBuffer(44);
const WAV_HEADER_VIEW = new DataView(WAV_HEADER_TEMPLATE);

// 初始化WAV头固定部分
WAV_HEADER_VIEW.setUint32(0, 0x52494646, false); // "RIFF"
WAV_HEADER_VIEW.setUint32(8, 0x57415645, false); // "WAVE"
WAV_HEADER_VIEW.setUint32(12, 0x666d7420, false); // "fmt "
WAV_HEADER_VIEW.setUint32(16, 16, true); // sub-chunk size
WAV_HEADER_VIEW.setUint16(20, 1, true); // Audio format (PCM)
WAV_HEADER_VIEW.setUint16(22, CHANNELS, true); // Number of channels
WAV_HEADER_VIEW.setUint32(24, SAMPLE_RATE, true); // Sample rate
WAV_HEADER_VIEW.setUint32(28, SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE, true); // Byte rate
WAV_HEADER_VIEW.setUint16(32, CHANNELS * BYTES_PER_SAMPLE, true); // Block align
WAV_HEADER_VIEW.setUint16(34, BIT_DEPTH, true); // Bits per sample
WAV_HEADER_VIEW.setUint32(36, 0x64617461, false); // "data"

/**
 * 优化的base64解码，使用预分配数组避免循环开销
 */
function optimizedBase64Decode(base64String: string): Uint8Array {
    const binaryString = atob(base64String);
    const length = binaryString.length;
    const bytes = new Uint8Array(length);
    
    // 批量复制，减少单次赋值开销
    for (let i = 0; i < length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    
    return bytes;
}

/**
 * 环形缓冲区实现，避免频繁的数组合并操作
 */
class RingBuffer {
    private maxBytes: number;
    private buffer: Uint8Array;
    private start: number;
    private length: number;
    
    constructor(maxBytes: number) {
        this.maxBytes = maxBytes;
        this.buffer = new Uint8Array(maxBytes * 2); // 双倍空间避免边界处理
        this.start = 0;
        this.length = 0;
    }
    
    append(data: Uint8Array): void {
        const dataLength = data.length;
        
        // 如果新数据会超出最大容量，先移除旧数据
        if (this.length + dataLength > this.maxBytes) {
            const removeLength = this.length + dataLength - this.maxBytes;
            this.start = (this.start + removeLength) % this.buffer.length;
            this.length -= removeLength;
        }
        
        // 写入新数据
        const writeStart = (this.start + this.length) % this.buffer.length;
        
        if (writeStart + dataLength <= this.buffer.length) {
            // 一次性写入
            this.buffer.set(data, writeStart);
        } else {
            // 分两次写入（处理环形边界）
            const firstPart = this.buffer.length - writeStart;
            this.buffer.set(data.subarray(0, firstPart), writeStart);
            this.buffer.set(data.subarray(firstPart), 0);
        }
        
        this.length += dataLength;
    }
    
    getData(): Uint8Array {
        if (this.length === 0) return new Uint8Array(0);
        
        const result = new Uint8Array(this.length);
        
        if (this.start + this.length <= this.buffer.length) {
            // 数据连续
            result.set(this.buffer.subarray(this.start, this.start + this.length));
        } else {
            // 数据跨越边界
            const firstPart = this.buffer.length - this.start;
            result.set(this.buffer.subarray(this.start), 0);
            result.set(this.buffer.subarray(0, this.length - firstPart), firstPart);
        }
        
        return result;
    }
    
    clear(): void {
        this.start = 0;
        this.length = 0;
    }
}

/**
 * 快速创建WAV文件，使用预缓存的头模板
 */
function createOptimizedWavBlob(pcmDataChunks: Uint8Array[]): Blob {
    // 计算PCM数据总长度
    const pcmDataSize = pcmDataChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    
    // 复制WAV头模板并更新可变字段
    const header = WAV_HEADER_TEMPLATE.slice(0);
    const headerView = new DataView(header);
    headerView.setUint32(4, 36 + pcmDataSize, true); // 文件总大小 - 8
    headerView.setUint32(40, pcmDataSize, true); // PCM数据大小
    
    // 合并头和数据
    const wavChunks = [new Uint8Array(header), ...pcmDataChunks];
    return new Blob(wavChunks, { type: 'audio/wav' });
}

export { 
    optimizedBase64Decode, 
    RingBuffer, 
    createOptimizedWavBlob 
};