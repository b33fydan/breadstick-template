import { useState, useEffect } from 'react';
import { API_MODELS } from '../hooks/useScriptGenerator';

const STORAGE_KEY = 'breadstick-api-key';
const MODEL_KEY = 'breadstick-model';

export default function ApiSettings({ apiKey, model, onApiKeyChange, onModelChange }) {
  const [showKey, setShowKey] = useState(false);
  const [isOpen, setIsOpen] = useState(!apiKey);

  return (
    <div className="api-settings">
      <button className="api-settings-toggle" onClick={() => setIsOpen(!isOpen)}>
        <span className={`api-status ${apiKey ? 'connected' : 'disconnected'}`} />
        <span>{apiKey ? 'API Connected' : 'API Key Required'}</span>
        <span className="prompt-chevron">{isOpen ? '-' : '+'}</span>
      </button>

      {isOpen && (
        <div className="api-settings-body">
          <label className="api-label">
            Anthropic API Key
            <div className="api-key-input">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => onApiKeyChange(e.target.value)}
                placeholder="sk-ant-..."
              />
              <button className="btn-show-key" onClick={() => setShowKey(!showKey)}>
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>

          <label className="api-label">
            Model
            <select value={model} onChange={(e) => onModelChange(e.target.value)}>
              {API_MODELS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>

          <p className="api-hint">
            No API key? Click "Copy Prompt" instead — it copies the full prompt for pasting into Claude.
          </p>
        </div>
      )}
    </div>
  );
}

export function useApiSettings() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(STORAGE_KEY) || '');
  const [model, setModel] = useState(() => localStorage.getItem(MODEL_KEY) || API_MODELS[0]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, apiKey);
  }, [apiKey]);

  useEffect(() => {
    localStorage.setItem(MODEL_KEY, model);
  }, [model]);

  return { apiKey, model, setApiKey, setModel };
}
