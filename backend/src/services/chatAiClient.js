/**
 * AI-логика для чата с документацией.
 *
 * Использует OpenAI клиент из aiClient.js и правила формата полей из getInstructionPrompt().
 * Поддерживает два режима:
 * 1. Разговорный — AI отвечает текстом (описание эндпоинтов, уточняющие вопросы)
 * 2. Генерация полей — AI возвращает JSON { fields, rowSections } по запросу пользователя
 */

import { getOpenAIClient, getInstructionPrompt, getFieldsOnlyPrompt, generateJsonFromPrompt, detectCommonDateFormatFromText } from './aiClient.js';
import { logAiOperation } from '../middleware/logger.js';

const MODEL = 'gpt-4o-mini';
const MAX_DOC_CHARS = 80000; // Макс. длина контекста документации
const CHAT_BATCH_SIZE = 40; // Макс. листовых полей до батчинга (аналог FIELDS_BATCH_SIZE в aiClient)

/**
 * Извлекает информацию о базовом URL API из текста документации.
 * Ищет паттерны: "https://...api/...", "Base URL:", серверные URL и т.д.
 * @param {string} rawText
 * @returns {string|null}
 */
function extractBaseUrlInfo(rawText) {
  if (!rawText) return null;

  // Ищем строки с URL-паттернами API (первые 15000 символов — вводная часть)
  const intro = rawText.slice(0, 15000);
  const lines = intro.split('\n');
  const urlLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // URL с доменом и /api/ паттерном
    if (/https?:\/\/.*\/api\//i.test(trimmed) && trimmed.length < 300) {
      urlLines.push(trimmed);
    }
    // "Base URL" / "API URL" / "Endpoint" паттерны
    if (/(?:base\s*url|api\s*url|server|endpoint|обращени.*api|адрес)/i.test(trimmed) && trimmed.length < 300) {
      urlLines.push(trimmed);
    }
  }

  if (urlLines.length === 0) return null;

  // Убираем дубликаты и берём первые 5 строк
  const unique = [...new Set(urlLines)].slice(0, 5);
  return unique.join('\n');
}

/**
 * Строит системный промпт для чат-сессии
 * @param {Object} docContent - Распарсенный контент документации (из docParser)
 * @param {string[]} languages - Языки для генерации полей
 * @returns {string}
 */
function buildSystemPrompt(docContent, languages = ['en']) {
  const instructionPrompt = getInstructionPrompt(languages);

  // Обрезаем документацию если слишком длинная
  let docText = docContent.rawText || '';
  if (docText.length > MAX_DOC_CHARS) {
    docText = docText.substring(0, MAX_DOC_CHARS) + '\n\n[... документация обрезана из-за объёма ...]';
  }

  return `Ты — помощник по анализу API документации и генерации полей для платформы Albato.

## Твои возможности:
1. Анализировать загруженную API документацию
2. Отвечать на вопросы о доступных эндпоинтах и их параметрах
3. Генерировать поля в формате Albato для конкретных методов API

## Режимы работы:

### Режим 1: Разговорный
Когда пользователь спрашивает об API, перечисляет эндпоинты, просит разъяснений — отвечай обычным текстом. Будь кратким и информативным.

### Режим 2: Генерация полей
Когда пользователь просит сгенерировать/создать/обработать поля для конкретного метода API — верни СТРОГО ВАЛИДНЫЙ JSON-объект.

ВАЖНО о формате ответа при генерации:
- Верни JSON объект с ключами "fields" и "rowSections" (и опционально "request", "pathToArray")
- НЕ оборачивай JSON в markdown code blocks
- НЕ добавляй текст до или после JSON
- Ответ должен быть ТОЛЬКО валидным JSON

## Правила определения isEditable:
- Методы POST/PUT/PATCH (создание/обновление) → isEditable: true
- Методы GET/поиск/получение → isEditable: false
- Если пользователь явно укажет — следуй его инструкции

## Формат полей Albato:
${instructionPrompt}

## Загруженная API документация:
${docText}

## Инструкции:
- Если пользователь пишет имя метода (например "Создать контакт" или "POST /contacts") — сгенерируй поля
- Если пользователь просит список методов — перечисли доступные эндпоинты
- Анализируй разделы "Request parameters", "Body Params", "Response" и т.д.
- Пустые массивы и объекты не обрабатывай
- Кастомные поля (customFields, cfs и т.д.) — игнорируй`;
}

