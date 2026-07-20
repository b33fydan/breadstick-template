import { useState } from 'react';
import { AGENTS, buildSixteenGamiPrompt } from '../data/sixteenGami';
import CopyButton from './CopyButton';

export default function SixteenGamiPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [elements, setElements] = useState({
    includeScene: true,
    includeCharacter: true,
    includeProp: true,
  });

  const agent = AGENTS.find((a) => a.id === selectedAgent);
  const anySelected = elements.includeScene || elements.includeCharacter || elements.includeProp;
  const prompt = agent && anySelected ? buildSixteenGamiPrompt(agent, elements) : '';

  const toggleElement = (key) => {
    setElements((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const elementCount = [elements.includeScene, elements.includeCharacter, elements.includeProp].filter(Boolean).length;

  return (
    <div className="panel-section">
      <button
        className="panel-section-header"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="panel-section-title">
          <span className="panel-icon">◆</span>
          16-GAMI — Nano Banana Prompt Generator
        </span>
        <span className="panel-section-toggle">{isOpen ? '▾' : '▸'}</span>
      </button>

      {isOpen && (
        <div className="sixteen-gami-content">
          {/* Agent selector */}
          <div className="gami-section">
            <h4 className="gami-section-title">AGENT</h4>
            <div className="gami-agent-grid">
              {AGENTS.map((a) => (
                <button
                  key={a.id}
                  className={`gami-agent-card ${selectedAgent === a.id ? 'selected' : ''}`}
                  onClick={() => setSelectedAgent(selectedAgent === a.id ? null : a.id)}
                  style={{ '--agent-color': a.color }}
                >
                  <div className="gami-agent-dot" />
                  <div className="gami-agent-info">
                    <span className="gami-agent-name">{a.name}</span>
                    <span className="gami-agent-role">{a.role}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Element toggles */}
          {selectedAgent && (
            <div className="gami-section">
              <h4 className="gami-section-title">
                SCENE ELEMENTS
                <span className="gami-count">{elementCount}/3</span>
              </h4>
              <div className="gami-element-grid">
                <button
                  className={`gami-element-toggle ${elements.includeScene ? 'active' : ''}`}
                  onClick={() => toggleElement('includeScene')}
                >
                  <span className="gami-el-icon">◻</span>
                  <span className="gami-el-label">Scene</span>
                  <span className="gami-el-desc">
                    {agent?.environment.setting.split(' with')[0]}
                  </span>
                </button>
                <button
                  className={`gami-element-toggle ${elements.includeCharacter ? 'active' : ''}`}
                  onClick={() => toggleElement('includeCharacter')}
                >
                  <span className="gami-el-icon">◈</span>
                  <span className="gami-el-label">Character</span>
                  <span className="gami-el-desc">{agent?.name}</span>
                </button>
                <button
                  className={`gami-element-toggle ${elements.includeProp ? 'active' : ''}`}
                  onClick={() => toggleElement('includeProp')}
                >
                  <span className="gami-el-icon">◇</span>
                  <span className="gami-el-label">Prop</span>
                  <span className="gami-el-desc">{agent?.prop.object}</span>
                </button>
              </div>
            </div>
          )}

          {/* Generated prompt */}
          {prompt && (
            <div className="gami-section">
              <div className="gami-prompt-header">
                <h4 className="gami-section-title">NANO BANANA PROMPT</h4>
                <CopyButton text={prompt} label="Copy Prompt" />
              </div>
              <div className="gami-prompt-output">
                {prompt}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
