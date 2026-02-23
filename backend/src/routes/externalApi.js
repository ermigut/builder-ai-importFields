import express from 'express';
import axios from 'axios';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { sendToAlbato } from '../services/externalApiClient.js';
import { validateTargetJson } from '../services/jsonSchemaValidator.js';

const router = express.Router();

// POST /albato/auth - авторизация в Albato для получения JWT токена
router.post('/auth', authMiddleware, async (req, res) => {
  try {
    const { domainZone, email, password } = req.body;

    // Валидация входных данных
    if (!domainZone || (domainZone !== '.ru' && domainZone !== '.com')) {
      return res.status(400).json({
        error: 'Необходимо указать domainZone (.ru или .com)',
      });
    }

    if (!email || !email.trim() || !password) {
      return res.status(400).json({
        error: 'Необходимо указать email и password',
      });
    }

    // Отправляем запрос на авторизацию в Albato
    const albatoAuthUrl = `https://api.albato${domainZone}/user/auth`;

    try {
      console.log(`\n[ALBATO AUTH] Авторизация в Albato: ${albatoAuthUrl}`);
      console.log(`[ALBATO AUTH] Email: ${email}`);

      const response = await axios.post(albatoAuthUrl, {
        email: email.trim(),
        password: password,
      }, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      console.log('[ALBATO AUTH] Успешная авторизация');
      console.log('[ALBATO AUTH] Статус:', response.status);
      console.log('[ALBATO AUTH] Полная структура ответа:', JSON.stringify(response.data, null, 2));

      if (response.data && response.data.data && response.data.data.authToken) {
        return res.json({
          success: true,
          authToken: response.data.data.authToken,
          message: 'Успешная авторизация в Albato',
        });
      } else {
        return res.status(500).json({
          success: false,
          error: 'Не удалось получить токен авторизации',
        });
      }
    } catch (authError) {
      console.error('[ALBATO AUTH] Ошибка авторизации:', authError.message);

      if (authError.response) {
        return res.status(authError.response.status || 401).json({
          success: false,
          error: authError.response.data?.message || 'Неверный email или пароль',
        });
      } else {
        return res.status(500).json({
          success: false,
          error: 'Ошибка соединения с Albato API',
        });
      }
    }
  } catch (error) {
    console.error('Ошибка в /albato/auth:', error);
    res.status(500).json({
      error: 'Внутренняя ошибка сервера',
    });
  }
});

// GET /albato/apps - получение списка приложений из Albato
router.get('/apps', authMiddleware, async (req, res) => {
  try {
    const { domainZone, albatoToken } = req.query;

    if (!domainZone || (domainZone !== '.ru' && domainZone !== '.com')) {
      return res.status(400).json({ error: 'Необходимо указать domainZone (.ru или .com)' });
    }
    if (!albatoToken || !albatoToken.trim()) {
      return res.status(400).json({ error: 'Необходимо указать albatoToken' });
    }

    const MAX_PAGES = 50;
    let allApps = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages && page <= MAX_PAGES) {
      const url = `https://api.albato${domainZone}/builder/apps?page=${page}`;
      console.log(`[ALBATO APPS] Загрузка страницы ${page}/${totalPages}: ${url}`);

      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${albatoToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      if (response.data && Array.isArray(response.data.data)) {
        const apps = response.data.data.map(app => ({
          id: app.id,
          titleEn: app.info?.titleEn || `App ${app.id}`,
        }));
        allApps = allApps.concat(apps);
      }

      if (response.data?.meta?.totalPages) {
        totalPages = response.data.meta.totalPages;
      }

      page++;
    }

    console.log(`[ALBATO APPS] Загружено ${allApps.length} приложений (${totalPages} стр.)`);

    return res.json({
      success: true,
      apps: allApps,
    });
  } catch (error) {
    console.error('[ALBATO APPS] Ошибка:', error.message);
    if (error.response) {
      return res.status(error.response.status || 500).json({
        success: false,
        error: error.response.data?.message || 'Ошибка при получении списка приложений',
      });
    }
    return res.status(500).json({
      success: false,
      error: 'Ошибка при получении списка приложений',
    });
  }
});

// GET /albato/apps/:appId/versions - получение последней редактируемой версии приложения
router.get('/apps/:appId/versions', authMiddleware, async (req, res) => {
  try {
    const { domainZone, albatoToken } = req.query;
    const { appId } = req.params;

    if (!domainZone || (domainZone !== '.ru' && domainZone !== '.com')) {
      return res.status(400).json({ error: 'Необходимо указать domainZone (.ru или .com)' });
    }
    if (!albatoToken || !albatoToken.trim()) {
      return res.status(400).json({ error: 'Необходимо указать albatoToken' });
    }

    const MAX_PAGES = 50;
    let allVersions = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages && page <= MAX_PAGES) {
      const url = `https://api.albato${domainZone}/builder/apps/${appId}/versions?page=${page}`;
      console.log(`[ALBATO VERSIONS] Загрузка страницы ${page}/${totalPages}: ${url}`);

      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${albatoToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      if (response.data && Array.isArray(response.data.data)) {
        allVersions = allVersions.concat(response.data.data);
      }

      if (response.data?.meta?.totalPages) {
        totalPages = response.data.meta.totalPages;
      }

      page++;
    }

    console.log(`[ALBATO VERSIONS] Загружено ${allVersions.length} версий для appId=${appId}`);

    // Берём последний элемент массива
    const lastVersion = allVersions.length > 0 ? allVersions[allVersions.length - 1] : null;

    if (!lastVersion) {
      return res.json({ success: false, error: 'Версии не найдены' });
    }

    if (lastVersion.status !== 0) {
      return res.json({
        success: false,
        error: 'Должна быть редактируемая версия',
        versionId: lastVersion.id,
        status: lastVersion.status,
      });
    }

    return res.json({
      success: true,
      versionId: lastVersion.id,
      status: lastVersion.status,
    });
  } catch (error) {
    console.error('[ALBATO VERSIONS] Ошибка:', error.message);
    if (error.response) {
      return res.status(error.response.status || 500).json({
        success: false,
        error: error.response.data?.message || 'Ошибка при получении версий',
      });
    }
    return res.status(500).json({
      success: false,
      error: 'Ошибка при получении версий',
    });
  }
});

// GET /albato/apps/:appId/versions/:versionId/entities - получение списка сущностей (actions/triggers)
router.get('/apps/:appId/versions/:versionId/entities', authMiddleware, async (req, res) => {
  try {
    const { domainZone, albatoToken, entityType } = req.query;
    const { appId, versionId } = req.params;

    if (!domainZone || (domainZone !== '.ru' && domainZone !== '.com')) {
      return res.status(400).json({ error: 'Необходимо указать domainZone (.ru или .com)' });
    }
    if (!albatoToken || !albatoToken.trim()) {
      return res.status(400).json({ error: 'Необходимо указать albatoToken' });
    }
    if (!entityType || (entityType !== 'action' && entityType !== 'trigger')) {
      return res.status(400).json({ error: 'Необходимо указать entityType (action или trigger)' });
    }

    const entityTypePlural = entityType === 'action' ? 'actions' : 'triggers';
    const MAX_PAGES = 50;
    let allEntities = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages && page <= MAX_PAGES) {
      const url = `https://api.albato${domainZone}/builder/apps/${appId}/versions/${versionId}/${entityTypePlural}?page=${page}`;
      console.log(`[ALBATO ENTITIES] Загрузка страницы ${page}/${totalPages}: ${url}`);

      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${albatoToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });

      if (response.data && Array.isArray(response.data.data)) {
        const entities = response.data.data
          .filter(entity => !entity.data?.deprecated)
          .map(entity => ({
            id: entity.id,
            titleEn: entity.titleEn || `${entityType} ${entity.id}`,
          }));
        allEntities = allEntities.concat(entities);
      }

      if (response.data?.meta?.totalPages) {
        totalPages = response.data.meta.totalPages;
      }

      page++;
    }

    console.log(`[ALBATO ENTITIES] Загружено ${allEntities.length} ${entityTypePlural} для appId=${appId}, versionId=${versionId}`);

    return res.json({
      success: true,
      entities: allEntities,
    });
  } catch (error) {
    console.error('[ALBATO ENTITIES] Ошибка:', error.message);
    if (error.response) {
      return res.status(error.response.status || 500).json({
        success: false,
        error: error.response.data?.message || 'Ошибка при получении сущностей',
      });
    }
    return res.status(500).json({
      success: false,
      error: 'Ошибка при получении сущностей',
    });
  }
});

