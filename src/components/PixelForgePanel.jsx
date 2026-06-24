import { useState, useMemo } from 'react';
import {
  bitDepths,
  stylePresets,
  assetTypes,
  viewAngles,
  qualityMods,
  buildPixelArtPrompt,
} from '../data/pixelArt';
import CopyButton from './CopyButton';

const styleCategories = [...new Set(stylePresets.map((s) => s.category))];

export default function PixelForgePanel() {
  const [subject, setSubject] = useState('');
  const [selectedDepth, setSelectedDepth] = useState('16');
  const [selectedStyle, setSelectedStyle] = useState('none');
  const [selectedAsset, setSelectedAsset] = useState('background');
  const [selectedView, setSelectedView] = useState('default');
  const [selectedQuality, setSelectedQuality] = useState(['clean']);
  const [generatedPrompts, setGeneratedPrompts] = useState(null);

  const toggleQuality = (id) => {
    setSelectedQuality((prev) =>
      prev.includes(id) ? prev.filter((q) => q !== id) : [...prev, id]
    );
  };

  const canGenerate = subject.trim().length > 0;

  const handleGenerate = () => {
    if (!canGenerate) return;

    // Build 3 variations
    const variations = [
      { mood: '' },
      { mood: ', dramatic lighting, moody atmosphere' },
      { mood: ', vibrant colors, dynamic composition' },
    ];

    const results = variations.map((v, i) => {
      const result = buildPixelArtPrompt({
        subject: subject + v.mood,
        bitDepth: selectedDepth,
        style: selectedStyle,
        assetType: selectedAsset,
        viewAngle: selectedView,
        quality: selectedQuality,
      });
      return { ...result, index: i + 1 };
    });

    setGeneratedPrompts(results);
  };

  const copyAllPrompts = () => {
    if (!generatedPrompts) return '';
    return generatedPrompts.map((r) => r.prompt).join('\n\n');
  };

  const currentAsset = assetTypes.find((a) => a.id === selectedAsset);
  const currentDepth = bitDepths.find((b) => b.id === selectedDepth);

  return (
    <div className="forge-panel">
      <div className="forge-header">
        <div className="forge-title-row">
          <h3>Pixel Art Forge</h3>
          <span className="forge-nano-badge">Nano Banana Pro</span>
        </div>
        <p className="forge-subtitle">Video game asset prompt generator for Midjourney</p>
      </div>

      {/* Bit-Depth Selector */}
      <div className="forge-controls">
        <div className="forge-control-group">
          <span className="forge-control-label">Bit-Depth</span>
          <div className="forge-depth-grid">
            {bitDepths.map((d) => (
              <button
                key={d.id}
                className={`forge-depth-btn ${selectedDepth === d.id ? 'selected' : ''}`}
                onClick={() => setSelectedDepth(d.id)}
              >
                <span className="depth-label">{d.label}</span>
                <span className="depth-era">{d.era}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="forge-control-group">
          <span className="forge-control-label">Asset Type</span>
          <div className="forge-asset-grid">
            {assetTypes.map((a) => (
              <button
                key={a.id}
                className={`forge-asset-btn ${selectedAsset === a.id ? 'selected' : ''}`}
                onClick={() => setSelectedAsset(a.id)}
                title={a.desc}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Style Selector */}
      <div className="forge-styles">
        <span className="forge-control-label">Style Reference</span>
        <div className="forge-style-categories">
          {styleCategories.map((cat) => (
            <div key={cat} className="forge-style-cat">
              <span className="forge-cat-label">{cat}</span>
              <div className="forge-style-row">
                {stylePresets
                  .filter((s) => s.category === cat)
                  .map((s) => (
                    <button
                      key={s.id}
                      className={`forge-style-btn ${selectedStyle === s.id ? 'selected' : ''}`}
                      onClick={() => setSelectedStyle(s.id)}
                    >
                      {s.label}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* View Angle + Quality */}
      <div className="forge-controls forge-extras">
        <div className="forge-control-group">
          <span className="forge-control-label">View Angle</span>
          <div className="forge-view-grid">
            {viewAngles.map((v) => (
              <button
                key={v.id}
                className={`forge-view-btn ${selectedView === v.id ? 'selected' : ''}`}
                onClick={() => setSelectedView(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        <div className="forge-control-group">
          <span className="forge-control-label">Quality Mods</span>
          <div className="forge-quality-grid">
            {qualityMods.map((q) => (
              <button
                key={q.id}
                className={`forge-quality-btn ${selectedQuality.includes(q.id) ? 'selected' : ''}`}
                onClick={() => toggleQuality(q.id)}
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Subject Input + Generate */}
      <div className="forge-input-area">
        <div className="forge-input-row">
          <input
            type="text"
            className="forge-subject-input"
            placeholder="Describe the asset... (e.g. haunted castle interior, fire mage, forest tileset)"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
          />
          <button
            className="forge-generate-btn"
            disabled={!canGenerate}
            onClick={handleGenerate}
          >
            Generate Prompts
          </button>
        </div>
        <div className="forge-input-meta">
          <span>{currentDepth?.label} / {currentAsset?.label} / AR {currentAsset?.ar}</span>
        </div>
      </div>

      {/* Generated Prompts Output */}
      {generatedPrompts && (
        <div className="forge-output">
          <div className="forge-output-header">
            <span className="forge-output-title">Generated Prompts</span>
            <CopyButton text={copyAllPrompts()} label="Copy All" />
          </div>

          {generatedPrompts.map((result) => (
            <div key={result.index} className="forge-prompt-card">
              <div className="forge-prompt-top">
                <span className="forge-prompt-num">Variation {result.index}</span>
                <div className="forge-prompt-tags">
                  <span className="forge-tag depth">{result.bitDepth.label}</span>
                  <span className="forge-tag asset">{result.asset.label}</span>
                  {result.style && result.style.id !== 'none' && (
                    <span className="forge-tag style">{result.style.label}</span>
                  )}
                </div>
                <CopyButton text={result.prompt} label="Copy" />
              </div>
              <pre className="forge-prompt-text">{result.prompt}</pre>
              <div className="forge-pixelit-hint">
                Pixel It: block {result.bitDepth.pixelIt.blockSize}, max {result.bitDepth.pixelIt.maxColors} colors
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
