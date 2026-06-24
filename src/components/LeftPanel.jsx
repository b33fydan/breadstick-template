import { useState } from 'react';
import CharacterCard from './CharacterCard';
import AddCharacterForm from './AddCharacterForm';

export default function LeftPanel({
  characters,
  activeId,
  onSelect,
  onAdd,
  onDelete,
  collapsed,
  onToggleCollapse,
}) {
  const [showForm, setShowForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const handleAdd = (character) => {
    onAdd(character);
    setShowForm(false);
  };

  return (
    <aside className={`left-panel ${collapsed ? 'collapsed' : ''}`}>
      <div className="left-panel-header">
        <h2>Characters</h2>
        <button className="btn-collapse" onClick={onToggleCollapse}>
          {collapsed ? '>' : '<'}
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="character-list">
            {characters.map((char) => (
              <div key={char.id} className="character-card-wrapper">
                <CharacterCard
                  character={char}
                  isActive={char.id === activeId}
                  onClick={() => onSelect(char.id)}
                />
                {confirmDelete === char.id ? (
                  <div className="delete-confirm">
                    <span>Delete?</span>
                    <button onClick={() => { onDelete(char.id); setConfirmDelete(null); }}>Yes</button>
                    <button onClick={() => setConfirmDelete(null)}>No</button>
                  </div>
                ) : (
                  <button
                    className="btn-delete-char"
                    onClick={(e) => { e.stopPropagation(); setConfirmDelete(char.id); }}
                    title="Delete character"
                  >
                    x
                  </button>
                )}
              </div>
            ))}
          </div>

          {showForm ? (
            <AddCharacterForm onAdd={handleAdd} onCancel={() => setShowForm(false)} />
          ) : (
            <button className="btn-add-character" onClick={() => setShowForm(true)}>
              + Add Character
            </button>
          )}

          <div className="quick-stats">
            <h3>Quick Stats</h3>
            <div className="stat">{characters.length} Characters</div>
            <div className="stat">{characters.reduce((sum, c) => sum + c.hooks.length, 0)} Total Hooks</div>
            <div className="stat">{characters.reduce((sum, c) => sum + c.painPoints.length, 0)} Pain Points</div>
          </div>
        </>
      )}
    </aside>
  );
}
