import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { useCharacters } from './hooks/useCharacters';
import { useScriptGenerator } from './hooks/useScriptGenerator';
import { useWorkspace } from './workspace/WorkspaceContext';
import WorkspaceStatusStrip from './workspace/WorkspaceStatusStrip';
import { buildClipboardPrompt } from './data/scriptPrompts';
import LeftPanel from './components/LeftPanel';
import IngredientSelectors from './components/IngredientSelectors';
import RecipesPanel from './components/RecipesPanel';
import ScriptOutput from './components/ScriptOutput';
import ProductionPrompts from './components/ProductionPrompts';
import Sora2Panel from './components/Sora2Panel';
import PixelForgePanel from './components/PixelForgePanel';
import SixteenGamiPanel from './components/SixteenGamiPanel';
import ApiSettings, { useApiSettings } from './components/ApiSettings';
import { useTheme } from './themes/ThemeContext';
import ThemeToggle from './themes/ThemeToggle';
import './themes/theme-win95.css';
import './themes/theme-system7.css';
import './App.css';

const CanvasView = lazy(() => import('./canvas/CanvasView'));
const DioramaView = lazy(() => import('./diorama/DioramaView'));
const StudioView = lazy(() => import('./studio/StudioView'));

const emptySelections = {
  painPoint: null,
  hook: null,
  scriptType: null,
  conversionLevel: null,
  trigger: null,
  ctaMechanism: null,
};

