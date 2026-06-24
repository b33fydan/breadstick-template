import { useState } from 'react';
import CopyButton from './CopyButton';

const SECTIONS = [
  { key: 'elevenlabs', label: 'ElevenLabs Voice Prompt', icon: 'V' },
  { key: 'chatgpt', label: 'ChatGPT Image Prompt', icon: 'I' },
  { key: 'kling', label: 'Kling / Higgsfield Animation', icon: 'A' },
  { key: 'slideshow', label: 'Slideshow (TikTok)', icon: 'S' },
  { key: 'caption', label: 'Caption + Hashtags', icon: 'C' },
  { key: 'manychat', label: 'ManyChat Trigger', icon: 'M' },
];

export default function ProductionPrompts({ prompts }) {
  const [openSections, setOpenSections] = useState({});

  if (!prompts) return null;

  const toggle = (key) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const expandAll = () => {
    const all = {};
    SECTIONS.forEach((s) => { all[s.key] = true; });
    setOpenSections(all);
  };

  const collapseAll = () => setOpenSections({});

  return (
    <div className="production-prompts">
      <div className="production-header">
        <h3>Production Prompts</h3>
        <div className="production-actions">
          <button className="btn-text" onClick={expandAll}>Expand All</button>
          <button className="btn-text" onClick={collapseAll}>Collapse All</button>
        </div>
      </div>

      {SECTIONS.map(({ key, label, icon }) => {
        const content = prompts[key];
        if (!content) return null;

        const isOpen = openSections[key];

        return (
          <div key={key} className={`prompt-section ${isOpen ? 'open' : ''}`}>
            <button className="prompt-section-toggle" onClick={() => toggle(key)}>
              <span className="prompt-icon">{icon}</span>
              <span className="prompt-label">{label}</span>
              <span className="prompt-chevron">{isOpen ? '-' : '+'}</span>
            </button>
            {isOpen && (
              <div className="prompt-section-body">
                <CopyButton text={content} />
                <pre className="prompt-text">{content}</pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
