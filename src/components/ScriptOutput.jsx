import CopyButton from './CopyButton';

export default function ScriptOutput({ script, isGenerating, error }) {
  if (isGenerating) {
    return (
      <div className="script-output generating">
        <div className="generating-indicator">
          <div className="spinner" />
          <span>Generating script...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="script-output error">
        <div className="error-box">
          <strong>Generation Error</strong>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!script) return null;

  return (
    <div className="script-output">
      <div className="script-output-header">
        <h3>Generated Script</h3>
        <CopyButton text={script} label="Copy Script" />
      </div>
      <pre className="script-text">{script}</pre>
    </div>
  );
}
