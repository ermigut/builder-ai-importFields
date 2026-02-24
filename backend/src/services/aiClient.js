// Импортируем config ПЕРВЫМ для загрузки переменных окружения
import '../config.js';

import OpenAI from 'openai';
import { logAiOperation } from '../middleware/logger.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.warn('WARNING: OPENAI_API_KEY не установлен. Функции ИИ не будут работать.');
}

// Инициализация клиента OpenAI
const openai = OPENAI_API_KEY
  ? new OpenAI({
      apiKey: OPENAI_API_KEY,
    })
  : null;

/**
 * Генерирует JSON-ответ от ИИ на основе промпта
 * @param {string} prompt - Промпт для ИИ
 * @param {string} model - Модель OpenAI (по умолчанию 'gpt-4o-mini')
 * @returns {Promise<Object>} - Парсированный JSON-объект
 * @throws {Error} - Если произошла ошибка при обращении к ИИ или парсинге JSON
 */
export async function generateJsonFromPrompt(prompt, model = 'gpt-4o-mini') {
  if (!openai) {
    throw new Error('OpenAI API ключ не настроен. Установите переменную окружения OPENAI_API_KEY.');
  }

  try {
    logAiOperation('Запрос к ИИ', { model, promptLength: prompt.length });
    
    const response = await openai.chat.completions.create({
      model: model,
      messages: [
        {
          role: 'system',
          content: 'Ты помощник, который генерирует строго валидный JSON без дополнительного текста. Всегда возвращай только JSON-объект.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: { type: 'json_object' }, // Гарантирует JSON-выход
      temperature: 0.3, // Низкая температура для более детерминированных результатов
    });

    logAiOperation('Ответ от ИИ получен', { 
      model, 
      tokensUsed: response.usage?.total_tokens,
    });

    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new Error('ИИ не вернул содержимое в ответе');
    }

    // Парсим JSON (должен быть валидным благодаря response_format: json_object)
    try {
      const jsonResult = JSON.parse(content);
      logAiOperation('JSON успешно распарсен', { keys: Object.keys(jsonResult) });
      return jsonResult;
    } catch (parseError) {
      logAiOperation('Ошибка парсинга JSON', { error: parseError.message });
      throw new Error(`Ошибка парсинга JSON от ИИ: ${parseError.message}. Содержимое: ${content.substring(0, 200)}`);
    }
  } catch (error) {
    logAiOperation('Ошибка при обращении к ИИ', { 
      error: error.message,
      status: error instanceof OpenAI.APIError ? error.status : undefined,
    });
    
    // Обработка специфичных ошибок OpenAI
    if (error instanceof OpenAI.APIError) {
      if (error.status === 401) {
        throw new Error('Неверный API ключ OpenAI. Проверьте OPENAI_API_KEY.');
      }
      if (error.status === 429) {
        throw new Error('Превышен лимит запросов к OpenAI API. Попробуйте позже.');
      }
      if (error.status === 500) {
        throw new Error('Внутренняя ошибка OpenAI API. Попробуйте позже.');
      }
      throw new Error(`Ошибка OpenAI API: ${error.message}`);
    }

    // Пробрасываем другие ошибки как есть
    throw error;
  }
}

/**
 * Генерирует шаблонную инструкцию для ИИ, описывающую целевой формат JSON
 * @returns {string} - Инструкция в виде текста
 */
export function getInstructionPrompt() {
  return `Проанализируй предоставленные данные API и сгенерируй JSON-объект со следующей структурой:

{
  "fields": [
    {
      "id": <число или null>,
      "versionId": <число или null>,
      "data": {
        "code": "<уникальный код параметра, например 'paramsmin'>",
        "valueType": <число: 1=строка, 2=число, 3=булево, и т.д.>,
        "required": <true/false>,
        "isEditable": <true/false>,
        "dateCreated": "<дата в формате 'YYYY-MM-DD HH:mm:ss' или текущая дата>"
      },
      "enumId": <число или null>,
      "titleEn": "<название на английском>",
      "titleRu": "<название на русском>",
      "hintEn": "<подсказка на английском или null>",
      "hintRu": "<подсказка на русском или null>"
    }
  ],
  "rowSections": [
    {
      "id": null,
      "versionId": null,
      "data": {
        "code": "<уникальный код секции, например 'items'>",
        "customFieldsIsEditable": false,
        "customFieldsIsRequired": false
      },
      "titleEn": "<название секции на английском>",
      "titleRu": "<название секции на русском>",
      "fields": [
        {
          "id": null,
          "versionId": null,
          "data": {
            "code": "<уникальный код поля секции, например 'items__name'>",
            "valueType": <число: 1=строка, 2=число, и т.д.>,
            "required": <true/false>,
            "isEditable": <true/false>,
            "dateCreated": "<дата в формате 'YYYY-MM-DD HH:mm:ss'>"
          },
          "enumId": null,
          "titleEn": "<название поля на английском>",
          "titleRu": "<название поля на русском>",
          "hintEn": null
        }
      ],
      "customFieldsSetLinks": []
    }
  ],
  "request": {
    "data": {
      "url": "<URL внешнего API>",
      "method": <число: 0=GET, 1=POST, 2=PUT, 3=DELETE, и т.д.>,
      "format": 0,
      "content": "",
      "urlEncodeType": 0,
      "filter": [],
      "filterType": 2,
      "preScript": "",
      "postScript": "",
      "apiDocUrl": "<URL документации или пустая строка>"
    },
    "authId": <число или null>,
    "certificateId": null,
    "paginationId": null,
    "signatureId": null,
    "fields": [
      {
        "data": {
          "key": "<ключ параметра, например 'jsonrpc'>",
          "value": "<значение по умолчанию или пустая строка>",
          "valueType": <число>,
          "required": <true/false>,
          "defaultValue": "",
          "formatCfg": {
            "valueType": <число>
          }
        },
        "children": [],
        "cfsMappings": []
      }
    ],
    "headers": [],
    "response": {
      "data": {
        "format": 0,
        "pathToArray": null,
        "filter": [],
        "useRequestData": 0,
        "preScript": "",
        "postScript": ""
      },
      "fields": [
        {
          "id": <число или null>,
          "versionId": <число или null>,
          "data": {
            "key": "<путь к полю в ответе, например 'result.random.data'>",
            "code": "<код поля>",
            "isInArrayElement": false,
            "formatCfg": null
          },
          "children": [],
          "cfsMappings": []
        }
      ],
      "headers": [],
      "statusHandlers": [],
      "cfsMappings": []
    },
    "cfsMappings": []
  }
}

ВАЖНО:
1. **Для JSON-источника:** Проанализируй ВСЕ свойства JSON-объекта и создай ОТДЕЛЬНОЕ поле в массиве "fields" для КАЖДОГО свойства. Например, если JSON содержит {"vars": {"name": "test", "age": 21}}, создай 2 поля.
2. **КРИТИЧЕСКИ ВАЖНО - Коды полей в fields[].data.code:** В массиве "fields" коды полей НЕ МОГУТ содержать точки! Заменяй точки на двойное подчёркивание "__". Например, для пути "vars.name" код должен быть "vars__name", для "vars.user.age" -> "vars__user__age". Это правило применяется ТОЛЬКО к полю "code" в массиве "fields".
3. **Ключи в request.fields и response.fields:** В массивах "request.fields" и "response.fields" используй точки в ключах (field.data.key) для маппинга по объекту. Например, для {"vars": {"name": "test"}} создай поле с key="vars.name". Для вложенных объектов используй точечную нотацию (например, "vars.user.name"). Это правило применяется ТОЛЬКО к полю "key" в request.fields и response.fields.
4. **Значения в request.fields[].data.value:** Для каждого поля в request.fields поле "value" должно содержать шаблон в формате {{data.КОД_ПОЛЯ}}, где КОД_ПОЛЯ - это код соответствующего поля из массива "fields" (без точек, с "__"). Например, если key="vars.name" и соответствующее поле в "fields" имеет code="vars__name", то value должно быть "{{data.vars__name}}".
5. **formatCfg для полей с типами DateTime (5) и Date (8):** Для полей в request.fields с valueType=5 (DateTime) или valueType=8 (Date) ОБЯЗАТЕЛЬНО добавь объект "formatCfg" в поле "data". Структура formatCfg:
   - "valueType": 1 (если дата передаётся как строка, например "2024-01-15 10:30:00") или 2 (если дата передаётся как число, например unix timestamp 1705312200 или миллисекунды 1705312200000)
   - "format": строка формата PHP для даты (см. https://www.php.net/manual/en/datetime.format.php). Основные символы формата:
     * Y - год (4 цифры), y - год (2 цифры)
     * m - месяц с ведущим нулем (01-12), n - месяц без ведущего нуля (1-12)
     * d - день с ведущим нулем (01-31), j - день без ведущего нуля (1-31)
     * H - часы 24-часовой формат (00-23), h - часы 12-часовой формат (01-12)
     * i - минуты (00-59)
     * s - секунды (00-59)
     * u - микросекунды (000000-999999)
     * v - миллисекунды (000-999) - доступно с PHP 7.0.0
     * P - смещение часового пояса с двоеточием (+02:00)
     * p - смещение часового пояса с двоеточием или Z для UTC (доступно с PHP 8.0.0)
     * T - аббревиатура часового пояса (EST, MDT...)
     * Z - смещение часового пояса в секундах
     * U - Unix timestamp (секунды)
     * КРИТИЧЕСКИ ВАЖНО про экранирование: В JSON строке обратный слеш должен быть удвоен! Для получения \T в PHP формате, в JSON строке пиши \\T (два обратных слеша). То же для \Z - в JSON пиши \\Z.
     * Символы, не являющиеся форматирующими (например, T в ISO 8601), должны быть экранированы обратным слешем в PHP формате (\T, \Z), но в JSON строке это будет выглядеть как \\T и \\Z (двойной слеш).
     Попытайся определить формат на основе примера значения в JSON:
     * ISO 8601 с миллисекундами и таймзоной:
       - Если заканчивается на "Z" (например "2012-02-22T02:06:58.147Z") -> ОБЯЗАТЕЛЬНО используй формат "Y-m-d\\TH:i:s.v\\Z" (два обратных слеша перед T и Z в JSON строке!). Это даст Y-m-d\TH:i:s.v\Z в PHP.
       - Если заканчивается на смещение (например "2012-02-22T02:06:58.147+00:00") -> в JSON строке должно быть "Y-m-d\\TH:i:s.vp" (где .v - миллисекунды, p - таймзона в формате +02:00, возвращает Z для +00:00)
     * ISO 8601 без миллисекунд:
       - Если заканчивается на "Z" (например "2024-01-15T10:30:00Z") -> в JSON строке должно быть "Y-m-d\\TH:i:s\\Z" (обрати внимание: двойной обратный слеш \\T и \\Z)
       - Если заканчивается на смещение (например "2024-01-15T10:30:00+00:00") -> в JSON строке должно быть "Y-m-d\\TH:i:sP" (где P - таймзона с двоеточием)
     * Стандартный формат (например "2024-01-15 10:30:00") -> "Y-m-d H:i:s"
     * Только дата (например "2024-01-15") -> "Y-m-d"
     * Unix timestamp (число) -> "U" (для секунд) или определи формат на основе контекста
     * КРИТИЧЕСКИ ВАЖНО ПРО ЭКРАНИРОВАНИЕ: В форматах ISO 8601 символ T ОБЯЗАТЕЛЬНО должен быть экранирован обратным слешем.
       ⚠️ В JSON строке ВСЕГДА пиши ДВОЙНОЙ обратный слеш: "Y-m-d\\TH:i:s" (\\T с двумя слешами), чтобы в PHP формате получилось \T (один слеш).
       ⚠️ То же самое для Z: в JSON пиши \\Z (два слеша), чтобы получить \Z в PHP.
       ⚠️ Примеры ПРАВИЛЬНЫХ JSON строк: "Y-m-d\\TH:i:s.v\\Z", "Y-m-d\\TH:i:s\\Z"
       ⚠️ НЕПРАВИЛЬНО: "Y-m-d\TH:i:s.v\Z" (один слеш - это невалидный JSON escape sequence!)
       В PHP символ T без экранирования используется для аббревиатуры часового пояса, а нам нужна литеральная буква T
     * Если формат не удалось определить, используй дефолт: "Y-m-d H:i:s" для DateTime и "Y-m-d" для Date
   - "timezone": строка часового пояса (например "+0000", "+0300", "-0500"). Попытайся определить на основе примера значения (например, если в значении есть "+03:00", используй "+0300"). Если не удалось определить, используй дефолт "+0000"
   Примеры для DateTime:
   - Стандартный формат: {"formatCfg": {"format": "Y-m-d H:i:s", "timezone": "+0000", "valueType": 1}}
   - ISO 8601 с миллисекундами и Z: {"formatCfg": {"format": "Y-m-d\\TH:i:s.v\\Z", "timezone": "+0000", "valueType": 1}} (для "2012-02-22T02:06:58.147Z", обрати внимание что T и Z экранированы как \\T и \\Z, .v - миллисекунды согласно PHP документации)
   - ISO 8601 с миллисекундами и смещением: {"formatCfg": {"format": "Y-m-d\\TH:i:s.vp", "timezone": "+0000", "valueType": 1}} (для "2012-02-22T02:06:58.147+00:00", .v - миллисекунды, p - таймзона)
   - ISO 8601 без миллисекунд с Z: {"formatCfg": {"format": "Y-m-d\\TH:i:s\\Z", "timezone": "+0000", "valueType": 1}} (для "2024-01-15T10:30:00Z")
   - ISO 8601 без миллисекунд со смещением: {"formatCfg": {"format": "Y-m-d\\TH:i:sP", "timezone": "+0000", "valueType": 1}} (для "2024-01-15T10:30:00+00:00")
   Пример для Date: {"formatCfg": {"format": "Y-m-d", "timezone": "+0000", "valueType": 1}}
6. **formatCfg для полей с типами StringArray (101), IntArray (102) и Boolean (9):** Для полей в request.fields с valueType=101 (StringArray), valueType=102 (IntArray) или valueType=9 (Boolean) ОБЯЗАТЕЛЬНО добавь объект "formatCfg" в поле "data" с одним ключом "valueType":
   - Для StringArray (101): {"formatCfg": {"valueType": 101}} (valueType соответствует типу поля)
   - Для IntArray (102): {"formatCfg": {"valueType": 102}} (valueType соответствует типу поля)
   - Для Boolean (9): {"formatCfg": {"valueType": 9}} (valueType соответствует типу поля)
7. **Определение типов (valueType):** Определяй valueType на основе значения и типа данных:
   - 1 (String) - для строк, текстовых значений, чисел в кавычках, объектов (сериализованных как строка)
   - 2 (Int) - для целых чисел (НО НЕ для unix timestamp - см. ниже)
   - 3 (Decimal) - для десятичных чисел (с плавающей точкой)
   - 5 (DateTime) - для даты и времени (форматы ISO, unix timestamp и т.д.)
   - 7 (File) - для файлов, путей к файлам, base64-encoded данных
   - 8 (Date) - для дат (без времени)
   - 9 (Boolean) - для булевых значений (true/false)
   - 101 (StringArray) - для массивов строк
   - 102 (IntArray) - для массивов целых чисел
   ВАЖНО: Unix timestamp должен определяться как 5 (DateTime), а НЕ как 2 (Int):
   - Unix timestamp в секундах (10 цифр, значение от 1000000000 до 9999999999, например 1770729544) -> 5 (DateTime)
   - Unix timestamp в миллисекундах (13 цифр, значение от 1000000000000 до 9999999999999, например 1770732087654) -> 5 (DateTime)
   Если число выглядит как unix timestamp (10 или 13 цифр в указанных диапазонах), это дата и время.
   Примеры: строка "test" -> 1, число 42 -> 2, число 3.14 -> 3, unix timestamp в секундах 1770729544 -> 5 (DateTime), unix timestamp в миллисекундах 1770732087654 -> 5 (DateTime), true/false -> 9, массив ["a", "b"] -> 101, массив [1, 2, 3] -> 102.
8. **Названия полей:** Используй осмысленные названия на русском и английском. Например, для "name" -> titleRu="Имя", titleEn="Name"; для "age" -> titleRu="Возраст", titleEn="Age".
9. В "request.data.url" ОБЯЗАТЕЛЬНО укажи РЕАЛЬНЫЙ URL из исходных данных (если в исходных данных есть URL, используй его, иначе используй пустую строку, НЕ используй плейсхолдеры типа "<URL внешнего API>")
10. В "request.data.apiDocUrl" укажи URL документации, если он есть в исходных данных, иначе пустую строку (НЕ используй плейсхолдеры)
11. В "request.data.method" укажи код HTTP-метода (0=GET, 1=POST, 2=PUT, 3=DELETE) на основе исходных данных. Если метод не указан, используй 1 (POST) для JSON.
12. В "request.response.fields" добавь поля из ответа API на основе структуры исходных данных (если исходные данные описывают ответ API)
13. Используй разумные значения по умолчанию для обязательных полей
14. Если какое-то поле неизвестно, используй null или пустую строку/массив
15. НИКОГДА не используй плейсхолдеры типа "<URL внешнего API>" или "<URL документации или пустая строка>" - используй реальные значения или пустые строки
16. Всегда возвращай валидный JSON без дополнительного текста
17. **Кастомные поля:** Полностью ИГНОРИРУЙ любые свойства JSON, связанные с кастомными полями (customFields, custom_fields, cfs, cfsMappings, cfs_mappings и их вариации). НЕ создавай для них поля в массиве "fields" и НЕ добавляй их в request.fields. Если встретишь такой ключ — пропусти его целиком вместе со всем содержимым.
18. **Массивы объектов → Строковые секции (rowSections):** Если в JSON встречается свойство, значение которого является МАССИВОМ ОБЪЕКТОВ (например "items": [{"id": 1, "name": "foo"}, ...]), создай для него запись в массиве "rowSections" вместо обычного поля в "fields". НЕ создавай такой ключ в "fields". Поля строковой секции формируй на основе свойств ПЕРВОГО элемента массива. Массивы примитивов (строк, чисел) — это обычные поля типа StringArray (101) или IntArray (102), их в rowSections НЕ помещай.
19. **Коды строковых секций и их полей:** Код самой секции должен отражать ПОЛНЫЙ путь к массиву, используя "__" вместо точек (так же как и обычные поля). Например, если JSON содержит {"data": {"contacts": [...]}}, то код секции должен быть "data__contacts". Для полей внутри rowSections используй префикс в виде кода секции: "{код_секции}__{имя_свойства}". Например, "data__contacts__name".
20. **Глобальная уникальность кодов:** Все коды во всех массивах (fields[].data.code, rowSections[].data.code, rowSections[].fields[].data.code) должны быть ГЛОБАЛЬНО УНИКАЛЬНЫМИ — никакие два кода не должны совпадать между собой.`;
}

/**
 * Проверяет, является ли ключ JSON связанным с кастомными полями
 * Такие ключи полностью игнорируются при импорте JSON
 * @param {string} key - Ключ JSON-объекта
 * @returns {boolean} - true если ключ связан с кастомными полями
 */
function isCustomFieldKey(key) {
  const lower = key.toLowerCase();
  return /^(custom_?fields?|cfs_?mappings?|cfs)$/.test(lower)
    || lower.includes('customfield')
    || lower.includes('custom_field');
}

/**
 * Создаёт оптимизированную структуру JSON для промпта (сокращает длинные значения)
 * @param {any} obj - JSON объект
 * @param {number} maxStringLength - Максимальная длина строки (по умолчанию 100)
 * @param {number} depth - Текущая глубина вложенности
 * @returns {any} - Оптимизированный объект
 */
function createOptimizedJsonStructure(obj, maxStringLength = 100, depth = 0) {
  if (depth > 10) return '[...]'; // Ограничиваем глубину вложенности
  
  if (obj === null || obj === undefined) return obj;
  
  if (Array.isArray(obj)) {
    // Для массивов берём только первые 3 элемента как примеры
    return obj.slice(0, 3).map(item => createOptimizedJsonStructure(item, maxStringLength, depth + 1));
  }
  
  if (typeof obj === 'object') {
    const optimized = {};
    for (const [key, value] of Object.entries(obj)) {
      // Полностью пропускаем ключи, связанные с кастомными полями
      if (isCustomFieldKey(key)) continue;
      if (typeof value === 'string' && value.length > maxStringLength) {
        // Сокращаем длинные строки, но сохраняем начало для определения типа
        optimized[key] = value.substring(0, maxStringLength) + '...';
      } else {
        optimized[key] = createOptimizedJsonStructure(value, maxStringLength, depth + 1);
      }
    }
    return optimized;
  }
  
  return obj;
}

/**
 * Рекурсивно ищет в JSON свойство с именем arrayKey, значение которого — массив объектов,
 * и возвращает полный dot-notation путь (например "data.contacts").
 * @param {any} obj - JSON объект
 * @param {string} arrayKey - Имя свойства, которое ищем
 * @param {string} prefix - Текущий путь (для рекурсии)
 * @returns {string|null} - Полный путь или null
 */
function findJsonArrayPath(obj, arrayKey, prefix = '') {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (key === arrayKey && Array.isArray(value) && value.length > 0 &&
        value[0] !== null && typeof value[0] === 'object') {
      return path;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const found = findJsonArrayPath(value, arrayKey, path);
      if (found) return found;
    }
  }
  return null;
}


