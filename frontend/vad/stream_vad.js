/**
 * Ten VAD Browser
 */

const VADState = { IDLE: 'idle', SPEAKING: 'speaking' };
const VADEvent = { NONE: 'none', SPEECH_START: 'start', SPEECH_END: 'end', CACHE_ASR_TRIGGER: 'cache_asr_trigger', CACHE_ASR_DROP: 'cache_asr_drop' };

class VADConfig {
    constructor(options = {}) {
        this.hopMs = options.hopMs || 16;
        this.threshold = options.threshold || 0.5;
        this.prefixMs = options.prefixMs || 128;
        this.silenceMs = options.silenceMs || 640;
        this.asrTriggerMs = options.asrTriggerMs || 256;
        this.enablePrefetch = options.enablePrefetch !== undefined ? options.enablePrefetch : true;
        this.sampleRate = options.sampleRate || 16000;
    }
    get hopSamples() { return Math.floor(this.hopMs * this.sampleRate / 1000); }
    get speechFrames() { return Math.floor(this.prefixMs / this.hopMs); }
    get silenceFrames() { return Math.floor(this.silenceMs / this.hopMs); }
    get asrTriggerFrames() { return Math.floor(this.asrTriggerMs / this.hopMs); }
}

class TENVAD {
    constructor() {
        this.vadModule = null;
        this.vadHandle = null;
        this.vadHandlePtr = null;
        this.isInitialized = false;
        this.HOP_SIZE = 256;
        this.VOICE_THRESHOLD = 0.5;
    }

    async init() {
        try {
            const { default: createVADModule } = await import('./ten_vad.js');
            this.vadModule = await createVADModule();
            
            if (!this.vadModule.getValue) {
                this.vadModule.getValue = (ptr, type) => {
                    return type === 'i32' ? this.vadModule.HEAP32[ptr >> 2] : this.vadModule.HEAPF32[ptr >> 2];
                };
            }
            
            this.vadHandlePtr = this.vadModule._malloc(4);
            const result = this.vadModule._ten_vad_create(this.vadHandlePtr, this.HOP_SIZE, this.VOICE_THRESHOLD);
            
            if (result === 0) {
                this.vadHandle = this.vadModule.getValue(this.vadHandlePtr, 'i32');
                this.isInitialized = true;
                return true;
            } else {
                console.error(`VAD创建失败，错误码: ${result}`);
                this.vadModule._free(this.vadHandlePtr);
                return false;
            }
        } catch (error) {
            console.error('❌ VAD初始化失败:', error);
            return false;
        }
    }

    processFrame(audioData) {
        if (!this.isInitialized || audioData.length !== this.HOP_SIZE) return null;
        const audioPtr = this.vadModule._malloc(this.HOP_SIZE * 2);
        const probPtr = this.vadModule._malloc(4);
        const flagPtr = this.vadModule._malloc(4);
        try {
            this.vadModule.HEAP16.set(audioData, audioPtr / 2);
            const result = this.vadModule._ten_vad_process(this.vadHandle, audioPtr, this.HOP_SIZE, probPtr, flagPtr);
            return result === 0 ? {
                probability: this.vadModule.getValue(probPtr, 'float'),
                isVoice: this.vadModule.getValue(flagPtr, 'i32') === 1
            } : null;
        } finally {
            this.vadModule._free(audioPtr);
            this.vadModule._free(probPtr);
            this.vadModule._free(flagPtr);
        }
    }

    destroy() {
        if (this.vadHandlePtr && this.vadModule) {
            this.vadModule._ten_vad_destroy(this.vadHandlePtr);
            this.vadModule._free(this.vadHandlePtr);
            this.vadHandlePtr = null;
            this.vadHandle = null;
            this.isInitialized = false;
        }
    }
}

class StreamingVAD {
    constructor(config = new VADConfig()) {
        this.config = config;
        this.vad = new TENVAD();
        this.state = VADState.IDLE;
        this.speechCount = 0;
        this.silenceCount = 0;
        this.isInitialized = false;
    }

    async init() {
        this.isInitialized = await this.vad.init();
        return this.isInitialized;
    }

