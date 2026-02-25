import { useState } from 'react';
import './FieldsTable.css';

/**
 * @typedef {Object} Field
 * @property {number|null} id
 * @property {number|null} versionId
 * @property {Object} data
 * @property {string} data.code
 * @property {number} data.valueType
 * @property {boolean} data.required
 * @property {boolean} data.isEditable
 * @property {string} data.dateCreated
 * @property {number|null} enumId
 * @property {string|null} titleEn
 * @property {string|null} titleRu
 * @property {string|null} hintEn
 * @property {string|null} hintRu
 */

/**
 * Компонент для отображения и редактирования массива fields
 * @param {Object} props
 * @param {Field[]} props.fields - Массив полей
 * @param {Function} props.onFieldsChange - Callback при изменении полей
 */
const NEW_FIELD_TEMPLATE = {
  id: null,
  versionId: null,
  data: {
    code: '',
    valueType: 1,
    required: false,
    isEditable: true,
    dateCreated: '',
  },
  enumId: null,
  titleEn: null,
  titleRu: null,
  hintEn: null,
  hintRu: null,
};

function FieldsTable({ fields = [], onFieldsChange }) {
  const [editingIndex, setEditingIndex] = useState(null);
  const [editedField, setEditedField] = useState(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newField, setNewField] = useState(null);
  
  // Логирование для отладки
  console.log('FieldsTable received fields:', fields);
  console.log('Fields type:', Array.isArray(fields) ? 'array' : typeof fields);
  console.log('Fields count:', Array.isArray(fields) ? fields.length : 0);
  console.log('Fields is array?', Array.isArray(fields));

  // Защита: убеждаемся, что fields - это массив
  const safeFields = Array.isArray(fields) ? fields : [];

  // Функция для получения названия типа по ID
  const getTypeName = (valueType) => {
    const typeMap = {
      1: 'String',
      2: 'Int',
      3: 'Decimal',
      5: 'DateTime',
      7: 'File',
      8: 'Date',
      9: 'Boolean',
      101: 'StringArray',
      102: 'IntArray',
    };
    return typeMap[valueType] || `Неизвестный (${valueType})`;
  };

  const handleEdit = (index) => {
    setEditingIndex(index);
    setEditedField({ ...safeFields[index] });
  };

  const handleSave = (index) => {
    // Валидация обязательных полей
    if (!editedField.data?.code || editedField.data.code.trim() === '') {
      alert('Поле "Код" является обязательным');
      return;
    }

    const updatedFields = [...safeFields];
    updatedFields[index] = editedField;
    onFieldsChange(updatedFields);
    setEditingIndex(null);
    setEditedField(null);
  };

  const handleCancel = () => {
    setEditingIndex(null);
    setEditedField(null);
  };

  const handleDelete = (index) => {
    if (window.confirm(`Вы уверены, что хотите удалить поле "${safeFields[index]?.data?.code || 'без кода'}"?`)) {
      const updatedFields = safeFields.filter((_, i) => i !== index);
      onFieldsChange(updatedFields);
    }
  };

  const handleAddNew = () => {
    setEditingIndex(null);
    setEditedField(null);
    setNewField({ ...NEW_FIELD_TEMPLATE, data: { ...NEW_FIELD_TEMPLATE.data } });
    setIsAdding(true);
  };

  const handleSaveNew = () => {
    if (!newField.data?.code || newField.data.code.trim() === '') {
      alert('Поле "Код" является обязательным');
      return;
    }
    onFieldsChange([...safeFields, newField]);
    setIsAdding(false);
    setNewField(null);
  };

  const handleCancelNew = () => {
    setIsAdding(false);
    setNewField(null);
  };

  const handleNewFieldChange = (key, value) => {
    if (key.startsWith('data.')) {
      const dataKey = key.replace('data.', '');
      setNewField(prev => ({ ...prev, data: { ...prev.data, [dataKey]: value } }));
    } else {
      setNewField(prev => ({ ...prev, [key]: value }));
    }
  };

  const handleToggleAll = (dataKey) => {
    const label = dataKey === 'required' ? 'обязательными' : 'редактируемыми';
    const choice = window.confirm(
      `Сделать все поля ${label}?\n\nОК — установить у всех\nОтмена — снять у всех`
    );
    const updatedFields = safeFields.map(field => ({
      ...field,
      data: { ...field.data, [dataKey]: choice },
    }));
    onFieldsChange(updatedFields);
  };

  const handleFieldChange = (field, key, value) => {
    if (key.startsWith('data.')) {
      const dataKey = key.replace('data.', '');
      setEditedField({
        ...field,
        data: {
          ...field.data,
          [dataKey]: value,
        },
      });
    } else {
      setEditedField({
        ...field,
        [key]: value,
      });
    }
  };

  if (safeFields.length === 0 && !isAdding) {
    return (
      <div className="fields-table-container">
        <div className="fields-table-header">
          <h3>Поля (Fields)</h3>
          <button onClick={handleAddNew} className="add-field-btn">+ Добавить поле</button>
        </div>
        <div className="fields-table-empty">Нет полей для отображения</div>
      </div>
    );
  }

  return (
    <div className="fields-table-container">
      <div className="fields-table-header">
        <h3>Поля (Fields)</h3>
        <button onClick={handleAddNew} className="add-field-btn" disabled={isAdding}>+ Добавить поле</button>
      </div>
      <table className="fields-table">
        <thead>
          <tr>
            <th>Код</th>
            <th>Тип</th>
            <th>
              Обязательное
              <button
                className="toggle-all-btn"
                onClick={() => handleToggleAll('required')}
                title="Сменить у всех полей"
              >
                Сменить у всех
              </button>
            </th>
            <th>
              Редактируемое
              <button
                className="toggle-all-btn"
                onClick={() => handleToggleAll('isEditable')}
                title="Сменить у всех полей"
              >
                Сменить у всех
              </button>
            </th>
            <th>Название (RU)</th>
            <th>Название (EN)</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          {safeFields.map((field, index) => {
            console.log(`Rendering field ${index}:`, field);
            console.log(`Field data:`, field.data);
            console.log(`Field titleRu:`, field.titleRu);
            console.log(`Field titleEn:`, field.titleEn);
            
            return (
            <tr key={index} className={editingIndex === index ? 'editing' : ''}>
              {editingIndex === index ? (
                <>
                  <td>
                    <input
                      type="text"
                      value={editedField.data.code || ''}
                      onChange={(e) => handleFieldChange(editedField, 'data.code', e.target.value)}
                      className={`field-input ${!editedField.data.code ? 'error' : ''}`}
                      required
                      placeholder="Обязательное поле"
                    />
                  </td>
                  <td>
                    <select
                      value={editedField.data.valueType || 1}
                      onChange={(e) => handleFieldChange(editedField, 'data.valueType', parseInt(e.target.value))}
                      className="field-select"
                    >
                      <option value={1}>String</option>
                      <option value={2}>Int</option>
                      <option value={3}>Decimal</option>
                      <option value={5}>DateTime</option>
                      <option value={7}>File</option>
                      <option value={8}>Date</option>
                      <option value={9}>Boolean</option>
                      <option value={101}>StringArray</option>
                      <option value={102}>IntArray</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={editedField.data.required || false}
                      onChange={(e) => handleFieldChange(editedField, 'data.required', e.target.checked)}
                      className="field-checkbox"
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={editedField.data.isEditable || false}
                      onChange={(e) => handleFieldChange(editedField, 'data.isEditable', e.target.checked)}
                      className="field-checkbox"
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={editedField.titleRu || ''}
                      onChange={(e) => handleFieldChange(editedField, 'titleRu', e.target.value || null)}
                      className="field-input"
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={editedField.titleEn || ''}
                      onChange={(e) => handleFieldChange(editedField, 'titleEn', e.target.value || null)}
                      className="field-input"
                    />
                  </td>
                  <td>
                    <div className="action-buttons-cell">
                      <button onClick={() => handleSave(index)} className="save-btn">Сохранить</button>
                      <button onClick={handleCancel} className="cancel-btn">Отмена</button>
                    </div>
                  </td>
                </>
              ) : (
                <>
                  <td>{field?.data?.code ?? '-'}</td>
                  <td>
                    {field?.data?.valueType ? getTypeName(field.data.valueType) : '-'}
                  </td>
                  <td>{field?.data?.required ? '✓' : '✗'}</td>
                  <td>{field?.data?.isEditable ? '✓' : '✗'}</td>
                  <td>{field?.titleRu ?? '-'}</td>
                  <td>{field?.titleEn ?? '-'}</td>
                  <td>
                    <div className="action-buttons-cell">
                      <button onClick={() => handleEdit(index)} className="edit-btn">Редактировать</button>
                      <button onClick={() => handleDelete(index)} className="delete-btn">Удалить</button>
                    </div>
                  </td>
                </>
              )}
            </tr>
            );
          })}
          {isAdding && newField && (
            <tr className="editing">
              <td>
                <input
                  type="text"
                  value={newField.data.code || ''}
                  onChange={(e) => handleNewFieldChange('data.code', e.target.value)}
                  className={`field-input ${!newField.data.code ? 'error' : ''}`}
                  placeholder="Обязательное поле"
                  autoFocus
                />
              </td>
              <td>
                <select
                  value={newField.data.valueType || 1}
                  onChange={(e) => handleNewFieldChange('data.valueType', parseInt(e.target.value))}
                  className="field-select"
                >
                  <option value={1}>String</option>
                  <option value={2}>Int</option>
                  <option value={3}>Decimal</option>
                  <option value={5}>DateTime</option>
                  <option value={7}>File</option>
                  <option value={8}>Date</option>
                  <option value={9}>Boolean</option>
                  <option value={101}>StringArray</option>
                  <option value={102}>IntArray</option>
                </select>
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={newField.data.required || false}
                  onChange={(e) => handleNewFieldChange('data.required', e.target.checked)}
                  className="field-checkbox"
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={newField.data.isEditable || false}
                  onChange={(e) => handleNewFieldChange('data.isEditable', e.target.checked)}
                  className="field-checkbox"
                />
              </td>
              <td>
                <input
                  type="text"
                  value={newField.titleRu || ''}
                  onChange={(e) => handleNewFieldChange('titleRu', e.target.value || null)}
                  className="field-input"
                />
              </td>
              <td>
                <input
                  type="text"
                  value={newField.titleEn || ''}
                  onChange={(e) => handleNewFieldChange('titleEn', e.target.value || null)}
                  className="field-input"
                />
              </td>
              <td>
                <div className="action-buttons-cell">
                  <button onClick={handleSaveNew} className="save-btn">Сохранить</button>
                  <button onClick={handleCancelNew} className="cancel-btn">Отмена</button>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="fields-table-footer">
        <button onClick={handleAddNew} className="add-field-btn" disabled={isAdding}>+ Добавить поле</button>
      </div>
    </div>
  );
}

export default FieldsTable;
