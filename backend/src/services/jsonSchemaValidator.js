/**
 * Валидация структуры целевого JSON (fields и request)
 * @param {Object} data - Данные для валидации
 * @returns {{ valid: boolean, errors: string[] }} - Результат валидации
 */
export function validateTargetJson(data) {
  const errors = [];

  // Проверка, что data - объект
  if (!data || typeof data !== 'object') {
    return {
      valid: false,
      errors: ['Данные должны быть объектом'],
    };
  }

  // Проверка наличия fields
  if (!data.fields) {
    errors.push('Отсутствует поле "fields"');
  } else if (!Array.isArray(data.fields)) {
    errors.push('Поле "fields" должно быть массивом');
  } else {
    // Валидация каждого элемента fields
    data.fields.forEach((field, index) => {
      if (!field || typeof field !== 'object') {
        errors.push(`fields[${index}]: должен быть объектом`);
        return;
      }

      // Проверка data внутри field
      if (!field.data || typeof field.data !== 'object') {
        errors.push(`fields[${index}].data: должен быть объектом`);
      } else {
        if (typeof field.data.code !== 'string' && field.data.code !== null) {
          errors.push(`fields[${index}].data.code: должен быть строкой или null`);
        } else if (field.data.code && field.data.code.includes('.')) {
          // Коды полей не должны содержать точек (используй "__" вместо ".")
          errors.push(`fields[${index}].data.code: не должен содержать точек. Используй "__" вместо "." (например, "vars__name" вместо "vars.name")`);
        }
        if (typeof field.data.valueType !== 'number' && field.data.valueType !== null) {
          errors.push(`fields[${index}].data.valueType: должен быть числом или null`);
        }
        if (typeof field.data.required !== 'boolean') {
          errors.push(`fields[${index}].data.required: должен быть булевым значением`);
        }
        if (typeof field.data.isEditable !== 'boolean') {
          errors.push(`fields[${index}].data.isEditable: должен быть булевым значением`);
        }
      }

      // Проверка опциональных полей
      if (field.id !== undefined && typeof field.id !== 'number' && field.id !== null) {
        errors.push(`fields[${index}].id: должен быть числом или null`);
      }
      if (field.versionId !== undefined && typeof field.versionId !== 'number' && field.versionId !== null) {
        errors.push(`fields[${index}].versionId: должен быть числом или null`);
      }
      if (field.enumId !== undefined && typeof field.enumId !== 'number' && field.enumId !== null) {
        errors.push(`fields[${index}].enumId: должен быть числом или null`);
      }
      if (field.titleEn !== undefined && typeof field.titleEn !== 'string' && field.titleEn !== null) {
        errors.push(`fields[${index}].titleEn: должен быть строкой или null`);
      }
      if (field.titleRu !== undefined && typeof field.titleRu !== 'string' && field.titleRu !== null) {
        errors.push(`fields[${index}].titleRu: должен быть строкой или null`);
      }
    });
  }

  // Проверка наличия request
  if (!data.request) {
    errors.push('Отсутствует поле "request"');
  } else if (typeof data.request !== 'object') {
    errors.push('Поле "request" должно быть объектом');
  } else {
    // Проверка request.data
    if (!data.request.data || typeof data.request.data !== 'object') {
      errors.push('request.data: должен быть объектом');
    } else {
      if (typeof data.request.data.url !== 'string') {
        errors.push('request.data.url: должен быть строкой');
      }
      if (typeof data.request.data.method !== 'number' && data.request.data.method !== null) {
        errors.push('request.data.method: должен быть числом или null');
      }
    }

    // Проверка request.fields (массив)
    if (data.request.fields !== undefined && !Array.isArray(data.request.fields)) {
      errors.push('request.fields: должен быть массивом');
    }

    // Проверка request.headers (массив)
    if (data.request.headers !== undefined && !Array.isArray(data.request.headers)) {
      errors.push('request.headers: должен быть массивом');
    }

    // Проверка request.response
    if (data.request.response !== undefined) {
      if (typeof data.request.response !== 'object') {
        errors.push('request.response: должен быть объектом');
      } else {
        if (data.request.response.data !== undefined && typeof data.request.response.data !== 'object') {
          errors.push('request.response.data: должен быть объектом');
        }
        if (data.request.response.fields !== undefined && !Array.isArray(data.request.response.fields)) {
          errors.push('request.response.fields: должен быть массивом');
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Нормализует данные, добавляя значения по умолчанию для отсутствующих полей
 * @param {Object} data - Данные для нормализации
 * @returns {Object} - Нормализованные данные
 */
export function normalizeTargetJson(data) {
  const normalized = {
    fields: Array.isArray(data.fields) ? data.fields : [],
    request: data.request || {},
  };

  // Нормализация request
  if (!normalized.request.data) {
    normalized.request.data = {
      url: '',
      method: 1, // POST по умолчанию
      format: 0,
      content: '',
      urlEncodeType: 0,
      filter: [],
      filterType: 2,
      preScript: '',
      postScript: '',
      apiDocUrl: '',
    };
  }

  if (!Array.isArray(normalized.request.fields)) {
    normalized.request.fields = [];
  }

  if (!Array.isArray(normalized.request.headers)) {
    normalized.request.headers = [];
  }

  if (!normalized.request.response) {
    normalized.request.response = {
      data: {
        format: 0,
        pathToArray: null,
        filter: [],
        useRequestData: 0,
        preScript: '',
        postScript: '',
      },
      fields: [],
      headers: [],
      statusHandlers: [],
      cfsMappings: [],
    };
  }

  if (!normalized.request.cfsMappings) {
    normalized.request.cfsMappings = [];
  }

  // Нормализация полей в fields
  normalized.fields = normalized.fields.map((field) => ({
    id: field.id ?? null,
    versionId: field.versionId ?? null,
    data: {
      code: field.data?.code ?? '',
      valueType: field.data?.valueType ?? 1,
      required: field.data?.required ?? false,
      isEditable: field.data?.isEditable ?? true,
      dateCreated: field.data?.dateCreated ?? new Date().toISOString().replace('T', ' ').substring(0, 19),
    },
    enumId: field.enumId ?? null,
    titleEn: field.titleEn ?? null,
    titleRu: field.titleRu ?? null,
    hintEn: field.hintEn ?? null,
    hintRu: field.hintRu ?? null,
  }));

  return normalized;
}