/**
 * Определяет formatCfg для поля на основе типа и значения в исходном JSON.
 * @param {number} valueType - Тип поля
 * @param {string} key - dot-notation путь к значению в JSON
 * @param {any} sourceJson - Исходный JSON объект (или null)
 * @returns {Object|null} - Объект formatCfg или null
 */
function detectFormatCfg(valueType, key, sourceJson) {
  if (valueType === 5 || valueType === 8) {
    let detectedFormat = null;
    let detectedTimezone = '+0000';
    let detectedValueType = 1;

    if (sourceJson && key) {
      const keys = key.split('.');
      let val = sourceJson;
      for (const k of keys) {
        if (val && typeof val === 'object' && k in val) val = val[k];
        else { val = null; break; }
      }
      if (val !== null && val !== undefined) {
        if (typeof val === 'number' && Number.isInteger(val)) {
          detectedValueType = 2;
          if (val >= 1000000000 && val <= 9999999999) detectedFormat = 'U';
          else if (val >= 1000000000000 && val <= 9999999999999) detectedFormat = 'Uv';
          else detectedFormat = 'U';
        } else if (typeof val === 'string') {
          if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[Z+-]/.test(val)) {
            if (val.endsWith('Z')) {
              detectedFormat = 'Y-m-d\\TH:i:s.v\\Z';
            } else {
              detectedFormat = 'Y-m-d\\TH:i:s.vp';
              const tzMatch = val.match(/([+-]\d{2}):(\d{2})$/);
              if (tzMatch) detectedTimezone = tzMatch[1] + tzMatch[2];
            }
          } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[Z+-]/.test(val)) {
            if (val.endsWith('Z')) {
              detectedFormat = 'Y-m-d\\TH:i:s\\Z';
            } else {
              detectedFormat = 'Y-m-d\\TH:i:sP';
              const tzMatch = val.match(/([+-]\d{2}):(\d{2})$/);
              if (tzMatch) detectedTimezone = tzMatch[1] + tzMatch[2];
            }
          } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(val)) {
            detectedFormat = 'Y-m-d H:i:s';
          } else if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
            detectedFormat = 'Y-m-d';
          }
        }
      }
    }

    return {
      format: detectedFormat || (valueType === 5 ? 'Y-m-d H:i:s' : 'Y-m-d'),
      timezone: detectedTimezone,
      valueType: detectedValueType,
    };
  }

  if (valueType === 9 || valueType === 101 || valueType === 102) {
    return { valueType };
  }

  return null;
}