// POST /albato/send - защищённый маршрут для отправки данных в Albato
router.post('/send', authMiddleware, async (req, res) => {
  try {
    const { domainZone, albatoToken, appId, versionId, entityType, entityId, fields, request, rowSections } = req.body;

    // Валидация JWT токена Albato
    if (!albatoToken || typeof albatoToken !== 'string' || !albatoToken.trim()) {
      return res.status(400).json({
        error: 'Необходимо указать albatoToken (JWT токен для Albato)',
      });
    }

    // Валидация обязательных полей для динамического URL
    if (!domainZone || (domainZone !== '.ru' && domainZone !== '.com')) {
      return res.status(400).json({
        error: 'Необходимо указать domainZone (.ru или .com)',
      });
    }

    if (!appId || typeof appId !== 'number' || appId <= 0 || !Number.isInteger(appId)) {
      return res.status(400).json({
        error: 'Необходимо указать appId (целое положительное число)',
      });
    }

    if (!versionId || typeof versionId !== 'number' || versionId <= 0 || !Number.isInteger(versionId)) {
      return res.status(400).json({
        error: 'Необходимо указать versionId (целое положительное число)',
      });
    }

    if (!entityType || (entityType !== 'action' && entityType !== 'trigger')) {
      return res.status(400).json({
        error: 'Необходимо указать entityType (action или trigger)',
      });
    }

    if (!entityId || typeof entityId !== 'number' || entityId <= 0 || !Number.isInteger(entityId)) {
      return res.status(400).json({
        error: 'Необходимо указать entityId (целое положительное число)',
      });
    }

    // Валидация входных данных
    if (!fields || !request) {
      return res.status(400).json({
        error: 'Необходимо указать fields и request',
      });
    }

    if (!Array.isArray(fields)) {
      return res.status(400).json({
        error: 'fields должен быть массивом',
      });
    }

    if (typeof request !== 'object') {
      return res.status(400).json({
        error: 'request должен быть объектом',
      });
    }

    // Валидация структуры JSON
    const validation = validateTargetJson({ fields, request });
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Невалидная структура данных',
        validationErrors: validation.errors,
      });
    }

    // Отправка в Albato
    try {
      console.log('\n[ROUTE] /albato/send - Начало обработки запроса');
      console.log('[ROUTE] Данные от клиента:', {
        domainZone,
        hasAlbatoToken: !!albatoToken,
        albatoTokenPreview: albatoToken ? `${albatoToken.substring(0, 20)}...` : 'ОТСУТСТВУЕТ',
        appId,
        versionId,
        entityType,
        entityId,
        fieldsCount: fields.length,
        rowSectionsCount: Array.isArray(rowSections) ? rowSections.length : 0,
        requestUrl: request.data?.url,
        requestMethod: request.data?.method,
      });

      const result = await sendToAlbato({
        domainZone,
        albatoToken,
        appId,
        versionId,
        entityType,
        entityId,
        fields,
        request,
        rowSections: Array.isArray(rowSections) ? rowSections : [],
      });
      
      console.log('[ROUTE] Результат отправки:', {
        success: result.success,
        status: result.status,
        message: result.message,
        hasResponseData: !!result.data,
      });

      if (result.success) {
        return res.json({
          success: true,
          message: result.message,
          status: result.status,
          data: result.data,
        });
      } else {
        // Вторая API вернула ошибку
        return res.status(result.status || 500).json({
          success: false,
          message: result.message,
          status: result.status,
          data: result.data,
        });
      }
    } catch (apiError) {
      // Ошибка сети или конфигурации
      console.error('Ошибка при отправке в Albato API:', apiError);
      return res.status(500).json({
        success: false,
        error: apiError.message || 'Ошибка при отправке в Albato API',
      });
    }
  } catch (error) {
    console.error('Ошибка в /albato/send:', error);
    res.status(500).json({
      error: 'Внутренняя ошибка сервера',
    });
  }
});

export default router;
