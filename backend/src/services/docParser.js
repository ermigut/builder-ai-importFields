/**
 * Парсинг файлов API документации.
 * Поддерживает: JSON, YAML/OpenAPI, PDF, текстовые файлы, загрузку по URL.
 *
 * Возвращает структуру:
 * {
 *   rawText: string,        // Текстовое представление для AI контекста
 *   isOpenAPI: boolean,     // Является ли документ OpenAPI спекой
 *   endpoints: Array,       // Извлечённые эндпоинты (если OpenAPI)
 *   sourceType: string,     // Тип источника ('json', 'yaml', 'pdf', 'text', 'openapi')
 *   docHash: string,        // SHA-256 хеш rawText для дедупликации
 * }
 */

import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import SwaggerParser from '@apidevtools/swagger-parser';
import axios from 'axios';

/**
 * Основная функция парсинга файла
 * @param {Buffer|string} content - Содержимое файла (Buffer для PDF, string для остальных)
 * @param {string} mimeType - MIME тип файла
 * @param {string} filename - Имя файла
 * @returns {Promise<Object>} Распарсенный контент
 */
export async function parseFile(content, mimeType, filename) {
  const ext = filename ? filename.split('.').pop()?.toLowerCase() : '';

  let result;

  // PDF
  if (mimeType === 'application/pdf' || ext === 'pdf') {
    result = await parsePDF(content);
  } else {
    // Конвертируем Buffer в строку для текстовых форматов
    const textContent = Buffer.isBuffer(content) ? content.toString('utf-8') : content;

    // JSON
    if (mimeType === 'application/json' || ext === 'json') {
      result = await parseJSON(textContent);
    }
    // YAML
    else if (mimeType === 'application/x-yaml' || mimeType === 'text/yaml' ||
        ext === 'yaml' || ext === 'yml') {
      result = await parseYAML(textContent);
    }
    // Текстовые файлы (txt, md, html, etc.)
    else {
      result = parseText(textContent, filename);
    }
  }

  // Вычисляем хеш содержимого для дедупликации в векторном хранилище
  result.docHash = createHash('sha256').update(result.rawText).digest('hex');
  return result;
}

/**
 * Парсинг JSON файла. Пытается определить OpenAPI спеку.
 */
async function parseJSON(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return {
      rawText: content,
      isOpenAPI: false,
      endpoints: [],
      sourceType: 'text',
    };
  }

  // Проверяем, является ли это OpenAPI спекой
  if (isOpenAPISpec(parsed)) {
    return parseOpenAPISpec(parsed);
  }

  // Проверяем, является ли это Postman-коллекцией
  if (isPostmanCollection(parsed)) {
    return parsePostmanCollection(parsed);
  }

  return {
    rawText: JSON.stringify(parsed, null, 2),
    isOpenAPI: false,
    endpoints: [],
    sourceType: 'json',
  };
}

/**
 * Парсинг YAML файла. Пытается определить OpenAPI спеку.
 */
async function parseYAML(content) {
  let parsed;
  try {
    parsed = yaml.load(content);
  } catch (e) {
    return {
      rawText: content,
      isOpenAPI: false,
      endpoints: [],
      sourceType: 'text',
    };
  }

  if (isOpenAPISpec(parsed)) {
    return parseOpenAPISpec(parsed);
  }

  return {
    rawText: typeof parsed === 'object' ? JSON.stringify(parsed, null, 2) : String(parsed),
    isOpenAPI: false,
    endpoints: [],
    sourceType: 'yaml',
  };
}

/**
 * Парсинг PDF файла — извлечение текста
 */
async function parsePDF(buffer) {
  // pdfjs-dist (используемый pdf-parse v2) требует DOMMatrix при загрузке модуля.
  // В Node.js его нет — подставляем минимальный полифил до импорта.
  if (typeof globalThis.DOMMatrix === 'undefined') {
    globalThis.DOMMatrix = class DOMMatrix {
      constructor(init) {
        const values = new Float64Array(16);
        values[0] = values[5] = values[10] = values[15] = 1;
        if (Array.isArray(init)) {
          for (let i = 0; i < Math.min(init.length, 16); i++) values[i] = init[i];
        }
        this.a = values[0]; this.b = values[1]; this.c = values[4]; this.d = values[5];
        this.e = values[12]; this.f = values[13];
      }
      isIdentity = true;
      is2D = true;
    };
  }
  const { PDFParse } = await import('pdf-parse');
  const uint8 = new Uint8Array(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer));
  const pdf = new PDFParse(uint8);
  await pdf.load();
  const result = await pdf.getText();
  return {
    rawText: result.text,
    isOpenAPI: false,
    endpoints: [],
    sourceType: 'pdf',
  };
}

/**
 * Парсинг текстового файла
 */