    processAudio(audioData) {
        if (!this.isInitialized) throw new Error('StreamingVAD未初始化');

        let eventTimeMs = 0, returnEvent = null;
        const framesCount = Math.floor(audioData.length / this.config.hopSamples);

        for (let i = 0; i < framesCount; i++) {
            const startIdx = i * this.config.hopSamples;
            const frameData = audioData.subarray(startIdx, startIdx + this.config.hopSamples);
            const result = this.vad.processFrame(frameData);
            if (!result) continue;

            const event = this._updateEvent(result.probability >= this.config.threshold);
            if (event !== VADEvent.NONE) {
                const frameOffset = event === VADEvent.SPEECH_START ? 
                    i - (this.speechCount - 1) - framesCount : i + 1;
                eventTimeMs = frameOffset * this.config.hopMs;
                if (returnEvent !== null) console.warn("这个chunk之前有事件!");
                returnEvent = { event, eventTimeMs };
            }
        }
        return returnEvent || { event: VADEvent.NONE, eventTimeMs: 0 };
    }

    _updateEvent(isSpeech) {
        // 检查是否需要触发drop：在SPEAKING状态下，静音达到trigger阈值后又开始说话
        // 但必须确保之前确实触发过trigger，且还未达到完全结束的阈值
        const shouldTriggerDrop = this.config.enablePrefetch && 
                                 this.state === VADState.SPEAKING && 
                                 this.silenceCount >= this.config.asrTriggerFrames && 
                                 this.silenceCount < this.config.silenceFrames && // 关键：还未达到完全结束
                                 isSpeech && 
                                 this.speechCount === 0; // 刚开始说话

        // 更新计数器
        this.speechCount = isSpeech ? this.speechCount + 1 : 0;
        this.silenceCount = !isSpeech ? this.silenceCount + 1 : 0;
        
        // 如果需要触发drop，先返回drop事件
        if (shouldTriggerDrop) {
            return VADEvent.CACHE_ASR_DROP;
        }
        
        if (this.state === VADState.IDLE && this.speechCount === this.config.speechFrames) {
            this.state = VADState.SPEAKING;
            // VAD start时清除静音计数器，确保cache_asr_trigger的计数器从新的speaking开始
            this.silenceCount = 0;
            return VADEvent.SPEECH_START;
        } else if (this.config.enablePrefetch && this.state === VADState.SPEAKING && this.silenceCount === this.config.asrTriggerFrames) {
            // 只有启用prefetch时才触发Cache ASR，但保持SPEAKING状态
            return VADEvent.CACHE_ASR_TRIGGER;
        } else if (this.state === VADState.SPEAKING && this.silenceCount >= this.config.silenceFrames) {
            this.state = VADState.IDLE;
            return VADEvent.SPEECH_END;
        }
        return VADEvent.NONE;
    }

    reset() {
        // 重置所有状态到初始值
        this.state = VADState.IDLE;
        this.speechCount = 0;
        this.silenceCount = 0;
        console.log('StreamingVAD状态已重置: state=IDLE, speechCount=0, silenceCount=0');
    }

    isSpeaking() { return this.state === VADState.SPEAKING; }
    destroy() { if (this.vad) this.vad.destroy(); }
}

let globalStreamingVAD = null;
let vadEvents = [];

async function initGlobalStreamingVAD() {
    try {
        const config = new VADConfig({ hopMs: 16, threshold: 0.5, prefixMs: 128, silenceMs: 640, asrTriggerMs: 256, enablePrefetch: true, sampleRate: 16000 });
        globalStreamingVAD = new StreamingVAD(config);
        const success = await globalStreamingVAD.init();
        
        if (success) {
            vadEvents = [];
            window.globalStreamingVAD = globalStreamingVAD;
            window.vadEvents = vadEvents;
            return true;
        } else {
            throw new Error('StreamingVAD初始化失败');
        }
    } catch (error) {
        console.error('❌ 全局StreamingVAD初始化失败:', error);
        return false;
    }
}

window.VADState = VADState;
window.VADEvent = VADEvent;
window.VADConfig = VADConfig;
window.StreamingVAD = StreamingVAD;
window.initGlobalStreamingVAD = initGlobalStreamingVAD;