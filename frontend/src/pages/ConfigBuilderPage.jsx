import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import SourceInputSwitcher from '../components/SourceInputSwitcher';
import FieldsTable from '../components/FieldsTable';
import RequestConfigEditor from '../components/RequestConfigEditor';
import SearchableSelect from '../components/SearchableSelect';
import RowSectionsTable from '../components/RowSectionsTable';
import api from '../utils/api';
import { rebuildRequestFields } from '../utils/requestBuilder';
import './ConfigBuilderPage.css';

function ConfigBuilderPage() {
  // Авторизация Albato
  const [domainZone, setDomainZone] = useState(() => localStorage.getItem('albato_domainZone') || '.ru');
  const [authMethod, setAuthMethod] = useState(() => localStorage.getItem('albato_authMethod') || 'credentials');
  const [albatoEmail, setAlbatoEmail] = useState('');
  const [albatoPassword, setAlbatoPassword] = useState('');
  const [manualToken, setManualToken] = useState('');
  const [albatoToken, setAlbatoToken] = useState(() => localStorage.getItem('albato_token') || '');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Синхронизация авторизации Albato с localStorage
  useEffect(() => {
    if (albatoToken) localStorage.setItem('albato_token', albatoToken);
    else localStorage.removeItem('albato_token');
  }, [albatoToken]);
  useEffect(() => { localStorage.setItem('albato_domainZone', domainZone); }, [domainZone]);
  useEffect(() => { localStorage.setItem('albato_authMethod', authMethod); }, [authMethod]);

  // Списки из Albato API
  const [albatoApps, setAlbatoApps] = useState([]);
  const [isLoadingApps, setIsLoadingApps] = useState(false);
  const [isLoadingVersion, setIsLoadingVersion] = useState(false);
  const [versionError, setVersionError] = useState('');
  const [albatoEntities, setAlbatoEntities] = useState([]);
  const [isLoadingEntities, setIsLoadingEntities] = useState(false);

  // Настройки Albato
  const [appId, setAppId] = useState(''); // ID приложения (целое число)
  const [versionId, setVersionId] = useState(''); // ID версии (целое число)
  const [versionLanguages, setVersionLanguages] = useState(['en', 'ru']); // Языки версии приложения
  const [entityType, setEntityType] = useState('action'); // 'action' или 'trigger'
  const [entityId, setEntityId] = useState(''); // ID сущности (целое число)
  const [triggerBehaviourType, setTriggerBehaviourType] = useState(null); // 1=API, 2=Webhook (только для триггеров)
  const [triggerResponseId, setTriggerResponseId] = useState(null); // ID объекта response у Webhook-триггера

  const [considerArrayPath, setConsiderArrayPath] = useState(false);
  const [pathToArray, setPathToArray] = useState(null); // null = не задан, '' = в корне, 'obj.DataItems' = путь

  const [sourceData, setSourceData] = useState({ type: '', value: '' });
  const [isGenerating, setIsGenerating] = useState(false);
  const abortControllerRef = useRef(null);
  const [generatedData, setGeneratedData] = useState(null); // { fields: [], request: {} }
  const [isSending, setIsSending] = useState(false);
  const [sendResult, setSendResult] = useState(null); // { success: boolean, message: string }



  // Загрузка списка приложений при получении токена Albato
  useEffect(() => {
    // Сбрасываем выбранные значения при смене токена/домена
    setAppId('');
    setAlbatoEntities([]);
    if (!albatoToken) {
      setAlbatoApps([]);
      return;
    }
    const fetchApps = async () => {
      setIsLoadingApps(true);
      try {
        const response = await api.get('/albato/apps', {
          params: { domainZone, albatoToken },
        });
        if (response.data.success && Array.isArray(response.data.apps)) {
          setAlbatoApps(response.data.apps);
        }
      } catch (error) {
        console.error('Ошибка загрузки приложений:', error);
      } finally {
        setIsLoadingApps(false);
      }
    };
    fetchApps();
  }, [albatoToken, domainZone]);

  // Автозагрузка последней версии при выборе приложения
  useEffect(() => {
    if (!albatoToken || !appId) {
      setVersionId('');
      setVersionError('');
      return;
    }
    const fetchVersion = async () => {
      setIsLoadingVersion(true);
      setVersionError('');
      setVersionId('');
      try {
        const response = await api.get(`/albato/apps/${appId}/versions`, {
          params: { domainZone, albatoToken },
        });
        if (response.data.success) {
          setVersionId(String(response.data.versionId));
          if (Array.isArray(response.data.languages) && response.data.languages.length > 0) {
            setVersionLanguages(response.data.languages);
          }
        } else {
          setVersionError(response.data.error || 'Ошибка получения версии');
        }
      } catch (error) {
        console.error('Ошибка загрузки версии:', error);
        setVersionError('Ошибка загрузки версии');
      } finally {
        setIsLoadingVersion(false);
      }
    };
    fetchVersion();
  }, [albatoToken, appId, domainZone]);

  // Загрузка списка сущностей при выборе приложения, версии и типа
  useEffect(() => {
    if (!albatoToken || !appId || !versionId || !entityType) {
      setAlbatoEntities([]);
      setEntityId('');
      return;
    }
    const fetchEntities = async () => {
      setIsLoadingEntities(true);
      setEntityId('');
      try {
        const response = await api.get(`/albato/apps/${appId}/versions/${versionId}/entities`, {
          params: { domainZone, albatoToken, entityType },
        });
        if (response.data.success && Array.isArray(response.data.entities)) {
          setAlbatoEntities(response.data.entities);
        }
      } catch (error) {
        console.error('Ошибка загрузки сущностей:', error);
      } finally {
        setIsLoadingEntities(false);
      }
    };
    fetchEntities();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albatoToken, versionId, entityType, domainZone]);

  // Дефолт для галочки "Путь к массиву" при смене типа сущности
  useEffect(() => {
    setConsiderArrayPath(entityType === 'trigger');
  }, [entityType]);

  // Обновляем behaviourType и responseId при выборе триггера из списка
  useEffect(() => {
    if (entityType !== 'trigger' || !entityId) {
      setTriggerBehaviourType(null);
      setTriggerResponseId(null);
      return;
    }
    const found = albatoEntities.find(e => String(e.id) === entityId);
    setTriggerBehaviourType(found?.behaviourType ?? null);
    setTriggerResponseId(found?.responseId ?? null);
  }, [entityId, entityType, albatoEntities]);

  const handleRefreshEntities = useCallback(async () => {
    if (!albatoToken || !appId || !versionId || !entityType) return;
    setIsLoadingEntities(true);
    try {
      const response = await api.get(`/albato/apps/${appId}/versions/${versionId}/entities`, {
        params: { domainZone, albatoToken, entityType },
      });
      if (response.data.success && Array.isArray(response.data.entities)) {
        setAlbatoEntities(response.data.entities);
      }
    } catch (error) {
      console.error('Ошибка обновления сущностей:', error);
    } finally {
      setIsLoadingEntities(false);
    }
  }, [albatoToken, appId, versionId, entityType, domainZone]);

  const handleSourceChange = (data) => {
    setSourceData(data);
  };

  const handleAlbatoAuth = async () => {
    if (authMethod === 'credentials') {
      // Авторизация через логин/пароль
      if (!albatoEmail || !albatoEmail.trim() || !albatoPassword || !albatoPassword.trim()) {
        alert('Пожалуйста, введите email и пароль для Albato');
        return;
      }

      setIsAuthenticating(true);
      try {
        const response = await api.post('/albato/auth', {
          domainZone,
          email: albatoEmail.trim(),
          password: albatoPassword,
        });

        if (response.data.success && response.data.authToken) {
          setAlbatoToken(response.data.authToken);
          alert('Успешная авторизация в Albato!');
        } else {
          alert('Ошибка авторизации: ' + (response.data.message || 'Неизвестная ошибка'));
        }
      } catch (error) {
        console.error('Ошибка авторизации в Albato:', error);
        const errorMessage = error.response?.data?.error || error.response?.data?.message || 'Ошибка авторизации в Albato';
        alert(errorMessage);
      } finally {
        setIsAuthenticating(false);
      }
    } else {
      // Ручной ввод токена
      if (!manualToken || !manualToken.trim()) {
        alert('Пожалуйста, введите JWT токен');
        return;
      }
      setAlbatoToken(manualToken.trim());
      alert('JWT токен установлен!');
    }
  };

  const handleGenerate = async () => {
    if (!sourceData.value || sourceData.value.trim() === '') {
      alert('Пожалуйста, введите данные источника');
      return;
    }

    setIsGenerating(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      // Формат запроса: { sourceType: 'url' | 'curl' | 'json', sourceValue: string }
      const requestData = {
        sourceType: sourceData.type,
        sourceValue: sourceData.value.trim(),
        languages: versionLanguages,
        considerArrayPath,
      };

      const response = await api.post('/ai/generate', requestData, { signal: controller.signal });
      
      // Получаем pathToArray из ответа бэкенда
      const detectedPathToArray = response.data.pathToArray ?? null;
      setPathToArray(detectedPathToArray);

      // Для триггеров и для действий с включённым pathToArray — поля не редактируемые (кладутся в response)
      let newFields = response.data.fields || [];
      let newRowSections = response.data.rowSections || [];
      const shouldForceNonEditable = entityType === 'trigger' || (considerArrayPath && detectedPathToArray !== null);
      if (shouldForceNonEditable) {
        newFields = newFields.map(field => ({
          ...field,
          data: field.data ? { ...field.data, isEditable: false } : field.data,
        }));
        newRowSections = newRowSections.map(section => ({
          ...section,
          fields: (section.fields || []).map(f => ({
            ...f,
            data: f.data ? { ...f.data, isEditable: false } : f.data,
          })),
        }));
      }

      // Если pathToArray найден, проставляем isInArrayElement: true на всех верхнеуровневых полях
      if (detectedPathToArray !== null) {
        newFields = newFields.map(field => ({
          ...field,
          data: field.data ? { ...field.data, isInArrayElement: true } : field.data,
        }));
      }

      // Пересчитываем request.fields / response.fields на основе финального isEditable
      const rebuiltRequest = rebuildRequestFields(newFields, newRowSections, response.data.request || {}, detectedPathToArray);

      // Сохраняем результат для отображения и редактирования
      const newData = {
        fields: newFields,
        rowSections: newRowSections,
        request: rebuiltRequest,
      };
      
      setGeneratedData(newData);
      
      if (!response.data.fields || response.data.fields.length === 0) {
        console.warn('Получен пустой массив fields');
      }
      if (!response.data.request || Object.keys(response.data.request).length === 0) {
        console.warn('Получен пустой объект request');
      }
      
    } catch (error) {
      if (axios.isCancel(error) || error.name === 'CanceledError') {
        // Генерация отменена пользователем
      } else {
        console.error('Ошибка при генерации:', error);
        const errorMessage = error.response?.data?.error || 'Ошибка при генерации конфигурации. Попробуйте позже.';
        alert(errorMessage);
      }
    } finally {
      abortControllerRef.current = null;
      setIsGenerating(false);
    }
  };

  const handleCancelGenerate = () => {
    if (window.confirm('Точно отменить генерацию?')) {
      abortControllerRef.current?.abort();
    }
  };

  const handleSendToExternalApi = async () => {
    if (!generatedData) {
      alert('Нет данных для отправки');
      return;
    }

    // Проверка авторизации в Albato
    if (!albatoToken || !albatoToken.trim()) {
      alert('Пожалуйста, авторизуйтесь в Albato');
      return;
    }

    // Валидация appId
    if (!appId || !appId.trim()) {
      alert('Пожалуйста, введите ID приложения');
      return;
    }
    const appIdNumber = parseInt(appId, 10);
    if (isNaN(appIdNumber) || appIdNumber <= 0 || appIdNumber.toString() !== appId.trim()) {
      alert('ID приложения должен быть целым положительным числом');
      return;
    }

    // Валидация versionId
    if (!versionId || !versionId.trim()) {
      alert('Пожалуйста, введите ID версии');
      return;
    }
    const versionIdNumber = parseInt(versionId, 10);
    if (isNaN(versionIdNumber) || versionIdNumber <= 0 || versionIdNumber.toString() !== versionId.trim()) {
      alert('ID версии должен быть целым положительным числом');
      return;
    }

    // Валидация entityId
    if (!entityId || !entityId.trim()) {
      alert('Пожалуйста, введите ID сущности');
      return;
    }
    const entityIdNumber = parseInt(entityId, 10);
    if (isNaN(entityIdNumber) || entityIdNumber <= 0 || entityIdNumber.toString() !== entityId.trim()) {
      alert('ID сущности должен быть целым положительным числом');
      return;
    }

    setIsSending(true);
    setSendResult(null);

    try {
      const response = await api.post('/albato/send', {
        domainZone: domainZone, // '.ru' или '.com'
        albatoToken: albatoToken, // JWT токен для Albato
        appId: appIdNumber,
        versionId: versionIdNumber,
        entityType: entityType, // 'action' или 'trigger'
        entityId: entityIdNumber,
        ...(entityType === 'trigger' ? { behaviourType: triggerBehaviourType, responseId: triggerResponseId } : {}),
        fields: generatedData.fields,
        rowSections: generatedData.rowSections || [],
        request: generatedData.request,
      });

      if (response.data.success) {
        setSendResult({
          success: true,
          message: response.data.message || 'Конфигурация успешно отправлена в Albato',
        });
      } else {
        setSendResult({
          success: false,
          message: response.data.message || response.data.error || 'Ошибка при отправке',
          errors: response.data.data?.errors || [],
        });
      }
    } catch (error) {
      console.error('Ошибка при отправке в Albato:', error);
      const errorMessage = error.response?.data?.error || error.response?.data?.message || 'Ошибка при отправке в Albato. Попробуйте позже.';
      const errorDetails = error.response?.data?.data?.errors || [];
      setSendResult({
        success: false,
        message: errorMessage,
        errors: errorDetails,
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="config-builder-page">
      <header className="header">
        <h1>AI импорт запросов в <span className="albato-brand">Albato</span> Builder</h1>
        <nav className="header-nav">
          <a href="/chat" className="header-nav-link">Chat с документацией &#8594;</a>
        </nav>
      </header>
      <main className="main-content">
        {/* Авторизация в Albato */}
        <div className="entity-config-section albato-auth-section">
          <h2>Авторизация в Albato</h2>
          <div className="auth-config-fields">
            <div className="form-field">
              <label htmlFor="domain-zone">Доменная зона *</label>
              <select
                id="domain-zone"
                value={domainZone}
                onChange={(e) => setDomainZone(e.target.value)}
                className="entity-type-select"
                disabled={!!albatoToken}
              >
                <option value=".ru">.ru</option>
                <option value=".com">.com</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="auth-method">Способ авторизации *</label>
              <select
                id="auth-method"
                value={authMethod}
                onChange={(e) => {
                  setAuthMethod(e.target.value);
                  setAlbatoToken(''); // Сбрасываем токен при смене метода
                }}
                className="entity-type-select"
                disabled={!!albatoToken}
              >
                <option value="credentials">Логин и пароль</option>
                <option value="manual">JWT токен вручную</option>
              </select>
            </div>
          </div>

          {!albatoToken && authMethod === 'credentials' && (
            <div className="auth-credentials-fields">
              <div className="form-field">
                <label htmlFor="albato-email">Email *</label>
                <input
                  id="albato-email"
                  type="email"
                  value={albatoEmail}
                  onChange={(e) => setAlbatoEmail(e.target.value)}
                  placeholder="john_doe@gmail.com"
                  className="entity-id-input"
                />
              </div>
              <div className="form-field">
                <label htmlFor="albato-password">Пароль *</label>
                <input
                  id="albato-password"
                  type="password"
                  value={albatoPassword}
                  onChange={(e) => setAlbatoPassword(e.target.value)}
                  placeholder="••••••••"
                  className="entity-id-input"
                />
              </div>
            </div>
          )}

          {!albatoToken && authMethod === 'manual' && (
            <div className="auth-manual-field">
              <div className="form-field">
                <label htmlFor="manual-token">JWT токен *</label>
                <textarea
                  id="manual-token"
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  placeholder="Вставьте JWT токен из Albato"
                  className="manual-token-input"
                  rows="4"
                />
              </div>
            </div>
          )}

          <div className="auth-actions">
            {!albatoToken ? (
              <button
                onClick={handleAlbatoAuth}
                disabled={isAuthenticating}
                className="auth-button"
              >
                {isAuthenticating ? 'Авторизация...' : 'Авторизоваться'}
              </button>
            ) : (
              <div className="auth-success">
                <span className="auth-success-icon">✓</span>
                <span className="auth-success-text">Авторизован в Albato</span>
                <button
                  onClick={() => {
                    setAlbatoToken('');
                    setAlbatoEmail('');
                    setAlbatoPassword('');
                    setManualToken('');
                  }}
                  className="auth-reset-button"
                >
                  Сбросить
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Настройка Albato */}
        <div className="entity-config-section">
          <h2>Настройка Albato</h2>
          <div className="url-preview">
            <strong>API URL:</strong> https://api.albato{domainZone}/builder/apps/{appId || '...'}/versions/{versionId || '...'}/{entityType}s/{entityId || '...'}
          </div>
          <div className="url-preview">
            <strong>Web URL:</strong>{' '}
            {appId && versionId && entityId ? (
              <a
                href={domainZone === '.ru'
                  ? `https://new.albato.ru/builder/constructor/${appId}/${versionId}/${entityType}s/${entityId}/meta`
                  : `https://albato.com/app/builder/constructor/${appId}/${versionId}/${entityType}s/${entityId}/meta`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {domainZone === '.ru'
                  ? `https://new.albato.ru/builder/constructor/${appId}/${versionId}/${entityType}s/${entityId}/meta`
                  : `https://albato.com/app/builder/constructor/${appId}/${versionId}/${entityType}s/${entityId}/meta`}
              </a>
            ) : (
              <span className="url-preview-placeholder">
                {domainZone === '.ru'
                  ? `https://new.albato.ru/builder/constructor/${appId || '...'}/${versionId || '...'}/${entityType}s/${entityId || '...'}/meta`
                  : `https://albato.com/app/builder/constructor/${appId || '...'}/${versionId || '...'}/${entityType}s/${entityId || '...'}/meta`}
              </span>
            )}
          </div>
          <div className="entity-config-fields">
            <div className="form-field">
              <label htmlFor="app-id">Приложение *</label>
              {albatoApps.length > 0 ? (
                <SearchableSelect
                  id="app-id"
                  value={appId}
                  onChange={(val) => setAppId(val)}
                  placeholder="Выберите приложение"
                  options={albatoApps.map(app => ({
                    value: String(app.id),
                    label: `${app.titleEn} (${app.id})`,
                  }))}
                />
              ) : (
                <input
                  id="app-id"
                  type="number"
                  min="1"
                  step="1"
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                  placeholder={isLoadingApps ? 'Загрузка...' : 'Авторизуйтесь для списка'}
                  className="entity-id-input"
                  disabled={isLoadingApps}
                />
              )}
            </div>
            <div className="form-field">
              <label>Версия</label>
              <div className="version-display">
                {isLoadingVersion ? (
                  <span className="version-loading">Загрузка...</span>
                ) : versionError ? (
                  <span className="version-error">{versionError}</span>
                ) : versionId ? (
                  <span className="version-value">{versionId}</span>
                ) : (
                  <span className="version-placeholder">Выберите приложение</span>
                )}
              </div>
            </div>
            <div className="form-field">
              <label htmlFor="entity-type">Тип сущности *</label>
              <select
                id="entity-type"
                value={entityType}
                onChange={(e) => setEntityType(e.target.value)}
                className="entity-type-select"
              >
                <option value="action">Action</option>
                <option value="trigger">Trigger</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="entity-id" className="form-field-label-row">
                Сущность *
                {entityType === 'trigger' && entityId && triggerBehaviourType !== null && (
                  <span className="trigger-type-tag">
                    {triggerBehaviourType === 2 ? 'Webhook' : 'API'}
                  </span>
                )}
              </label>
              {albatoEntities.length > 0 ? (
                <SearchableSelect
                  id="entity-id"
                  value={entityId}
                  onChange={(val) => setEntityId(val)}
                  placeholder="Выберите сущность"
                  onRefresh={handleRefreshEntities}
                  isRefreshing={isLoadingEntities}
                  options={albatoEntities.map(entity => ({
                    value: String(entity.id),
                    label: `${entity.titleEn} (${entity.id})`,
                  }))}
                />
              ) : (
                <input
                  id="entity-id"
                  type="number"
                  min="1"
                  step="1"
                  value={entityId}
                  onChange={(e) => setEntityId(e.target.value)}
                  placeholder={isLoadingEntities ? 'Загрузка...' : 'Выберите приложение и тип'}
                  className="entity-id-input"
                  disabled={isLoadingEntities}
                />
              )}
            </div>
          </div>
        </div>

        {entityId && (
          <div className="array-path-option">
            <label className="array-path-checkbox-label">
              <input
                type="checkbox"
                checked={considerArrayPath}
                onChange={(e) => setConsiderArrayPath(e.target.checked)}
              />
              Учитывать при генерации путь к массиву данных
            </label>
            <span className="array-path-hint">
              При включении AI найдёт верхнеуровневый массив и использует его как pathToArray.
              <br />
              Все поля вне этого массива будут проигнорированы
            </span>
          </div>
        )}

        <div className={`source-section${!entityId ? ' source-section--disabled' : ''}`}>
          {!entityId && (
            <div className="source-section-hint">
              Выберите сущность выше, чтобы продолжить
            </div>
          )}
          <SourceInputSwitcher onSourceChange={handleSourceChange} />
          <div className="action-buttons">
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !sourceData.value || !entityId}
              className="generate-button"
            >
              {isGenerating ? 'Генерация...' : 'Сгенерировать'}
            </button>
            {isGenerating && (
              <button
                onClick={handleCancelGenerate}
                className="cancel-button"
              >
                Отменить
              </button>
            )}
            {generatedData && (
              <button
                onClick={() => { setGeneratedData(null); setPathToArray(null); }}
                className="reset-button"
              >
                Сбросить
              </button>
            )}
          </div>
        </div>
        
        {generatedData && (
          <div className="generated-content">
            <h2>Сгенерированная конфигурация</h2>

            <div className="path-to-array-editor">
              <label htmlFor="path-to-array">Путь к массиву данных:</label>
              {pathToArray !== null ? (
                <div className="path-to-array-input-group">
                  <input
                    id="path-to-array"
                    type="text"
                    value={pathToArray}
                    onChange={(e) => {
                      const newPath = e.target.value;
                      setPathToArray(newPath);
                      setGeneratedData(prev => ({
                        ...prev,
                        request: rebuildRequestFields(prev.fields, prev.rowSections || [], prev.request, newPath),
                      }));
                    }}
                    placeholder="Пусто = В корне"
                    className="path-to-array-input"
                  />
                  {pathToArray === '' && <span className="root-tag">В корне</span>}
                  <button
                    className="path-to-array-remove-btn"
                    onClick={() => {
                      setPathToArray(null);
                      setGeneratedData(prev => ({
                        ...prev,
                        request: rebuildRequestFields(prev.fields, prev.rowSections || [], prev.request, null),
                      }));
                    }}
                    title="Убрать путь к массиву"
                  >
                    Убрать
                  </button>
                </div>
              ) : (
                <div className="path-to-array-input-group">
                  <span className="path-to-array-empty">Не задан</span>
                  <button
                    className="path-to-array-add-btn"
                    onClick={() => {
                      setPathToArray('');
                      setGeneratedData(prev => ({
                        ...prev,
                        request: rebuildRequestFields(prev.fields, prev.rowSections || [], prev.request, ''),
                      }));
                    }}
                  >
                    Задать путь
                  </button>
                </div>
              )}
            </div>

            <FieldsTable
              fields={generatedData.fields || []}
              languages={versionLanguages}
              showIsInArrayElement={pathToArray !== null}
              onFieldsChange={(updatedFields) => {
                setGeneratedData({
                  ...generatedData,
                  fields: updatedFields,
                  request: rebuildRequestFields(updatedFields, generatedData.rowSections || [], generatedData.request, pathToArray),
                });
              }}
            />

            <RowSectionsTable
              rowSections={generatedData.rowSections || []}
              languages={versionLanguages}
              showIsInArrayElement={pathToArray !== null}
              onRowSectionsChange={(updatedSections) => {
                setGeneratedData({
                  ...generatedData,
                  rowSections: updatedSections,
                  request: rebuildRequestFields(generatedData.fields || [], updatedSections, generatedData.request, pathToArray),
                });
              }}
            />

            <RequestConfigEditor
              request={generatedData.request}
              onRequestChange={(updatedRequest) => {
                setGeneratedData({
                  ...generatedData,
                  request: updatedRequest,
                });
              }}
              hideRequestData={triggerBehaviourType === 2}
            />

            <div className="send-section">
              <button
                onClick={handleSendToExternalApi}
                disabled={isSending || !albatoToken}
                className="send-button"
              >
                {isSending ? 'Отправка...' : 'Отправить в Albato'}
              </button>
              {!albatoToken && (
                <div className="send-warning">
                  ⚠️ Требуется авторизация в Albato
                </div>
              )}

              {sendResult && (
                <div className={`send-result ${sendResult.success ? 'success' : 'error'}`}>
                  <strong>{sendResult.success ? '✓ Успех:' : '✗ Ошибка:'}</strong> {sendResult.message}
                  {sendResult.errors && sendResult.errors.length > 0 && (
                    <ul className="send-error-details">
                      {sendResult.errors.map((err, idx) => {
                        let fieldLabel = err.field;
                        // Парсим путь вида "fields.29.data.code" для получения названия поля
                        const match = err.field?.match(/^fields\.(\d+)\./);
                        if (match && generatedData?.fields) {
                          const fieldIndex = parseInt(match[1], 10);
                          const field = generatedData.fields[fieldIndex];
                          if (field) {
                            const title = field.titleRu || field.titleEn || err.field;
                            const code = field.data?.code;
                            fieldLabel = code ? `${title} (${code})` : title;
                          }
                        }
                        return (
                          <li key={idx}>
                            <strong>Поле {fieldLabel}:</strong> {err.message}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default ConfigBuilderPage;
