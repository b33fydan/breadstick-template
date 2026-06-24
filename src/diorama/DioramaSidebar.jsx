import { useState } from 'react';
import { ORNAMENTS } from './ornamentCatalog';
import './DioramaSidebar.css';

const CATEGORIES = [
  { key: 'tools', label: 'Tools', icon: '🔧' },
  { key: 'decor', label: 'Decor', icon: '🪴' },
  { key: 'awards', label: 'Awards', icon: '🏆' },
];

export default function DioramaSidebar({
  selectedOrnament,
  onSelect,
  placedCount,
  onExport,
  onImport,
  open,
  onToggle,
  selectedInfo,
}) {
  const [category, setCategory] = useState('tools');
  const items = ORNAMENTS.filter(o => o.category === category);

  return (
    <div className={`diorama-sidebar ${open ? 'open' : 'closed'}`}>
      <button className="sidebar-toggle" onClick={onToggle}>
        {open ? '›' : '‹'}
      </button>

      {open && (
        <>
          <div className="sidebar-header">
            <h3>Ornaments</h3>
            <span className="placed-badge">{placedCount} placed</span>
          </div>

          <div className="category-tabs">
            {CATEGORIES.map(c => (
              <button
                key={c.key}
                className={`cat-tab ${category === c.key ? 'active' : ''}`}
                onClick={() => setCategory(c.key)}
              >
                <span className="cat-icon">{c.icon}</span>
                {c.label}
              </button>
            ))}
          </div>

          <div className="ornament-grid">
            {items.map(item => (
              <button
                key={item.id}
                className={`ornament-card ${selectedOrnament === item.id ? 'selected' : ''}`}
                onClick={() => onSelect(selectedOrnament === item.id ? null : item.id)}
                title={item.desc}
              >
                <span className="ornament-emoji">{item.emoji}</span>
                <span className="ornament-name">{item.name}</span>
              </button>
            ))}
          </div>

          {selectedInfo && (
            <div className="selected-info">
              <div className="info-row">
                <span className="info-emoji">
                  {ORNAMENTS.find(o => o.id === selectedInfo.id)?.emoji}
                </span>
                <div>
                  <strong>{ORNAMENTS.find(o => o.id === selectedInfo.id)?.name}</strong>
                  <span className="info-zone">on {selectedInfo.zone}</span>
                </div>
              </div>
              <p className="info-desc">
                {ORNAMENTS.find(o => o.id === selectedInfo.id)?.desc}
              </p>
            </div>
          )}

          {selectedOrnament && (
            <div className="placement-hint">
              Click a surface to place · Right-click to remove
            </div>
          )}

          <div className="sidebar-actions">
            <button className="action-btn" onClick={onExport}>
              ↓ Export Room
            </button>
            <button className="action-btn" onClick={onImport}>
              ↑ Import Room
            </button>
          </div>
        </>
      )}
    </div>
  );
}
