import { validateTargetJson, normalizeTargetJson } from './jsonSchemaValidator.js';

describe('jsonSchemaValidator', () => {
  describe('validateTargetJson', () => {
    test('должен валидировать корректный JSON', () => {
      const validData = {
        fields: [
          {
            id: 1,
            versionId: 1,
            data: {
              code: 'test',
              valueType: 1,
              required: true,
              isEditable: true,
              dateCreated: '2024-01-01 00:00:00',
            },
            enumId: null,
            titleEn: 'Test',
            titleRu: 'Тест',
            hintEn: null,
            hintRu: null,
          },
        ],
        request: {
          data: {
            url: 'https://api.example.com',
            method: 1,
          },
          fields: [],
          headers: [],
        },
      };

      const result = validateTargetJson(validData);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('должен возвращать ошибки для невалидного JSON', () => {
      const invalidData = {
        fields: 'not an array',
        request: null,
      };

      const result = validateTargetJson(invalidData);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('должен проверять обязательные поля', () => {
      const dataWithoutFields = {
        request: {
          data: {
            url: 'https://api.example.com',
            method: 1,
          },
        },
      };

      const result = validateTargetJson(dataWithoutFields);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Отсутствует поле "fields"');
    });
  });

  describe('normalizeTargetJson', () => {
    test('должен нормализовать данные с отсутствующими полями', () => {
      const incompleteData = {
        fields: [],
        request: {},
      };

      const normalized = normalizeTargetJson(incompleteData);
      
      expect(normalized.fields).toBeDefined();
      expect(Array.isArray(normalized.fields)).toBe(true);
      expect(normalized.request.data).toBeDefined();
      expect(normalized.request.data.url).toBe('');
      expect(normalized.request.data.method).toBe(1);
      expect(Array.isArray(normalized.request.fields)).toBe(true);
      expect(Array.isArray(normalized.request.headers)).toBe(true);
      expect(normalized.request.response).toBeDefined();
    });

    test('должен сохранять существующие данные', () => {
      const data = {
        fields: [
          {
            data: {
              code: 'test',
              valueType: 2,
            },
          },
        ],
        request: {
          data: {
            url: 'https://custom.com',
            method: 2,
          },
        },
      };

      const normalized = normalizeTargetJson(data);
      
      expect(normalized.fields[0].data.code).toBe('test');
      expect(normalized.fields[0].data.valueType).toBe(2);
      expect(normalized.request.data.url).toBe('https://custom.com');
      expect(normalized.request.data.method).toBe(2);
    });
  });
});
