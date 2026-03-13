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
      max_tokens: 16384, // Максимальный вывод для больших JSON
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

/** Карта кодов языков к их полным названиям для промпта AI */
const LANG_NAMES = {
  en: 'English', ru: 'Russian', pt: 'Portuguese', es: 'Spanish',
  tr: 'Turkish', fr: 'French', de: 'German',
};

/** Преобразует код языка в название поля: 'en' → 'titleEn', 'ru' → 'titleRu', 'pt' → 'titlePt' */
function langToTitleKey(lang) {
  return 'title' + lang.charAt(0).toUpperCase() + lang.slice(1);
}

/**
 * Генерирует шаблонную инструкцию для ИИ, описывающую целевой формат JSON
 * @param {string[]} languages - Список кодов языков (например ['en','ru','pt'])
 * @returns {string} - Инструкция в виде текста
 */
export function getInstructionPrompt(languages = ['en', 'ru']) {
  // Строки для шаблона поля: "titleEn": "...", "titleRu": "...", ...
  const fieldTitleLines = languages
    .map(lang => `      "${langToTitleKey(lang)}": "<название на ${LANG_NAMES[lang] || lang}>"`)
    .join(',\n');

  // Строки для шаблона секции rowSections[]
  const sectionTitleLines = languages
    .map(lang => `      "${langToTitleKey(lang)}": "<название секции на ${LANG_NAMES[lang] || lang}>"`)
    .join(',\n');

  // Строки для шаблона поля внутри rowSections[].fields[]
  const sectionFieldTitleLines = languages
    .map(lang => `          "${langToTitleKey(lang)}": "<название поля на ${LANG_NAMES[lang] || lang}>"`)
    .join(',\n');

  // Описание языков для правила 8
  const langListStr = languages.map(lang => `${lang.toUpperCase()} (${LANG_NAMES[lang] || lang})`).join(', ');
  const exampleTitleStr = languages.map(lang => {
    const ex = { en: 'Name', ru: 'Имя', pt: 'Nome', es: 'Nombre', tr: 'İsim', fr: 'Nom', de: 'Name' };
    return `${langToTitleKey(lang)}="${ex[lang] || 'Name'}"`;
  }).join(', ');
  const exampleAmountStr = languages.map(lang => {
    const ex = { en: 'Amount', ru: 'Сумма', pt: 'Valor', es: 'Monto', tr: 'Tutar', fr: 'Montant', de: 'Betrag' };
    return `${langToTitleKey(lang)}="${ex[lang] || 'Amount'}"`;
  }).join(', ');
  const exampleStatusStr = languages.map(lang => {
    const ex = { en: 'Status', ru: 'Статус', pt: 'Status', es: 'Estado', tr: 'Durum', fr: 'Statut', de: 'Status' };
    return `${langToTitleKey(lang)}="${ex[lang] || 'Status'}"`;
  }).join(', ');

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
${fieldTitleLines},
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
${sectionTitleLines},
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
${sectionFieldTitleLines},
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
   - 9 (Boolean) - ТОЛЬКО для настоящих JSON-булевых значений (true/false без кавычек). Строки "0", "1", "true", "false" в кавычках — это String (1), НЕ Boolean!
   - 101 (StringArray) - для массивов строк
   - 102 (IntArray) - для массивов целых чисел
   ВАЖНО: Unix timestamp должен определяться как 5 (DateTime), а НЕ как 2 (Int):
   - Unix timestamp в секундах (10 цифр, значение от 1000000000 до 9999999999, например 1770729544) -> 5 (DateTime)
   - Unix timestamp в миллисекундах (13 цифр, значение от 1000000000000 до 9999999999999, например 1770732087654) -> 5 (DateTime)
   Если число выглядит как unix timestamp (10 или 13 цифр в указанных диапазонах), это дата и время.
   Примеры: строка "test" -> 1, число 42 -> 2, число 3.14 -> 3, unix timestamp в секундах 1770729544 -> 5 (DateTime), unix timestamp в миллисекундах 1770732087654 -> 5 (DateTime), true/false -> 9, массив ["a", "b"] -> 101, массив [1, 2, 3] -> 102.
8. **Названия полей:** Используй осмысленные названия на всех указанных языках: ${langListStr}. ОБЯЗАТЕЛЬНО заполняй названия на КАЖДОМ из перечисленных языков — не пропускай ни один язык. Примеры переводов: для "name" -> ${exampleTitleStr}; для "amount" -> ${exampleAmountStr}; для "status" -> ${exampleStatusStr}.
   ⚠️ **КОНТЕКСТ ДЛЯ ВЛОЖЕННЫХ ПОЛЕЙ:** Если ключ сам по себе неоднозначен (например: id, name, type, month, day, value, text, title, code, order, count, public, flag и т.п.), ОБЯЗАТЕЛЬНО включай в название контекст родительского объекта. Примеры: поле "month" внутри "birthdate" → "Birthdate Month" / "Месяц дня рождения"; поле "id" внутри "pipeline" → "Pipeline ID" / "ID воронки"; поле "name" внутри "column" → "Column Name" / "Название столбца"; поле "public" внутри "profile_ids" → "Profile Public ID" / "Публичный ID профиля". Исключение 1: если ключ уже полностью описывает себя (например, "businessEmail", "fullName", "created_at") — родительский контекст не нужен. Исключение 2: для прямых полей элементов rowSection (массива) НЕ добавляй название самого массива как контекст — пользователь и так видит заголовок секции. Пример: поле "id" внутри массива "lead_lists" → просто "ID" / "ID", НЕ "Lead List ID"; поле "status" → просто "Status" / "Статус".
9. В "request.data.url" ОБЯЗАТЕЛЬНО укажи РЕАЛЬНЫЙ URL из исходных данных (если в исходных данных есть URL, используй его, иначе используй пустую строку, НЕ используй плейсхолдеры типа "<URL внешнего API>")
10. В "request.data.apiDocUrl" укажи URL документации, если он есть в исходных данных, иначе пустую строку (НЕ используй плейсхолдеры)
11. В "request.data.method" укажи код HTTP-метода (0=GET, 1=POST, 2=PUT, 3=DELETE) на основе исходных данных. Если метод не указан, используй 1 (POST) для JSON.
12. В "request.response.fields" добавь поля из ответа API на основе структуры исходных данных (если исходные данные описывают ответ API)
13. Используй разумные значения по умолчанию для обязательных полей
14. Если какое-то поле неизвестно, используй null или пустую строку/массив
15. НИКОГДА не используй плейсхолдеры типа "<URL внешнего API>" или "<URL документации или пустая строка>" - используй реальные значения или пустые строки
16. Всегда возвращай валидный JSON без дополнительного текста
17. **Кастомные поля:** Полностью ИГНОРИРУЙ любые свойства JSON, связанные с кастомными полями (customFields, custom_fields, cfs, cfsMappings, cfs_mappings и их вариации). НЕ создавай для них поля в массиве "fields" и НЕ добавляй их в request.fields. Если встретишь такой ключ — пропусти его целиком вместе со всем содержимым.
18. **Массивы объектов → Строковые секции (rowSections):** Если в JSON встречается свойство, значение которого является МАССИВОМ ОБЪЕКТОВ (например "items": [{"id": 1, "name": "foo"}, ...]), создай для него запись в массиве "rowSections" вместо обычного поля в "fields". НЕ создавай такой ключ в "fields". Поля строковой секции формируй на основе свойств ПЕРВОГО элемента массива. Массивы примитивов (строк, чисел) — это обычные поля типа StringArray (101) или IntArray (102), их в rowSections НЕ помещай. КРИТИЧЕСКИ ВАЖНО: НЕ добавляй в массив "fields" поля, которые являются свойствами элементов массива объектов — они должны быть ТОЛЬКО в rowSections[].fields. Плоские свойства JSON (строки, числа, булевы и т.д.) ВСЕГДА помещай в "fields" как обычно — даже если рядом есть массивы объектов. Массив "fields" бывает пустым [] ТОЛЬКО если в JSON вообще нет плоских свойств (есть лишь массивы объектов).
   ⚠️ КРИТИЧЕСКИ ВАЖНО — ОБЫЧНЫЕ ОБЪЕКТЫ (не массивы!): Если значение свойства является обычным объектом (не массивом!), например {"buyer": {"firstName": "John", "lastName": "Doe"}}, — это НЕ rowSection! Обычные вложенные объекты ВСЕГДА разворачивай в плоские поля через "__" нотацию и помещай в "fields". rowSections используются ИСКЛЮЧИТЕЛЬНО для массивов объектов ([{...}, {...}]).
   Пример 1 — только массив объектов, нет плоских полей, JSON {"lead_lists": [{"id": "abc", "name": "List 1"}]}:
   ПРАВИЛЬНО: "fields": [], "rowSections": [{"data": {"code": "lead_lists"}, "fields": [{"data": {"code": "lead_lists__id"}}, {"data": {"code": "lead_lists__name"}}]}]
   НЕПРАВИЛЬНО: "fields": [{"data": {"code": "lead_lists__id"}}, {"data": {"code": "lead_lists__name"}}], "rowSections": []
   Пример 2 — смешанный, JSON {"orgId": 123, "rev": "abc", "lead_lists": [{"id": "x", "name": "y"}]}:
   ПРАВИЛЬНО: "fields": [{"data": {"code": "orgId"}}, {"data": {"code": "rev"}}], "rowSections": [{"data": {"code": "lead_lists"}, "fields": [{"data": {"code": "lead_lists__id"}}, {"data": {"code": "lead_lists__name"}}]}]
   НЕПРАВИЛЬНО: "fields": [], "rowSections": [...]  — нельзя опускать плоские поля orgId и rev!
   Пример 3 — вложенные объекты (НЕ массивы!), JSON {"name": "Acme", "buyer": {"firstName": "John", "email": "j@e.com"}, "salesRep": {"firstName": "Jane", "email": "s@e.com"}}:
   ПРАВИЛЬНО: "fields": [{"data": {"code": "name"}}, {"data": {"code": "buyer__firstName"}}, {"data": {"code": "buyer__email"}}, {"data": {"code": "salesRep__firstName"}}, {"data": {"code": "salesRep__email"}}], "rowSections": []
   НЕПРАВИЛЬНО: "fields": [{"data": {"code": "name"}}], "rowSections": [{"data": {"code": "buyer"}, ...}, {"data": {"code": "salesRep"}, ...}]  — buyer и salesRep это объекты, а не массивы, поэтому они НЕ идут в rowSections!
   Пример 4 — плоские ключи с "__" (уже являются путями, НЕ надо создавать rowSection!), JSON {"id": "123", "status__name": "Open", "status__default": false, "owner__email": "a@b.com"}:
   ПРАВИЛЬНО: "fields": [{"data": {"code": "id"}}, {"data": {"code": "status__name"}}, {"data": {"code": "status__default"}}, {"data": {"code": "owner__email"}}], "rowSections": []
   НЕПРАВИЛЬНО: "fields": [{"data": {"code": "id"}}], "rowSections": [{"data": {"code": "status"}, "fields": [...]}, {"data": {"code": "owner"}, "fields": [...]}]  — ключи "status__name", "status__default", "owner__email" уже плоские, они НЕ являются массивами и НЕ идут в rowSections!
19. **Коды строковых секций и их полей:** Код самой секции должен отражать ПОЛНЫЙ путь к массиву, используя "__" вместо точек (так же как и обычные поля). Например, если JSON содержит {"data": {"contacts": [...]}}, то код секции должен быть "data__contacts". Для полей внутри rowSections используй префикс в виде кода секции: "{код_секции}__{имя_свойства}". Например, "data__contacts__name". КРИТИЧЕСКИ ВАЖНО: НИКОГДА не используй числовые индексы в кодах полей строковых секций. Правильно: "lead_lists__id", "lead_lists__name". НЕПРАВИЛЬНО: "lead_lists__0__id", "lead_lists__0__name". Индексы массива в кодах полей недопустимы.
20. **Глобальная уникальность кодов:** Все коды во всех массивах (fields[].data.code, rowSections[].data.code, rowSections[].fields[].data.code) должны быть ГЛОБАЛЬНО УНИКАЛЬНЫМИ — никакие два кода не должны совпадать между собой.`;
}

/** Максимальное кол-во ключей JSON в одном батч-вызове AI */
const FIELDS_BATCH_SIZE = 40;

/**
 * Упрощённый промпт для генерации ТОЛЬКО fields[] и rowSections[] (без request).
 * Используется при батчинге больших JSON.
 */
function getFieldsOnlyPrompt(languages) {
  const fieldTitleLines = languages
    .map(lang => `      "${langToTitleKey(lang)}": "<название на ${LANG_NAMES[lang] || lang}>"`)
    .join(',\n');
  const sectionTitleLines = languages
    .map(lang => `      "${langToTitleKey(lang)}": "<название секции на ${LANG_NAMES[lang] || lang}>"`)
    .join(',\n');
  const sectionFieldTitleLines = languages
    .map(lang => `          "${langToTitleKey(lang)}": "<название поля на ${LANG_NAMES[lang] || lang}>"`)
    .join(',\n');
  const langListStr = languages.map(lang => `${lang.toUpperCase()} (${LANG_NAMES[lang] || lang})`).join(', ');

  return `Проанализируй JSON и сгенерируй объект ТОЛЬКО с "fields" и "rowSections":
{
  "fields": [
    {
      "id": null,
      "versionId": null,
      "data": {
        "code": "<код через __ вместо точек>",
        "valueType": <1=строка,2=int,3=decimal,5=datetime,8=date,9=bool,101=string[],102=int[]>,
        "required": false,
        "isEditable": true,
        "dateCreated": "<YYYY-MM-DD HH:mm:ss>"
      },
      "enumId": null,
${fieldTitleLines},
      "hintEn": null,
      "hintRu": null
    }
  ],
  "rowSections": [
    {
      "id": null, "versionId": null,
      "data": { "code": "<код>", "customFieldsIsEditable": false, "customFieldsIsRequired": false },
${sectionTitleLines},
      "fields": [
        {
          "id": null, "versionId": null,
          "data": { "code": "<секция__поле>", "valueType": 1, "required": false, "isEditable": true, "dateCreated": "<YYYY-MM-DD HH:mm:ss>" },
          "enumId": null,
${sectionFieldTitleLines}
        }
      ],
      "customFieldsSetLinks": []
    }
  ]
}
ПРАВИЛА:
1. Создай поле в "fields" для КАЖДОГО свойства JSON, включая null (для null → valueType=1).
2. Коды: если ключ уже содержит __ (например "csr__phone") — используй его КАК ЕСТЬ, не добавляй префиксы. Вложенные объекты разворачивай в плоские коды через __ только если во входном JSON есть реальная вложенность.
3. СТРОГО: генерируй поля ТОЛЬКО для ключей из входного JSON. Не придумывай и не добавляй поля, которых нет во входном JSON.
4. Массивы объектов → rowSections. Массивы примитивов → поля типа 101/102 в fields.
5. Типы: ISO-дата → 5, дата без времени → 8, bool → 9, int → 2, decimal → 3, строка → 1.
6. Названия полей на ВСЕХ языках: ${langListStr}. Осмысленные переводы.
7. Игнорируй ключи customFields, custom_fields, cfs, cfsMappings и их вариации.
8. Все коды должны быть уникальными. Не используй числовые индексы в кодах (lead__0__id → НЕПРАВИЛЬНО).
9. Возвращай ТОЛЬКО валидный JSON без пояснений.`;
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
 * Рекурсивно "уплощает" вложенный JSON в плоский словарь с ключами через "__".
 * Используется для корректного подсчёта листовых полей и батч-сплита независимо от уровня вложенности.
 * Массивы не раскрываются (остаются листом — AI обработает как rowSection).
 * Пустые объекты {} пропускаются.
 * @param {Object} obj - Входной JSON объект
 * @param {string} prefix - Накопленный префикс (через "__")
 * @returns {Object} - Плоский словарь {code: value}
 */
function flattenJsonForBatch(obj, prefix = '') {
  const result = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return result;
  for (const [key, value] of Object.entries(obj)) {
    if (isCustomFieldKey(key)) continue;
    const code = prefix ? `${prefix}__${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0) {
      // Непустой объект — уходим глубже
      Object.assign(result, flattenJsonForBatch(value, code));
    } else {
      // Лист: примитив, null, массив или пустой объект
      result[code] = value;
    }
  }
  return result;
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
 * Сканирует sourceJson и определяет наиболее часто встречающийся формат дат
 * среди ненулевых значений DateTime/Date. Используется как fallback для полей с null-значением.
 * @param {Object} sourceJson - Исходный JSON объект
 * @returns {Object|null} - formatCfg объект или null если даты не найдены
 */
