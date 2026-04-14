/**
 * Перестраивает request.fields и response.fields на основе isEditable.
 * Вызывается при каждом изменении fields или rowSections в UI.
 * Общая утилита, используемая на страницах /config и /chat.
 */
export function rebuildRequestFields(fields, rowSections, currentRequest, pathToArray = undefined) {
  // Если pathToArray не задан (null), все isInArrayElement должны быть false
  const hasPathToArray = pathToArray !== null && pathToArray !== undefined;

  // Сохраняем formatCfg существующих полей (code → formatCfg)
  // и правильные ключи (code → key), установленные бэкендом через codeToRequestKey.
  // Это нужно чтобы не затирать top-level literal-ключи вроде "statusSetBy__active"
  // слепой заменой __ → . (которая даёт неверный "statusSetBy.active").
  const formatCfgByCode = new Map();
  const keyByCode = new Map(); // code → правильный key (с учётом literal-ключей)
  // Сохраняем formatCfg и ключи дочерних полей row sections
  const childFormatCfgByPath = new Map(); // parentKey.childKey → formatCfg
  const childKeyByCode = new Map(); // childCode (из {{item.CODE}}) → правильный key
  (currentRequest?.fields || []).forEach(rf => {
    // Извлекаем code из шаблона value: "{{data.CODE}}" или "{{item.CODE}}"
    const valueMatch = rf.data?.value?.match(/^\{\{data\.(.+)\}\}$/);
    const code = valueMatch ? valueMatch[1] : rf.data?.key?.replace(/\./g, '__');
    if (code && rf.data?.key) {
      keyByCode.set(code, rf.data.key);
    }
    if (code && rf.data?.formatCfg) {
      formatCfgByCode.set(code, rf.data.formatCfg);
    }
    if (rf.data?.valueType === 99) {
      const parentKey = rf.data?.key || '';
      (rf.children || []).forEach(child => {
        if (child.data?.key && child.data?.formatCfg) {
          childFormatCfgByPath.set(`${parentKey}.${child.data.key}`, child.data.formatCfg);
        }
        // Сохраняем ключ дочернего поля по коду из шаблона {{item.CODE}}
        const childValueMatch = child.data?.value?.match(/^\{\{item\.(.+)\}\}$/);
        const childCode = childValueMatch ? childValueMatch[1] : null;
        if (childCode && child.data?.key) {
          childKeyByCode.set(childCode, child.data.key);
        }
      });
    }
  });

  // Вычисляет formatCfg по valueType для типов, где он обязателен
  function getFormatCfgForValueType(valueType) {
    if (valueType === 5) {
      return { format: 'Y-m-d H:i:s', timezone: '+0000', valueType: 1 };
    }
    if (valueType === 8) {
      return { format: 'Y-m-d', timezone: '+0000', valueType: 1 };
    }
    if (valueType === 9 || valueType === 101 || valueType === 102) {
      return { valueType };
    }
    return null;
  }

  const newRequestFields = [];
  const newResponseFields = [];

  // Обычные поля: isEditable=true → request, false → response
  (fields || []).forEach(field => {
    const code = field.data?.code;
    if (!code) return;
    // Используем ключ от бэкенда если есть (codeToRequestKey уже обработал literal-ключи),
    // иначе fallback на стандартную замену __ → .
    const key = keyByCode.get(code) ?? code.replace(/__/g, '.');
    const valueType = field.data?.valueType || 1;
    const isEditable = !!field.data?.isEditable;

    if (isEditable) {
      newRequestFields.push({
        data: {
          defaultValue: '',
          formatCfg: formatCfgByCode.get(code) || getFormatCfgForValueType(valueType),
          key,
          required: false,
          value: `{{data.${code}}}`,
          valueType,
        },
        children: [],
        cfsMappings: [],
      });
    } else {
      newResponseFields.push({
        id: null,
        versionId: null,
        data: { key, code, isInArrayElement: hasPathToArray && !!(field.data?.isInArrayElement), formatCfg: null },
        children: [],
        cfsMappings: [],
      });
    }
  });

  // Строковые секции: editable поля → request type-99 children, non-editable → response
  (rowSections || []).forEach(section => {
    const sectionCode = section.data?.code;
    if (!sectionCode) return;
    const arrayKeyPath = keyByCode.get(sectionCode) ?? sectionCode.replace(/__/g, '.');

    const fieldCodeToKey = (fieldCode) => {
      // Используем ключ от бэкенда если есть (codeToRequestKey корректно восстановил пробелы)
      if (childKeyByCode.has(fieldCode)) return childKeyByCode.get(fieldCode);
      const prefix = sectionCode + '__';
      const stripped = fieldCode.startsWith(prefix) ? fieldCode.slice(prefix.length) : fieldCode;
      return stripped.replace(/__/g, '.');
    };

    const sectionFields = section.fields || [];
    const editableFields = sectionFields.filter(f => !!f.data?.isEditable);
    const nonEditableFields = sectionFields.filter(f => !f.data?.isEditable);

    if (editableFields.length > 0) {
      newRequestFields.push({
        children: editableFields.map(field => {
          const childKey = fieldCodeToKey(field.data?.code || '');
          const valueType = field.data?.valueType || 1;
          const formatCfg = childFormatCfgByPath.get(`${arrayKeyPath}.${childKey}`)
            ?? getFormatCfgForValueType(valueType);
          return {
            children: [],
            cfsMappings: [],
            data: {
              defaultValue: '',
              formatCfg,
              key: childKey,
              required: false,
              value: `{{item.${field.data?.code || ''}}}`,
              valueType,
            },
          };
        }),
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
      newResponseFields.push({
        id: null,
        versionId: null,
        data: { key: arrayKeyPath, code: sectionCode, isInArrayElement: hasPathToArray && !!section.data?.isInArrayElement, formatCfg: null },
        children: nonEditableFields.map(field => ({
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
        })),
        cfsMappings: [],
      });
    }
  });

  return {
    ...currentRequest,
    fields: newRequestFields,
    response: {
      ...(currentRequest?.response || {}),
      data: {
        ...(currentRequest?.response?.data || {}),
        ...(pathToArray !== undefined ? { pathToArray: pathToArray ?? null } : {}),
      },
      fields: newResponseFields,
    },
  };
}
