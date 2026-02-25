import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import SourceInputSwitcher from '../components/SourceInputSwitcher';
import FieldsTable from '../components/FieldsTable';
import RequestConfigEditor from '../components/RequestConfigEditor';
import SearchableSelect from '../components/SearchableSelect';
import RowSectionsTable from '../components/RowSectionsTable';
import api from '../utils/api';
import './ConfigBuilderPage.css';

/**
 * Перестраивает request.fields и response.fields на основе isEditable.
 * Вызывается при каждом изменении fields или rowSections в UI.
 */
function rebuildRequestFields(fields, rowSections, currentRequest) {
  // Сохраняем formatCfg существующих полей (key → formatCfg)
  const formatCfgByCode = new Map();
  // Сохраняем formatCfg дочерних полей row sections (parentKey.childKey → formatCfg)
  const childFormatCfgByPath = new Map();
  (currentRequest?.fields || []).forEach(rf => {
    if (rf.data?.key && rf.data?.formatCfg) {
      const code = rf.data.key.replace(/\./g, '__');
      formatCfgByCode.set(code, rf.data.formatCfg);
    }
    if (rf.data?.valueType === 99) {
      const parentKey = rf.data?.key || '';
      (rf.children || []).forEach(child => {
        if (child.data?.key && child.data?.formatCfg) {
          childFormatCfgByPath.set(`${parentKey}.${child.data.key}`, child.data.formatCfg);
        }
      });
    }
  });

  // Вычисляет formatCfg по valueType для типов, где он детерминирован
  function getFormatCfgForValueType(valueType) {
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
    const key = code.replace(/__/g, '.');
    const valueType = field.data?.valueType || 1;
    const isEditable = !!field.data?.isEditable;

    if (isEditable) {
      newRequestFields.push({
        data: {
          defaultValue: '',
          formatCfg: formatCfgByCode.get(code) || null,
          key,
          required: field.data?.required || false,
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
        data: { key, code, isInArrayElement: false, formatCfg: null },
        children: [],
        cfsMappings: [],
      });
    }
  });

  // Строковые секции: editable поля → request type-99 children, non-editable → response
  (rowSections || []).forEach(section => {
    const sectionCode = section.data?.code;
    if (!sectionCode) return;
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
              required: field.data?.required || false,
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
        data: { key: arrayKeyPath, code: sectionCode, isInArrayElement: false, formatCfg: null },
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
      fields: newResponseFields,
    },
  };
}

function ConfigBuilderPage() {
  const navigate = useNavigate();
  const [user] = useState(() => {
    const storedUser = localStorage.getItem('user');
    return storedUser ? JSON.parse(storedUser) : null;
  });
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
  const [entityType, setEntityType] = useState('action'); // 'action' или 'trigger'
  const [entityId, setEntityId] = useState(''); // ID сущности (целое число)

  const [sourceData, setSourceData] = useState({ type: '', value: '' });
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedData, setGeneratedData] = useState(null); // { fields: [], request: {} }
  const [isSending, setIsSending] = useState(false);
  const [sendResult, setSendResult] = useState(null); // { success: boolean, message: string }

  // Логирование для отладки
  useEffect(() => {
    if (generatedData) {
      console.log('generatedData changed:', generatedData);
      console.log('generatedData.fields:', generatedData.fields);
      console.log('generatedData.fields length:', generatedData.fields?.length || 0);
    }
  }, [generatedData]);

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

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

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
    try {
      // Формат запроса: { sourceType: 'url' | 'curl' | 'json', sourceValue: string }
      const requestData = {
        sourceType: sourceData.type,
        sourceValue: sourceData.value.trim(),
      };

      const response = await api.post('/ai/generate', requestData);
      
      // Логируем ответ для отладки
      console.log('Response from AI:', response.data);
      console.log('Fields:', response.data.fields);
      console.log('Request:', response.data.request);
      
      // Сохраняем результат для отображения и редактирования
      const newData = {
        fields: response.data.fields || [],
        rowSections: response.data.rowSections || [],
        request: response.data.request || {},
      };
      
      console.log('Setting generatedData:', newData);
      console.log('Fields to set:', newData.fields);
      console.log('Fields length:', newData.fields.length);
      
      setGeneratedData(newData);
      
      if (!response.data.fields || response.data.fields.length === 0) {
        console.warn('Получен пустой массив fields');
      }
      if (!response.data.request || Object.keys(response.data.request).length === 0) {
        console.warn('Получен пустой объект request');
      }
      
    } catch (error) {
      console.error('Ошибка при генерации:', error);
      const errorMessage = error.response?.data?.error || 'Ошибка при генерации конфигурации. Попробуйте позже.';
      alert(errorMessage);
    } finally {
      setIsGenerating(false);
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
        });
      }
    } catch (error) {
      console.error('Ошибка при отправке в Albato:', error);
      const errorMessage = error.response?.data?.error || error.response?.data?.message || 'Ошибка при отправке в Albato. Попробуйте позже.';
      setSendResult({
        success: false,
        message: errorMessage,
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="config-builder-page">
      <header className="header">
        <h1>Конфигуратор API</h1>
        <div className="user-info">
          <span>Пользователь: {user?.username}</span>
          <button onClick={handleLogout} className="logout-button">
            Выйти
          </button>
        </div>
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
              <label htmlFor="entity-id">Сущность *</label>
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

        <SourceInputSwitcher onSourceChange={handleSourceChange} />
        <div className="action-buttons">
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !sourceData.value}
            className="generate-button"
          >
            {isGenerating ? 'Генерация...' : 'Сгенерировать'}
          </button>
          {generatedData && (
            <button
              onClick={() => setGeneratedData(null)}
              className="reset-button"
            >
              Сбросить
            </button>
          )}
        </div>
        
        {generatedData && (
          <div className="generated-content">
            <h2>Сгенерированная конфигурация</h2>
            
            <FieldsTable
              fields={generatedData.fields || []}
              onFieldsChange={(updatedFields) => {
                setGeneratedData({
                  ...generatedData,
                  fields: updatedFields,
                  request: rebuildRequestFields(updatedFields, generatedData.rowSections || [], generatedData.request),
                });
              }}
            />

            <RowSectionsTable
              rowSections={generatedData.rowSections || []}
              onRowSectionsChange={(updatedSections) => {
                setGeneratedData({
                  ...generatedData,
                  rowSections: updatedSections,
                  request: rebuildRequestFields(generatedData.fields || [], updatedSections, generatedData.request),
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