function parseText(content, filename) {
  return {
    rawText: content,
    isOpenAPI: false,
    endpoints: [],
    sourceType: 'text',
  };
}

/**
 * Проверяет, является ли объект OpenAPI спекой
 */
function isOpenAPISpec(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return !!(obj.openapi || obj.swagger);
}

/**
 * Проверяет, является ли объект Postman-коллекцией
 */
function isPostmanCollection(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return !!(
    obj.info && obj.item && Array.isArray(obj.item) &&
    (obj.info._postman_id || (typeof obj.info.schema === 'string' && obj.info.schema.includes('getpostman.com')))
  );
}

/**
 * Рекурсивно собирает все запросы из дерева item[] Postman-коллекции.
 * Возвращает плоский массив { name, method, url, rawBody, parsedBody }.
 */
function collectPostmanRequests(items, folderPath = '') {
  const requests = [];
  if (!Array.isArray(items)) return requests;

  for (const item of items) {
    if (item.item && Array.isArray(item.item)) {
      // Папка — рекурсируем
      const prefix = folderPath ? `${folderPath} / ${item.name}` : item.name;
      requests.push(...collectPostmanRequests(item.item, prefix));
    } else if (item.request) {
      const req = item.request;
      const method = (req.method || 'GET').toUpperCase();
      const url = typeof req.url === 'string' ? req.url : (req.url?.raw || '');
      const name = item.name || '';

      let rawBody = null;
      let parsedBody = null;
      if (req.body?.mode === 'raw' && req.body.raw) {
        rawBody = req.body.raw;
        // Заменяем {{variable}} на null чтобы получить валидный JSON
        const sanitized = rawBody.replace(/\{\{[^}]+\}\}/g, 'null');
        try {
          parsedBody = JSON.parse(sanitized);
        } catch (_) {
          // тело не JSON, оставляем как строку
        }
      }

      requests.push({ name, folder: folderPath, method, url, rawBody, parsedBody });
    }
  }
  return requests;
}

/**
 * Рекурсивно строит текстовое описание JSON-структуры (для отображения полей тела запроса).
 * Возвращает строку с отступами.
 */
function describeJsonStructure(obj, indent = '    ') {
  if (obj === null || obj === undefined) return `${indent}null`;
  if (Array.isArray(obj)) {
    if (obj.length === 0) return `${indent}[]`;
    return `${indent}[\n${describeJsonStructure(obj[0], indent + '  ')}\n${indent}]`;
  }
  if (typeof obj === 'object') {
    const lines = [];
    for (const [key, value] of Object.entries(obj)) {
      if (value !== null && typeof value === 'object') {
        lines.push(`${indent}${key}:`);
        lines.push(describeJsonStructure(value, indent + '  '));
      } else {
        lines.push(`${indent}${key}: ${JSON.stringify(value)}`);
      }
    }
    return lines.join('\n');
  }
  return `${indent}${JSON.stringify(obj)}`;
}

/**
 * Парсинг Postman-коллекции — извлечение эндпоинтов в структурированный вид
 */
function parsePostmanCollection(collection) {
  const requests = collectPostmanRequests(collection.item);
  const info = collection.info || {};

  let rawText = `API Collection: ${info.name || 'Unknown'}\n\n`;
  rawText += `Endpoints (${requests.length}):\n\n`;

  const endpoints = [];

  for (const req of requests) {
    const folder = req.folder ? `[${req.folder}] ` : '';
    rawText += `${req.method} ${req.url} — ${folder}${req.name}\n`;

    const endpoint = {
      path: req.url.replace(/\{\{[^}]+\}\}/g, '{var}'),
      method: req.method,
      summary: req.name,
      description: req.folder || '',
      operationId: req.name,
      parameters: [],
      requestBody: null,
      responseSchema: null,
    };

    if (req.parsedBody) {
      rawText += `  Request Body:\n${describeJsonStructure(req.parsedBody)}\n`;
      endpoint.requestBody = req.parsedBody;
    } else if (req.rawBody) {
      rawText += `  Request Body (raw):\n    ${req.rawBody.substring(0, 500)}\n`;
    }

    rawText += '\n';
    endpoints.push(endpoint);
  }

  return {
    rawText,
    isOpenAPI: false,
    isPostman: true,
    endpoints,
    sourceType: 'postman',
  };
}

/**
 * Парсинг OpenAPI спецификации — извлечение эндпоинтов
 */
