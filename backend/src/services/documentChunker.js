/**
 * Разбивка API документации на чанки для векторного хранилища.
 *
 * OpenAPI: один чанк = один эндпоинт.
 * Прочие: разбивка по абзацам (~800 токенов / ~3200 символов).
 *
 * Лимит OpenAI Embeddings: 8192 токенов на input[].
 * ~1 токен ≈ 4 символа, значит лимит ~32768 символов.
 * Используем безопасный лимит 20000 символов для доп. разбиения.
 */

const TARGET_CHUNK_CHARS = 3200;
const OVERLAP_CHARS = 800;
const MAX_CHUNK_CHARS = 20000; // Максимальная длина чанка перед доп. разбиением

/**
 * Разбивает документ на чанки в зависимости от типа
 * @param {Object} docContent - результат docParser: { rawText, isOpenAPI, endpoints, sourceType }
 * @returns {Array<{text: string, chunkIndex: number, endpoint?: string, sectionTitle?: string}>}
 */
export function chunkDocument(docContent) {
  if (docContent.isOpenAPI && docContent.endpoints?.length > 0) {
    return chunkOpenAPI(docContent);
  }
  return chunkGenericText(docContent.rawText);
}

/**
 * Дополнительное разбиение слишком больших чанков.
 * Используется перед отправкой в OpenAI Embeddings.
 * @param {Array<{text: string, chunkIndex: number, endpoint?: string, sectionTitle?: string}>} chunks
 * @returns {Array<{text: string, chunkIndex: number, endpoint?: string, sectionTitle?: string}>}
 */
export function splitLargeChunks(chunks) {
  const result = [];
  let newIndex = 0;

  for (const chunk of chunks) {
    if (chunk.text.length <= MAX_CHUNK_CHARS) {
      result.push({ ...chunk, chunkIndex: newIndex++ });
      continue;
    }

    // Разбиваем большой чанк на части
    const subChunks = splitLargeText(chunk.text, chunk.endpoint, chunk.sectionTitle);
    for (const sub of subChunks) {
      result.push({
        text: sub.text,
        chunkIndex: newIndex++,
        endpoint: chunk.endpoint,
        sectionTitle: chunk.sectionTitle,
      });
    }
  }

  return result;
}

/**
 * Разбивает длинный текст на части с сохранением смысла
 */
