export default function CharacterCard({ character, isActive, onClick }) {
  return (
    <button
      className={`character-card ${isActive ? 'active' : ''}`}
      onClick={onClick}
      style={{
        '--accent': character.accentColor,
      }}
    >
      <div className="character-card-indicator" />
      <div className="character-card-info">
        <span className="character-card-name">
          {character.name}
          {character.isUGC && <span className="ugc-badge">UGC</span>}
        </span>
        <span className="character-card-niche">{character.niche}</span>
        <span className="character-card-handle">{character.handle}</span>
      </div>
    </button>
  );
}
