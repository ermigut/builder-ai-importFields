# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Backend (run from `backend/`)
```bash
npm run dev      # Start dev server with nodemon (hot reload, port 4000)
npm start        # Start production server
npm test         # Run Jest tests
```

### Frontend (run from `frontend/`)
```bash
npm run dev      # Start Vite dev server
npm run build    # Production build
npm run lint     # ESLint
npm run preview  # Preview production build
```

Both packages use ES modules (`"type": "module"`).

## Architecture

This is a full-stack tool that automates the creation of **Albato** integration field configurations from API documentation, using OpenAI GPT for field generation.

### Two User Flows

**Flow 1 — Direct Config (`/config`):** User provides API source (URL/cURL/JSON) + selects Albato app/entity → backend generates fields → user edits → sends to Albato.

**Flow 2 — Chat-Based (`/chat`):** User uploads API docs (PDF/JSON/YAML/URL) → backend parses, chunks, and embeds into LanceDB → user chats to pick endpoints → AI generates fields using RAG retrieval.

### Backend Services (`backend/src/services/`)

| File | Responsibility |
|------|---------------|
| `aiClient.js` | Direct field generation via OpenAI; builds prompts from API source |
| `chatAiClient.js` | Chat-mode AI: endpoint detection scoring, RAG context assembly, batching large OpenAPI schemas |
| `docParser.js` | Parses PDF/JSON/YAML/OpenAPI/URL into `{ rawText, isOpenAPI, endpoints[], docHash }` |
| `documentChunker.js` | Splits docs into semantic chunks for embedding |
| `embeddingClient.js` | OpenAI embeddings API wrapper with batch support |
| `vectorStore.js` | LanceDB wrapper — stores/retrieves chunks by docHash, vector similarity, endpoint name |
| `chatSessionStore.js` | In-memory sessions: message history, last generated fields, RAG status |
| `externalApiClient.js` | Albato API client (auth, apps, versions, entities, field upload) |
| `jsonSchemaValidator.js` | Validates and normalizes AI JSON output against Albato schema |

### Routes (`backend/src/routes/`)
- `POST /ai/generate` — single-shot field generation
- `POST /chat/upload`, `POST /chat/message`, `GET|DELETE /chat/session/:id` — chat flow
- `POST /albato/auth`, `GET /albato/apps`, `GET /albato/apps/:id/versions`, `GET /albato/apps/:id/versions/:vid/entities`, `POST /albato/send` — Albato integration

### Frontend (`frontend/src/`)
- Two pages: `ConfigBuilderPage.jsx` and `ChatDocPage.jsx`
- `utils/requestBuilder.js` — transforms AI output into Albato's request/response structure; handles type-99 array sections, `pathToArray`, `__` → dot-notation key conversion, `formatCfg`
- `utils/api.js` — Axios instance pointed at backend

### Field Data Structure
```js
{
  data: { code, valueType, required, isEditable },
  titleEn, titleRu, hintEn, hintRu
}
// valueType: 1=string, 2=integer, 3=float, 9=bool, 5=datetime, 8=date, 99=array-section
```

### Key Design Decisions
- LanceDB vector store persists to `backend/data/vectordb/`; server starts with graceful fallback if unavailable
- Endpoint detection in `chatAiClient.js` uses a keyword-scoring algorithm with Russian↔English mapping
- Large OpenAPI specs are batched to avoid token limits during chat-mode generation
- Multilingual field generation (en, ru, pt, es, tr, fr, de) controlled via prompt templates in `aiClient.js`

## Environment
Backend requires `backend/.env` with `OPENAI_API_KEY`. Frontend uses `frontend/.env` for the API base URL.
