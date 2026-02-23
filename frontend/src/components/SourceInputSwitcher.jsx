import { useState } from 'react';
import './SourceInputSwitcher.css';

const SOURCE_TYPES = {
  URL: 'url',
  CURL: 'curl',
  JSON: 'json',
};

function SourceInputSwitcher({ onSourceChange }) {
  const [sourceType, setSourceType] = useState(SOURCE_TYPES.URL);
  const [sourceValue, setSourceValue] = useState('');
  const [urlError, setUrlError] = useState('');
  const [curlError, setCurlError] = useState('');
  const [jsonError, setJsonError] = useState('');

  const validateUrl = (url) => {
    if (!url || url.trim() === '') {
      return 'URL не может быть пустым';
    }
    
    try {
      const urlObj = new URL(url);
      // Проверяем, что есть протокол (http или https)
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return 'URL должен использовать протокол http:// или https://';
      }
      return '';
    } catch (error) {
      return 'Неверный формат URL. Пример: https://api.example.com/docs';
    }
  };

  const validateCurl = (curl) => {
    if (!curl || curl.trim() === '') {
      return 'Команда curl не может быть пустой';
    }
    
    const trimmed = curl.trim().toLowerCase();
    if (!trimmed.startsWith('curl')) {
      return 'Команда должна начинаться со слова "curl"';
    }
    
    // Проверяем наличие URL в команде (http:// или https://)
    const urlPattern = /https?:\/\/[^\s'"`]+/;
    if (!urlPattern.test(curl)) {
      return 'В команде curl должен быть URL (http:// или https://)';
    }
    
    return '';
  };

  const validateJson = (json) => {
    if (!json || json.trim() === '') {
      return 'JSON не может быть пустым';
    }
    
    try {
      JSON.parse(json);
      return '';
    } catch (error) {
      return `Ошибка парсинга JSON: ${error.message}`;
    }
  };

  const handleTypeChange = (type) => {
    setSourceType(type);
    setSourceValue('');
    setUrlError('');
    setCurlError('');
    setJsonError('');
    if (onSourceChange) {
      onSourceChange({ type, value: '' });
    }
  };

  const handleValueChange = (value) => {
    setSourceValue(value);
    
    // Валидация в реальном времени
    if (sourceType === SOURCE_TYPES.URL) {
      const error = validateUrl(value);
      setUrlError(error);
      setCurlError('');
      setJsonError('');
    } else if (sourceType === SOURCE_TYPES.CURL) {
      const error = validateCurl(value);
      setCurlError(error);
      setUrlError('');
      setJsonError('');
    } else if (sourceType === SOURCE_TYPES.JSON) {
      const error = validateJson(value);
      setJsonError(error);
      setUrlError('');
      setCurlError('');
    } else {
      setUrlError('');
      setCurlError('');
      setJsonError('');
    }
    
    if (onSourceChange) {
      onSourceChange({ type: sourceType, value });
    }
  };

  return (
    <div className="source-input-switcher">
      <div className="source-type-selector">
        <button
          type="button"
          className={`type-button ${sourceType === SOURCE_TYPES.URL ? 'active' : ''}`}
          onClick={() => handleTypeChange(SOURCE_TYPES.URL)}
        >
          URL документации
        </button>
        <button
          type="button"
          className={`type-button ${sourceType === SOURCE_TYPES.CURL ? 'active' : ''}`}
          onClick={() => handleTypeChange(SOURCE_TYPES.CURL)}
        >
          Curl команда
        </button>
        <button
          type="button"
          className={`type-button ${sourceType === SOURCE_TYPES.JSON ? 'active' : ''}`}
          onClick={() => handleTypeChange(SOURCE_TYPES.JSON)}
        >
          JSON
        </button>
      </div>

      <div className="source-input-container">
        {sourceType === SOURCE_TYPES.URL && (
          <div className="input-group">
            <label htmlFor="url-input">URL документации API:</label>
            <input
              id="url-input"
              type="url"
              value={sourceValue}
              onChange={(e) => handleValueChange(e.target.value)}
              onBlur={(e) => {
                const error = validateUrl(e.target.value);
                setUrlError(error);
              }}
              placeholder="https://api.example.com/docs"
              className={`source-input ${urlError ? 'error' : ''}`}
            />
            {urlError && <div className="error-message">{urlError}</div>}
          </div>
        )}

        {sourceType === SOURCE_TYPES.CURL && (
          <div className="input-group">
            <label htmlFor="curl-input">Curl команда:</label>
            <textarea
              id="curl-input"
              value={sourceValue}
              onChange={(e) => handleValueChange(e.target.value)}
              onBlur={(e) => {
                const error = validateCurl(e.target.value);
                setCurlError(error);
              }}
              placeholder={'curl -X POST https://api.example.com/endpoint -H \'Content-Type: application/json\' -d \'{"key":"value"}\''}
              className={`source-textarea ${curlError ? 'error' : ''}`}
              rows="5"
            />
            {curlError && <div className="error-message">{curlError}</div>}
          </div>
        )}

        {sourceType === SOURCE_TYPES.JSON && (
          <div className="input-group">
            <label htmlFor="json-input">JSON (пример запроса или ответа):</label>
            <textarea
              id="json-input"
              value={sourceValue}
              onChange={(e) => handleValueChange(e.target.value)}
              onBlur={(e) => {
                const error = validateJson(e.target.value);
                setJsonError(error);
              }}
              placeholder='{"key": "value", "array": [1, 2, 3]}'
              className={`source-textarea ${jsonError ? 'error' : ''}`}
              rows="10"
            />
            {jsonError && <div className="error-message">{jsonError}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

export default SourceInputSwitcher;
export { SOURCE_TYPES };
