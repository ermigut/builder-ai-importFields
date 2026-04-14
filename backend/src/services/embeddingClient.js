/**
 * Обёртка над OpenAI Embeddings API.
 * Использует модель text-embedding-3-small (1536 dims).
 */

import { getOpenAIClient } from './aiClient.js';
import { logAiOperation } from '../middleware/logger.js';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const BATCH_SIZE = 100; // Максимум текстов за один запрос к OpenAI

/**
 * Генерирует эмбеддинг для одного текста
 * @param {string} text
 * @returns {Promise<Float32Array>}
 */
export async function embedText(text) {
  const [vector] = await embedBatch([text]);
  return vector;
}

/**
 * Генерирует эмбеддинги для массива текстов (батчами по 100)
 * @param {string[]} texts
 * @returns {Promise<Float32Array[]>}
 */
export async function embedBatch(texts) {
  const openai = getOpenAIClient();
  if (!openai) {
    throw new Error('OpenAI API ключ не настроен');
  }

  const allVectors = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    logAiOperation('Embedding: запрос', {
      model: EMBEDDING_MODEL,
      batchSize: batch.length,
      batchIndex: Math.floor(i / BATCH_SIZE) + 1,
      totalBatches: Math.ceil(texts.length / BATCH_SIZE),
    });

    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
    });

    logAiOperation('Embedding: ответ', {
      model: EMBEDDING_MODEL,
      tokensUsed: response.usage?.total_tokens,
    });

    for (const item of response.data) {
      allVectors.push(new Float32Array(item.embedding));
    }
  }

  return allVectors;
}
