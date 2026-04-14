import { useState, useRef, useCallback } from 'react';
import DocUpload from '../components/DocUpload';
import ChatPanel from '../components/ChatPanel';
import AlbatoConfig from '../components/AlbatoConfig';
import FieldsTable from '../components/FieldsTable';
import RowSectionsTable from '../components/RowSectionsTable';
import RequestConfigEditor from '../components/RequestConfigEditor';
import { rebuildRequestFields } from '../utils/requestBuilder';
import api from '../utils/api';
import './ChatDocPage.css';

export default function ChatDocPage() {
  // Чат
  const [sessionId, setSessionId] = useState(null);
  const [docSummary, setDocSummary] = useState('');
  const [endpoints, setEndpoints] = useState([]);
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Сгенерированные данные
  const [generatedData, setGeneratedData] = useState(null);
  const [pathToArray, setPathToArray] = useState(null);
  const [considerArrayPath, setConsiderArrayPath] = useState(false);

  // Albato конфигурация
  const albatoConfigRef = useRef({});
  const [isSending, setIsSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);

  // Определяет, похоже ли сообщение на запрос генерации полей
  const looksLikeFieldGeneration = (text) => {
    if (!text) return false;
    const lower = text.toLowerCase();
    const keywords = [
      'сгенерируй', 'сгенерировать', 'генерируй', 'генерация', 'создай поля', 'обработай',
      'поля для', 'fields for', 'generate', 'create fields',
      'post ', 'put ', 'patch ', 'delete ', 'get ',
      'post/', 'put/', 'patch/', 'delete/', 'get/',
      'добавить', 'создать', 'обновить', 'удалить',
      'add-', 'create-', 'update-', 'edit-',
    ];
    return keywords.some(kw => lower.includes(kw));
  };

  const handleConfigChange = useCallback((config) => {
    albatoConfigRef.current = config;
  }, []);

  const handleUploadComplete = (newSessionId, summary, eps, sourceType) => {
    setSessionId(newSessionId);
    setDocSummary(summary);
    setEndpoints(eps);
    setMessages([]);
    setGeneratedData(null);
    setPathToArray(null);

    // Добавляем системное сообщение
    const systemMsg = `Документация загружена: ${summary}`;
    if (eps.length > 0) {
      const epList = eps.slice(0, 15).map(ep => `  ${ep.method} ${ep.path}${ep.summary ? ` — ${ep.summary}` : ''}`).join('\n');
      setMessages([{
        role: 'assistant',
        content: `${systemMsg}\n\nДоступные эндпоинты:\n${epList}${eps.length > 15 ? `\n  ... и ещё ${eps.length - 15}` : ''}\n\nНапишите, какой метод обработать. Например: "Создать контакт" или "POST /contacts"`,
      }]);
    } else {
      setMessages([{
        role: 'assistant',
        content: `${systemMsg}\n\nНапишите, какой метод из документации обработать.`,
      }]);
    }
  };

  const handleSendMessage = async (message) => {
    if (!sessionId) return;

    // Добавляем сообщение пользователя
    setMessages(prev => [...prev, { role: 'user', content: message }]);
    setIsLoading(true);

    try {
      const config = albatoConfigRef.current;
      const response = await api.post('/chat/message', {
        sessionId,
        message,
        languages: config.versionLanguages || ['en'],
        considerArrayPath,
      });

      const { text, fields, rowSections, request, pathToArray: detectedPathToArray } = response.data;

      // Добавляем ответ AI
      if (fields) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: text || `Сгенерировано полей: ${fields.length}, секций: ${(rowSections || []).length}`,
        }]);

        // Обработка pathToArray если был запрошен
        const effectivePath = (considerArrayPath && detectedPathToArray !== undefined && detectedPathToArray !== null)
          ? detectedPathToArray
          : pathToArray;

        let newFields = fields;
        let newRowSections = rowSections || [];

        if (considerArrayPath && detectedPathToArray !== undefined && detectedPathToArray !== null) {
          setPathToArray(detectedPathToArray);

          // Если pathToArray найден — все поля isEditable: false, isInArrayElement: true
          const entityType = config.entityType;
          const shouldForceNonEditable = entityType === 'trigger' || true; // при pathToArray всегда non-editable
          if (shouldForceNonEditable) {
            newFields = newFields.map(field => ({
              ...field,
              data: field.data ? { ...field.data, isEditable: false, isInArrayElement: true } : field.data,
            }));
            newRowSections = newRowSections.map(section => ({
              ...section,
              data: section.data ? { ...section.data, isInArrayElement: true } : section.data,
              fields: (section.fields || []).map(f => ({
                ...f,
                data: f.data ? { ...f.data, isEditable: false } : f.data,
              })),
            }));
          }
        }

        // Устанавливаем сгенерированные данные
        const rebuiltRequest = rebuildRequestFields(newFields, newRowSections, request || {}, effectivePath);
        setGeneratedData({
          fields: newFields,
          rowSections: newRowSections,
          request: rebuiltRequest,
        });
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: text }]);
      }
    } catch (error) {
      const errorMsg = error.response?.data?.error || 'Ошибка при отправке сообщения';
      setMessages(prev => [...prev, { role: 'assistant', content: `Ошибка: ${errorMsg}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendToAlbato = async () => {
    if (!generatedData) { alert('Нет данных для отправки'); return; }
    const config = albatoConfigRef.current;
    if (!config.albatoToken) { alert('Авторизуйтесь в Albato'); return; }
    if (!config.appId) { alert('Выберите приложение'); return; }
    if (!config.versionId) { alert('Версия не определена'); return; }
    if (!config.entityId) { alert('Выберите сущность'); return; }

    setIsSending(true);
    setSendResult(null);

    try {
      const response = await api.post('/albato/send', {
        domainZone: config.domainZone,
        albatoToken: config.albatoToken,
        appId: parseInt(config.appId, 10),
        versionId: parseInt(config.versionId, 10),
        entityType: config.entityType,
        entityId: parseInt(config.entityId, 10),
        ...(config.entityType === 'trigger' ? { behaviourType: config.triggerBehaviourType, responseId: config.triggerResponseId } : {}),
        fields: generatedData.fields,
        rowSections: generatedData.rowSections || [],
        request: generatedData.request,
      });

      if (response.data.success) {
        setSendResult({ success: true, message: response.data.message || 'Успешно отправлено в Albato' });
      } else {
        setSendResult({ success: false, message: response.data.message || response.data.error || 'Ошибка', errors: response.data.data?.errors || [] });
      }
    } catch (error) {
      setSendResult({
        success: false,
        message: error.response?.data?.error || 'Ошибка при отправке',
        errors: error.response?.data?.data?.errors || [],
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleNewSession = () => {
    setSessionId(null);
    setDocSummary('');
    setEndpoints([]);
    setMessages([]);
    setGeneratedData(null);
    setPathToArray(null);
    setConsiderArrayPath(false);
    setSendResult(null);
  };

  return (
    <div className="chat-doc-page">
      <header className="header">
        <h1>AI Chat &mdash; Анализ API документации</h1>
        <nav className="header-nav">
          <a href="/config" className="header-nav-link">&#8592; Импорт JSON</a>
        </nav>
      </header>

      <main className="main-content">
        {/* Albato Config */}
        <AlbatoConfig onConfigChange={handleConfigChange} />

        {/* Загрузка документации */}
        <div className="chat-doc-section">
          <h2>
            Документация API
            {sessionId && (
              <button onClick={handleNewSession} className="new-session-button">Новая сессия</button>
            )}
          </h2>
          {docSummary && (
            <div className="doc-summary">
              {docSummary}
            </div>
          )}
          {!sessionId && <DocUpload onUploadComplete={handleUploadComplete} />}
        </div>

        {/* Опция pathToArray */}
        {sessionId && (
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
              При включении AI найдёт верхнеуровневый массив в ответе API и использует его как pathToArray.
              <br />
              Все поля вне этого массива будут проигнорированы
            </span>
          </div>
        )}

        {/* Чат */}
        <div className="chat-doc-section">
          <h2>Чат</h2>
          <ChatPanel
            messages={messages}
            onSendMessage={handleSendMessage}
            isLoading={isLoading}
            disabled={!sessionId}
            loadingHint={isLoading ? (
              looksLikeFieldGeneration(messages.filter(m => m.role === 'user').at(-1)?.content)
                ? 'Генерирую поля... Это может занять до минуты'
                : 'Анализирую...'
            ) : ''}
          />
        </div>

        {/* Результаты */}
        {generatedData && (
          <div className="generated-content">
            <h2>Сгенерированные поля</h2>

            <div className="path-to-array-editor">
              <label htmlFor="path-to-array-chat">Путь к массиву данных:</label>
              {pathToArray !== null ? (
                <div className="path-to-array-input-group">
                  <input
                    id="path-to-array-chat"
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
              languages={albatoConfigRef.current.versionLanguages || ['en', 'ru']}
              showIsInArrayElement={pathToArray !== null}
              onFieldsChange={(updatedFields) => {
                setGeneratedData(prev => ({
                  ...prev,
                  fields: updatedFields,
                  request: rebuildRequestFields(updatedFields, prev.rowSections || [], prev.request, pathToArray),
                }));
              }}
            />

            <RowSectionsTable
              rowSections={generatedData.rowSections || []}
              languages={albatoConfigRef.current.versionLanguages || ['en', 'ru']}
              showIsInArrayElement={pathToArray !== null}
              onRowSectionsChange={(updatedSections) => {
                setGeneratedData(prev => ({
                  ...prev,
                  rowSections: updatedSections,
                  request: rebuildRequestFields(prev.fields || [], updatedSections, prev.request, pathToArray),
                }));
              }}
            />

            <RequestConfigEditor
              request={generatedData.request}
              onRequestChange={(updatedRequest) => {
                setGeneratedData(prev => ({ ...prev, request: updatedRequest }));
              }}
              hideRequestData={albatoConfigRef.current.triggerBehaviourType === 2}
            />

            <div className="send-section">
              <button
                onClick={handleSendToAlbato}
                disabled={isSending || !albatoConfigRef.current.albatoToken}
                className="send-button"
              >
                {isSending ? 'Отправка...' : 'Отправить в Albato'}
              </button>
              {!albatoConfigRef.current.albatoToken && (
                <div className="send-warning">Требуется авторизация в Albato</div>
              )}

              {sendResult && (
                <div className={`send-result ${sendResult.success ? 'success' : 'error'}`}>
                  <strong>{sendResult.success ? 'Успех:' : 'Ошибка:'}</strong> {sendResult.message}
                  {sendResult.errors && sendResult.errors.length > 0 && (
                    <ul className="send-error-details">
                      {sendResult.errors.map((err, idx) => (
                        <li key={idx}><strong>Поле {err.field}:</strong> {err.message}</li>
                      ))}
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
