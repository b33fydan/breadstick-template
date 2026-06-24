import { Handle, Position } from '@xyflow/react';

export default function ScriptGeneratorNode({ data }) {
  const {
    connectedCount = 0,
    status = 'idle', // idle | ready | generating | done | error
    onGenerate,
    onCopyPrompt,
    onOpenScript,
    scriptPreview,
    error,
    characterName,
  } = data;

  const statusColors = {
    idle: '#555566',
    ready: '#C9A227',
    generating: '#e85d75',
    done: '#2ecc71',
    error: '#e74c3c',
  };

  const statusLabels = {
    idle: 'Waiting for inputs',
    ready: 'Ready to generate',
    generating: 'Generating...',
    done: 'Script ready',
    error: 'Error',
  };

  const isReady = status === 'ready' || status === 'done';
  const isDone = status === 'done';
  const isGenerating = status === 'generating';

  return (
    <div
      className={`cv-node cv-generator cv-generator-${status}`}
      style={{ '--status-color': statusColors[status] }}
    >
      {/* Input handles */}
      <Handle type="target" position={Position.Left} id="painpoint-in" className="cv-handle" style={{ top: '20%' }} />
      <Handle type="target" position={Position.Left} id="hook-in" className="cv-handle" style={{ top: '40%' }} />
      <Handle type="target" position={Position.Left} id="scripttype-in" className="cv-handle" style={{ top: '60%' }} />
      <Handle type="target" position={Position.Left} id="conversion-in" className="cv-handle" style={{ top: '80%' }} />

      <div className="cv-generator-header">
        <div className="cv-generator-status-dot" />
        <span className="cv-generator-title">Script Generator</span>
      </div>

      {characterName && (
        <div className="cv-generator-character">{characterName}</div>
      )}

      <div className="cv-generator-count">{connectedCount}/4 inputs</div>
      <div className="cv-generator-status-text">{statusLabels[status]}</div>

      {error && <div className="cv-generator-error">{error}</div>}

      {isDone && scriptPreview && (
        <div className="cv-generator-preview" onClick={onOpenScript}>
          {scriptPreview}
        </div>
      )}

      <div className="cv-generator-actions">
        <button
          className="cv-btn cv-btn-generate"
          disabled={!isReady && !isDone || isGenerating}
          onClick={onGenerate}
        >
          {isGenerating ? 'Generating...' : isDone ? 'Regenerate' : 'Generate'}
        </button>
        <button
          className="cv-btn cv-btn-copy"
          disabled={connectedCount < 4}
          onClick={onCopyPrompt}
        >
          Copy Prompt
        </button>
      </div>

      {/* Output handle */}
      <Handle type="source" position={Position.Right} id="script-out" className="cv-handle cv-handle-source" />
    </div>
  );
}