function splitLargeText(text, endpoint, sectionTitle) {
  const parts = [];
  let remaining = text;

  while (remaining.length > MAX_CHUNK_CHARS) {
    const searchWindow = remaining.slice(0, MAX_CHUNK_CHARS);
    let splitIdx = -1;

    // Ищем конец предложения (. ! ?)
    const sentenceMatch = searchWindow.match(/(.{500,}[.!?])\s/);
    if (sentenceMatch) {
      splitIdx = sentenceMatch.index + sentenceMatch[1].length;
    } else {
      // Ищем конец строки в JSON (для OpenAPI схем)
      const lineMatch = searchWindow.match(/(.+\n)(?=[\s"]*(?:[A-Za-z]|$))/g);
      if (lineMatch) {
        const lastLine = lineMatch[lineMatch.length - 1];
        const lineIdx = searchWindow.lastIndexOf(lastLine);
        if (lineIdx > MAX_CHUNK_CHARS * 0.5) {
          splitIdx = lineIdx + lastLine.length;
        }
      }
    }

    // Если не нашли — ищем последний пробел
    if (splitIdx <= 0) {
      const lastSpace = searchWindow.lastIndexOf(' ');
      if (lastSpace > MAX_CHUNK_CHARS * 0.5) {
        splitIdx = lastSpace;
      }
    }

    // Режем жёстко
    if (splitIdx <= 0) {
      splitIdx = MAX_CHUNK_CHARS;
    }

    parts.push({
      text: remaining.slice(0, splitIdx).trim(),
      endpoint,
      sectionTitle,
    });
    remaining = remaining.slice(splitIdx).trim();
  }

  if (remaining.length > 0) {
    parts.push({
      text: remaining.trim(),
      endpoint,
      sectionTitle,
    });
  }

  return parts;
}

/**
 * OpenAPI: один чанк на эндпоинт
 */
function chunkOpenAPI(docContent) {
  const info = extractOpenAPIInfo(docContent.rawText);
  const chunks = [];

  docContent.endpoints.forEach((ep, index) => {
    let text = '';
    if (info) text += `API: ${info}\n\n`;
    text += `${ep.method} ${ep.path}`;
    if (ep.summary) text += ` — ${ep.summary}`;
    text += '\n';
    if (ep.description) text += `Description: ${ep.description}\n`;
    if (ep.parameters?.length > 0) {
      text += 'Parameters:\n';
      for (const p of ep.parameters) {
        text += `  - ${p.name} (${p.in}, ${p.type || 'string'}${p.required ? ', required' : ''}): ${p.description || ''}\n`;
      }
    }
    if (ep.requestBody) {
      text += `Request Body:\n  ${JSON.stringify(ep.requestBody, null, 2).replace(/\n/g, '\n  ')}\n`;
    }
    if (ep.responseSchema) {
      text += `Response:\n  ${JSON.stringify(ep.responseSchema, null, 2).replace(/\n/g, '\n  ')}\n`;
    }

    chunks.push({
      text: text.trim(),
      chunkIndex: index,
      endpoint: `${ep.method} ${ep.path}`,
      sectionTitle: ep.summary || '',
    });
  });

  return chunks;
}

/**
 * Извлекает строку с названием и версией API из rawText
 */
function extractOpenAPIInfo(rawText) {
  const match = rawText.match(/^API:\s*(.+)\nVersion:\s*(.+)/m);
  if (match) return `${match[1]} v${match[2]}`;
  return null;
}

/**
 * Генерик-чанкинг для PDF, текста и т.д.
 * Разбивает по абзацам, учитывает заголовки, целевой размер ~3200 символов.
 */
function chunkGenericText(rawText) {
  if (!rawText || rawText.length === 0) return [];

  // Разбиваем на параграфы
  const paragraphs = rawText.split(/\n{2,}/);
  const chunks = [];
  let currentText = '';
  let currentTitle = '';
  let chunkIndex = 0;

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // Определяем заголовок
    const isHeading = isLikelyHeading(trimmed);
    if (isHeading) {
      currentTitle = trimmed.slice(0, 100);
    }

    // Если заголовок и текущий чанк не пустой — сбрасываем
    if (isHeading && currentText.length > OVERLAP_CHARS) {
      chunks.push({
        text: currentText.trim(),
        chunkIndex: chunkIndex++,
        sectionTitle: currentTitle,
      });
      // Перекрытие: оставляем хвост
      currentText = currentText.slice(-OVERLAP_CHARS) + '\n\n';
    }

    currentText += trimmed + '\n\n';

    // Если превысили целевой размер — сбрасываем
    if (currentText.length >= TARGET_CHUNK_CHARS) {
      chunks.push({
        text: currentText.trim(),
        chunkIndex: chunkIndex++,
        sectionTitle: currentTitle,
      });
      currentText = currentText.slice(-OVERLAP_CHARS) + '\n\n';
    }
  }

  // Оставшийся текст
  if (currentText.trim().length > 50) {
    chunks.push({
      text: currentText.trim(),
      chunkIndex: chunkIndex++,
      sectionTitle: currentTitle,
    });
  }

  return chunks;
}

/**
 * Эвристика: строка выглядит как заголовок?
 */
function isLikelyHeading(line) {
  if (line.startsWith('#')) return true;
  if (line.length < 80 && /^[A-ZА-ЯЁ][A-ZА-ЯЁ\s\d]{3,}$/.test(line)) return true; // ALL CAPS
  if (line.length < 100 && /^[\d]+[.)]\s+/.test(line)) return true; // "1. Title" or "1) Title"
  if (line.length < 100 && line.endsWith(':') && !line.includes('.')) return true; // "Section name:"
  // Markdown-подобные паттерны из PDF (--- разделители страниц)
  if (/^-{2,}\s*\d+\s*(of|из)\s*\d+\s*-{2,}$/i.test(line)) return true;
  return false;
}
