import { useState, useMemo } from 'react';
import { videoPlatforms, promptStyles, clipModes, getTiersForMode, buildSora2Prompts } from '../data/sora2';
import CopyButton from './CopyButton';

export default function Sora2Panel({ character, scriptText }) {
  const [clipMode, setClipMode] = useState('clip-mode');
  const [selectedTier, setSelectedTier] = useState('cm-30s');
  const [orientation, setOrientation] = useState('portrait');
  const [platform, setPlatform] = useState('kling');
  const [promptStyle, setPromptStyle] = useState('ugc');
  const [openClips, setOpenClips] = useState({});

  const activeTiers = useMemo(() => getTiersForMode(clipMode), [clipMode]);

  const result = useMemo(() => {
    if (!character || !scriptText) return null;
    return buildSora2Prompts(character, scriptText, selectedTier, orientation, platform, promptStyle, clipMode);
  }, [character, scriptText, selectedTier, orientation, platform, promptStyle, clipMode]);

  // Auto-expand all clips when result changes (so none are hidden)
  useMemo(() => {
    if (result) {
      const all = {};
      result.clips.forEach((_, i) => { all[i] = true; });
      setOpenClips(all);
    }
  }, [result]);

  if (!scriptText) return null;

  const toggleClip = (i) => {
    setOpenClips((prev) => ({ ...prev, [i]: !prev[i] }));
  };

  const expandAll = () => {
    const all = {};
    result?.clips.forEach((_, i) => { all[i] = true; });
    setOpenClips(all);
  };

  const collapseAll = () => setOpenClips({});

  const copyAllPrompts = () => {
    if (!result) return '';
    let output = '';
    // For Sora 2 with cameo, prepend the full continuity header as fallback reference
    if (result.hasCameo) {
      output += `=== CHARACTER REFERENCE (for Kling/Seedance fallback) ===\n\n${result.continuityHeader}\n\n`;
    }
    output += result.clips.join('\n\n') + '\n\n' + result.assembly;
    return output;
  };

  const isSora2 = platform === 'sora2';
  const hasCameo = isSora2 && !!character.cameoName;

  return (
    <div className="sora2-panel">
      <div className="sora2-header">
        <div className="sora2-title-row">
          <h3>Video Generation Prompts</h3>
          <CopyButton text={copyAllPrompts()} label="Copy All Prompts" />
        </div>
        <p className="sora2-subtitle">Multi-clip continuity prompts with script — select your platform below</p>
      </div>

      {/* Platform Selector */}
      <div className="sora2-controls">
        <div className="sora2-control-group">
          <span className="sora2-control-label">Platform</span>
          <div className="sora2-platform-grid">
            {videoPlatforms.map((p) => (
              <button
                key={p.id}
                className={`sora2-platform-btn ${platform === p.id ? 'selected' : ''} ${!p.available ? 'unavailable' : ''} ${p.deprecated ? 'deprecated' : ''}`}
                onClick={() => { if (p.available) { setPlatform(p.id); setOpenClips({}); } }}
                title={p.description}
              >
                <span className="platform-label">{p.label}</span>
                {p.deprecated && <span className="platform-badge deprecated-badge">DEPRECATED</span>}
                {!p.available && <span className="platform-badge">Coming Soon</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Clip Mode */}
        <div className="sora2-control-group">
          <span className="sora2-control-label">Clip Mode</span>
          <div className="sora2-platform-grid">
            {clipModes.map((m) => (
              <button
                key={m.id}
                className={`sora2-platform-btn ${clipMode === m.id ? 'selected' : ''}`}
                onClick={() => {
                  setClipMode(m.id);
                  const newTiers = getTiersForMode(m.id);
                  setSelectedTier(newTiers[0]?.id || '');
                  setOpenClips({});
                }}
                title={m.description}
              >
                <span className="platform-label">{m.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Prompt Style */}
        <div className="sora2-control-group">
          <span className="sora2-control-label">Prompt Style</span>
          <div className="sora2-platform-grid">
            {promptStyles.map((s) => (
              <button
                key={s.id}
                className={`sora2-platform-btn ${promptStyle === s.id ? 'selected' : ''}`}
                onClick={() => { setPromptStyle(s.id); setOpenClips({}); }}
                title={s.description}
              >
                <span className="platform-label">{s.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Video Length */}
        <div className="sora2-control-group">
          <span className="sora2-control-label">Video Length</span>
          <div className="sora2-tier-grid">
            {activeTiers.map((tier) => {
              const talkingCount = tier.clips.filter(c => !c.type || c.type === 'talking').length;
              const brollCount = tier.clips.filter(c => c.type === 'broll').length;
              const clipInfo = brollCount > 0 ? `${talkingCount}T + ${brollCount}B` : `${tier.clips.length} clips`;
              return (
                <button
                  key={tier.id}
                  className={`sora2-tier-btn ${selectedTier === tier.id ? 'selected' : ''}`}
                  onClick={() => { setSelectedTier(tier.id); setOpenClips({}); }}
                >
                  <span className="tier-label">{tier.label}</span>
                  <span className="tier-clips">{clipInfo}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="sora2-control-group">
          <span className="sora2-control-label">Orientation</span>
          <div className="sora2-orient-grid">
            <button
              className={`sora2-orient-btn ${orientation === 'portrait' ? 'selected' : ''}`}
              onClick={() => setOrientation('portrait')}
            >
              Portrait (720x1280)
            </button>
            <button
              className={`sora2-orient-btn ${orientation === 'landscape' ? 'selected' : ''}`}
              onClick={() => setOrientation('landscape')}
            >
              Landscape (1280x720)
            </button>
          </div>
        </div>
      </div>

      {/* Sora 2 Deprecation Warning */}
      {platform === 'sora2' && (
        <div className="sora2-deprecation-warning">
          <span className="deprecation-icon">&#9888;</span>
          <span>Sora 2 is shut down (platform + API). These prompts are kept for reference only — they may work on other platforms with adaptation. Use Kling or Veo 3 for active production.</span>
        </div>
      )}

      {/* V4 Realism Badge */}
      {promptStyle === 'ugc' && (
        <div className="sora2-v4-badge">
          <span className="v4-dot" />
          <span>FutrGroup V4 active — iPhone UGC realism, anti-artifact rules, hand safety, lip sync protection, chaos realism enforced on all clips</span>
        </div>
      )}

      {/* Cameo Status for Sora 2 */}
      {isSora2 && (
        <div className={`sora2-cameo-status ${hasCameo ? 'active' : 'placeholder'}`}>
          {hasCameo ? (
            <>
              <span className="cameo-dot active" />
              <span>Cameo active: <strong>{character.cameoName}</strong> — clips use cameo reference (no character re-prompting)</span>
            </>
          ) : (
            <>
              <span className="cameo-dot placeholder" />
              <span>No cameo set for {character.name} — clips will include full character description. Create a cameo in Sora 2 and add the cameo name to this character to enable lean prompts.</span>
            </>
          )}
        </div>
      )}

      {/* Tier Description */}
      {result && (
        <div className="sora2-tier-info">
          <span className="sora2-tier-desc">{result.tier.description}</span>
          <span className="sora2-tier-duration">
            {result.tier.clips.length} clips / {result.tier.clips.reduce((s, c) => s + c.seconds, 0)}s total
          </span>
        </div>
      )}

      {/* Continuity Header — always shown for reference */}
      {result && (
        <div className="sora2-continuity">
          <div className="sora2-continuity-header">
            <span className="sora2-section-label">
              {hasCameo ? 'Character Reference (for Kling/Seedance fallback)' : 'Continuity Header (shared across all clips)'}
            </span>
            <CopyButton text={result.continuityHeader} />
          </div>
          <pre className="sora2-continuity-text">{result.continuityHeader}</pre>
        </div>
      )}

      {/* Clip Prompts */}
      {result && (
        <div className="sora2-clips">
          <div className="sora2-clips-header">
            <span className="sora2-section-label">Clip Prompts</span>
            <div className="sora2-clips-actions">
              <button className="btn-text" onClick={expandAll}>Expand All</button>
              <button className="btn-text" onClick={collapseAll}>Collapse All</button>
            </div>
          </div>

          {result.clips.map((clipText, i) => {
            const clip = result.tier.clips[i];
            const isOpen = openClips[i];

            return (
              <div key={i} className={`sora2-clip ${isOpen ? 'open' : ''}`}>
                <button className="sora2-clip-toggle" onClick={() => toggleClip(i)}>
                  <span className="clip-number">Clip {i + 1}</span>
                  <span className="clip-beat">{clip.beat}</span>
                  <span className="clip-duration">{clip.seconds}s</span>
                  <span className="prompt-chevron">{isOpen ? '-' : '+'}</span>
                </button>
                {isOpen && (
                  <div className="sora2-clip-body">
                    <CopyButton text={clipText} />
                    <pre className="sora2-clip-text">{clipText}</pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Assembly Notes */}
      {result && (
        <div className="sora2-assembly">
          <div className="sora2-assembly-header">
            <span className="sora2-section-label">Assembly Notes</span>
            <CopyButton text={result.assembly} />
          </div>
          <pre className="sora2-assembly-text">{result.assembly}</pre>
        </div>
      )}
    </div>
  );
}
