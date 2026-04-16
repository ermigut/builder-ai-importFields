/**
 * Роутер для чат-сессий с API документацией.
 *
 * POST /chat/upload   — Загрузка файла или URL документации, создание сессии
 * POST /chat/message  — Отправка сообщения в чат
 * GET  /chat/session/:id — Получение состояния сессии
 * DELETE /chat/session/:id — Удаление сессии
 */

import { Router } from 'express';
import multer from 'multer';
import { parseFile, parseURL } from '../services/docParser.js';
import { createSession, getSession, addMessage, setLastResult, deleteSession } from '../services/chatSessionStore.js';
import { sendChatMessage } from '../services/chatAiClient.js';
import { chunkDocument, splitLargeChunks } from '../services/documentChunker.js';
import { embedText, embedBatch } from '../services/embeddingClient.js';
import { hasDocument, upsertChunks, searchChunks, getIntroChunks, getEndpointChunks } from '../services/vectorStore.js';
import { logAiOperation } from '../middleware/logger.js';

const router = Router();

// Настройка multer: хранение в памяти, лимит 10MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

/**
 * POST /chat/upload
 * Загружает файл или URL документации, парсит, создаёт сессию.
 *
 * Body (multipart/form-data):
 *   file — загружаемый файл (PDF, JSON, YAML, TXT)
 * ИЛИ Body (application/json):
 *   { url: "https://..." }
 *
 * Response:
 *   { sessionId, summary, endpoints[] }
 */
