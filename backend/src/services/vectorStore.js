/**
 * Векторное хранилище на основе LanceDB.
 * Хранит чанки документации с эмбеддингами на диске.
 */

import * as lancedb from '@lancedb/lancedb';
import path from 'path';
import { logAiOperation } from '../middleware/logger.js';

const DB_PATH = process.env.VECTOR_DB_PATH || './data/vectordb';
const TABLE_NAME = 'doc_chunks';

let db = null;
let table = null;

/**
 * Инициализация LanceDB при старте сервера.
 * Создаёт директорию и таблицу если их нет.
 */
export async function initVectorStore() {
  try {
    db = await lancedb.connect(DB_PATH);
    const tableNames = await db.tableNames();
    if (tableNames.includes(TABLE_NAME)) {
      table = await db.openTable(TABLE_NAME);
      const count = await table.countRows();
      logAiOperation('VectorStore: открыта существующая таблица', { table: TABLE_NAME, rows: count });
    } else {
      table = null; // Создадим при первом upsert
      logAiOperation('VectorStore: инициализация', { table: TABLE_NAME, status: 'empty' });
    }
  } catch (error) {
    logAiOperation('VectorStore: ошибка инициализации', { error: error.message });
    throw error;
  }
}

/**
 * Проверяет, проиндексирован ли документ с данным хешем
 * @param {string} docHash
 * @returns {Promise<boolean>}
 */
export async function hasDocument(docHash) {
  if (!table) return false;
  try {
    const results = await table.search([0]) // dummy search — нужен только фильтр
      .where(`docHash = '${docHash}'`)
      .limit(1)
      .toArray();
    return results.length > 0;
  } catch {
    // Альтернативный способ — через query
    try {
      const results = await table.query()
        .where(`docHash = '${docHash}'`)
        .limit(1)
        .toArray();
      return results.length > 0;
    } catch {
      return false;
    }
  }
}

/**
 * Сохраняет чанки документа в векторное хранилище
 * @param {string} docHash
 * @param {Array<{text: string, chunkIndex: number, endpoint?: string, sectionTitle?: string}>} chunks
 * @param {Float32Array[]} vectors - эмбеддинги соответствующих чанков
 * @param {string} sourceType
 */
export async function upsertChunks(docHash, chunks, vectors, sourceType) {
  const rows = chunks.map((chunk, i) => ({
    id: `${docHash}_chunk_${chunk.chunkIndex}`,
    docHash,
    chunkIndex: chunk.chunkIndex,
    text: chunk.text,
    vector: vectors[i],
    sourceType: sourceType || 'text',
    endpoint: chunk.endpoint || '',
    sectionTitle: chunk.sectionTitle || '',
    createdAt: Date.now(),
  }));

  if (!table) {
    // Создаём таблицу при первой вставке
    table = await db.createTable(TABLE_NAME, rows);
    logAiOperation('VectorStore: таблица создана', { table: TABLE_NAME, rows: rows.length });
  } else {
    await table.add(rows);
    logAiOperation('VectorStore: чанки добавлены', { docHash: docHash.slice(0, 8), chunks: rows.length });
  }
}

/**
 * Поиск релевантных чанков по вектору запроса
 * @param {string} docHash - фильтр по документу
 * @param {Float32Array} queryVector
 * @param {number} topK
 * @returns {Promise<Array<{text: string, endpoint: string, sectionTitle: string, score: number}>>}
 */
export async function searchChunks(docHash, queryVector, topK = 5) {
  if (!table) return [];

  try {
    const results = await table.search(queryVector)
      .where(`docHash = '${docHash}'`)
      .limit(topK)
      .toArray();

    return results.map(r => ({
      text: r.text,
      endpoint: r.endpoint,
      sectionTitle: r.sectionTitle,
      chunkIndex: r.chunkIndex,
      score: r._distance != null ? r._distance : null,
    }));
  } catch (error) {
    logAiOperation('VectorStore: ошибка поиска', { error: error.message });
    return [];
  }
}

/**
 * Получает чанки документа по индексам (для фиксированного контекста — вводные страницы)
 * @param {string} docHash
 * @param {number} maxIndex - включительно (0 и 1 = первые два чанка)
 * @returns {Promise<Array<{text: string, endpoint: string, sectionTitle: string, chunkIndex: number}>>}
 */
export async function getIntroChunks(docHash, maxIndex = 1) {
  if (!table) return [];
  try {
    const results = await table.query()
      .where(`docHash = '${docHash}' AND chunkIndex <= ${maxIndex}`)
      .toArray();
    return results
      .sort((a, b) => a.chunkIndex - b.chunkIndex)
      .map(r => ({
        text: r.text,
        endpoint: r.endpoint || '',
        sectionTitle: r.sectionTitle || '',
        chunkIndex: r.chunkIndex,
      }));
  } catch {
    return [];
  }
}

/**
 * Удаляет все чанки документа
 * @param {string} docHash
 */
export async function deleteDocument(docHash) {
  if (!table) return;
  try {
    await table.delete(`docHash = '${docHash}'`);
    logAiOperation('VectorStore: документ удалён', { docHash: docHash.slice(0, 8) });
  } catch (error) {
    logAiOperation('VectorStore: ошибка удаления', { error: error.message });
  }
}

/**
 * Статистика хранилища
 * @returns {Promise<{totalRows: number}>}
 */
export async function getStats() {
  if (!table) return { totalRows: 0 };
  const totalRows = await table.countRows();
  return { totalRows };
}