function detectCommonDateFormat(sourceJson) {
  if (!sourceJson || typeof sourceJson !== 'object') return null;
  const formatCounts = new Map();

  const scan = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const value of Object.values(obj)) {
      if (typeof value === 'string' && value.length >= 10) {
        let fmt = null, tz = '+0000';
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
          fmt = 'Y-m-d\\TH:i:s.v\\Z';
        } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]/.test(value)) {
          const m = value.match(/([+-]\d{2}):(\d{2})$/);
          if (m) tz = m[1] + m[2];
          fmt = 'Y-m-d\\TH:i:s.vp';
        } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) {
          fmt = 'Y-m-d\\TH:i:s\\Z';
        } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]/.test(value)) {
          const m = value.match(/([+-]\d{2}):(\d{2})$/);
          if (m) tz = m[1] + m[2];
          fmt = 'Y-m-d\\TH:i:sP';
        } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
          fmt = 'Y-m-d H:i:s';
        }
        if (fmt) {
          const existing = formatCounts.get(fmt);
          if (existing) { existing.count++; }
          else { formatCounts.set(fmt, { count: 1, cfg: { format: fmt, timezone: tz, valueType: 1 } }); }
        }
      } else if (value && typeof value === 'object') {
        scan(value);
      }
    }
  };
  scan(sourceJson);

  if (formatCounts.size === 0) return null;
  let best = null;
  for (const { count, cfg } of formatCounts.values()) {
    if (!best || count > best.count) best = { count, cfg };
  }
  return best?.cfg || null;
}