function App() {
  const { activeView: viewMode, setActiveView: setView, activeCharacterId, setActiveCharacterId } = useWorkspace();

  const {
    characters,
    activeId,
    activeCharacter,
    setActiveId,
    addCharacter,
    deleteCharacter,
  } = useCharacters(activeCharacterId);

  const { apiKey, model, setApiKey, setModel } = useApiSettings();
  const { script, productionPrompts, isGenerating, error, generate, reset, loadRecipe } = useScriptGenerator();

  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [selections, setSelections] = useState(emptySelections);
  const [copyFeedback, setCopyFeedback] = useState(false);

  const VIEW_CYCLE = ['classic', 'canvas', 'diorama', 'studio'];

  // Classic follows cross-tab character changes (and the id restored on load).
  useEffect(() => {
    if (activeCharacterId && activeCharacterId !== activeId) setActiveId(activeCharacterId);
  }, [activeCharacterId, activeId, setActiveId]);

  const handleSelectCharacter = useCallback((id) => {
    setActiveId(id);
    setActiveCharacterId(id);
    setSelections(emptySelections);
    reset();
  }, [setActiveId, setActiveCharacterId, reset]);

  const handleSelect = useCallback((key, value) => {
    setSelections((prev) => ({
      ...prev,
      [key]: prev[key] === value ? null : value,
    }));
  }, []);

  const canGenerate =
    selections.painPoint !== null &&
    selections.hook !== null &&
    selections.scriptType !== null &&
    selections.conversionLevel !== null;

  const selectedCount = [
    selections.painPoint,
    selections.hook,
    selections.scriptType,
    selections.conversionLevel,
  ].filter((v) => v !== null).length;

  const handleGenerate = () => {
    if (!canGenerate || !activeCharacter) return;
    if (!apiKey) return;
    generate(activeCharacter, selections, apiKey, model);
  };

  const handleCopyPrompt = async () => {
    if (!canGenerate || !activeCharacter) return;
    const prompt = buildClipboardPrompt(activeCharacter, selections);
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = prompt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2500);
  };

  const { theme } = useTheme();

  return (
    <div className="app" data-theme={theme}>
      <header className="app-header">
        <h1>
          <span className="header-gold">BREADSTICK</span>
          <span className="header-sub">
            {viewMode === 'canvas' ? 'Canvas' : viewMode === 'diorama' ? 'Your Room' : viewMode === 'studio' ? 'Studio' : 'Script Factory'}
          </span>
        </h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <WorkspaceStatusStrip activeCharacterName={activeCharacter?.name ?? null} characterCount={characters.length} />
          <ThemeToggle />
          <a
            href="/storyboard/"
            target="_blank"
            rel="noopener noreferrer"
            title="Static motion-plan storyboard (drop-in glimpse from hyperframes-helper)"
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 11, fontWeight: 700, letterSpacing: '0.16em',
              textTransform: 'uppercase', color: '#888', textDecoration: 'none',
              padding: '8px 14px', border: '1px solid #2e3244', borderRadius: 100,
            }}
          >Storyboard ↗</a>
          {VIEW_CYCLE.map(v => (
            <button
              key={v}
              className={`view-toggle ${viewMode === v ? 'active' : ''}`}
              onClick={() => setView(v)}
            >
              {v === 'classic' ? 'Classic' : v === 'canvas' ? 'Canvas' : v === 'studio' ? 'Studio' : 'Room'}
            </button>
          ))}
        </div>
      </header>

      {viewMode === 'studio' ? (
        <Suspense fallback={<div style={{ padding: 40, color: '#888' }}>Loading Studio...</div>}>
          <StudioView />
        </Suspense>
      ) : viewMode === 'canvas' ? (
        <Suspense fallback={<div style={{ padding: 40, color: '#888' }}>Loading Canvas...</div>}>
          <CanvasView />
        </Suspense>
      ) : viewMode === 'diorama' ? (
        <Suspense fallback={<div style={{ padding: 40, color: '#888' }}>Loading Room...</div>}>
          <DioramaView />
        </Suspense>
      ) : (
      <div className="app-body">
        <LeftPanel
          characters={characters}
          activeId={activeId}
          onSelect={handleSelectCharacter}
          onAdd={addCharacter}
          onDelete={deleteCharacter}
          collapsed={panelCollapsed}
          onToggleCollapse={() => setPanelCollapsed(!panelCollapsed)}
        />

        <main className="main-panel">
          {activeCharacter ? (
            <div className="main-content">
              <div className="active-character-header" style={{ '--accent': activeCharacter.accentColor }}>
                <div className="header-top-row">
                  <div>
                    <h2>{activeCharacter.name}</h2>
                    <span className="active-niche">{activeCharacter.niche}</span>
                    <span className="active-handle">{activeCharacter.handle}</span>
                    <p className="active-tagline">{activeCharacter.tagline}</p>
                  </div>
                  <div className="generate-area">
                    <span className="selection-count">{selectedCount}/4 ingredients selected</span>
                    <div className="generate-buttons">
                      <button
                        className="btn-generate"
                        disabled={!canGenerate || isGenerating || !apiKey}
                        onClick={handleGenerate}
                        title={!apiKey ? 'Add API key below or use Copy Prompt' : ''}
                      >
                        {isGenerating ? 'Generating...' : 'Generate Script'}
                      </button>
                      <button
                        className="btn-copy-prompt"
                        disabled={!canGenerate}
                        onClick={handleCopyPrompt}
                      >
                        {copyFeedback ? 'Prompt Copied!' : 'Copy Prompt'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <ApiSettings
                apiKey={apiKey}
                model={model}
                onApiKeyChange={setApiKey}
                onModelChange={setModel}
              />

              <RecipesPanel
                character={activeCharacter}
                apiKey={apiKey}
                model={model}
                onUseRecipe={loadRecipe}
              />

              <IngredientSelectors
                character={activeCharacter}
                selections={selections}
                onSelect={handleSelect}
              />

              <ScriptOutput
                script={script}
                isGenerating={isGenerating}
                error={error}
              />

              <ProductionPrompts prompts={productionPrompts} />

              <Sora2Panel
                character={activeCharacter}
                scriptText={script}
              />

              <PixelForgePanel />

              <SixteenGamiPanel />
            </div>
          ) : (
            <div className="empty-state">
              <p>Select a character to begin</p>
            </div>
          )}
        </main>
      </div>
      )}
    </div>
  );
}

export default App;