router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    let docContent;

    if (req.file) {
      // Загрузка файла
      docContent = await parseFile(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname
      );
    } else if (req.body?.url) {
      // Загрузка по URL
      docContent = await parseURL(req.body.url);
    } else {
      return res.status(400).json({ error: 'Необходимо загрузить файл или указать URL' });
    }

    const session = createSession(docContent);

    // Векторизация документа (RAG)
    try {
      const docHash = docContent.docHash;
      if (docHash && !(await hasDocument(docHash))) {
        const chunks = chunkDocument(docContent);
        if (chunks.length > 0) {
          // Разбиваем слишком большие чанки, чтобы не превысить лимит OpenAI (8192 токена)
          const splitChunks = splitLargeChunks(chunks);
          if (splitChunks.length > chunks.length) {
            logAiOperation('Upload: большие чанки разбиты', {
              docHash: docHash.slice(0, 8),
              originalChunks: chunks.length,
              splitChunks: splitChunks.length,
            });
          }
          const vectors = await embedBatch(splitChunks.map(c => c.text));
          await upsertChunks(docHash, splitChunks, vectors, docContent.sourceType);
          logAiOperation('Upload: документ проиндексирован', { docHash: docHash.slice(0, 8), chunks: splitChunks.length });

          // Определяем вводный чанк (базовый URL, общая информация, авторизация)
          const introIdx = splitChunks.findIndex(c =>
            /https?:\/\/.*api\/|общая информация|base url|authorization|аутентификация|authentication/i.test(c.text)
          );
          session.introChunkIndex = introIdx >= 0 ? introIdx : 0;
        }
      } else if (docHash) {
        logAiOperation('Upload: документ уже проиндексирован (дедупликация)', { docHash: docHash.slice(0, 8) });
        // Для дедуплицированных: найдём intro-чанк через поиск
        const introResults = await getIntroChunks(docHash, 10);
        const introChunk = introResults.find(c =>
          /https?:\/\/.*api\/|общая информация|base url|authorization/i.test(c.text)
        );
        session.introChunkIndex = introChunk?.chunkIndex ?? 0;
      }
      session.useRag = true;
    } catch (ragError) {
      logAiOperation('Upload: RAG ошибка, fallback на полный текст', { error: ragError.message });
      session.useRag = false;
    }

    // Формируем краткую сводку
    let summary = `Документ загружен (${docContent.sourceType}).`;
    if (docContent.isOpenAPI) {
      summary = `OpenAPI спецификация. Найдено эндпоинтов: ${docContent.endpoints.length}.`;
    } else if (docContent.rawText) {
      const lines = docContent.rawText.split('\n').filter(l => l.trim()).length;
      summary += ` Строк текста: ${lines}.`;
    }

    const endpoints = (docContent.endpoints || []).map(ep => ({
      path: ep.path,
      method: ep.method,
      summary: ep.summary || ep.operationId || '',
    }));

    res.json({
      sessionId: session.id,
      summary,
      endpoints,
      sourceType: docContent.sourceType,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Маппинг русских корней на английские API-термины (сущности и действия).
 */
const RU_TO_EN = {
  // Сущности
  'задач': 'task',
  'проект': 'project',
  'тег': 'tag',
  'пользовател': 'user',
  'сотрудник': 'employee',
  'комментар': 'comment',
  'файл': 'file',
  'документ': 'document',
  'орган': 'organization',
  'воронк': 'pipeline',
  'сделк': 'deal',
  'контакт': 'contact',
  'компан': 'company',
  'лид': 'lead',
  'товар': 'product',
  'каталог': 'catalog',
  'заказ': 'order',
  'инвойс': 'invoice',
  'отчет': 'report',
  'групп': 'group',
  'команд': 'team',
  'рол': 'role',
  'секц': 'section',
  'истори': 'story',
  'зависим': 'depend',
  'подписчик': 'follower',
  'наблюдател': 'follower',
  'время': 'time',
  'трекинг': 'tracking',
  'категори': 'category',
  'портфел': 'portfolio',
  'шаблон': 'template',
  'цел': 'goal',
  'доступ': 'access',
  'роли': 'role',
  'таймшит': 'timesheet',
  'аллокац': 'allocation',
  'ооо': 'ooo',
  'бриф': 'brief',
  'скор': 'score',
  'ставк': 'rate',
  'членств': 'membership',
  'транзакц': 'transaction',
  // Действия
  'созда': 'create',
  'дубли': 'duplicate',
  'добав': 'add',
  'удал': 'delete',
  'обнов': 'update',
  'получ': 'get',
  'най': 'find',
  'покажи': 'show',
  'список': 'list',
  'отправ': 'send',
  'сохран': 'save',
  'копи': 'copy',
};

/**
 * Пытается определить конкретный эндпоинт из запроса пользователя.
 * Переводит русские слова в английские API-термины для матчинга.
 * Если находит совпадение — возвращает {method, path, summary, ...}, иначе null.
 */
function detectEndpointFromQuery(message, endpoints) {
  if (!endpoints?.length) return null;

  const lowerMsg = message.toLowerCase();

  // Маппинг ключевых слов к HTTP методам
  const methodKeywords = {
    'POST': ['созда', 'create', 'add', 'добав', 'new', 'дубли', 'duplicate', 'отправ', 'сохран'],
    'GET': ['получ', 'get', 'най', 'show', 'list', 'список', 'покажи', 'найди'],
    'PUT': ['обнов', 'update', 'put', 'измени', 'изменить'],
    'PATCH': ['patch', 'патч'],
    'DELETE': ['удал', 'delete', 'remove', 'убери'],
  };

  let detectedMethod = null;
  for (const [method, keywords] of Object.entries(methodKeywords)) {
    if (keywords.some(kw => lowerMsg.includes(kw))) {
      detectedMethod = method;
      break;
    }
  }

  // Разбиваем запрос на слова (короткие слова >= 3 символов)
  const queryWords = lowerMsg.split(/[\s,;.!?]+/).filter(w => w.length > 2);

  // Расширяем слова переводами: "задачу" → "task", "создать" → "create"
  const expandedWords = new Set(queryWords);
  for (const word of queryWords) {
    for (const [ruStem, enWord] of Object.entries(RU_TO_EN)) {
      // Проверяем: слово начинается с русского ИЛИ русский корень начинается с слова
      if (word.startsWith(ruStem) || ruStem.startsWith(word.slice(0, Math.min(4, word.length)))) {
        expandedWords.add(enWord);
      }
    }
  }
  const expandedWordsArr = [...expandedWords];

  // Кандидаты: фильтруем по методу если определили
  let candidates = detectedMethod
    ? endpoints.filter(ep => ep.method === detectedMethod)
    : endpoints;

  let bestCandidate = null;
  let bestScore = 0;

  for (const ep of candidates) {
    let score = 0;
    const epText = `${ep.path} ${ep.summary} ${ep.description} ${ep.operationId}`.toLowerCase();

    // Проверка по расширенным словам
    for (const word of expandedWordsArr) {
      if (epText.includes(word)) {
        score += 2;
      }
    }

    // Бонус за совпадение в summary (высокий приоритет — это "человеческое" название метода)
    // "Create Meeting" должен предпочесть summary "Create a meeting" а не "Create a recording registrant"
    if (ep.summary) {
      const summaryLower = ep.summary.toLowerCase();
      let summaryMatches = 0;
      for (const word of expandedWordsArr) {
        if (summaryLower.includes(word)) {
          score += 3;
          summaryMatches++;
        }
      }
      // Бонус за совпадение ВСЕХ слов запроса в summary (точное попадание)
      if (summaryMatches >= expandedWordsArr.length && expandedWordsArr.length >= 2) {
        score += 10;
      }
      // Штраф за лишние слова в summary, которых нет в запросе
      // "Create a recording registrant" имеет "recording", "registrant" — лишние
      const summaryWords = summaryLower.split(/[\s,;.!?]+/).filter(w => w.length > 2);
      const extraWords = summaryWords.filter(w =>
        !expandedWordsArr.some(qw => w.includes(qw) || qw.includes(w)) && !['a', 'an', 'the', 'of', 'for', 'to', 'by', 'in', 'on'].includes(w)
      );
      score -= extraWords.length * 2;
    }

    // Бонус за совпадение в operationId (высокий приоритет)
    if (ep.operationId) {
      const opIdLower = ep.operationId.toLowerCase();
      for (const word of expandedWordsArr) {
        if (opIdLower.includes(word)) score += 5;
      }
    }

    // Бонус за совпадение path сегмента с расширенными словами
    const pathSegments = ep.path.split('/').filter(s => s && !s.startsWith('{'));
    for (const seg of pathSegments) {
      const segLower = seg.toLowerCase();
      for (const word of expandedWordsArr) {
        // Субстринг матчинг: "tasks" matches "task", "task" matches "tasks"
        if (segLower.includes(word) || word.includes(segLower)) {
          score += 5;
        }
      }
    }

    // Штраф за лишние path-сегменты без совпадения (длинный путь = менее точный эндпоинт)
    const unmatchedSegments = pathSegments.filter(seg => {
      const segLower = seg.toLowerCase();
      return !expandedWordsArr.some(w => segLower.includes(w) || w.includes(segLower));
    });
    score -= unmatchedSegments.length * 2;

    // Для POST: предпочитаем базовые эндпоинты (без path params)
    // POST /tasks лучше чем POST /tasks/{gid}/duplicate
    if (detectedMethod === 'POST') {
      const paramCount = (ep.path.match(/\{/g) || []).length;
      score -= paramCount * 3;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = ep;
    }
  }

  // Минимальный порог — хотя бы одно совпадение по расширенным словам
  if (bestScore >= 2 && bestCandidate) {
    return bestCandidate;
  }

  return null;
}

/**
 * POST /chat/message
 * Отправляет сообщение пользователя в AI-чат.
 *
 * Body:
 *   { sessionId, message, languages?: ["en", "ru"] }
 *
 * Response:
 *   { text, fields, rowSections, request }
 */
router.post('/message', async (req, res, next) => {
  try {
    const { sessionId, message, languages = ['en'], considerArrayPath = false } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId обязателен' });
    }
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'message обязателен' });
    }

    const session = getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Сессия не найдена или истекла' });
    }

    // Добавляем сообщение пользователя в историю
    addMessage(sessionId, 'user', message);

    // Определяем тип запроса для выбора количества чанков
    const lowerMsg = message.toLowerCase();
    let isFieldGeneration = /сгенерируй|генерируй|генерация|создай поля|обработай|поля для|fields for|generate|create fields|post |put |patch |delete |get |post\/|put\/|patch\/|добавить|добавлен|создать|создан|обновить|обновлен|удалить|удален|add-|create-|update-|edit-/.test(lowerMsg);
    const isBroadQuery = /какие|список|все |all |list|methods|эндпоинт|endpoint|перечисл|обзор|overview/.test(lowerMsg);

    // RAG с разным topK:
    // - Генерация полей: 40 чанков (нужна полная информация по эндпоинту + все вложенные схемы)
    // - Широкие вопросы ("какие методы"): 15 чанков
    // - Обычные вопросы: 8 чанков
    let ragChunks = null;
    let detectedEndpointSchema = null; // Для батчинга больших схем в chatAiClient
    if (session.useRag && session.docHash) {
      try {
        // Пытаемся определить конкретный эндпоинт из запроса ДО вычисления topK,
        // потому что пользователь может написать просто имя метода (например "Create Meeting")
        // без ключевых слов генерации — и тогда это тоже запрос на генерацию полей.
        let detectedEndpoint = null;
        if (session.docContent?.endpoints?.length > 0) {
          detectedEndpoint = detectEndpointFromQuery(message, session.docContent.endpoints);
          if (detectedEndpoint) {
            isFieldGeneration = true;
            logAiOperation('Message: обнаружен эндпоинт', {
              endpoint: `${detectedEndpoint.method} ${detectedEndpoint.path}`,
              summary: detectedEndpoint.summary,
            });
          }
        }

        const topK = isFieldGeneration ? 40 : isBroadQuery ? 15 : 8;
        const queryVector = await embedText(message);
        const searchResults = await searchChunks(session.docHash, queryVector, topK);

        // Всегда включаем вводные чанки (базовый URL, авторизация, общие правила).
        // introChunkIndex определяется при загрузке (чанк с URL-паттерном или "Общая информация").
        const introIdx = session.introChunkIndex ?? 0;
        const intro = await getIntroChunks(session.docHash, introIdx);
        const searchIds = new Set(searchResults.map(c => c.chunkIndex));
        const uniqueIntro = intro.filter(c => !searchIds.has(c.chunkIndex));

        // Если нашли конкретный эндпоинт — добавляем его контекст
        // Для POST/PUT/PATCH: только requestBody (не грузим AI лишним response ~29K символов)
        // Для GET: только responseSchema (это основной источник полей)
        let endpointContextChunks = [];
        // detectedEndpointSchema определена выше, за пределами try
        if (detectedEndpoint && session.docContent?.isOpenAPI) {
          const allEndpoints = session.docContent.endpoints;
          const matchedEp = allEndpoints.find(ep =>
            ep.method === detectedEndpoint.method && ep.path === detectedEndpoint.path
          );
          if (matchedEp) {
            const isWriteMethod = ['POST', 'PUT', 'PATCH'].includes(matchedEp.method);
            // Выбираем релевантную схему: requestBody для записи, response для чтения
            const primarySchema = isWriteMethod ? matchedEp.requestBody : matchedEp.responseSchema;
            const secondarySchema = isWriteMethod ? matchedEp.responseSchema : matchedEp.requestBody;

            let endpointText = `${matchedEp.method} ${matchedEp.path}`;
            if (matchedEp.summary) endpointText += ` — ${matchedEp.summary}`;
            endpointText += '\n';
            if (matchedEp.description) endpointText += `Description: ${matchedEp.description}\n`;
            if (matchedEp.parameters?.length > 0) {
              endpointText += 'Parameters:\n';
              for (const p of matchedEp.parameters) {
                endpointText += `  - ${p.name} (${p.in}, ${p.type || 'string'}${p.required ? ', required' : ''}): ${p.description || ''}\n`;
              }
            }
            if (primarySchema) {
              const label = isWriteMethod ? 'Request Body' : 'Response';
              endpointText += `${label}:\n  ${JSON.stringify(primarySchema, null, 2).replace(/\n/g, '\n  ')}\n`;
            }
            // Вторичную схему включаем только если она небольшая (<5000 символов)
            if (secondarySchema) {
              const secondaryJson = JSON.stringify(secondarySchema, null, 2);
              if (secondaryJson.length < 5000) {
                const label = isWriteMethod ? 'Response' : 'Request Body';
                endpointText += `${label}:\n  ${secondaryJson.replace(/\n/g, '\n  ')}\n`;
              }
            }

            endpointContextChunks = [{
              text: endpointText.trim(),
              endpoint: `${matchedEp.method} ${matchedEp.path}`,
              sectionTitle: matchedEp.summary || '',
              chunkIndex: -1, // Специальный чанк, не из векторного поиска
            }];

            // Сохраняем схему для батчинга в chatAiClient
            if (primarySchema && isFieldGeneration) {
              detectedEndpointSchema = {
                method: matchedEp.method,
                path: matchedEp.path,
                summary: matchedEp.summary || '',
                schema: primarySchema,
                parameters: matchedEp.parameters || [],
              };
            }
          }
        }

        // Подтягиваем все связанные фрагменты эндпоинта из векторного хранилища
        if (detectedEndpoint) {
          const endpointName = `${detectedEndpoint.method} ${detectedEndpoint.path}`;
          const relatedChunks = await getEndpointChunks(session.docHash, endpointName);
          if (relatedChunks.length > 0) {
            const existingIds = new Set([...searchResults.map(c => c.chunkIndex), ...uniqueIntro.map(c => c.chunkIndex)]);
            const newRelated = relatedChunks.filter(c => !existingIds.has(c.chunkIndex));
            searchResults.push(...newRelated);
            logAiOperation('Message: добавлены связанные чанки эндпоинта', {
              endpoint: endpointName,
              relatedTotal: relatedChunks.length,
              newAdded: newRelated.length,
            });
          }
        }

        ragChunks = [...endpointContextChunks, ...uniqueIntro, ...searchResults];

        logAiOperation('Message: RAG поиск', {
          chunks: ragChunks.length, topK,
          introAdded: uniqueIntro.length,
          endpointContextAdded: endpointContextChunks.length > 0,
          detectedEndpoint: detectedEndpoint ? `${detectedEndpoint.method} ${detectedEndpoint.path}` : null,
          mode: isFieldGeneration ? 'generation' : isBroadQuery ? 'broad' : 'conversational',
          docHash: session.docHash.slice(0, 8),
        });
      } catch (ragError) {
        logAiOperation('Message: RAG ошибка, fallback', { error: ragError.message });
      }
    }

    // Отправляем в AI (detectedEndpointSchema передаётся для батчинга больших схем)
    const result = await sendChatMessage(session, message, languages, { ragChunks, considerArrayPath: !!considerArrayPath, detectedEndpointSchema });

    // Добавляем ответ AI в историю
    addMessage(sessionId, 'assistant', result.text || JSON.stringify({ fields: result.fields, rowSections: result.rowSections }));

    // Если AI сгенерировал поля — сохраняем
    if (result.fields) {
      setLastResult(sessionId, {
        fields: result.fields,
        rowSections: result.rowSections || [],
        request: result.request,
      });
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /chat/session/:id
 * Возвращает состояние сессии: историю сообщений и последний результат.
 */
router.get('/session/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Сессия не найдена или истекла' });
  }

  res.json({
    sessionId: session.id,
    messages: session.messages,
    lastResult: session.lastResult,
    docSummary: session.docContent?.isOpenAPI
      ? `OpenAPI (${session.docContent.endpoints?.length || 0} эндпоинтов)`
      : `Документ (${session.docContent?.sourceType || 'unknown'})`,
  });
});

/**
 * DELETE /chat/session/:id
 * Удаляет сессию.
 */
router.delete('/session/:id', (req, res) => {
  const deleted = deleteSession(req.params.id);
  res.json({ success: deleted });
});

export default router;