/**
 * Определяет formatCfg для поля на основе типа и значения в исходном JSON.
 * @param {number} valueType - Тип поля
 * @param {string} key - dot-notation путь к значению в JSON
 * @param {any} sourceJson - Исходный JSON объект (или null)
 * @param {Object|null} [commonDateFormatCfg] - Общий формат дат из JSON (fallback для null-значений)
 * @returns {Object|null} - Объект formatCfg или null
 */
function detectFormatCfg(valueType, key, sourceJson, commonDateFormatCfg = null) {
  if (valueType === 5 || valueType === 8) {
    let detectedFormat = null;
    let detectedTimezone = '+0000';
    let detectedValueType = 1;
    let valueIsNull = true; // признак что у поля нет примера значения

    if (sourceJson && key) {
      const keys = key.split('.');
      let val = sourceJson;
      for (const k of keys) {
        if (val && typeof val === 'object' && k in val) val = val[k];
        else { val = null; break; }
      }
      if (val !== null && val !== undefined) {
        valueIsNull = false;
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

    // Если значение null и нет определённого формата — используем общий формат из JSON
    if (valueIsNull && !detectedFormat && commonDateFormatCfg) {
      return commonDateFormatCfg;
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
 * Преобразует code поля (через __) в ключ запроса (через точки),
 * учитывая реальную структуру sourceJson.
 *
 * Проблема: top-level ключи вида "statusSetBy__active" — это LITERAL ключи JSON,
 * а не вложенность. Слепая замена __ → . даёт неверный "statusSetBy.active".
 *
 * Алгоритм: рекурсивно пробуем пройти путь по sourceJson, предпочитая короткие
 * сегменты (реальная вложенность), но если сегмент не является объектом —
 * пробуем объединить его с соседними через __ (literal ключ).
 *
 * @param {string} code - код поля, например "statusSetBy__active" или "buyer__firstName"
 * @param {Object|null} sourceJson - исходный JSON объект
 * @returns {string} - ключ для request.fields, например "statusSetBy__active" или "buyer.firstName"
 */
function codeToRequestKey(code, sourceJson) {
  if (!sourceJson || typeof sourceJson !== 'object') return code.replace(/__/g, '.');

  // Fast path: если весь code целиком является ключом верхнего уровня —
  // это литеральный ключ (например "statusSetBy__active"), возвращаем как есть.
  if (Object.prototype.hasOwnProperty.call(sourceJson, code)) return code;

  const parts = code.split('__');

  // Рекурсивно ищет путь в obj по оставшимся сегментам.
  // Возвращает строку-ключ если нашли, null если нет.
  const resolve = (remaining, obj, accumulated) => {
    if (remaining.length === 0) return accumulated;
    if (obj === null || obj === undefined || typeof obj !== 'object' || Array.isArray(obj)) return null;

    // Пробуем взять n сегментов как один literal ключ (n=1,2,3,...)
    for (let n = 1; n <= remaining.length; n++) {
      const key = remaining.slice(0, n).join('__');
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const nextAcc = accumulated ? `${accumulated}.${key}` : key;
        if (n === remaining.length) return nextAcc; // последний сегмент — готово
        const deeper = resolve(remaining.slice(n), obj[key], nextAcc);
        if (deeper !== null) return deeper;
        // Нашли ключ, но не смогли пройти глубже — пробуем следующий n
      }
    }
    return null;
  };

  const resolved = resolve(parts, sourceJson, '');
  return resolved !== null ? resolved : code.replace(/__/g, '.');
}

/**
 * Генерирует целевой JSON (fields и request) на основе источника данных
 * @param {string} sourceType - Тип источника: 'url', 'curl', 'json'
 * @param {string} sourceValue - Содержимое источника
 * @param {string[]} languages - Список кодов языков для генерации названий полей
 * @returns {Promise<Object>} - Объект с полями fields и request
 */
export async function generateTargetJson(sourceType, sourceValue, languages = ['en', 'ru']) {
  const instructionPrompt = getInstructionPrompt(languages);

  // Формируем промпт на основе типа источника
  let userPrompt = '';
  let batchedResult = null; // Результат батч-генерации для больших JSON

  switch (sourceType) {
    case 'url':
      userPrompt = `URL документации API: ${sourceValue}\n\n${instructionPrompt}`;
      break;
    case 'curl':
      userPrompt = `Curl команда:\n${sourceValue}\n\n${instructionPrompt}`;
      break;
    case 'json': {
      // Оптимизация: для больших JSON создаём упрощённую версию со структурой и примерами
      let optimizedJson = sourceValue;
      try {
        const parsedJson = JSON.parse(sourceValue);
        // Уплощаем JSON до листовых полей с ключами через "__" для корректного подсчёта.
        // Это позволяет батчиться даже если все поля вложены в один объект (напр. { data: { ...260 полей... } }).
        const flatJson = flattenJsonForBatch(parsedJson);
        const allKeys = Object.keys(flatJson);

        // Батч-генерация для больших JSON (>FIELDS_BATCH_SIZE листовых полей)
        if (allKeys.length > FIELDS_BATCH_SIZE) {
          const totalBatches = Math.ceil(allKeys.length / FIELDS_BATCH_SIZE);
          console.log(`[AI] Большой JSON: ${allKeys.length} листовых полей. Параллельная батч-генерация (${totalBatches} батчей).`);

          // Формируем все батчи сразу из плоского представления
          const batches = [];
          for (let i = 0; i < allKeys.length; i += FIELDS_BATCH_SIZE) {
            const batchIndex = Math.ceil(i / FIELDS_BATCH_SIZE) + 1;
            const batchKeys = allKeys.slice(i, i + FIELDS_BATCH_SIZE);
            const batchJson = {};
            batchKeys.forEach(k => { batchJson[k] = flatJson[k]; });
            const batchOptimized = JSON.stringify(createOptimizedJsonStructure(batchJson), null, 2);
            // Разделяем ключи: обычные поля (жёсткое ограничение кодов) vs массивы объектов
            // (rowSections — подполя генерируются свободно из структуры массива)
            const arrayOfObjectKeys = batchKeys.filter(k => {
              const v = flatJson[k];
              return Array.isArray(v) && v.length > 0 && v[0] !== null && typeof v[0] === 'object';
            });
            const regularKeys = batchKeys.filter(k => !arrayOfObjectKeys.includes(k));
            const allowedCodesLine = regularKeys.length > 0
              ? `РАЗРЕШЁННЫЕ КОДЫ для полей (используй ТОЛЬКО эти, точно как написано, без изменений): ${regularKeys.join(', ')}`
              : '';
            const arrayCodesLine = arrayOfObjectKeys.length > 0
              ? `МАССИВЫ ОБЪЕКТОВ → rowSections (создай секцию для каждого и сгенерируй подполя из структуры элементов массива): ${arrayOfObjectKeys.join(', ')}`
              : '';
            const constraintLines = [allowedCodesLine, arrayCodesLine].filter(Boolean).join('\n');
            const batchPrompt = `Пример JSON-данных:\n${batchOptimized}\n\n${constraintLines}\n\n${getFieldsOnlyPrompt(languages)}`;
            batches.push({ batchIndex, batchPrompt });
          }

          // Запускаем все батчи параллельно
          const batchResults = await Promise.all(
            batches.map(({ batchIndex, batchPrompt }) =>
              generateJsonFromPrompt(batchPrompt)
                .then(res => {
                  console.log(`[AI] Батч ${batchIndex}/${totalBatches}: получено ${res.fields?.length || 0} полей`);
                  return res;
                })
                .catch(e => {
                  console.warn(`[AI] Батч ${batchIndex}/${totalBatches} не удался: ${e.message}`);
                  return { fields: [], rowSections: [] };
                })
            )
          );

          // Мержим результаты в исходном порядке ключей
          const allFields = batchResults.flatMap(r => r.fields || []);
          const allRowSections = batchResults.flatMap(r => r.rowSections || []);

          batchedResult = {
            fields: allFields,
            rowSections: allRowSections,
            request: {
              data: { url: '', method: 1, format: 0, content: '', urlEncodeType: 0, filter: [], filterType: 2, preScript: '', postScript: '', apiDocUrl: '' },
              authId: null, certificateId: null, paginationId: null, signatureId: null,
              fields: [], headers: [],
              response: { data: { format: 0, pathToArray: null, filter: [], useRequestData: 0, preScript: '', postScript: '' }, fields: [], headers: [], statusHandlers: [], cfsMappings: [] },
              cfsMappings: [],
            },
          };
        } else {
          // Создаём упрощённую версию: сохраняем структуру, но ограничиваем длину значений
          optimizedJson = JSON.stringify(createOptimizedJsonStructure(parsedJson), null, 2);
          userPrompt = `Пример JSON-данных:\n${optimizedJson}\n\nПроанализируй этот JSON и создай отдельное поле в массиве "fields" для КАЖДОГО свойства JSON.\n\nВАЖНО:\n- В fields[].data.code: используй двойное подчёркивание "__" вместо точек (например, "vars__name" вместо "vars.name")\n- В request.fields[].data.key: используй точки для маппинга (например, "vars.name")\n- В response.fields[].data.key: используй точки для маппинга (например, "result.data.name")\n\nОпредели тип каждого поля на основе его значения.\n\n${instructionPrompt}`;
        }
      } catch (e) {
        // Если не удалось распарсить, используем оригинал
        userPrompt = `Пример JSON-данных:\n${sourceValue}\n\nПроанализируй этот JSON и создай отдельное поле в массиве "fields" для КАЖДОГО свойства JSON.\n\nВАЖНО:\n- В fields[].data.code: используй двойное подчёркивание "__" вместо точек (например, "vars__name" вместо "vars.name")\n- В request.fields[].data.key: используй точки для маппинга (например, "vars.name")\n- В response.fields[].data.key: используй точки для маппинга (например, "result.data.name")\n\nОпредели тип каждого поля на основе его значения.\n\n${instructionPrompt}`;
      }
      break;
    }
    default:
      throw new Error(`Неизвестный тип источника: ${sourceType}`);
  }

  const result = batchedResult || await generateJsonFromPrompt(userPrompt);

  // Логируем сырой ответ AI до постобработки
  console.log('[AI RAW RESPONSE]', JSON.stringify({
    fieldsCount: result.fields?.length,
    rowSectionsCount: result.rowSections?.length,
    fields: result.fields?.map(f => ({ code: f.data?.code, valueType: f.data?.valueType, titleEn: f.titleEn })),
    rowSections: result.rowSections?.map(s => ({ code: s.data?.code, fieldsCount: s.fields?.length, fields: s.fields?.map(f => ({ code: f.data?.code, valueType: f.data?.valueType })) })),
  }, null, 2));

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
  // Плоский словарь всех допустимых кодов (ключи через __) — для быстрой проверки галлюцинаций
  const sourceJsonFlatKeys = sourceJson ? new Set(Object.keys(flattenJsonForBatch(sourceJson))) : null;
  
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

  // Инициализируем rowSections если AI не вернул это поле
  if (!Array.isArray(result.rowSections)) result.rowSections = [];

  // Рекурсивный поиск значения в sourceJson с поддержкой промежуточных leading-underscore объектов.
  // AI иногда пропускает такие ключи (напр. _lead_info) при генерации кодов.
  const resolveWithIntermediates = (obj, ks) => {
    if (ks.length === 0) return obj;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
    const [k, ...rest] = ks;
    if (k in obj) return resolveWithIntermediates(obj[k], rest);
    for (const [vk, vv] of Object.entries(obj)) {
      if (vk.startsWith('_') && vv !== null && typeof vv === 'object' && !Array.isArray(vv)) {
        const found = resolveWithIntermediates(vv, ks);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };

  // Fix 1: Убираем несуществующие и пустые поля.
  // (а) Поля, которых нет в source JSON вообще — AI-галлюцинации при батчевой генерации.
  //     Например, AI видит "status__name" и придумывает "status__statusSetBy__name".
  // (б) Поля для пустых объектов (например "workflowData": {}, "translationData": {}).
  if (sourceJsonForFields && result.fields && Array.isArray(result.fields)) {
    result.fields = result.fields.filter(field => {
      if (!field.data?.code) return true;
      const code = (field.data.code || '').replace(/\./g, '__');
      // Сначала проверяем, существует ли код как буквальный ключ верхнего уровня
      // (например "statusSetBy__name" — это реальный ключ, не вложенный путь)
      const isLiteralKey = Object.prototype.hasOwnProperty.call(sourceJsonForFields, code);
      // Проверяем наличие в плоском словаре листовых ключей (быстрая проверка)
      const isKnownFlatKey = sourceJsonFlatKeys ? sourceJsonFlatKeys.has(code) : true;
      const value = isLiteralKey
        ? sourceJsonForFields[code]
        : resolveWithIntermediates(sourceJsonForFields, code.split('__'));
      // (а) Путь не существует ни как буквальный ключ, ни как вложенный, ни в плоском словаре — галлюцинация
      if (!isLiteralKey && !isKnownFlatKey && value === undefined) return false;
      // (б) Значение — пустой объект {} — маппить нечего, пропускаем
      if (value !== null && value !== undefined && typeof value === 'object'
          && !Array.isArray(value) && Object.keys(value).length === 0) {
        return false;
      }
      return true;
    });
  }

  // Fix 2: Определяем общий формат дат из ненулевых значений в sourceJson.
  // Используется как fallback для полей с null-значением (например "pendingPurgeDate": null).
  const commonDateFormatCfg = detectCommonDateFormat(sourceJson);

  // Демотирование: если AI ошибочно поместил обычный объект (не массив!) в rowSections,
  // возвращаем его поля обратно в result.fields и удаляем секцию.
  if (sourceJsonForFields && result.rowSections.length > 0) {
    if (!Array.isArray(result.fields)) result.fields = [];
    result.rowSections = result.rowSections.filter(section => {
      if (!section?.data?.code) return false;
      const codePath = String(section.data.code).replace(/__/g, '.');
      const keys = codePath.split('.');
      const val = resolveWithIntermediates(sourceJsonForFields, keys);
      // Если значение является массивом объектов — оставляем секцию
      if (Array.isArray(val) && val.length > 0 && val[0] !== null && typeof val[0] === 'object') {
        return true;
      }
      // Иначе — демотируем: переносим поля секции в result.fields с нормализованными кодами
      const sectionCode = String(section.data.code).replace(/\./g, '__');
      if (section.fields && Array.isArray(section.fields) && section.fields.length > 0) {
        const prefix = sectionCode + '__';
        const demotedFields = section.fields
          .map(f => {
            if (!f?.data?.code) return f;
            const aiCode = String(f.data.code).replace(/\./g, '__');
            const normalizedCode = aiCode.startsWith(prefix) ? aiCode : `${sectionCode}__${aiCode}`;
            return { ...f, data: { ...f.data, code: normalizedCode } };
          })
          .filter(f => {
            // Применяем тот же фильтр галлюцинаций что и для result.fields:
            // если код не существует в sourceJson ни как буквальный ключ, ни как путь — это галлюцинация
            if (!f?.data?.code || !sourceJsonForFields) return true;
            const code = f.data.code.replace(/\./g, '__');
            const isLiteralKey = Object.prototype.hasOwnProperty.call(sourceJsonForFields, code);
            if (isLiteralKey) return true;
            const isKnownFlatKey = sourceJsonFlatKeys ? sourceJsonFlatKeys.has(code) : true;
            if (isKnownFlatKey) return true;
            const value = resolveWithIntermediates(sourceJsonForFields, code.split('__'));
            return value !== undefined;
          });
        result.fields.push(...demotedFields);
      }
      return false; // удаляем секцию из rowSections
    });
  }

  // Авто-продвижение: если AI поместил поля элементов массива в result.fields вместо rowSections,
  // автоматически определяем такие поля по исходному JSON и перемещаем их в rowSection.
  if (sourceJsonForFields && result.fields && Array.isArray(result.fields)) {
    const findArrayObjectPaths = (obj, prefix = '') => {
      const paths = [];
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return paths;
      for (const [key, value] of Object.entries(obj)) {
        if (isCustomFieldKey(key)) continue;
        const path = prefix ? `${prefix}__${key}` : key;
        if (Array.isArray(value) && value.length > 0 && value[0] !== null && typeof value[0] === 'object') {
          paths.push(path);
        } else if (value && typeof value === 'object' && !Array.isArray(value)) {
          paths.push(...findArrayObjectPaths(value, path));
        }
      }
      return paths;
    };

    for (const arrayPath of findArrayObjectPaths(sourceJsonForFields)) {
      // Пропускаем, если rowSection для этого пути уже существует
      if (result.rowSections.some(s => (s.data?.code || '').replace(/\./g, '__') === arrayPath)) continue;

      // Ищем в result.fields поля, относящиеся к элементам этого массива
      const promoted = result.fields.filter(f => {
        const code = (f.data?.code || '').replace(/\./g, '__');
        return code.startsWith(arrayPath + '__');
      });
      if (promoted.length === 0) continue;

      // Создаём rowSection из найденных полей и добавляем в список
      const titleWords = arrayPath.replace(/__/g, ' ');
      const sectionTitles = {};
      for (const lang of languages) {
        const key = langToTitleKey(lang);
        if (lang === 'ru') {
          sectionTitles[key] = titleWords;
        } else {
          sectionTitles[key] = titleWords.replace(/\b\w/g, l => l.toUpperCase());
        }
      }
      result.rowSections.push({
        id: null,
        versionId: null,
        data: { code: arrayPath, customFieldsIsEditable: false, customFieldsIsRequired: false },
        ...sectionTitles,
        fields: promoted,
        customFieldsSetLinks: [],
      });

      // Удаляем продвинутые поля (и поле-заглушку самого ключа-массива) из result.fields
      result.fields = result.fields.filter(f => {
        const code = (f.data?.code || '').replace(/\./g, '__');
        return !code.startsWith(arrayPath + '__') && code !== arrayPath;
      });
    }
  }

  // Постобработка rowSections: фильтрация, санитизация кодов, уникальность
  if (result.rowSections && Array.isArray(result.rowSections)) {
    // Предварительно собираем сырые коды секций (до полной обработки),
    // чтобы исключить перекрывающиеся коды из usedCodes и избежать ложных суффиксов "_2"
    const rawSectionKeys = result.rowSections
      .filter(s => s && s.data?.code)
      .map(s => String(s.data.code).replace(/\./g, '__'));

    // Собираем уже занятые коды из обычных fields,
    // НЕ включая коды, которые перекрываются с rowSections (они будут удалены позже)
    const usedCodes = new Set();
    if (result.fields && Array.isArray(result.fields)) {
      result.fields.forEach(f => {
        const code = (f.data?.code || '').replace(/\./g, '__');
        if (!code) return;
        const overlaps = rawSectionKeys.some(sk => code === sk || code.startsWith(sk + '__'));
        if (!overlaps) usedCodes.add(code);
      });
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
              const rawPropPart = (oldPrefix && aiCode.startsWith(oldPrefix))
                ? aiCode.slice(oldPrefix.length)
                : aiCode;
              // Убираем числовой индекс массива, если AI сгенерировал его ошибочно
              // Например: "0__id" → "id", "1__name" → "name"
              const propPart = rawPropPart.replace(/^\d+__/, '');
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

  // Удаляем из result.fields поля, которые дублируют rowSections:
  // AI иногда генерирует и rowSection, и обычные поля с индексным маппингом
  // (например lead_lists__0__id) для одного и того же массива объектов.
  if (result.rowSections.length > 0 && result.fields && Array.isArray(result.fields)) {
    const sectionCodes = new Set(result.rowSections.map(s => s.data?.code).filter(Boolean));
    result.fields = result.fields.filter(field => {
      const code = (field.data?.code || '').replace(/\./g, '__');
      if (!code) return true;
      for (const sectionCode of sectionCodes) {
        if (code === sectionCode || code.startsWith(sectionCode + '__')) {
          return false;
        }
      }
      return true;
    });
  }

  // RowSection gap-filling: создаём rowSections для массивов объектов, пропущенных AI.
  // Рекурсивно обходит sourceJson и создаёт недостающие секции (включая вложенные).
  if (sourceJsonForFields) {
    if (!Array.isArray(result.rowSections)) result.rowSections = [];
    const normCode = (c) => c.split('__').map(s => s.replace(/^_+/, '')).join('__');
    // collapseCode: убирает промежуточные leading-underscore сегменты (AI их пропускает при генерации)
    // и стрипует leading underscores с последнего сегмента.
    // profile___lead_info__work_experience → profile__work_experience
    // profile___messages → profile__messages
    const collapseCode = (c) => c.split('__')
      .filter((s, i, arr) => i === arr.length - 1 || !s.startsWith('_'))
      .map(s => s.replace(/^_+/, ''))
      .join('__');
    const existingSectionCodes = new Set(
      result.rowSections.map(s => (s.data?.code || '').replace(/\./g, '__'))
    );
    const normalizedSectionCodes = new Set([...existingSectionCodes].map(normCode));
    const collapsedSectionCodes = new Set([...existingSectionCodes].map(collapseCode));
    const missingSections = [];

    const findMissingArrays = (obj, prefix = '') => {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
      for (const [key, value] of Object.entries(obj)) {
        if (isCustomFieldKey(key)) continue;
        const code = prefix ? `${prefix}__${key}` : key;
        if (Array.isArray(value) && value.length > 0 && value[0] !== null && typeof value[0] === 'object') {
          if (!existingSectionCodes.has(code) && !normalizedSectionCodes.has(normCode(code)) && !collapsedSectionCodes.has(collapseCode(code))) {
            missingSections.push({ code, firstItem: value[0] });
            existingSectionCodes.add(code);
            normalizedSectionCodes.add(normCode(code));
            collapsedSectionCodes.add(collapseCode(code));
          }
        } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          findMissingArrays(value, code);
        }
      }
    };
    findMissingArrays(sourceJsonForFields);

    if (missingSections.length > 0) {
      // Определяет valueType из значения (включая строковые unix timestamp)
      const detectValueTypeFromValue = (v) => {
        if (Array.isArray(v)) {
          const first = v.find(item => item !== null && item !== '');
          return (first !== undefined && typeof first === 'number') ? 102 : 101;
        }
        if (typeof v === 'boolean') return 9;
        if (typeof v === 'number') {
          if (Number.isInteger(v)) {
            return ((v >= 1e9 && v <= 9999999999) || (v >= 1e12 && v <= 9999999999999)) ? 5 : 2;
          }
          return 3;
        }
        if (typeof v === 'string') {
          if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return 5;
          if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return 4;
          const n = parseInt(v, 10);
          if (!isNaN(n) && String(n) === v) {
            if ((n >= 1e9 && n <= 9999999999) || (n >= 1e12 && n <= 9999999999999)) return 5;
            // Строковые числа ("105", "0") остаются String — только unix timestamp определяем выше
          }
        }
        return 1;
      };

      // Строит поля секции из первого элемента массива
      const buildSectionFields = (item, sectionCode) => {
        const fields = [];
        // Генерирует заголовок с родительским контекстом (всегда, если есть родитель)
        const toTitleCase = (s) => s.replace(/\b\w/g, c => c.toUpperCase());
        const segToTitle = (s) => toTitleCase(s.replace(/^_+/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2'));
        const makeAutoTitle = (k, codeStr) => {
          const leafTitle = segToTitle(k);
          const parts = codeStr.split('__');
          if (parts.length >= 3) {
            return `${segToTitle(parts[parts.length - 2])} ${leafTitle}`;
          }
          return leafTitle;
        };
        const recurse = (obj, prefix) => {
          for (const [k, v] of Object.entries(obj)) {
            if (isCustomFieldKey(k)) continue;
            const fieldCode = `${prefix}__${k}`;
            if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
              recurse(v, fieldCode);
            } else if (!Array.isArray(v) || v.length === 0 || typeof v[0] !== 'object') {
              const valueType = detectValueTypeFromValue(v);
              const autoTitle = makeAutoTitle(k, fieldCode);
              const fieldTitles = {};
              for (const lang of languages) fieldTitles[langToTitleKey(lang)] = autoTitle;
              fields.push({
                id: null, versionId: null,
                data: { code: fieldCode, isEditable: true, isRequired: false, valueType, formatCfg: null },
                ...fieldTitles, children: [], cfsMappings: [],
              });
            }
          }
        };
        recurse(item, sectionCode);
        return fields;
      };

      const newSections = missingSections.map(({ code, firstItem }) => {
        const sectionFields = buildSectionFields(firstItem, code);
        const sectionTitleWord = code.split('__').pop()
          .replace(/^_+/, '')
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .replace(/^./, c => c.toUpperCase());
        const sectionTitles = {};
        for (const lang of languages) sectionTitles[langToTitleKey(lang)] = sectionTitleWord;
        return {
          id: null, versionId: null,
          data: { code, customFieldsIsEditable: false, customFieldsIsRequired: false },
          ...sectionTitles, fields: sectionFields, customFieldsSetLinks: [],
        };
      });

      // Вторичный AI-вызов для перевода: отправляем авто-заголовки (с контекстом), а не сырые ключи
      try {
        const enKey = langToTitleKey(languages.includes('en') ? 'en' : languages[0]);
        // Строим map: авто-заголовок → [объекты для применения перевода]
        const titleMap = new Map();
        const registerTitle = (obj) => {
          const title = obj[enKey];
          if (!title) return;
          if (!titleMap.has(title)) titleMap.set(title, []);
          titleMap.get(title).push(obj);
        };
        newSections.forEach(section => {
          registerTitle(section);
          section.fields.forEach(f => registerTitle(f));
        });
        const uniqueTitles = [...titleMap.keys()];
        const langList = languages.map(lang => `${lang.toUpperCase()} (${LANG_NAMES[lang] || lang})`).join(', ');
        const titleExamples = languages.map(lang => `"${langToTitleKey(lang)}": "..."`).join(', ');
        const tr = await generateJsonFromPrompt(
          `Translate these field/section titles into: ${langList}.\nTitles: ${uniqueTitles.join(', ')}\nReturn: {"title": {${titleExamples}}, ...}\nExample: "Birthdate Month"→{"titleEn":"Birthdate Month","titleRu":"Месяц дня рождения"}, "work_experience"→{"titleEn":"Work Experience","titleRu":"Опыт работы"}`,
          'gpt-4o-mini'
        );
        titleMap.forEach((objs, title) => {
          const t = tr[title];
          if (t && typeof t === 'object') {
            objs.forEach(obj => {
              for (const lang of languages) { const tk = langToTitleKey(lang); if (t[tk]) obj[tk] = t[tk]; }
            });
          }
        });
      } catch (_) { /* оставляем авто-заголовки */ }

      result.rowSections.push(...newSections);

      // Убираем из result.fields поля, конфликтующие с новыми секциями
      const newCodes = new Set(newSections.map(s => s.data.code));
      const newCodesNorm = new Set([...newCodes].map(normCode));
      if (result.fields && Array.isArray(result.fields)) {
        result.fields = result.fields.filter(field => {
          const code = (field.data?.code || '').replace(/\./g, '__');
          const codeNorm = normCode(code);
          return ![...newCodesNorm].some(sc => codeNorm === sc || codeNorm.startsWith(sc + '__'));
        });
      }
    }
  }

  // Постобработка: заменяем точки на "__" в кодах полей и исправляем типы
  if (result.fields && Array.isArray(result.fields)) {
    result.fields = result.fields.map(field => {
      // Исправляем тип для unix timestamp
      if (field.data && field.data.code && sourceJsonForFields) {
        // Получаем значение из исходного JSON по коду поля (с поддержкой leading-underscore промежуточных ключей)
        const keys = (field.data.code || '').replace(/\./g, '__').split('__');
        const value = resolveWithIntermediates(sourceJsonForFields, keys) ?? null;

        if (value !== null) {
          // AI сказал Boolean/Int, но значение в JSON — строка → String
          if (typeof value === 'string') {
            if (field.data.valueType === 9) field.data.valueType = 1; // Boolean → String
            if (field.data.valueType === 2) field.data.valueType = 1; // Int → String
          }
          // Число-unix timestamp и тип Int → DateTime
          if (typeof value === 'number' && Number.isInteger(value) && field.data.valueType === 2) {
            if ((value >= 1000000000 && value <= 9999999999) ||
                (value >= 1000000000000 && value <= 9999999999999)) {
              field.data.valueType = 5;
            }
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

  // Коррекция типов в rowSections: если AI назначил Boolean/Int, но реальное значение — строка.
  if (sourceJsonForFields && result.rowSections && Array.isArray(result.rowSections)) {
    result.rowSections.forEach(section => {
      if (!section.fields || !Array.isArray(section.fields)) return;
      const sectionKeys = (section.data?.code || '').replace(/\./g, '__').split('__');
      const arrVal = resolveWithIntermediates(sourceJsonForFields, sectionKeys);
      const firstItem = Array.isArray(arrVal) && arrVal.length > 0 ? arrVal[0] : null;
      if (!firstItem || typeof firstItem !== 'object') return;
      section.fields.forEach(field => {
        if (!field.data) return;
        const fieldCode = (field.data.code || '').replace(/\./g, '__');
        const sectionPrefix = sectionKeys.join('__') + '__';
        const subPath = fieldCode.startsWith(sectionPrefix) ? fieldCode.slice(sectionPrefix.length) : fieldCode;
        const subKeys = subPath.split('__');
        let val = firstItem;
        for (const k of subKeys) {
          if (val && typeof val === 'object' && k in val) val = val[k]; else { val = undefined; break; }
        }
        if (val === undefined) return;
        // AI сказал Boolean, но значение — строка → String
        if (field.data.valueType === 9 && typeof val === 'string') field.data.valueType = 1;
        // AI сказал Int, но значение — строка → String
        if (field.data.valueType === 2 && typeof val === 'string') field.data.valueType = 1;
      });
    });
  }

  // Gap-filling: для plain nested objects в sourceJson — создаём поля, пропущенные AI.
  // Охватывает два случая: AI полностью проигнорировал объект, или demotion не восстановил поля.
  if (sourceJsonForFields) {
    const normalizeCode = (c) => c.split('__').map(s => s.replace(/^_+/, '')).join('__');
    const existingCodes = new Set(
      (result.fields || []).map(f => (f.data?.code || '').replace(/\./g, '__'))
    );
    const normalizedExistingCodes = new Set([...existingCodes].map(normalizeCode));
    const missingFields = [];

    const fillMissing = (obj, prefix) => {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
      for (const [key, value] of Object.entries(obj)) {
        if (isCustomFieldKey(key)) continue;
        const code = `${prefix}__${key}`;
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          // Вложенный plain объект — если AI ошибочно создал плоское поле для этого пути, удаляем
          const normC = normalizeCode(code);
          if (result.fields && (existingCodes.has(code) || normalizedExistingCodes.has(normC))) {
            result.fields = result.fields.filter(f => {
              const fc = (f.data?.code || '').replace(/\./g, '__');
              return normalizeCode(fc) !== normC;
            });
            existingCodes.delete(code);
            normalizedExistingCodes.delete(normC);
          }
          fillMissing(value, code);
        } else if (!Array.isArray(value) || value.length === 0 || typeof value[0] !== 'object') {
          // Скалярное значение или массив примитивов — это поле
          if (!existingCodes.has(code) && !normalizedExistingCodes.has(normalizeCode(code))) {
            let valueType = 1;
            if (Array.isArray(value)) {
              const first = value.find(v => v !== null && v !== '');
              valueType = (first !== undefined && typeof first === 'number') ? 102 : 101;
            } else if (typeof value === 'boolean') valueType = 9;
            else if (typeof value === 'number') {
              if (Number.isInteger(value)) {
                if ((value >= 1e9 && value <= 9999999999) || (value >= 1e12 && value <= 9999999999999)) valueType = 5;
                else valueType = 2;
              } else {
                valueType = 3;
              }
            } else if (typeof value === 'string') {
              if (/^\d{4}-\d{2}-\d{2}T/.test(value)) valueType = 5;
              else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) valueType = 4;
            }
            // Авто-заголовок с родительским контекстом (всегда, если есть родитель)
            const _toTitleCase = (s) => s.replace(/\b\w/g, c => c.toUpperCase());
            const _seg = (s) => _toTitleCase(s.replace(/^_+/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2'));
            const _codeParts = code.split('__');
            const autoTitle = _codeParts.length >= 3
              ? `${_seg(_codeParts[_codeParts.length - 2])} ${_seg(key)}`
              : _seg(key);
            const fieldTitles = {};
            for (const lang of languages) {
              fieldTitles[langToTitleKey(lang)] = autoTitle;
            }
            missingFields.push({
              id: null,
              versionId: null,
              data: { code, isEditable: true, isRequired: false, valueType, formatCfg: null },
              ...fieldTitles,
              children: [],
              cfsMappings: [],
            });
            existingCodes.add(code);
            normalizedExistingCodes.add(normalizeCode(code));
          }
        }
        // Массив объектов — пропускаем (обрабатывается rowSections)
      }
    };

    // Запускаем только для top-level plain nested objects (не для скаляров верхнего уровня)
    for (const [key, value] of Object.entries(sourceJsonForFields)) {
      if (isCustomFieldKey(key)) continue;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        fillMissing(value, key);
      }
    }

    if (missingFields.length > 0) {
      // Вторичный AI-вызов: отправляем авто-заголовки (с контекстом), а не сырые ключи
      if (languages.length > 1) {
        try {
          const enKey = langToTitleKey(languages.includes('en') ? 'en' : languages[0]);
          // Строим map: авто-заголовок → [поля]
          const titleMap = new Map();
          missingFields.forEach(field => {
            const title = field[enKey];
            if (!title) return;
            if (!titleMap.has(title)) titleMap.set(title, []);
            titleMap.get(title).push(field);
          });
          const uniqueTitles = [...titleMap.keys()];
          const langList = languages.map(lang => `${lang.toUpperCase()} (${LANG_NAMES[lang] || lang})`).join(', ');
          const titleExamples = languages.map(lang => `"${langToTitleKey(lang)}": "..."`).join(', ');
          const translationPrompt = `Translate these field titles into human-readable names in: ${langList}.
Titles: ${uniqueTitles.join(', ')}
Return JSON: {"title": {${titleExamples}}, ...}
Examples: "Birthdate Month" → {"titleEn": "Birthdate Month", "titleRu": "Месяц дня рождения"}, "Pipeline ID" → {"titleEn": "Pipeline ID", "titleRu": "ID воронки"}.
Use only the languages listed above.`;
          const translations = await generateJsonFromPrompt(translationPrompt, 'gpt-4o-mini');
          titleMap.forEach((fields, title) => {
            const tr = translations[title];
            if (tr && typeof tr === 'object') {
              fields.forEach(field => {
                for (const lang of languages) {
                  const titleKey = langToTitleKey(lang);
                  if (tr[titleKey] && typeof tr[titleKey] === 'string') field[titleKey] = tr[titleKey];
                }
              });
            }
          });
        } catch (_) { /* оставляем авто-заголовки если перевод не удался */ }
      }

      if (!Array.isArray(result.fields)) result.fields = [];
      result.fields.push(...missingFields);
    }
  }

  // Сортируем result.fields по порядку листьев в sourceJson, чтобы gap-filled поля
  // не оказывались в конце, а стояли на своём месте (createdDate после customer и т.д.)
  if (sourceJsonForFields && result.fields && Array.isArray(result.fields)) {
    const buildLeafPaths = (obj, prefix = '') => {
      const paths = [];
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return paths;
      for (const [key, value] of Object.entries(obj)) {
        if (isCustomFieldKey(key)) continue;
        const code = prefix ? `${prefix}__${key}` : key;
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          paths.push(...buildLeafPaths(value, code));
        } else {
          paths.push(code);
        }
      }
      return paths;
    };
    const orderedPaths = buildLeafPaths(sourceJsonForFields);
    const pathIndex = new Map(orderedPaths.map((path, i) => [path, i]));
    result.fields.sort((a, b) => {
      const idxA = pathIndex.get((a.data?.code || '').replace(/\./g, '__')) ?? Infinity;
      const idxB = pathIndex.get((b.data?.code || '').replace(/\./g, '__')) ?? Infinity;
      return idxA - idxB;
    });
  }

  // Разрешение дублирующихся заголовков: для полей с одинаковыми EN-названиями
  // постепенно расширяем контекст (добавляем дедушку, прадедушку), пока не станут уникальными.
  // Затем делаем вторичный AI-вызов для перевода изменённых заголовков.
  if (result.fields && Array.isArray(result.fields) && languages.length > 0) {
    const toTitleCase = (s) => s.replace(/\b\w/g, c => c.toUpperCase());
    const makeContextTitle = (codeStr, levels) => {
      const parts = codeStr.replace(/\./g, '__').split('__');
      const leaf = toTitleCase(parts[parts.length - 1].replace(/^_+/, '').replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2'));
      const parentParts = parts.slice(Math.max(0, parts.length - 1 - levels), parts.length - 1);
      const parentTitle = parentParts
        .map(p => toTitleCase(p.replace(/^_+/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')))
        .join(' ');
      return parentTitle ? `${parentTitle} ${leaf}` : leaf;
    };
    const enLang = languages.includes('en') ? 'en' : languages[0];
    const enKey = langToTitleKey(enLang);
    const byTitle = new Map();
    result.fields.forEach(f => {
      const t = f[enKey];
      if (!t) return;
      if (!byTitle.has(t)) byTitle.set(t, []);
      byTitle.get(t).push(f);
    });
    // Собираем поля, у которых нужно изменить заголовок
    const disambiguated = []; // { field, newEnTitle }
    byTitle.forEach(fields => {
      if (fields.length <= 1) return;
      for (let levels = 2; levels <= 6; levels++) {
        const newTitles = fields.map(f => makeContextTitle(f.data?.code || '', levels));
        if (new Set(newTitles).size === fields.length) {
          fields.forEach((f, i) => disambiguated.push({ field: f, newEnTitle: newTitles[i] }));
          return;
        }
      }
    });
    if (disambiguated.length > 0) {
      // Применяем новые EN-заголовки (остальные языки пока ставим тот же EN)
      disambiguated.forEach(({ field, newEnTitle }) => {
        for (const lang of languages) field[langToTitleKey(lang)] = newEnTitle;
      });
      // Переводим через вторичный AI-вызов
      if (languages.length > 1) {
        try {
          const titleMap = new Map();
          disambiguated.forEach(({ field, newEnTitle }) => {
            if (!titleMap.has(newEnTitle)) titleMap.set(newEnTitle, []);
            titleMap.get(newEnTitle).push(field);
          });
          const uniqueTitles = [...titleMap.keys()];
          const langList = languages.map(l => `${l.toUpperCase()} (${LANG_NAMES[l] || l})`).join(', ');
          const titleExamples = languages.map(l => `"${langToTitleKey(l)}": "..."`).join(', ');
          const tr = await generateJsonFromPrompt(
            `Translate these field titles into human-readable names in: ${langList}.\nTitles: ${uniqueTitles.join(', ')}\nReturn JSON: {"<exact title>": {${titleExamples}}, ...}\nExamples: "Lead Info Profile IDs Public" → {"titleEn": "Lead Info Profile IDs Public", "titleRu": "Публичный ID профиля в Lead Info"}, "Profile Profile IDs Public" → {"titleEn": "Profile IDs Public", "titleRu": "Публичный ID профиля"}.\nUse only languages listed above.`,
            'gpt-4o-mini'
          );
          titleMap.forEach((fields, title) => {
            const t = tr[title];
            if (t && typeof t === 'object') {
              fields.forEach(f => {
                for (const lang of languages) { const tk = langToTitleKey(lang); if (t[tk]) f[tk] = t[tk]; }
              });
            }
          });
        } catch (_) { /* оставляем EN-заголовки */ }
      }
    }
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
      const key = codeToRequestKey(code, sourceJson);
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
      const arrayKeyPath = codeToRequestKey(sectionCode, sourceJson);

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
      // Для правильного detectFormatCfg нужно искать значения внутри массива,
      // а не на верхнем уровне sourceJson
      let arrayItemContext = null;
      if (sourceJson && requestField.data.key) {
        const arrayKeys = requestField.data.key.split('.');
        let arr = sourceJson;
        for (const k of arrayKeys) {
          if (arr && typeof arr === 'object' && k in arr) arr = arr[k];
          else { arr = null; break; }
        }
        if (Array.isArray(arr) && arr.length > 0 && typeof arr[0] === 'object') {
          arrayItemContext = arr[0];
        }
      }
      requestField.children = (requestField.children || []).map(child => {
        if (!child.data) return child;
        let childValueType = child.data.valueType;
        const childKey = child.data.key;
        const formatCfg = detectFormatCfg(childValueType, childKey, arrayItemContext || sourceJson, commonDateFormatCfg);
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

    const formatCfg = detectFormatCfg(valueType, key, sourceJson, commonDateFormatCfg);
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
      const formatCfg = detectFormatCfg(valueType, key, sourceJson, commonDateFormatCfg);
      if (formatCfg) responseField.data.formatCfg = formatCfg;
      return responseField;
    });
  }

  return result;
}