async function parseOpenAPISpec(spec) {
  let dereferenced;
  try {
    dereferenced = await SwaggerParser.dereference(structuredClone(spec));
  } catch (e) {
    // Если не удалось разыменовать, работаем с оригиналом
    dereferenced = spec;
  }

  const endpoints = [];
  const paths = dereferenced.paths || {};

  for (const [path, methods] of Object.entries(paths)) {
    if (!methods || typeof methods !== 'object') continue;

    for (const [method, operation] of Object.entries(methods)) {
      if (['get', 'post', 'put', 'patch', 'delete'].indexOf(method) === -1) continue;
      if (!operation || typeof operation !== 'object') continue;

      const endpoint = {
        path,
        method: method.toUpperCase(),
        summary: operation.summary || '',
        description: operation.description || '',
        operationId: operation.operationId || '',
        parameters: extractParameters(operation),
        requestBody: extractRequestBody(operation),
        responseSchema: extractResponseSchema(operation),
      };
      endpoints.push(endpoint);
    }
  }

  // Извлекаем базовый URL из servers
  const servers = dereferenced.servers || spec.servers || [];
  const baseUrl = (servers[0]?.url || '').replace(/\/$/, '');

  // Формируем текстовое представление
  const info = dereferenced.info || {};
  let rawText = `API: ${info.title || 'Unknown'}\n`;
  rawText += `Version: ${info.version || 'Unknown'}\n`;
  if (baseUrl) rawText += `Base URL: ${baseUrl}\n`;
  if (info.description) rawText += `Description: ${info.description}\n`;
  rawText += `\nEndpoints (${endpoints.length}):\n\n`;

  for (const ep of endpoints) {
    rawText += `${ep.method} ${ep.path}`;
    if (ep.summary) rawText += ` — ${ep.summary}`;
    rawText += '\n';
    if (ep.description) rawText += `  Description: ${ep.description}\n`;
    if (ep.parameters.length > 0) {
      rawText += `  Parameters:\n`;
      for (const p of ep.parameters) {
        rawText += `    - ${p.name} (${p.in}, ${p.type || 'string'}${p.required ? ', required' : ''}): ${p.description || ''}\n`;
      }
    }
    if (ep.requestBody) {
      rawText += `  Request Body:\n`;
      rawText += `    ${JSON.stringify(ep.requestBody, null, 4).replace(/\n/g, '\n    ')}\n`;
    }
    if (ep.responseSchema) {
      rawText += `  Response:\n`;
      rawText += `    ${JSON.stringify(ep.responseSchema, null, 4).replace(/\n/g, '\n    ')}\n`;
    }
    rawText += '\n';
  }

  return {
    rawText,
    isOpenAPI: true,
    endpoints,
    sourceType: 'openapi',
    baseUrl: baseUrl || null,
  };
}

/**
 * Извлечение параметров из операции OpenAPI
 */
function extractParameters(operation) {
  if (!operation.parameters) return [];
  return operation.parameters.map(p => ({
    name: p.name,
    in: p.in,
    required: !!p.required,
    type: p.schema?.type || p.type || 'string',
    description: p.description || '',
    schema: p.schema || null,
  }));
}

/**
 * Извлечение request body из операции OpenAPI
 */
function extractRequestBody(operation) {
  const body = operation.requestBody;
  if (!body) return null;

  const content = body.content || {};
  const jsonContent = content['application/json'] || Object.values(content)[0];
  if (!jsonContent?.schema) return null;

  const simplified = simplifySchema(jsonContent.schema);

  // Извлекаем примеры из examples (множественное) или example (единственное)
  let example = null;
  if (jsonContent.example) {
    example = jsonContent.example;
  } else if (jsonContent.examples && typeof jsonContent.examples === 'object') {
    // Берём value из первого named example
    const firstExample = Object.values(jsonContent.examples)[0];
    if (firstExample?.value) {
      example = firstExample.value;
    }
  }

  if (example && typeof example === 'object') {
    return { schema: simplified, example };
  }

  return simplified;
}

/**
 * Извлечение response schema из операции OpenAPI
 */
function extractResponseSchema(operation) {
  const responses = operation.responses || {};
  // Берём успешный ответ (200, 201, или первый 2xx)
  const successResponse = responses['200'] || responses['201'] ||
    Object.entries(responses).find(([code]) => code.startsWith('2'))?.[1];

  if (!successResponse) return null;

  const content = successResponse.content || {};
  const jsonContent = content['application/json'] || Object.values(content)[0];
  if (!jsonContent?.schema) return null;

  const simplified = simplifySchema(jsonContent.schema);

  // Извлекаем примеры из examples (множественное) или example (единственное)
  let example = null;
  if (jsonContent.example) {
    example = jsonContent.example;
  } else if (jsonContent.examples && typeof jsonContent.examples === 'object') {
    const firstExample = Object.values(jsonContent.examples)[0];
    if (firstExample?.value) {
      example = firstExample.value;
    }
  }

  if (example && typeof example === 'object') {
    return { schema: simplified, example };
  }

  return simplified;
}