/**
 * Генерирует целевой JSON (fields и request) на основе источника данных
 * @param {string} sourceType - Тип источника: 'url', 'curl', 'json'
 * @param {string} sourceValue - Содержимое источника
 * @returns {Promise<Object>} - Объект с полями fields и request
 */
export async function generateTargetJson(sourceType, sourceValue) {
  const instructionPrompt = getInstructionPrompt();
  
  // Формируем промпт на основе типа источника
  let userPrompt = '';

  switch (sourceType) {
    case 'url':
      userPrompt = `URL документации API: ${sourceValue}\n\n${instructionPrompt}`;
      break;
    case 'curl':
      userPrompt = `Curl команда:\n${sourceValue}\n\n${instructionPrompt}`;
      break;
    case 'json':
      // Оптимизация: для больших JSON создаём упрощённую версию со структурой и примерами
      let optimizedJson = sourceValue;
      try {
        const parsedJson = JSON.parse(sourceValue);
        // Создаём упрощённую версию: сохраняем структуру, но ограничиваем длину значений
        optimizedJson = JSON.stringify(createOptimizedJsonStructure(parsedJson), null, 2);
      } catch (e) {
        // Если не удалось распарсить, используем оригинал
      }
      
      userPrompt = `Пример JSON-данных:\n${optimizedJson}\n\nПроанализируй этот JSON и создай отдельное поле в массиве "fields" для КАЖДОГО свойства JSON.\n\nВАЖНО:\n- В fields[].data.code: используй двойное подчёркивание "__" вместо точек (например, "vars__name" вместо "vars.name")\n- В request.fields[].data.key: используй точки для маппинга (например, "vars.name")\n- В response.fields[].data.key: используй точки для маппинга (например, "result.data.name")\n\nОпредели тип каждого поля на основе его значения.\n\n${instructionPrompt}`;
      break;
    default:
      throw new Error(`Неизвестный тип источника: ${sourceType}`);
  }

  const result = await generateJsonFromPrompt(userPrompt);
  
  // Сохраняем исходный JSON для определения форматов дат и unix timestamp в постобработке
  let sourceJson = null;
  if (sourceType === 'json') {
    try {
      sourceJson = JSON.parse(sourceValue);
    } catch (e) { /* ignore */ }
  } else if (sourceType === 'curl') {
    // Извлекаем JSON тело из curl команды (ищем первый {...} блок)
    try {
      const jsonMatch = sourceValue.match(/\{[\s\S]*\}/);
      if (jsonMatch) sourceJson = JSON.parse(jsonMatch[0]);
    } catch (e) { /* ignore */ }
  }

  // sourceJsonForFields используется в постобработке rowSections — тот же объект
  const sourceJsonForFields = sourceJson;
  
  // Постобработка: убираем поля, связанные с кастомными полями
  if (result.fields && Array.isArray(result.fields)) {
    result.fields = result.fields.filter(field => {
      if (field.data && field.data.code) {
        const code = field.data.code.replace(/__/g, '.');
        const parts = code.split('.');
        return !parts.some(part => isCustomFieldKey(part));
      }
      return true;
    });
  }
  if (result.request && result.request.fields && Array.isArray(result.request.fields)) {
    result.request.fields = result.request.fields.filter(requestField => {
      if (requestField.data && requestField.data.key) {
        const parts = requestField.data.key.split('.');
        return !parts.some(part => isCustomFieldKey(part));
      }
      return true;
    });
  }

  // Постобработка rowSections: фильтрация, санитизация кодов, уникальность
  if (result.rowSections && Array.isArray(result.rowSections)) {
    // Собираем уже занятые коды из обычных fields
    const usedCodes = new Set();
    if (result.fields && Array.isArray(result.fields)) {
      result.fields.forEach(f => { if (f.data?.code) usedCodes.add(f.data.code); });
    }

    result.rowSections = result.rowSections
      .filter(section => section && section.data) // отбрасываем невалидные
      .map(section => {
        // Санитизируем код секции, находим полный путь, уникализируем
        let rawCode = null; // оригинальный ключ AI (например "contacts")
        if (section.data?.code) {
          rawCode = String(section.data.code).replace(/\./g, '__');
          // Ищем полный путь в исходном JSON: "contacts" → "data__contacts"
          let fullPathCode = rawCode;
          try {
            if (sourceJsonForFields) {
              const fullPath = findJsonArrayPath(sourceJsonForFields, rawCode);
              if (fullPath) fullPathCode = fullPath.replace(/\./g, '__');
            }
          } catch (_) {}
          // Уникализируем
          let code = fullPathCode;
          const base = code;
          let suffix = 2;
          while (usedCodes.has(code)) { code = `${base}_${suffix++}`; }
          section.data.code = code;
          usedCodes.add(code);
        }

        // Убеждаемся, что customFieldsSetLinks есть
        if (!section.customFieldsSetLinks) section.customFieldsSetLinks = [];

        // Обрабатываем поля внутри секции
        if (section.fields && Array.isArray(section.fields)) {
          const newSectionCode = section.data?.code || rawCode || '';
          const oldPrefix = rawCode ? rawCode + '__' : '';

          // Фильтруем кастомные поля
          section.fields = section.fields.filter(field => {
            if (field.data?.code) {
              const parts = String(field.data.code).replace(/__/g, '.').split('.');
              return !parts.some(part => isCustomFieldKey(part));
            }
            return true;
          });

          // Обновляем коды полей: префикс = полный код секции, затем проверяем уникальность
          section.fields = section.fields.map(field => {
            if (field.data?.code) {
              const aiCode = String(field.data.code).replace(/\./g, '__');
              // Извлекаем имя свойства: убираем старый короткий префикс AI
              const propPart = (oldPrefix && aiCode.startsWith(oldPrefix))
                ? aiCode.slice(oldPrefix.length)
                : aiCode;
              // Строим новый код: data__contacts__name
              let code = newSectionCode ? `${newSectionCode}__${propPart}` : propPart;
              const base = code;
              let suffix = 2;
              while (usedCodes.has(code)) { code = `${base}_${suffix++}`; }
              field.data.code = code;
              usedCodes.add(code);
            }

            // Определяем unix timestamp: ищем значение в исходном JSON по пути секции
            if (field.data && field.data.valueType === 2 && sourceJsonForFields && section.data?.code) {
              try {
                // Разворачиваем путь секции: "data__contacts" → ["data", "contacts"]
                const pathParts = section.data.code.replace(/__/g, '.').split('.');
                let arr = sourceJsonForFields;
                for (const part of pathParts) { arr = arr?.[part]; }
                if (Array.isArray(arr) && arr.length > 0) {
                  // Извлекаем имя свойства из кода поля
                  const propPath = field.data.code
                    .slice(section.data.code.length + 2) // убираем "sectionCode__"
                    .replace(/__/g, '.');
                  const val = propPath.includes('.')
                    ? propPath.split('.').reduce((o, k) => o?.[k], arr[0])
                    : arr[0][propPath];
                  if (typeof val === 'number' && Number.isInteger(val)) {
                    if ((val >= 1000000000 && val <= 9999999999) ||
                        (val >= 1000000000000 && val <= 9999999999999)) {
                      field.data.valueType = 5; // DateTime
                    }
                  }
                }
              } catch (_) { /* ignore */ }
            }

            return field;
          });
        } else {
          section.fields = [];
        }

        return section;
      });
  } else {
    result.rowSections = [];
  }

  // Постобработка: заменяем точки на "__" в кодах полей и исправляем типы
  if (result.fields && Array.isArray(result.fields)) {
    result.fields = result.fields.map(field => {
      // Исправляем тип для unix timestamp
      if (field.data && field.data.code && sourceJsonForFields) {
        // Получаем значение из исходного JSON по коду поля
        const code = field.data.code.replace(/__/g, '.'); // Преобразуем код обратно в путь
        const keys = code.split('.');
        let value = sourceJsonForFields;
        for (const k of keys) {
          if (value && typeof value === 'object' && k in value) {
            value = value[k];
          } else {
            value = null;
            break;
          }
        }

        // Если значение - число и выглядит как unix timestamp (10 или 13 цифр)
        // и текущий тип - Int (2), меняем на DateTime (5)
        if (value !== null && typeof value === 'number' && Number.isInteger(value) &&
            field.data.valueType === 2) {
          if ((value >= 1000000000 && value <= 9999999999) || // Секунды (10 цифр)
              (value >= 1000000000000 && value <= 9999999999999)) { // Миллисекунды (13 цифр)
            field.data.valueType = 5; // DateTime
          }
        }
      }

      if (field.data && field.data.code && typeof field.data.code === 'string') {
        // Заменяем точки на двойное подчёркивание в коде
        field.data.code = field.data.code.replace(/\./g, '__');
      }
      return field;
    });
  }

  // Для JSON и curl: все поля по умолчанию редактируемые (isEditable = true)
  if (sourceType === 'json' || sourceType === 'curl') {
    if (result.fields && Array.isArray(result.fields)) {
      result.fields.forEach(field => { if (field.data) field.data.isEditable = true; });
    }
    if (result.rowSections && Array.isArray(result.rowSections)) {
      result.rowSections.forEach(section => {
        (section.fields || []).forEach(field => { if (field.data) field.data.isEditable = true; });
      });
    }
  }

  // Перестраиваем request.fields и response.fields на основе isEditable:
  // isEditable = true → request.fields, isEditable = false → response.fields
  if (!result.request) result.request = {};
  if (!result.request.response || typeof result.request.response !== 'object') {
    result.request.response = {
      data: { format: 0, pathToArray: null, filter: [], useRequestData: 0, preScript: '', postScript: '' },
      fields: [],
      headers: [],
      statusHandlers: [],
      cfsMappings: [],
    };
  }
  result.request.fields = [];
  result.request.response.fields = [];

  // Обычные поля: isEditable=true → request.fields, false → response.fields
  if (result.fields && Array.isArray(result.fields)) {
    for (const field of result.fields) {
      const code = field.data?.code;
      if (!code) continue;
      const key = code.replace(/__/g, '.');
      const valueType = field.data?.valueType || 1;
      const isEditable = !!field.data?.isEditable;

      if (isEditable) {
        result.request.fields.push({
          data: {
            defaultValue: '',
            formatCfg: null,
            key,
            required: field.data?.required || false,
            value: `{{data.${code}}}`,
            valueType,
          },
          children: [],
          cfsMappings: [],
        });
      } else {
        result.request.response.fields.push({
          id: null,
          versionId: null,
          data: {
            key,
            code,
            isInArrayElement: false,
            formatCfg: null,
          },
          children: [],
          cfsMappings: [],
        });
      }
    }
  }

  // Строковые секции: editable поля → request type-99 children, non-editable → response children
  if (result.rowSections && Array.isArray(result.rowSections)) {
    for (const section of result.rowSections) {
      const sectionCode = section.data?.code;
      if (!sectionCode) continue;
      const arrayKeyPath = sectionCode.replace(/__/g, '.');

      const fieldCodeToKey = (fieldCode) => {
        const prefix = sectionCode + '__';
        const stripped = fieldCode.startsWith(prefix) ? fieldCode.slice(prefix.length) : fieldCode;
        return stripped.replace(/__/g, '.');
      };

      const sectionFields = section.fields || [];
      const editableFields = sectionFields.filter(f => !!f.data?.isEditable);
      const nonEditableFields = sectionFields.filter(f => !f.data?.isEditable);

      if (editableFields.length > 0) {
        const requestChildren = editableFields.map(field => ({
          children: [],
          cfsMappings: [],
          data: {
            defaultValue: '',
            formatCfg: null,
            key: fieldCodeToKey(field.data?.code || ''),
            required: field.data?.required || false,
            value: `{{item.${field.data?.code || ''}}}`,
            valueType: field.data?.valueType || 1,
          },
        }));
        result.request.fields.push({
          children: requestChildren,
          cfsMappings: [],
          data: {
            defaultValue: '',
            formatCfg: null,
            key: arrayKeyPath,
            required: false,
            value: sectionCode,
            valueType: 99,
          },
        });
      }

      if (nonEditableFields.length > 0) {
        const responseChildren = nonEditableFields.map(field => ({
          id: null,
          versionId: null,
          data: {
            key: fieldCodeToKey(field.data?.code || ''),
            code: field.data?.code || '',
            isInArrayElement: false,
            formatCfg: null,
          },
          children: [],
          cfsMappings: [],
        }));
        result.request.response.fields.push({
          id: null,
          versionId: null,
          data: {
            key: arrayKeyPath,
            code: sectionCode,
            isInArrayElement: false,
            formatCfg: null,
          },
          children: responseChildren,
          cfsMappings: [],
        });
      }
    }
  }

  // Применяем formatCfg к request.fields (для DateTime, Date, Boolean, Array типов)
  result.request.fields = result.request.fields.map(requestField => {
    if (!requestField.data) return requestField;

    // Для row section (valueType=99) применяем formatCfg к дочерним полям
    if (requestField.data.valueType === 99) {
      requestField.children = (requestField.children || []).map(child => {
        if (!child.data) return child;
        let childValueType = child.data.valueType;
        const childKey = child.data.key;
        const formatCfg = detectFormatCfg(childValueType, childKey, sourceJson);
        if (formatCfg) child.data.formatCfg = formatCfg;
        return child;
      });
      return requestField;
    }

    let valueType = requestField.data.valueType;
    const key = requestField.data.key;

    // Перепроверяем unix timestamp (Int → DateTime)
    if (valueType === 2 && sourceJson && key) {
      const keys = key.split('.');
      let val = sourceJson;
      for (const k of keys) {
        if (val && typeof val === 'object' && k in val) val = val[k];
        else { val = null; break; }
      }
      if (val !== null && typeof val === 'number' && Number.isInteger(val) &&
          ((val >= 1000000000 && val <= 9999999999) || (val >= 1000000000000 && val <= 9999999999999))) {
        valueType = 5;
        requestField.data.valueType = 5;
      }
    }

    const formatCfg = detectFormatCfg(valueType, key, sourceJson);
    if (formatCfg) requestField.data.formatCfg = formatCfg;
    return requestField;
  });

  // Применяем formatCfg к response.fields (для non-editable полей с DateTime, Date и т.д.)
  if (result.request.response && Array.isArray(result.request.response.fields)) {
    const fieldByCode = new Map();
    (result.fields || []).forEach(f => {
      if (f.data?.code) fieldByCode.set(f.data.code, f);
    });

    result.request.response.fields = result.request.response.fields.map(responseField => {
      if (!responseField.data?.code) return responseField;
      const field = fieldByCode.get(responseField.data.code);
      if (!field) return responseField;
      const valueType = field.data?.valueType || 1;
      const key = responseField.data?.key;
      const formatCfg = detectFormatCfg(valueType, key, sourceJson);
      if (formatCfg) responseField.data.formatCfg = formatCfg;
      return responseField;
    });
  }

  return result;
}
