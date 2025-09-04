// LLM API provider for Cloudflare Worker
// 支持 OpenRouter 和 Google 直接调用

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface GoogleMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

interface LLMConfig {
  provider: 'google' | 'openrouter';
  model: string;
  routingProvider?: string | null;
  openrouterApiKey?: string;
  googleApiKey?: string;
}

interface ModelConfig {
  provider: 'google' | 'openrouter';
  model: string;
  routingProvider?: string | null;
}

interface GoogleAPIPayload {
  contents: GoogleMessage[];
  generationConfig: {
    temperature: number;
    thinkingConfig: {
      thinkingBudget: number;
    };
    maxOutputTokens?: number;
  };
  system_instruction?: {
    parts: { text: string }[];
  };
}

interface OpenRouterPayload {
  model: string;
  messages: Message[];
  temperature: number;
  max_tokens?: number;
  provider?: {
    order: string[];
  };
}

interface GoogleAPIResponse {
  candidates: {
    content: {
      parts: { text: string }[];
    };
  }[];
}

interface OpenRouterAPIResponse {
  choices: {
    message: {
      content: string;
    };
  }[];
}

class LLMProvider {
   config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  async chatCompletion(messages: Message[], temperature: number = 0.7, maxTokens: number | null = null): Promise<string> {
    if (this.config.provider === 'google') {
      return this.callGoogleAPI(messages, temperature, maxTokens);
    } else {
      return this.callOpenRouterAPI(messages, temperature, maxTokens);
    }
  }

  private async callGoogleAPI(messages: Message[], temperature: number = 0.7, maxTokens: number | null = null): Promise<string> {
    if (!this.config.googleApiKey) {
      throw new Error('Google API Key not configured');
    }

    // 分离 system 消息和其他消息
    const systemMessages = messages.filter(msg => msg.role === 'system');
    const otherMessages = messages.filter(msg => msg.role !== 'system');

    // 转换消息格式为 Google 格式
    const contents: GoogleMessage[] = otherMessages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : msg.role as 'user',
      parts: [{ text: msg.content }]
    }));

    const payload: GoogleAPIPayload = {
      contents: contents,
      generationConfig: {
        temperature: temperature,
        thinkingConfig: {
          thinkingBudget: 0
        }
      }
    };

    // 如果有 system 消息，添加到 system_instruction
    if (systemMessages.length > 0) {
      const systemText = systemMessages.map(msg => msg.content).join('\n\n');
      payload.system_instruction = {
        parts: [{ text: systemText }]
      };
    }

    if (maxTokens) {
      payload.generationConfig.maxOutputTokens = maxTokens;
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:generateContent?key=${this.config.googleApiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      throw new Error(`Google API error: ${response.status} - ${await response.text()}`);
    }

    const result: GoogleAPIResponse = await response.json();
    return result.candidates[0].content.parts[0].text;
  }

  private async callOpenRouterAPI(messages: Message[], temperature: number = 0.7, maxTokens: number | null = null): Promise<string> {
    if (!this.config.openrouterApiKey) {
      throw new Error('OpenRouter API Key not configured');
    }

    const payload: OpenRouterPayload = {
      model: this.config.model,
      messages: messages,
      temperature: temperature
    };

    if (maxTokens) {
      payload.max_tokens = maxTokens;
    }

    // 如果指定了provider，添加provider配置
    if (this.config.routingProvider) {
      payload.provider = {
        order: [this.config.routingProvider]
      };
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        "Authorization": `Bearer ${this.config.openrouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://frapp.ai",
        "X-Title": "Frapp Agent"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status} - ${await response.text()}`);
    }

    const result: OpenRouterAPIResponse = await response.json();
    return result.choices[0].message.content;
  }
}

// 模型配置映射
const MODEL_CONFIGS: Record<string, ModelConfig> = {
  // Google 直接调用
  'gemini2.0': {
    provider: 'google',
    model: 'gemini-2.0-flash-001'
  },
  'gemini2.5': {
    provider: 'google', 
    model: 'gemini-2.5-flash'
  },
  
  // OpenRouter 调用
  'orouter_gemini2.0': {
    provider: 'openrouter',
    model: 'google/gemini-2.0-flash-001',
    routingProvider: null
  },
  'orouter_gemini2.5': {
    provider: 'openrouter',
    model: 'google/gemini-2.5-flash',
    routingProvider: null
  },
  'orouter_qwen3': {
    provider: 'openrouter',
    model: 'qwen/qwen3-32b',
    routingProvider: 'groq'
  }
};

function createLLMProvider(modelName: string, openrouterApiKey?: string, googleApiKey?: string): LLMProvider {
  const modelConfig = MODEL_CONFIGS[modelName];
  if (!modelConfig) {
    throw new Error(`Unsupported model: ${modelName}`);
  }

  const config: LLMConfig = {
    ...modelConfig,
    openrouterApiKey,
    googleApiKey
  };

  return new LLMProvider(config);
}

export { LLMProvider, createLLMProvider, MODEL_CONFIGS };
export type { Message, LLMConfig, ModelConfig };