/**
 * Deep-merge для упрощённых схем.
 * При oneOf/allOf варианты могут содержать одноимённые вложенные объекты
 * (например traits у Known User и Anonymous User) — нужно объединять свойства,
 * а не перезаписывать весь объект.
 */
function deepMergeSimplified(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (
      typeof value === 'object' && value !== null && !Array.isArray(value) &&
      typeof target[key] === 'object' && target[key] !== null && !Array.isArray(target[key])
    ) {
      // Оба — вложенные объекты: мержим рекурсивно
      deepMergeSimplified(target[key], value);
    } else {
      // Примитив, массив, или ключ отсутствует — просто присваиваем
      target[key] = value;
    }
  }
}

/**
 * Упрощает JSON Schema для более компактного представления.
 * Рекурсивно раскрывает allOf/oneOf/anyOf до любого уровня вложенности.
 */
function simplifySchema(schema, depth = 0) {
  if (!schema || depth > 10) return schema;

  // allOf / oneOf / anyOf — рекурсивно мержим properties из ВСЕХ подсхем
  if (schema.allOf || schema.oneOf || schema.anyOf) {
    const subSchemas = schema.allOf || schema.oneOf || schema.anyOf;
    const merged = {};
    for (const sub of subSchemas) {
      // Увеличиваем depth для каждой подсхемы!
      const simplified = simplifySchema(sub, depth + 1);
      if (typeof simplified === 'object' && !Array.isArray(simplified)) {
        // simplifySchema всегда возвращает "плоский" словарь { propName: description, ... }
        // Используем deep-merge чтобы при oneOf не затирать вложенные объекты
        // (например, Known User.traits{4 props} + Anonymous User.traits{2 props} → объединение)
        if (Object.keys(simplified).length > 0) {
          deepMergeSimplified(merged, simplified);
        }
      }
    }
    // Также мержим properties из самой schema (если есть рядом с allOf)
    if (schema.properties) {
      for (const [key, prop] of Object.entries(schema.properties)) {
        if (prop.allOf || prop.oneOf || prop.anyOf) {
          merged[key] = simplifySchema(prop, depth + 1);
        } else if (prop.type === 'object' && prop.properties) {
          merged[key] = simplifySchema(prop, depth + 1);
        } else if (prop.type === 'array' && prop.items) {
          merged[key] = [simplifySchema(prop.items, depth + 1)];
        } else {
          let desc = prop.type || 'string';
          if (prop.format) desc += ` (${prop.format})`;
          if (prop.description) desc += ` — ${prop.description}`;
          if (prop.enum) desc += ` [${prop.enum.join(', ')}]`;
          if (prop.example !== undefined && prop.example !== null) desc += ` | example: ${prop.example}`;
          merged[key] = desc;
        }
      }
    }
    return Object.keys(merged).length > 0 ? merged : (schema.type || 'object');
  }

  if (schema.type === 'object' && schema.properties) {
    const result = {};
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (prop.allOf || prop.oneOf || prop.anyOf) {
        result[key] = simplifySchema(prop, depth + 1);
      } else if (prop.type === 'object' && prop.properties) {
        result[key] = simplifySchema(prop, depth + 1);
      } else if (prop.type === 'array' && prop.items) {
        result[key] = [simplifySchema(prop.items, depth + 1)];
      } else {
        let desc = prop.type || 'string';
        if (prop.format) desc += ` (${prop.format})`;
        if (prop.description) desc += ` — ${prop.description}`;
        if (prop.enum) desc += ` [${prop.enum.join(', ')}]`;
        if (prop.example !== undefined && prop.example !== null) desc += ` | example: ${prop.example}`;
        result[key] = desc;
      }
    }
    return result;
  }

  if (schema.type === 'array' && schema.items) {
    return [simplifySchema(schema.items, depth + 1)];
  }

  return schema.type || schema;
}

/**
 * Загрузка и парсинг документации по URL
 * @param {string} url
 * @returns {Promise<Object>}
 */
export async function parseURL(url) {
  const response = await axios.get(url, {
    timeout: 30000,
    maxContentLength: 10 * 1024 * 1024, // 10MB
    responseType: 'arraybuffer',
  });

  const contentType = response.headers['content-type'] || '';
  const buffer = Buffer.from(response.data);

  // Определяем имя файла из URL
  const urlPath = new URL(url).pathname;
  const filename = urlPath.split('/').pop() || 'document';

  // Определяем MIME тип
  let mimeType = contentType.split(';')[0].trim();
  if (!mimeType || mimeType === 'application/octet-stream') {
    // Пытаемся определить по расширению
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'json') mimeType = 'application/json';
    else if (ext === 'yaml' || ext === 'yml') mimeType = 'application/x-yaml';
    else if (ext === 'pdf') mimeType = 'application/pdf';
  }

  return parseFile(buffer, mimeType, filename);
}
