import { useState, useRef, useEffect } from 'react';
import './SearchableSelect.css';

/**
 * Выпадающий список с поиском
 * @param {Object} props
 * @param {Array<{value: string, label: string}>} props.options - Список опций
 * @param {string} props.value - Текущее значение
 * @param {Function} props.onChange - Callback при выборе
 * @param {string} props.placeholder - Плейсхолдер
 * @param {string} [props.id] - HTML id
 */
function SearchableSelect({ options = [], value, onChange, placeholder = 'Выберите...', id, onRefresh, isRefreshing = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  const selectedOption = options.find(o => String(o.value) === String(value));

  const filtered = search
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  // Закрытие при клике вне компонента
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleOpen = () => {
    setIsOpen(true);
    setSearch('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSelect = (option) => {
    onChange(option.value);
    setIsOpen(false);
    setSearch('');
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange('');
    setIsOpen(false);
    setSearch('');
  };

  return (
    <div className="searchable-select" ref={containerRef} id={id}>
      <div className="searchable-select__trigger" onClick={handleOpen}>
        <span className={selectedOption ? 'searchable-select__value' : 'searchable-select__placeholder'}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <div className="searchable-select__actions">
          {selectedOption && (
            <button className="searchable-select__clear" onClick={handleClear} title="Очистить">&times;</button>
          )}
          <span className="searchable-select__arrow">{isOpen ? '\u25B2' : '\u25BC'}</span>
        </div>
      </div>

      {isOpen && (
        <div className="searchable-select__dropdown">
          <div className="searchable-select__search-row">
            <input
              ref={inputRef}
              type="text"
              className="searchable-select__search"
              placeholder="Поиск..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {onRefresh && (
              <button
                className="searchable-select__refresh"
                onClick={(e) => { e.stopPropagation(); onRefresh(); }}
                disabled={isRefreshing}
                title="Обновить список"
              >
                <span className={isRefreshing ? 'refreshing' : ''}>↻</span>
              </button>
            )}
          </div>
          <ul className="searchable-select__list">
            {filtered.length > 0 ? (
              filtered.map(option => (
                <li
                  key={option.value}
                  className={`searchable-select__item ${String(option.value) === String(value) ? 'selected' : ''}`}
                  onClick={() => handleSelect(option)}
                >
                  {option.label}
                </li>
              ))
            ) : (
              <li className="searchable-select__empty">Ничего не найдено</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

export default SearchableSelect;
