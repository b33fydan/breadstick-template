import { useState } from 'react';

export default function ScriptPanel({ script, productionPrompts, onClose }) {
  const [copied, setCopied] = useState(null);

  const handleCopy = async (text, key) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  if (!script) return null;

  const sections = [];
  if (productionPrompts) {
    if (productionPrompts.elevenlabs) sections.push({ key: 'voice', label: 'ElevenLabs Voice', text: productionPrompts.elevenlabs });
    if (productionPrompts.chatgpt) sections.push({ key: 'image', label: 'ChatGPT Image', text: productionPrompts.chatgpt });
    if (productionPrompts.kling) sections.push({ key: 'kling', label: 'Kling/Higgsfield', text: productionPrompts.kling });
    if (productionPrompts.slideshow) sections.push({ key: 'slides', label: 'Slideshow', text: productionPrompts.slideshow });
    if (productionPrompts.caption) sections.push({ key: 'caption', label: 'Caption + Hashtags', text: productionPrompts.caption });
    if (productionPrompts.manychat) sections.push({ key: 'manychat', label: 'ManyChat', text: productionPrompts.manychat });
  }

  return (
    <div className="cv-panel-overlay" onClick={onClose}>
      <div className="cv-panel" onClick={(e) => e.stopPropagation()}>
        <div className="cv-panel-header">
          <span>Generated Script</span>
          <button className="cv-panel-close" onClick={onClose}>x</button>
        </div>

        <div className="cv-panel-section">
          <div className="cv-panel-section-head">
            <span>Script</span>
            <button className="cv-btn cv-btn-sm" onClick={() => handleCopy(script, 'script')}>
              {copied === 'script' ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <pre className="cv-panel-pre">{script}</pre>
        </div>

        {sections.map((s) => (
          <div key={s.key} className="cv-panel-section">
            <div className="cv-panel-section-head">
              <span>{s.label}</span>
              <button className="cv-btn cv-btn-sm" onClick={() => handleCopy(s.text, s.key)}>
                {copied === s.key ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre className="cv-panel-pre">{s.text}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}
