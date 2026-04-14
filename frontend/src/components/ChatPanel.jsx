import { useState, useRef, useEffect } from 'react';
import './ChatPanel.css';

/**
 * UI компонент чата: список сообщений + поле ввода.
 *
 * @param {Object} props
 * @param {Array<{role: string, content: string, timestamp?: string}>} props.messages
 * @param {function} props.onSendMessage - (message: string) => void
 * @param {boolean} props.isLoading
 * @param {boolean} props.disabled
 */
export default function ChatPanel({ messages = [], onSendMessage, isLoading = false, disabled = false, loadingHint = '' }) {
  const [input, setInput] = useState('');
  const messagesContainerRef = useRef(null);
  const textareaRef = useRef(null);

  // Автоскролл вниз при новых сообщениях — только внутри контейнера чата
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isLoading || disabled) return;
    onSendMessage(text);
    setInput('');
    // Сбрасываем высоту textarea
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Авторастяжение textarea
  const handleInputChange = (e) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
  };

  return (
    <div className="chat-panel">
      <div className="chat-messages" ref={messagesContainerRef}>
        {messages.length === 0 && !isLoading && (
          <div className="chat-empty">
            Загрузите документацию и начните диалог. Например:
            <ul>
              <li>"Какие методы доступны?"</li>
              <li>"Сгенерируй поля для Create Contact"</li>
              <li>"POST /api/v1/orders"</li>
            </ul>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div key={idx} className={`chat-message chat-message--${msg.role}`}>
            <div className="chat-message-label">{msg.role === 'user' ? 'Вы' : 'AI'}</div>
            <div className="chat-message-content">
              {msg.content}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="chat-message chat-message--assistant">
            <div className="chat-message-label">AI</div>
            <div className="chat-message-content chat-typing">
              <span></span><span></span><span></span>
            </div>
            {loadingHint && <div className="chat-loading-hint">{loadingHint}</div>}
          </div>
        )}

      </div>

      <div className="chat-input-area">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'Сначала загрузите документацию...' : 'Напишите сообщение... (Enter для отправки, Shift+Enter для новой строки)'}
          disabled={isLoading || disabled}
          className="chat-input"
          rows="1"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || isLoading || disabled}
          className="chat-send-button"
        >
          &#9654;
        </button>
      </div>
    </div>
  );
}
