import { useState, useEffect, useCallback } from 'react';
import SearchableSelect from './SearchableSelect';
import api from '../utils/api';
import './AlbatoConfig.css';

/**
 * Компонент конфигурации Albato.
 * Управляет авторизацией, выбором приложения/версии/сущности.
 *
 * @param {Object} props
 * @param {function} props.onConfigChange - Колбэк при изменении конфигурации.
 *   Вызывается с объектом: { domainZone, albatoToken, appId, versionId, versionLanguages, entityType, entityId, triggerBehaviourType, triggerResponseId }
 * @param {boolean} [props.showEntityConfig=true] - Показывать ли секцию настройки сущностей
 */
export default function AlbatoConfig({ onConfigChange, showEntityConfig = true }) {
  // Авторизация
  const [domainZone, setDomainZone] = useState(() => localStorage.getItem('albato_domainZone') || '.ru');
  const [authMethod, setAuthMethod] = useState(() => localStorage.getItem('albato_authMethod') || 'credentials');
  const [albatoEmail, setAlbatoEmail] = useState('');
  const [albatoPassword, setAlbatoPassword] = useState('');
  const [manualToken, setManualToken] = useState('');
  const [albatoToken, setAlbatoToken] = useState(() => localStorage.getItem('albato_token') || '');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Списки из Albato API
  const [albatoApps, setAlbatoApps] = useState([]);
  const [isLoadingApps, setIsLoadingApps] = useState(false);
  const [isLoadingVersion, setIsLoadingVersion] = useState(false);
  const [versionError, setVersionError] = useState('');
  const [albatoEntities, setAlbatoEntities] = useState([]);
  const [isLoadingEntities, setIsLoadingEntities] = useState(false);

  // Настройки
  const [appId, setAppId] = useState('');
  const [versionId, setVersionId] = useState('');
  const [versionLanguages, setVersionLanguages] = useState(['en', 'ru']);
  const [entityType, setEntityType] = useState('action');
  const [entityId, setEntityId] = useState('');
  const [triggerBehaviourType, setTriggerBehaviourType] = useState(null);
  const [triggerResponseId, setTriggerResponseId] = useState(null);

  // Синхронизация с localStorage
  useEffect(() => {
    if (albatoToken) localStorage.setItem('albato_token', albatoToken);
    else localStorage.removeItem('albato_token');
  }, [albatoToken]);
  useEffect(() => { localStorage.setItem('albato_domainZone', domainZone); }, [domainZone]);
  useEffect(() => { localStorage.setItem('albato_authMethod', authMethod); }, [authMethod]);

  // Уведомляем родителя об изменениях конфигурации
  useEffect(() => {
    onConfigChange?.({
      domainZone, albatoToken, appId, versionId, versionLanguages,
      entityType, entityId, triggerBehaviourType, triggerResponseId,
    });
  }, [domainZone, albatoToken, appId, versionId, versionLanguages, entityType, entityId, triggerBehaviourType, triggerResponseId]);

  // Загрузка списка приложений
  useEffect(() => {
    setAppId('');
    setAlbatoEntities([]);
    if (!albatoToken) { setAlbatoApps([]); return; }
    const fetchApps = async () => {
      setIsLoadingApps(true);
      try {
        const response = await api.get('/albato/apps', { params: { domainZone, albatoToken } });
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

  // Автозагрузка версии
  useEffect(() => {
    if (!albatoToken || !appId) { setVersionId(''); setVersionError(''); return; }
    const fetchVersion = async () => {
      setIsLoadingVersion(true);
      setVersionError('');
      setVersionId('');
      try {
        const response = await api.get(`/albato/apps/${appId}/versions`, { params: { domainZone, albatoToken } });
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

  // Загрузка сущностей
  useEffect(() => {
    if (!albatoToken || !appId || !versionId || !entityType) { setAlbatoEntities([]); setEntityId(''); return; }
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

  // Обновляем behaviourType и responseId при выборе триггера
  useEffect(() => {
    if (entityType !== 'trigger' || !entityId) { setTriggerBehaviourType(null); setTriggerResponseId(null); return; }
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

  const handleAlbatoAuth = async () => {
    if (authMethod === 'credentials') {
      if (!albatoEmail || !albatoEmail.trim() || !albatoPassword || !albatoPassword.trim()) {
        alert('Пожалуйста, введите email и пароль для Albato');
        return;
      }
      setIsAuthenticating(true);
      try {
        const response = await api.post('/albato/auth', { domainZone, email: albatoEmail.trim(), password: albatoPassword });
        if (response.data.success && response.data.authToken) {
          setAlbatoToken(response.data.authToken);
          alert('Успешная авторизация в Albato!');
        } else {
          alert('Ошибка авторизации: ' + (response.data.message || 'Неизвестная ошибка'));
        }
      } catch (error) {
        const errorMessage = error.response?.data?.error || error.response?.data?.message || 'Ошибка авторизации в Albato';
        alert(errorMessage);
      } finally {
        setIsAuthenticating(false);
      }
    } else {
      if (!manualToken || !manualToken.trim()) { alert('Пожалуйста, введите JWT токен'); return; }
      setAlbatoToken(manualToken.trim());
      alert('JWT токен установлен!');
    }
  };

  return (
    <>
      {/* Авторизация */}
      <div className="entity-config-section albato-auth-section">
        <h2>Авторизация в Albato</h2>
        <div className="auth-config-fields">
          <div className="form-field">
            <label htmlFor="domain-zone">Доменная зона *</label>
            <select id="domain-zone" value={domainZone} onChange={(e) => setDomainZone(e.target.value)} className="entity-type-select" disabled={!!albatoToken}>
              <option value=".ru">.ru</option>
              <option value=".com">.com</option>
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="auth-method">Способ авторизации *</label>
            <select id="auth-method" value={authMethod} onChange={(e) => { setAuthMethod(e.target.value); setAlbatoToken(''); }} className="entity-type-select" disabled={!!albatoToken}>
              <option value="credentials">Логин и пароль</option>
              <option value="manual">JWT токен вручную</option>
            </select>
          </div>
        </div>

        {!albatoToken && authMethod === 'credentials' && (
          <div className="auth-credentials-fields">
            <div className="form-field">
              <label htmlFor="albato-email">Email *</label>
              <input id="albato-email" type="email" value={albatoEmail} onChange={(e) => setAlbatoEmail(e.target.value)} placeholder="john_doe@gmail.com" className="entity-id-input" />
            </div>
            <div className="form-field">
              <label htmlFor="albato-password">Пароль *</label>
              <input id="albato-password" type="password" value={albatoPassword} onChange={(e) => setAlbatoPassword(e.target.value)} placeholder="••••••••" className="entity-id-input" />
            </div>
          </div>
        )}

        {!albatoToken && authMethod === 'manual' && (
          <div className="auth-manual-field">
            <div className="form-field">
              <label htmlFor="manual-token">JWT токен *</label>
              <textarea id="manual-token" value={manualToken} onChange={(e) => setManualToken(e.target.value)} placeholder="Вставьте JWT токен из Albato" className="manual-token-input" rows="4" />
            </div>
          </div>
        )}

        <div className="auth-actions">
          {!albatoToken ? (
            <button onClick={handleAlbatoAuth} disabled={isAuthenticating} className="auth-button">
              {isAuthenticating ? 'Авторизация...' : 'Авторизоваться'}
            </button>
          ) : (
            <div className="auth-success">
              <span className="auth-success-icon">&#10003;</span>
              <span className="auth-success-text">Авторизован в Albato</span>
              <button onClick={() => { setAlbatoToken(''); setAlbatoEmail(''); setAlbatoPassword(''); setManualToken(''); }} className="auth-reset-button">
                Сбросить
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Настройка сущностей */}
      {showEntityConfig && (
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
                target="_blank" rel="noopener noreferrer"
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
                <SearchableSelect id="app-id" value={appId} onChange={(val) => setAppId(val)} placeholder="Выберите приложение"
                  options={albatoApps.map(app => ({ value: String(app.id), label: `${app.titleEn} (${app.id})` }))} />
              ) : (
                <input id="app-id" type="number" min="1" step="1" value={appId} onChange={(e) => setAppId(e.target.value)}
                  placeholder={isLoadingApps ? 'Загрузка...' : 'Авторизуйтесь для списка'} className="entity-id-input" disabled={isLoadingApps} />
              )}
            </div>
            <div className="form-field">
              <label>Версия</label>
              <div className="version-display">
                {isLoadingVersion ? <span className="version-loading">Загрузка...</span>
                  : versionError ? <span className="version-error">{versionError}</span>
                  : versionId ? <span className="version-value">{versionId}</span>
                  : <span className="version-placeholder">Выберите приложение</span>}
              </div>
            </div>
            <div className="form-field">
              <label htmlFor="entity-type">Тип сущности *</label>
              <select id="entity-type" value={entityType} onChange={(e) => setEntityType(e.target.value)} className="entity-type-select">
                <option value="action">Action</option>
                <option value="trigger">Trigger</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="entity-id" className="form-field-label-row">
                Сущность *
                {entityType === 'trigger' && entityId && triggerBehaviourType !== null && (
                  <span className="trigger-type-tag">{triggerBehaviourType === 2 ? 'Webhook' : 'API'}</span>
                )}
              </label>
              {albatoEntities.length > 0 ? (
                <SearchableSelect id="entity-id" value={entityId} onChange={(val) => setEntityId(val)} placeholder="Выберите сущность"
                  onRefresh={handleRefreshEntities} isRefreshing={isLoadingEntities}
                  options={albatoEntities.map(entity => ({ value: String(entity.id), label: `${entity.titleEn} (${entity.id})` }))} />
              ) : (
                <input id="entity-id" type="number" min="1" step="1" value={entityId} onChange={(e) => setEntityId(e.target.value)}
                  placeholder={isLoadingEntities ? 'Загрузка...' : 'Выберите приложение и тип'} className="entity-id-input" disabled={isLoadingEntities} />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
