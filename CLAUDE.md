# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Local Development
```bash
pnpm run dev          # Start local development server with hot reload
pnpm run start        # Alternative start command
wrangler dev         # Direct wrangler development server
```

### Deployment  
```bash
pnpm run deploy       # Deploy to Cloudflare Workers
wrangler deploy      # Direct wrangler deployment
```

### Type Generation
```bash
pnpm run cf-typegen   # Generate Cloudflare Worker types from wrangler.toml
```

### Secrets Management
Required secrets for production:
```bash
wrangler secret put CLERK_SECRET_KEY
wrangler secret put CLERK_JWT_KEY  
wrangler secret put CLERK_AUTHORIZED_PARTIES
wrangler secret put FIREWORKS_API_KEY
wrangler secret put GEMINI_API_KEY
wrangler secret put GROQ_API_KEY
wrangler secret put OPENROUTER_API_KEY
```

For local development, create `.dev.vars` file with the same secret names.

### Resource Setup
```bash
# Create KV namespace for WebSocket tickets
wrangler kv:namespace create "WS_TICKETS_KV"

# R2 bucket is configured in wrangler.toml as "frapp-files"
```

## Architecture Overview

### Core Technology Stack
- **Runtime**: Cloudflare Workers
- **Framework**: Hono with chanfana for OpenAPI 3.1 support
- **Authentication**: Clerk with JWT tokens
- **Storage**: R2 buckets for files, KV for WebSocket tickets
- **Audio Processing**: Groq/Fireworks Whisper API integration

### Application Structure

#### Main Router (`src/index.ts`)
- Hono app with CORS middleware
- OpenAPI schema generation via chanfana
- Clerk authentication middleware on all `/api/*` routes
- WebSocket endpoint at `/api/ws` (non-OpenAPI)
- Proxy routes for `/v1/*` and `/openai/*`

#### WebSocket Audio Streaming Architecture
Real-time audio processing system with VAD (Voice Activity Detection):

**Authentication Flow:**
1. Client requests WebSocket ticket via `/api/ws/ticket` (authenticated endpoint)
2. Server generates time-limited ticket stored in KV
3. WebSocket connection requires ticket as first message within 5 seconds
4. Validated connections get audio processing capabilities

**Audio Processing Pipeline:**
1. **VAD Caching System** (`src/app/audio-utils.ts:127-204`):
   - Maintains 256ms ring buffer for pre-speech audio
   - Caches audio chunks between `vad_state: 'start'` and `vad_state: 'end'`
   - Handles VAD offset timestamps for precise speech boundaries
2. **Audio Format**: 16kHz, 16-bit, mono PCM chunks (128ms duration)
3. **Processing**: Creates optimized WAV files, sends to Groq/Fireworks Whisper API
4. **Response**: Returns transcription with timing and performance metrics

#### Storage Layer

**R2 File Storage** (`src/store/r2/file-storage.ts`):
- Native Cloudflare R2 API integration
- Supports file CRUD operations with metadata
- User-scoped file organization
- Automatic content type detection and custom metadata storage

**KV Ticket Storage** (`src/store/kv/`):
- Secure WebSocket authentication tickets
- Time-limited tokens with automatic expiration
- User context preservation for authenticated sessions

#### Endpoint Organization
- `src/endpoints/info.ts` - System information endpoint
- `src/endpoints/llm.ts` - LLM chat functionality  
- `src/endpoints/websocket.ts` - WebSocket connection handler
- `src/endpoints/websocket-ticket.ts` - WebSocket authentication tickets
- `src/endpoints/proxy.ts` - API request proxying

### Key Design Patterns

#### Secure WebSocket Authentication
Uses "first message authentication" pattern where WebSocket connections must authenticate within 5 seconds using a pre-validated ticket from the REST API.

#### VAD-Driven Audio Caching  
Optimized audio processing that only transcribes speech segments detected by Voice Activity Detection, reducing API costs and improving performance.

#### Environment Configuration
Extended environment interface (`src/types.ts`) centralizes all Cloudflare bindings (KV, R2) and external API keys with proper TypeScript typing.

## Important Development Notes

### Audio Processing Constants
- Chunk duration: 128ms
- Audio format: 16kHz, 16-bit, mono (32 bytes/ms)
- Ring buffer size: 256ms for VAD pre-roll

### WebSocket Message Types
- `audio_stream_start` - Initialize audio session
- `audio_chunk` - Audio data with optional VAD state
- `audio_stream_end` - End audio session
- `auth` - Authentication with ticket (first message only)

### R2 File Paths
Files stored with pattern: `[folder/]fileId.extension` where fileId is timestamp-based for uniqueness.

### OpenAPI Integration
Uses chanfana for automatic OpenAPI schema generation. Endpoints in `src/endpoints/` automatically appear in Swagger UI at `/`.