// Импортируем config ПЕРВЫМ для загрузки переменных окружения
import '../config.js';

import axios from 'axios';
import { logAlbatoApiOperation } from '../middleware/logger.js';

/**
 * Строит полностью динамический URL для Albato API
 * @param {string} domainZone - Доменная зона ('.ru' или '.com')
 * @param {number} appId - ID приложения
 * @param {number} versionId - ID версии
 * @param {string} entityType - Тип сущности ('action' или 'trigger')
 * @param {number} entityId - ID сущности
 * @returns {string} - Полный URL
 */
function buildAlbatoApiUrl(domainZone, appId, versionId, entityType, entityId) {
  const entityTypePlural = entityType === 'action' ? 'actions' : 'triggers';
  return `https://api.albato${domainZone}/builder/apps/${appId}/versions/${versionId}/${entityTypePlural}/${entityId}`;
}

/**
 * Отправляет JSON в Albato API с JWT-авторизацией
 * @param {Object} data - Данные для отправки (domainZone, albatoToken, appId, versionId, entityType, entityId, fields и request)
 * @returns {Promise<Object>} - Ответ от Albato API
 * @throws {Error} - Если произошла ошибка при отправке
 */
export async function sendToAlbato(data) {
  const { domainZone, albatoToken, appId, versionId, entityType, entityId, fields, request, rowSections } = data;

  if (!albatoToken || typeof albatoToken !== 'string' || !albatoToken.trim()) {
    throw new Error('JWT токен Albato не предоставлен');
  }

  if (!domainZone || (domainZone !== '.ru' && domainZone !== '.com')) {
    throw new Error('domainZone должен быть ".ru" или ".com"');
  }

  if (!appId || typeof appId !== 'number' || appId <= 0) {
    throw new Error('appId должен быть положительным числом');
  }

  if (!versionId || typeof versionId !== 'number' || versionId <= 0) {
    throw new Error('versionId должен быть положительным числом');
  }

  if (!entityType || (entityType !== 'action' && entityType !== 'trigger')) {
    throw new Error('entityType должен быть "action" или "trigger"');
  }

  if (!entityId || typeof entityId !== 'number' || entityId <= 0) {
    throw new Error('entityId должен быть положительным числом');
  }

  // Строим полностью динамический URL
  const ALBATO_API_URL = buildAlbatoApiUrl(domainZone, appId, versionId, entityType, entityId);

  // Преобразуем структуру: request -> requests (массив)
  const payload = {
    fields: fields || [],
    requests: request ? [request] : [],
    rowSections: rowSections || [],
  };

  const requestStartTime = Date.now();

  try {
    console.log('\n========== ОТПРАВКА В ALBATO API ==========');
    console.log('Domain Zone:', domainZone);
    console.log('App ID:', appId);
    console.log('Version ID:', versionId);
    console.log('Entity Type:', entityType);
    console.log('Entity ID:', entityId);
    console.log('Построенный URL:', ALBATO_API_URL);
    console.log('Время запроса:', new Date().toISOString());
    console.log('Исходные данные (от клиента):', JSON.stringify({ fields, request }, null, 2));
    console.log('Преобразованные данные (для отправки):', JSON.stringify(payload, null, 2));
    console.log('Количество полей:', payload.fields?.length || 0);
    console.log('Количество запросов в массиве requests:', payload.requests?.length || 0);
    console.log('Количество строковых секций:', payload.rowSections?.length || 0);
    console.log('JWT токен:', albatoToken ? `${albatoToken.substring(0, 20)}...` : 'НЕ ПРЕДОСТАВЛЕН');

    logAlbatoApiOperation('Отправка данных в Albato API', {
      url: ALBATO_API_URL,
      fieldsCount: payload.fields?.length || 0,
      requestsCount: payload.requests?.length || 0,
      requestDataSize: JSON.stringify(payload).length,
    });

    const response = await axios.put(
      ALBATO_API_URL,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${albatoToken}`,
        },
        timeout: 30000, // 30 секунд таймаут
      }
    );

    const requestDuration = Date.now() - requestStartTime;

    console.log('\n========== ОТВЕТ ОТ ALBATO API ==========');
    console.log('Статус:', response.status, response.statusText);
    console.log('Время выполнения:', `${requestDuration}ms`);
    console.log('Заголовки ответа:', JSON.stringify(response.headers, null, 2));
    console.log('Тело ответа:', JSON.stringify(response.data, null, 2));
    console.log('==========================================\n');

    logAlbatoApiOperation('Успешный ответ от Albato API', {
      status: response.status,
      duration: requestDuration,
      responseSize: JSON.stringify(response.data).length,
    });

    return {
      success: true,
      status: response.status,
      data: response.data,
      message: 'Конфигурация успешно отправлена в Albato',
    };
  } catch (error) {
    const requestDuration = Date.now() - requestStartTime;

    console.log('\n========== ОШИБКА ПРИ ОТПРАВКЕ В ALBATO API ==========');
    console.log('Время выполнения до ошибки:', `${requestDuration}ms`);
    console.log('Тип ошибки:', error.constructor.name);
    console.log('Сообщение ошибки:', error.message);

    if (error.response) {
      // Сервер вернул ответ с кодом ошибки
      console.log('Статус ответа:', error.response.status, error.response.statusText);
      console.log('Заголовки ответа:', JSON.stringify(error.response.headers, null, 2));
      console.log('Тело ответа с ошибкой:', JSON.stringify(error.response.data, null, 2));

      logAlbatoApiOperation('Ошибка при обращении к Albato API (получен ответ)', {
        error: error.message,
        status: error.response.status,
        duration: requestDuration,
        responseData: error.response.data,
      });

      return {
        success: false,
        status: error.response.status,
        data: error.response.data,
        message: `Ошибка Albato API (${error.response.status}): ${error.response.data?.message || error.response.statusText || 'Неизвестная ошибка'}`,
      };
    } else if (error.request) {
      // Запрос был отправлен, но ответа не получено
      console.log('Запрос был отправлен, но ответ не получен');
      console.log('Детали запроса:', {
        url: ALBATO_API_URL,
        method: 'PUT',
        payloadStructure: '{ fields: [...], requests: [...] }',
        timeout: error.code === 'ECONNABORTED' ? 'Превышен таймаут' : 'Неизвестно',
      });

      logAlbatoApiOperation('Ошибка при обращении к Albato API (нет ответа)', {
        error: error.message,
        code: error.code,
        duration: requestDuration,
      });

      throw new Error('Не удалось получить ответ от Albato API. Проверьте подключение к сети.');
    } else {
      // Ошибка при настройке запроса
      console.log('Ошибка при настройке запроса');
      console.log('Стек ошибки:', error.stack);

      logAlbatoApiOperation('Ошибка при обращении к Albato API (настройка запроса)', {
        error: error.message,
        duration: requestDuration,
      });

      throw new Error(`Ошибка при отправке запроса: ${error.message}`);
    }
    console.log('========================================================\n');
  }
}

/**
 * Проверяет доступность Albato API (опционально, для health-check)
 * @param {string} albatoToken - JWT токен для проверки
 * @returns {Promise<boolean>} - true если токен предоставлен
 */
export async function checkAlbatoHealth(albatoToken) {
  try {
    // Проверяем только наличие JWT токена
    return !!(albatoToken && typeof albatoToken === 'string' && albatoToken.trim());
  } catch (error) {
    return false;
  }
}