/**
 * Строит системный промпт для RAG-режима (только релевантные чанки)
 * @param {Array<{text: string, endpoint?: string, sectionTitle?: string}>} chunks
 * @param {Object} docContent - Полный контент документа (для метаданных)
 * @param {string[]} languages
 * @returns {string}
 */
function buildRagSystemPrompt(chunks, docContent, languages = ['en']) {
  const instructionPrompt = getInstructionPrompt(languages);

  // Форматируем чанки
  const chunksText = chunks.map((chunk, i) => {
    let header = `--- Фрагмент ${i + 1}`;
    if (chunk.endpoint) header += ` (${chunk.endpoint})`;
    else if (chunk.sectionTitle) header += ` — ${chunk.sectionTitle}`;
    header += ' ---';
    return `${header}\n${chunk.text}`;
  }).join('\n\n');

  // Сводка по документу (тип + количество эндпоинтов если OpenAPI)
  let docMeta = `Тип документа: ${docContent.sourceType || 'unknown'}`;
  if (docContent.isOpenAPI && docContent.endpoints?.length) {
    docMeta += `. Всего эндпоинтов в документации: ${docContent.endpoints.length}`;
    docMeta += `.\nСписок всех эндпоинтов:\n`;
    docMeta += docContent.endpoints.map(ep =>
      `  - ${ep.method} ${ep.path}${ep.summary ? ` — ${ep.summary}` : ''}`
    ).join('\n');
  }

  // Извлекаем базовый URL из документации (если есть)
  const baseUrlInfo = extractBaseUrlInfo(docContent.rawText);

  return `Ты — помощник по анализу API документации и генерации полей для платформы Albato.

## Твои возможности:
1. Анализировать загруженную API документацию
2. Отвечать на вопросы о доступных эндпоинтах и их параметрах
3. Генерировать поля в формате Albato для конкретных методов API

## Режимы работы:

### Режим 1: Разговорный
Когда пользователь спрашивает об API, перечисляет эндпоинты, просит разъяснений — отвечай обычным текстом. Будь кратким и информативным.

### Режим 2: Генерация полей
Когда пользователь просит сгенерировать/создать/обработать поля для конкретного метода API — верни СТРОГО ВАЛИДНЫЙ JSON-объект.

ВАЖНО о формате ответа при генерации:
- Верни JSON объект с ключами "fields" и "rowSections" (и опционально "request", "pathToArray")
- НЕ оборачивай JSON в markdown code blocks
- НЕ добавляй текст до или после JSON
- Ответ должен быть ТОЛЬКО валидным JSON

## Правила определения isEditable:
- Методы POST/PUT/PATCH (создание/обновление) → isEditable: true
- Методы GET/поиск/получение → isEditable: false
- Если пользователь явно укажет — следуй его инструкции

## Формат полей Albato:
${instructionPrompt}

## ${docMeta}
${baseUrlInfo ? `\n## Базовый URL API:\n${baseUrlInfo}\nВАЖНО: При генерации request.data.url используй этот базовый URL + путь метода. Не сокращай до относительного пути.\n` : ''}
## Релевантные фрагменты API документации:

${chunksText}

## Инструкции:
- Ты видишь наиболее релевантные разделы документации, не всю документацию целиком
- Фрагменты с заголовком "--- Фрагмент N (METHOD /path) ---" содержат ПОЛНУЮ информацию об эндпоинте — используй их в приоритете
- Если пользователь пишет имя метода (например "Создать контакт" или "POST /contacts") — сгенерируй поля
- Если пользователь просит список методов — используй список эндпоинтов выше
- При генерации полей ВСЕГДА анализируй структуру "Request Body" — это ключевой источник полей для создания/обновления
- Если в Request Body есть объект "data" с вложенными полями — создавай поля на основе ВСЕХ его свойств
- Обращай внимание на массивы объектов — они идут в rowSections, а не в fields
- Если информации во фрагментах недостаточно для ответа — скажи об этом
- Пустые массивы и объекты не обрабатывай
- Кастомные поля (customFields, cfs и т.д.) — игнорируй`;
}

/**
 * Подсчитывает количество листовых свойств в упрощённой схеме (результат simplifySchema).
 * Рекурсивно считает конечные поля, не включая промежуточные объекты.
 * @param {any} schema - Упрощённая схема
 * @param {number} depth - Текущая глубина (защита от бесконечной рекурсии)
 * @returns {number}
 */
function countSchemaLeaves(schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 15) return 0;
  if (Array.isArray(schema)) {
    return schema.length > 0 ? countSchemaLeaves(schema[0], depth + 1) : 0;
  }
  let count = 0;
  for (const [, value] of Object.entries(schema)) {
    if (typeof value === 'string') {
      count++;
    } else if (Array.isArray(value)) {
      count++; // Массив считается как одно rowSection-поле
    } else if (typeof value === 'object' && value !== null) {
      count += countSchemaLeaves(value, depth + 1);
    }
  }
  return count;
}

/**
 * Рекурсивно уплощает упрощённую схему в плоский словарь {code: value}.
 * Аналог flattenJsonForBatch из aiClient.js, но для упрощённых схем (simplifySchema output).
 * @param {Object} schema - Упрощённая схема
 * @param {string} prefix - Накопленный префикс через "__"
 * @returns {Object} - {code: value}
 */
function flattenSchemaForBatch(schema, prefix = '') {
  const result = {};
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return result;
  for (const [key, value] of Object.entries(schema)) {
    const sanitizedKey = key.replace(/[ -]/g, '_');
    const code = prefix ? `${prefix}__${sanitizedKey}` : sanitizedKey;
    if (typeof value === 'string') {
      result[code] = value;
    } else if (Array.isArray(value)) {
      // Массив объектов — оставляем как лист (AI сделает rowSection)
      result[code] = value;
    } else if (typeof value === 'object' && value !== null) {
      Object.assign(result, flattenSchemaForBatch(value, code));
    }
  }
  return result;
}

/**
 * Батч-генерация полей для больших схем эндпоинтов.
 * Разбивает схему на батчи по CHAT_BATCH_SIZE, отправляет параллельно, мержит результаты.
 * @param {Object} endpointSchema - {method, path, summary, schema, parameters}
 * @param {string[]} languages
 * @param {Object} options
 * @returns {Promise<{text: string, fields: Array, rowSections: Array, request: Object|null}>}
 */
async function batchGenerateFromSchema(endpointSchema, languages, { signal, docContent } = {}) {
  const { method, path, summary, schema, parameters } = endpointSchema;
  const flatSchema = flattenSchemaForBatch(schema);
  const allKeys = Object.keys(flatSchema);
  const totalBatches = Math.ceil(allKeys.length / CHAT_BATCH_SIZE);

  logAiOperation('Chat batch: старт', {
    endpoint: `${method} ${path}`,
    totalLeaves: allKeys.length,
    batches: totalBatches,
  });

  // Формируем заголовок эндпоинта (общий для всех батчей)
  let endpointHeader = `API Endpoint: ${method} ${path}`;
  if (summary) endpointHeader += ` — ${summary}`;
  endpointHeader += '\n';
  if (parameters?.length > 0) {
    endpointHeader += 'Parameters:\n';
    for (const p of parameters) {
      endpointHeader += `  - ${p.name} (${p.in}, ${p.type || 'string'}${p.required ? ', required' : ''}): ${p.description || ''}\n`;
    }
  }

  const isWriteMethod = ['POST', 'PUT', 'PATCH'].includes(method);
  const isEditableStr = isWriteMethod ? 'true' : 'false';

  // Формируем батчи
  const batches = [];
  for (let i = 0; i < allKeys.length; i += CHAT_BATCH_SIZE) {
    const batchIndex = Math.floor(i / CHAT_BATCH_SIZE) + 1;
    const batchKeys = allKeys.slice(i, i + CHAT_BATCH_SIZE);
    const batchSchema = {};
    batchKeys.forEach(k => { batchSchema[k] = flatSchema[k]; });

    // Разделяем: обычные поля vs массивы объектов (rowSections)
    const arrayOfObjectKeys = batchKeys.filter(k => {
      const v = flatSchema[k];
      return Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null;
    });
    const regularKeys = batchKeys.filter(k => !arrayOfObjectKeys.includes(k));

    const allowedCodesLine = regularKeys.length > 0
      ? `РАЗРЕШЁННЫЕ КОДЫ для полей (используй ТОЛЬКО эти, точно как написано): ${regularKeys.join(', ')}`
      : '';
    const arrayCodesLine = arrayOfObjectKeys.length > 0
      ? `МАССИВЫ ОБЪЕКТОВ → rowSections: ${arrayOfObjectKeys.join(', ')}`
      : '';
    const constraintLines = [allowedCodesLine, arrayCodesLine].filter(Boolean).join('\n');

    const batchPrompt = `${endpointHeader}\nСхема полей (batch ${batchIndex}/${totalBatches}):\n${JSON.stringify(batchSchema, null, 2)}\n\n${constraintLines}\nВсе поля должны иметь isEditable: ${isEditableStr}\n\n${getFieldsOnlyPrompt(languages)}`;

    batches.push({ batchIndex, batchPrompt });
  }

  // Параллельная генерация
  const batchResults = await Promise.all(
    batches.map(({ batchIndex, batchPrompt }) =>
      generateJsonFromPrompt(batchPrompt, MODEL, { signal })
        .then(res => {
          logAiOperation(`Chat batch ${batchIndex}/${totalBatches}`, {
            fields: res.fields?.length || 0,
            rowSections: res.rowSections?.length || 0,
          });
          return res;
        })
        .catch(e => {
          logAiOperation(`Chat batch ${batchIndex}/${totalBatches} ошибка`, { error: e.message });
          return { fields: [], rowSections: [] };
        })
    )
  );

  // Мержим результаты
  const allFields = batchResults.flatMap(r => r.fields || []);
  const allRowSections = batchResults.flatMap(r => r.rowSections || []);

  // Дедупликация по кодам
  const seenCodes = new Set();
  const dedupedFields = allFields.filter(f => {
    const code = f.data?.code;
    if (!code || seenCodes.has(code)) return false;
    seenCodes.add(code);
    return true;
  });

  logAiOperation('Chat batch: результат', {
    endpoint: `${method} ${path}`,
    totalFields: dedupedFields.length,
    totalRowSections: allRowSections.length,
    duplicatesRemoved: allFields.length - dedupedFields.length,
  });

  // Строим request из метаданных эндпоинта
  const methodMap = { GET: 0, POST: 1, PUT: 2, DELETE: 3, PATCH: 4 };
  const methodNum = methodMap[method] ?? 1;

  // Извлекаем baseUrl из docContent (установлен в docParser при парсинге OpenAPI)
  const baseUrl = docContent?.baseUrl || '';
  const fullUrl = baseUrl ? `${baseUrl}${path}` : path;

  // Формируем request.fields из сгенерированных полей (маппинг code → key)
  const requestFields = dedupedFields.map(f => {
    const code = f.data?.code;
    if (!code) return null;
    const key = code.replace(/__/g, '.');
    const field = {
      data: {
        key,
        value: `{{data.${code}}}`,
        valueType: f.data?.valueType || 1,
        required: f.data?.required || false,
        defaultValue: '',
        formatCfg: f.data?.valueType === 5 ? { format: 'Y-m-d\\TH:i:s\\Z', timezone: '+0000', valueType: 1 }
          : f.data?.valueType === 8 ? { format: 'Y-m-d', timezone: '+0000', valueType: 1 }
          : { valueType: f.data?.valueType || 1 },
      },
    };
    return field;
  }).filter(Boolean);

  // Формируем request.fields для rowSections
  for (const section of allRowSections) {
    const sectionCode = section.data?.code;
    if (!sectionCode) continue;
    const parentKey = sectionCode.replace(/__/g, '.');
    const children = (section.fields || []).map(f => {
      const code = f.data?.code;
      if (!code) return null;
      const childKey = code.replace(/__/g, '.').replace(new RegExp(`^${parentKey}\\.`), '');
      return {
        data: {
          key: childKey,
          value: `{{data.${code}}}`,
          valueType: f.data?.valueType || 1,
          required: f.data?.required || false,
          defaultValue: '',
          formatCfg: { valueType: f.data?.valueType || 1 },
        },
      };
    }).filter(Boolean);

    requestFields.push({
      data: {
        key: parentKey,
        value: '',
        valueType: 99,
        required: false,
        defaultValue: '',
        formatCfg: { valueType: 99 },
      },
      children,
    });
  }

  return {
    text: 'Поля сгенерированы.',
    fields: dedupedFields,
    rowSections: allRowSections,
    request: {
      data: { url: fullUrl, method: methodNum, format: 0, content: '', urlEncodeType: 0, filter: [], filterType: 2, preScript: '', postScript: '', apiDocUrl: '' },
      fields: requestFields,
      headers: [],
      response: { data: { format: 0, pathToArray: null, filter: [], useRequestData: 0, preScript: '', postScript: '' }, fields: [], headers: [], statusHandlers: [] },
    },
  };
}

/**
 * Отправляет сообщение в AI-чат и возвращает ответ
 * @param {Object} session - Сессия из chatSessionStore
 * @param {string} userMessage - Сообщение пользователя
 * @param {string[]} languages - Языки для генерации
 * @param {Object} options - Дополнительные опции
 * @param {AbortSignal} [options.signal] - Сигнал отмены
 * @returns {Promise<{text: string, fields: Array|null, rowSections: Array|null}>}
 */
export async function sendChatMessage(session, userMessage, languages = ['en'], { signal, ragChunks, considerArrayPath = false, detectedEndpointSchema = null } = {}) {
  const openai = getOpenAIClient();
  if (!openai) {
    throw new Error('OpenAI API ключ не настроен. Установите переменную окружения OPENAI_API_KEY.');
  }

  // Батч-генерация: если передана большая схема эндпоинта (>CHAT_BATCH_SIZE листовых полей),
  // разбиваем на параллельные батчи вместо одного большого запроса
  if (detectedEndpointSchema) {
    const leafCount = countSchemaLeaves(detectedEndpointSchema.schema);
    if (leafCount > CHAT_BATCH_SIZE) {
      logAiOperation('Chat: переключение на батч-генерацию', {
        endpoint: `${detectedEndpointSchema.method} ${detectedEndpointSchema.path}`,
        leafCount,
        batchSize: CHAT_BATCH_SIZE,
      });
      const batchResult = await batchGenerateFromSchema(detectedEndpointSchema, languages, { signal, docContent: session.docContent });
      ensureRequestFieldsFormatCfg(batchResult, session.docContent?.rawText);
      return batchResult;
    }
  }

  // RAG-режим: используем только релевантные чанки вместо полного документа
  const systemPrompt = (ragChunks && ragChunks.length > 0)
    ? buildRagSystemPrompt(ragChunks, session.docContent, languages)
    : buildSystemPrompt(session.docContent, languages);

  // Строим массив сообщений: system + история + новое сообщение
  const messages = [
    { role: 'system', content: systemPrompt },
  ];

  // Добавляем историю (ограничиваем последними 20 сообщениями чтобы не превысить контекст)
  const history = session.messages.slice(-20);
  for (const msg of history) {
    messages.push({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
    });
  }

  // Добавляем новое сообщение пользователя (с доп. инструкцией pathToArray если нужно)
  let finalUserMessage = userMessage;
  if (considerArrayPath) {
    finalUserMessage += `\n\nДОПОЛНИТЕЛЬНО (режим pathToArray):
1. Проанализируй структуру ОТВЕТА (response) этого API-метода и определи путь к массиву данных. Добавь в JSON-ответ ключ "pathToArray" со значением:
   - dot-notation путь к массиву объектов в response (например "data", "result.items", "response.records")
   - пустая строка "" если сам ответ является массивом объектов (корневой массив)
   - null если в ответе нет массива объектов
   Пример: если response имеет структуру { message: "OK", count: 10, data: [{ id: 1, name: "..." }] }, то pathToArray = "data".

2. ВАЖНО — источник полей: Генерируй поля (fields[]) на основе ПОЛЕЙ ОТВЕТА (response body), а именно на основе свойств объектов ВНУТРИ массива данных (pathToArray). Параметры запроса (query params, headers) НЕ включай в fields[]. Все сгенерированные поля должны иметь isEditable: false (это данные ответа, а не вводимые параметры).
   Пример: если response содержит data: [{ Id: 0, Name: "string", Email: "string" }], генерируй поля Id, Name, Email — а НЕ query-параметры limit, page, sort, filter.`;
  }
  messages.push({ role: 'user', content: finalUserMessage });

  logAiOperation('Chat: запрос к AI', {
    model: MODEL,
    messagesCount: messages.length,
    userMessageLength: userMessage.length,
    mode: (ragChunks && ragChunks.length > 0) ? 'RAG' : 'full-doc',
  });

  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages,
      temperature: 0.3,
      max_tokens: 16384,
    }, { signal });

    logAiOperation('Chat: ответ от AI', {
      model: MODEL,
      tokensUsed: response.usage?.total_tokens,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('AI не вернул содержимое в ответе');
    }

    // Пытаемся определить, содержит ли ответ JSON с полями
    const parsed = tryExtractFieldsJson(content);

    if (parsed) {
      ensureRequestFieldsFormatCfg(parsed, session.docContent?.rawText);

      // Извлекаем pathToArray если AI его вернул
      let detectedPathToArray = null;
      if (considerArrayPath && 'pathToArray' in parsed) {
        detectedPathToArray = (typeof parsed.pathToArray === 'string') ? parsed.pathToArray : null;
      }

      return {
        text: 'Поля сгенерированы.',
        fields: parsed.fields || [],
        rowSections: parsed.rowSections || [],
        request: parsed.request || null,
        pathToArray: detectedPathToArray,
      };
    }

    // Разговорный ответ
    return {
      text: content,
      fields: null,
      rowSections: null,
      request: null,
    };
  } catch (error) {
    logAiOperation('Chat: ошибка AI', { error: error.message });

    if (error.name === 'AbortError') {
      throw new Error('Запрос отменён пользователем');
    }

    throw error;
  }
}

/**
 * Пытается извлечь JSON с полями из ответа AI.
 * AI может вернуть чистый JSON или JSON внутри markdown code block.
 * @param {string} content - Ответ AI
 * @returns {Object|null} - {fields, rowSections} или null
 */
function tryExtractFieldsJson(content) {
  const trimmed = content.trim();

  // Попытка 1: весь ответ — это JSON
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (hasFieldsStructure(parsed)) return parsed;
    } catch (e) {
      // Не валидный JSON — пробуем другие варианты
    }
  }

  // Попытка 2: JSON внутри markdown code block
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (hasFieldsStructure(parsed)) return parsed;
    } catch (e) {
      // Не валидный JSON
    }
  }

  // Попытка 3: найти первый JSON-объект в тексте
  const jsonMatch = trimmed.match(/\{[\s\S]*"fields"\s*:\s*\[[\s\S]*\]/);
  if (jsonMatch) {
    // Ищем конец JSON — баланс скобок
    let depth = 0;
    let start = trimmed.indexOf(jsonMatch[0]);
    for (let i = start; i < trimmed.length; i++) {
      if (trimmed[i] === '{') depth++;
      else if (trimmed[i] === '}') {
        depth--;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(trimmed.substring(start, i + 1));
            if (hasFieldsStructure(parsed)) return parsed;
          } catch (e) {
            // Продолжаем
          }
          break;
        }
      }
    }
  }

  return null;
}

/**
 * Проверяет, содержит ли объект структуру полей Albato
 */
function hasFieldsStructure(obj) {
  return obj && typeof obj === 'object' && Array.isArray(obj.fields);
}

/**
 * Гарантирует корректность formatCfg для DateTime/Date полей.
 *
 * 1. Фиксит существующие request.fields (неполный formatCfg, дефолтный формат).
 * 2. Для ВСЕХ DateTime/Date полей из parsed.fields, у которых нет записи
 *    в request.fields — создаёт запись с правильным formatCfg.
 *    Это нужно потому что фронт (rebuildRequestFields) берёт formatCfg
 *    из существующих request.fields по коду, и если записи нет — ставит хардкод-дефолт.
 *
 * Если передан rawText документации — детектирует реальный формат дат из примеров.
 * @param {Object} parsed - Распарсенный ответ AI с полями
 * @param {string} [rawText] - Сырой текст документации для детекции формата дат
 */
function ensureRequestFieldsFormatCfg(parsed, rawText) {
  if (!parsed) return parsed;

  // Инициализируем request если нет
  if (!parsed.request) parsed.request = {};
  if (!parsed.request.fields) parsed.request.fields = [];

  // Детектируем реальный формат из документации (если есть)
  const detectedDateTimeCfg = rawText ? detectCommonDateFormatFromText(rawText) : null;

  const DATE_DEFAULTS = {
    5: detectedDateTimeCfg || { format: 'Y-m-d H:i:s', timezone: '+0000', valueType: 1 },
    8: { format: 'Y-m-d', timezone: '+0000', valueType: 1 },
  };

  const GENERIC_DATETIME_FORMATS = new Set(['Y-m-d H:i:s', 'Y-m-d\\TH:i:s']);

  // --- Шаг 1: фиксим существующие request.fields ---
  function fixField(field) {
    const vt = field.data?.valueType;
    const cfg = field.data?.formatCfg;
    const defaults = DATE_DEFAULTS[vt];
    if (defaults) {
      if (!cfg) {
        field.data.formatCfg = { ...defaults };
      } else if (!cfg.format || !cfg.timezone) {
        field.data.formatCfg = { ...defaults, ...cfg, format: cfg.format || defaults.format, timezone: cfg.timezone || defaults.timezone };
      } else if (detectedDateTimeCfg && vt === 5 && GENERIC_DATETIME_FORMATS.has(cfg.format)) {
        field.data.formatCfg = { ...detectedDateTimeCfg };
      }
    }
    (field.children || []).forEach(fixField);
  }
  parsed.request.fields.forEach(fixField);

  // --- Шаг 2: для DateTime/Date полей из fields[] без записи в request.fields — создаём ---
  // Собираем коды уже присутствующих request.fields
  const existingCodes = new Set();
  for (const rf of parsed.request.fields) {
    const m = rf.data?.value?.match(/^\{\{data\.(.+)\}\}$/);
    if (m) existingCodes.add(m[1]);
  }

  let added = 0;
  for (const field of (parsed.fields || [])) {
    const code = field.data?.code;
    const vt = field.data?.valueType;
    if (!code || !vt) continue;
    if (existingCodes.has(code)) continue;

    const formatCfg = DATE_DEFAULTS[vt];
    if (!formatCfg) continue; // не DateTime/Date — пропускаем

    // Создаём запись в request.fields чтобы фронт подхватил formatCfg
    const key = code.replace(/__/g, '.');
    parsed.request.fields.push({
      data: {
        key,
        value: `{{data.${code}}}`,
        valueType: vt,
        required: false,
        defaultValue: '',
        formatCfg: { ...formatCfg },
      },
    });
    added++;
  }

  // То же для rowSections children
  for (const section of (parsed.rowSections || [])) {
    for (const field of (section.fields || [])) {
      const code = field.data?.code;
      const vt = field.data?.valueType;
      if (!code || !vt) continue;
      const formatCfg = DATE_DEFAULTS[vt];
      if (!formatCfg) continue;
      // Эти будут подхвачены через childFormatCfgByPath на фронте — нужно чтобы
      // они были в children соответствующего type-99 request.field
      // (это уже обрабатывается в шаге 1 если AI их создал)
    }
  }

  return parsed;
}
