import { OpenAPIRoute, Num, Str } from "chanfana";
import { z } from "zod";
import { type AppContext } from "../types";
import { createLLMProvider } from "../app/llm_api";

// LLM request schema
const LLMRequestSchema = z.object({
  system_prompt: Str({ description: "System prompt for the LLM" }),
  content: Str({ description: "User content/message" }),
  model: Str({ description: "LLM model to use", default: "gemini2.5", required: false }),
  temperature: Num({ description: "Temperature for generation", default: 0.3, required: false }),
  max_tokens: Num({ description: "Maximum tokens to generate", default: 1000, required: false })
});

// LLM response schema
const LLMResponseSchema = z.object({
  response: Str({ description: "LLM generated response" }),
  _performance: z.object({
    total_duration_ms: Num({ description: "Total processing time in milliseconds" }),
    timestamp: Str({ description: "ISO timestamp" }),
    model: Str({ description: "Model used" }),
    provider: Str({ description: "Provider used" })
  })
});

export class LLMChat extends OpenAPIRoute {
  schema = {
    tags: ["LLM"],
    summary: "Chat with LLM",
    description: "Send a message to an LLM with custom system prompt",
    request: {
      body: {
        content: {
          "application/json": {
            schema: LLMRequestSchema,
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Returns LLM response",
        content: {
          "application/json": {
            schema: LLMResponseSchema,
          },
        },
      },
      "400": {
        description: "Bad request - missing required fields",
        content: {
          "application/json": {
            schema: z.object({
              error: Str({ description: "Error message" }),
            }),
          },
        },
      },
      "500": {
        description: "Internal server error",
        content: {
          "application/json": {
            schema: z.object({
              error: Str({ description: "Error message" }),
              details: Str({ description: "Error details" }),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    // Get validated data
    const data = await this.getValidatedData<typeof this.schema>();
    
    const { system_prompt, content, model = 'gemini2.5', temperature = 0.3, max_tokens = 1000 } = data.body;

    if (!system_prompt || typeof system_prompt !== 'string') {
      return c.json({ error: 'Missing or invalid system_prompt field' }, 400);
    }

    if (!content || typeof content !== 'string') {
      return c.json({ error: 'Missing or invalid content field' }, 400);
    }

    try {
      const startTime = Date.now();

      // Get environment variables
      const env = c.env;
      
      // 创建LLM提供商实例
      const llm = createLLMProvider(model, env.OPENROUTER_API_KEY, env.GEMINI_API_KEY);
      
      // 构建消息
      const messages = [
        {
          role: "system" as const,
          content: system_prompt
        },
        {
          role: "user" as const, 
          content: content
        }
      ];

      // 调用LLM API
      const response = await llm.chatCompletion(messages, temperature, max_tokens);
      const endTime = Date.now();
      const totalDuration = endTime - startTime;

      const result = {
        response: response,
        _performance: {
          total_duration_ms: totalDuration,
          timestamp: new Date().toISOString(),
          model: model,
          provider: llm.config.routingProvider || llm.config.provider
        }
      };

      return c.json(result);

    } catch (error) {
      const err = error as Error;
      return c.json({ 
        error: 'Internal server error', 
        details: err.message 
      }, 500);
    }
  }
}