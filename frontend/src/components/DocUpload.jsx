import { useState, useRef } from 'react';
import api from '../utils/api';
import './DocUpload.css';

const ACCEPTED_TYPES = '.json,.yaml,.yml,.pdf,.txt,.md,.html';

/**
 * Компонент загрузки API документации.
 * Поддерживает drag-drop файлов и загрузку по URL.
 *
 * @param {Object} props
 * @param {function} props.onUploadComplete - Колбэк: (sessionId, summary, endpoints, sourceType) => void
 * @param {boolean} props.disabled
 */
export default function DocUpload({ onUploadComplete, disabled = false }) {
  const [isUploading, setIsUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [url, setUrl] = useState('');
  const [uploadMode, setUploadMode] = useState('file'); // 'file' | 'url'
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const handleFileUpload = async (file) => {
    if (!file) return;
    setIsUploading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await api.post('/chat/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onUploadComplete?.(response.data.sessionId, response.data.summary, response.data.endpoints || [], response.data.sourceType);
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка загрузки файла');
    } finally {
      setIsUploading(false);
    }
  };

  const handleUrlUpload = async () => {
    if (!url.trim()) return;
    setIsUploading(true);
    setError('');
    try {
      const response = await api.post('/chat/upload', { url: url.trim() });
      onUploadComplete?.(response.data.sessionId, response.data.summary, response.data.endpoints || [], response.data.sourceType);
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка загрузки по URL');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled || isUploading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileUpload(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    if (!disabled && !isUploading) setDragOver(true);
  };

  return (
    <div className="doc-upload">
      <div className="doc-upload-tabs">
        <button
          className={`doc-upload-tab ${uploadMode === 'file' ? 'active' : ''}`}
          onClick={() => setUploadMode('file')}
          disabled={disabled || isUploading}
        >
          Файл
        </button>
        <button
          className={`doc-upload-tab ${uploadMode === 'url' ? 'active' : ''}`}
          onClick={() => setUploadMode('url')}
          disabled={disabled || isUploading}
        >
          URL
        </button>
      </div>

      {uploadMode === 'file' ? (
        <div
          className={`doc-upload-dropzone ${dragOver ? 'drag-over' : ''} ${disabled || isUploading ? 'disabled' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={() => setDragOver(false)}
          onClick={() => !disabled && !isUploading && fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            onChange={(e) => handleFileUpload(e.target.files?.[0])}
            style={{ display: 'none' }}
          />
          {isUploading ? (
            <span className="doc-upload-status">Загрузка и анализ...</span>
          ) : (
            <>
              <span className="doc-upload-icon">&#128196;</span>
              <span className="doc-upload-text">Перетащите файл сюда или нажмите для выбора</span>
              <span className="doc-upload-hint">PDF, JSON, YAML, TXT</span>
            </>
          )}
        </div>
      ) : (
        <div className="doc-upload-url-section">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://api.example.com/docs/openapi.json"
            className="doc-upload-url-input"
            disabled={disabled || isUploading}
          />
          <button
            onClick={handleUrlUpload}
            disabled={disabled || isUploading || !url.trim()}
            className="doc-upload-url-button"
          >
            {isUploading ? 'Загрузка...' : 'Загрузить'}
          </button>
        </div>
      )}

      {error && <div className="doc-upload-error">{error}</div>}
    </div>
  );
}
