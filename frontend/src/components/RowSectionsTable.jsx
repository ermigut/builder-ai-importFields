import { useState } from 'react';
import FieldsTable from './FieldsTable';
import './RowSectionsTable.css';

/** 'en' → 'titleEn', 'ru' → 'titleRu', 'pt' → 'titlePt', etc. */
const langToTitleKey = (lang) => 'title' + lang.charAt(0).toUpperCase() + lang.slice(1);

/**
 * Компонент для отображения и редактирования строковых секций (rowSections)
 * @param {Object} props
 * @param {Array} props.rowSections
 * @param {Function} props.onRowSectionsChange
 * @param {string[]} props.languages - Список кодов языков
 */
function RowSectionsTable({ rowSections = [], onRowSectionsChange, languages = ['en', 'ru'] }) {
  const [expandedIndexes, setExpandedIndexes] = useState(() => {
    return new Set(rowSections.map((_, i) => i));
  });
  const [editingIndex, setEditingIndex] = useState(null);
  const [editedSection, setEditedSection] = useState(null);

  const safeSections = Array.isArray(rowSections) ? rowSections : [];

  const toggleExpand = (index) => {
    setExpandedIndexes(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleEdit = (index) => {
    setEditingIndex(index);
    setEditedSection({ ...safeSections[index], data: { ...safeSections[index].data } });
  };

  const handleSave = (index) => {
    if (!editedSection.data?.code || editedSection.data.code.trim() === '') {
      alert('Поле "Код секции" является обязательным');
      return;
    }
    const updated = [...safeSections];
    updated[index] = editedSection;
    onRowSectionsChange(updated);
    setEditingIndex(null);
    setEditedSection(null);
  };

  const handleCancel = () => {
    setEditingIndex(null);
    setEditedSection(null);
  };

  const handleDelete = (index) => {
    const code = safeSections[index]?.data?.code || 'без кода';
    if (window.confirm(`Вы уверены, что хотите удалить строковую секцию "${code}"?`)) {
      onRowSectionsChange(safeSections.filter((_, i) => i !== index));
    }
  };

  const handleSectionFieldsChange = (sectionIndex, newFields) => {
    const updated = safeSections.map((section, i) =>
      i === sectionIndex ? { ...section, fields: newFields } : section
    );
    onRowSectionsChange(updated);
  };

  if (safeSections.length === 0) {
    return null;
  }

  return (
    <div className="row-sections-container">
      <h3>Строковые секции (Row Sections)</h3>
      <div className="row-sections-list">
        {safeSections.map((section, index) => {
          const isExpanded = expandedIndexes.has(index);
          const isEditing = editingIndex === index;
          const code = section?.data?.code || '—';
          const fieldsCount = Array.isArray(section?.fields) ? section.fields.length : 0;

          return (
            <div key={index} className="row-section-card">
              <div className="row-section-header">
                <button
                  className="expand-btn"
                  onClick={() => toggleExpand(index)}
                  title={isExpanded ? 'Свернуть' : 'Развернуть'}
                >
                  {isExpanded ? '▼' : '▶'}
                </button>

                {isEditing ? (
                  <div className="row-section-edit-header">
                    <label>Код:
                      <input
                        type="text"
                        value={editedSection.data?.code || ''}
                        onChange={(e) => setEditedSection(prev => ({
                          ...prev,
                          data: { ...prev.data, code: e.target.value },
                        }))}
                        className="section-input"
                      />
                    </label>
                    {languages.map(lang => {
                      const key = langToTitleKey(lang);
                      return (
                        <label key={lang}>Название ({lang.toUpperCase()}):
                          <input
                            type="text"
                            value={editedSection[key] || ''}
                            onChange={(e) => setEditedSection(prev => ({
                              ...prev,
                              [key]: e.target.value || null,
                            }))}
                            className="section-input"
                          />
                        </label>
                      );
                    })}
                    <div className="section-header-actions">
                      <button onClick={() => handleSave(index)} className="save-btn">Сохранить</button>
                      <button onClick={handleCancel} className="cancel-btn">Отмена</button>
                    </div>
                  </div>
                ) : (
                  <div className="row-section-info">
                    <span className="section-code">{code}</span>
                    {languages.map(lang => {
                      const key = langToTitleKey(lang);
                      const title = section?.[key];
                      return title
                        ? <span key={lang} className={`section-title section-title-${lang}`}>{title}</span>
                        : null;
                    })}
                    <span className="section-fields-count">({fieldsCount} полей)</span>
                  </div>
                )}

                {!isEditing && (
                  <div className="row-section-actions">
                    <button onClick={() => handleEdit(index)} className="edit-btn">Редактировать</button>
                    <button onClick={() => handleDelete(index)} className="delete-btn">Удалить</button>
                  </div>
                )}
              </div>

              {isExpanded && (
                <div className="row-section-body">
                  {fieldsCount > 0 ? (
                    <FieldsTable
                      fields={section.fields}
                      languages={languages}
                      onFieldsChange={(newFields) => handleSectionFieldsChange(index, newFields)}
                    />
                  ) : (
                    <div className="row-section-no-fields">Нет полей в секции</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default RowSectionsTable;
