import { useState } from 'react';
import './RequestConfigEditor.css';

/**
 * Компонент для редактирования структуры request
 * @param {Object} props
 * @param {Object} props.request - Объект request
 * @param {Function} props.onRequestChange - Callback при изменении request
 */
function RequestConfigEditor({ request = {}, onRequestChange }) {
  // Логирование для отладки
  console.log('RequestConfigEditor received request:', request);
  console.log('Request fields count:', request.fields?.length || 0);
  console.log('Request response fields count:', request.response?.fields?.length || 0);
  
  const [expandedSections, setExpandedSections] = useState({
    data: true,
    fields: false,
    response: false,
  });

  const toggleSection = (section) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const updateRequestData = (key, value) => {
    onRequestChange({
      ...request,
      data: {
        ...(request.data || {}),
        [key]: value,
      },
    });
  };

  const updateResponseData = (key, value) => {
    onRequestChange({
      ...request,
      response: {
        ...(request.response || {}),
        data: {
          ...(request.response?.data || {}),
          [key]: value,
        },
      },
    });
  };

  return (
    <div className="request-config-editor">
      <h3>Конфигурация запроса (Request)</h3>

      {/* Request Data */}
      <div className="config-section">
        <button
          className="section-header"
          onClick={() => toggleSection('data')}
        >
          <span>{expandedSections.data ? '▼' : '▶'}</span>
          <span>Данные запроса (Request Data)</span>
        </button>
        {expandedSections.data && (
          <div className="section-content">
            <div className="form-group">
              <label htmlFor="request-url">
                URL: <span className="required-marker">*</span>
              </label>
              <input
                id="request-url"
                type="url"
                value={request.data?.url || ''}
                onChange={(e) => updateRequestData('url', e.target.value)}
                className={`config-input ${!request.data?.url ? 'error' : ''}`}
                required
                placeholder="https://api.example.com/endpoint"
              />
            </div>
            <div className="form-group">
              <label htmlFor="request-method">HTTP Метод:</label>
              <select
                id="request-method"
                value={request.data?.method ?? 1}
                onChange={(e) => updateRequestData('method', parseInt(e.target.value))}
                className="config-select"
              >
                <option value={0}>GET</option>
                <option value={1}>POST</option>
                <option value={2}>PUT</option>
                <option value={3}>DELETE</option>
                <option value={4}>PATCH</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="request-api-doc-url">URL документации API:</label>
              <input
                id="request-api-doc-url"
                type="url"
                value={request.data?.apiDocUrl || ''}
                onChange={(e) => updateRequestData('apiDocUrl', e.target.value)}
                className="config-input"
              />
            </div>
          </div>
        )}
      </div>

      {/* Request Fields */}
      <div className="config-section">
        <button
          className="section-header"
          onClick={() => toggleSection('fields')}
        >
          <span>{expandedSections.fields ? '▼' : '▶'}</span>
          <span>Поля запроса (Request Fields) - {request.fields?.length || 0} элементов</span>
        </button>
        {expandedSections.fields && (
          <div className="section-content">
            {request.fields && request.fields.length > 0 ? (
              <div className="fields-list">
                {request.fields.map((field, index) => {
                  console.log(`Rendering request field ${index}:`, field);
                  console.log(`Request field data:`, field.data);
                  return (
                    <div key={index} className="field-item">
                      <strong>Ключ:</strong> {field?.data?.key ?? '-'} |{' '}
                      <strong>Значение:</strong> {field?.data?.value ?? '-'} |{' '}
                      <strong>Тип:</strong> {field?.data?.valueType === 1 ? 'Строка' : field?.data?.valueType === 2 ? 'Число' : field?.data?.valueType ?? '-'} |{' '}
                      <strong>Обязательное:</strong> {field?.data?.required ? 'Да' : 'Нет'}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty-message">Нет полей запроса</div>
            )}
          </div>
        )}
      </div>

      {/* Response */}
      <div className="config-section">
        <button
          className="section-header"
          onClick={() => toggleSection('response')}
        >
          <span>{expandedSections.response ? '▼' : '▶'}</span>
          <span>Ответ (Response) - {request.response?.fields?.length || 0} полей</span>
        </button>
        {expandedSections.response && (
          <div className="section-content">
            <div className="form-group">
              <label htmlFor="response-format">Формат ответа:</label>
              <select
                id="response-format"
                value={request.response?.data?.format ?? 0}
                onChange={(e) => updateResponseData('format', parseInt(e.target.value))}
                className="config-select"
              >
                <option value={0}>JSON</option>
                <option value={1}>XML</option>
                <option value={2}>Text</option>
              </select>
            </div>
            {request.response?.fields && request.response.fields.length > 0 ? (
              <div className="fields-list">
                <h4>Поля ответа:</h4>
                {request.response.fields.map((field, index) => {
                  console.log(`Rendering response field ${index}:`, field);
                  console.log(`Response field data:`, field.data);
                  return (
                    <div key={index} className="field-item">
                      <strong>Ключ:</strong> {field?.data?.key ?? '-'} |{' '}
                      <strong>Код:</strong> {field?.data?.code ?? '-'} |{' '}
                      <strong>В массиве:</strong> {field?.data?.isInArrayElement ? 'Да' : 'Нет'}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty-message">Нет полей ответа</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default RequestConfigEditor;
