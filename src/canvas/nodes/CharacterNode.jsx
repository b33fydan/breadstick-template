import { Handle, Position } from '@xyflow/react';

export default function CharacterNode({ data }) {
  const { character, onSpawnIngredients } = data;
  if (!character) return null;

  return (
    <div className="cv-node cv-character" style={{ '--accent': character.accentColor }}>
      <div className="cv-character-bar" />
      <div className="cv-character-body">
        <div className="cv-character-name">{character.name}</div>
        <div className="cv-character-niche">{character.niche}</div>
        <div className="cv-character-handle">{character.handle}</div>
        {onSpawnIngredients && (
          <button className="cv-spawn-btn" onClick={onSpawnIngredients}>
            + Ingredients
          </button>
        )}
      </div>
      <Handle type="source" position={Position.Right} id="character-out" className="cv-handle cv-handle-source" />
    </div>
  );
}
