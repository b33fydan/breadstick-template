export default function ToggleCard({ label, description, isSelected, onClick, accent }) {
  return (
    <button
      className={`toggle-card ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
      style={{ '--card-accent': accent }}
    >
      <div className="toggle-card-radio">
        <div className="toggle-card-radio-dot" />
      </div>
      <div className="toggle-card-content">
        <span className="toggle-card-label">{label}</span>
        {description && <span className="toggle-card-desc">{description}</span>}
      </div>
    </button>
  );
}
