import express from 'express';
import { generateTargetJson } from '../services/aiClient.js';
import { validateTargetJson, normalizeTargetJson } from '../services/jsonSchemaValidator.js';

const router = express.Router();

// POST /ai/generate
router.post('/generate', async (req, res) => {
  const abortController = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) {
      abortController.abort();
    }
  });

  try {
    const { sourceType, sourceValue, languages } = req.body;

    // Валидация входных данных
    if (!sourceType || !sourceValue) {
      return res.status(400).json({
        error: 'Необходимо указать sourceType и sourceValue',
      });
    }

    if (!['url', 'curl', 'json'].includes(sourceType)) {
      return res.status(400).json({
        error: 'sourceType должен быть одним из: url, curl, json',
      });
    }

    if (typeof sourceValue !== 'string' || sourceValue.trim() === '') {
      return res.status(400).json({
        error: 'sourceValue должен быть непустой строкой',
      });
    }

    // Генерация целевого JSON через ИИ
    try {
      const langs = Array.isArray(languages) && languages.length > 0 ? languages : ['en', 'ru'];
      const result = await generateTargetJson(sourceType, sourceValue.trim(), langs, { signal: abortController.signal });
      
      // Логируем результат для отладки
      console.log('AI generated result:', JSON.stringify(result, null, 2));
      console.log('Fields count:', result.fields?.length || 0);
      console.log('Request exists:', !!result.request);
      
      // Валидация структуры JSON
      const validation = validateTargetJson(result);
      console.log('Validation result:', validation.valid, 'Errors:', validation.errors);
      
      if (!validation.valid) {
        console.warn('Валидация не прошла:', validation.errors);
        // Нормализуем данные, чтобы исправить возможные проблемы
        const normalized = normalizeTargetJson(result);
        console.log('Normalized result:', JSON.stringify(normalized, null, 2));
        console.log('Normalized fields count:', normalized.fields?.length || 0);
        
        const normalizedValidation = validateTargetJson(normalized);
        console.log('Normalized validation:', normalizedValidation.valid, 'Errors:', normalizedValidation.errors);
        
        if (!normalizedValidation.valid) {
          return res.status(500).json({
            error: 'Сгенерированный JSON не соответствует требуемой структуре',
            validationErrors: normalizedValidation.errors,
          });
        }
        
        // Возвращаем нормализованные данные
        console.log('Returning normalized data');
        return res.json({
          fields: normalized.fields || [],
          rowSections: result.rowSections || [],
          request: normalized.request || {},
        });
      }

      // Возвращаем валидный результат (fields и request)
      console.log('Returning original data (validation passed)');
      res.json({
        fields: result.fields || [],
        rowSections: result.rowSections || [],
        request: result.request || {},
      });
    } catch (aiError) {
      // Обработка ошибок от ИИ
      console.error('Ошибка при генерации через ИИ:', aiError);
      
      // Пробрасываем понятные сообщения об ошибках
      if (aiError.message.includes('API ключ')) {
        return res.status(500).json({
          error: 'Ошибка конфигурации: API ключ ИИ не настроен',
        });
      }
      
      if (aiError.message.includes('лимит')) {
        return res.status(429).json({
          error: 'Превышен лимит запросов к ИИ. Попробуйте позже.',
        });
      }
      
      return res.status(500).json({
        error: `Ошибка при генерации через ИИ: ${aiError.message}`,
      });
    }
  } catch (error) {
    console.error('Ошибка в /ai/generate:', error);
    res.status(500).json({
      error: 'Внутренняя ошибка сервера',
    });
  }
});

export default router;
