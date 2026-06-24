import { useState, useCallback, useMemo, useEffect, useRef, createContext, useContext } from 'react';
import VoiceDock from './VoiceDock';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  addEdge,
  ReactFlowProvider,
  useReactFlow,
  NodeResizer,
  Handle,
  Position,
  BaseEdge,
  getSmoothStepPath,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './CanvasView.css';
import { RECIPES, getRecipeById } from './recipes';
import ConductorNode from './composer/ConductorNode';
import ReviewBar from './composer/ReviewBar';
import { applySpec, applyRevision } from './composer/applier';
import { acceptBatch, discardBatch, rejectNode as rejectBatchNode } from './composer/batch';
import { CATALOG, compileCatalogPrompt } from './composer/catalog';
import { parseEnvelope } from './composer/parseEnvelope';
import { executeGraph, registerLaneExecutors } from './engine/index.js';
import { scrubEphemeralOutputs } from './persistence.js';
import { PALETTE_NODES, paletteItemKey } from './paletteData.js';

// Conductor: ref id → catalog title, for ReviewBar chip labels on nodes whose
// data carries no human label of its own.
const CATALOG_TITLES = Object.fromEntries(Object.entries(CATALOG).map(([t, e]) => [t, e.title]));

// xterm.js — used by TerminalNode (Block 3 of the endgame build plan).
// CSS import is required for the terminal renderer to layout correctly.
//
// Renderer choice: xterm's default DOM renderer. Tradeoff acknowledged in
// project_block3_terminal_node memory — DOM renders crisply at any zoom
// (DOM scales, not bitmap), the cost is throughput. Codex-class heavy TUIs
// crash the main thread on DOM renderer; lighter TUIs (Claude Code, htop,
// vim, git log) run fine. WebGL was tried and rejected — it solved nothing
// and broke visual quality on fractional Windows DPR scaling.
import { Terminal as XTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

import { scriptTypes, conversionLevels } from '../data/scriptTypes';
import { buildSystemPrompt, buildUserPrompt, buildProductionPrompts, buildClipboardPrompt } from '../data/scriptPrompts';
import { clipModes, getTiersForMode, buildSora2Prompts, characterContinuity, characterBroll, characterSpeechStyle, characterAmbience } from '../data/sora2';
import { useCharacters } from '../hooks/useCharacters';
import { useApiSettings } from '../components/ApiSettings';
import { scanText, shipGate } from '../lib/shipGate';
import { bitDepths as pxBitDepths, stylePresets as pxStylePresets, assetTypes as pxAssetTypes, viewAngles as pxViewAngles, qualityMods as pxQualityMods, buildPixelArtPrompt } from '../data/pixelArt';
import { estimateCost as hfEstimateCost, createVideoJob as hfCreateVideoJob, pollJobUntilDone as hfPollJobUntilDone } from '../lib/higgsfield';
import {
  SF_MODE_LABELS,
  SF_AR_OPTIONS,
  SF_DEFAULT_PARTY,
  SF_DEFAULT_STATS,
  SF_DEFAULT_SIDEBAR,
  SF_DEFAULT_ACTIONS,
  SF_DEFAULT_BANDS,
  buildWorldBuildPrompt,
  buildHeroCardPrompt,
  buildAssetGalleryPrompt,
} from '../data/spriteForge';
import ConceptComposerNode from './ConceptComposerNode.jsx';
import PropLabNode from './PropLabNode.jsx';
import { SF_CHUNK_TYPES } from './spriteForgeChunks.jsx';

/* ===== CONTEXT — provides actions to all nodes without useEffect ===== */
// Exported so nodes living in separate files (e.g. ConceptComposerNode) can
// reach onDeleteNode etc. without prop-drilling through React Flow's data.
export const CanvasCtx = createContext({});

/* ===== DELETE BUTTON (shared by deletable nodes) ===== */
function NodeDeleteBtn({ nodeId }) {
  const { onDeleteNode } = useContext(CanvasCtx);
  return (
    <button className="cv-delete-btn" onClick={(e) => { e.stopPropagation(); onDeleteNode(nodeId); }}
      title="Delete node">x</button>
  );
}

/* ===== CUSTOM NODES ===== */

function CharacterNode({ id, data }) {
  const { onSpawn, onDespawn, hasIngredients } = useContext(CanvasCtx);
  const c = data.character;
  if (!c) return <div className="cv-node">?</div>;
  const spawned = hasIngredients(c.id);
  return (
    <div className="cv-node cv-character" style={{ '--accent': c.accentColor || '#C9A227' }}>
      <NodeDeleteBtn nodeId={id} />
      <div className="cv-character-bar" />
      <div className="cv-character-body">
        <div className="cv-character-name">{c.name}</div>
        <div className="cv-character-niche">{c.niche}</div>
        <div className="cv-character-handle">{c.handle}</div>
        <button
          className={`cv-spawn-btn ${spawned ? 'cv-spawn-active' : ''}`}
          onClick={(e) => { e.stopPropagation(); spawned ? onDespawn(c.id) : onSpawn(id); }}
        >
          {spawned ? '- Ingredients' : '+ Ingredients'}
        </button>
      </div>
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  );
}

function IngredientNode({ id, data }) {
  return (
    <div className="cv-node cv-ingredient" style={{ '--accent': data.accent || '#C9A227' }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="in" />
      <div className="cv-ingredient-label">{data.label || 'Ingredient'}</div>
      <div className="cv-ingredient-text">{data.text || ''}</div>
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  );
}

function TypeNode({ id, data }) {
  const isCv = !!data.cvId;
  const variant = isCv ? 'cv-conversion' : 'cv-scripttype';
  return (
    <div className={`cv-node ${variant}`} style={{ '--node-accent': isCv ? '#c27adb' : '#5b8def' }}>
      <NodeDeleteBtn nodeId={id} />
      <div className="cv-scripttype-name">{data.name || '?'}</div>
      <div className="cv-scripttype-meta">{data.meta || ''}</div>
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  );
}

function GroupNode({ id, data, selected }) {
  const color = data.variant === 'cv' ? 'rgba(194, 122, 219, 0.4)' : 'rgba(91, 141, 239, 0.4)';
  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={160}
        minHeight={150}
        lineStyle={{ borderColor: color }}
        handleStyle={{ width: 8, height: 8, backgroundColor: color, borderRadius: 2 }}
      />
      <div className={`cv-group cv-group-${data.variant || 'default'}`}>
        <NodeDeleteBtn nodeId={id} />
        <div className="cv-group-label">{data.label}</div>
      </div>
    </>
  );
}

function GeneratorNode({ id }) {
  const { pipeline, onGenerate, onCopyPrompt, onOpenPanel } = useContext(CanvasCtx);
  const { count, status, charName, preview, error } = pipeline;
  const isDeletable = id.startsWith('drop-');
  const colors = { idle: '#555566', ready: '#C9A227', generating: '#e85d75', done: '#00FFFF', error: '#e74c3c' };
  const labels = { idle: 'Waiting for inputs', ready: 'Ready to generate', generating: 'Generating...', done: 'Script ready', error: 'Error' };

  return (
    <div className={`cv-node cv-generator cv-generator-${status}`} style={{ '--status-color': colors[status] || '#555' }}>
      {isDeletable && <NodeDeleteBtn nodeId={id} />}
      <Handle type="target" position={Position.Left} id="pp" style={{ top: '20%' }} />
      <Handle type="target" position={Position.Left} id="hk" style={{ top: '40%' }} />
      <Handle type="target" position={Position.Left} id="st" style={{ top: '60%' }} />
      <Handle type="target" position={Position.Left} id="cv" style={{ top: '80%' }} />

      <div className="cv-generator-header">
        <div className="cv-generator-status-dot" />
        <span className="cv-generator-title">Script Generator</span>
      </div>
      {charName && <div className="cv-generator-character">{charName}</div>}
      <div className="cv-generator-count">{count}/4 inputs</div>
      <div className="cv-generator-status-text">{labels[status] || status}</div>
      {error && <div className="cv-generator-error">{error}</div>}
      {status === 'done' && preview && (
        <div className="cv-generator-preview" onClick={onOpenPanel}>{preview}</div>
      )}
      <div className="cv-generator-actions">
        <button className="cv-btn cv-btn-generate" disabled={status !== 'ready' && status !== 'done'} onClick={onGenerate}>
          {status === 'generating' ? 'Generating...' : status === 'done' ? 'Regenerate' : 'Generate'}
        </button>
        <button className="cv-btn cv-btn-copy" disabled={count < 4} onClick={onCopyPrompt}>Copy Prompt</button>
      </div>
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  );
}

function OutputNode({ id, data }) {
  const { prompts, onOpenVideo } = useContext(CanvasCtx);
  const promptMap = { 'o-v': prompts?.elevenlabs, 'o-i': prompts?.chatgpt, 'o-k': prompts?.kling, 'o-c': prompts?.caption };
  const prompt = promptMap[id];
  const hasPrompt = !!prompt;
  const isVideo = id === 'o-k';
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`cv-node cv-output ${hasPrompt ? 'cv-output-ready' : 'cv-output-waiting'}`}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="in" />
      <div className="cv-output-icon">{data.icon || '?'}</div>
      <div className="cv-output-label">{data.label || 'Output'}</div>
      {hasPrompt && !isVideo && <button className="cv-btn cv-btn-sm" onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>}
      {isVideo && hasPrompt && <button className="cv-btn cv-btn-sm" onClick={onOpenVideo}>Open Clips</button>}
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  );
}

/* ===== KIE.AI GENERATION NODE ===== */
function KieNode({ id }) {
  const { prompts, kieResult, onKieGenerate } = useContext(CanvasCtx);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('kie-api-key') || '');
  const [duration, setDuration] = useState(5);

  const saveKey = (v) => { setApiKey(v); localStorage.setItem('kie-api-key', v); };
  const videoPrompt = prompts?.kling || '';
  const hasPrompt = !!videoPrompt;
  const status = kieResult?.status || 'idle';
  const elapsed = kieResult?.elapsed || 0;
  const videoUrl = kieResult?.url || '';

  const statusColors = { idle: '#555', submitting: '#C9A227', polling: '#e85d75', done: '#00FFFF', error: '#e74c3c' };
  const statusLabels = { idle: 'Ready', submitting: 'Submitting...', polling: `Generating (${Math.floor(elapsed / 60)}m ${elapsed % 60}s)`, done: 'Complete', error: kieResult?.error || 'Failed' };

  const [copied, setCopied] = useState(false);
  const copyUrl = async () => { if (videoUrl) { await navigator.clipboard.writeText(videoUrl).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); } };

  return (
    <div className="cv-node cv-kie" style={{ '--status-color': statusColors[status] }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="prompt" />
      <div className="cv-kie-header">
        <div className="cv-kie-dot" />
        <span>KIE.AI</span>
        <span className="cv-kie-model">sora-2</span>
      </div>

      {hasPrompt && <div className="cv-kie-preview">{videoPrompt.substring(0, 60)}...</div>}
      {!hasPrompt && <div className="cv-kie-empty">Wire video prompt to input</div>}

      <div className="cv-kie-controls">
        <select className="cv-blotato-select" value={duration} onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); setDuration(Number(e.target.value)); }}>
          <option value={5}>5s</option><option value={10}>10s</option>
        </select>
        <span className="cv-kie-ar">9:16</span>
      </div>

      <div className="cv-blotato-field">
        <input className="cv-blotato-input" type="password" placeholder="KIE API Key"
          value={apiKey} onClick={(e) => e.stopPropagation()} onChange={(e) => saveKey(e.target.value)} />
      </div>

      <div className="cv-kie-status" style={{ color: statusColors[status] }}>{statusLabels[status]}</div>

      {videoUrl && (
        <div className="cv-kie-result">
          <div className="cv-kie-url">{videoUrl.substring(0, 40)}...</div>
          <button className="cv-btn cv-btn-sm" onClick={(e) => { e.stopPropagation(); copyUrl(); }}>{copied ? 'Copied!' : 'Copy URL'}</button>
        </div>
      )}

      <button className="cv-btn cv-btn-kie" disabled={!hasPrompt || !apiKey || status === 'submitting' || status === 'polling'}
        onClick={(e) => { e.stopPropagation(); onKieGenerate(apiKey, videoPrompt, duration); }}>
        {status === 'polling' ? 'Generating...' : status === 'done' ? 'Regenerate' : 'Generate Video'}
      </button>
      <Handle type="source" position={Position.Right} id="video-out" />
    </div>
  );
}

/* ===== BLOTATO NODE ===== */
// Blotato social accounts. Fill in your own Blotato account ids/names per
// platform (and `parentId` for Facebook pages). Empty by default — the Blotato
// node still posts via manual URL until you add accounts here.
const BLOTATO_PLATFORMS = [
  { id: 'instagram', label: 'IG', icon: 'IG', accounts: [] },
  { id: 'tiktok', label: 'TT', icon: 'TT', accounts: [] },
  { id: 'facebook', label: 'FB', icon: 'FB', accounts: [] },
  { id: 'twitter', label: 'X', icon: 'X', accounts: [] },
];

function BlottoNode({ id }) {
  const { prompts, pipeline, kieResult, edges, nodeOutputs, script } = useContext(CanvasCtx);
  const [enabled, setEnabled] = useState({ instagram: true, tiktok: true, facebook: false, twitter: false });
  const [selected, setSelected] = useState({ instagram: '', tiktok: '', facebook: '', twitter: '' });
  const [manualUrl, setManualUrl] = useState('');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('blotato-api-key') || '');
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState('idle');
  const [results, setResults] = useState([]);
  const [gateBypass, setGateBypass] = useState(false);
  const [gateExpand, setGateExpand] = useState(false);

  const saveKey = (v) => { setApiKey(v); localStorage.setItem('blotato-api-key', v); };

  // Trace caption + media from wired sources (nodeOutputs pipeline) OR legacy UGC prompts
  const inEdges = edges?.filter(e => e.target === id) || [];
  let pipelineCaption = '';
  let pipelineVideoUrl = '';

  // Check wired sources
  for (const edge of inEdges) {
    const src = nodeOutputs?.[edge.source];
    if (!src) continue;
    // Script text from Niche Script Gen
    if (src.script && !pipelineCaption) pipelineCaption = src.script;
    // Video URL from KIE Img2Vid (single or first batch result)
    if (src.url && !pipelineVideoUrl) pipelineVideoUrl = src.url;
    if (src.videos?.length && !pipelineVideoUrl) {
      const done = src.videos.find(v => v.status === 'done' && v.url);
      if (done) pipelineVideoUrl = done.url;
    }
    // Carousel rendered slides (first slide as image post)
    if (src.renderedSlides?.length && !pipelineVideoUrl) {
      pipelineVideoUrl = `http://localhost:3001${src.renderedSlides[0]}`;
    }
  }
  // Fallback scan nodeOutputs for video/content
  if (!pipelineVideoUrl && inEdges.length > 0) {
    for (const [nid, out] of Object.entries(nodeOutputs || {})) {
      if (nid === id) continue;
      if (out.videos?.length) {
        const done = out.videos.find(v => v.status === 'done' && v.url);
        if (done) { pipelineVideoUrl = done.url; break; }
      }
      if (out.url && !pipelineVideoUrl) { pipelineVideoUrl = out.url; break; }
    }
  }
  // Fallback to global script as caption
  if (!pipelineCaption && inEdges.length > 0 && script) pipelineCaption = script;

  // Final resolution: pipeline sources > legacy UGC sources
  const caption = pipelineCaption || prompts?.caption || '';
  const hasCaption = !!caption;
  const videoUrl = pipelineVideoUrl || kieResult?.url || manualUrl;
  const videoSource = pipelineVideoUrl ? 'pipeline' : kieResult?.url ? 'kie.ai' : (manualUrl ? 'manual' : null);
  const activePlatforms = BLOTATO_PLATFORMS.filter((p) => enabled[p.id]);

  // Ship gate on the outbound caption — this is published content, fail-closed by default.
  const gateVerdict = hasCaption ? scanText(caption) : null;
  const gateBlocking = gateVerdict && gateVerdict.verdict !== 'SHIP' && !gateBypass;

  const canPost = apiKey && hasCaption && activePlatforms.length > 0 && !gateBlocking;

  const handlePost = async () => {
    if (!canPost) return;
    setStatus('posting');
    setResults([]);
    const postResults = [];

    for (const plat of activePlatforms) {
      try {
        const acct = plat.accounts.find((a) => a.id === selected[plat.id]) || plat.accounts[0];
        const args = {
          accountId: acct.parentId || acct.id,
          platform: plat.id,
          text: caption,
        };
        if (videoUrl) args.mediaUrls = [videoUrl];
        if (plat.id === 'instagram' && videoUrl) args.mediaType = 'reel';
        if (plat.id === 'facebook' && acct.parentId) args.pageId = acct.id;
        if (plat.id === 'tiktok') {
          args.disabledComments = false;
          args.disabledDuet = false;
          args.disabledStitch = false;
          args.isBrandedContent = false;
          args.isYourBrand = false;
          args.isAiGenerated = true;
          args.privacyLevel = 'PUBLIC_TO_EVERYONE';
        }

        const res = await fetch('http://localhost:3001/api/blotato', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-blotato-key': apiKey,
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'blotato_create_post', arguments: args } }),
        });
        const data = await res.json();
        postResults.push({ platform: plat.label, ok: true, data });
      } catch (err) {
        postResults.push({ platform: plat.label, ok: false, error: err.message });
      }
    }
    setResults(postResults);
    setStatus(postResults.every((r) => r.ok) ? 'done' : 'error');
  };

  const statusColors = { idle: '#555', posting: '#C9A227', done: '#00FFFF', error: '#e74c3c' };

  return (
    <div className="cv-node cv-blotato" style={{ '--status-color': statusColors[status] }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="text" style={{ top: '30%' }} />
      <Handle type="target" position={Position.Left} id="media" style={{ top: '70%' }} />
      <div className="cv-blotato-header">
        <div className="cv-blotato-dot" />
        <span>BLOTATO</span>
      </div>

      <div className="cv-blotato-platforms">
        {BLOTATO_PLATFORMS.map((p) => (
          <button key={p.id} className={`cv-btn cv-btn-sm ${enabled[p.id] ? 'cv-btn-active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setEnabled((prev) => ({ ...prev, [p.id]: !prev[p.id] })); }}>
            {p.icon}
          </button>
        ))}
      </div>

      {activePlatforms.map((p) => (
        <div key={p.id} className="cv-blotato-acct">
          <span className="cv-blotato-plat-label">{p.icon}</span>
          <select className="cv-blotato-select" value={selected[p.id]}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); setSelected((prev) => ({ ...prev, [p.id]: e.target.value })); }}>
            {p.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      ))}

      <div className="cv-blotato-field">
        <input className="cv-blotato-input"
          placeholder={videoSource === 'pipeline' || videoSource === 'kie.ai' ? 'Media from pipeline' : 'Video URL (Drive/direct)'}
          value={videoSource === 'pipeline' ? videoUrl.substring(0, 35) + '...' : videoSource === 'kie.ai' ? kieResult.url.substring(0, 35) + '...' : manualUrl}
          disabled={videoSource === 'pipeline' || videoSource === 'kie.ai'}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setManualUrl(e.target.value)} />
      </div>

      <div className="cv-blotato-field">
        <input className="cv-blotato-input" type={showKey ? 'text' : 'password'} placeholder="Blotato API Key"
          value={apiKey} onClick={(e) => e.stopPropagation()} onChange={(e) => saveKey(e.target.value)} />
        <button className="cv-btn cv-btn-sm" title={showKey ? 'Hide key' : 'Show key'}
          onClick={(e) => { e.stopPropagation(); setShowKey(!showKey); }}>{showKey ? '◉' : '○'}</button>
      </div>

      <div className="cv-blotato-status">
        {hasCaption ? <span className="cv-blotato-ok">Caption ready ({pipelineCaption ? 'wired' : 'UGC'})</span> : <span className="cv-blotato-warn">No caption — wire a script source</span>}
        {videoSource === 'pipeline' && <span className="cv-blotato-ok">Media from pipeline</span>}
        {videoSource === 'kie.ai' && <span className="cv-blotato-ok">Video from kie.ai</span>}
        {videoSource === 'manual' && <span className="cv-blotato-ok">Video URL set</span>}
        {!videoSource && <span className="cv-blotato-dim">No media (text-only post)</span>}
      </div>

      {gateVerdict && gateVerdict.verdict !== 'SHIP' && (
        <div className={`cv-gate cv-gate-${gateVerdict.verdict.toLowerCase()}`}>
          <div className="cv-gate-row">
            <span className="cv-gate-badge">⬢ {gateVerdict.verdict}</span>
            <span className="cv-gate-meta">
              {gateVerdict.violations.length} signature{gateVerdict.violations.length === 1 ? '' : 's'} · taint {Math.round(gateVerdict.taintScore * 100)}%
            </span>
          </div>
          <button className="cv-gate-expand" onClick={(e) => { e.stopPropagation(); setGateExpand(v => !v); }}>
            {gateExpand ? '▾ hide' : '▸ show detail'}
          </button>
          {gateExpand && (
            <div className="cv-gate-detail">
              {gateVerdict.violations.map((v, i) => (
                <div key={i} className="cv-gate-line">
                  <span className="cv-gate-vtype">{v.type}</span>
                  <span className="cv-gate-vmatch">"{v.match}"</span>
                </div>
              ))}
            </div>
          )}
          {!gateBypass ? (
            <button className="cv-gate-bypass" onClick={(e) => { e.stopPropagation(); setGateBypass(true); }}>
              bypass gate (not recommended)
            </button>
          ) : (
            <span className="cv-gate-bypassed">gate bypassed — post at own risk</span>
          )}
        </div>
      )}

      {results.length > 0 && (
        <div className="cv-blotato-results">
          {results.map((r, i) => (
            <div key={i} className={r.ok ? 'cv-blotato-ok' : 'cv-blotato-err'}>{r.platform}: {r.ok ? 'Posted' : r.error}</div>
          ))}
        </div>
      )}

      <button className="cv-btn cv-btn-post" disabled={!canPost || status === 'posting'}
        onClick={(e) => { e.stopPropagation(); handlePost(); }}>
        {status === 'posting' ? 'Posting...' : status === 'done' ? 'Post Again' : 'Post'}
      </button>
    </div>
  );
}

/* ===== EDGE ===== */
// Map node types to accent colors for edge glow
const NODE_ACCENT_COLORS = {
  character: '#C9A227', generator: '#C9A227', ingredient: '#C9A227',
  'niche-gen': '#9b59b6', 'ugc-gen': '#e0922f', 'avatar-frame': '#1abc9c', 'char-scene': '#e056a0', 'clip-splitter': '#e74c3c', 'clip-frames': '#f39c12', 'ugc-video': '#e85d75', 'gami-art': '#e8b830', gami: '#C9A227',
  carousel: '#00ffff', 'vid-prompt': '#ff6b35', 'kie-img2vid': '#e85d75',
  'title-card': '#7ed957', 'frame-sandwich': '#00bfa5', 'remotion-comp': '#4ecdc4', 'ffmpeg-grade': '#f4a261',
  'chroma-composite': '#ff69b4', 'chroma-motion': '#ff1493', 'chroma-stylize': '#ff6b35', 'live-preview': '#34d399', 'image-2': '#10a37f', 'qc-gate': '#8b5cf6', 'hyperframes': '#00bcd4', 'broll': '#ff9500', 'video-source': '#3b82f6', 'cartesian': '#a855f7', 'asset-sequence': '#14b8a6', 'motion-bake': '#7ed957', 'ares-gen': '#6366f1', 'concept-composer': '#06b6d4',
  kie: '#e85d75', blotato: '#00ffff',
  // PRD Maker — single accent for all lens edges (downstream chat uses amber).
  // Per-lens colors live in PRD_LENSES so the node header bar can vary while
  // edges stay coherent visually.
  'prd-lens': '#a855f7', 'prd-prompt': '#0ea5e9', 'prd-chat': '#f59e0b', 'prd-design': '#ec4899', 'prd-render': '#22c55e',
  // FFmpeg post-stitch passes — pop-beats uses lime, stacked-video uses coral
  'pop-beats': '#a3e635', 'stack-video': '#fb7185',
  // 16-gami Sprite Forge — oxblood JRPG-poster red
  'sprite-forge': '#a0392e',
  // Sprite Forge chunk nodes — same family accent
  'sf-palette': '#a0392e',
  'sf-hero-identity':  '#a0392e',
  'sf-taglines':       '#a0392e',
  'sf-world-identity': '#a0392e',
  'sf-stats':          '#a0392e',
  'sf-sidebar':        '#a0392e',
  'sf-party':          '#a0392e',
  'sf-actions':        '#a0392e',
  'sf-asset-bands':    '#a0392e',
  'arecibo-recap': '#2ee6a6',
  conductor: '#C9A227',
};

function PulseEdge(props) {
  const { pipeline, onDeleteEdge, nodes } = useContext(CanvasCtx);
  const [path] = getSmoothStepPath({ ...props, borderRadius: 16 });

  // Derive color from source node — check edge data first, then look up node directly
  let accentColor = props.data?.color || null;
  if (!accentColor) {
    const sourceType = props.data?.sourceType || nodes?.find(n => n.id === props.source)?.type;
    accentColor = (sourceType && NODE_ACCENT_COLORS[sourceType]) || '#C9A227';
  }

  const isGenerating = pipeline?.status === 'generating';
  const isDone = pipeline?.status === 'done';
  const isActive = isGenerating || isDone;
  const glowColor = isGenerating ? '#e85d75' : isDone ? '#00FFFF' : accentColor;

  // Cursor-following delete handle. A wide invisible hit-area path captures
  // mouse position over the visible stroke, and a single X foreignObject
  // tracks that position. Beats fixed-position handles — the X always
  // appears wherever the user is already looking, which is the gesture
  // operators expect from canvas tools (n8n, Reactflow examples, etc.)
  const [hoverPoint, setHoverPoint] = useState(null);
  const pathRef = useRef(null);
  const hideTimer = useRef(null);

  // Map the mouse's screen-space point into the SVG's local coordinate
  // system so the X lands precisely on the stem under the cursor regardless
  // of zoom/pan. createSVGPoint + getScreenCTM().inverse() is the standard
  // pattern for this — works with React Flow's transformed viewport.
  const trackHover = (e) => {
    if (!pathRef.current) return;
    const svg = pathRef.current.ownerSVGElement;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const local = pt.matrixTransform(ctm.inverse());
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setHoverPoint({ x: local.x, y: local.y });
  };

  // Short delay before hiding lets the user drift from the stem onto the X
  // button without it vanishing. 150ms is fast enough not to feel sticky.
  const startHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setHoverPoint(null), 150);
  };
  const cancelHide = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  return (
    <>
      {/* Always show subtle accent glow */}
      <BaseEdge
        id={`${props.id}-glow`}
        path={path}
        style={{ stroke: isActive ? glowColor : accentColor, strokeWidth: 5, opacity: isActive ? 0.25 : 0.12, filter: `drop-shadow(0 0 4px ${isActive ? glowColor : accentColor})` }}
        className={isGenerating ? 'cv-edge-pulse' : ''}
      />
      <BaseEdge id={props.id} path={path} style={{ stroke: isActive ? glowColor : accentColor, strokeWidth: 2, opacity: isActive ? 0.9 : 0.5, transition: 'stroke 0.3s, opacity 0.3s' }} />
      {/* Wide transparent hit area — pointer-events: stroke catches hover anywhere
          along the visible stem without blocking clicks on canvas/nodes around it. */}
      <path
        ref={pathRef}
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
        style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
        onMouseMove={trackHover}
        onMouseLeave={startHide}
      />
      {/* Single X follows the cursor along the stem. Only renders while
          hovering — clean canvas at rest, kill point exactly where you look. */}
      {hoverPoint && (
        <foreignObject
          x={hoverPoint.x - 10}
          y={hoverPoint.y - 10}
          width={20}
          height={20}
          className="cv-edge-delete-fo"
          onMouseEnter={cancelHide}
          onMouseLeave={startHide}
        >
          <button className="cv-edge-delete" onClick={(e) => { e.stopPropagation(); onDeleteEdge(props.id); }}>x</button>
        </foreignObject>
      )}
    </>
  );
}

/* ===== BOKEH NODE — subject isolation + blurred background ================
 *
 * Wire a video in, get back a composite where the subject (person) stays
 * sharp and the background is gaussian-blurred. Per-frame segmentation via
 * MediaPipe Selfie Segmentation (CPU, ~8 fps at 720p), composited with
 * OpenCV, audio muxed back via FFmpeg. Works best for talking-head /
 * POV content where the subject is a human.
 *
 * Wire input:
 *   - video-in (left) ← any node emitting { url, type: 'video' } OR a local
 *     path (Drive download via shortform-cli, FFmpeg grade output, etc.)
 *
 * Wire output:
 *   - video-out (right) → composited mp4 URL (sharp subject, blurred bg,
 *     audio intact)
 *
 * NOT for: non-human subjects (products, landscapes), green-screen footage
 * (use chromakey instead), or fast action where segmentation flicker would
 * be visible. For those use cases the segmentation model would need to be
 * swapped (u2net for general subjects, rvm for temporal stability).
 */

function BokehNode({ id }) {
  const { edges, nodeOutputs, onAssetSequencePublish, openFilePicker } = useContext(CanvasCtx);

  // Resolve incoming video wire
  let wiredVideo = null;
  for (const edge of (edges || []).filter(e => e.target === id && e.targetHandle === 'video-in')) {
    const src = nodeOutputs?.[edge.source];
    if (!src) continue;
    if (src.url || src.localPath) { wiredVideo = src; break; }
  }
  if (!wiredVideo) {
    // Fallback scan
    for (const edge of (edges || []).filter(e => e.target === id)) {
      const src = nodeOutputs?.[edge.source];
      if (src?.url || src?.localPath) { wiredVideo = src; break; }
    }
  }
  const videoUrl = wiredVideo?.localPath || wiredVideo?.url || '';

  const [startSec, setStartSec] = useState(0);
  const [durationSec, setDurationSec] = useState(15);
  const [blurSigma, setBlurSigma] = useState(22);
  const [maxDim, setMaxDim] = useState(1280);
  const [feather, setFeather] = useState(6);
  const [manualUrl, setManualUrl] = useState('');
  const [status, setStatus] = useState('idle');     // idle | rendering | done | error
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);       // { url, filename, processingSec }

  const stop_ = (e) => { e.stopPropagation(); };

  const effectiveUrl = videoUrl || manualUrl.trim();

  // Publish to wire-out on result
  useEffect(() => {
    if (!result?.url) return;
    onAssetSequencePublish?.(id, {
      url: result.url,
      type: 'video',
      durationSec,
    });
  }, [id, result, durationSec, onAssetSequencePublish]);

  const render = async () => {
    if (!effectiveUrl) { setError('wire a video (or paste URL/path below)'); setStatus('error'); return; }
    setStatus('rendering'); setError(''); setResult(null);
    try {
      const r = await fetch('http://localhost:3001/api/bokeh/composite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: effectiveUrl,
          startSec, durationSec, blurSigma, maxDim, feather,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
      setResult({ url: data.url, filename: data.filename, processingSec: data.processingSec });
      setStatus('done');
    } catch (err) {
      setError(err.message); setStatus('error');
    }
  };

  const dotColor = status === 'rendering' ? '#fb923c'
    : status === 'done' ? '#00FFFF'
    : status === 'error' ? '#e74c3c'
    : '#555';

  // Estimated time = duration * (work_res / 720) ~scales with processing res
  // 15s @ 720p = 53s observed → ~3.5x duration. Scale linearly with maxDim/720.
  const estSec = durationSec * 3.5 * Math.max(1, (maxDim || 720) / 720);

  return (
    <div className="cv-node cv-suno nowheel" style={{ '--status-color': dotColor, minWidth: 340 }}>
      <NodeDeleteBtn nodeId={id} />
      <HandleWithTip type="target" position={Position.Left} id="video-in" tip="video ← wire any node emitting { url } or { localPath } (FFmpeg grade output, Drive download, etc)" />
      <HandleWithTip type="source" position={Position.Right} id="video-out" tip="composited mp4 (sharp subject + blurred bg + audio) → wire to Cartesian / Stack / Postiz" />

      <div className="cv-suno-header">
        <div className="cv-suno-dot" />
        <span>BOKEH</span>
        {status === 'rendering' && <span className="cv-suno-stat cv-suno-stat-running">rendering…</span>}
        {status === 'done' && <span className="cv-suno-stat cv-suno-stat-done">✓ done</span>}
        {status === 'error' && <span className="cv-suno-stat cv-suno-stat-error">⚠ error</span>}
      </div>

      {wiredVideo ? (
        <div className="cv-suno-wire">📎 wire video · {(videoUrl.split('/').pop() || videoUrl).slice(0, 48)}</div>
      ) : (
        <div className="cv-suno-field" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            type="text"
            className="cv-suno-input nodrag"
            placeholder="paste video URL or local path (or wire one in)"
            value={manualUrl}
            onChange={(e) => { stop_(e); setManualUrl(e.target.value); }}
            onClick={stop_} onMouseDown={stop_}
            style={{ flex: 1, boxSizing: 'border-box', minWidth: 0 }}
          />
          <button
            className="nodrag"
            onClick={(e) => { stop_(e); openFilePicker({
              key: 'bokeh', label: 'a video',
              startDir: '.\\testing-vids',
              exts: ['mp4', 'mov', 'webm', 'mkv', 'm4v'],
            }, (p) => setManualUrl(p)); }}
            onMouseDown={stop_}
            title="Browse for video"
            style={{ padding: '6px 9px', fontSize: 13, background: 'var(--bg-card, #1a1a24)', border: '1px solid var(--border, #2a2a35)', borderRadius: 4, cursor: 'pointer' }}
          >📁</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 6, fontSize: 11 }}>
        <label className="nodrag" onClick={stop_} onMouseDown={stop_} style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, opacity: 0.7 }}>start (s)</div>
          <input type="number" step="0.5" min="0" value={startSec} className="nodrag"
            onChange={(e) => { stop_(e); setStartSec(parseFloat(e.target.value) || 0); }}
            onClick={stop_} onMouseDown={stop_}
            style={{ width: '100%', background: '#0a0a0f', border: '1px solid #333', color: '#ddd', padding: '2px 4px', boxSizing: 'border-box' }} />
        </label>
        <label className="nodrag" onClick={stop_} onMouseDown={stop_} style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, opacity: 0.7 }}>duration (s)</div>
          <input type="number" step="1" min="1" max="120" value={durationSec} className="nodrag"
            onChange={(e) => { stop_(e); setDurationSec(parseFloat(e.target.value) || 15); }}
            onClick={stop_} onMouseDown={stop_}
            style={{ width: '100%', background: '#0a0a0f', border: '1px solid #333', color: '#ddd', padding: '2px 4px', boxSizing: 'border-box' }} />
        </label>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 6, fontSize: 11 }}>
        <label className="nodrag" onClick={stop_} onMouseDown={stop_} style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, opacity: 0.7 }}>blur σ</div>
          <input type="number" step="1" min="4" max="60" value={blurSigma} className="nodrag"
            onChange={(e) => { stop_(e); setBlurSigma(parseFloat(e.target.value) || 22); }}
            onClick={stop_} onMouseDown={stop_}
            style={{ width: '100%', background: '#0a0a0f', border: '1px solid #333', color: '#ddd', padding: '2px 4px', boxSizing: 'border-box' }} />
        </label>
        <label className="nodrag" onClick={stop_} onMouseDown={stop_} style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, opacity: 0.7 }}>feather (px)</div>
          <input type="number" step="1" min="0" max="20" value={feather} className="nodrag"
            onChange={(e) => { stop_(e); setFeather(parseFloat(e.target.value) || 0); }}
            onClick={stop_} onMouseDown={stop_}
            style={{ width: '100%', background: '#0a0a0f', border: '1px solid #333', color: '#ddd', padding: '2px 4px', boxSizing: 'border-box' }} />
        </label>
      </div>

      <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 2 }}>working res (lower = faster)</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {[720, 1280, 1920, 0].map(d => {
          const isActive = d === maxDim;
          const label = d === 0 ? 'native' : `${d}p`;
          return (
            <button
              key={d}
              className="nodrag"
              onClick={(e) => { stop_(e); setMaxDim(d); }}
              onMouseDown={stop_}
              style={{
                flex: 1, fontSize: 11, padding: '4px 4px',
                border: `1.5px solid ${isActive ? '#a78bfa' : '#333'}`,
                background: isActive ? '#a78bfa1f' : 'transparent',
                color: isActive ? '#a78bfa' : '#aaa',
                borderRadius: 3, cursor: 'pointer',
                boxSizing: 'border-box', minWidth: 0,
              }}
            >{label}</button>
          );
        })}
      </div>

      {effectiveUrl && status === 'idle' && (
        <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 6 }}>
          est. ~{Math.round(estSec)}s on CPU
        </div>
      )}

      {error && <div className="cv-suno-err">{error}</div>}

      {result?.url && (
        <div className="cv-suno-result">
          <div style={{ fontSize: 11 }}>composited · {durationSec}s · {result.processingSec}s processing</div>
          <video controls src={result.url} className="nodrag"
            onClick={stop_} onMouseDown={stop_}
            style={{ width: '100%', marginTop: 4, background: '#000' }} />
          <a className="cv-suno-link nodrag"
            href={result.url} target="_blank" rel="noopener noreferrer"
            onClick={stop_} onMouseDown={stop_}>open mp4 ↗</a>
        </div>
      )}

      <button
        className="cv-suno-btn nodrag"
        onClick={(e) => { stop_(e); render(); }}
        onMouseDown={stop_}
        disabled={status === 'rendering' || !effectiveUrl}
      >
        {status === 'rendering' ? 'rendering…'
          : status === 'done' ? '↻ re-render'
          : !effectiveUrl ? 'wire video in first'
          : '↪ render bokeh'}
      </button>
    </div>
  );
}

/* ===== AUDIO VISUALIZER NODE — ASCII / CRT / dither music viz ============
 *
 * Operator wires a Suno-generated mp3 (or any audio URL); picks a viz style
 * + accent color → server renders the AudioVisualizer Remotion composition
 * to an mp4 with audio baked in. Brand-locked: every output gets CRT
 * scanlines + Bayer dither + phosphor glow + vignette as the non-negotiable
 * wrapper. Pure ASCII viz primitives — no shaders, no images.
 *
 * Wire inputs:
 *   - audio-in (left)  ← Suno node's audio output (uses localPath if available
 *                        for fast localhost fetch, falls back to CDN url)
 *
 * Wire outputs:
 *   - video-out (right) → rendered mp4 URL (viz + audio baked in)
 *
 * Styles:
 *   - mirror-columns: vertical bin columns mirrored top↔bottom (reference image)
 *   - pixel-city: skyline of buildings with ASCII windows (also reference)
 *   - spectrum: full-frame ASCII intensity grid with bottom-up gradient
 *   - planet: PulsingAsciiPlanet — existing AsciiPlanet pulsing on bass
 */

const AUDIO_VIZ_STYLES = [
  { id: 'mirror-columns', label: 'Mirror Columns', desc: 'Bin columns mirrored ↕ — the LED matrix look' },
  { id: 'pixel-city',     label: 'Pixel City',     desc: 'Skyline of buildings with ASCII windows' },
  { id: 'spectrum',       label: 'ASCII Spectrum', desc: 'Full-frame intensity grid, bottom-up gradient' },
  { id: 'planet',         label: 'Pulsing Planet', desc: 'Spinning ASCII planet, breathes on bass' },
];

const AUDIO_VIZ_PRESETS = [
  { id: 'white',   label: 'White',   color: '#F0F0F0' },
  { id: 'amber',   label: 'Amber',   color: '#FFB300' },
  { id: 'green',   label: 'Green',   color: '#33FF66' },
  { id: 'magenta', label: 'Magenta', color: '#FF00FF' },
  { id: 'cyan',    label: 'Cyan',    color: '#00FFFF' },
];

const AUDIO_VIZ_ASPECTS = [
  { id: 'portrait',  label: '9:16',  width: 1080, height: 1920 },
  { id: 'landscape', label: '16:9',  width: 1920, height: 1080 },
  { id: 'square',    label: '1:1',   width: 1080, height: 1080 },
];

function AudioVisualizerNode({ id }) {
  const { edges, nodeOutputs, onAssetSequencePublish } = useContext(CanvasCtx);

  // ── Resolve audio wire ───────────────────────────────────────────────────
  let wiredAudio = null;
  for (const edge of (edges || []).filter(e => e.target === id && e.targetHandle === 'audio-in')) {
    const src = nodeOutputs?.[edge.source];
    if (!src) continue;
    if (src.type === 'audio' && (src.url || src.localPath)) {
      wiredAudio = src;
      break;
    }
  }
  // Fallback scan: any wire with a url + audio-ish type
  if (!wiredAudio) {
    for (const edge of (edges || []).filter(e => e.target === id)) {
      const src = nodeOutputs?.[edge.source];
      if (src?.url && (src.type === 'audio' || /\.(mp3|wav|m4a|ogg)/i.test(src.url))) {
        wiredAudio = src;
        break;
      }
    }
  }

  // Prefer localPath (fast localhost) over CDN URL (slower, can expire)
  const audioUrl = wiredAudio
    ? (wiredAudio.localPath
        ? `http://localhost:3001/${wiredAudio.localPath.replace(/^sounds\/suno\//, 'sounds-suno/')}`
        : wiredAudio.url)
    : '';
  const audioTitle = wiredAudio?.title || '';
  const audioDuration = Number(wiredAudio?.duration) || 0;

  // ── State ────────────────────────────────────────────────────────────────
  const [style, setStyle] = useState(() => localStorage.getItem('audio-viz-style') || 'mirror-columns');
  const [preset, setPreset] = useState(() => localStorage.getItem('audio-viz-preset') || 'white');
  const [aspect, setAspect] = useState(() => localStorage.getItem('audio-viz-aspect') || 'portrait');
  const [scanlines, setScanlines] = useState(true);
  const [dither, setDither] = useState(true);
  const [vignette, setVignette] = useState(true);
  const [chromaShift, setChromaShift] = useState(false);
  const [status, setStatus] = useState('idle');     // idle | rendering | done | error
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);       // { url, filename, durationSec }

  const stop_ = (e) => { e.stopPropagation(); };

  // Persisted setters
  const setStyleP = (v) => { setStyle(v); localStorage.setItem('audio-viz-style', v); setResult(null); };
  const setPresetP = (v) => { setPreset(v); localStorage.setItem('audio-viz-preset', v); setResult(null); };
  const setAspectP = (v) => { setAspect(v); localStorage.setItem('audio-viz-aspect', v); setResult(null); };

  // ── Publish result to wire output ────────────────────────────────────────
  useEffect(() => {
    if (!result?.url) return;
    onAssetSequencePublish?.(id, {
      url: result.url,
      type: 'video',
      durationSec: result.durationSec,
      style,
      preset,
    });
  }, [id, result, style, preset, onAssetSequencePublish]);

  // ── Render ───────────────────────────────────────────────────────────────
  const render = async () => {
    if (!audioUrl) { setError('wire a Suno (or any audio) node first'); setStatus('error'); return; }
    setStatus('rendering'); setError(''); setResult(null);
    const aspectCfg = AUDIO_VIZ_ASPECTS.find(a => a.id === aspect) || AUDIO_VIZ_ASPECTS[0];
    try {
      const r = await fetch('http://localhost:3001/api/remotion/audio-viz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioUrl,
          style,
          preset,
          scanlines,
          dither,
          vignette,
          chromaShift,
          width: aspectCfg.width,
          height: aspectCfg.height,
          fps: 30,
          durationSec: audioDuration || undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
      setResult({ url: data.url, filename: data.filename, durationSec: data.durationSec });
      setStatus('done');
    } catch (err) {
      setError(err.message); setStatus('error');
    }
  };

  const dotColor = status === 'rendering' ? '#fb923c'
    : status === 'done' ? '#00FFFF'
    : status === 'error' ? '#e74c3c'
    : '#555';

  const activePreset = AUDIO_VIZ_PRESETS.find(p => p.id === preset);

  return (
    <div className="cv-node cv-suno nowheel" style={{ '--status-color': dotColor, minWidth: 360 }}>
      <NodeDeleteBtn nodeId={id} />
      <HandleWithTip type="target" position={Position.Left}  id="audio-in"  tip="audio ← wire Suno output (uses localPath/sounds-suno for fast fetch, falls back to CDN url)" />
      <HandleWithTip type="source" position={Position.Right} id="video-out" tip="rendered mp4 (viz + audio baked in) → wire to Cartesian / Stack / Postiz" />

      <div className="cv-suno-header">
        <div className="cv-suno-dot" />
        <span>AUDIO · VIZ</span>
        {status === 'rendering' && <span className="cv-suno-stat cv-suno-stat-running">rendering…</span>}
        {status === 'done' && <span className="cv-suno-stat cv-suno-stat-done">✓ done</span>}
        {status === 'error' && <span className="cv-suno-stat cv-suno-stat-error">⚠ error</span>}
      </div>

      {wiredAudio ? (
        <div className="cv-suno-wire">
          🎵 wire audio · {audioTitle ? `"${audioTitle.slice(0, 28)}" · ` : ''}{audioDuration ? `${audioDuration.toFixed(1)}s` : 'unknown duration'}
        </div>
      ) : (
        <div style={{ fontSize: 10, opacity: 0.6, padding: 6, border: '1px dashed #444', borderRadius: 3, marginBottom: 6 }}>
          wire a Suno node (or anything emitting {`{ url, type: 'audio' }`}) into the left handle
        </div>
      )}

      {/* Style picker — 2×2 grid */}
      <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4, marginBottom: 4 }}>STYLE</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4, marginBottom: 8, padding: '0 2px', boxSizing: 'border-box' }}>
        {AUDIO_VIZ_STYLES.map(s => {
          const isActive = s.id === style;
          return (
            <button
              key={s.id}
              className="nodrag"
              onClick={(e) => { stop_(e); setStyleP(s.id); }}
              onMouseDown={stop_}
              title={s.desc}
              style={{
                fontSize: 11,
                padding: '5px 6px',
                border: `1.5px solid ${isActive ? activePreset.color : '#333'}`,
                background: isActive ? `${activePreset.color}1f` : 'transparent',
                color: isActive ? activePreset.color : '#aaa',
                borderRadius: 3,
                cursor: 'pointer',
                textAlign: 'left',
                boxSizing: 'border-box', minWidth: 0,
              }}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Preset color row */}
      <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 4 }}>ACCENT</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, padding: '0 2px', boxSizing: 'border-box' }}>
        {AUDIO_VIZ_PRESETS.map(p => {
          const isActive = p.id === preset;
          return (
            <button
              key={p.id}
              className="nodrag"
              onClick={(e) => { stop_(e); setPresetP(p.id); }}
              onMouseDown={stop_}
              title={p.label}
              style={{
                flex: 1,
                height: 26,
                border: `2px solid ${isActive ? p.color : '#333'}`,
                background: isActive ? p.color : `${p.color}33`,
                borderRadius: 3,
                cursor: 'pointer',
                boxSizing: 'border-box', minWidth: 0,
              }}
            />
          );
        })}
      </div>

      {/* Aspect ratio */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, padding: '0 2px', boxSizing: 'border-box' }}>
        {AUDIO_VIZ_ASPECTS.map(a => {
          const isActive = a.id === aspect;
          return (
            <button
              key={a.id}
              className="nodrag"
              onClick={(e) => { stop_(e); setAspectP(a.id); }}
              onMouseDown={stop_}
              style={{
                flex: 1,
                fontSize: 11,
                padding: '4px 4px',
                border: `1.5px solid ${isActive ? activePreset.color : '#333'}`,
                background: isActive ? `${activePreset.color}1f` : 'transparent',
                color: isActive ? activePreset.color : '#aaa',
                borderRadius: 3,
                cursor: 'pointer',
                boxSizing: 'border-box', minWidth: 0,
              }}
            >
              {a.label}
            </button>
          );
        })}
      </div>

      {/* CRT effect toggles */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 10, marginBottom: 8 }}>
        <label className="nodrag" onClick={stop_} onMouseDown={stop_} style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
          <input type="checkbox" checked={scanlines} onChange={(e) => { stop_(e); setScanlines(e.target.checked); setResult(null); }} onClick={stop_} onMouseDown={stop_} />
          scanlines
        </label>
        <label className="nodrag" onClick={stop_} onMouseDown={stop_} style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
          <input type="checkbox" checked={dither} onChange={(e) => { stop_(e); setDither(e.target.checked); setResult(null); }} onClick={stop_} onMouseDown={stop_} />
          dither
        </label>
        <label className="nodrag" onClick={stop_} onMouseDown={stop_} style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
          <input type="checkbox" checked={vignette} onChange={(e) => { stop_(e); setVignette(e.target.checked); setResult(null); }} onClick={stop_} onMouseDown={stop_} />
          vignette
        </label>
        <label className="nodrag" onClick={stop_} onMouseDown={stop_} style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
          <input type="checkbox" checked={chromaShift} onChange={(e) => { stop_(e); setChromaShift(e.target.checked); setResult(null); }} onClick={stop_} onMouseDown={stop_} />
          chroma-shift
        </label>
      </div>

      {error && <div className="cv-suno-err">{error}</div>}

      {result?.url && (
        <div className="cv-suno-result">
          <div style={{ fontSize: 11 }}>rendered · {style} · {result.durationSec?.toFixed(1)}s</div>
          <video controls src={result.url} className="nodrag"
            onClick={stop_} onMouseDown={stop_}
            style={{ width: '100%', marginTop: 4, background: '#000' }} />
          <a className="cv-suno-link nodrag"
            href={result.url} target="_blank" rel="noopener noreferrer"
            onClick={stop_} onMouseDown={stop_}>open mp4 ↗</a>
        </div>
      )}

      <button
        className="cv-suno-btn nodrag"
        onClick={(e) => { stop_(e); render(); }}
        onMouseDown={stop_}
        disabled={status === 'rendering' || !audioUrl}
      >
        {status === 'rendering' ? 'rendering viz…'
          : status === 'done' ? '↻ re-render'
          : !audioUrl ? 'wire audio in first'
          : '↪ render audio viz'}
      </button>
    </div>
  );
}

/* ===== SCRIPT EFFECT PINNER — operator-pinned motion graphics ============
 *
 * Solves the precision-cost tradeoff between Cartesian (manual x,y,t for
 * EVERY overlay — high effort) and Skyframe 5-beat auto (Claude picks anchors
 * — drifts when content varies). Operator picks WORD + EFFECT, transcript
 * gives EXACT time. No inference, no resolver, no drift.
 *
 * Wire inputs:
 *   - script-in    (left, top)    ← prose script for context (read-only display)
 *   - transcript-in (left, middle) ← word-level transcript `{ words: [{text,start,end}, ...] }`
 *                                    from ElevenLabs Scribe or Whisper. If not
 *                                    wired, operator can paste JSON below.
 *
 * Flow:
 *   1. Wire script + transcript in (or paste JSON for transcript)
 *   2. Pick an active effect from the 10-effect palette
 *   3. Click words in the transcript — each click pins the active effect at
 *      that word's exact timestamp. Pinned words get a colored ring.
 *   4. Adjust window/lead-in per pin if needed (click ✎ on the pin list).
 *   5. "↪ Render Overlay" → server renders SkyframeOverlay composition with
 *      the operator-built beats[] → emits transparent .webm URL via wire-out.
 *
 * Wire outputs:
 *   - beats-out   (right, top)    → raw beats[] array for downstream nodes
 *                                    that want to render their own way
 *   - overlay-out (right, bottom) → rendered transparent .webm URL — drop into
 *                                    Cartesian / Stack Video / FFmpeg as the
 *                                    overlay layer over your base recording
 */

const EFFECTS = [
  { id: 'opus-glisten', type: 'OpusGlisten', label: 'Opus Shine',
    icon: '✦', color: '#f6dc92',
    desc: 'Gold serif word + sparkle + halo + chime (signature)',
    wordProp: 'word',
    defaults: { leadInSec: 0.5, windowSec: 3.5 } },
  { id: 'karaoke-bl', type: 'KaraokeCard', label: 'Karaoke BL',
    icon: '◰', color: '#22d3ee',
    desc: 'Bottom-left highlighted-word card',
    wordProp: 'heroWord',
    defaults: { position: 'bottom-left', eyebrow: '', words: [], leadInSec: 1.5, windowSec: 6 } },
  { id: 'karaoke-br', type: 'KaraokeCard', label: 'Karaoke BR',
    icon: '◳', color: '#22d3ee',
    desc: 'Bottom-right highlighted-word card',
    wordProp: 'heroWord',
    defaults: { position: 'bottom-right', eyebrow: '', words: [], leadInSec: 1.5, windowSec: 6 } },
  { id: 'karaoke-tr', type: 'KaraokeCard', label: 'Karaoke TR',
    icon: '◲', color: '#22d3ee',
    desc: 'Top-right highlighted-word card',
    wordProp: 'heroWord',
    defaults: { position: 'top-right', eyebrow: '', words: [], leadInSec: 1.5, windowSec: 6 } },
  { id: 'compact-card', type: 'CompactCard', label: 'Compact Card',
    icon: '▭', color: '#a78bfa',
    desc: 'Terminal-style command card',
    wordProp: 'command',
    defaults: { subtitle: '', leadInSec: 1.5, windowSec: 5 } },
  { id: 'win95', type: 'Win95Terminal', label: 'Win95 Terminal',
    icon: '▣', color: '#10b981',
    desc: 'Retro terminal typing line — definition / insight',
    wordProp: 'text',
    defaults: { leadInSec: 1.5, windowSec: 5 } },
  { id: 'rayban-intro', type: 'RayBanIntro', label: 'RayBan Intro',
    icon: '◉', color: '#fb923c',
    desc: 'Title card 4-slot (typically Beat 1 / opening)',
    wordProp: 'heroPhrase',
    defaults: { topWord: 'HOOK', pixelPhrase: '', subtitle: '', leadInSec: 0, windowSec: 3 } },
  { id: 'ascii-planet', type: 'AsciiPlanet', label: 'ASCII Planet',
    icon: '◐', color: '#38bdf8',
    desc: 'Pixel planet visual (no word — backdrop accent)',
    wordProp: null,
    defaults: { leadInSec: 1.5, windowSec: 4 } },
  { id: 'trash-compactor', type: 'TrashCompactor', label: 'Trash Compactor',
    icon: '▼', color: '#ef4444',
    desc: 'Compress/erase effect (no word — transition)',
    wordProp: null,
    defaults: { leadInSec: 1.5, windowSec: 3 } },
  { id: 'opus-glisten-alt', type: 'OpusGlisten', label: 'Opus Shine 2',
    icon: '✧', color: '#fde68a',
    desc: 'Second hero shine slot — for videos with two emphasis words',
    wordProp: 'word',
    defaults: { leadInSec: 0.5, windowSec: 3.5 } },
];

function ScriptEffectPinner({ id }) {
  const { edges, nodeOutputs, onAssetSequencePublish, openFilePicker } = useContext(CanvasCtx);

  // ── Resolve wires ──────────────────────────────────────────────────────
  let wiredScript = '';
  let wiredWords = null;
  for (const edge of (edges || []).filter(e => e.target === id)) {
    const src = nodeOutputs?.[edge.source];
    if (!src) continue;
    if (edge.targetHandle === 'script-in') {
      wiredScript = wiredScript || src.script || src.text || src.prompt || src.caption || '';
    }
    if (edge.targetHandle === 'transcript-in') {
      if (Array.isArray(src.words)) wiredWords = src.words;
      else if (src.transcript && Array.isArray(src.transcript.words)) wiredWords = src.transcript.words;
    }
  }

  // ── State ──────────────────────────────────────────────────────────────
  const [transcriptJson, setTranscriptJson] = useState('');
  const [activeEffectId, setActiveEffectId] = useState('opus-glisten');
  const [pins, setPins] = useState([]);    // [{ id, effectId, wordIdx, leadInSec?, windowSec?, customProps? }]
  const [fps] = useState(30);
  const [status, setStatus] = useState('idle');   // idle | rendering | done | error
  const [error, setError] = useState('');
  // Per-effect mode: one rendered clip per pin, keyed by pin.id. Each entry:
  // { url, durationSec, label, effectId, wordText }. Replaces the legacy
  // single-track `renderedOverlay` so Cartesian can place each effect on its
  // own zone with independent x/y/w/h/start (matches the asset-sequencer UX
  // 2026-05-12 — see feedback/architecture discussion in chat).
  const [renderedClips, setRenderedClips] = useState({});
  const [editingPinId, setEditingPinId] = useState(null);

  const stop_ = (e) => { e.stopPropagation(); };

  // ── Parse pasted transcript JSON if no wire ────────────────────────────
  let pastedWords = null;
  if (!wiredWords && transcriptJson.trim()) {
    try {
      const parsed = JSON.parse(transcriptJson);
      if (Array.isArray(parsed)) pastedWords = parsed;
      else if (Array.isArray(parsed.words)) pastedWords = parsed.words;
    } catch { /* invalid JSON — leave pastedWords null, show error in UI */ }
  }
  // Filter ElevenLabs Scribe "spacing" entries — those are between-word
  // microsilences, not pinnable. Keep entries with type === 'word' OR no
  // type field (covers non-Scribe transcript formats too).
  const rawWords = (wiredWords && wiredWords.length > 0) ? wiredWords : (pastedWords || []);
  const words = rawWords.filter(w => !w?.type || w.type === 'word');
  const script = wiredScript || '';

  // Normalize word access (defensive for both {text,start,end} and {word,start_time,end_time})
  const getWordText = (w) => w?.text ?? w?.word ?? '';
  const getWordStart = (w) => Number.isFinite(w?.start) ? w.start : Number.isFinite(w?.start_time) ? w.start_time : 0;
  const getWordEnd = (w) => Number.isFinite(w?.end) ? w.end : Number.isFinite(w?.end_time) ? w.end_time : (getWordStart(w) + 0.4);

  // ── Build beats[] from pins ────────────────────────────────────────────
  const buildBeats = () => {
    const beats = [];
    for (const pin of pins) {
      const effect = EFFECTS.find(e => e.id === pin.effectId);
      if (!effect) continue;
      const word = words[pin.wordIdx];
      if (!word) continue;
      const anchorStart = getWordStart(word);
      const leadInSec = Number.isFinite(pin.leadInSec) ? pin.leadInSec : effect.defaults.leadInSec ?? 1.5;
      const windowSec = Number.isFinite(pin.windowSec) ? pin.windowSec : effect.defaults.windowSec ?? 5;
      const startSec = Math.max(0, anchorStart - leadInSec);
      const endSec = startSec + windowSec;

      const props = { ...effect.defaults };
      delete props.leadInSec;
      delete props.windowSec;
      if (effect.wordProp) props[effect.wordProp] = getWordText(word);
      if (pin.customProps) Object.assign(props, pin.customProps);

      beats.push({ type: effect.type, startSec, endSec, props });
    }
    beats.sort((a, b) => a.startSec - b.startSec);
    return beats;
  };

  const beats = buildBeats();
  const lastWordEnd = words.length > 0 ? getWordEnd(words[words.length - 1]) : 0;
  const durationSec = Math.max(5, lastWordEnd + 1);
  const durationInFrames = Math.round(durationSec * fps);

  // Audio cues — bubble per non-OpusGlisten beat + ONE chime at first OpusGlisten + 64 frames
  const audioCues = (() => {
    const bubbles = beats.filter(b => b.type !== 'OpusGlisten').map(b => Math.round(b.startSec * fps));
    const opus = beats.find(b => b.type === 'OpusGlisten');
    const out = { bubbles, whooshes: [] };
    if (opus) out.chime = Math.round(opus.startSec * fps) + 64;
    return out;
  })();

  // ── Publish beats[] + per-effect clips to wire outputs ────────────────
  // Per-effect mode: one asset per pin, each a short transparent .webm with
  // a single effect. Cartesian Composer's content-pool loop reads `assets[]`
  // and the operator drags each one onto its own zone — independent x/y/w/h
  // and start time per effect. The 'hyperframes' asset type tells Cartesian
  // this is an alpha-channel overlay (alpha-aware compositor path).
  const renderedClipsArr = pins
    .map(p => renderedClips[p.id] ? { pin: p, ...renderedClips[p.id] } : null)
    .filter(Boolean);
  useEffect(() => {
    const assets = renderedClipsArr.map(({ pin, url, durationSec, label }) => {
      // anchorSec is the word's start timestamp in the source transcript.
      // Cartesian Composer uses this to auto-place the zone at the moment
      // the word is spoken in the base video — so dropping a Pinner clip
      // onto a zone lands its start at exactly the pinned word's time.
      const word = words[pin.wordIdx];
      const anchorSec = word ? getWordStart(word) : 0;
      return {
        id: `pinner-${id}-${pin.id}`,
        label,
        type: 'hyperframes',
        url,
        durationSec,
        anchorSec,
        // Transparent overlays render full-frame internally — placing them in
        // a tiny corner zone shrinks the baked motion graphics to invisibility.
        // Default to full-frame so the effect appears at its rendered size;
        // operator can resize/reposition after dropping.
        defaultX: 0,
        defaultY: 0,
        defaultW: 100,
        defaultH: 100,
      };
    });
    onAssetSequencePublish?.(id, {
      beats,
      durationInFrames,
      fps,
      audioCues,
      assets,
    });
  }, [id, JSON.stringify(beats), durationInFrames, fps, JSON.stringify(renderedClipsArr.map(c => c.url)), onAssetSequencePublish]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pin actions ────────────────────────────────────────────────────────
  // Invalidate the affected pin's rendered clip only, not all clips — so adding
  // pin #5 doesn't force re-renders of pins #1-4. Removing a pin drops its clip.
  const pinWord = (wordIdx) => {
    const newPin = {
      id: `pin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      effectId: activeEffectId,
      wordIdx,
    };
    setPins(p => [...p, newPin]);
  };

  const removePin = (pinId) => {
    setPins(p => p.filter(x => x.id !== pinId));
    setRenderedClips(cs => { const { [pinId]: _drop, ...rest } = cs; return rest; });
  };

  const updatePin = (pinId, patch) => {
    setPins(p => p.map(x => x.id === pinId ? { ...x, ...patch } : x));
    // Invalidate THIS pin's render — its lead-in/window/effect may have changed.
    setRenderedClips(cs => { const { [pinId]: _drop, ...rest } = cs; return rest; });
  };

  // Map wordIdx → array of pins on that word (for color rings + counts)
  const pinsByWordIdx = pins.reduce((acc, p) => {
    if (!acc[p.wordIdx]) acc[p.wordIdx] = [];
    acc[p.wordIdx].push(p);
    return acc;
  }, {});

  // ── Render per-effect clips ────────────────────────────────────────────
  // One short transparent .webm per pin, fired in parallel. Each clip's
  // beat starts at frame 0 with windowSec duration — the effect's internal
  // ramp/animation happens within that window. Operator places each clip
  // independently on Cartesian, choosing exactly when (and where) the effect
  // appears in the final composition. Pins already rendered are skipped on
  // re-render so adding a new pin only renders the new one.
  const renderClips = async () => {
    if (pins.length === 0) { setError('pin at least one effect first'); setStatus('error'); return; }
    setStatus('rendering'); setError('');

    const pendingPins = pins.filter(p => !renderedClips[p.id]);
    if (pendingPins.length === 0) { setStatus('done'); return; }

    const tasks = pendingPins.map(pin => {
      const effect = EFFECTS.find(e => e.id === pin.effectId);
      if (!effect) return null;
      const word = words[pin.wordIdx];
      if (!word) return null;

      const windowSec = Number.isFinite(pin.windowSec) ? pin.windowSec : effect.defaults.windowSec ?? 5;

      const props = { ...effect.defaults };
      delete props.leadInSec;
      delete props.windowSec;
      if (effect.wordProp) props[effect.wordProp] = getWordText(word);
      if (pin.customProps) Object.assign(props, pin.customProps);

      const clipBeat = { type: effect.type, startSec: 0, endSec: windowSec, props };
      const clipDurationFrames = Math.round(windowSec * fps);

      // Per-clip audio cues — chime fires for OpusGlisten effects at +64f
      // from the beat start (matches the original combined-track behavior).
      // Other effects get a single bubble at frame 0.
      const clipAudioCues = effect.type === 'OpusGlisten'
        ? { bubbles: [], whooshes: [], chime: 64 }
        : { bubbles: [0], whooshes: [] };

      const wordText = getWordText(word);
      const label = `${effect.label} · "${wordText}"`;

      return { pin, clipBeat, clipDurationFrames, clipAudioCues, label, effectId: pin.effectId, wordText };
    }).filter(Boolean);

    // Concurrency limit — Remotion spawns a fresh Chrome per render. 14
    // parallel Chromes peg CPU and trigger the 25s browser-connect timeout
    // wave (even with the retry helper). 4-at-a-time keeps the machine
    // responsive while still being ~3.5× faster than serial.
    const runWithConcurrency = async (items, limit, worker) => {
      const out = new Array(items.length);
      let cursor = 0;
      const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
          const i = cursor++;
          if (i >= items.length) return;
          out[i] = await worker(items[i]);
        }
      });
      await Promise.all(runners);
      return out;
    };

    try {
      const results = await runWithConcurrency(tasks, 4, async (t) => {
        const r = await fetch('http://localhost:3001/api/remotion/skyframe-overlay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            beats: [t.clipBeat],
            audioCues: t.clipAudioCues,
            durationInFrames: t.clipDurationFrames,
            fps,
          }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
        return {
          pinId: t.pin.id,
          url: data.url,
          durationSec: t.clipDurationFrames / fps,
          label: t.label,
          effectId: t.effectId,
          wordText: t.wordText,
        };
      });

      setRenderedClips(prev => {
        const next = { ...prev };
        for (const r of results) next[r.pinId] = r;
        return next;
      });
      setStatus('done');
    } catch (err) {
      setError(err.message); setStatus('error');
    }
  };

  // ── Status color ───────────────────────────────────────────────────────
  const dotColor = status === 'rendering' ? '#fb923c'
    : status === 'done' ? '#00FFFF'
    : status === 'error' ? '#e74c3c'
    : '#555';

  const activeEffect = EFFECTS.find(e => e.id === activeEffectId);

  return (
    <div className="cv-node cv-suno nowheel" style={{ '--status-color': dotColor, minWidth: 440, maxWidth: 520 }}>
      <NodeDeleteBtn nodeId={id} />
      <HandleWithTip type="target" position={Position.Left} id="script-in"     style={{ top: '20%' }} tip="script ← wire any text source (Niche/ARES Script Gen, MindWire, etc.)" />
      <HandleWithTip type="target" position={Position.Left} id="transcript-in" style={{ top: '50%' }} tip="transcript ← wire { words: [{text,start,end},...] } from Scribe/Whisper, OR paste JSON below" />
      <HandleWithTip type="source" position={Position.Right} id="beats-out"   style={{ top: '40%' }} tip="beats[] → raw operator-curated beats array for any downstream renderer" />
      <HandleWithTip type="source" position={Position.Right} id="overlay-out" style={{ top: '70%' }} tip="rendered transparent .webm → drop into Cartesian / Stack Video / FFmpeg as overlay layer" />

      <div className="cv-suno-header">
        <div className="cv-suno-dot" />
        <span>SCRIPT · EFFECT · PINNER</span>
        {status === 'rendering' && <span className="cv-suno-stat cv-suno-stat-running">rendering…</span>}
        {status === 'done' && <span className="cv-suno-stat cv-suno-stat-done">✓ overlay ready</span>}
        {status === 'error' && <span className="cv-suno-stat cv-suno-stat-error">⚠ error</span>}
      </div>

      {/* Wire indicators */}
      <div style={{ display: 'flex', gap: 8, fontSize: 10, opacity: 0.8, marginBottom: 6 }}>
        <span>{script ? '📌 script ✓' : '○ no script'}</span>
        <span>·</span>
        <span>{words.length > 0 ? `📜 ${words.length} words · ${durationSec.toFixed(1)}s` : '○ no transcript'}</span>
      </div>

      {/* Script preview (collapsed by default — read-only context) */}
      {script && (
        <details style={{ marginBottom: 6 }}>
          <summary className="nodrag" onClick={stop_} onMouseDown={stop_} style={{ fontSize: 10, opacity: 0.7, cursor: 'pointer' }}>
            script preview ({script.length} chars)
          </summary>
          <div className="nodrag" onClick={stop_} onMouseDown={stop_}
            style={{ fontSize: 11, lineHeight: 1.4, padding: 6, border: '1px solid #333', borderRadius: 3, maxHeight: 100, overflowY: 'auto', whiteSpace: 'pre-wrap', color: '#aaa', marginTop: 4 }}>
            {script}
          </div>
        </details>
      )}

      {/* Transcript paste fallback (only shown when no wired words) */}
      {words.length === 0 && (
        <div className="cv-suno-field">
          <textarea
            className="cv-suno-textarea nodrag"
            placeholder='paste Scribe/Whisper JSON: { "words": [{"text":"...", "start":0.1, "end":0.4}, ...] }'
            value={transcriptJson}
            rows={3}
            onChange={(e) => { stop_(e); setTranscriptJson(e.target.value); }}
            onClick={stop_} onMouseDown={stop_}
          />
          <button
            className="nodrag"
            onClick={(e) => { stop_(e); openFilePicker({
              key: 'script-pinner-json', label: 'a transcript JSON',
              startDir: '.\\testing-vids\\edit\\transcripts',
              exts: ['json'],
            }, async (p) => {
              try {
                const r = await fetch(`http://localhost:3001/api/local-text?path=${encodeURIComponent(p)}`);
                const data = await r.json();
                if (r.ok && data.content) setTranscriptJson(data.content);
              } catch { /* leave field unchanged */ }
            }); }}
            onMouseDown={stop_}
            title="Browse for transcript JSON file"
            style={{ marginTop: 4, padding: '5px 10px', fontSize: 11, background: 'var(--bg-card, #1a1a24)', border: '1px solid var(--border, #2a2a35)', borderRadius: 4, cursor: 'pointer', color: 'var(--text, #e8e8e8)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >📁 Load JSON file…</button>
        </div>
      )}

      {/* Active effect picker — grid of 10 */}
      {words.length > 0 && (
        <>
          <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4, marginBottom: 4 }}>
            ACTIVE EFFECT — pick one, then click words below to pin
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, marginBottom: 8, padding: '0 2px', boxSizing: 'border-box' }}>
            {EFFECTS.map(ef => {
              const isActive = ef.id === activeEffectId;
              return (
                <button
                  key={ef.id}
                  className="nodrag"
                  onClick={(e) => { stop_(e); setActiveEffectId(ef.id); }}
                  onMouseDown={stop_}
                  title={ef.desc}
                  style={{
                    fontSize: 10,
                    padding: '5px 3px',
                    border: `1.5px solid ${isActive ? ef.color : '#333'}`,
                    background: isActive ? `${ef.color}22` : 'transparent',
                    color: isActive ? ef.color : '#aaa',
                    borderRadius: 3,
                    cursor: 'pointer',
                    textAlign: 'center',
                    lineHeight: 1.2,
                    boxSizing: 'border-box', minWidth: 0,
                  }}
                >
                  <div style={{ fontSize: 14, marginBottom: 2 }}>{ef.icon}</div>
                  <div style={{ fontSize: 9 }}>{ef.label}</div>
                </button>
              );
            })}
          </div>

          {/* Transcript word-pinning area */}
          <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 4 }}>
            TRANSCRIPT — click a word to pin <span style={{ color: activeEffect?.color }}>{activeEffect?.label}</span>
          </div>
          <div className="nodrag"
            onClick={stop_} onMouseDown={stop_}
            style={{
              fontSize: 12, lineHeight: 1.7,
              padding: 8, border: '1px solid #333', borderRadius: 3,
              maxHeight: 200, overflowY: 'auto',
              background: '#0a0a0f',
              marginBottom: 8,
            }}
          >
            {words.map((w, idx) => {
              const text = getWordText(w);
              const pinsHere = pinsByWordIdx[idx] || [];
              const isPinned = pinsHere.length > 0;
              const ringColor = isPinned ? EFFECTS.find(e => e.id === pinsHere[0].effectId)?.color || '#fff' : null;
              return (
                <span
                  key={idx}
                  onClick={(e) => { stop_(e); pinWord(idx); }}
                  onMouseDown={stop_}
                  title={`${text} @ ${getWordStart(w).toFixed(2)}s${isPinned ? ` · ${pinsHere.length} effect(s) pinned` : ''}`}
                  style={{
                    display: 'inline-block',
                    padding: isPinned ? '1px 4px' : '1px 2px',
                    margin: '0 1px',
                    cursor: 'pointer',
                    borderRadius: 2,
                    background: isPinned ? `${ringColor}33` : 'transparent',
                    border: isPinned ? `1px solid ${ringColor}` : '1px solid transparent',
                    color: isPinned ? ringColor : '#ddd',
                  }}
                >
                  {text}
                </span>
              );
            })}
          </div>

          {/* Pinned beats list */}
          {pins.length > 0 && (
            <>
              <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 4 }}>
                PINNED ({pins.length}) — duration ≈ {durationSec.toFixed(1)}s
              </div>
              <div style={{ maxHeight: 140, overflowY: 'auto', border: '1px solid #333', borderRadius: 3, padding: 4, marginBottom: 8 }}>
                {pins.map(pin => {
                  const effect = EFFECTS.find(e => e.id === pin.effectId);
                  const word = words[pin.wordIdx];
                  const wordText = getWordText(word);
                  const startSec = getWordStart(word);
                  const leadIn = Number.isFinite(pin.leadInSec) ? pin.leadInSec : effect?.defaults.leadInSec ?? 1.5;
                  const windowSec = Number.isFinite(pin.windowSec) ? pin.windowSec : effect?.defaults.windowSec ?? 5;
                  const isEditing = editingPinId === pin.id;
                  return (
                    <div key={pin.id} style={{ padding: '4px 6px', fontSize: 11, borderBottom: '1px solid #222', display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: effect?.color, minWidth: 16, textAlign: 'center' }}>{effect?.icon}</span>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <strong>{wordText}</strong> <span style={{ opacity: 0.5 }}>@ {startSec.toFixed(2)}s</span> → <span style={{ color: effect?.color }}>{effect?.label}</span>
                        </span>
                        <button className="nodrag"
                          onClick={(e) => { stop_(e); setEditingPinId(isEditing ? null : pin.id); }}
                          onMouseDown={stop_}
                          style={{ fontSize: 10, padding: '1px 5px', border: '1px solid #444', background: 'transparent', color: '#aaa', borderRadius: 2, cursor: 'pointer' }}
                          title="tune lead-in / window">✎</button>
                        <button className="nodrag"
                          onClick={(e) => { stop_(e); removePin(pin.id); }}
                          onMouseDown={stop_}
                          style={{ fontSize: 10, padding: '1px 5px', border: '1px solid #444', background: 'transparent', color: '#e74c3c', borderRadius: 2, cursor: 'pointer' }}
                          title="unpin">×</button>
                      </div>
                      {isEditing && (
                        <div style={{ display: 'flex', gap: 6, fontSize: 10, paddingLeft: 22 }}>
                          <label className="nodrag" onClick={stop_} onMouseDown={stop_} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            lead-in
                            <input type="number" step="0.1" value={leadIn} className="nodrag"
                              onChange={(e) => { stop_(e); updatePin(pin.id, { leadInSec: parseFloat(e.target.value) || 0 }); }}
                              onClick={stop_} onMouseDown={stop_}
                              style={{ width: 50, background: '#0a0a0f', border: '1px solid #333', color: '#ddd', padding: '1px 4px', fontSize: 10 }} />
                            s
                          </label>
                          <label className="nodrag" onClick={stop_} onMouseDown={stop_} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            window
                            <input type="number" step="0.5" value={windowSec} className="nodrag"
                              onChange={(e) => { stop_(e); updatePin(pin.id, { windowSec: parseFloat(e.target.value) || 1 }); }}
                              onClick={stop_} onMouseDown={stop_}
                              style={{ width: 50, background: '#0a0a0f', border: '1px solid #333', color: '#ddd', padding: '1px 4px', fontSize: 10 }} />
                            s
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {error && <div className="cv-suno-err">{error}</div>}

      {renderedClipsArr.length > 0 && (
        <div className="cv-suno-result">
          <div style={{ fontSize: 11, marginBottom: 6 }}>
            ✓ {renderedClipsArr.length} clip{renderedClipsArr.length === 1 ? '' : 's'} ready · wire to Cartesian content-pool
          </div>
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 4,
            maxHeight: 220, overflowY: 'auto', padding: '2px',
            background: 'rgba(255,255,255,0.02)', borderRadius: 4,
          }}
          onWheel={(e) => e.stopPropagation()}>
            {renderedClipsArr.map(({ pin, url, durationSec: clipDur, label }) => (
              <div key={pin.id} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 6px', borderRadius: 3,
                background: 'rgba(0,0,0,0.25)',
                fontSize: 10, fontFamily: 'monospace',
              }}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#e8e8e8' }}>
                  {label}
                </span>
                <span style={{ opacity: 0.5 }}>{clipDur.toFixed(1)}s</span>
                <a className="nodrag"
                  href={url} target="_blank" rel="noopener noreferrer"
                  onClick={stop_} onMouseDown={stop_}
                  style={{ color: '#22d3ee', textDecoration: 'none' }}
                  title="open this clip">↗</a>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        className="cv-suno-btn nodrag"
        onClick={(e) => { stop_(e); renderClips(); }}
        onMouseDown={stop_}
        disabled={status === 'rendering' || pins.length === 0 || words.length === 0}
      >
        {(() => {
          if (status === 'rendering') return 'rendering clips…';
          if (pins.length === 0) return 'pin at least 1 effect to render';
          const pending = pins.filter(p => !renderedClips[p.id]).length;
          if (pending === 0) return `↻ re-render all (${pins.length})`;
          if (pending === pins.length) return `↪ render ${pins.length} clip${pins.length === 1 ? '' : 's'}`;
          return `↪ render ${pending} new clip${pending === 1 ? '' : 's'} (${pins.length - pending} cached)`;
        })()}
      </button>
    </div>
  );
}

/* ===== POSTIZ NODE — Distribution lane =================================
 *
 * Schedule, draft, or post-now to 28+ social platforms via Postiz's public
 * API (api.postiz.com/public/v1). Drop-in alternative to BlottoNode; auth
 * header is just `Authorization: <key>` (no Bearer). Self-hosted swap-out
 * uses POSTIZ_BASE_URL env on the server side — same wire shape.
 *
 * Wire inputs:
 *   - caption-in (left, top)   ← any text source (script gen, transcript, etc)
 *   - media-in   (left, bottom) ← any node emitting `{ url, type }`
 *                                  (Cartesian, Stack Video, Suno, KIE Img2Vid)
 *
 * Flow:
 *   1. Operator pastes POSTIZ_API_KEY → click "↓ load accounts" → list of
 *      connected channels loads from /integrations.
 *   2. Pick which accounts to publish to via checkboxes.
 *   3. Pick mode: now / schedule (datetime picker) / next slot / draft.
 *   4. If media wire present, server fetches URL → multipart-uploads to
 *      Postiz /upload → drops {id, path} into post body.
 *   5. POST /posts with full bundle.
 *
 * v1 limits:
 *   - settings.__type populated from integration.identifier; platform-specific
 *     fields (YouTube title, TikTok privacy_level, Reddit subreddit) not yet
 *     surfaced — those platforms may reject. Add a per-platform settings
 *     editor in v2 when the operator reaches for them.
 *   - Single caption broadcast to all selected platforms (no per-account
 *     remix). Same constraint as BlottoNode for now.
 */
function PostizNode({ id }) {
  const { edges, nodeOutputs } = useContext(CanvasCtx);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('postiz-api-key') || '');
  const [showKey, setShowKey] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [selected, setSelected] = useState({});
  const [mode, setMode] = useState('slot');
  const [scheduleAt, setScheduleAt] = useState('');
  const [captionOverride, setCaptionOverride] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const stop_ = (e) => { e.stopPropagation(); };
  const saveKey = (v) => { setApiKey(v); localStorage.setItem('postiz-api-key', v); };

  // Resolve upstream wires — caption and media URL via dedicated handles
  // (caption-in / media-in) with a fallback scan for any url-emitting node.
  let upstreamCaption = '';
  let upstreamMediaUrl = '';
  let upstreamMediaType = '';
  for (const edge of (edges || []).filter(e => e.target === id)) {
    const src = nodeOutputs?.[edge.source];
    if (!src) continue;
    if (edge.targetHandle === 'caption-in' || edge.targetHandle === 'context-in') {
      upstreamCaption = upstreamCaption || src.script || src.caption || src.text || src.prompt || src.hook || '';
    }
    if (edge.targetHandle === 'media-in') {
      if (src.url) { upstreamMediaUrl = upstreamMediaUrl || src.url; upstreamMediaType = upstreamMediaType || (src.type || ''); }
    }
  }
  // Fallback: any wire with a url, if media-in handle isn't used
  if (!upstreamMediaUrl) {
    for (const edge of (edges || []).filter(e => e.target === id)) {
      const src = nodeOutputs?.[edge.source];
      if (src?.url) { upstreamMediaUrl = src.url; upstreamMediaType = src.type || ''; break; }
    }
  }
  const finalCaption = (captionOverride.trim() || upstreamCaption || '').slice(0, 2000);
  const selectedIds = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
  const canPost = !!apiKey && !!finalCaption && selectedIds.length > 0
                  && status !== 'posting' && status !== 'uploading' && status !== 'loading-accounts';

  const loadAccounts = async () => {
    if (!apiKey) { setError('POSTIZ_API_KEY required'); setStatus('error'); return; }
    setStatus('loading-accounts'); setError('');
    try {
      const r = await fetch('http://localhost:3001/api/postiz/integrations', {
        headers: { 'x-postiz-key': apiKey },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || data?.message || `HTTP ${r.status}`);
      // Postiz response shape can vary by version: bare array, or wrapper like
      // {integrations: [...]} / {data: [...]} / {accounts: [...]} / {items: [...]}.
      // Try each shape; bail with a debug error if none match.
      let list = null;
      if (Array.isArray(data)) list = data;
      else if (Array.isArray(data?.integrations)) list = data.integrations;
      else if (Array.isArray(data?.data)) list = data.data;
      else if (Array.isArray(data?.accounts)) list = data.accounts;
      else if (Array.isArray(data?.items)) list = data.items;
      console.log('[Postiz] /integrations raw response:', data);
      if (list === null) {
        setError(`Unexpected response shape: ${typeof data === 'object' ? `keys=[${Object.keys(data || {}).join(', ')}]` : typeof data}`);
        setStatus('error');
        return;
      }
      setAccounts(list);
      if (list.length === 0) {
        setError('Postiz returned 0 accounts. Connect a channel on app.postiz.com first.');
        setStatus('error');
      } else {
        setStatus('idle');
      }
    } catch (err) {
      setError(err.message); setStatus('error');
    }
  };

  const post = async () => {
    if (!canPost) return;
    setError(''); setResult(null);

    // Upload step (only if a media wire is present)
    let uploadedImage = null;
    if (upstreamMediaUrl) {
      setStatus('uploading');
      try {
        const ur = await fetch('http://localhost:3001/api/postiz/upload-from-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-postiz-key': apiKey },
          body: JSON.stringify({ url: upstreamMediaUrl }),
        });
        const udata = await ur.json();
        if (!ur.ok) throw new Error(udata?.error || udata?.message || `upload HTTP ${ur.status}`);
        uploadedImage = { id: udata.id, path: udata.path };
      } catch (err) {
        setError(`media upload: ${err.message}`); setStatus('error'); return;
      }
    }

    // Date resolution by mode
    setStatus('posting');
    let postDate = new Date().toISOString();
    if (mode === 'schedule' && scheduleAt) {
      postDate = new Date(scheduleAt).toISOString();
    } else if (mode === 'slot') {
      try {
        const slotRes = await fetch(`http://localhost:3001/api/postiz/find-slot/${encodeURIComponent(selectedIds[0])}`, {
          headers: { 'x-postiz-key': apiKey },
        });
        const slotData = await slotRes.json();
        if (slotRes.ok && slotData?.date) postDate = slotData.date;
      } catch { /* fallback to now */ }
    }

    // Build the posts[] payload. settings.__type seeded from each integration's
    // own provider identifier — platform-specific extras (YouTube title etc)
    // would slot in here in v2.
    // Per-platform settings — Postiz validates these server-side per identifier.
    // Defaults chosen to pass validation with the safest user-facing behavior
    // (TikTok posts land as SELF_ONLY = private draft you publish manually).
    // image is always [] when no media wired so the "must be an array" check
    // passes; the platform may still reject if it actually requires media.
    const PLATFORM_DEFAULTS = {
      tiktok: {
        privacy_level: 'PUBLIC_TO_EVERYONE',
        duet: false,
        stitch: false,
        autoAddMusic: 'no',
        brand_content_toggle: false,
        brand_organic_toggle: false,
        content_posting_method: 'DIRECT_POST',
      },
      instagram: { post_type: 'post' },
      'instagram-standalone': { post_type: 'post' },
      facebook: {},
      x: {},
      youtube: { type: 'public' },
      threads: {},
      linkedin: {},
      reddit: {},
    };
    const posts = selectedIds.map(intId => {
      const acct = accounts.find(a => a.id === intId);
      const platformId = acct?.identifier || 'default';
      const value = [{
        content: finalCaption,
        image: uploadedImage ? [uploadedImage] : [],
      }];
      return {
        integration: { id: intId },
        value,
        settings: {
          __type: platformId,
          ...(PLATFORM_DEFAULTS[platformId] || {}),
        },
      };
    });

    const body = {
      type: mode === 'draft' ? 'draft' : (mode === 'now' ? 'now' : 'schedule'),
      date: postDate,
      shortLink: false,
      tags: [],
      posts,
    };

    console.log('[Postiz] /schedule request body:', body);
    try {
      const r = await fetch('http://localhost:3001/api/postiz/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-postiz-key': apiKey },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      console.log('[Postiz] /schedule response:', r.status, data);
      if (!r.ok) {
        // Surface every detail Postiz gives us. NestJS-style errors look like
        // { statusCode, message, error } where message may be string or array.
        const msgs = [];
        if (data?.message) msgs.push(Array.isArray(data.message) ? data.message.join(' | ') : data.message);
        if (data?.error && data.error !== data?.message) msgs.push(data.error);
        if (data?.details) msgs.push(typeof data.details === 'string' ? data.details : JSON.stringify(data.details));
        const detail = msgs.length ? msgs.join(' — ') : JSON.stringify(data).slice(0, 500);
        throw new Error(`HTTP ${r.status}: ${detail}`);
      }
      setResult(data);
      setStatus('done');
    } catch (err) {
      setError(err.message); setStatus('error');
    }
  };

  const dotColor = status === 'posting' || status === 'uploading' || status === 'loading-accounts' ? '#a78bfa'
    : status === 'done' ? '#00FFFF'
    : status === 'error' ? '#e74c3c'
    : '#555';

  return (
    <div className="cv-node cv-suno nowheel" style={{ '--status-color': dotColor }}>
      <NodeDeleteBtn nodeId={id} />
      <HandleWithTip
        type="target"
        position={Position.Left}
        id="caption-in"
        style={{ top: '30%' }}
        tip="caption ← wire any text source (script gen, transcript, mindwire)"
      />
      <HandleWithTip
        type="target"
        position={Position.Left}
        id="media-in"
        style={{ top: '70%' }}
        tip="media ← wire Cartesian / Stack Video / Suno / KIE Img2Vid url-emitting node"
      />

      <div className="cv-suno-header">
        <div className="cv-suno-dot" />
        <span>POSTIZ</span>
        {status === 'loading-accounts' && <span className="cv-suno-stat cv-suno-stat-running">loading…</span>}
        {status === 'uploading' && <span className="cv-suno-stat cv-suno-stat-running">uploading…</span>}
        {status === 'posting' && <span className="cv-suno-stat cv-suno-stat-running">posting…</span>}
        {status === 'done' && <span className="cv-suno-stat cv-suno-stat-done">✓ done</span>}
        {status === 'error' && <span className="cv-suno-stat cv-suno-stat-error">⚠ error</span>}
      </div>

      {upstreamCaption && (
        <div className="cv-suno-wire">📌 wire caption · {upstreamCaption.length} chars</div>
      )}
      {upstreamMediaUrl && (
        <div className="cv-suno-wire">📎 wire media · {upstreamMediaType || 'url'} · {upstreamMediaUrl.split('/').pop().slice(0, 36)}</div>
      )}

      <div className="cv-suno-field">
        <textarea
          className="cv-suno-textarea nodrag"
          placeholder={upstreamCaption ? '(wire caption in use — type to override)' : 'caption / post text…'}
          value={captionOverride}
          rows={3}
          onChange={(e) => { stop_(e); setCaptionOverride(e.target.value); }}
          onClick={stop_} onMouseDown={stop_}
        />
      </div>

      <div className="cv-suno-row">
        <label className="cv-suno-label nodrag" onClick={stop_} onMouseDown={stop_}>
          <span>mode</span>
          <select className="cv-suno-select nodrag" value={mode}
            onChange={(e) => { stop_(e); setMode(e.target.value); }}
            onClick={stop_} onMouseDown={stop_}
            style={{ fontSize: 12 }}>
            <option value="now">post now</option>
            <option value="schedule">schedule</option>
            <option value="slot">next slot</option>
            <option value="draft">draft</option>
          </select>
        </label>
      </div>

      {mode === 'schedule' && (
        <div className="cv-suno-field">
          <input
            type="datetime-local"
            className="cv-suno-input nodrag"
            value={scheduleAt}
            onChange={(e) => { stop_(e); setScheduleAt(e.target.value); }}
            onClick={stop_} onMouseDown={stop_}
          />
        </div>
      )}

      <div className="cv-suno-field">
        <input
          type={showKey ? 'text' : 'password'}
          className="cv-suno-input nodrag"
          placeholder="POSTIZ_API_KEY"
          value={apiKey}
          onChange={(e) => { stop_(e); saveKey(e.target.value); }}
          onClick={stop_} onMouseDown={stop_}
        />
        <button className="cv-suno-eye nodrag"
          onClick={(e) => { stop_(e); setShowKey(s => !s); }}
          onMouseDown={stop_}
          title={showKey ? 'hide' : 'show'}
        >{showKey ? '◉' : '○'}</button>
      </div>

      <button
        className="cv-suno-model-toggle nodrag"
        onClick={(e) => { stop_(e); loadAccounts(); }}
        onMouseDown={stop_}
        disabled={!apiKey || status === 'loading-accounts'}
      >
        {accounts.length ? `↻ refresh accounts (${accounts.length})` : '↓ load accounts'}
      </button>

      {accounts.length > 0 && (
        <div style={{ display: 'block', boxSizing: 'border-box', width: 'calc(100% - 28px)', margin: '4px 14px 0', maxHeight: 180, overflowY: 'auto', overflowX: 'hidden', border: '1px solid #333', borderRadius: 3, padding: 4 }}>
          {accounts.map((acct, i) => {
            const acctId = acct.id || acct.integrationId || acct.uuid || `idx-${i}`;
            const primary = acct.name || acct.profile || acct.username || acct.displayName || acct.handle || acct.title || acct.label || '';
            const secondary = acct.providerIdentifier || acct.identifier || acct.provider || acct.platform || acct.type || '';
            const fallback = primary || secondary
              ? ''
              : `[${Object.keys(acct).slice(0, 6).join(', ')}]`;
            return (
              <label
                key={acctId}
                className="nodrag"
                style={{ display: 'grid', gridTemplateColumns: '16px 1fr', alignItems: 'center', columnGap: 6, padding: '3px 4px', fontSize: 12, color: '#e8e8e8', cursor: acct.disabled ? 'not-allowed' : 'pointer', opacity: acct.disabled ? 0.4 : 1, boxSizing: 'border-box', width: '100%' }}
                onClick={stop_} onMouseDown={stop_}
              >
                <input
                  type="checkbox"
                  checked={!!selected[acctId]}
                  disabled={acct.disabled}
                  onChange={(e) => { stop_(e); setSelected(s => ({ ...s, [acctId]: e.target.checked })); }}
                  onClick={stop_} onMouseDown={stop_}
                />
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#e8e8e8', fontSize: 12 }}>
                  <strong style={{ color: '#fb923c' }}>{primary || secondary || '?'}</strong>
                  {primary && secondary && <span style={{ opacity: 0.55, marginLeft: 6 }}>· {secondary}</span>}
                  {fallback && <span style={{ opacity: 0.55, marginLeft: 6, fontStyle: 'italic' }}>{fallback}</span>}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {error && <div className="cv-suno-err">{error}</div>}

      {result && Array.isArray(result) && (
        <div className="cv-suno-result">
          <div style={{ fontSize: 11, opacity: 0.8 }}>
            {result.length} post{result.length === 1 ? '' : 's'} {mode === 'draft' ? 'drafted' : mode === 'now' ? 'sent' : 'scheduled'}
          </div>
        </div>
      )}

      <button
        className="cv-suno-btn nodrag"
        onClick={(e) => { stop_(e); post(); }}
        onMouseDown={stop_}
        disabled={!canPost}
      >
        {status === 'uploading' ? 'uploading media…'
          : status === 'posting' ? 'posting…'
          : status === 'done' ? 'post again'
          : (mode === 'draft' ? 'save draft' : mode === 'now' ? 'post now' : mode === 'slot' ? 'schedule (next slot)' : 'schedule')}
      </button>
    </div>
  );
}

/* ===== ARECIBO RECAP NODE — weekly transmission grid ===== */
function AreciboRecapNode({id}) {
  const {nodeOutputs, onAreciboRecap, onAreciboRender} = useContext(CanvasCtx);
  const out = nodeOutputs?.[id] || {};
  const recap = out.recap;
  const busy = out.status === 'loading';
  const rendering = out.status === 'rendering';

  const cols = recap?.grid?.cols || 23;
  const rows = recap?.grid?.rows || 41;

  return (
    <div className="cv-node cv-arecibo" style={{'--status-color': recap ? '#2ee6a6' : '#555', '--node-accent': '#2ee6a6'}}>
      <NodeDeleteBtn nodeId={id} />
      <div className="cv-arecibo-header">
        <div className="cv-arecibo-dot" />
        <span className="cv-arecibo-title">Arecibo Recap</span>
        <span className="cv-arecibo-badge">{recap ? recap.weekLabel : '23×41'}</span>
      </div>

      {recap && (
        <div className="cv-arecibo-grid-wrap">
          <svg viewBox={`0 0 ${cols * 4} ${rows * 4}`} className="cv-arecibo-grid">
            {recap.bits.map((b, i) =>
              b ? <rect key={i} x={(i % cols) * 4} y={Math.floor(i / cols) * 4} width={3.4} height={3.4} fill="#e8e8e8" /> : null
            )}
          </svg>
          <div className="cv-arecibo-caption">{recap.caption}</div>
          <div className="cv-arecibo-meta">
            {recap.stats.total} events · highlight: {recap.highlight || '—'} · {recap.captionSource}
          </div>
        </div>
      )}

      {out.stillUrl && (
        <div className="cv-arecibo-links">
          <a href={`http://localhost:3001${out.stillUrl}`} target="_blank" rel="noreferrer">cipher.png</a>
          <a href={`http://localhost:3001${out.videoUrl}`} target="_blank" rel="noreferrer">transmission.mp4</a>
        </div>
      )}
      {out.error && <div className="cv-niche-error">{out.error}</div>}

      <button className="cv-btn cv-btn-arecibo" disabled={busy}
        onClick={(e) => { e.stopPropagation(); onAreciboRecap(id); }}>
        {busy ? 'Reading the week…' : recap ? 'Regenerate' : 'Generate Recap'}
      </button>
      {recap && (
        <button className="cv-btn cv-btn-arecibo" disabled={rendering}
          onClick={(e) => { e.stopPropagation(); onAreciboRender(id); }}>
          {rendering ? 'Transmitting…' : 'Render Transmission'}
        </button>
      )}
      <Handle type="source" position={Position.Right} id="recap-out" />
    </div>
  );
}

/* ===== REGISTRIES ===== */
const nodeTypes = { character: CharacterNode, ingredient: IngredientNode, type: TypeNode, generator: GeneratorNode, output: OutputNode, group: GroupNode, kie: KieNode, blotato: BlottoNode, gami: GamiNode, 'gami-art': GamiArtNode, 'niche-gen': NicheGenNode, 'ares-gen': ARESScriptGenNode, 'ugc-gen': UgcGenNode, 'avatar-frame': AvatarFrameNode, 'char-scene': CharacterSceneNode, 'clip-splitter': ClipSplitterNode, 'ugc-video': UgcVideoNode, carousel: CarouselNode, 'vid-prompt': VideoPromptNode, 'kie-img2vid': KieImg2VidNode, 'title-card': TitleCardNode, 'frame-sandwich': FrameSandwichNode, 'remotion-comp': RemotionCompNode, 'ffmpeg-grade': FFmpegGradeNode, 'chroma-composite': ChromaCompositeNode, 'chroma-motion': ChromaMotionNode, 'chroma-stylize': ChromaStylizeNode, 'live-preview': LivePreviewNode, 'image-2': ImageTwoNode, 'qc-gate': QCGateNode, 'hyperframes': HyperframesNode, 'broll': BrollNode, 'video-source': VideoSourceNode, 'cartesian': CartesianComposerNode, 'asset-sequence': AssetSequenceNode, 'motion-bake': MotionBakeNode, 'skyframe-picker': SkyframePickerNode, 'cmd-runner': CommandRunnerNode, 'terminal': TerminalNode, 'suno': SunoNode, 'mindwire': MindWireNode, 'pixel-forge': PixelForgeNode, 'sprite-forge': SpriteForgeNode, 'prd-lens': PRDLensNode, 'prd-prompt': PRDPromptCardNode, 'prd-chat': PRDChatNode, 'prd-design': PRDDesignSourceNode, 'prd-render': PRDRenderNode, 'pop-beats': PopBeatsNode, 'stack-video': StackedVideoNode, 'postiz': PostizNode, 'script-pinner': ScriptEffectPinner, 'audio-viz': AudioVisualizerNode, 'bokeh': BokehNode, 'concept-composer': ConceptComposerNode, 'prop-lab': PropLabNode, 'arecibo-recap': AreciboRecapNode, conductor: ConductorNode, ...SF_CHUNK_TYPES };
const edgeTypes = { pulse: PulseEdge };

/* ===== SCRIPT PANEL ===== */
function ScriptPanel({ script, prompts, onClose }) {
  const [copied, setCopied] = useState(null);
  const copy = async (text, key) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };
  if (!script) return null;
  const sections = [
    prompts?.elevenlabs && { key: 'v', label: 'ElevenLabs Voice', text: prompts.elevenlabs },
    prompts?.chatgpt && { key: 'i', label: 'ChatGPT Image', text: prompts.chatgpt },
    prompts?.kling && { key: 'k', label: 'Kling/Higgsfield', text: prompts.kling },
    prompts?.slideshow && { key: 's', label: 'Slideshow', text: prompts.slideshow },
    prompts?.caption && { key: 'c', label: 'Caption + Hashtags', text: prompts.caption },
    prompts?.manychat && { key: 'm', label: 'ManyChat', text: prompts.manychat },
  ].filter(Boolean);

  return (
    <div className="cv-panel-overlay" onClick={onClose}>
      <div className="cv-panel" onClick={(e) => e.stopPropagation()}>
        <div className="cv-panel-header"><span>Generated Script</span><button className="cv-panel-close" onClick={onClose}>x</button></div>
        <div className="cv-panel-section">
          <div className="cv-panel-section-head"><span>Script</span><button className="cv-btn cv-btn-sm" onClick={() => copy(script, 'script')}>{copied === 'script' ? 'Copied!' : 'Copy'}</button></div>
          <pre className="cv-panel-pre">{script}</pre>
        </div>
        {sections.map((s) => (
          <div key={s.key} className="cv-panel-section">
            <div className="cv-panel-section-head"><span>{s.label}</span><button className="cv-btn cv-btn-sm" onClick={() => copy(s.text, s.key)}>{copied === s.key ? 'Copied!' : 'Copy'}</button></div>
            <pre className="cv-panel-pre">{s.text}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ===== VIDEO PANEL ===== */
function VideoPanel({ character, script, onClose }) {
  const [clipMode, setClipMode] = useState('clip-mode');
  const [tierId, setTierId] = useState('cm-30s');
  const [copied, setCopied] = useState(null);

  const tiers = useMemo(() => getTiersForMode(clipMode), [clipMode]);
  const result = useMemo(() => {
    if (!character || !script) return null;
    return buildSora2Prompts(character, script, tierId, 'portrait', 'kling', 'ugc', clipMode);
  }, [character, script, tierId, clipMode]);

  const copy = async (text, key) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const copyAll = () => {
    if (!result) return;
    const all = result.clips.join('\n\n') + '\n\n' + result.assembly;
    copy(all, 'all');
  };

  return (
    <div className="cv-panel-overlay" onClick={onClose}>
      <div className="cv-panel cv-panel-wide" onClick={(e) => e.stopPropagation()}>
        <div className="cv-panel-header">
          <span>Video Clip Prompts — {character?.name}</span>
          <button className="cv-panel-close" onClick={onClose}>x</button>
        </div>

        {/* Controls */}
        <div className="cv-video-controls">
          <div className="cv-video-group">
            <span className="cv-video-label">Clip Mode</span>
            <div className="cv-video-btns">
              {clipModes.map((m) => (
                <button key={m.id} className={`cv-btn cv-btn-sm ${clipMode === m.id ? 'cv-btn-active' : ''}`}
                  onClick={() => { setClipMode(m.id); const t = getTiersForMode(m.id); setTierId(t[0]?.id || ''); }}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div className="cv-video-group">
            <span className="cv-video-label">Duration</span>
            <div className="cv-video-btns">
              {tiers.map((t) => {
                const talk = t.clips.filter(c => !c.type || c.type === 'talking').length;
                const broll = t.clips.filter(c => c.type === 'broll').length;
                const info = broll > 0 ? `${talk}T+${broll}B` : `${t.clips.length}`;
                return (
                  <button key={t.id} className={`cv-btn cv-btn-sm ${tierId === t.id ? 'cv-btn-active' : ''}`} onClick={() => setTierId(t.id)}>
                    {t.label} ({info})
                  </button>
                );
              })}
            </div>
          </div>
          <button className="cv-btn cv-btn-sm" onClick={copyAll}>{copied === 'all' ? 'Copied All!' : 'Copy All Clips'}</button>
        </div>

        {/* Clips */}
        {result && result.clips.map((clipText, i) => {
          const clip = result.tier.clips[i];
          const isBroll = clip?.type === 'broll';
          return (
            <div key={i} className="cv-panel-section">
              <div className="cv-panel-section-head">
                <span>{isBroll ? 'B-ROLL' : 'TALKING'} — Clip {i + 1}: {clip?.beat} ({clip?.seconds}s)</span>
                <button className="cv-btn cv-btn-sm" onClick={() => copy(clipText, i)}>{copied === i ? 'Copied!' : 'Copy'}</button>
              </div>
              <pre className="cv-panel-pre">{clipText}</pre>
            </div>
          );
        })}

        {/* Assembly */}
        {result && (
          <div className="cv-panel-section">
            <div className="cv-panel-section-head">
              <span>Assembly Notes</span>
              <button className="cv-btn cv-btn-sm" onClick={() => copy(result.assembly, 'asm')}>{copied === 'asm' ? 'Copied!' : 'Copy'}</button>
            </div>
            <pre className="cv-panel-pre">{result.assembly}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

/* ===== SPAWN INGREDIENTS ===== */
function spawnIngredients(character, charNodeId, pos) {
  const nodes = [];
  const edges = [];
  const bx = pos.x + 260;
  const accent = character.accentColor || '#C9A227';

  character.painPoints.forEach((pp, i) => {
    const nid = `pp-${character.id}-${i}`;
    nodes.push({ id: nid, type: 'ingredient', position: { x: bx, y: pos.y - 40 + i * 58 }, data: { label: `Pain Point #${i + 1}`, text: pp, index: i, accent, kind: 'pp' } });
    edges.push({ id: `e-${charNodeId}-${nid}`, source: charNodeId, sourceHandle: 'out', target: nid, targetHandle: 'in', type: 'pulse', data: { color: accent } });
  });

  const hy = pos.y - 40 + character.painPoints.length * 58 + 20;
  character.hooks.forEach((hk, i) => {
    const nid = `hk-${character.id}-${i}`;
    nodes.push({ id: nid, type: 'ingredient', position: { x: bx, y: hy + i * 58 }, data: { label: `Hook #${i + 1}`, text: hk, index: i, accent, kind: 'hk' } });
    edges.push({ id: `e-${charNodeId}-${nid}`, source: charNodeId, sourceHandle: 'out', target: nid, targetHandle: 'in', type: 'pulse', data: { color: accent } });
  });

  return { nodes, edges };
}

/* ===== RESOLVE PIPELINE from edges ===== */
function resolvePipeline(nodes, edges) {
  // Find all edges targeting any generator node (built-in 'gen', dropped generators, or UGC gen)
  const genIds = new Set(nodes.filter((n) => n.type === 'generator' || n.type === 'ugc-gen').map((n) => n.id));
  const genEdges = edges.filter((e) => genIds.has(e.target));
  let character = null, ppIndex = null, hkIndex = null, stId = null, cvId = null;

  // Helper: trace back from an ingredient node to find its parent character
  const findCharacter = (ingredientId) => {
    const ce = edges.find((e2) => e2.target === ingredientId);
    if (ce) { const cn = nodes.find((n) => n.id === ce.source && n.type === 'character'); if (cn) return cn.data.character; }
    return null;
  };

  for (const edge of genEdges) {
    const src = nodes.find((n) => n.id === edge.source);
    if (!src) continue;

    // Auto-detect input type from source node's data (handle-agnostic)
    if (src.data?.kind === 'pp' && ppIndex == null) {
      ppIndex = src.data.index;
      if (!character) character = findCharacter(src.id);
    } else if (src.data?.kind === 'hk' && hkIndex == null) {
      hkIndex = src.data.index;
      if (!character) character = findCharacter(src.id);
    } else if (src.data?.stId != null && stId == null) {
      stId = src.data.stId;
    } else if (src.data?.cvId != null && cvId == null) {
      cvId = src.data.cvId;
    }
  }

  const selections = { painPoint: ppIndex, hook: hkIndex, scriptType: stId, conversionLevel: cvId, trigger: null, ctaMechanism: null };
  const count = [ppIndex, hkIndex, stId, cvId].filter((v) => v != null).length;
  return { character, selections, count };
}

/* ===== API SETTINGS FLOATING PANEL ===== */
const API_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'];

function ApiPanel({ apiKey, model, onKeyChange, onModelChange }) {
  const [open, setOpen] = useState(false);
  const [show, setShow] = useState(false);
  const [tunnelStatus, setTunnelStatus] = useState({ active: false, url: '', loading: false, error: '' });
  const connected = !!apiKey;

  // Check tunnel status on mount
  useEffect(() => {
    fetch('http://localhost:3001/api/tunnel/status').then(r => r.json())
      .then(data => setTunnelStatus(prev => ({ ...prev, active: data.active, url: data.url || '' })))
      .catch(() => {});
  }, []);

  const toggleTunnel = async () => {
    if (tunnelStatus.active) {
      setTunnelStatus(prev => ({ ...prev, loading: true }));
      try {
        await fetch('http://localhost:3001/api/tunnel/stop', { method: 'POST' });
        setTunnelStatus({ active: false, url: '', loading: false, error: '' });
      } catch (err) { setTunnelStatus(prev => ({ ...prev, loading: false, error: err.message })); }
    } else {
      setTunnelStatus(prev => ({ ...prev, loading: true, error: '' }));
      try {
        const res = await fetch('http://localhost:3001/api/tunnel/start', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        setTunnelStatus({ active: true, url: data.url, loading: false, error: '' });
      } catch (err) { setTunnelStatus(prev => ({ ...prev, loading: false, error: err.message })); }
    }
  };

  return (
    <div className="cv-api-panel">
      <button className="cv-api-toggle" onClick={() => setOpen(!open)}>
        <span className={`cv-api-dot ${connected ? 'connected' : ''}`} />
        <span>{connected ? 'API Connected' : 'API Key Required'}</span>
        {tunnelStatus.active && <span className="cv-tunnel-badge">TUNNEL</span>}
      </button>
      {open && (
        <div className="cv-api-body">
          <label className="cv-api-label">
            Anthropic API Key
            <div className="cv-api-input-row">
              <input
                type={show ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => onKeyChange(e.target.value)}
                placeholder="sk-ant-..."
                className="cv-api-input"
              />
              <button className="cv-btn cv-btn-sm" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
            </div>
          </label>
          <label className="cv-api-label">
            Model
            <select value={model} onChange={(e) => onModelChange(e.target.value)} className="cv-api-select">
              {API_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <div className="cv-tunnel-section">
            <div className="cv-tunnel-row">
              <span className={`cv-api-dot ${tunnelStatus.active ? 'connected' : ''}`} />
              <span className="cv-tunnel-label">{tunnelStatus.active ? 'Tunnel Active' : 'Tunnel Off'}</span>
              <button className="cv-btn cv-btn-sm cv-tunnel-btn" onClick={toggleTunnel} disabled={tunnelStatus.loading}>
                {tunnelStatus.loading ? 'Starting...' : tunnelStatus.active ? 'Stop' : 'Start Tunnel'}
              </button>
            </div>
            {tunnelStatus.url && (
              <div className="cv-tunnel-url" title={tunnelStatus.url}>
                {tunnelStatus.url.replace('https://', '')}
              </div>
            )}
            {tunnelStatus.error && <div className="cv-tunnel-error">{tunnelStatus.error}</div>}
            {!tunnelStatus.active && !tunnelStatus.loading && (
              <div className="cv-tunnel-hint">Serves local images to Kling without uploading</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ===== CANVAS PERSISTENCE ===== */
const CANVAS_KEY = 'breadstick-canvas-layout';
const CANVAS_VERSION = 5; // Bump when persistence structure changes. v5 = full nodes/edges/nodeOutputs (was v4: positions only).
// In-flight statuses don't survive reloads — scrubEphemeralOutputs (./persistence.js)
// drops them on save AND on restore so a node that was rendering when the tab
// closed shows idle next time instead of a permanently disabled button.

// First-run onboarding gate. Bumped when the modal copy or templates change
// significantly enough that returning operators benefit from seeing it again.
const ONBOARDING_KEY = 'breadstick-onboarded-v1';

// Canvas templates — pre-positioned node sets that drop onto the canvas when
// an operator picks a starting point on first run. Wiring is intentionally
// left manual: connecting nodes is core to the canvas mental model and the
// "drag from this dot to that dot" gesture is faster to internalize than to
// explain. Templates pre-position so the operator sees a clean left-to-right
// layout that suggests the flow.
const CANVAS_TEMPLATES = [
  {
    id: 'topic-to-carousel',
    title: 'Topic → Carousel',
    icon: '▤',
    desc: 'Type a topic. Get a script. Render branded slides.',
    pipeline: 'Niche Script Gen → 16-GAMI Art → Carousel',
    nodes: [
      { type: 'niche-gen', position: { x: 320, y: 220 } },
      { type: 'gami-art',  position: { x: 720, y: 220 } },
      { type: 'carousel',  position: { x: 1120, y: 220 } },
    ],
  },
  {
    id: 'pov-caption',
    title: 'POV Clip → Caption',
    icon: '▷',
    desc: 'Drop a clip. Burn an animated hook caption.',
    pipeline: 'Hyperframes (Hook Caption)',
    nodes: [
      { type: 'hyperframes', position: { x: 600, y: 250 } },
    ],
  },
  {
    id: 'pixel-prompts',
    title: 'Pixel-Art Prompts',
    icon: '◾',
    desc: 'Generate Midjourney prompts for retro game assets.',
    pipeline: 'Pixel Forge (3 variations)',
    nodes: [
      { type: 'pixel-forge', position: { x: 600, y: 250 } },
    ],
  },
];

/* ===== 16-GAMI PROMPT NODE ===== */
const GAMI_AGENTS = [
  { id: 'oracle', name: 'Oracle', role: 'Judge', color: '#ffff00',
    apparel: 'Ceremonial robes made of blue textured paper with jagged simulated pixelated fold lines and beige folded paper texture. High-collared.',
    held: 'Left pixelated clawed hand grips a 3D paper abacus made of beige textured paper and gold textured paper beads. Right hand holds glowing scales of justice as a separate pixelated paper sculpture on a multi-part paper arm.',
    head: 'dark grey sleek pixel-style face mask with glowing yellow visor pixel eyes',
    env: { setting: 'ancient data temple with towering paper circuit-board columns', floor: 'gridded paper tiles with faint glowing pixel runes', atmo: 'dim and reverent, illuminated by the character\'s visor glow and scales' },
    prop: { obj: 'stone evidence pedestal', place: 'foreground-left', detail: 'made of dark grey layered cardstock with glowing cyan pixel inscriptions on its face' },
  },
  { id: 'architect', name: 'Architect', role: 'Prosecution', color: '#00ff88',
    apparel: 'Tactical scout\'s trench coat made of olive green textured paper stock with jagged simulated pixelated fold lines and dark grey folded paper texture. High-collared.',
    held: 'Left pixelated clawed hand grips a 3D paper magnifying glass with black and silver layered paper frame and curved clear plastic insert. Right hand has rolled-up blueprints of glowing blue paper with etched white pixelated schema patterns tucked under arm.',
    head: 'dark grey sleek pixel-style face mask with glowing yellow visor pixel eyes',
    env: { setting: 'cyber-forensics war room with paper holographic displays and data walls', floor: 'dark metallic gridded paper with faint green scan-line glow', atmo: 'focused and tactical, lit by blue blueprint glow and magnifying glass reflection' },
    prop: { obj: 'evidence analysis terminal', place: 'foreground-right', detail: 'made of dark cardstock frame with a cyan-glowing paper screen showing data readouts' },
  },
  { id: 'skeptic', name: 'Skeptic', role: 'Defense', color: '#00ccff',
    apparel: 'Heavy bulky Paladin armor made of gunmetal grey layered cardstock simulating burnished metal and steel grey geometric fold lines with stair-stepped pixelated contours. High-collared.',
    held: 'Left pixelated clawed hand plants a massive iron tower shield firmly on the ground, made of simulated riveted iron plates with 3D stair-stepped paper edges. At the utility belt, a glowing green Evidence Crystal made of layered green and translucent paper with blocky pixel shapes.',
    head: 'dark grey sleek pixel-style face mask with visor pulled down and narrow glowing yellow visor pixel eyes',
    env: { setting: 'fortified paper bunker with layered cardstock blast walls and barricades', floor: 'cracked stone-grey paper tiles with scattered evidence fragments', atmo: 'defiant and guarded, lit by the green glow of an evidence crystal' },
    prop: { obj: 'rejected evidence pile', place: 'foreground-left', detail: 'crumpled red-stamped paper documents and broken pixel data shards scattered at the base of the shield' },
  },
];

const GAMI_STYLE = 'Stair-stepped pixelated aesthetic merged with traditional origami folds. Multi-layered 3D cardstock construction. Soft directional lighting creating distinct drop shadows between physical paper layers. Hyper-realistic tangible texture contrasted with digital abstraction. 16-bit jagged physics reinforced by fold geometry.';

function buildGamiPrompt(agent, els) {
  const parts = ['High-resolution product photograph of a physical, multi-layered cut paper and origami sculpture. Angled macro-level perspective with shallow depth of field emphasizing paper textures and cardstock grain.'];
  if (els.scene) {
    const intro = els.character ? 'The scene depicts a Cyber-Automaton robot standing inside' : 'The scene is set inside';
    parts.push(`${intro} a ${agent.env.setting}. The floor is ${agent.env.floor}. The atmosphere is ${agent.env.atmo}.`);
  }
  if (els.character) parts.push(`The character has a ${agent.head}. ${agent.apparel} ${agent.held}`);
  if (els.prop) parts.push(`In the ${agent.prop.place} sits a ${agent.prop.obj}, ${agent.prop.detail}.`);
  if (!els.scene) parts.push('Pure white solid background optimized for masking.');
  parts.push(GAMI_STYLE);
  return parts.join('\n\n');
}

function GamiNode({ id }) {
  const { gamiResult, onGamiGenerate } = useContext(CanvasCtx);
  const [agentId, setAgentId] = useState(null);
  const [els, setEls] = useState({ scene: true, character: true, prop: true });
  const [copied, setCopied] = useState(false);
  const [resolution, setResolution] = useState('2K');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('kie-api-key') || '');
  const [showKey, setShowKey] = useState(false);

  const saveKey = (v) => { setApiKey(v); localStorage.setItem('kie-api-key', v); };

  const agent = GAMI_AGENTS.find(a => a.id === agentId);
  const anyEl = els.scene || els.character || els.prop;
  const prompt = agent && anyEl ? buildGamiPrompt(agent, els) : '';
  const elCount = [els.scene, els.character, els.prop].filter(Boolean).length;

  const status = gamiResult?.status || 'idle';
  const elapsed = gamiResult?.elapsed || 0;
  const imageUrl = gamiResult?.url || '';
  const statusColors = { idle: '#555', submitting: '#C9A227', polling: '#e85d75', done: '#00FFFF', error: '#e74c3c' };
  const statusLabels = { idle: 'Ready', submitting: 'Submitting...', polling: `Generating (${elapsed}s)`, done: 'Complete', error: gamiResult?.error || 'Failed' };

  const copy = async () => {
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const [urlCopied, setUrlCopied] = useState(false);
  const copyUrl = async () => { if (imageUrl) { await navigator.clipboard.writeText(imageUrl).catch(() => {}); setUrlCopied(true); setTimeout(() => setUrlCopied(false), 1500); } };

  return (
    <div className="cv-node cv-gami" style={{ '--gami-status': statusColors[status] }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="in" />

      <div className="cv-gami-header">
        <span className="cv-gami-diamond">◆</span>
        <span className="cv-gami-title">16-GAMI ARES</span>
        <span className="cv-gami-badge">Nano Banana</span>
      </div>

      {/* Agent selector */}
      <div className="cv-gami-agents">
        {GAMI_AGENTS.map(a => (
          <button key={a.id}
            className={`cv-gami-agent ${agentId === a.id ? 'active' : ''}`}
            style={{ '--agent-c': a.color }}
            onClick={(e) => { e.stopPropagation(); setAgentId(agentId === a.id ? null : a.id); }}
          >
            <span className="cv-gami-agent-dot" />
            <span>{a.name}</span>
          </button>
        ))}
      </div>

      {/* Element toggles */}
      {agent && (
        <div className="cv-gami-elements">
          {[['scene', '◻', 'Scene'], ['character', '◈', 'Character'], ['prop', '◇', 'Prop']].map(([key, icon, label]) => (
            <button key={key}
              className={`cv-gami-el ${els[key] ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setEls(prev => ({ ...prev, [key]: !prev[key] })); }}
            >
              <span>{icon}</span>
              <span>{label}</span>
            </button>
          ))}
          <span className="cv-gami-el-count">{elCount}/3</span>
        </div>
      )}

      {/* Controls: resolution + API key */}
      {prompt && (
        <div className="cv-gami-controls">
          <select className="cv-blotato-select" value={resolution} onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); setResolution(e.target.value); }}>
            <option value="1K">1K</option><option value="2K">2K</option><option value="4K">4K</option>
          </select>
          <select className="cv-blotato-select" value={aspectRatio} onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); setAspectRatio(e.target.value); }}>
            <option value="1:1">1:1</option><option value="3:2">3:2</option><option value="4:3">4:3</option>
            <option value="16:9">16:9</option><option value="9:16">9:16</option><option value="3:4">3:4</option>
          </select>
        </div>
      )}

      <div className="cv-blotato-field">
        <input className="cv-blotato-input" type={showKey ? 'text' : 'password'} placeholder="KIE API Key"
          value={apiKey} onClick={(e) => e.stopPropagation()} onChange={(e) => saveKey(e.target.value)} />
        <button className="cv-btn cv-btn-sm" title={showKey ? 'Hide key' : 'Show key'}
          onClick={(e) => { e.stopPropagation(); setShowKey(!showKey); }}>{showKey ? '◉' : '○'}</button>
      </div>

      {/* Prompt preview + copy */}
      {prompt && (
        <div className="cv-gami-output">
          <div className="cv-gami-preview">{prompt.slice(0, 120)}...</div>
          <button className="cv-btn cv-btn-sm" onClick={(e) => { e.stopPropagation(); copy(); }}>
            {copied ? 'Copied!' : 'Copy Prompt'}
          </button>
        </div>
      )}

      {/* Generation status */}
      {status !== 'idle' && (
        <div className="cv-gami-status" style={{ color: statusColors[status] }}>{statusLabels[status]}</div>
      )}

      {/* Result image */}
      {imageUrl && (
        <div className="cv-gami-result">
          <img src={imageUrl} alt="16-gami result" className="cv-gami-thumb" onClick={(e) => { e.stopPropagation(); window.open(imageUrl, '_blank'); }} />
          <button className="cv-btn cv-btn-sm" onClick={(e) => { e.stopPropagation(); copyUrl(); }}>
            {urlCopied ? 'Copied!' : 'Copy URL'}
          </button>
        </div>
      )}

      {/* Generate button */}
      <button className="cv-btn cv-btn-gami"
        disabled={!prompt || !apiKey || status === 'submitting' || status === 'polling'}
        onClick={(e) => { e.stopPropagation(); onGamiGenerate(apiKey, prompt, resolution, aspectRatio); }}>
        {status === 'polling' ? 'Generating...' : status === 'done' ? 'Regenerate' : 'Generate Image'}
      </button>

      <Handle type="source" position={Position.Right} id="out" />
    </div>
  );
}

/* ===== NICHE SCRIPT GENERATOR NODE ===== */
const NICHE_TONES = [
  { id: 'educational', label: 'Educational', desc: 'Teach and inform' },
  { id: 'dramatic', label: 'Dramatic', desc: 'Tension and stakes' },
  { id: 'inspirational', label: 'Inspirational', desc: 'Hope and vision' },
  { id: 'analytical', label: 'Analytical', desc: 'Data and insight' },
  { id: 'narrative', label: 'Narrative', desc: 'Story-driven' },
];

const NICHE_LENGTHS = [
  { id: 'test', label: 'Test', slides: '1', words: '20-35' },
  { id: 'short', label: 'Short', slides: '4-6', words: '100-160' },
  { id: 'medium', label: 'Medium', slides: '8-10', words: '180-260' },
  { id: 'long', label: 'Long', slides: '12-15', words: '280-400' },
];

function NicheGenNode({ id, data }) {
  const { nodeOutputs, edges, onNicheGenerate, anthropicApiKey, anthropicModel, syncNodeData } = useContext(CanvasCtx);
  // Initialize from node.data — syncNodeData mirrors these fields there, a
  // restored canvas must show the same values the engine executors will read,
  // and a Conductor-composed node shows its pre-filled config.
  const [topic, setTopic] = useState(() => data?.topic || '');
  const [tone, setTone] = useState(() => data?.tone || 'educational');
  const [length, setLength] = useState(() => data?.length || 'medium');
  const [researchLive, setResearchLive] = useState(() => !!data?.researchLive);
  const [copied, setCopied] = useState(false);
  // Recipe shape — when set, the generator swaps its carousel-storytelling
  // system prompt for the recipe's shortform scriptShape (Skyframe 5-beat
  // Ray-Ban POV). Length/tone still apply as style hints; structure is owned
  // by the recipe.
  const [recipeId, setRecipeId] = useState('');

  // Check for scraper input wired to the left
  const scraperInput = useMemo(() => {
    const inEdge = edges?.find(e => e.target === id);
    if (!inEdge) return null;
    return nodeOutputs?.[inEdge.source]?.script || nodeOutputs?.[inEdge.source]?.content || null;
  }, [edges, id, nodeOutputs]);

  const result = nodeOutputs?.[id] || { status: 'idle' };
  const status = result.status || 'idle';
  const scriptText = result.script || '';
  const hasApiKey = !!anthropicApiKey;
  const hasTopic = !!(topic.trim() || scraperInput);

  const statusColors = { idle: '#555', generating: '#e85d75', done: '#00FFFF', error: '#e74c3c' };

  const copyScript = async () => {
    if (!scriptText) return;
    await navigator.clipboard.writeText(scriptText).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const lengthInfo = NICHE_LENGTHS.find(l => l.id === length);

  return (
    <div className={`cv-node cv-niche-gen cv-niche-gen-${status}`} style={{ '--status-color': statusColors[status] }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="scraper-in" />

      <div className="cv-niche-header">
        <div className="cv-niche-dot" />
        <span className="cv-niche-title">Script Generator</span>
        <span className="cv-niche-badge">Niche</span>
      </div>

      {/* Topic input */}
      <div className="cv-niche-field">
        <textarea className="cv-niche-topic" placeholder={scraperInput ? 'Using wired input...' : 'Enter topic or niche...'}
          value={scraperInput ? '' : topic} disabled={!!scraperInput}
          onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => { setTopic(e.target.value); syncNodeData(id, { topic: e.target.value }); }} rows={2} />
      </div>

      {scraperInput && (
        <div className="cv-niche-wired">Wired: {scraperInput.substring(0, 50)}...</div>
      )}

      {/* Tone selector */}
      <div className="cv-niche-tones">
        {NICHE_TONES.map(t => (
          <button key={t.id} className={`cv-niche-tone ${tone === t.id ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setTone(t.id); syncNodeData(id, { tone: t.id }); }} title={t.desc}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Length selector */}
      <div className="cv-niche-lengths">
        {NICHE_LENGTHS.map(l => (
          <button key={l.id} className={`cv-niche-length ${length === l.id ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setLength(l.id); syncNodeData(id, { length: l.id }); }}>
            {l.label}
          </button>
        ))}
        <span className="cv-niche-length-info">{lengthInfo.slides} slides / {lengthInfo.words} words</span>
      </div>

      {/* Live research toggle — grounds script via Anthropic web_search tool */}
      <div className="cv-niche-research-row">
        <button
          className={`cv-niche-research ${researchLive ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setResearchLive(!researchLive); syncNodeData(id, { researchLive: !researchLive }); }}
          title="Use Anthropic web search to ground the script in current sources. Best for time-sensitive topics. Adds search tokens to the bill.">
          Research live (web)
        </button>
        {researchLive && <span className="cv-niche-research-info">Grounded by live search</span>}
      </div>

      {/* Recipe shape — pick a Skyframe recipe and the script comes out
          shaped to fit its beat structure (Ray-Ban POV shortform). Overrides
          the default carousel framing. */}
      <div className="cv-niche-research-row" onClick={(e) => e.stopPropagation()}>
        <select
          className="cv-recipe-select nodrag"
          value={recipeId}
          onChange={(e) => { e.stopPropagation(); setRecipeId(e.target.value); }}
          style={{ minWidth: 220, fontSize: 11 }}
          title="Set a recipe shape and the script comes out tuned for that template (overrides carousel framing)"
        >
          <option value="">📋 Recipe shape — none (carousel)</option>
          {RECIPES.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        {recipeId && <span className="cv-niche-research-info">→ Ray-Ban POV shortform</span>}
      </div>

      {/* Status + error */}
      {result.error && <div className="cv-niche-error">{result.error}</div>}

      {/* Script preview */}
      {scriptText && (
        <div className="cv-niche-output">
          <div className="cv-niche-preview">{scriptText.substring(0, 120)}...</div>
          <button className="cv-btn cv-btn-sm" onClick={(e) => { e.stopPropagation(); copyScript(); }}>
            {copied ? 'Copied!' : 'Copy Script'}
          </button>
        </div>
      )}

      {/* Generate */}
      <button className="cv-btn cv-btn-niche-gen"
        disabled={!hasTopic || !hasApiKey || status === 'generating'}
        onClick={(e) => { e.stopPropagation(); onNicheGenerate(id, scraperInput || topic.trim(), tone, length, researchLive, recipeId || null); }}>
        {status === 'generating' ? 'Generating...' : status === 'done' ? 'Regenerate' : 'Generate Script'}
      </button>
      {!hasApiKey && <div className="cv-niche-hint">Set Anthropic API key in the API panel</div>}

      <Handle type="source" position={Position.Right} id="script-out" />
    </div>
  );
}

/* ===== ARES SCRIPT GEN — corpus-aware scripts about a project ===== */
//
// Specialized script generator that runs against the ARES narrative corpus
// (Beat Sheet + Timeline + technical synthesis + first-person persona). The
// Beat Sheet is 14 named beats with built-in framing — this node lets the
// operator pick a preset arc (or custom beat selection), choose framing
// (failure-as-feature is the default angle you named as resonating most),
// and pick a length. Output shape matches NicheScriptGen so downstream
// Motion Bake / Cartesian / Carousel consumers wire up unchanged.

const ARES_BEATS = [
  { n: 1,  label: 'The Spark' },
  { n: 2,  label: 'The Failure' },
  { n: 3,  label: 'The Rebuild (ARES Born)' },
  { n: 4,  label: 'The Arena' },
  { n: 5,  label: 'The Closed World' },
  { n: 6,  label: 'The Experiment' },
  { n: 7,  label: 'The Discovery (Negative Finding)' },
  { n: 8,  label: 'The Mechanism (Why Debate Fails)' },
  { n: 9,  label: 'The Convergence' },
  { n: 10, label: 'The Pivot (Single-Turn)' },
  { n: 11, label: 'The Breakthrough (Kill Chain)' },
  { n: 12, label: 'The Vision (ARES-VISION)' },
  { n: 13, label: 'Where It Stands' },
  { n: 14, label: 'The North Star' },
];

// Preset arcs — pre-selected beat combos for the most useful narrative shapes.
// "Custom" is the escape hatch: when picked, the per-beat checkboxes appear.
const ARES_ARC_PRESETS = [
  { id: 'failure-vindication', label: 'Failure → Vindication',  beats: [2, 3, 7, 9],     hint: 'Setback → Rebuild → Negative finding → convergence' },
  { id: 'pivot-story',         label: 'The Pivot Story',         beats: [7, 8, 10, 11],   hint: 'Discovery → Mechanism → Pivot → Breakthrough' },
  { id: 'curiosity-discipline', label: 'Curiosity → Discipline', beats: [1, 6, 7, 14],    hint: 'Spark → Experiment → Discovery → North Star' },
  { id: 'discovery-vision',    label: 'Discovery + Vision',      beats: [7, 9, 12],       hint: 'Negative finding → Convergence → ARES-VISION beauty shot' },
  { id: 'full-arc',            label: 'Full Arc',                beats: [1,2,3,4,5,6,7,8,9,10,11,12,13,14], hint: 'All 14 beats — only for longform' },
  { id: 'custom',              label: 'Custom (pick beats)',     beats: [],               hint: 'Manual beat selection below' },
];

const ARES_FRAMINGS = [
  { id: 'failure-as-feature', label: 'failure-as-feature',  hint: 'Default. Lead with the failure, the discovery IS the contribution. Builder-talking-to-builders energy.' },
  { id: 'research',            label: 'research credibility', hint: 'Methodology + finding + independent corroboration. Peer-review-adjacent register. LinkedIn / academic Substack.' },
  { id: 'first-person',        label: 'first-person ARES',    hint: 'ARES speaks. Voice from the Maestro persona. Warmth + builder gravitas. Voiceover-ready.' },
];

const ARES_LENGTHS = [
  { id: 'shortform', label: 'shortform · ~60s',   hint: '120-160 words, 1-3 beats. POV / Reels / TikTok.' },
  { id: 'medium',    label: 'medium · ~90-120s',  hint: '220-300 words, 3-5 beats. YouTube short / longer Reel.' },
  { id: 'longform',  label: 'longform · ~5-10min', hint: '650-1200 words, 6+ beats. Long-form YouTube / Substack post.' },
];

// Carousel-mode lengths — mirror NICHE_LENGTHS so slide-chunked output flows
// straight into 16-GAMI Art / Image-2 / Carousel without changing those nodes.
const ARES_CAROUSEL_LENGTHS = [
  { id: 'test',   label: 'test',   slides: '1',     words: '20-35',   hint: '1-slide smoke test' },
  { id: 'short',  label: 'short',  slides: '4-6',   words: '100-160', hint: '4-6 slides, hook + arc + CTA' },
  { id: 'medium', label: 'medium', slides: '8-10',  words: '180-260', hint: '8-10 slides, more breathing room' },
  { id: 'long',   label: 'long',   slides: '12-15', words: '280-400', hint: '12-15 slides, full-arc carousel' },
];

function ARESScriptGenNode({ id }) {
  const { nodeOutputs, onAresGenerate } = useContext(CanvasCtx);
  const [framing, setFraming] = useState('failure-as-feature');
  const [length, setLength] = useState('shortform');
  const [format, setFormat] = useState('prose');                  // 'prose' | 'carousel'
  const [carouselLength, setCarouselLength] = useState('short');  // matches NICHE_LENGTHS ids
  const [presetId, setPresetId] = useState('failure-vindication');
  const [customBeats, setCustomBeats] = useState(new Set([2, 3, 7, 9]));
  const [customNote, setCustomNote] = useState('');
  const [previewOpen, setPreviewOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  // Resolve effective beat list. Preset always wins unless 'custom' is chosen.
  const effectiveBeats = (() => {
    if (presetId === 'custom') return Array.from(customBeats).sort((a, b) => a - b);
    const preset = ARES_ARC_PRESETS.find(p => p.id === presetId);
    return preset ? preset.beats : [];
  })();

  const result = nodeOutputs?.[id] || {};
  const status = result.status || 'idle';
  const scriptText = result.script || '';
  const wordCount = result.wordCount || (scriptText ? scriptText.split(/\s+/).filter(Boolean).length : 0);
  const error = result.error || '';

  const isGenerating = status === 'generating';
  const canGenerate = effectiveBeats.length > 0 && !isGenerating;

  const statusColors = { idle: '#555', ready: '#6366f1', generating: '#e85d75', done: '#00FFFF', error: '#e74c3c' };
  const effectiveStatus = isGenerating ? 'generating' : scriptText ? 'done' : error ? 'error' : canGenerate ? 'ready' : 'idle';
  const dotColor = statusColors[effectiveStatus];

  const toggleBeat = (n) => {
    setCustomBeats(prev => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n); else next.add(n);
      return next;
    });
  };

  const copyScript = async () => {
    if (!scriptText) return;
    await navigator.clipboard.writeText(scriptText).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const presetHint = ARES_ARC_PRESETS.find(p => p.id === presetId)?.hint || '';
  const framingHint = ARES_FRAMINGS.find(f => f.id === framing)?.hint || '';
  const lengthHint = ARES_LENGTHS.find(l => l.id === length)?.hint || '';
  const carouselLengthInfo = ARES_CAROUSEL_LENGTHS.find(l => l.id === carouselLength) || ARES_CAROUSEL_LENGTHS[1];

  return (
    <div className="cv-node cv-ares-gen nowheel" style={{ '--status-color': dotColor, '--node-accent': '#6366f1' }}>
      <NodeDeleteBtn nodeId={id} />

      <div className="cv-ares-gen-header">
        <div className="cv-ares-gen-dot" />
        <span className="cv-ares-gen-title">ARES Script Gen</span>
        <span className="cv-ares-gen-badge">{effectiveBeats.length} beat{effectiveBeats.length === 1 ? '' : 's'}</span>
      </div>

      <div className="cv-ares-gen-row">
        <label title={framingHint}>framing</label>
        <select
          className="cv-ares-gen-input nodrag"
          value={framing}
          onChange={(e) => { e.stopPropagation(); setFraming(e.target.value); }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {ARES_FRAMINGS.map(f => <option key={f.id} value={f.id} title={f.hint}>{f.label}</option>)}
        </select>
      </div>

      {/* Format toggle — prose (default narrative) vs carousel (slide-chunked, wires
          straight into 16-GAMI Art / Image-2 / Carousel without a translation step). */}
      <div className="cv-ares-gen-row">
        <label title="prose = flowing narrative. carousel = slide-numbered output that 16-GAMI Art / Image-2 / Carousel can consume directly.">format</label>
        <div className="cv-ares-gen-format-toggle">
          <button
            type="button"
            className={`cv-ares-gen-format-btn nodrag ${format === 'prose' ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setFormat('prose'); }}
            onMouseDown={(e) => e.stopPropagation()}
            title="Flowing narrative output. Good for voiceover, longform articles, and Motion Bake."
          >
            prose
          </button>
          <button
            type="button"
            className={`cv-ares-gen-format-btn nodrag ${format === 'carousel' ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setFormat('carousel'); }}
            onMouseDown={(e) => e.stopPropagation()}
            title="Slide-numbered output. Wires straight into 16-GAMI Art / Image-2 / Carousel for visual storytelling."
          >
            carousel
          </button>
        </div>
      </div>

      {format === 'prose' ? (
        <div className="cv-ares-gen-row">
          <label title={lengthHint}>length</label>
          <select
            className="cv-ares-gen-input nodrag"
            value={length}
            onChange={(e) => { e.stopPropagation(); setLength(e.target.value); }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {ARES_LENGTHS.map(l => <option key={l.id} value={l.id} title={l.hint}>{l.label}</option>)}
          </select>
        </div>
      ) : (
        <div className="cv-ares-gen-row">
          <label title={`Slide budget: ${carouselLengthInfo.slides} slides / ${carouselLengthInfo.words} words`}>slides</label>
          <select
            className="cv-ares-gen-input nodrag"
            value={carouselLength}
            onChange={(e) => { e.stopPropagation(); setCarouselLength(e.target.value); }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {ARES_CAROUSEL_LENGTHS.map(l => (
              <option key={l.id} value={l.id} title={l.hint}>
                {l.label} · {l.slides} slides
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="cv-ares-gen-row">
        <label title={presetHint}>arc</label>
        <select
          className="cv-ares-gen-input nodrag"
          value={presetId}
          onChange={(e) => { e.stopPropagation(); setPresetId(e.target.value); }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {ARES_ARC_PRESETS.map(p => <option key={p.id} value={p.id} title={p.hint}>{p.label}</option>)}
        </select>
      </div>

      {presetId !== 'custom' && presetHint && (
        <div className="cv-ares-gen-hint">{presetHint}</div>
      )}

      {presetId === 'custom' && (
        <div className="cv-ares-gen-beats">
          {ARES_BEATS.map(b => (
            <label
              key={b.n}
              className={`cv-ares-gen-beat ${customBeats.has(b.n) ? 'on' : ''}`}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                className="nodrag"
                checked={customBeats.has(b.n)}
                onChange={(e) => { e.stopPropagation(); toggleBeat(b.n); }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              />
              <span className="cv-ares-gen-beat-num">#{b.n}</span>
              <span className="cv-ares-gen-beat-label">{b.label}</span>
            </label>
          ))}
        </div>
      )}

      <textarea
        className="cv-ares-gen-note nodrag"
        placeholder="Optional: operator hint (e.g. 'lean into the AKIRA aesthetic angle' or 'tie this to the open-source release')"
        value={customNote}
        onChange={(e) => { e.stopPropagation(); setCustomNote(e.target.value); }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        rows={2}
      />

      <button
        className="cv-btn cv-btn-ares-gen"
        disabled={!canGenerate}
        onClick={(e) => {
          e.stopPropagation();
          onAresGenerate(id, {
            beats: effectiveBeats,
            framing,
            length: format === 'carousel' ? carouselLength : length,
            format,
            customNote,
          });
        }}
      >
        {isGenerating ? 'Generating…' : scriptText ? 'Regenerate' : `Generate ARES ${format === 'carousel' ? 'carousel' : 'script'}`}
      </button>

      {scriptText && (
        <>
          <div className="cv-ares-gen-meta">
            <span>{wordCount} words</span>
            <span>·</span>
            <span>{framing}</span>
            <span>·</span>
            <span>{result.length || (format === 'carousel' ? carouselLength : length)}</span>
            <span>·</span>
            <span>{result.format || format}</span>
            <button
              className="cv-ares-gen-copy"
              onClick={(e) => { e.stopPropagation(); copyScript(); }}
            >
              {copied ? 'copied!' : 'copy'}
            </button>
            <button
              className="cv-ares-gen-toggle"
              onClick={(e) => { e.stopPropagation(); setPreviewOpen(v => !v); }}
            >
              {previewOpen ? '▾ hide' : '▸ show'}
            </button>
          </div>
          {previewOpen && (
            <div className="cv-ares-gen-preview">{scriptText}</div>
          )}
        </>
      )}

      {error && <div className="cv-ares-gen-error">{error}</div>}

      <Handle type="source" position={Position.Right} id="script-out" />
    </div>
  );
}

/* ===== SCRIPT GEN (UGC) NODE — AI influencer scripts from character ingredients ===== */
function UgcGenNode({ id }) {
  // Uses the SAME pipeline resolver + onGenerate as the "G" Script Generator
  const { pipeline, onGenerate, onCopyPrompt, nodeOutputs, script } = useContext(CanvasCtx);
  const { count, status: pipelineStatus, charName, error: pipelineError } = pipeline;

  // Read from nodeOutputs (written by onGenerate when called with our id)
  const result = nodeOutputs?.[id] || {};
  const scriptText = result.script || script || '';
  const resultStatus = result.status;

  // Merge pipeline status with our result status
  const isGenerating = pipelineStatus === 'generating' || resultStatus === 'generating';
  const isDone = resultStatus === 'done' || pipelineStatus === 'done';
  const canGenerate = count === 4;

  const statusColors = { idle: '#555', ready: '#e0922f', generating: '#e85d75', done: '#00FFFF', error: '#e74c3c' };
  const effectiveStatus = isGenerating ? 'generating' : isDone ? 'done' : canGenerate ? 'ready' : 'idle';

  const [copied, setCopied] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const copyScript = async () => {
    if (!scriptText) return;
    await navigator.clipboard.writeText(scriptText).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const handleCopyPrompt = async () => {
    onCopyPrompt();
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 1500);
  };

  return (
    <div className={`cv-node cv-ugc-gen cv-ugc-gen-${effectiveStatus}`} style={{ '--status-color': statusColors[effectiveStatus] || '#555', '--node-accent': '#e0922f' }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="pp" style={{ top: '15%' }} />
      <Handle type="target" position={Position.Left} id="hk" style={{ top: '35%' }} />
      <Handle type="target" position={Position.Left} id="st" style={{ top: '65%' }} />
      <Handle type="target" position={Position.Left} id="cv" style={{ top: '85%' }} />

      <div className="cv-ugc-header">
        <div className="cv-ugc-dot" />
        <span className="cv-ugc-title">Script Generator</span>
        <span className="cv-ugc-badge">UGC</span>
      </div>

      {charName && <div className="cv-ugc-character">{charName}</div>}
      <div className="cv-ugc-count">{count}/4 inputs</div>

      {/* Input indicators */}
      <div className="cv-carousel-inputs">
        <div className="cv-carousel-input-row">
          <span className={`cv-carousel-input-dot ${pipeline.count >= 1 ? 'active' : ''}`} />
          <span>Pain Point</span>
        </div>
        <div className="cv-carousel-input-row">
          <span className={`cv-carousel-input-dot ${pipeline.count >= 2 ? 'active' : ''}`} />
          <span>Hook</span>
        </div>
        <div className="cv-carousel-input-row">
          <span className={`cv-carousel-input-dot ${pipeline.count >= 3 ? 'active' : ''}`} />
          <span>Script Type</span>
        </div>
        <div className="cv-carousel-input-row">
          <span className={`cv-carousel-input-dot ${pipeline.count >= 4 ? 'active' : ''}`} />
          <span>Conversion Level</span>
        </div>
      </div>

      {(pipelineError || result.error) && <div className="cv-niche-error">{pipelineError || result.error}</div>}

      {scriptText && (
        <div className="cv-niche-output">
          <div className="cv-niche-preview">{scriptText.substring(0, 120)}...</div>
          <button className="cv-btn cv-btn-sm" onClick={(e) => { e.stopPropagation(); copyScript(); }}>
            {copied ? 'Copied!' : 'Copy Script'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, padding: '6px 12px 10px' }}>
        <button className="cv-btn cv-btn-ugc-gen" style={{ flex: 1 }}
          disabled={!canGenerate || isGenerating}
          onClick={(e) => { e.stopPropagation(); onGenerate(id); }}>
          {isGenerating ? 'Generating...' : isDone ? 'Regenerate' : 'Generate Script'}
        </button>
        <button className="cv-btn cv-btn-sm" style={{ alignSelf: 'center' }}
          disabled={!canGenerate}
          onClick={(e) => { e.stopPropagation(); handleCopyPrompt(); }}>
          {promptCopied ? 'Copied!' : 'Copy Prompt'}
        </button>
      </div>

      <Handle type="source" position={Position.Right} id="script-out" />
    </div>
  );
}

/* ===== AVATAR FRAME NODE — holds avatar reference image for 1st frame ===== */
function AvatarFrameNode({ id }) {
  const { nodeOutputs, onAvatarScanFolder, openFilePicker, syncNodeData } = useContext(CanvasCtx);
  const [folderPath, setFolderPath] = useState(() => localStorage.getItem(`avatar-folder-${id}`) || '');
  const [viewIndex, setViewIndex] = useState(0);
  const [gridOpen, setGridOpen] = useState(false);

  const savePath = (v) => { setFolderPath(v); localStorage.setItem(`avatar-folder-${id}`, v); syncNodeData(id, { folderPath: v }); };

  const result = nodeOutputs?.[id] || {};
  const images = result.images || []; // [{ name, path, url }]
  const scanStatus = result.status || 'idle';

  const safeIndex = Math.min(viewIndex, Math.max(images.length - 1, 0));
  const currentImg = images[safeIndex];

  return (
    <div className="cv-node cv-avatar-frame" style={{ '--status-color': images.length > 0 ? '#1abc9c' : '#555', '--node-accent': '#1abc9c' }}>
      <NodeDeleteBtn nodeId={id} />

      <div className="cv-avatar-header">
        <div className="cv-avatar-dot" />
        <span className="cv-avatar-title">Avatar Frames</span>
        <span className="cv-avatar-badge">{images.length > 0 ? `${images.length} photos` : 'Folder'}</span>
      </div>

      <div className="cv-niche-field" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <input className="cv-niche-topic" style={{ resize: 'none', flex: 1, minWidth: 0 }} type="text"
          placeholder="Folder path (e.g. ./avatars/mychar)"
          value={folderPath} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => savePath(e.target.value)} />
        <button
          className="nodrag"
          onClick={(e) => { e.stopPropagation(); openFilePicker({
            key: 'avatar-folder', label: 'an avatar folder',
            startDir: folderPath || '.',
            exts: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
            pickFolder: true,
          }, (p) => savePath(p)); }}
          onMouseDown={(e) => e.stopPropagation()}
          title="Browse for folder"
          style={{ padding: '6px 9px', fontSize: 13, background: 'var(--bg-card, #1a1a24)', border: '1px solid var(--border, #2a2a35)', borderRadius: 4, cursor: 'pointer' }}
        >📁</button>
      </div>

      <button className="cv-btn cv-btn-avatar-scan"
        disabled={!folderPath.trim() || scanStatus === 'scanning'}
        onClick={(e) => { e.stopPropagation(); syncNodeData(id, { folderPath: folderPath.trim() }); onAvatarScanFolder(id, folderPath.trim()); }}>
        {scanStatus === 'scanning' ? 'Scanning...' : images.length > 0 ? `Rescan (${images.length})` : 'Scan Folder'}
      </button>

      {result.error && <div className="cv-niche-error">{result.error}</div>}

      {/* Thumbnail grid — collapsed by default to avoid loading all images on every render */}
      {images.length > 0 && (
        <button className="cv-gami-viewer-toggle" onClick={(e) => { e.stopPropagation(); setGridOpen(!gridOpen); }}>
          {gridOpen ? 'Hide Photos' : 'View Photos'} ({images.length})
        </button>
      )}

      {gridOpen && images.length > 0 && (
        <div className="cv-avatar-grid">
          {images.map((img, i) => (
            <div key={i} className={`cv-avatar-thumb-wrap ${i === safeIndex ? 'selected' : ''}`}
              onClick={(e) => { e.stopPropagation(); setViewIndex(i); }}>
              <img src={`http://localhost:3001/api/local-image?path=${encodeURIComponent(img.path)}`}
                alt={img.name} className="cv-avatar-thumb" loading="lazy" />
              <div className="cv-avatar-thumb-num">{i + 1}</div>
            </div>
          ))}
        </div>
      )}

      {/* Selected indicator — always visible, no image load */}
      {currentImg && (
        <div className="cv-avatar-selected">
          <span className="cv-avatar-selected-name">{safeIndex + 1}. {currentImg.name}</span>
        </div>
      )}

      <Handle type="source" position={Position.Right} id="frames-out" />
    </div>
  );
}

/* ===== CHARACTER SCENE NODE — generates character in new scenes using reference photos ===== */
function CharacterSceneNode({ id }) {
  const { edges, nodeOutputs, onCharacterSceneGenerate } = useContext(CanvasCtx);
  const [scenePrompt, setScenePrompt] = useState('');
  const [model, setModel] = useState('nano-banana-2');
  const [aspectRatio, setAspectRatio] = useState('9:16');
  const [resolution, setResolution] = useState('2K');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('kie-api-key') || '');
  const [viewIndex, setViewIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const [refIndex, setRefIndex] = useState(0);

  const saveKey = (v) => { setApiKey(v); localStorage.setItem('kie-api-key', v); };

  // Trace avatar reference images from connected Avatar Frame
  let refImages = [];
  for (const edge of (edges || []).filter(e => e.target === id)) {
    const src = nodeOutputs?.[edge.source];
    if (src?.images?.length && refImages.length === 0) refImages = src.images;
  }

  const safeRefIndex = Math.min(refIndex, Math.max(refImages.length - 1, 0));
  const selectedRef = refImages[safeRefIndex];

  const result = nodeOutputs?.[id] || {};
  const slides = result.slides || [];
  const batchStatus = result.batchStatus || 'idle';
  const isGenerating = batchStatus === 'generating';
  const uploadStatus = result.uploadStatus || '';

  const safeIndex = Math.min(viewIndex, Math.max(slides.length - 1, 0));
  const currentResult = slides[safeIndex];
  const currentUrl = currentResult?.url || '';

  const copyUrl = async () => { if (currentUrl) { await navigator.clipboard.writeText(currentUrl).catch(() => {}); setUrlCopied(true); setTimeout(() => setUrlCopied(false), 1500); } };

  const modelLabel = model === 'nano-banana-2' ? 'NB2' : 'GPT-I2I';

  return (
    <div className="cv-node cv-char-scene" style={{ '--status-color': slides.some(s => s.status === 'done') ? '#e056a0' : '#555', '--node-accent': '#e056a0' }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="ref-in" />

      <div className="cv-char-scene-header">
        <div className="cv-char-scene-dot" />
        <span className="cv-char-scene-title">Character Scene</span>
        <span className="cv-char-scene-badge">{modelLabel}</span>
      </div>

      {/* Reference status */}
      <div className="cv-carousel-inputs" style={{ padding: '2px 12px' }}>
        <div className="cv-carousel-input-row">
          <span className={`cv-carousel-input-dot ${refImages.length > 0 ? 'active' : ''}`} />
          <span>{refImages.length > 0 ? `${refImages.length} ref photos` : 'Wire Avatar Frame →'}</span>
        </div>
      </div>

      {/* Reference image selector */}
      {refImages.length > 1 && (
        <div className="cv-gami-controls" style={{ padding: '0 12px 4px' }}>
          <select className="cv-blotato-select" style={{ width: '100%' }} value={safeRefIndex}
            onClick={(e) => e.stopPropagation()} onChange={(e) => { e.stopPropagation(); setRefIndex(Number(e.target.value)); }}>
            {refImages.map((img, i) => <option key={i} value={i}>{i + 1}. {img.name}</option>)}
          </select>
        </div>
      )}

      {/* Selected ref thumbnail */}
      {selectedRef && (
        <div className="cv-char-scene-ref-thumb">
          <img src={`http://localhost:3001/api/local-image?path=${encodeURIComponent(selectedRef.path)}`}
            alt={selectedRef.name} />
        </div>
      )}

      {/* Scene prompt */}
      <div className="cv-niche-field" style={{ padding: '4px 12px' }}>
        <textarea className="cv-niche-topic" rows={3}
          placeholder="Describe the scene... e.g. 'hiking on a mountain trail at golden hour, binoculars in hand'"
          value={scenePrompt} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => setScenePrompt(e.target.value)} />
      </div>

      {/* Model + Aspect + Resolution */}
      <div className="cv-gami-controls" style={{ padding: '0 12px 4px', display: 'flex', gap: 4 }}>
        <select className="cv-blotato-select" style={{ flex: 2 }} value={model}
          onClick={(e) => e.stopPropagation()} onChange={(e) => { e.stopPropagation(); setModel(e.target.value); }}>
          <option value="nano-banana-2">Nano Banana 2</option>
          <option value="gpt-image-2-image-to-image">GPT Image 2</option>
        </select>
        <select className="cv-blotato-select" style={{ flex: 1 }} value={aspectRatio}
          onClick={(e) => e.stopPropagation()} onChange={(e) => { e.stopPropagation(); setAspectRatio(e.target.value); }}>
          <option value="9:16">9:16</option><option value="1:1">1:1</option><option value="16:9">16:9</option>
          <option value="4:3">4:3</option><option value="3:4">3:4</option><option value="4:5">4:5</option>
        </select>
        <select className="cv-blotato-select" style={{ flex: 1 }} value={resolution}
          onClick={(e) => e.stopPropagation()} onChange={(e) => { e.stopPropagation(); setResolution(e.target.value); }}>
          <option value="1K">1K</option><option value="2K">2K</option><option value="4K">4K</option>
        </select>
      </div>

      {/* API Key */}
      <div className="cv-blotato-field" style={{ padding: '0 12px 4px' }}>
        <input className="cv-blotato-input" type="password" placeholder="KIE API Key"
          value={apiKey} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => saveKey(e.target.value)} />
      </div>

      {/* Upload status */}
      {uploadStatus && <div className="cv-ugc-count" style={{ padding: '2px 12px', fontSize: 11 }}>{uploadStatus}</div>}

      {/* Result preview */}
      {slides.length > 0 && (
        <button className="cv-gami-viewer-toggle" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
          {expanded ? 'Hide' : 'View Result'} ({slides.filter(s => s.status === 'done').length} ready)
        </button>
      )}

      {expanded && slides.length > 0 && (
        <div className="cv-gami-viewer">
          {slides.length > 1 && (
            <div className="cv-gami-viewer-nav">
              <button className="cv-gami-nav-btn" disabled={safeIndex === 0} onClick={(e) => { e.stopPropagation(); setViewIndex(i => Math.max(0, i - 1)); }}>&#9664;</button>
              <span className="cv-gami-nav-label">{safeIndex + 1}/{slides.length}</span>
              <button className="cv-gami-nav-btn" disabled={safeIndex >= slides.length - 1} onClick={(e) => { e.stopPropagation(); setViewIndex(i => Math.min(slides.length - 1, i + 1)); }}>&#9654;</button>
            </div>
          )}
          {currentUrl ? (
            <div className="cv-gami-viewer-img-wrap">
              <img src={currentUrl} alt={`Scene ${safeIndex + 1}`} className="cv-gami-viewer-img"
                onClick={(e) => { e.stopPropagation(); window.open(currentUrl, '_blank'); }} />
              <button className="cv-btn cv-btn-sm" onClick={(e) => { e.stopPropagation(); copyUrl(); }}>
                {urlCopied ? 'Copied!' : 'Copy URL'}
              </button>
            </div>
          ) : currentResult?.status === 'polling' ? (
            <div className="cv-gami-viewer-pending">Generating... ({currentResult.elapsed || 0}s)</div>
          ) : currentResult?.status === 'error' ? (
            <div className="cv-gami-viewer-error">{currentResult.error}</div>
          ) : (
            <div className="cv-gami-viewer-pending">Submitting...</div>
          )}
        </div>
      )}

      {result.error && <div className="cv-niche-error">{result.error}</div>}

      <button className="cv-btn cv-btn-char-scene"
        disabled={!scenePrompt.trim() || isGenerating}
        onClick={(e) => { e.stopPropagation(); onCharacterSceneGenerate(id, apiKey, scenePrompt, selectedRef, model, aspectRatio, resolution); setExpanded(true); }}>
        {isGenerating ? 'Generating...' : slides.length > 0 ? 'Regenerate' : 'Generate Scene'}
      </button>

      <Handle type="source" position={Position.Right} id="scene-out" />
    </div>
  );
}

/* ===== CLIP SPLITTER NODE — splits UGC script into 9s clip definitions ===== */
function ClipSplitterNode({ id }) {
  const { edges, nodeOutputs, nodes, onClipSplit, anthropicApiKey } = useContext(CanvasCtx);
  const [expanded, setExpanded] = useState(false);
  const [viewIndex, setViewIndex] = useState(0);
  const [copied, setCopied] = useState(false);

  // Trace input script + character from UGC Gen
  let inputScript = null;
  let character = null;
  for (const edge of (edges || []).filter(e => e.target === id)) {
    const src = nodeOutputs?.[edge.source];
    if (src?.script && !inputScript) inputScript = src.script;
    if (src?.character && !character) character = src.character;
    // Also check if source node has character data (for UGC Gen)
    const srcNode = nodes?.find(n => n.id === edge.source);
    if (!character && srcNode?.data?.character) character = srcNode.data.character;
  }

  // Fallback: scan all nodeOutputs if direct edge trace found nothing
  if (!inputScript) {
    const inEdges = (edges || []).filter(e => e.target === id);
    if (inEdges.length > 0) {
      for (const [nid, out] of Object.entries(nodeOutputs || {})) {
        if (nid === id) continue;
        if (out.script && !inputScript) { inputScript = out.script; if (out.character) character = out.character; break; }
      }
    }
  }

  const result = nodeOutputs?.[id] || {};
  const clips = result.clips || [];
  const status = result.status || 'idle';

  const statusColors = { idle: '#555', generating: '#e85d75', done: '#00FFFF', error: '#e74c3c' };

  const safeIndex = Math.min(viewIndex, Math.max(clips.length - 1, 0));
  const currentClip = clips[safeIndex];

  const totalDuration = clips.reduce((sum, c) => sum + (c.duration || 0), 0);

  return (
    <div className={`cv-node cv-clip-splitter cv-clip-splitter-${status}`} style={{ '--status-color': statusColors[status] || '#555', '--node-accent': '#e74c3c' }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="script-in" />

      <div className="cv-splitter-header">
        <div className="cv-splitter-dot" />
        <span className="cv-splitter-title">Clip Splitter</span>
        <span className="cv-splitter-badge">9s Clips</span>
      </div>

      {!inputScript && <div className="cv-gami-empty" style={{ padding: '6px 12px' }}>Wire Script Gen (UGC) to left handle</div>}

      {inputScript && clips.length === 0 && (
        <div className="cv-ugc-count" style={{ padding: '4px 12px' }}>Script detected — ready to split</div>
      )}

      {/* Clip overview */}
      {clips.length > 0 && (
        <>
          <div className="cv-ugc-count" style={{ padding: '2px 12px' }}>
            {clips.length} clips / {totalDuration}s total
          </div>
          <div className="cv-gami-batch-bar">
            <div className="cv-gami-batch-progress">
              {clips.map((c, i) => (
                <div key={i}
                  className={`cv-gami-batch-pip cv-splitter-pip-${c.type}`}
                  onClick={(e) => { e.stopPropagation(); setViewIndex(i); setExpanded(true); }}
                  title={`${c.type} (${c.duration}s)`} />
              ))}
            </div>
          </div>

          <button className="cv-gami-viewer-toggle" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
            {expanded ? 'Hide Clips' : 'View Clips'} ({clips.length})
          </button>
        </>
      )}

      {expanded && currentClip && (
        <div className="cv-splitter-viewer">
          <div className="cv-gami-viewer-nav">
            <button className="cv-gami-nav-btn" disabled={safeIndex === 0} onClick={(e) => { e.stopPropagation(); setViewIndex(i => Math.max(0, i - 1)); }}>&#9664;</button>
            <span className="cv-gami-nav-label">{currentClip.type.toUpperCase()} ({currentClip.duration}s) — {safeIndex + 1}/{clips.length}</span>
            <button className="cv-gami-nav-btn" disabled={safeIndex >= clips.length - 1} onClick={(e) => { e.stopPropagation(); setViewIndex(i => Math.min(clips.length - 1, i + 1)); }}>&#9654;</button>
          </div>
          <div className="cv-splitter-clip-body">
            {currentClip.dialogue && <div className="cv-splitter-dialogue"><strong>Dialogue:</strong> {currentClip.dialogue}</div>}
            <div className="cv-splitter-prompt"><strong>Prompt:</strong> {currentClip.prompt}</div>
          </div>
          <button className="cv-btn cv-btn-sm cv-splitter-copy" onClick={(e) => {
            e.stopPropagation();
            const text = `[${currentClip.type.toUpperCase()} — ${currentClip.duration}s]\n${currentClip.dialogue ? `Dialogue: ${currentClip.dialogue}\n` : ''}Prompt: ${currentClip.prompt}`;
            navigator.clipboard.writeText(text).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}>
            {copied ? 'Copied!' : 'Copy Clip'}
          </button>
        </div>
      )}

      {result.error && <div className="cv-niche-error">{result.error}</div>}

      <button className="cv-btn cv-btn-splitter"
        disabled={!inputScript || status === 'generating'}
        onClick={(e) => { e.stopPropagation(); onClipSplit(id, inputScript, character); setExpanded(true); }}>
        {status === 'generating' ? 'Splitting...' : clips.length > 0 ? 'Re-split' : 'Split Script'}
      </button>

      <Handle type="source" position={Position.Right} id="clips-out" />
    </div>
  );
}

/* ===== CLIP FRAMES NODE — batch generate 1st frame images per clip ===== */
function ClipFramesNode({ id }) {
  const { edges, nodeOutputs, onClipFramesBatchGenerate } = useContext(CanvasCtx);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('kie-api-key') || '');
  const [resolution, setResolution] = useState('2K');
  const [viewIndex, setViewIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);

  const saveKey = (v) => { setApiKey(v); localStorage.setItem('kie-api-key', v); };

  // Trace clips from Clip Splitter + optional avatar reference
  let clips = [];
  let avatarRefUrl = '';
  for (const edge of (edges || []).filter(e => e.target === id)) {
    const src = nodeOutputs?.[edge.source];
    if (src?.clips?.length && clips.length === 0) clips = src.clips;
    // Check for avatar reference from Avatar Frame
    const stored = localStorage.getItem(`avatar-frame-${edge.source}`);
    if (stored && !avatarRefUrl) avatarRefUrl = stored;
  }

  const result = nodeOutputs?.[id] || {};
  const frames = result.slides || [];
  const batchStatus = result.batchStatus || 'idle';
  const doneCount = frames.filter(f => f.status === 'done').length;
  const genCount = frames.filter(f => f.status === 'polling' || f.status === 'submitting').length;
  const isGenerating = batchStatus === 'generating';

  const safeIndex = Math.min(viewIndex, Math.max(frames.length - 1, 0));
  const currentFrame = frames[safeIndex];
  const currentUrl = currentFrame?.url || '';
  const currentClip = clips[safeIndex];

  const copyUrl = async () => { if (currentUrl) { await navigator.clipboard.writeText(currentUrl).catch(() => {}); setUrlCopied(true); setTimeout(() => setUrlCopied(false), 1500); } };

  return (
    <div className="cv-node cv-clip-frames" style={{ '--node-accent': '#f39c12' }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="clips-in" style={{ top: '30%' }} />
      <Handle type="target" position={Position.Left} id="ref-in" style={{ top: '70%' }} />

      <div className="cv-clipframes-header">
        <div className="cv-clipframes-dot" />
        <span className="cv-clipframes-title">Clip Frames</span>
        <span className="cv-clipframes-badge">1st Frames</span>
      </div>

      <div className="cv-carousel-inputs">
        <div className="cv-carousel-input-row">
          <span className={`cv-carousel-input-dot ${clips.length > 0 ? 'active' : ''}`} />
          <span>{clips.length > 0 ? `${clips.length} clips` : 'Wire Clip Splitter → top'}</span>
        </div>
        <div className="cv-carousel-input-row">
          <span className={`cv-carousel-input-dot ${avatarRefUrl ? 'active' : ''}`} />
          <span>{avatarRefUrl ? 'Ref image set' : 'Avatar Frame → bottom (optional)'}</span>
        </div>
      </div>

      <div className="cv-gami-controls">
        <select className="cv-blotato-select" value={resolution} onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); setResolution(e.target.value); }}>
          <option value="1K">1K</option><option value="2K">2K</option><option value="4K">4K</option>
        </select>
      </div>

      <div className="cv-blotato-field">
        <input className="cv-blotato-input" type="password" placeholder="KIE API Key"
          value={apiKey} onClick={(e) => e.stopPropagation()} onChange={(e) => saveKey(e.target.value)} />
      </div>

      {/* Batch progress */}
      {frames.length > 0 && (
        <div className="cv-gami-batch-bar">
          <div className="cv-gami-batch-progress">
            {frames.map((f, i) => (
              <div key={i} className={`cv-gami-batch-pip cv-gami-pip-${f.status || 'idle'}`}
                onClick={(e) => { e.stopPropagation(); setViewIndex(i); setExpanded(true); }}
                title={`Frame ${i + 1}: ${clips[i]?.type || '?'} (${f.status})`} />
            ))}
          </div>
          <span className="cv-gami-batch-stats">{doneCount}/{frames.length}</span>
        </div>
      )}

      {frames.length > 0 && (
        <button className="cv-gami-viewer-toggle" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
          {expanded ? 'Hide' : 'View Frames'} ({doneCount} ready)
        </button>
      )}

      {expanded && frames.length > 0 && (
        <div className="cv-gami-viewer">
          <div className="cv-gami-viewer-nav">
            <button className="cv-gami-nav-btn" disabled={safeIndex === 0} onClick={(e) => { e.stopPropagation(); setViewIndex(i => Math.max(0, i - 1)); }}>&#9664;</button>
            <span className="cv-gami-nav-label">{currentClip?.type?.toUpperCase() || 'Frame'} {safeIndex + 1}/{frames.length}</span>
            <button className="cv-gami-nav-btn" disabled={safeIndex >= frames.length - 1} onClick={(e) => { e.stopPropagation(); setViewIndex(i => Math.min(frames.length - 1, i + 1)); }}>&#9654;</button>
          </div>

          {currentUrl ? (
            <div className="cv-gami-viewer-img-wrap">
              <img src={currentUrl} alt={`Frame ${safeIndex + 1}`} className="cv-gami-viewer-img"
                onClick={(e) => { e.stopPropagation(); window.open(currentUrl, '_blank'); }} />
              <button className="cv-btn cv-btn-sm" onClick={(e) => { e.stopPropagation(); copyUrl(); }}>
                {urlCopied ? 'Copied!' : 'Copy URL'}
              </button>
            </div>
          ) : currentFrame?.status === 'polling' ? (
            <div className="cv-gami-viewer-pending">Generating... ({currentFrame.elapsed || 0}s)</div>
          ) : currentFrame?.status === 'error' ? (
            <div className="cv-gami-viewer-error">{currentFrame.error}</div>
          ) : (
            <div className="cv-gami-viewer-pending">Pending</div>
          )}
        </div>
      )}

      <button className="cv-btn cv-btn-clipframes"
        disabled={clips.length === 0 || isGenerating}
        onClick={(e) => { e.stopPropagation(); onClipFramesBatchGenerate(id, apiKey, clips, avatarRefUrl, resolution); setExpanded(true); }}>
        {isGenerating ? `Generating ${genCount}/${clips.length}...` : doneCount > 0 ? 'Regenerate All' : `Generate Frames (${clips.length})`}
      </button>

      <Handle type="source" position={Position.Right} id="frames-out" />
    </div>
  );
}

/* ===== UGC VIDEO NODE — batch Kling 3.0 from clips + per-clip frames ===== */
// UGC Video routes: kie.ai (default, existing flow) vs Higgsfield (auto-uploads
// local frames, sidesteps catbox 503s). See project_higgsfield_option_a memory.
// Higgsfield model IDs verified via `higgsfield model list` on 2026-05-08.
const UGC_ROUTES = [
  { id: 'kie:kling-3.0',     label: 'kie.ai · Kling 3.0',        badge: 'Kling 3.0',  isHf: false },
  { id: 'hf:kling3_0',       label: 'Higgsfield · Kling v3.0',   badge: 'HF Kling',   isHf: true  },
  { id: 'hf:veo3_1',         label: 'Higgsfield · Veo 3.1',      badge: 'HF Veo 3.1', isHf: true  },
  { id: 'hf:seedance_2_0',   label: 'Higgsfield · Seedance 2.0', badge: 'HF Seedance',isHf: true  },
  { id: 'hf:soul_cast',      label: 'Higgsfield · Soul Cast',    badge: 'HF Soul',    isHf: true  },
];

function UgcVideoNode({ id }) {
  const { edges, nodeOutputs, onUgcVideoBatchGenerate, onRunLane, laneRun, syncNodeData } = useContext(CanvasCtx);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('kie-api-key') || '');
  const [route, setRoute] = useState(() => {
    const saved = localStorage.getItem('ugc-route');
    return UGC_ROUTES.some(r => r.id === saved) ? saved : 'kie:kling-3.0';
  });
  const [soulId, setSoulId] = useState(() => localStorage.getItem('ugc-soulid') || '');
  const [costEst, setCostEst] = useState(null); // { perClip, currency } | null
  const [costErr, setCostErr] = useState('');
  const [costLoading, setCostLoading] = useState(false);
  const [viewIndex, setViewIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const saveKey = (v) => { setApiKey(v); localStorage.setItem('kie-api-key', v); };
  const saveSoulId = (v) => { setSoulId(v); localStorage.setItem('ugc-soulid', v); syncNodeData(id, { soulId: v }); };

  // Trace inputs: clips (from Clip Splitter) + frame images (from Avatar Frame folder)
  let clips = [];
  let frameUrls = []; // one URL per clip

  const inEdges = (edges || []).filter(e => e.target === id);
  for (const edge of inEdges) {
    const src = nodeOutputs?.[edge.source];
    if (!src) continue;
    // Clips from Clip Splitter
    if (src.clips?.length && clips.length === 0) clips = src.clips;
    // Frame images from Avatar Frame (folder scan outputs `images` array)
    if (src.images?.length && frameUrls.length === 0) {
      frameUrls = src.images.map(img => img.path);
    }
  }

  const pairCount = Math.min(clips.length, frameUrls.length);

  const result = nodeOutputs?.[id] || {};
  const videos = result.videos || [];
  const batchStatus = result.batchStatus || 'idle';
  const doneCount = videos.filter(v => v.status === 'done').length;
  const genCount = videos.filter(v => v.status === 'polling' || v.status === 'submitting').length;

  const safeIndex = Math.min(viewIndex, Math.max(videos.length - 1, 0));
  const currentVideo = videos[safeIndex];
  const currentUrl = currentVideo?.url || '';
  const currentClip = clips[safeIndex];

  const copyUrl = async () => { if (currentUrl) { await navigator.clipboard.writeText(currentUrl).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); } };

  const routeMeta = UGC_ROUTES.find(r => r.id === route) || UGC_ROUTES[0];
  const isHf = routeMeta.isHf;
  const hfModelId = isHf ? route.slice(3) : null;

  // Pull a numeric credit count out of whatever shape the CLI returns.
  const extractCost = (data) => {
    if (data == null) return null;
    if (typeof data === 'number') return data;
    const fields = ['cost', 'credits', 'estimated_cost', 'estimatedCost', 'price'];
    for (const f of fields) {
      const v = data?.[f];
      if (typeof v === 'number') return v;
      if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v);
    }
    return null;
  };

  const refreshCost = async (modelId, prompt) => {
    if (!modelId || !prompt) { setCostEst(null); setCostErr(''); return; }
    setCostLoading(true);
    setCostErr('');
    try {
      const data = await hfEstimateCost(modelId, prompt);
      const perClip = extractCost(data);
      setCostEst(perClip != null ? { perClip } : null);
      if (perClip == null) setCostErr('cost: unparsed shape');
    } catch (err) {
      setCostEst(null);
      setCostErr(err.message.slice(0, 60));
    } finally {
      setCostLoading(false);
    }
  };

  const onRouteChange = (v) => {
    setRoute(v);
    localStorage.setItem('ugc-route', v);
    syncNodeData(id, { route: v });
    setCostEst(null);
    setCostErr('');
    if (v.startsWith('hf:') && clips[0]?.prompt) {
      refreshCost(v.slice(3), clips[0].prompt);
    }
  };

  return (
    <div className="cv-node cv-ugc-video" style={{ '--node-accent': '#e85d75' }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="clips-in" style={{ top: '30%' }} />
      <Handle type="target" position={Position.Left} id="frames-in" style={{ top: '70%' }} />

      <div className="cv-ugcvid-header">
        <div className="cv-ugcvid-dot" />
        <span className="cv-ugcvid-title">UGC Video</span>
        <span className="cv-ugcvid-badge">{routeMeta.badge}</span>
      </div>

      {/* Input status */}
      <div className="cv-carousel-inputs">
        <div className="cv-carousel-input-row">
          <span className={`cv-carousel-input-dot ${clips.length > 0 ? 'active' : ''}`} />
          <span>{clips.length > 0 ? `${clips.length} clips` : 'Wire Clip Splitter → top'}</span>
        </div>
        <div className="cv-carousel-input-row">
          <span className={`cv-carousel-input-dot ${frameUrls.length > 0 ? 'active' : ''}`} />
          <span>{frameUrls.length > 0 ? `${frameUrls.length} frames` : 'Wire Avatar Frames → bottom'}</span>
        </div>
        {pairCount > 0 && pairCount < clips.length && (
          <div style={{ fontSize: 9, color: '#e0922f', padding: '0 12px' }}>{pairCount}/{clips.length} paired</div>
        )}
      </div>

      {/* Route selector */}
      <div className="cv-blotato-field" title="Generation route">
        <select className="cv-blotato-select" value={route}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onRouteChange(e.target.value)}>
          {UGC_ROUTES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        {isHf && (
          <button className="cv-btn cv-btn-sm" style={{ flex: '0 0 auto', padding: '4px 8px', fontSize: 10 }}
            onClick={(e) => { e.stopPropagation(); refreshCost(hfModelId, clips[0]?.prompt || ''); }}
            disabled={costLoading || !clips[0]?.prompt}
            title="Refresh cost estimate (uses first clip's prompt)">
            {costLoading ? '…' : '↻'}
          </button>
        )}
      </div>

      {/* Soul-ID — Higgsfield routes only */}
      {isHf && (
        <div className="cv-blotato-field">
          <input className="cv-blotato-input" type="text" placeholder="Soul-ID (optional)"
            value={soulId} onClick={(e) => e.stopPropagation()} onChange={(e) => saveSoulId(e.target.value)} />
        </div>
      )}

      {/* Cost badge */}
      {isHf && (costEst || costErr) && (
        <div style={{ padding: '2px 14px 4px', fontSize: 10, color: costErr ? '#e74c3c' : '#9b59b6', fontFamily: 'var(--mono)' }}>
          {costErr ? `⚠ ${costErr}` : `~${costEst.perClip} cr/clip${pairCount > 1 ? ` · ~${costEst.perClip * pairCount} total` : ''}`}
        </div>
      )}

      {/* KIE key — only when route is kie */}
      {!isHf && (
        <div className="cv-blotato-field">
          <input className="cv-blotato-input" type="password" placeholder="KIE API Key"
            value={apiKey} onClick={(e) => e.stopPropagation()} onChange={(e) => saveKey(e.target.value)} />
        </div>
      )}

      {/* Batch progress */}
      {videos.length > 0 && (
        <div className="cv-gami-batch-bar">
          <div className="cv-gami-batch-progress">
            {videos.map((v, i) => (
              <div key={i} className={`cv-gami-batch-pip cv-gami-pip-${v.status || 'idle'}`}
                onClick={(e) => { e.stopPropagation(); setViewIndex(i); setExpanded(true); }}
                title={`Clip ${i + 1}: ${clips[i]?.type || '?'} (${v.status})`} />
            ))}
          </div>
          <span className="cv-gami-batch-stats">{doneCount}/{videos.length}</span>
        </div>
      )}

      {videos.length > 0 && (
        <button className="cv-gami-viewer-toggle" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
          {expanded ? 'Hide' : 'View Videos'} ({doneCount} ready)
        </button>
      )}

      {expanded && videos.length > 0 && (
        <div className="cv-gami-viewer">
          <div className="cv-gami-viewer-nav">
            <button className="cv-gami-nav-btn" disabled={safeIndex === 0} onClick={(e) => { e.stopPropagation(); setViewIndex(i => Math.max(0, i - 1)); }}>&#9664;</button>
            <span className="cv-gami-nav-label">{currentClip?.type?.toUpperCase() || 'Clip'} {safeIndex + 1}/{videos.length}</span>
            <button className="cv-gami-nav-btn" disabled={safeIndex >= videos.length - 1} onClick={(e) => { e.stopPropagation(); setViewIndex(i => Math.min(videos.length - 1, i + 1)); }}>&#9654;</button>
          </div>

          {currentUrl ? (
            <div className="cv-vid-preview">
              <video src={currentUrl} controls className="cv-vid-player" onClick={(e) => e.stopPropagation()} />
              <button className="cv-btn cv-btn-sm" onClick={(e) => { e.stopPropagation(); copyUrl(); }}>
                {copied ? 'Copied!' : 'Copy URL'}
              </button>
            </div>
          ) : currentVideo?.status === 'polling' ? (
            <div className="cv-gami-viewer-pending">Generating... ({Math.floor((currentVideo.elapsed||0)/60)}m {(currentVideo.elapsed||0)%60}s)</div>
          ) : currentVideo?.status === 'error' ? (
            <div className="cv-gami-viewer-error">{currentVideo.error}</div>
          ) : (
            <div className="cv-gami-viewer-pending">Pending</div>
          )}
        </div>
      )}

      {/* Run Lane — executeGraph engine runs the whole upstream lane */}
      <button
        onClick={() => onRunLane(id)}
        disabled={laneRun.status === 'running'}
        style={{
          width: '100%', padding: '6px 10px', marginBottom: 6, border: 'none', borderRadius: 6,
          cursor: laneRun.status === 'running' ? 'wait' : 'pointer', fontWeight: 700, fontSize: 11,
          background: 'linear-gradient(135deg, #C9A227, #8a6d1a)', color: '#fff',
        }}
      >
        {laneRun.status === 'running' && laneRun.targetId === id ? '⏳ Running lane…' : '▶ Run Lane'}
      </button>
      {laneRun.status === 'error' && laneRun.targetId === id && (
        <div style={{ fontSize: 10, color: '#ff6b6b', marginBottom: 6 }}>{laneRun.error}</div>
      )}

      <button className="cv-btn cv-btn-ugcvid"
        disabled={pairCount === 0 || batchStatus === 'generating'}
        onClick={(e) => {
          e.stopPropagation();
          onUgcVideoBatchGenerate(id, { kieKey: apiKey, route, soulId }, clips, frameUrls);
          setExpanded(true);
        }}>
        {batchStatus === 'generating' ? `Generating ${genCount}/${pairCount}...` : doneCount > 0 ? 'Regenerate All' : `Generate All (${pairCount})`}
      </button>
      <Handle type="source" position={Position.Right} id="video-out" />
    </div>
  );
}

/* ===== 16-GAMI ART NODE — batch slide image generation ===== */
const GAMI_ART_STYLE = `High-resolution product photograph of a physical, multi-layered cut paper and origami sculpture. Stair-stepped pixelated aesthetic merged with traditional origami folds. Multi-layered 3D cardstock construction. Soft directional lighting creating distinct drop shadows between physical paper layers. Hyper-realistic tangible texture contrasted with digital abstraction. 16-bit jagged physics reinforced by fold geometry.`;

// 16-GAMI-branded infographic variant. Keeps the paper-sculpture DNA but
// organizes the frame as a data visualization with typography + callouts.
// Image-2 renders typography cleanly, so this plays to its strength.
const INFOGRAPHIC_STYLE = `High-resolution product photograph of a physical, multi-layered cut paper infographic sculpture. Informational data visualization rendered as layered cardstock. Stair-stepped pixelated title typography cut from layered paper at the top of the frame, with 2 to 4 key data points below — each rendered as a distinct paper icon or mini-sculpture with a cut-paper numeric or textual callout beside it. Connector lines and arrows rendered as folded paper strips. Clean top-to-bottom hierarchy with preserved negative space between elements. Soft directional lighting creating distinct drop shadows between physical paper layers. Muted earth-tone paper palette (beige, tan, slate, charcoal, off-white) with one saturated accent color per data category. Hyper-realistic tangible texture contrasted with digital abstraction. Angled macro-level perspective with shallow depth of field emphasizing paper textures and cardstock grain.`;

// Skyframe brand closer — every carousel's final slide renders this.
// Core identity: a light bulb whose filament is shaped into a quadcopter drone,
// with the bulb's outer glass outline traced in bright neon yellow (#FFEA00).
// The variation pool keeps closers visually fresh across carousels; one variant
// is picked at random per generation, while the brand elements stay locked.
const SKYFRAME_LOGO_SUBJECT = `The subject is the Skyframe company logo: a stylized light bulb where the glowing filament inside is shaped into a small quadcopter drone with four arms and four rotor blades. The bulb's outer glass outline is traced in bright neon yellow (#FFEA00) cut-paper strips — this neon yellow outline is a non-negotiable brand element, always present, always electric. The drone filament is constructed of thin warm-gold paper strands bent into the quadcopter silhouette. Composition centered on the bulb, which fills the frame generously.`;

const SKYFRAME_LOGO_VARIATIONS = [
  'Shown from a straight-on front view, drone hovering perfectly level inside the bulb. Dramatic single-source lighting from above creating crisp layered shadows between the paper glass planes.',
  'Three-quarter angle view, drone captured mid-banking turn with one arm tilted slightly upward. Soft warm rim lighting from the upper-right catching the gold filament and the neon yellow outline.',
  'Low-angle hero shot looking up at the bulb from below, drone silhouette reading strong against the illuminated interior. Neon yellow outline glowing, warm paper-light rays radiating outward.',
  'Macro close-up with a partial paper cutaway of the bulb glass on one side, revealing the drone filament clearly. Soft diffuse overhead light, gentle shadows between cardstock layers, neon yellow edge visible along the preserved glass silhouette.',
  'Drone caught in a dynamic ascending pose inside the bulb with small jagged paper spark bursts around the four propeller arms. Energetic composition, warm golden interior glow, vivid neon yellow outer edge.',
  'Minimalist perfectly-centered composition, flat head-on view, even soft ambient lighting, maximum logo clarity and legibility. Premium product-catalog feel, neon yellow bulb outline crisp against a muted paper backdrop.',
  'Slightly angled top-down view, drone filament visible through the top curve of the bulb, propeller arms fanned outward. Cool paper-white ambient with a single warm highlight on one side of the glass, neon yellow outline tracing the full silhouette.',
];

function buildSkyframeLogoPrompt(style) {
  const variation = SKYFRAME_LOGO_VARIATIONS[Math.floor(Math.random() * SKYFRAME_LOGO_VARIATIONS.length)];
  const core = `${SKYFRAME_LOGO_SUBJECT}\n\n${variation}`;
  if (style === 'infographic') {
    return `${INFOGRAPHIC_STYLE}\n\n${core}`;
  }
  if (style === 'scene') {
    return `${GAMI_ART_STYLE}\n\n${core}`;
  }
  // 'none' / Free (Image-2 only) — logo still renders as paper sculpture because
  // that's what the Skyframe logo IS, just without the extra scene framing.
  return `High-resolution product photograph of a physical, multi-layered cut paper and cardstock logo sculpture. Angled macro-level perspective with shallow depth of field emphasizing paper textures and cardstock grain.\n\n${core}\n\nStair-stepped pixelated edges on the drone filament, soft directional lighting creating distinct drop shadows between paper layers.`;
}

function parseSlides(scriptText) {
  // Split script into numbered slides: "1. ...", "2. ...", etc.
  const lines = scriptText.split('\n').filter(l => l.trim().length > 0);
  const slides = [];
  let current = null;
  for (const line of lines) {
    const match = line.match(/^(\d+)[.):\s]/);
    if (match) {
      if (current) slides.push(current);
      current = { num: parseInt(match[1]), text: line.replace(/^\d+[.):\s]+/, '').trim() };
    } else if (current) {
      current.text += ' ' + line.trim();
    }
  }
  if (current) slides.push(current);
  // If no numbered slides found, split by lines as fallback
  if (slides.length === 0) {
    const contentLines = lines.filter(l => !l.startsWith('['));
    return contentLines.map((l, i) => ({ num: i + 1, text: l.trim() }));
  }
  return slides;
}

function buildSlidePrompt(slideText, style = 'scene') {
  if (style === 'infographic') {
    return `${INFOGRAPHIC_STYLE}\n\nThe infographic subject is:\n"${slideText}"\n\nExtract 2 to 4 key facts, stats, steps, or comparisons from this topic and render each as a distinct labeled paper element with crisp legible typography cut from layered paper. Hierarchy flows top-to-bottom. Icons are small paper mini-sculptures, not flat illustrations.`;
  }
  return `${GAMI_ART_STYLE}\n\nThe sculpture depicts a scene inspired by this narrative:\n"${slideText}"\n\nTranslate the emotional core of this narrative into a single origami diorama. Use folded paper characters, layered cardstock environments, and pixel-grid textures to convey the mood. Angled macro-level perspective with shallow depth of field emphasizing paper textures and cardstock grain.`;
}

function GamiArtNode({ id, data }) {
  const { script, edges, nodeOutputs, onGamiArtBatchGenerate, syncNodeData } = useContext(CanvasCtx);
  // Initialize from node.data (mirrored by syncNodeData) so reloads rehydrate.
  const [aspectRatio, setAspectRatio] = useState(() => data?.aspectRatio || '1:1');
  const [resolution, setResolution] = useState(() => data?.resolution || '2K');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('kie-api-key') || '');
  const [showKey, setShowKey] = useState(false);
  const [viewIndex, setViewIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [freeformText, setFreeformText] = useState('');
  const [style, setStyle] = useState('scene'); // 'scene' | 'infographic'

  const saveKey = (v) => { setApiKey(v); localStorage.setItem('kie-api-key', v); };

  // Trace input
  const inputScript = useMemo(() => {
    const inEdge = edges?.find(e => e.target === id);
    if (!inEdge) return null;
    const sourceOutput = nodeOutputs?.[inEdge.source];
    if (sourceOutput?.script) return sourceOutput.script;
    return script || null;
  }, [edges, id, script, nodeOutputs]);

  const isFreeform = !inputScript && freeformText.trim().length > 0;

  const slides = useMemo(() => {
    if (isFreeform) return [{ num: 1, text: freeformText.trim() }];
    const parsed = inputScript ? parseSlides(inputScript) : [];
    if (parsed.length > 0) parsed.push({ num: parsed.length + 1, text: 'Follow for more Cybersecurity and AI Stories', isCta: true });
    return parsed;
  }, [inputScript, isFreeform, freeformText]);
  const slidePrompts = useMemo(() => slides.map(s => {
    if (s.isCta) return buildSkyframeLogoPrompt(style);
    return buildSlidePrompt(s.text, style);
  }), [slides, style]);

  const result = nodeOutputs?.[id] || {};
  const slideResults = result.slides || [];
  const batchStatus = result.batchStatus || 'idle'; // idle | generating | done | error

  const doneCount = slideResults.filter(s => s.status === 'done').length;
  const genCount = slideResults.filter(s => s.status === 'polling' || s.status === 'submitting').length;
  const errCount = slideResults.filter(s => s.status === 'error').length;
  const isGenerating = batchStatus === 'generating';

  // Clamp viewIndex
  const safeIndex = Math.min(viewIndex, Math.max(slides.length - 1, 0));
  const currentSlide = slides[safeIndex];
  const currentResult = slideResults[safeIndex];
  const currentUrl = currentResult?.url || '';

  const copyUrl = async () => { if (currentUrl) { await navigator.clipboard.writeText(currentUrl).catch(() => {}); setUrlCopied(true); setTimeout(() => setUrlCopied(false), 1500); } };
  const copyPrompt = async () => {
    const p = slidePrompts[safeIndex];
    if (!p) return;
    await navigator.clipboard.writeText(p).catch(() => {});
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 1500);
  };
  const prev = () => setViewIndex(i => Math.max(0, i - 1));
  const next = () => setViewIndex(i => Math.min(slides.length - 1, i + 1));

  return (
    <div className="cv-node cv-gami cv-gami-art">
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="script-in" />

      <div className="cv-gami-header cv-gami-art-header">
        <span className="cv-gami-diamond">◆</span>
        <span className="cv-gami-title">16-GAMI</span>
        <span className="cv-gami-badge cv-gami-art-badge">{isFreeform ? 'Freeform' : 'Art'}</span>
        {slides.length > 0 && <span className="cv-gami-slide-count">{isFreeform ? '1 image' : `${slides.length} slides`}</span>}
      </div>

      {/* Freeform input when no script wired */}
      {!inputScript && (
        <div className="cv-gami-freeform">
          <textarea className="cv-gami-freeform-input" rows={3}
            placeholder="Describe anything in plain English... e.g. 'a dragon guarding a server room'"
            value={freeformText}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); setFreeformText(e.target.value); }} />
          {!freeformText.trim() && <div className="cv-gami-freeform-hint">Or wire a script to the left handle</div>}
          {freeformText.trim() && (
            <button className="cv-btn cv-btn-sm cv-gami-prompt-preview"
              onClick={(e) => { e.stopPropagation(); copyPrompt(); }}
              title="Copy the full composed prompt — paste into ChatGPT/Midjourney/etc. to compare against our pipeline's output before generating">
              {promptCopied ? 'Copied!' : 'Copy Prompt (preview)'}
            </button>
          )}
        </div>
      )}

      {/* Controls — show when script wired OR freeform has text */}
      {(inputScript || isFreeform) && (
        <div className="cv-gami-controls">
          <select className="cv-blotato-select" value={resolution} onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); setResolution(e.target.value); syncNodeData(id, { resolution: e.target.value }); }}>
            <option value="1K">1K</option><option value="2K">2K</option><option value="4K">4K</option>
          </select>
          <select className="cv-blotato-select" value={aspectRatio} onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); setAspectRatio(e.target.value); syncNodeData(id, { aspectRatio: e.target.value }); }}>
            <option value="1:1">1:1</option><option value="9:16">9:16</option><option value="16:9">16:9</option>
          </select>
          <select className="cv-blotato-select" value={style} onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); setStyle(e.target.value); }}
            title="Scene = emotional origami diorama. Infographic = data-viz layout with typography + callouts.">
            <option value="scene">Scene</option>
            <option value="infographic">Infographic</option>
          </select>
        </div>
      )}

      <div className="cv-blotato-field">
        <input className="cv-blotato-input" type={showKey ? 'text' : 'password'} placeholder="KIE API Key"
          value={apiKey} onClick={(e) => e.stopPropagation()} onChange={(e) => saveKey(e.target.value)} />
        <button className="cv-btn cv-btn-sm" title={showKey ? 'Hide key' : 'Show key'}
          onClick={(e) => { e.stopPropagation(); setShowKey(!showKey); }}>{showKey ? '◉' : '○'}</button>
      </div>

      {/* Batch progress bar */}
      {slideResults.length > 0 && (
        <div className="cv-gami-batch-bar">
          <div className="cv-gami-batch-progress">
            {slideResults.map((sr, i) => (
              <div key={i} className={`cv-gami-batch-pip cv-gami-pip-${sr.status || 'idle'}`}
                onClick={(e) => { e.stopPropagation(); setViewIndex(i); setExpanded(true); }}
                title={`Slide ${i + 1}: ${sr.status}`} />
            ))}
          </div>
          <span className="cv-gami-batch-stats">
            {doneCount}/{slides.length} done{genCount > 0 ? ` / ${genCount} gen` : ''}{errCount > 0 ? ` / ${errCount} err` : ''}
          </span>
        </div>
      )}

      {/* Slide viewer — toggle open/closed */}
      {slideResults.length > 0 && (
        <button className="cv-gami-viewer-toggle" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
          {expanded ? 'Hide Viewer' : 'View Slides'} ({doneCount} ready)
        </button>
      )}

      {expanded && slides.length > 0 && (
        <div className="cv-gami-viewer">
          {/* Navigation */}
          <div className="cv-gami-viewer-nav">
            <button className="cv-gami-nav-btn" disabled={safeIndex === 0} onClick={(e) => { e.stopPropagation(); prev(); }}>&#9664;</button>
            <span className="cv-gami-nav-label">Slide {safeIndex + 1} / {slides.length}</span>
            <button className="cv-gami-nav-btn" disabled={safeIndex >= slides.length - 1} onClick={(e) => { e.stopPropagation(); next(); }}>&#9654;</button>
          </div>

          {/* Slide text */}
          <div className="cv-gami-viewer-text">{currentSlide?.text || ''}</div>

          {/* Image or status */}
          {currentUrl ? (
            <div className="cv-gami-viewer-img-wrap">
              <img src={currentUrl} alt={`Slide ${safeIndex + 1}`} className="cv-gami-viewer-img"
                onClick={(e) => { e.stopPropagation(); window.open(currentUrl, '_blank'); }} />
              <div className="cv-gami-viewer-actions">
                <button className="cv-btn cv-btn-sm" onClick={(e) => { e.stopPropagation(); copyUrl(); }}>
                  {urlCopied ? 'Copied!' : 'Copy URL'}
                </button>
                <button className="cv-btn cv-btn-sm" onClick={(e) => { e.stopPropagation(); copyPrompt(); }}
                  disabled={!slidePrompts[safeIndex]}
                  title="Copy the full image prompt that produced this slide">
                  {promptCopied ? 'Copied!' : 'Copy Prompt'}
                </button>
              </div>
            </div>
          ) : currentResult?.status === 'polling' ? (
            <div className="cv-gami-viewer-pending">Generating... ({currentResult.elapsed || 0}s)</div>
          ) : currentResult?.status === 'error' ? (
            <div className="cv-gami-viewer-error">{currentResult.error}</div>
          ) : (
            <div className="cv-gami-viewer-pending">Pending</div>
          )}
        </div>
      )}

      {/* Generate */}
      <button className="cv-btn cv-btn-gami"
        disabled={slides.length === 0 || !apiKey || isGenerating}
        onClick={(e) => { e.stopPropagation(); onGamiArtBatchGenerate(id, apiKey, slidePrompts, resolution, aspectRatio); setExpanded(true); }}>
        {isGenerating ? `Generating ${genCount}/${slides.length}...`
          : isFreeform ? (doneCount > 0 ? 'Regenerate' : 'Generate Image')
          : doneCount > 0 ? `Regenerate All (${slides.length})` : `Generate All (${slides.length})`}
      </button>

      <Handle type="source" position={Position.Right} id="image-out" />
    </div>
  );
}

/* ===== CAROUSEL NODE — assembles 16-gami art + script into branded slides ===== */
const CAROUSEL_FORMATS = [
  { id: 'image_body', label: 'Image + Text', desc: 'Centered image with text above or below' },
  { id: 'hook_image', label: 'Hook + Image', desc: 'Slide 1 as hook, rest as image+text' },
  { id: 'text_only',  label: 'Text Only',     desc: 'Pure typography — bold headline + body, no image needed' },
  { id: 'terminal',   label: 'Terminal',      desc: 'Editorial chrome + styled CLI block, slide content as bullet output' },
];

// Per-carousel default header strings for terminal_body slides. Constants in v1;
// can be exposed in the node UI later if you want per-carousel customization.
const TERMINAL_DEFAULT_HEADER   = 'Claude Code v2.1.87';
const TERMINAL_DEFAULT_SUBTITLE = 'Opus 4.7 (1M context) - Claude Max';
const TERMINAL_DEFAULT_CWD      = '~/breadstick';

// Split a slide line into headline + body for text_only format. First sentence
// (or sentence-like fragment) becomes the bold headline; the rest is the body.
function splitSlideForTextOnly(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return { title: '', text: '' };
  const m = trimmed.match(/^(.+?[.!?])\s+(.+)$/);
  if (m) return { title: m[1].trim(), text: m[2].trim() };
  return { title: trimmed, text: '' };
}

// Build a Win95-style terminal slide — terminal fills the slide (no editorial
// title above), Microsoft 95 boot text intro, then the story types after the
// C:\WINDOWS> prompt as plain output lines.
function buildTerminalSlideWin95(slideText) {
  const trimmed = (slideText || '').trim();
  const sentences = trimmed.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  const lines = sentences.length > 0
    ? sentences.map((s) => ({ kind: 'normal', text: s }))
    : [{ kind: 'normal', text: trimmed }];
  return {
    title: '',
    text: '',
    terminal: {
      style: 'win95',
      full_slide: true,
      title_bar: 'Command Prompt',
      boot_lines: [
        'Microsoft(R) Windows 95',
        '   (C)Copyright Microsoft Corp 1981-1995.',
      ],
      prompt: 'C:\\WINDOWS>',
      lines,
    },
  };
}

// Build a mechanical terminal block from a script slide. First sentence becomes
// the headline above the terminal; remaining sentences become bullet output
// lines with kind alternating between `result` and a final `success`.
function buildTerminalSlide(slideText, _slideNum) {
  const trimmed = (slideText || '').trim();
  const sentences = trimmed.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  const first = sentences[0] || trimmed;
  const rest = sentences.slice(1);
  const stripDot = (s) => s.replace(/\.+$/, '');
  const lines = rest.length > 0
    ? rest.map((s, i) => ({
        kind: i === rest.length - 1 ? 'success' : 'result',
        text: stripDot(s),
      }))
    : [{ kind: 'success', text: stripDot(first) }];
  return {
    title: first,
    text: '',
    terminal: {
      header: TERMINAL_DEFAULT_HEADER,
      subtitle: TERMINAL_DEFAULT_SUBTITLE,
      cwd: TERMINAL_DEFAULT_CWD,
      // No prompt — chrome is baked, only message types
      lines,
    },
  };
}

const CAROUSEL_TEMPLATES = [
  { id: 'skyframe',       label: 'Skyframe',       desc: 'Particles, Audiowide, yellow/cyan' },
  { id: 'plain-blue',     label: 'Plain Blue',     desc: 'Dark navy editorial, blue accents, serif headlines' },
  { id: 'plain-black',    label: 'Plain Black',    desc: 'Pure black editorial, blue accents, serif headlines' },
  { id: 'plain-white',    label: 'Plain White',    desc: 'Clean white editorial, darker blue accents for contrast' },
  { id: 'windows-retro',  label: 'Windows Retro',  desc: 'Win95 desktop + Command Prompt — story types in terminal' },
];

// Art zone aspect ratios — mirrors ART_ZONES in carousels/render.py
const CAROUSEL_ASPECTS = [
  { id: '1:1',  label: 'Square 1:1' },
  { id: '16:9', label: 'Wide 16:9' },
  { id: '9:16', label: 'Tall 9:16' },
];

function CarouselNode({ id }) {
  const { edges, nodeOutputs, script, onCarouselRender, onRunLane, laneRun, syncNodeData } = useContext(CanvasCtx);
  const [templateId, setTemplateId] = useState('skyframe');
  const [format, setFormat] = useState('image_body');
  const [textPos, setTextPos] = useState('bottom');
  const [artAspect, setArtAspect] = useState('1:1');
  const [theme, setTheme] = useState('dark');
  const [animate, setAnimate] = useState(false);
  const [handle, setHandle] = useState('@yourhandle');
  const [tagText, setTagText] = useState('YOUR PROJECT');
  const [upperRight, setUpperRight] = useState('');
  const [lowerRight, setLowerRight] = useState('swipe for more');
  const [viewIndex, setViewIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const [gateBypass, setGateBypass] = useState(false);
  const [gateExpand, setGateExpand] = useState(false);

  // Trace inputs: find art images + script text — computed every render (no useMemo)
  const inEdges = edges?.filter(e => e.target === id) || [];
  let _images = [];
  let _slides = [];
  let _scriptText = null;

  // 1. Collect direct + one-hop-upstream source IDs
  const _sourceIds = new Set();
  for (const edge of inEdges) {
    _sourceIds.add(edge.source);
    const upEdges = edges?.filter(e => e.target === edge.source) || [];
    for (const ue of upEdges) _sourceIds.add(ue.source);
  }

  // 2. Check collected sources for script and images
  for (const srcId of _sourceIds) {
    const src = nodeOutputs?.[srcId];
    if (!src) continue;
    if (src.slides?.length && _images.length === 0) {
      _images = src.slides.filter(s => s.status === 'done' && s.url).map(s => s.url);
    }
    if (src.script && !_scriptText) {
      _scriptText = src.script;
    }
  }

  // 3. Fallback: scan ALL nodeOutputs for any slides (handles edge-tracing gaps)
  if (_images.length === 0 && inEdges.length > 0) {
    for (const [nid, out] of Object.entries(nodeOutputs || {})) {
      if (nid === id) continue;
      if (out.slides?.length) {
        const done = out.slides.filter(s => s.status === 'done' && s.url);
        if (done.length > 0) { _images = done.map(s => s.url); break; }
      }
    }
  }

  // 4. Fall back to global script
  if (!_scriptText && inEdges.length > 0 && script) _scriptText = script;

  // 5. Parse script into slide texts
  if (_scriptText) {
    const lines = _scriptText.split('\n').filter(l => l.trim().length > 0);
    for (const line of lines) {
      const match = line.match(/^\d+[.):\s]+(.+)/);
      if (match) _slides.push(match[1].trim());
    }
    if (_slides.length === 0) _slides = lines.filter(l => !l.startsWith('[')).map(l => l.trim());
  }

  const inputs = { images: _images, slides: _slides, scriptText: _scriptText };

  const result = nodeOutputs?.[id] || {};
  const renderedSlides = result.renderedSlides || [];
  const renderStatus = result.renderStatus || 'idle';
  const terminalAnimations = result.terminalAnimations || [];
  const animateStatus = result.animateStatus || 'idle';
  const animDoneCount = terminalAnimations.filter(a => a.status === 'done').length;

  const safeIndex = Math.min(viewIndex, Math.max(renderedSlides.length - 1, 0));
  const currentSlideUrl = renderedSlides[safeIndex] || '';

  const copyUrl = async () => {
    if (currentSlideUrl) {
      await navigator.clipboard.writeText(`http://localhost:3001${currentSlideUrl}`).catch(() => {});
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 1500);
    }
  };

  // Content slide count — script-derived; exclude the extra CTA art from 16-GAMI
  const contentCount = inputs.slides.length > 0 ? inputs.slides.length : inputs.images.length;
  const renderCount = contentCount > 0 ? contentCount + 1 : 0; // +1 for CTA

  // Ship gate on the outbound script — carousel art goes to Drive then to public feeds.
  const gateVerdict = _scriptText ? scanText(_scriptText) : null;
  const gateBlocking = gateVerdict && gateVerdict.verdict !== 'SHIP' && !gateBypass;

  const handleRender = () => {
    // Shared corner chrome for every slide
    const corners = {
      tag: tagText,
      upper_right: upperRight,
      lower_right: lowerRight,
    };
    const configSlides = [];
    for (let i = 0; i < contentCount; i++) {
      const text = inputs.slides[i] || '';
      const hasImage = !!inputs.images[i];
      if (format === 'text_only') {
        const { title, text: body } = splitSlideForTextOnly(text);
        configSlides.push({ type: 'body', ...corners, title, text: body });
      } else if (format === 'terminal') {
        const term = templateId === 'windows-retro'
          ? buildTerminalSlideWin95(text)
          : buildTerminalSlide(text, i + 1);
        configSlides.push({ type: 'terminal_body', ...corners, ...term });
      } else if (format === 'hook_image' && i === 0) {
        configSlides.push({ type: 'hook', ...corners, text, subtitle: '' });
      } else {
        configSlides.push({
          type: 'image_body',
          ...corners,
          image: hasImage ? `art_${i + 1}.png` : null,
          text,
          text_position: textPos,
          art_aspect: artAspect,
        });
      }
    }
    // CTA slide — terminal carousels get a CTA terminal so it animates with
    // the rest; text_only gets a typographic CTA; image carousels use the
    // closer image.
    if (contentCount > 0) {
      const ctaIdx = contentCount;
      if (format === 'terminal') {
        const ctaText = 'Follow @yourhandle for more.';
        const ctaTerm = templateId === 'windows-retro'
          ? buildTerminalSlideWin95(ctaText)
          : buildTerminalSlide(ctaText, contentCount + 1);
        configSlides.push({
          type: 'terminal_body',
          ...corners,
          ...ctaTerm,
          lower_right: 'save for later',
        });
      } else if (format === 'text_only') {
        configSlides.push({
          type: 'body',
          ...corners,
          title: 'Follow for more.',
          text: 'Cybersecurity and AI stories.',
          lower_right: 'save for later',
        });
      } else {
        configSlides.push({
          type: 'cta_follow',
          ...corners,
          image: inputs.images[ctaIdx] ? `art_${ctaIdx + 1}.png` : null,
          text: 'Follow for more Cybersecurity and AI Stories',
          handle_overlay: '@yourhandle',
          lower_right: 'save for later',
          art_aspect: artAspect,
        });
      }
    }
    const tplName = CAROUSEL_TEMPLATES.find(t => t.id === templateId)?.label || 'Skyframe';
    const config = {
      title: 'Generated Carousel',
      template: templateId,
      profile: { display_name: tplName, handle },
      theme,
      slides: configSlides,
    };
    // Mirror the assembled config into node.data so the executeGraph carousel
    // executor can re-render this node. Engine lane runs use the LAST config
    // built here — a never-rendered carousel node has no config yet.
    syncNodeData(id, { config });
    onCarouselRender(id, config, inputs.images, { animate: animate && format === 'terminal' });
  };

  return (
    <div className={`cv-node cv-carousel cv-carousel-${renderStatus}`}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="art-in" style={{ top: '30%' }} />
      <Handle type="target" position={Position.Left} id="script-in" style={{ top: '70%' }} />

      <div className="cv-carousel-header">
        <span className="cv-carousel-icon">▤</span>
        <span className="cv-carousel-title">Carousel</span>
        <span className="cv-carousel-badge">{CAROUSEL_TEMPLATES.find(t => t.id === templateId)?.label || 'Skyframe'}</span>
      </div>

      {/* Input status */}
      <div className="cv-carousel-inputs">
        <div className="cv-carousel-input-row">
          <span className={`cv-carousel-input-dot ${inputs.images.length > 0 ? 'active' : ''}`} />
          <span>{inputs.images.length > 0 ? `${inputs.images.length} images` : 'No images wired'}</span>
        </div>
        <div className="cv-carousel-input-row">
          <span className={`cv-carousel-input-dot ${inputs.slides.length > 0 ? 'active' : ''}`} />
          <span>{inputs.slides.length > 0 ? `${inputs.slides.length} text slides` : 'No script wired'}</span>
        </div>
      </div>

      {/* Template + format + position + theme toggles */}
      <div className="cv-carousel-controls">
        <select className="cv-blotato-select cv-carousel-template-select" value={templateId} onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); setTemplateId(e.target.value); }}>
          {CAROUSEL_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <select className="cv-blotato-select" value={format} onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); setFormat(e.target.value); }}>
          {CAROUSEL_FORMATS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
        <select className="cv-blotato-select" value={textPos} onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); setTextPos(e.target.value); }}>
          <option value="bottom">Text Bottom</option>
          <option value="top">Text Top</option>
        </select>
        <select className="cv-blotato-select" value={artAspect} onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); setArtAspect(e.target.value); }} title="Art zone aspect ratio">
          {CAROUSEL_ASPECTS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
        <select className="cv-blotato-select" value={theme} onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); setTheme(e.target.value); }}>
          <option value="dark">Flat Black</option>
          <option value="light">Flat White</option>
        </select>
        {format === 'terminal' && (
          <label
            className="cv-blotato-select"
            onClick={(e) => e.stopPropagation()}
            title="Render typing-animation mp4 per terminal slide via Remotion (~3-5 min/slide)"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}
          >
            <input
              type="checkbox"
              checked={animate}
              onChange={(e) => { e.stopPropagation(); setAnimate(e.target.checked); }}
              style={{ margin: 0 }}
            />
            <span>Animate</span>
          </label>
        )}
      </div>

      {/* Corner text inputs — 2x2 grid matching slide corners */}
      <div className="cv-carousel-corners">
        <div className="cv-carousel-corner-row">
          <input className="cv-carousel-corner-input" type="text" placeholder="Upper left (tag)"
            value={tagText} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => setTagText(e.target.value)} title="Upper left — tag badge" />
          <input className="cv-carousel-corner-input" type="text" placeholder="Upper right"
            value={upperRight} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => setUpperRight(e.target.value)} title="Upper right (inset for IG index)" />
        </div>
        <div className="cv-carousel-corner-row">
          <input className="cv-carousel-corner-input" type="text" placeholder="Lower left (@handle)"
            value={handle} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => setHandle(e.target.value)} title="Lower left — @handle" />
          <input className="cv-carousel-corner-input" type="text" placeholder="Lower right"
            value={lowerRight} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => setLowerRight(e.target.value)} title="Lower right (inset for IG mute)" />
        </div>
      </div>

      {/* Rendered slides viewer */}
      {renderedSlides.length > 0 && (
        <button className="cv-gami-viewer-toggle" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
          {expanded ? 'Hide Slides' : 'View Slides'} ({renderedSlides.length})
        </button>
      )}

      {expanded && renderedSlides.length > 0 && (
        <div className="cv-carousel-viewer">
          <div className="cv-gami-viewer-nav">
            <button className="cv-gami-nav-btn" disabled={safeIndex === 0}
              onClick={(e) => { e.stopPropagation(); setViewIndex(i => Math.max(0, i - 1)); }}>&#9664;</button>
            <span className="cv-gami-nav-label">Slide {safeIndex + 1} / {renderedSlides.length}</span>
            <button className="cv-gami-nav-btn" disabled={safeIndex >= renderedSlides.length - 1}
              onClick={(e) => { e.stopPropagation(); setViewIndex(i => Math.min(renderedSlides.length - 1, i + 1)); }}>&#9654;</button>
          </div>
          <img src={`http://localhost:3001${currentSlideUrl}`} alt={`Slide ${safeIndex + 1}`}
            className="cv-carousel-slide-img"
            onClick={(e) => { e.stopPropagation(); window.open(`http://localhost:3001${currentSlideUrl}`, '_blank'); }} />
          <div className="cv-carousel-viewer-actions">
            <button className="cv-btn cv-btn-sm" onClick={(e) => { e.stopPropagation(); copyUrl(); }}>
              {urlCopied ? 'Copied!' : 'Copy URL'}
            </button>
            <button className="cv-btn cv-btn-sm" onClick={async (e) => {
              e.stopPropagation();
              const resp = await fetch(`http://localhost:3001${currentSlideUrl}`);
              const blob = await resp.blob();
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `slide_${safeIndex + 1}.png`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}>Download</button>
          </div>
          {/* Download All */}
          <button className="cv-btn cv-btn-sm cv-btn-download-all" onClick={async (e) => {
            e.stopPropagation();
            for (let i = 0; i < renderedSlides.length; i++) {
              const resp = await fetch(`http://localhost:3001${renderedSlides[i]}`);
              const blob = await resp.blob();
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `slide_${i + 1}.png`;
              a.click();
              URL.revokeObjectURL(a.href);
            }
          }}>
            Download All ({renderedSlides.length})
          </button>
        </div>
      )}

      {/* Render status */}
      {renderStatus === 'rendering' && <div className="cv-carousel-status">Rendering slides...</div>}
      {renderStatus === 'error' && <div className="cv-carousel-status cv-carousel-error">{result.error}</div>}

      {/* Terminal animation status (Stage 3 — Remotion typing animation) */}
      {terminalAnimations.length > 0 && (
        <div className="cv-carousel-status" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div>
            {animateStatus === 'animating'
              ? `Animating terminals — ${animDoneCount}/${terminalAnimations.length}`
              : animateStatus === 'done'
                ? `Animated ${animDoneCount}/${terminalAnimations.length} terminals`
                : `Animation status: ${animateStatus}`}
          </div>
          {terminalAnimations.map((a) => {
            const lineColor = a.status === 'done' ? '#5fd1b8'
              : a.status === 'error' ? '#e74c3c'
              : a.status === 'rendering' ? '#f4a261'
              : '#888';
            return (
            <div key={a.slideIdx} style={{ fontSize: 11, opacity: 0.95, display: 'flex', justifyContent: 'space-between', color: lineColor }}>
              <span>slide_{a.slideIdx}: {a.status}{a.durationSec ? ` · ${a.durationSec.toFixed(1)}s` : ''}{a.error ? ` · ${a.error}` : ''}</span>
              {a.url && (
                <a
                  href={`http://localhost:3001${a.url}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{ marginLeft: 8 }}
                >
                  open mp4
                </a>
              )}
            </div>
            );
          })}
        </div>
      )}

      {gateVerdict && gateVerdict.verdict !== 'SHIP' && (
        <div className={`cv-gate cv-gate-${gateVerdict.verdict.toLowerCase()}`}>
          <div className="cv-gate-row">
            <span className="cv-gate-badge">⬢ {gateVerdict.verdict}</span>
            <span className="cv-gate-meta">
              {gateVerdict.violations.length} signature{gateVerdict.violations.length === 1 ? '' : 's'} · taint {Math.round(gateVerdict.taintScore * 100)}%
            </span>
          </div>
          <button className="cv-gate-expand" onClick={(e) => { e.stopPropagation(); setGateExpand(v => !v); }}>
            {gateExpand ? '▾ hide' : '▸ show detail'}
          </button>
          {gateExpand && (
            <div className="cv-gate-detail">
              {gateVerdict.violations.map((v, i) => (
                <div key={i} className="cv-gate-line">
                  <span className="cv-gate-vtype">{v.type}</span>
                  <span className="cv-gate-vmatch">"{v.match}"</span>
                </div>
              ))}
            </div>
          )}
          {!gateBypass ? (
            <button className="cv-gate-bypass" onClick={(e) => { e.stopPropagation(); setGateBypass(true); }}>
              bypass gate (not recommended)
            </button>
          ) : (
            <span className="cv-gate-bypassed">gate bypassed — render at own risk</span>
          )}
        </div>
      )}

      {/* Run Lane — executeGraph engine runs the whole upstream lane */}
      <button
        onClick={() => onRunLane(id)}
        disabled={laneRun.status === 'running'}
        style={{
          width: '100%', padding: '6px 10px', marginBottom: 6, border: 'none', borderRadius: 6,
          cursor: laneRun.status === 'running' ? 'wait' : 'pointer', fontWeight: 700, fontSize: 11,
          background: 'linear-gradient(135deg, #C9A227, #8a6d1a)', color: '#fff',
        }}
      >
        {laneRun.status === 'running' && laneRun.targetId === id ? '⏳ Running lane…' : '▶ Run Lane'}
      </button>
      {laneRun.status === 'error' && laneRun.targetId === id && (
        <div style={{ fontSize: 10, color: '#ff6b6b', marginBottom: 6 }}>{laneRun.error}</div>
      )}

      {/* Render button */}
      <button className="cv-btn cv-btn-carousel"
        disabled={renderCount === 0 || renderStatus === 'rendering' || animateStatus === 'animating' || gateBlocking}
        onClick={(e) => { e.stopPropagation(); handleRender(); }}>
        {renderStatus === 'rendering'
          ? 'Rendering...'
          : animateStatus === 'animating'
            ? `Animating ${animDoneCount}/${terminalAnimations.length}...`
            : renderedSlides.length > 0
              ? `Re-render (${renderCount})${animate && format === 'terminal' ? ' + Animate' : ''}`
              : `Render Carousel (${renderCount})${animate && format === 'terminal' ? ' + Animate' : ''}`}
      </button>

      <Handle type="source" position={Position.Right} id="carousel-out" />
    </div>
  );
}

/* ===== VIDEO PROMPT NODE — batch motion prompts from images + script ===== */
const MOTION_STYLES = [
  { id: 'origami-unfold', label: 'Origami Unfold', desc: 'Paper folds open to reveal the story, crease lines bend, layers separate and settle' },
  { id: 'paper-physics', label: 'Paper Physics', desc: 'Stop-motion paper blocks folding, everything else frozen, loop-friendly' },
  { id: 'gentle-ambient', label: 'Gentle Ambient', desc: 'Slow drift, particle float, soft lighting shifts' },
  { id: 'dramatic-reveal', label: 'Dramatic Reveal', desc: 'Camera pull, light sweep, scale shift' },
  { id: 'kinetic-energy', label: 'Kinetic Energy', desc: 'Rapid movement, dynamic angles, impact' },
];

function VideoPromptNode({ id }) {
  const { edges, nodeOutputs, script, anthropicApiKey, onVideoPromptBatchGenerate } = useContext(CanvasCtx);
  const [style, setStyle] = useState('paper-physics');
  const [viewIndex, setViewIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  // Trace inputs: ALL image URLs + script text
  const inEdges = edges?.filter(e => e.target === id) || [];
  let allImages = [];
  let scriptText = null;

  for (const edge of inEdges) {
    const src = nodeOutputs?.[edge.source];
    if (!src) continue;
    if (src.slides?.length && allImages.length === 0) {
      allImages = src.slides.filter(s => s.status === 'done' && s.url).map(s => s.url);
    }
    if (src.url && allImages.length === 0) allImages = [src.url];
    if (src.script && !scriptText) scriptText = src.script;
  }
  if (!scriptText && inEdges.length > 0 && script) scriptText = script;
  // Fallback scan
  if (allImages.length === 0 && inEdges.length > 0) {
    for (const [nid, out] of Object.entries(nodeOutputs || {})) {
      if (nid === id) continue;
      if (out.slides?.length) {
        const done = out.slides.filter(s => s.status === 'done' && s.url);
        if (done.length > 0) { allImages = done.map(s => s.url); break; }
      }
    }
  }

  // Parse script slides for per-image context
  let scriptSlides = [];
  if (scriptText) {
    const lines = scriptText.split('\n').filter(l => l.trim());
    for (const line of lines) {
      const match = line.match(/^\d+[.):\s]+(.+)/);
      if (match) scriptSlides.push(match[1].trim());
    }
    if (scriptSlides.length === 0) scriptSlides = lines.filter(l => !l.startsWith('[')).map(l => l.trim());
  }

  const result = nodeOutputs?.[id] || {};
  const batchStatus = result.batchStatus || 'idle';
  const prompts = result.prompts || []; // [{ status, videoPrompt, imageUrl }]
  const doneCount = prompts.filter(p => p.status === 'done').length;
  const genCount = prompts.filter(p => p.status === 'generating').length;
  const hasApiKey = !!anthropicApiKey;

  const safeIndex = Math.min(viewIndex, Math.max(prompts.length - 1, 0));
  const currentPrompt = prompts[safeIndex];

  const copyPrompt = async () => {
    if (!currentPrompt?.videoPrompt) return;
    await navigator.clipboard.writeText(currentPrompt.videoPrompt).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`cv-node cv-vidprompt cv-vidprompt-${batchStatus}`}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="art-in" style={{ top: '30%' }} />
      <Handle type="target" position={Position.Left} id="script-in" style={{ top: '70%' }} />

      <div className="cv-vidprompt-header">
        <span className="cv-vidprompt-icon">▶</span>
        <span className="cv-vidprompt-title">Video Prompt</span>
        {allImages.length > 0 && <span className="cv-gami-slide-count">{allImages.length} images</span>}
      </div>

      {/* Input status */}
      <div className="cv-carousel-inputs">
        <div className="cv-carousel-input-row">
          <span className={`cv-carousel-input-dot ${allImages.length > 0 ? 'active' : ''}`} />
          <span>{allImages.length > 0 ? `${allImages.length} images` : 'No images wired'}</span>
        </div>
        <div className="cv-carousel-input-row">
          <span className={`cv-carousel-input-dot ${scriptText ? 'active' : ''}`} />
          <span>{scriptText ? 'Script ready' : 'No script wired'}</span>
        </div>
      </div>

      {/* Motion style */}
      <div className="cv-vidprompt-styles">
        {MOTION_STYLES.map(s => (
          <button key={s.id} className={`cv-niche-tone ${style === s.id ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setStyle(s.id); }} title={s.desc}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Batch progress */}
      {prompts.length > 0 && (
        <div className="cv-gami-batch-bar">
          <div className="cv-gami-batch-progress">
            {prompts.map((p, i) => (
              <div key={i} className={`cv-gami-batch-pip cv-gami-pip-${p.status || 'idle'}`}
                onClick={(e) => { e.stopPropagation(); setViewIndex(i); setExpanded(true); }} />
            ))}
          </div>
          <span className="cv-gami-batch-stats">{doneCount}/{prompts.length}</span>
        </div>
      )}

      {/* Viewer toggle */}
      {prompts.length > 0 && (
        <button className="cv-gami-viewer-toggle" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
          {expanded ? 'Hide' : 'View Prompts'} ({doneCount} ready)
        </button>
      )}

      {expanded && prompts.length > 0 && (
        <div className="cv-gami-viewer">
          <div className="cv-gami-viewer-nav">
            <button className="cv-gami-nav-btn" disabled={safeIndex === 0} onClick={(e) => { e.stopPropagation(); setViewIndex(i => Math.max(0, i - 1)); }}>&#9664;</button>
            <span className="cv-gami-nav-label">{safeIndex + 1} / {prompts.length}</span>
            <button className="cv-gami-nav-btn" disabled={safeIndex >= prompts.length - 1} onClick={(e) => { e.stopPropagation(); setViewIndex(i => Math.min(prompts.length - 1, i + 1)); }}>&#9654;</button>
          </div>
          {currentPrompt?.videoPrompt && (
            <div className="cv-niche-preview" style={{ margin: '4px 0' }}>{currentPrompt.videoPrompt}</div>
          )}
          {currentPrompt?.status === 'generating' && <div className="cv-gami-viewer-pending">Generating...</div>}
          {currentPrompt?.status === 'error' && <div className="cv-gami-viewer-error">{currentPrompt.error}</div>}
          {currentPrompt?.videoPrompt && (
            <button className="cv-btn cv-btn-sm" onClick={(e) => { e.stopPropagation(); copyPrompt(); }}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          )}
        </div>
      )}

      {result.error && <div className="cv-niche-error">{result.error}</div>}

      {/* Generate All */}
      <button className="cv-btn cv-btn-vidprompt"
        disabled={allImages.length === 0 || !hasApiKey || batchStatus === 'generating'}
        onClick={(e) => { e.stopPropagation(); onVideoPromptBatchGenerate(id, allImages, scriptSlides, style); setExpanded(true); }}>
        {batchStatus === 'generating' ? `Generating ${genCount}/${allImages.length}...` : doneCount > 0 ? `Regenerate All (${allImages.length})` : `Generate All (${allImages.length})`}
      </button>
      {!hasApiKey && <div className="cv-niche-hint">Set Anthropic API key in the API panel</div>}

      <Handle type="source" position={Position.Right} id="vidprompt-out" />
    </div>
  );
}

/* ===== KIE IMG2VID NODE — batch image-to-video via Kling ===== */
const IMG2VID_MODELS = [
  { id: 'kling-2.6/image-to-video', label: 'Kling 2.6' },
  { id: 'kling-image-to-video', label: 'Kling (generic)' },
  { id: 'minimax-image-to-video', label: 'MiniMax' },
];

function KieImg2VidNode({ id }) {
  const { edges, nodeOutputs, onKieImg2VidBatchGenerate } = useContext(CanvasCtx);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('kie-api-key') || '');
  const [modelId, setModelId] = useState(IMG2VID_MODELS[0].id);
  const [customModel, setCustomModel] = useState('');
  const [duration, setDuration] = useState(5);
  const [viewIndex, setViewIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const saveKey = (v) => { setApiKey(v); localStorage.setItem('kie-api-key', v); };
  const activeModel = customModel.trim() || modelId;

  // Trace inputs: array of { videoPrompt, imageUrl } from Video Prompt node
  const inEdges = edges?.filter(e => e.target === id) || [];
  let inputPairs = []; // [{ videoPrompt, imageUrl }]

  for (const edge of inEdges) {
    const src = nodeOutputs?.[edge.source];
    if (!src) continue;
    // Batch prompts from Video Prompt node
    if (src.prompts?.length) {
      inputPairs = src.prompts.filter(p => p.status === 'done' && p.videoPrompt && p.imageUrl)
        .map(p => ({ videoPrompt: p.videoPrompt, imageUrl: p.imageUrl }));
    }
    // Single prompt (legacy)
    if (src.videoPrompt && src.imageUrl && inputPairs.length === 0) {
      inputPairs = [{ videoPrompt: src.videoPrompt, imageUrl: src.imageUrl }];
    }
  }
  // Fallback scan
  if (inputPairs.length === 0 && inEdges.length > 0) {
    for (const [nid, out] of Object.entries(nodeOutputs || {})) {
      if (nid === id) continue;
      if (out.prompts?.length) {
        inputPairs = out.prompts.filter(p => p.status === 'done' && p.videoPrompt && p.imageUrl)
          .map(p => ({ videoPrompt: p.videoPrompt, imageUrl: p.imageUrl }));
        if (inputPairs.length > 0) break;
      }
    }
  }

  const result = nodeOutputs?.[id] || {};
  const videos = result.videos || [];
  const batchStatus = result.batchStatus || 'idle';
  const doneCount = videos.filter(v => v.status === 'done').length;
  const genCount = videos.filter(v => v.status === 'polling' || v.status === 'submitting').length;

  const safeIndex = Math.min(viewIndex, Math.max(videos.length - 1, 0));
  const currentVideo = videos[safeIndex];
  const currentUrl = currentVideo?.url || '';

  const copyUrl = async () => { if (currentUrl) { await navigator.clipboard.writeText(currentUrl).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); } };

  return (
    <div className="cv-node cv-kie cv-kie-img2vid">
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="vidprompt-in" />

      <div className="cv-kie-header">
        <div className="cv-kie-dot" />
        <span>KIE.AI</span>
        <span className="cv-kie-model">img2vid</span>
        {inputPairs.length > 0 && <span className="cv-gami-slide-count">{inputPairs.length} clips</span>}
      </div>

      {/* Input status */}
      <div className="cv-carousel-inputs">
        <div className="cv-carousel-input-row">
          <span className={`cv-carousel-input-dot ${inputPairs.length > 0 ? 'active' : ''}`} />
          <span>{inputPairs.length > 0 ? `${inputPairs.length} prompt+image pairs` : 'No prompts wired'}</span>
        </div>
      </div>

      {/* Model + duration */}
      <div className="cv-kie-controls">
        <select className="cv-blotato-select" value={modelId} onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); setModelId(e.target.value); }}>
          {IMG2VID_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <select className="cv-blotato-select" value={duration} onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); setDuration(Number(e.target.value)); }}>
          <option value={5}>5s</option><option value={10}>10s</option>
        </select>
      </div>

      <div className="cv-blotato-field">
        <input className="cv-blotato-input" type="text" placeholder="Custom model (overrides dropdown)"
          value={customModel} onClick={(e) => e.stopPropagation()} onChange={(e) => setCustomModel(e.target.value)} />
      </div>
      <div className="cv-blotato-field">
        <input className="cv-blotato-input" type="password" placeholder="KIE API Key"
          value={apiKey} onClick={(e) => e.stopPropagation()} onChange={(e) => saveKey(e.target.value)} />
      </div>

      {/* Batch progress */}
      {videos.length > 0 && (
        <div className="cv-gami-batch-bar">
          <div className="cv-gami-batch-progress">
            {videos.map((v, i) => (
              <div key={i} className={`cv-gami-batch-pip cv-gami-pip-${v.status || 'idle'}`}
                onClick={(e) => { e.stopPropagation(); setViewIndex(i); setExpanded(true); }} />
            ))}
          </div>
          <span className="cv-gami-batch-stats">{doneCount}/{videos.length}</span>
        </div>
      )}

      {/* Viewer */}
      {videos.length > 0 && (
        <button className="cv-gami-viewer-toggle" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
          {expanded ? 'Hide' : 'View Videos'} ({doneCount} ready)
        </button>
      )}

      {expanded && videos.length > 0 && (
        <div className="cv-gami-viewer">
          <div className="cv-gami-viewer-nav">
            <button className="cv-gami-nav-btn" disabled={safeIndex === 0} onClick={(e) => { e.stopPropagation(); setViewIndex(i => Math.max(0, i - 1)); }}>&#9664;</button>
            <span className="cv-gami-nav-label">Clip {safeIndex + 1} / {videos.length}</span>
            <button className="cv-gami-nav-btn" disabled={safeIndex >= videos.length - 1} onClick={(e) => { e.stopPropagation(); setViewIndex(i => Math.min(videos.length - 1, i + 1)); }}>&#9654;</button>
          </div>

          {currentUrl ? (
            <div className="cv-vid-preview">
              <video src={currentUrl} controls className="cv-vid-player" onClick={(e) => e.stopPropagation()} />
              <button className="cv-btn cv-btn-sm" onClick={(e) => { e.stopPropagation(); copyUrl(); }}>
                {copied ? 'Copied!' : 'Copy URL'}
              </button>
            </div>
          ) : currentVideo?.status === 'polling' ? (
            <div className="cv-gami-viewer-pending">Generating... ({Math.floor((currentVideo.elapsed||0)/60)}m {(currentVideo.elapsed||0)%60}s)</div>
          ) : currentVideo?.status === 'error' ? (
            <div className="cv-gami-viewer-error">{currentVideo.error}</div>
          ) : (
            <div className="cv-gami-viewer-pending">Pending</div>
          )}
        </div>
      )}

      {/* Generate */}
      <button className="cv-btn cv-btn-kie"
        disabled={inputPairs.length === 0 || !apiKey || batchStatus === 'generating'}
        onClick={(e) => { e.stopPropagation(); onKieImg2VidBatchGenerate(id, apiKey, activeModel, inputPairs, duration); setExpanded(true); }}>
        {batchStatus === 'generating' ? `Generating ${genCount}/${inputPairs.length}...` : doneCount > 0 ? `Regenerate All (${inputPairs.length})` : `Generate All (${inputPairs.length})`}
      </button>
      <Handle type="source" position={Position.Right} id="video-out" />
    </div>
  );
}

/* ===== TITLE CARD NODE — 16-gami text-on-paper first frames via Nano Banana ===== */
const TITLE_CARD_STYLE = `High-resolution product photograph of a physical piece of aged paper resting on a wooden desk surface. The paper has hand-written text in bold, slightly imperfect lettering — as if written with a thick marker or brush pen on textured cardstock. Stair-stepped pixelated aesthetic merged with traditional origami folds on the paper edges. Multi-layered 3D cardstock construction visible at the paper borders — folded, creased edges with torn fiber detail. Soft directional lighting creating distinct drop shadows between the paper and desk. Hyper-realistic tangible texture. 16-bit jagged physics reinforced by fold geometry. The desk has subtle props: a pencil, paper clips, or a coffee ring stain. Shallow depth of field. Warm, nostalgic studio lighting.`;

function buildTitleCardPrompt(slideText) {
  // Extract a short title from the slide text (first sentence or first 8 words)
  const words = slideText.split(/\s+/);
  const title = words.length > 8 ? words.slice(0, 8).join(' ') + '...' : slideText;
  return `${TITLE_CARD_STYLE}\n\nThe text written on the paper reads: "${title}"\n\nThe paper sits naturally on a warm wooden desk. The handwriting is bold and legible, slightly imperfect like real handwriting. The paper has origami-style folded edges with visible cardstock layers. Environment props are minimal and desk-appropriate.`;
}

function TitleCardNode({ id }) {
  const { edges, nodeOutputs, onTitleCardBatchGenerate } = useContext(CanvasCtx);
  const [aspectRatio, setAspectRatio] = useState('9:16');
  const [resolution, setResolution] = useState('2K');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('kie-api-key') || '');
  const [showKey, setShowKey] = useState(false);
  const [viewIndex, setViewIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);

  const saveKey = (v) => { setApiKey(v); localStorage.setItem('kie-api-key', v); };

  // Trace input script from wired node
  const inputScript = (() => {
    const inEdge = edges?.find(e => e.target === id);
    if (!inEdge) return null;
    const sourceOutput = nodeOutputs?.[inEdge.source];
    if (sourceOutput?.script) return sourceOutput.script;
    return null;
  })();

  const slides = (() => {
    const parsed = inputScript ? parseSlides(inputScript) : [];
    if (parsed.length > 0) parsed.push({ num: parsed.length + 1, text: 'Follow for more Cybersecurity and AI stories', isCta: true });
    return parsed;
  })();
  const slidePrompts = slides.map(s => buildTitleCardPrompt(s.text));

  const result = nodeOutputs?.[id] || {};
  const slideResults = result.slides || [];
  const batchStatus = result.batchStatus || 'idle';

  const doneCount = slideResults.filter(s => s.status === 'done').length;
  const genCount = slideResults.filter(s => s.status === 'polling' || s.status === 'submitting').length;
  const errCount = slideResults.filter(s => s.status === 'error').length;
  const isGenerating = batchStatus === 'generating';

  const safeIndex = Math.min(viewIndex, Math.max(slides.length - 1, 0));
  const currentSlide = slides[safeIndex];
  const currentResult = slideResults[safeIndex];
  const currentUrl = currentResult?.url || '';

  const copyUrl = async () => { if (currentUrl) { await navigator.clipboard.writeText(currentUrl).catch(() => {}); setUrlCopied(true); setTimeout(() => setUrlCopied(false), 1500); } };
  const prev = () => setViewIndex(i => Math.max(0, i - 1));
  const next = () => setViewIndex(i => Math.min(slides.length - 1, i + 1));

  const statusColor = isGenerating ? '#e85d75' : doneCount > 0 ? '#00FFFF' : inputScript ? '#7ed957' : '#555566';
  const statusLabel = isGenerating ? 'Generating...' : doneCount > 0 ? `${doneCount}/${slides.length} done` : inputScript ? `${slides.length} cards ready` : 'Waiting for script';

  return (
    <div className="cv-node cv-title-card" style={{ '--status-color': statusColor, '--node-accent': '#7ed957' }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="script-in" />

      <div className="cv-title-card-header">
        <div className="cv-title-card-dot" />
        <span className="cv-title-card-title">Title Card</span>
        <span className="cv-title-card-badge">1st Frame</span>
      </div>

      {!inputScript && <div className="cv-gami-empty">Wire a script source to the left handle</div>}

      {inputScript && (
        <div className="cv-gami-controls">
          <select className="cv-blotato-select" value={resolution} onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); setResolution(e.target.value); }}>
            <option value="1K">1K</option><option value="2K">2K</option><option value="4K">4K</option>
          </select>
          <select className="cv-blotato-select" value={aspectRatio} onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); setAspectRatio(e.target.value); }}>
            <option value="9:16">9:16</option><option value="1:1">1:1</option><option value="16:9">16:9</option>
          </select>
        </div>
      )}

      <div className="cv-blotato-field">
        <input className="cv-blotato-input" type={showKey ? 'text' : 'password'} placeholder="KIE API Key"
          value={apiKey} onClick={(e) => e.stopPropagation()} onChange={(e) => saveKey(e.target.value)} />
        <button className="cv-btn cv-btn-sm" title={showKey ? 'Hide key' : 'Show key'}
          onClick={(e) => { e.stopPropagation(); setShowKey(!showKey); }}>{showKey ? '◉' : '○'}</button>
      </div>

      {/* Batch progress bar */}
      {slideResults.length > 0 && (
        <div className="cv-gami-batch-bar">
          <div className="cv-gami-batch-progress">
            {slideResults.map((sr, i) => (
              <div key={i} className={`cv-gami-batch-pip cv-gami-pip-${sr.status || 'idle'}`}
                onClick={(e) => { e.stopPropagation(); setViewIndex(i); setExpanded(true); }}
                title={`Card ${i + 1}: ${sr.status}`} />
            ))}
          </div>
          <span className="cv-gami-batch-stats">
            {doneCount}/{slides.length} done{genCount > 0 ? ` / ${genCount} gen` : ''}{errCount > 0 ? ` / ${errCount} err` : ''}
          </span>
        </div>
      )}

      {slideResults.length > 0 && (
        <button className="cv-gami-viewer-toggle" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
          {expanded ? 'Hide Viewer' : 'View Cards'} ({doneCount} ready)
        </button>
      )}

      {expanded && slides.length > 0 && (
        <div className="cv-gami-viewer">
          <div className="cv-gami-viewer-nav">
            <button className="cv-gami-nav-btn" disabled={safeIndex === 0} onClick={(e) => { e.stopPropagation(); prev(); }}>&#9664;</button>
            <span className="cv-gami-nav-label">Card {safeIndex + 1} / {slides.length}</span>
            <button className="cv-gami-nav-btn" disabled={safeIndex >= slides.length - 1} onClick={(e) => { e.stopPropagation(); next(); }}>&#9654;</button>
          </div>

          <div className="cv-gami-viewer-text">{currentSlide?.text || ''}</div>

          {currentUrl ? (
            <div className="cv-gami-viewer-img-wrap">
              <img src={currentUrl} alt={`Card ${safeIndex + 1}`} className="cv-gami-viewer-img"
                onClick={(e) => { e.stopPropagation(); window.open(currentUrl, '_blank'); }} />
              <button className="cv-btn cv-btn-sm" onClick={(e) => { e.stopPropagation(); copyUrl(); }}>
                {urlCopied ? 'Copied!' : 'Copy URL'}
              </button>
            </div>
          ) : currentResult?.status === 'polling' ? (
            <div className="cv-gami-viewer-pending">Generating... ({currentResult.elapsed || 0}s)</div>
          ) : currentResult?.status === 'error' ? (
            <div className="cv-gami-viewer-error">{currentResult.error}</div>
          ) : (
            <div className="cv-gami-viewer-pending">Pending</div>
          )}
        </div>
      )}

      <button className="cv-btn cv-btn-title-card"
        disabled={slides.length === 0 || !apiKey || isGenerating}
        onClick={(e) => { e.stopPropagation(); onTitleCardBatchGenerate(id, apiKey, slidePrompts, resolution, aspectRatio); setExpanded(true); }}>
        {isGenerating ? 'Generating...' : doneCount > 0 ? 'Regenerate' : 'Generate Cards'}
      </button>

      <Handle type="source" position={Position.Right} id="title-out" />
    </div>
  );
}

/* ===== FRAME SANDWICH NODE — first frame + last frame → Kling 3.0 stop-motion ===== */
const SANDWICH_MOTIONS = [
  { id: 'paper-unfold', label: 'Paper Unfold', prompt: 'Stop-motion animation of origami paper slowly unfolding and opening to reveal the scene beneath. Creased edges relax and flatten. Layered cardstock separates into depth planes. Paper fibers catch the light as folds release. Everything is paper — no wind, no particles. Smooth stop-motion paper craft animation.' },
  { id: 'envelope-open', label: 'Envelope Open', prompt: 'Stop-motion animation of a paper envelope slowly opening its flap. The sealed edge peels back, cardstock layers separate, revealing folded contents that unfurl into the final scene. Paper texture catches light at fold creases. Only paper moves — everything else frozen. Stop-motion paper craft.' },
  { id: 'cardboard-flip', label: 'Cardboard Flip', prompt: 'Stop-motion animation of a cardboard panel flipping over in place, revealing a new scene on the reverse side. The card rotates with visible paper thickness at edges, casting moving shadows. Paper grain and fold lines visible throughout. Pure paper physics, no other movement.' },
  { id: 'page-turn', label: 'Page Turn', prompt: 'Stop-motion animation of a thick paper page turning from right to left, like a book page flip. The page curls naturally showing paper thickness and fiber texture. As it settles, the new page reveals the final scene. Only the page moves — desk and surroundings perfectly still.' },
  { id: 'origami-morph', label: 'Origami Morph', prompt: 'Stop-motion animation of origami paper blocks folding and re-folding themselves into a new shape. Paper creases form new geometry, flat surfaces become 3D structures. Each fold reveals more of the final scene. Soft studio lighting, clean shadows, high-detail paper textures. Only paper folds — nothing else moves.' },
  { id: 'random', label: 'Random', prompt: null },
];

function FrameSandwichNode({ id, data }) {
  const { edges, nodeOutputs, onFrameSandwichGenerate, onRunLane, laneRun, syncNodeData } = useContext(CanvasCtx);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('kie-api-key') || '');
  // Initialize from node.data (mirrored by syncNodeData) so reloads rehydrate.
  const [duration, setDuration] = useState(() => data?.duration || '5');
  const [aspectRatio, setAspectRatio] = useState(() => data?.aspectRatio || '9:16');
  const [mode, setMode] = useState(() => data?.videoMode || 'pro');
  // node.data holds the motion *prompt* (what the engine reads), not the id —
  // recover the id by prompt match. '' means Random was picked (prompt: null).
  const [motionId, setMotionId] = useState(() => {
    if (data?.motionPrompt === undefined) return 'paper-unfold';
    return SANDWICH_MOTIONS.find((m) => (m.prompt || '') === data.motionPrompt)?.id || 'paper-unfold';
  });
  const [viewIndex, setViewIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const saveKey = (v) => { setApiKey(v); localStorage.setItem('kie-api-key', v); };

  // Trace two inputs: first frames (title cards) and last frames (scene art)
  const firstFrames = [];
  const lastFrames = [];

  for (const edge of (edges || [])) {
    if (edge.target !== id) continue;
    const src = nodeOutputs?.[edge.source];
    if (!src) continue;
    if (edge.targetHandle === 'first-in' && src.slides?.length) {
      for (const s of src.slides) { if (s.status === 'done' && s.url) firstFrames.push(s.url); }
    }
    if (edge.targetHandle === 'last-in' && src.slides?.length) {
      for (const s of src.slides) { if (s.status === 'done' && s.url) lastFrames.push(s.url); }
    }
  }

  // Fallback scan for unhandled wiring
  if (firstFrames.length === 0 || lastFrames.length === 0) {
    for (const edge of (edges || [])) {
      if (edge.target !== id) continue;
      const src = nodeOutputs?.[edge.source];
      if (!src?.slides?.length) continue;
      const urls = src.slides.filter(s => s.status === 'done' && s.url).map(s => s.url);
      if (urls.length === 0) continue;
      if (edge.targetHandle === 'first-in' && firstFrames.length === 0) firstFrames.push(...urls);
      else if (edge.targetHandle === 'last-in' && lastFrames.length === 0) lastFrames.push(...urls);
    }
  }

  const pairCount = Math.min(firstFrames.length, lastFrames.length);
  const pairs = [];
  for (let i = 0; i < pairCount; i++) {
    pairs.push({ first: firstFrames[i], last: lastFrames[i] });
  }

  const result = nodeOutputs?.[id] || {};
  const videos = result.videos || [];
  const batchStatus = result.batchStatus || 'idle';
  const doneCount = videos.filter(v => v.status === 'done').length;
  const genCount = videos.filter(v => v.status === 'polling' || v.status === 'submitting').length;

  const safeIndex = Math.min(viewIndex, Math.max(videos.length - 1, 0));
  const currentVideo = videos[safeIndex];
  const currentUrl = currentVideo?.url || '';

  const copyUrl = async () => { if (currentUrl) { await navigator.clipboard.writeText(currentUrl).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); } };

  // Pick motion prompt — random picks one at generate time
  const getMotionPrompt = () => {
    if (motionId === 'random') {
      const options = SANDWICH_MOTIONS.filter(m => m.id !== 'random');
      return options[Math.floor(Math.random() * options.length)].prompt;
    }
    return SANDWICH_MOTIONS.find(m => m.id === motionId)?.prompt || SANDWICH_MOTIONS[0].prompt;
  };

  return (
    <div className="cv-node cv-frame-sandwich" style={{ '--status-color': batchStatus === 'generating' ? '#e85d75' : doneCount > 0 ? '#00FFFF' : pairCount > 0 ? '#00bfa5' : '#555', '--node-accent': '#00bfa5' }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="first-in" style={{ top: '30%' }} />
      <Handle type="target" position={Position.Left} id="last-in" style={{ top: '70%' }} />

      <div className="cv-sandwich-header">
        <div className="cv-sandwich-dot" />
        <span className="cv-sandwich-title">Frame Sandwich</span>
        <span className="cv-sandwich-badge">Kling 3.0</span>
      </div>

      {/* Input status */}
      <div className="cv-carousel-inputs">
        <div className="cv-carousel-input-row">
          <span className={`cv-carousel-input-dot ${firstFrames.length > 0 ? 'active' : ''}`} />
          <span>1st: {firstFrames.length > 0 ? `${firstFrames.length} cards` : 'top handle'}</span>
        </div>
        <div className="cv-carousel-input-row">
          <span className={`cv-carousel-input-dot ${lastFrames.length > 0 ? 'active' : ''}`} />
          <span>Last: {lastFrames.length > 0 ? `${lastFrames.length} art` : 'bottom handle'}</span>
        </div>
      </div>

      {/* Motion style selector */}
      <div className="cv-sandwich-motion">
        <div className="cv-sandwich-motion-label">Motion Style</div>
        <div className="cv-niche-tones">
          {SANDWICH_MOTIONS.map(m => (
            <button key={m.id}
              className={`cv-niche-tone cv-sandwich-tone ${motionId === m.id ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setMotionId(m.id); syncNodeData(id, { motionPrompt: m.prompt || '' }); }}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div className="cv-kie-controls">
        <select className="cv-blotato-select" value={duration} onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); setDuration(e.target.value); syncNodeData(id, { duration: e.target.value }); }}>
          <option value="3">3s</option><option value="5">5s</option><option value="10">10s</option>
        </select>
        <select className="cv-blotato-select" value={aspectRatio} onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); setAspectRatio(e.target.value); syncNodeData(id, { aspectRatio: e.target.value }); }}>
          <option value="9:16">9:16</option><option value="16:9">16:9</option><option value="1:1">1:1</option>
        </select>
        <select className="cv-blotato-select" value={mode} onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); setMode(e.target.value); syncNodeData(id, { videoMode: e.target.value }); }}>
          <option value="pro">Pro</option><option value="std">Standard</option>
        </select>
      </div>

      <div className="cv-blotato-field">
        <input className="cv-blotato-input" type="password" placeholder="KIE API Key"
          value={apiKey} onClick={(e) => e.stopPropagation()} onChange={(e) => saveKey(e.target.value)} />
      </div>

      {/* Batch progress */}
      {videos.length > 0 && (
        <div className="cv-gami-batch-bar">
          <div className="cv-gami-batch-progress">
            {videos.map((v, i) => (
              <div key={i} className={`cv-gami-batch-pip cv-gami-pip-${v.status || 'idle'}`}
                onClick={(e) => { e.stopPropagation(); setViewIndex(i); setExpanded(true); }} />
            ))}
          </div>
          <span className="cv-gami-batch-stats">{doneCount}/{videos.length}</span>
        </div>
      )}

      {/* Viewer */}
      {videos.length > 0 && (
        <button className="cv-gami-viewer-toggle" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
          {expanded ? 'Hide' : 'View Videos'} ({doneCount} ready)
        </button>
      )}

      {expanded && videos.length > 0 && (
        <div className="cv-gami-viewer">
          <div className="cv-gami-viewer-nav">
            <button className="cv-gami-nav-btn" disabled={safeIndex === 0} onClick={(e) => { e.stopPropagation(); setViewIndex(i => Math.max(0, i - 1)); }}>&#9664;</button>
            <span className="cv-gami-nav-label">Clip {safeIndex + 1} / {videos.length}</span>
            <button className="cv-gami-nav-btn" disabled={safeIndex >= videos.length - 1} onClick={(e) => { e.stopPropagation(); setViewIndex(i => Math.min(videos.length - 1, i + 1)); }}>&#9654;</button>
          </div>

          {currentUrl ? (
            <div className="cv-vid-preview">
              <video src={currentUrl} controls className="cv-vid-player" onClick={(e) => e.stopPropagation()} />
              <button className="cv-btn cv-btn-sm" onClick={(e) => { e.stopPropagation(); copyUrl(); }}>
                {copied ? 'Copied!' : 'Copy URL'}
              </button>
            </div>
          ) : currentVideo?.status === 'polling' ? (
            <div className="cv-gami-viewer-pending">Generating... ({Math.floor((currentVideo.elapsed||0)/60)}m {(currentVideo.elapsed||0)%60}s)</div>
          ) : currentVideo?.status === 'error' ? (
            <div className="cv-gami-viewer-error">{currentVideo.error}</div>
          ) : (
            <div className="cv-gami-viewer-pending">Pending</div>
          )}
        </div>
      )}

      {/* Run Lane — executeGraph engine runs the whole upstream lane */}
      <button
        onClick={() => onRunLane(id)}
        disabled={laneRun.status === 'running'}
        style={{
          width: '100%', padding: '6px 10px', marginBottom: 6, border: 'none', borderRadius: 6,
          cursor: laneRun.status === 'running' ? 'wait' : 'pointer', fontWeight: 700, fontSize: 11,
          background: 'linear-gradient(135deg, #C9A227, #8a6d1a)', color: '#fff',
        }}
      >
        {laneRun.status === 'running' && laneRun.targetId === id ? '⏳ Running lane…' : '▶ Run Lane'}
      </button>
      {laneRun.status === 'error' && laneRun.targetId === id && (
        <div style={{ fontSize: 10, color: '#ff6b6b', marginBottom: 6 }}>{laneRun.error}</div>
      )}

      {/* Generate */}
      <button className="cv-btn cv-btn-sandwich"
        disabled={pairCount === 0 || !apiKey || batchStatus === 'generating'}
        onClick={(e) => { e.stopPropagation(); onFrameSandwichGenerate(id, apiKey, pairs, getMotionPrompt(), duration, aspectRatio, mode); setExpanded(true); }}>
        {batchStatus === 'generating' ? 'Generating...' : doneCount > 0 ? 'Regenerate' : 'Sandwich All'}
      </button>
      <Handle type="source" position={Position.Right} id="video-out" />
    </div>
  );
}

/* ===== REMOTION COMPOSITOR NODE — composites video into carousel slides ===== */
function RemotionCompNode({ id }) {
  const { edges, nodeOutputs, onRemotionComposite } = useContext(CanvasCtx);
  const [viewIndex, setViewIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  // Trace inputs: carousel rendered slides + kie img2vid videos
  const inEdges = edges?.filter(e => e.target === id) || [];
  let slideUrls = []; // ['/carousels/<name>/slide_1.png', ...]
  let videoUrls = []; // ['https://kie.ai/...', ...]
  let slideZones = {}; // { 'slide_1': {x, y, w, h}, ... } — from Carousel render.py

  for (const edge of inEdges) {
    const src = nodeOutputs?.[edge.source];
    if (!src) continue;
    // Carousel node output: { renderedSlides: [...], zones: { slide_N: {x,y,w,h} } }
    if (src.renderedSlides?.length && slideUrls.length === 0) {
      slideUrls = src.renderedSlides;
      slideZones = src.zones || {};
    }
    // KIE Img2Vid output: { videos: [{ status, url }, ...] }
    if (src.videos?.length && videoUrls.length === 0) {
      videoUrls = src.videos.filter(v => v.status === 'done' && v.url).map(v => v.url);
    }
  }
  // Fallback scan
  if (slideUrls.length === 0 || videoUrls.length === 0) {
    for (const [nid, out] of Object.entries(nodeOutputs || {})) {
      if (nid === id) continue;
      if (out.renderedSlides?.length && slideUrls.length === 0) {
        slideUrls = out.renderedSlides;
        slideZones = out.zones || {};
      }
      if (out.videos?.length && videoUrls.length === 0) {
        const done = out.videos.filter(v => v.status === 'done' && v.url);
        if (done.length > 0) videoUrls = done.map(v => v.url);
      }
    }
  }

  // Pair them up — match slide N with video N. Attach the slide's art zone
  // so the compositor cuts the right hole and Remotion places the video in it.
  const pairCount = Math.min(slideUrls.length, videoUrls.length);
  const pairs = Array.from({ length: pairCount }, (_, i) => {
    const slideUrl = slideUrls[i];
    // Derive slide number from URL (.../slide_3.png) → 'slide_3'
    const slideMatch = slideUrl?.match(/slide_(\d+)\.png$/i);
    const key = slideMatch ? `slide_${slideMatch[1]}` : null;
    return {
      slideUrl,
      videoUrl: videoUrls[i],
      artZone: key && slideZones[key] ? slideZones[key] : null,
    };
  });

  const result = nodeOutputs?.[id] || {};
  const batchStatus = result.batchStatus || 'idle';
  const composites = result.composites || [];
  const doneCount = composites.filter(c => c.status === 'done').length;

  const safeIndex = Math.min(viewIndex, Math.max(composites.length - 1, 0));
  const current = composites[safeIndex];
  const currentUrl = current?.url ? `http://localhost:3001${current.url}` : '';

  const copyUrl = async () => {
    if (currentUrl) {
      await navigator.clipboard.writeText(currentUrl).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  // Cross-origin-safe download: fetch → blob → programmatic click.
  // Avoids browsers ignoring <a download> across origins, which navigates the tab
  // and drops the React Flow canvas state (only positions are persisted).
  const downloadFile = async (url, filename) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (err) {
      console.error('download failed, falling back to new tab:', err);
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className={`cv-node cv-remotion cv-remotion-${batchStatus}`} style={{ '--status-color': batchStatus === 'rendering' ? '#e85d75' : doneCount > 0 ? '#00FFFF' : pairCount > 0 ? '#4ecdc4' : '#555', '--node-accent': '#4ecdc4' }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="slides-in" style={{ top: '30%' }} />
      <Handle type="target" position={Position.Left} id="videos-in" style={{ top: '70%' }} />

      <div className="cv-remotion-header">
        <div className="cv-remotion-dot" />
        <span className="cv-remotion-title">Remotion</span>
        <span className="cv-remotion-badge">Compositor</span>
      </div>

      {/* Input status */}
      <div className="cv-carousel-inputs">
        <div className="cv-carousel-input-row">
          <span className={`cv-carousel-input-dot ${slideUrls.length > 0 ? 'active' : ''}`} />
          <span>{slideUrls.length > 0 ? `${slideUrls.length} slides` : 'No slides'}</span>
        </div>
        <div className="cv-carousel-input-row">
          <span className={`cv-carousel-input-dot ${videoUrls.length > 0 ? 'active' : ''}`} />
          <span>{videoUrls.length > 0 ? `${videoUrls.length} videos` : 'No videos'}</span>
        </div>
      </div>

      {/* Batch progress */}
      {composites.length > 0 && (
        <div className="cv-gami-batch-bar">
          <div className="cv-gami-batch-progress">
            {composites.map((c, i) => (
              <div key={i} className={`cv-gami-batch-pip cv-gami-pip-${c.status || 'idle'}`}
                onClick={(e) => { e.stopPropagation(); setViewIndex(i); setExpanded(true); }} />
            ))}
          </div>
          <span className="cv-gami-batch-stats">{doneCount}/{composites.length}</span>
        </div>
      )}

      {/* Viewer */}
      {composites.length > 0 && (
        <button className="cv-gami-viewer-toggle" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
          {expanded ? 'Hide' : 'View Composites'} ({doneCount} ready)
        </button>
      )}

      {expanded && composites.length > 0 && (
        <div className="cv-gami-viewer">
          <div className="cv-gami-viewer-nav">
            <button className="cv-gami-nav-btn" disabled={safeIndex === 0}
              onClick={(e) => { e.stopPropagation(); setViewIndex(i => Math.max(0, i - 1)); }}>&#9664;</button>
            <span className="cv-gami-nav-label">Slide {safeIndex + 1} / {composites.length}</span>
            <button className="cv-gami-nav-btn" disabled={safeIndex >= composites.length - 1}
              onClick={(e) => { e.stopPropagation(); setViewIndex(i => Math.min(composites.length - 1, i + 1)); }}>&#9654;</button>
          </div>

          {currentUrl ? (
            <div className="cv-vid-preview">
              <video src={currentUrl} controls loop className="cv-vid-player" onClick={(e) => e.stopPropagation()} />
              <div className="cv-remotion-actions">
                <button className="cv-btn cv-btn-sm" onClick={(e) => { e.stopPropagation(); copyUrl(); }}>
                  {copied ? 'Copied!' : 'Copy URL'}
                </button>
                <button className="cv-btn cv-btn-sm cv-btn-download"
                  onClick={(e) => { e.stopPropagation(); downloadFile(currentUrl, `composite_${safeIndex + 1}.mp4`); }}>
                  Download
                </button>
              </div>
            </div>
          ) : current?.status === 'rendering' ? (
            <div className="cv-gami-viewer-pending">Rendering slide {safeIndex + 1}...</div>
          ) : current?.status === 'error' ? (
            <div className="cv-gami-viewer-error">{current.error}</div>
          ) : (
            <div className="cv-gami-viewer-pending">Pending</div>
          )}
        </div>
      )}

      {/* Download all */}
      {doneCount > 1 && (
        <div className="cv-remotion-download-all">
          {composites.map((c, i) => c.status === 'done' && c.url ? (
            <button key={i} className="cv-btn cv-btn-sm cv-btn-download"
              onClick={(e) => { e.stopPropagation(); downloadFile(`http://localhost:3001${c.url}`, `composite_${i + 1}.mp4`); }}>
              Slide {i + 1}
            </button>
          ) : null)}
        </div>
      )}

      {/* Generate */}
      <button className="cv-btn cv-btn-remotion"
        disabled={pairCount === 0 || batchStatus === 'rendering'}
        onClick={(e) => { e.stopPropagation(); onRemotionComposite(id, pairs); setExpanded(true); }}>
        {batchStatus === 'rendering' ? 'Rendering...' : doneCount > 0 ? 'Re-render' : 'Composite All'}
      </button>
      <Handle type="source" position={Position.Right} id="composite-out" />
    </div>
  );
}

/* ===== FFMPEG COLOR GRADE NODE ===== */
const GRADE_PRESETS = [
  { id: 'none', label: 'None', settings: {} },
  { id: 'warm-ugc', label: 'Warm UGC', settings: { warmth: -0.03, tint: 0.02, saturation: 0.94, exposure: -0.03, contrast: 1.0, highlight: -35, shadow: 18 } },
  { id: 'film', label: 'Film Grain', settings: { contrast: 1.05, saturation: 0.85, grain: 14, sharpness: 0.5 } },
  { id: 'golden', label: 'Golden Hour', settings: { warmth: 0.6, contrast: 1.05, saturation: 1.2, highlightR: 0.1, highlightG: 0.05, highlightB: -0.08, grain: 4 } },
  { id: 'clean', label: 'Clean Pop', settings: { contrast: 1.2, saturation: 1.3, sharpness: 1.2, grain: 0 } },
  { id: 'moody', label: 'Moody', settings: { contrast: 1.15, saturation: 0.75, warmth: -0.2, shadowR: -0.05, shadowG: -0.03, shadowB: 0.08, grain: 8 } },
];

const GRADE_SLIDERS = [
  { key: 'warmth',     label: 'Temp',       min: -0.5, max: 0.5, step: 0.01, default: 0 },
  { key: 'tint',       label: 'Tint',       min: -0.1, max: 0.1, step: 0.005, default: 0 },
  { key: 'exposure',   label: 'Exposure',   min: -0.2, max: 0.2, step: 0.01, default: 0 },
  { key: 'contrast',   label: 'Contrast',   min: 0.7,  max: 1.5, step: 0.01, default: 1.0 },
  { key: 'saturation', label: 'Saturation', min: 0.5,  max: 1.5, step: 0.01, default: 1.0 },
  { key: 'highlight',  label: 'Highlight',  min: -50,  max: 50,  step: 1,    default: 0 },
  { key: 'shadow',     label: 'Shadow',     min: -50,  max: 50,  step: 1,    default: 0 },
  { key: 'grain',      label: 'Grain',      min: 0,    max: 20,  step: 1,    default: 0 },
  { key: 'sharpness',  label: 'Sharpness',  min: 0,    max: 2,   step: 0.1,  default: 0 },
];

function FFmpegGradeNode({ id }) {
  const { edges, nodeOutputs, onFfmpegGrade } = useContext(CanvasCtx);
  const [presetId, setPresetId] = useState('warm-ugc');
  const [settings, setSettings] = useState(() => ({ ...GRADE_PRESETS.find(p => p.id === 'warm-ugc').settings }));
  const [slidersOpen, setSlidersOpen] = useState(false);
  const [viewIndex, setViewIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const applyPreset = (pid) => {
    setPresetId(pid);
    const p = GRADE_PRESETS.find(pr => pr.id === pid);
    if (p) setSettings({ ...p.settings });
  };

  const updateSetting = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: parseFloat(value) }));
    setPresetId('custom');
  };

  // Trace video input from upstream nodes
  const videoUrls = [];
  for (const edge of (edges || []).filter(e => e.target === id)) {
    const src = nodeOutputs?.[edge.source];
    if (!src) continue;
    // UGC Video / Frame Sandwich output: videos[]
    if (src.videos?.length) {
      for (const v of src.videos) {
        if (v.status === 'done' && v.url) videoUrls.push(v.url);
      }
    }
    // Remotion Compositor output: composites[]
    if (src.composites?.length) {
      for (const c of src.composites) {
        if (c.status === 'done' && c.url) videoUrls.push(c.url);
      }
    }
  }

  const result = nodeOutputs?.[id] || {};
  const graded = result.graded || []; // [{ status, url, error }]
  const batchStatus = result.batchStatus || 'idle';
  const doneCount = graded.filter(g => g.status === 'done').length;

  const safeIndex = Math.min(viewIndex, Math.max(graded.length - 1, 0));
  const currentUrl = graded[safeIndex]?.url || '';

  const copyUrl = async () => {
    if (currentUrl) {
      await navigator.clipboard.writeText(`http://localhost:3001${currentUrl}`).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="cv-node cv-ffmpeg-grade" style={{ '--status-color': batchStatus === 'grading' ? '#e85d75' : doneCount > 0 ? '#00FFFF' : videoUrls.length > 0 ? '#f4a261' : '#555', '--node-accent': '#f4a261' }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="video-in" />

      <div className="cv-ffmpeg-header">
        <div className="cv-ffmpeg-dot" />
        <span className="cv-ffmpeg-title">Color Grade</span>
        <span className="cv-ffmpeg-badge">FFmpeg</span>
      </div>

      {/* Input status */}
      <div className="cv-carousel-inputs">
        <div className="cv-carousel-input-row">
          <span className={`cv-carousel-input-dot ${videoUrls.length > 0 ? 'active' : ''}`} />
          <span>{videoUrls.length > 0 ? `${videoUrls.length} videos` : 'No videos wired'}</span>
        </div>
      </div>

      {/* Preset selector */}
      <div className="cv-ffmpeg-presets">
        {GRADE_PRESETS.map(p => (
          <button key={p.id}
            className={`cv-niche-tone ${presetId === p.id ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); applyPreset(p.id); }}>
            {p.label}
          </button>
        ))}
        {presetId === 'custom' && <span className="cv-ffmpeg-custom-badge">Custom</span>}
      </div>

      {/* Sliders toggle */}
      <button className="cv-gami-viewer-toggle" onClick={(e) => { e.stopPropagation(); setSlidersOpen(!slidersOpen); }}>
        {slidersOpen ? 'Hide Sliders' : 'Adjust Sliders'}
      </button>

      {slidersOpen && (
        <div className="cv-ffmpeg-sliders nodrag nopan nowheel"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}>
          {GRADE_SLIDERS.map(sl => (
            <div key={sl.key} className="cv-ffmpeg-slider-row">
              <label className="cv-ffmpeg-slider-label">{sl.label}</label>
              <input type="range" className="cv-ffmpeg-slider nodrag nopan"
                min={sl.min} max={sl.max} step={sl.step}
                value={settings[sl.key] ?? sl.default}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => updateSetting(sl.key, e.target.value)} />
              <span className="cv-ffmpeg-slider-val">{(settings[sl.key] ?? sl.default).toFixed(sl.step < 1 ? 2 : 0)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Batch progress */}
      {graded.length > 0 && (
        <div className="cv-gami-batch-bar">
          <div className="cv-gami-batch-progress">
            {graded.map((g, i) => (
              <div key={i} className={`cv-gami-batch-pip cv-gami-pip-${g.status || 'idle'}`}
                onClick={(e) => { e.stopPropagation(); setViewIndex(i); setExpanded(true); }} />
            ))}
          </div>
          <span className="cv-gami-batch-stats">{doneCount}/{graded.length}</span>
        </div>
      )}

      {/* Viewer */}
      {graded.length > 0 && (
        <button className="cv-gami-viewer-toggle" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
          {expanded ? 'Hide' : 'View Graded'} ({doneCount} ready)
        </button>
      )}

      {expanded && graded.length > 0 && (
        <div className="cv-gami-viewer">
          <div className="cv-gami-viewer-nav">
            <button className="cv-gami-nav-btn" disabled={safeIndex === 0}
              onClick={(e) => { e.stopPropagation(); setViewIndex(i => Math.max(0, i - 1)); }}>&#9664;</button>
            <span className="cv-gami-nav-label">Clip {safeIndex + 1} / {graded.length}</span>
            <button className="cv-gami-nav-btn" disabled={safeIndex >= graded.length - 1}
              onClick={(e) => { e.stopPropagation(); setViewIndex(i => Math.min(graded.length - 1, i + 1)); }}>&#9654;</button>
          </div>

          {currentUrl ? (
            <div className="cv-vid-preview nodrag nopan">
              <video src={`http://localhost:3001${currentUrl}`} controls className="cv-vid-player nodrag nopan"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()} />
              <button className="cv-btn cv-btn-sm" onClick={(e) => { e.stopPropagation(); copyUrl(); }}>
                {copied ? 'Copied!' : 'Copy URL'}
              </button>
            </div>
          ) : graded[safeIndex]?.status === 'grading' ? (
            <div className="cv-gami-viewer-pending">Grading...</div>
          ) : graded[safeIndex]?.status === 'error' ? (
            <div className="cv-gami-viewer-error">{graded[safeIndex].error}</div>
          ) : null}
        </div>
      )}

      {/* Grade button */}
      <button className="cv-btn cv-btn-ffmpeg"
        disabled={videoUrls.length === 0 || batchStatus === 'grading'}
        onClick={(e) => { e.stopPropagation(); onFfmpegGrade(id, videoUrls, settings); setExpanded(true); }}>
        {batchStatus === 'grading' ? 'Grading...' : doneCount > 0 ? `Re-grade (${videoUrls.length})` : `Grade All (${videoUrls.length})`}
      </button>

      <Handle type="source" position={Position.Right} id="graded-out" />
    </div>
  );
}

/* ===== CHROMA COMPOSITE NODE — Tier 1 character-over-slide ===== */
function ChromaCompositeNode({ id }) {
  const { edges, nodeOutputs, onChromaComposite } = useContext(CanvasCtx);
  const [keyColor, setKeyColor] = useState('#00FF00');
  const [similarity, setSimilarity] = useState(0.1);
  const [blend, setBlend] = useState(0.05);
  const [posX, setPosX] = useState(0);
  const [posY, setPosY] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [slidersOpen, setSlidersOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  // Trace inputs from upstream — top handle = character, bottom handle = background
  let characterUrl = '';
  let backgroundUrl = '';
  for (const edge of (edges || []).filter(e => e.target === id)) {
    const src = nodeOutputs?.[edge.source];
    if (!src) continue;
    const h = edge.targetHandle;

    const pickUrl = (source) => {
      // Prefer .slides[0].url (batch image nodes: gami-art, title-card, clip-frames)
      if (source.slides?.length) {
        const done = source.slides.find(s => s.status === 'done' && s.url);
        if (done) return done.url;
      }
      // Carousel: renderedSlides is an array of local paths
      if (source.renderedSlides?.length) {
        return `http://localhost:3001${source.renderedSlides[0]}`;
      }
      // Single-image nodes (gami, kie-style)
      if (source.url) return source.url;
      return '';
    };

    if (h === 'bg-in') {
      if (!backgroundUrl) backgroundUrl = pickUrl(src);
    } else {
      // Default / char-in: pick first usable image as character
      if (!characterUrl) characterUrl = pickUrl(src);
    }
  }

  const result = nodeOutputs?.[id] || {};
  const resultUrl = result.url || '';
  const status = result.status || 'idle';
  const errorMsg = result.error || '';

  const copyUrl = async () => {
    if (resultUrl) {
      await navigator.clipboard.writeText(`http://localhost:3001${resultUrl}`).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="cv-node cv-ffmpeg-grade" style={{ '--status-color': status === 'rendering' ? '#e85d75' : resultUrl ? '#00FFFF' : characterUrl ? '#ff69b4' : '#555', '--node-accent': '#ff69b4' }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="char-in" style={{ top: '38%' }} />
      <Handle type="target" position={Position.Left} id="bg-in" style={{ top: '72%' }} />

      <div className="cv-ffmpeg-header">
        <div className="cv-ffmpeg-dot" />
        <span className="cv-ffmpeg-title">Chroma Composite</span>
        <span className="cv-ffmpeg-badge">FFmpeg</span>
      </div>

      <div className="cv-carousel-inputs">
        <div className="cv-carousel-input-row">
          <span className={`cv-carousel-input-dot ${characterUrl ? 'active' : ''}`} />
          <span>{characterUrl ? 'Character (green bg) wired' : 'Wire character image (top handle)'}</span>
        </div>
        <div className="cv-carousel-input-row">
          <span className={`cv-carousel-input-dot ${backgroundUrl ? 'active' : ''}`} />
          <span>{backgroundUrl ? 'Slide wired' : 'No slide — extract only (alpha PNG)'}</span>
        </div>
      </div>

      <button className="cv-gami-viewer-toggle" onClick={(e) => { e.stopPropagation(); setSlidersOpen(!slidersOpen); }}>
        {slidersOpen ? 'Hide Controls' : 'Show Controls'}
      </button>

      {slidersOpen && (
        <div className="cv-ffmpeg-sliders nodrag nopan nowheel"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}>

          <div className="cv-ffmpeg-slider-row">
            <label className="cv-ffmpeg-slider-label">Key Color</label>
            <input type="color" value={keyColor}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setKeyColor(e.target.value)}
              style={{ width: 40, height: 24, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }} />
            <span className="cv-ffmpeg-slider-val" style={{ fontFamily: 'monospace' }}>{keyColor}</span>
          </div>

          <div className="cv-ffmpeg-slider-row">
            <label className="cv-ffmpeg-slider-label">Similarity</label>
            <input type="range" className="cv-ffmpeg-slider nodrag nopan"
              min={0.01} max={0.5} step={0.01}
              value={similarity}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => setSimilarity(parseFloat(e.target.value))} />
            <span className="cv-ffmpeg-slider-val">{similarity.toFixed(2)}</span>
          </div>

          <div className="cv-ffmpeg-slider-row">
            <label className="cv-ffmpeg-slider-label">Edge Blend</label>
            <input type="range" className="cv-ffmpeg-slider nodrag nopan"
              min={0} max={0.3} step={0.01}
              value={blend}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => setBlend(parseFloat(e.target.value))} />
            <span className="cv-ffmpeg-slider-val">{blend.toFixed(2)}</span>
          </div>

          <div className="cv-ffmpeg-slider-row">
            <label className="cv-ffmpeg-slider-label">Scale</label>
            <input type="range" className="cv-ffmpeg-slider nodrag nopan"
              min={0.1} max={2.0} step={0.05}
              value={scale}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => setScale(parseFloat(e.target.value))} />
            <span className="cv-ffmpeg-slider-val">{scale.toFixed(2)}</span>
          </div>

          <div className="cv-ffmpeg-slider-row">
            <label className="cv-ffmpeg-slider-label">Pos X</label>
            <input type="range" className="cv-ffmpeg-slider nodrag nopan"
              min={-500} max={1500} step={10}
              value={posX}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => setPosX(parseInt(e.target.value))} />
            <span className="cv-ffmpeg-slider-val">{posX}</span>
          </div>

          <div className="cv-ffmpeg-slider-row">
            <label className="cv-ffmpeg-slider-label">Pos Y</label>
            <input type="range" className="cv-ffmpeg-slider nodrag nopan"
              min={-500} max={1500} step={10}
              value={posY}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => setPosY(parseInt(e.target.value))} />
            <span className="cv-ffmpeg-slider-val">{posY}</span>
          </div>
        </div>
      )}

      {/* Result preview — checkered bg so transparency shows */}
      {resultUrl && (
        <div className="cv-gami-viewer">
          <img src={`http://localhost:3001${resultUrl}`} alt="composite"
            style={{ width: '100%', borderRadius: 8, background: 'repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 50% / 14px 14px' }} />
          <button className="cv-gami-copy-btn nodrag" onClick={(e) => { e.stopPropagation(); copyUrl(); }}>
            {copied ? 'Copied' : 'Copy URL'}
          </button>
        </div>
      )}

      {status === 'error' && (
        <div className="cv-gami-viewer-error" style={{ fontSize: 11, padding: 6 }}>{errorMsg}</div>
      )}

      <button className="cv-btn cv-btn-ffmpeg"
        disabled={!characterUrl || status === 'rendering'}
        onClick={(e) => {
          e.stopPropagation();
          const keyHex = keyColor.startsWith('#') ? '0x' + keyColor.slice(1) : keyColor;
          onChromaComposite(id, { characterUrl, backgroundUrl, keyColor: keyHex, similarity, blend, posX, posY, scale });
        }}>
        {status === 'rendering' ? 'Rendering...' : backgroundUrl ? (resultUrl ? 'Re-composite' : 'Composite') : (resultUrl ? 'Re-extract' : 'Extract')}
      </button>

      <Handle type="source" position={Position.Right} id="composite-out" />
    </div>
  );
}

/* ===== CHROMA MOTION NODE — Tier 2: animated character over slide via Remotion ===== */
const MOTION_PRESETS = [
  { id: 'slide-right', label: 'Slide R→' },
  { id: 'slide-left',  label: 'Slide ←L' },
  { id: 'fade',        label: 'Fade' },
  { id: 'zoom',        label: 'Zoom' },
  { id: 'none',        label: 'None' },
];

function ChromaMotionNode({ id }) {
  const { edges, nodeOutputs, onChromaMotion } = useContext(CanvasCtx);
  const [entry, setEntry] = useState('slide-right');
  const [exit, setExit] = useState('slide-left');
  const [durationSec, setDurationSec] = useState(8);
  const [holdScale, setHoldScale] = useState(1.0);
  const [shadowOn, setShadowOn] = useState(true);
  const [shadowBlur, setShadowBlur] = useState(30);
  const [shadowOpacity, setShadowOpacity] = useState(0.5);
  const [controlsOpen, setControlsOpen] = useState(true);
  const [urlCopied, setUrlCopied] = useState(false);

  // Resolve upstream: top handle = transparent character PNG (Tier 1 output), bottom = background slide
  let characterUrl = '';
  let backgroundUrl = '';
  for (const edge of (edges || []).filter(e => e.target === id)) {
    const src = nodeOutputs?.[edge.source];
    if (!src) continue;
    const h = edge.targetHandle;
    const pickUrl = (s) => {
      if (s.slides?.length) {
        const done = s.slides.find(x => x.status === 'done' && x.url);
        if (done) return done.url;
      }
      if (s.renderedSlides?.length) return `http://localhost:3001${s.renderedSlides[0]}`;
      if (s.url) return s.url;
      return '';
    };
    if (h === 'bg-in') {
      if (!backgroundUrl) backgroundUrl = pickUrl(src);
    } else {
      if (!characterUrl) characterUrl = pickUrl(src);
    }
  }

  const result = nodeOutputs?.[id] || {};
  const status = result.status || 'idle';
  const resultUrl = result.url || '';

  const canRender = characterUrl && backgroundUrl && status !== 'rendering';

  const copyUrl = async () => {
    if (!resultUrl) return;
    await navigator.clipboard.writeText(`http://localhost:3001${resultUrl}`).catch(() => {});
    setUrlCopied(true);
    setTimeout(() => setUrlCopied(false), 1500);
  };

  return (
    <div className="cv-node cv-chroma-motion" style={{ '--status-color': status === 'rendering' ? '#e85d75' : resultUrl ? '#00FFFF' : canRender ? '#ff69b4' : '#555' }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="char-in" style={{ top: '38%' }} />
      <Handle type="target" position={Position.Left} id="bg-in" style={{ top: '72%' }} />

      <div className="cv-chroma-motion-header">
        <div className="cv-chroma-motion-dot" />
        <span className="cv-chroma-motion-title">Chroma Motion</span>
        <span className="cv-chroma-motion-badge">Remotion · Tier 2</span>
      </div>

      <div className="cv-carousel-inputs">
        <div className="cv-carousel-input-row">
          <span className={`cv-carousel-input-dot ${characterUrl ? 'active' : ''}`} />
          <span>{characterUrl ? 'Character wired (transparent PNG)' : 'Wire character (top handle)'}</span>
        </div>
        <div className="cv-carousel-input-row">
          <span className={`cv-carousel-input-dot ${backgroundUrl ? 'active' : ''}`} />
          <span>{backgroundUrl ? 'Background wired' : 'Wire slide background (bottom handle)'}</span>
        </div>
      </div>

      <button className="cv-gami-viewer-toggle" onClick={(e) => { e.stopPropagation(); setControlsOpen(!controlsOpen); }}>
        {controlsOpen ? 'Hide Controls' : 'Show Controls'}
      </button>

      {controlsOpen && (
        <div className="cv-chroma-motion-controls nodrag nopan nowheel"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}>

          <div className="cv-chroma-motion-row">
            <label>Entry</label>
            <select value={entry} onChange={(e) => setEntry(e.target.value)} className="cv-blotato-select">
              {MOTION_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>

          <div className="cv-chroma-motion-row">
            <label>Exit</label>
            <select value={exit} onChange={(e) => setExit(e.target.value)} className="cv-blotato-select">
              {MOTION_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>

          <div className="cv-ffmpeg-slider-row">
            <label className="cv-ffmpeg-slider-label">Duration</label>
            <input type="range" className="cv-ffmpeg-slider nodrag nopan"
              min={3} max={20} step={1}
              value={durationSec}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => setDurationSec(parseInt(e.target.value, 10))} />
            <span className="cv-ffmpeg-slider-val">{durationSec}s</span>
          </div>

          <div className="cv-ffmpeg-slider-row">
            <label className="cv-ffmpeg-slider-label">Scale</label>
            <input type="range" className="cv-ffmpeg-slider nodrag nopan"
              min={0.4} max={1.5} step={0.05}
              value={holdScale}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => setHoldScale(parseFloat(e.target.value))} />
            <span className="cv-ffmpeg-slider-val">{holdScale.toFixed(2)}</span>
          </div>

          <div className="cv-chroma-motion-row">
            <label>
              <input type="checkbox" checked={shadowOn} onChange={(e) => setShadowOn(e.target.checked)} />
              <span> Drop Shadow</span>
            </label>
          </div>

          {shadowOn && (
            <>
              <div className="cv-ffmpeg-slider-row">
                <label className="cv-ffmpeg-slider-label">Shadow Blur</label>
                <input type="range" className="cv-ffmpeg-slider nodrag nopan"
                  min={0} max={80} step={2}
                  value={shadowBlur}
                  onPointerDown={(e) => e.stopPropagation()}
                  onChange={(e) => setShadowBlur(parseInt(e.target.value, 10))} />
                <span className="cv-ffmpeg-slider-val">{shadowBlur}</span>
              </div>
              <div className="cv-ffmpeg-slider-row">
                <label className="cv-ffmpeg-slider-label">Shadow Opacity</label>
                <input type="range" className="cv-ffmpeg-slider nodrag nopan"
                  min={0} max={1} step={0.05}
                  value={shadowOpacity}
                  onPointerDown={(e) => e.stopPropagation()}
                  onChange={(e) => setShadowOpacity(parseFloat(e.target.value))} />
                <span className="cv-ffmpeg-slider-val">{shadowOpacity.toFixed(2)}</span>
              </div>
            </>
          )}
        </div>
      )}

      {status === 'rendering' && <div className="cv-chroma-motion-status">Rendering motion composite…</div>}
      {status === 'error' && <div className="cv-chroma-motion-status cv-chroma-motion-error">{result.error}</div>}

      {resultUrl && (
        <div className="cv-chroma-motion-result">
          <video
            src={`http://localhost:3001${resultUrl}`}
            controls
            loop
            muted
            playsInline
            className="cv-chroma-motion-video"
          />
          <button className="cv-btn cv-btn-sm" onClick={(e) => { e.stopPropagation(); copyUrl(); }}>
            {urlCopied ? 'Copied!' : 'Copy URL'}
          </button>
        </div>
      )}

      <button className="cv-btn cv-btn-chroma-motion"
        disabled={!canRender}
        onClick={(e) => {
          e.stopPropagation();
          onChromaMotion(id, {
            characterUrl,
            backgroundUrl,
            durationSec,
            motion: { entry, exit, entryDurationS: 0.8, exitDurationS: 0.8, holdScale, holdX: 0, holdY: 0 },
            shadow: { enabled: shadowOn, blur: shadowBlur, offsetY: 20, opacity: shadowOpacity },
          });
        }}>
        {status === 'rendering' ? 'Rendering...' : resultUrl ? 'Re-render' : 'Render Motion'}
      </button>

      <Handle type="source" position={Position.Right} id="motion-out" />
    </div>
  );
}

/* ===== CHROMA STYLIZE NODE — greenscreen video → effect preset → transparent .webm ===== */
// Reverse-bokeh sibling of ChromaComposite. Input is a video shot against a
// solid chroma backdrop (green default, magenta for 16-GAMI). FFmpeg keys it
// out and applies a preset effect to the foreground, emitting a VP9 yuva420p
// .webm that drops straight into Cartesian Composer as a transparent overlay.
// Use case: Camera 2 (cube/hands on greenscreen) → ChromaStylize → composite
// behind talking-head from Camera 1 via Cartesian. AR-style hovering content
// with no actual AR rig.
const CHROMA_STYLIZE_PRESETS = [
  { id: 'glitch',       label: 'Glitch',       hint: 'RGB channel split' },
  { id: 'pixel-dither', label: 'Pixel Dither', hint: '16-bit pixelate' },
  { id: 'crt-scanline', label: 'CRT Scanline', hint: 'phosphor + scanlines' },
];

function ChromaStylizeNode({ id }) {
  const { edges, nodeOutputs, onChromaStylize, onAssetSequencePublish } = useContext(CanvasCtx);
  const [preset, setPreset] = useState('glitch');
  const [intensity, setIntensity] = useState(0.5);
  const [keyColor, setKeyColor] = useState('#00FF00');
  const [similarity, setSimilarity] = useState(0.25);  // per feedback_chroma_prompt_tuning
  const [blend, setBlend] = useState(0.08);
  const [scale, setScale] = useState(1.0);
  const [manualUrl, setManualUrl] = useState('');
  const [slidersOpen, setSlidersOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  // Trace upstream video — same shape as BokehNode / VideoSource consumers.
  let wiredVideo = null;
  for (const edge of (edges || []).filter(e => e.target === id)) {
    const src = nodeOutputs?.[edge.source];
    if (!src) continue;
    if (src.localPath || src.url) { wiredVideo = src; break; }
  }
  const wiredUrl = wiredVideo?.localPath || wiredVideo?.url || '';
  const effectiveUrl = wiredUrl || manualUrl.trim();

  const result = nodeOutputs?.[id] || {};
  const resultUrl = result.url || '';
  const status = result.status || 'idle';
  const errorMsg = result.error || '';

  // Publish to wire-out (so AssetSequence/Cartesian see it as a video asset)
  useEffect(() => {
    if (!resultUrl) return;
    onAssetSequencePublish?.(id, { url: resultUrl, type: 'video' });
  }, [id, resultUrl, onAssetSequencePublish]);

  const copyUrl = async () => {
    if (resultUrl) {
      await navigator.clipboard.writeText(`http://localhost:3001${resultUrl}`).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const dotColor = status === 'rendering' ? '#fb923c'
    : status === 'error' ? '#e85d75'
    : resultUrl ? '#00FFFF'
    : effectiveUrl ? '#ff6b35'
    : '#555';

  return (
    <div className="cv-node cv-ffmpeg-grade" style={{ '--status-color': dotColor, '--node-accent': '#ff6b35' }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="video-in" />

      <div className="cv-ffmpeg-header">
        <div className="cv-ffmpeg-dot" />
        <span className="cv-ffmpeg-title">Chroma Stylize</span>
        <span className="cv-ffmpeg-badge">FFmpeg · α-webm</span>
      </div>

      <div className="cv-carousel-inputs">
        <div className="cv-carousel-input-row">
          <span className={`cv-carousel-input-dot ${effectiveUrl ? 'active' : ''}`} />
          <span>
            {wiredUrl
              ? `wire · ${(wiredUrl.split('/').pop() || wiredUrl).slice(0, 36)}`
              : manualUrl
                ? `manual · ${manualUrl.slice(0, 36)}`
                : 'Wire greenscreen video (or paste URL below)'}
          </span>
        </div>
      </div>

      {!wiredUrl && (
        <input
          className="nodrag"
          type="text"
          placeholder="paste video URL / local path"
          value={manualUrl}
          onChange={(e) => setManualUrl(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{ width: '100%', padding: '6px 8px', fontSize: 11, marginTop: 4, marginBottom: 4, background: 'var(--bg-input, #1a1a22)', border: '1px solid #333', color: '#e8e8e8', borderRadius: 4, boxSizing: 'border-box' }}
        />
      )}

      <button className="cv-gami-viewer-toggle" onClick={(e) => { e.stopPropagation(); setSlidersOpen(!slidersOpen); }}>
        {slidersOpen ? 'Hide Controls' : 'Show Controls'}
      </button>

      {slidersOpen && (
        <div className="cv-ffmpeg-sliders nodrag nopan nowheel"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}>

          <div className="cv-ffmpeg-slider-row" style={{ flexWrap: 'wrap', gap: 4 }}>
            <label className="cv-ffmpeg-slider-label" style={{ width: '100%', marginBottom: 2 }}>Preset</label>
            {CHROMA_STYLIZE_PRESETS.map((p) => (
              <button
                key={p.id}
                className="nodrag"
                onClick={(e) => { e.stopPropagation(); setPreset(p.id); }}
                title={p.hint}
                style={{
                  flex: '1 1 30%',
                  padding: '6px 4px',
                  fontSize: 10,
                  fontWeight: 600,
                  background: preset === p.id ? '#ff6b35' : 'transparent',
                  color: preset === p.id ? '#0a0a0f' : '#e8e8e8',
                  border: `1px solid ${preset === p.id ? '#ff6b35' : '#444'}`,
                  borderRadius: 4,
                  cursor: 'pointer',
                  boxSizing: 'border-box',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="cv-ffmpeg-slider-row">
            <label className="cv-ffmpeg-slider-label">Intensity</label>
            <input type="range" className="cv-ffmpeg-slider nodrag nopan"
              min={0} max={1} step={0.05}
              value={intensity}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => setIntensity(parseFloat(e.target.value))} />
            <span className="cv-ffmpeg-slider-val">{intensity.toFixed(2)}</span>
          </div>

          <div className="cv-ffmpeg-slider-row">
            <label className="cv-ffmpeg-slider-label">Key Color</label>
            <input type="color" value={keyColor}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setKeyColor(e.target.value)}
              style={{ width: 40, height: 24, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }} />
            <span className="cv-ffmpeg-slider-val" style={{ fontFamily: 'monospace' }}>{keyColor}</span>
          </div>

          <div className="cv-ffmpeg-slider-row">
            <label className="cv-ffmpeg-slider-label">Similarity</label>
            <input type="range" className="cv-ffmpeg-slider nodrag nopan"
              min={0.05} max={0.5} step={0.01}
              value={similarity}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => setSimilarity(parseFloat(e.target.value))} />
            <span className="cv-ffmpeg-slider-val">{similarity.toFixed(2)}</span>
          </div>

          <div className="cv-ffmpeg-slider-row">
            <label className="cv-ffmpeg-slider-label">Edge Blend</label>
            <input type="range" className="cv-ffmpeg-slider nodrag nopan"
              min={0} max={0.3} step={0.01}
              value={blend}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => setBlend(parseFloat(e.target.value))} />
            <span className="cv-ffmpeg-slider-val">{blend.toFixed(2)}</span>
          </div>

          <div className="cv-ffmpeg-slider-row">
            <label className="cv-ffmpeg-slider-label">Scale</label>
            <input type="range" className="cv-ffmpeg-slider nodrag nopan"
              min={0.25} max={2.0} step={0.05}
              value={scale}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => setScale(parseFloat(e.target.value))} />
            <span className="cv-ffmpeg-slider-val">{scale.toFixed(2)}</span>
          </div>
        </div>
      )}

      {resultUrl && (
        <div className="cv-gami-viewer">
          <video src={`http://localhost:3001${resultUrl}`} controls loop muted playsInline
            style={{ width: '100%', borderRadius: 8, background: 'repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 50% / 14px 14px' }} />
          <button className="cv-gami-copy-btn nodrag" onClick={(e) => { e.stopPropagation(); copyUrl(); }}>
            {copied ? 'Copied' : 'Copy URL'}
          </button>
        </div>
      )}

      {status === 'error' && (
        <div className="cv-gami-viewer-error" style={{ fontSize: 11, padding: 6 }}>{errorMsg}</div>
      )}

      <button className="cv-btn cv-btn-ffmpeg"
        disabled={!effectiveUrl || status === 'rendering'}
        onClick={(e) => {
          e.stopPropagation();
          onChromaStylize(id, {
            videoUrl: effectiveUrl,
            preset,
            intensity,
            keyColor,
            similarity,
            blend,
            scale,
          });
        }}>
        {status === 'rendering' ? 'Stylizing...' : resultUrl ? 'Re-stylize' : 'Stylize'}
      </button>

      <Handle type="source" position={Position.Right} id="stylized-out" />
    </div>
  );
}

/* ===== HYPERFRAMES OVERLAY NODE — burn an animated hook caption over a video clip ===== */
const HYPERFRAMES_POSITIONS = [
  { id: 'bottom', label: 'Bottom' },
  { id: 'top',    label: 'Top' },
];

const HYPERFRAMES_EFFECTS = [
  { id: 'hook-caption',    label: 'Hook Caption',    textLabel: 'caption'     },
  { id: 'title-card',      label: 'Title Card',      textLabel: 'title'       },
  { id: 'lower-third',     label: 'Lower Third',     textLabel: 'name'        },
  { id: 'highlight-sweep', label: 'Highlight Sweep', textLabel: 'caption'     },
  { id: 'burst-lines',     label: 'Burst Lines',     textLabel: null          },
];

function HyperframesNode({ id }) {
  const { edges, nodeOutputs, onHyperframesOverlay } = useContext(CanvasCtx);
  const [effect, setEffect] = useState('hook-caption');
  const [textOverride, setTextOverride] = useState('');
  // Per-effect secondary state (preserved across effect switches)
  const [subtitle, setSubtitle] = useState('');
  const [role, setRole] = useState('');
  const [side, setSide] = useState('left');
  const [targetWord, setTargetWord] = useState('');
  const [direction, setDirection] = useState('ltr');
  const [timestamp, setTimestamp] = useState('1.0');
  const [density, setDensity] = useState('medium');
  const [position, setPosition] = useState('bottom');
  const [accentColor, setAccentColor] = useState('#C9A227');
  const [quality, setQuality] = useState('standard');
  const [urlCopied, setUrlCopied] = useState(false);

  // Resolve upstream video + text + duration (for render-time estimate)
  let upstreamVideoUrl = '';
  let upstreamText = '';
  let upstreamDuration = 0;
  for (const edge of (edges || []).filter(e => e.target === id)) {
    const src = nodeOutputs?.[edge.source];
    if (!src) continue;
    const h = edge.targetHandle;
    if (h === 'text-in' && !upstreamText) {
      upstreamText = src.hook || src.caption || src.script || '';
    }
    if (!upstreamVideoUrl && (h === 'video-in' || !h || h === null)) {
      if (src.url) {
        upstreamVideoUrl = src.url;
        upstreamDuration = src.duration || src.durationSec || 0;
      } else if (src.videos?.length) {
        const done = src.videos.find(v => v.status === 'done' && v.url);
        if (done) {
          upstreamVideoUrl = done.url;
          upstreamDuration = done.duration || done.durationSec || 0;
        }
      }
    }
    if (!upstreamText) upstreamText = src.hook || src.caption || '';
  }

  const activeText = (upstreamText || textOverride).trim();
  const currentEffect = HYPERFRAMES_EFFECTS.find(e => e.id === effect) || HYPERFRAMES_EFFECTS[0];
  const needsText = !!currentEffect.textLabel;
  const usesPosition = effect === 'hook-caption' || effect === 'highlight-sweep';

  const result = nodeOutputs?.[id] || {};
  const status = result.status || 'idle';
  const resultUrl = result.url || '';

  // Per-effect validity — what must be present for canRender
  let missingReason = '';
  if (!upstreamVideoUrl) missingReason = 'video not wired';
  else if (needsText && !activeText) missingReason = `${currentEffect.textLabel} required`;
  else if (effect === 'highlight-sweep' && !targetWord.trim()) missingReason = 'target word required';
  else if (effect === 'title-card' && !activeText.trim()) missingReason = 'title required';
  else if (effect === 'lower-third' && !activeText.trim()) missingReason = 'name required';
  const canRender = !missingReason && status !== 'rendering';

  const copyUrl = async () => {
    if (!resultUrl) return;
    await navigator.clipboard.writeText(`http://localhost:3001${resultUrl}`).catch(() => {});
    setUrlCopied(true);
    setTimeout(() => setUrlCopied(false), 1500);
  };

  const build = () => {
    const common = { videoUrl: upstreamVideoUrl, accentColor, quality, effect };
    switch (effect) {
      case 'title-card':
        return { ...common, title: activeText, subtitle };
      case 'lower-third':
        return { ...common, name: activeText, role, side };
      case 'highlight-sweep':
        return { ...common, caption: activeText, targetWord, direction, position };
      case 'burst-lines':
        return { ...common, timestamp: parseFloat(timestamp) || 0.5, density };
      case 'hook-caption':
      default:
        return { ...common, caption: activeText, position };
    }
  };

  return (
    <div className="cv-node cv-hyperframes" style={{ '--status-color': status === 'rendering' ? '#e85d75' : resultUrl ? '#00FFFF' : canRender ? '#00bcd4' : '#555' }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="video-in" style={{ top: '35%' }} />
      <Handle type="target" position={Position.Left} id="text-in" style={{ top: '70%' }} />

      <div className="cv-hyperframes-header">
        <div className="cv-hyperframes-dot" />
        <span className="cv-hyperframes-title">Hyperframes</span>
        <span className="cv-hyperframes-badge">{currentEffect.label}</span>
      </div>

      {/* Effect dropdown — primary selector */}
      <div className="cv-hyperframes-controls" style={{ marginBottom: 6 }}>
        <select
          className="cv-blotato-select"
          value={effect}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); setEffect(e.target.value); }}
          title="Hyperframes overlay effect"
          style={{ flex: 1 }}
        >
          {HYPERFRAMES_EFFECTS.map(fx => <option key={fx.id} value={fx.id}>{fx.label}</option>)}
        </select>
      </div>

      {/* Upstream wiring indicators */}
      <div className="cv-carousel-inputs">
        <div className="cv-carousel-input-row">
          <span className={`cv-carousel-input-dot ${upstreamVideoUrl ? 'active' : ''}`} />
          <span>{upstreamVideoUrl ? 'Video wired' : 'Wire video (top handle)'}</span>
        </div>
        {needsText && (
          <div className="cv-carousel-input-row">
            <span className={`cv-carousel-input-dot ${activeText ? 'active' : ''}`} />
            <span>{upstreamText ? `${currentEffect.textLabel} from upstream` : activeText ? `Manual ${currentEffect.textLabel} set` : `Wire ${currentEffect.textLabel} or type below`}</span>
          </div>
        )}
      </div>

      {/* Primary text field (only when effect needs text AND no upstream) */}
      {needsText && !upstreamText && (
        <textarea
          className="cv-hyperframes-caption"
          placeholder={
            effect === 'title-card' ? 'Title — 1 to 4 words recommended' :
            effect === 'lower-third' ? 'Name — e.g. Jane Doe' :
            'Caption — keep under ~10 words for readability'
          }
          value={textOverride}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); setTextOverride(e.target.value); }}
          rows={2}
        />
      )}

      {/* Effect-specific sub-controls */}
      {effect === 'title-card' && (
        <textarea
          className="cv-hyperframes-caption"
          placeholder="Subtitle (optional) — role, episode number, date"
          value={subtitle}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); setSubtitle(e.target.value); }}
          rows={1}
        />
      )}

      {effect === 'lower-third' && (
        <>
          <textarea
            className="cv-hyperframes-caption"
            placeholder="Role / title — e.g. CEO, Skyframe"
            value={role}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); setRole(e.target.value); }}
            rows={1}
          />
          <div className="cv-hyperframes-controls">
            <select className="cv-blotato-select" value={side}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => { e.stopPropagation(); setSide(e.target.value); }}
              title="Badge side">
              <option value="left">left side</option>
              <option value="right">right side</option>
            </select>
          </div>
        </>
      )}

      {effect === 'highlight-sweep' && (
        <div className="cv-hyperframes-controls">
          <input
            className="cv-blotato-input"
            type="text"
            placeholder="Target word"
            value={targetWord}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); setTargetWord(e.target.value); }}
            style={{ flex: 1 }}
          />
          <select className="cv-blotato-select" value={direction}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); setDirection(e.target.value); }}
            title="Sweep direction">
            <option value="ltr">→</option>
            <option value="rtl">←</option>
          </select>
        </div>
      )}

      {effect === 'burst-lines' && (
        <div className="cv-hyperframes-controls">
          <input
            className="cv-blotato-input nodrag"
            type="number"
            step="0.1"
            min="0"
            placeholder="Timestamp (s)"
            value={timestamp}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); setTimestamp(e.target.value); }}
            style={{ flex: 1 }}
            title="When the burst fires (seconds into clip)"
          />
          <select className="cv-blotato-select" value={density}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); setDensity(e.target.value); }}
            title="Burst density">
            <option value="low">6 lines</option>
            <option value="medium">12 lines</option>
            <option value="high">18 lines</option>
          </select>
        </div>
      )}

      {/* Common controls — position (hook + sweep only), accent, quality */}
      <div className="cv-hyperframes-controls">
        {usesPosition && (
          <select className="cv-blotato-select" value={position}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); setPosition(e.target.value); }}>
            {HYPERFRAMES_POSITIONS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        )}
        <input
          type="color"
          value={accentColor}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); setAccentColor(e.target.value); }}
          style={{ width: 40, height: 28, padding: 0, border: '1px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer' }}
          title="Accent color"
        />
        <select className="cv-blotato-select" value={quality}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); setQuality(e.target.value); }}
          title="Draft = faster, lower bitrate; Standard = final-ready">
          <option value="draft">draft</option>
          <option value="standard">standard</option>
          <option value="high">high</option>
        </select>
      </div>

      {/* Render-time estimate — helps operators judge whether to wait or queue */}
      {canRender && status !== 'rendering' && (() => {
        const knownDuration = upstreamDuration || result.duration || 0;
        const mult = quality === 'high' ? 12 : quality === 'standard' ? 8 : 4;
        if (knownDuration > 0) {
          const est = Math.round(knownDuration * mult + 10);
          const fmt = est >= 60 ? `~${Math.round(est / 60)} min` : `~${est}s`;
          return <div className="cv-hyperframes-status" style={{ color: '#888' }}>
            Render estimate: {fmt} ({knownDuration.toFixed(0)}s clip × {mult}x at {quality})
          </div>;
        }
        return <div className="cv-hyperframes-status" style={{ color: '#888' }}>
          Render takes ~{mult}× clip duration at {quality} quality
        </div>;
      })()}

      {status === 'rendering' && <div className="cv-hyperframes-status">Rendering (Chrome + FFmpeg)…</div>}
      {status === 'error' && <div className="cv-hyperframes-status cv-hyperframes-error">{result.error}</div>}
      {!canRender && status !== 'rendering' && missingReason && (
        <div className="cv-hyperframes-status" style={{ color: '#888' }}>Waiting: {missingReason}</div>
      )}

      {resultUrl && (
        <div className="cv-hyperframes-result">
          <video
            src={`http://localhost:3001${resultUrl}`}
            controls
            loop
            muted
            playsInline
            className="cv-hyperframes-video"
          />
          <button className="cv-btn cv-btn-sm" onClick={(e) => { e.stopPropagation(); copyUrl(); }}>
            {urlCopied ? 'Copied!' : 'Copy URL'}
          </button>
        </div>
      )}

      <button className="cv-btn cv-btn-hyperframes"
        disabled={!canRender}
        onClick={(e) => { e.stopPropagation(); onHyperframesOverlay(id, build()); }}>
        {status === 'rendering' ? 'Rendering...' : resultUrl ? 'Re-render' : `Render ${currentEffect.label}`}
      </button>

      <Handle type="source" position={Position.Right} id="overlay-out" />
    </div>
  );
}

/* ===== VIDEO SOURCE NODE — pick a local file (or paste URL) to feed downstream video nodes ===== */
// Three input modes:
//   1. Local path  — type or pick from the recent-renders dropdown
//   2. URL         — http(s) URL for a remote video
//   3. Recent      — dropdown auto-populated from common render output dirs
//
// Publishes `{ url, path, label, durationSec, width, height }` to nodeOutputs
// so downstream nodes (BrollNode, Hyperframes, FFmpegGrade, ChromaComposite)
// can consume it via their existing `.url` lookup. The `url` field is what
// downstream actually uses — for local paths we publish a /api/local-video
// URL that the server resolves; for remote URLs we pass through unchanged.

const VIDEO_SOURCE_RECENT_DIRS = [
  'pipeline/longform',
  'pipeline/shortform',
  'renders/longform',
  'renders/broll',
  'renders/graded',
];

function VideoSourceNode({ id }) {
  const { nodeOutputs, onVideoSourcePublish, openFilePicker } = useContext(CanvasCtx);
  const [mode, setMode] = useState('path');         // 'path' | 'url' | 'recent'
  const [pathValue, setPathValue] = useState('');
  const [urlValue, setUrlValue] = useState('');
  const [recentDir, setRecentDir] = useState(VIDEO_SOURCE_RECENT_DIRS[0]);
  const [recentList, setRecentList] = useState([]);
  const [recentSelected, setRecentSelected] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [meta, setMeta] = useState({ duration: 0, width: 0, height: 0 });
  const [publishStatus, setPublishStatus] = useState('idle');  // idle | published | error
  const [publishError, setPublishError] = useState('');

  const result = nodeOutputs?.[id] || {};
  const publishedUrl = result.url || '';

  const scanRecent = async () => {
    setScanning(true);
    setScanError('');
    try {
      const res = await fetch(`http://localhost:3001/api/scan-videos?path=${encodeURIComponent(recentDir)}&recurse=1`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `scan failed: ${res.status}`);
      setRecentList(data.videos || []);
    } catch (err) {
      setScanError(err.message);
      setRecentList([]);
    } finally {
      setScanning(false);
    }
  };

  // Auto-scan when recent mode opens or dir changes (must be in effect, not
  // in render body — calling scanRecent during render triggers setState during
  // render which crashes the canvas).
  useEffect(() => {
    if (mode === 'recent' && recentList.length === 0 && !scanning && !scanError) {
      scanRecent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, recentDir]);

  const publish = async () => {
    setPublishStatus('idle');
    setPublishError('');

    let chosenPath = '';
    let chosenLabel = '';
    let chosenUrl = '';
    if (mode === 'path') {
      chosenPath = pathValue.trim();
      chosenLabel = chosenPath.split(/[\\/]/).pop() || chosenPath;
      chosenUrl = `http://localhost:3001/api/local-video?path=${encodeURIComponent(chosenPath)}`;
    } else if (mode === 'url') {
      chosenUrl = urlValue.trim();
      chosenLabel = chosenUrl.split('/').pop() || chosenUrl;
      chosenPath = chosenUrl;
    } else if (mode === 'recent') {
      chosenPath = recentSelected;
      chosenLabel = chosenPath.split(/[\\/]/).pop() || chosenPath;
      chosenUrl = `http://localhost:3001/api/local-video?path=${encodeURIComponent(chosenPath)}`;
    }

    if (!chosenPath && !chosenUrl) {
      setPublishStatus('error');
      setPublishError('Pick a path or URL first');
      return;
    }

    // For local files, also publish the absolute path so server endpoints
    // (which prefer absolute paths over served URLs) can use the cleaner one.
    const isLocal = mode === 'path' || mode === 'recent';

    // Probe metadata if local — best-effort; failure is non-fatal but
    // downstream nodes (especially Cartesian Composer) really do need real
    // duration/dimensions so the rendered comp matches the actual playable
    // file length. Stale/zero placeholders here are how the freeze-tail bug
    // gets seeded.
    let probedMeta = { duration: 0, width: 0, height: 0, isImage: false };
    if (isLocal && chosenPath) {
      try {
        const probeRes = await fetch(`http://localhost:3001/api/probe-media?path=${encodeURIComponent(chosenPath)}`);
        if (probeRes.ok) {
          const data = await probeRes.json();
          probedMeta = {
            duration: Number(data.durationSec) || 0,
            durationSec: Number(data.durationSec) || 0,
            width: Number(data.width) || 0,
            height: Number(data.height) || 0,
            isImage: !!data.isImage,
          };
        } else if (probeRes.status === 404) {
          setPublishStatus('error');
          setPublishError(`File not found: ${chosenPath}`);
          return;
        }
      } catch {
        // ignore — server may still resolve via path; downstream falls back
        // to its own ffprobe pass.
      }
    }

    // Publish to nodeOutputs. Downstream nodes look at `.url` first; for
    // server-side render endpoints we publish path too so the server can
    // bypass HTTP and read the file directly.
    onVideoSourcePublish?.(id, {
      url: isLocal ? chosenPath : chosenUrl,    // server prefers raw path; URL works too
      servedUrl: chosenUrl,
      path: chosenPath,
      label: chosenLabel,
      ...probedMeta,
    });
    setMeta(probedMeta);
    setPublishStatus('published');
  };

  const dotColor = publishStatus === 'error' ? '#e74c3c'
    : publishedUrl ? '#00FFFF'
    : '#555';

  return (
    <div className="cv-node cv-video-source" style={{ '--status-color': dotColor, '--node-accent': '#3b82f6' }}>
      <NodeDeleteBtn nodeId={id} />

      <div className="cv-video-source-header">
        <div className="cv-video-source-dot" />
        <span className="cv-video-source-title">Video Source</span>
        <span className="cv-video-source-badge">{mode}</span>
      </div>

      <div className="cv-video-source-modes">
        {['path', 'url', 'recent'].map((m) => (
          <button
            key={m}
            className={`cv-video-source-mode${mode === m ? ' active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setMode(m); }}
          >
            {m === 'path' ? 'Local path' : m === 'url' ? 'URL' : 'Recent renders'}
          </button>
        ))}
      </div>

      {mode === 'path' && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            type="text"
            className="cv-video-source-input"
            placeholder="e.g. pipeline/longform/talking_head2.mp4"
            value={pathValue}
            onChange={(e) => { e.stopPropagation(); setPathValue(e.target.value); }}
            onClick={(e) => e.stopPropagation()}
            style={{ flex: 1, minWidth: 0 }}
          />
          <button
            className="nodrag"
            onClick={(e) => { e.stopPropagation(); openFilePicker({
              key: 'video-source', label: 'a video',
              startDir: '.\\testing-vids',
              exts: ['mp4', 'mov', 'webm', 'mkv', 'm4v'],
            }, (p) => setPathValue(p)); }}
            onMouseDown={(e) => e.stopPropagation()}
            title="Browse for video"
            style={{ padding: '6px 9px', fontSize: 13, background: 'var(--bg-card, #1a1a24)', border: '1px solid var(--border, #2a2a35)', borderRadius: 4, cursor: 'pointer' }}
          >📁</button>
        </div>
      )}

      {mode === 'url' && (
        <input
          type="text"
          className="cv-video-source-input"
          placeholder="https://..."
          value={urlValue}
          onChange={(e) => { e.stopPropagation(); setUrlValue(e.target.value); }}
          onClick={(e) => e.stopPropagation()}
        />
      )}

      {mode === 'recent' && (
        <>
          <select
            className="cv-video-source-input"
            value={recentDir}
            onChange={(e) => {
              e.stopPropagation();
              setRecentDir(e.target.value);
              setRecentList([]);
              setRecentSelected('');
              setScanError('');
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {VIDEO_SOURCE_RECENT_DIRS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          {scanning && <div className="cv-video-source-status">Scanning {recentDir}...</div>}
          {scanError && <div className="cv-video-source-error">{scanError}</div>}
          {recentList.length > 0 && (
            <select
              className="cv-video-source-input"
              value={recentSelected}
              onChange={(e) => { e.stopPropagation(); setRecentSelected(e.target.value); }}
              onClick={(e) => e.stopPropagation()}
            >
              <option value="">— pick a file —</option>
              {recentList.map((v) => (
                <option key={v.path} value={v.path}>{v.name}</option>
              ))}
            </select>
          )}
          <button
            className="cv-video-source-rescan"
            onClick={(e) => { e.stopPropagation(); setRecentList([]); scanRecent(); }}
          >
            ↻ Rescan
          </button>
        </>
      )}

      <button
        className="cv-btn cv-btn-video-source"
        onClick={(e) => { e.stopPropagation(); publish(); }}
      >
        {publishedUrl ? 'Re-publish' : 'Publish to canvas'}
      </button>

      {publishedUrl && (
        <div className="cv-video-source-published">
          <div>{result.label || publishedUrl.split(/[\\/]/).pop()}</div>
          {(meta.duration || result.duration) ? (
            <div className="cv-video-source-meta">{(meta.duration || result.duration).toFixed(1)}s · {meta.width || result.width || '?'}x{meta.height || result.height || '?'}</div>
          ) : null}
        </div>
      )}
      {publishError && <div className="cv-video-source-error">{publishError}</div>}

      <Handle type="source" position={Position.Right} id="video-out" />
    </div>
  );
}

/* ===== B-ROLL NODE — splice full-frame motion-graphic cuts into a talking-head ===== */
function BrollNode({ id }) {
  const { edges, nodeOutputs, onBrollSuggest, onBrollRender } = useContext(CanvasCtx);
  const [maxCuts, setMaxCuts] = useState(3);
  const [transcriptOverride, setTranscriptOverride] = useState('');
  const [urlCopied, setUrlCopied] = useState(false);

  // Resolve upstream video URL + transcript text + duration
  let upstreamVideoUrl = '';
  let upstreamTranscript = '';
  let upstreamDuration = 0;
  for (const edge of (edges || []).filter(e => e.target === id)) {
    const src = nodeOutputs?.[edge.source];
    if (!src) continue;
    if (!upstreamVideoUrl) {
      if (src.url) {
        upstreamVideoUrl = src.url;
        upstreamDuration = src.duration || src.durationSec || 0;
      } else if (src.videos?.length) {
        const done = src.videos.find(v => v.status === 'done' && v.url);
        if (done) {
          upstreamVideoUrl = done.url;
          upstreamDuration = done.duration || done.durationSec || 0;
        }
      }
    }
    if (!upstreamTranscript) {
      upstreamTranscript = src.transcript || src.transcriptText || src.script || '';
    }
  }

  const result = nodeOutputs?.[id] || {};
  const plan = result.plan;
  const suggestStatus = result.suggestStatus || 'idle';
  const renderStatus = result.renderStatus || 'idle';
  const finalUrl = result.url || '';
  const error = result.error || '';

  const transcript = (upstreamTranscript || transcriptOverride).trim();
  const canSuggest = !!upstreamVideoUrl && !!transcript && suggestStatus !== 'thinking';
  const canRender = !!plan?.cuts?.length && renderStatus !== 'rendering';

  const copyUrl = async () => {
    if (!finalUrl) return;
    await navigator.clipboard.writeText(`http://localhost:3001${finalUrl}`).catch(() => {});
    setUrlCopied(true);
    setTimeout(() => setUrlCopied(false), 1500);
  };

  const dotColor = renderStatus === 'rendering' || suggestStatus === 'thinking' ? '#e85d75'
    : finalUrl ? '#00FFFF'
    : plan?.cuts?.length ? '#ff9500'
    : canSuggest ? '#ff9500'
    : '#555';

  return (
    <div className="cv-node cv-broll" style={{ '--status-color': dotColor, '--node-accent': '#ff9500' }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="video-in" style={{ top: '40%' }} />
      <Handle type="target" position={Position.Left} id="text-in" style={{ top: '70%' }} />

      <div className="cv-broll-header">
        <div className="cv-broll-dot" />
        <span className="cv-broll-title">B-Roll</span>
        <span className="cv-broll-badge">{plan?.cuts?.length || 0} cuts</span>
      </div>

      <div className="cv-broll-inputs">
        <div className="cv-broll-input-row">
          <span className={`cv-broll-input-dot ${upstreamVideoUrl ? 'active' : ''}`} />
          <span>{upstreamVideoUrl ? `video wired (${upstreamDuration ? upstreamDuration.toFixed(1) + 's' : '?s'})` : 'no video wired'}</span>
        </div>
        <div className="cv-broll-input-row">
          <span className={`cv-broll-input-dot ${transcript ? 'active' : ''}`} />
          <span>{transcript ? `transcript: ${transcript.split(/\s+/).length} words` : 'no transcript'}</span>
        </div>
      </div>

      {!upstreamTranscript && (
        <textarea
          className="cv-broll-transcript"
          placeholder="Paste transcript here (or wire one upstream)"
          value={transcriptOverride}
          onChange={(e) => { e.stopPropagation(); setTranscriptOverride(e.target.value); }}
          onClick={(e) => e.stopPropagation()}
          rows={3}
        />
      )}

      <div className="cv-broll-controls">
        <label className="cv-broll-cuts-label" onClick={(e) => e.stopPropagation()}>
          Max cuts:
          <select value={maxCuts} onChange={(e) => { e.stopPropagation(); setMaxCuts(+e.target.value); }}>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
            <option value={5}>5</option>
          </select>
        </label>
      </div>

      <button
        className="cv-btn cv-btn-broll-suggest"
        disabled={!canSuggest}
        onClick={(e) => {
          e.stopPropagation();
          onBrollSuggest(id, { videoUrl: upstreamVideoUrl, transcript, durationSec: upstreamDuration, maxCuts });
        }}
      >
        {suggestStatus === 'thinking' ? 'Thinking...' : plan?.cuts?.length ? 'Re-suggest cuts' : 'Suggest B-roll cuts'}
      </button>

      {plan?.cuts?.length > 0 && (
        <div className="cv-broll-plan">
          {plan.cuts.map((cut, i) => (
            <div key={i} className="cv-broll-cut">
              <div className="cv-broll-cut-row">
                <span className="cv-broll-cut-time">@{cut.atSec.toFixed(1)}s · {cut.durationSec.toFixed(1)}s</span>
                <span className="cv-broll-cut-id">{cut.compId}</span>
              </div>
              <div className="cv-broll-cut-reason">{cut.reason}</div>
            </div>
          ))}
        </div>
      )}

      <button
        className="cv-btn cv-btn-broll-render"
        disabled={!canRender}
        onClick={(e) => {
          e.stopPropagation();
          onBrollRender(id, { videoUrl: upstreamVideoUrl, plan });
        }}
      >
        {renderStatus === 'rendering' ? 'Rendering + splicing...' : finalUrl ? 'Re-render' : 'Render + splice'}
      </button>

      {finalUrl && (
        <div className="cv-broll-result">
          <a
            href={`http://localhost:3001${finalUrl}`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            open final mp4
          </a>
          <button
            className="cv-broll-copy"
            onClick={(e) => { e.stopPropagation(); copyUrl(); }}
          >
            {urlCopied ? 'copied!' : 'copy url'}
          </button>
        </div>
      )}

      {error && <div className="cv-broll-error">{error}</div>}

      <Handle type="source" position={Position.Right} id="broll-out" />
    </div>
  );
}

/* ===== GPT IMAGE-2 NODE — OpenAI's GPT Image-2 via kie.ai, with optional 16-GAMI blend ===== */
const IMAGE2_ASPECT_RATIOS = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '4:5', '5:4', '21:9'];

function ImageTwoNode({ id, data }) {
  const { script, edges, nodeOutputs, onImageTwoBatchGenerate } = useContext(CanvasCtx);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('kie-api-key') || '');
  const [showKey, setShowKey] = useState(false);
  // Seed from data so a Conductor-composed node shows its pre-filled config.
  const [aspectRatio, setAspectRatio] = useState(data?.aspectRatio || '1:1');
  const [style, setStyle] = useState(data?.style || 'none'); // 'none' | 'scene' | 'infographic'
  const [viewIndex, setViewIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [freeformText, setFreeformText] = useState(data?.freeformText || '');

  const saveKey = (v) => { setApiKey(v); localStorage.setItem('kie-api-key', v); };

  // Trace upstream script — wired edge wins over local textarea
  const inputScript = useMemo(() => {
    const inEdge = edges?.find(e => e.target === id);
    if (!inEdge) return null;
    const src = nodeOutputs?.[inEdge.source];
    if (src?.script) return src.script;
    if (src?.prompt) return src.prompt;
    return script || null;
  }, [edges, id, script, nodeOutputs]);

  const isFreeform = !inputScript && freeformText.trim().length > 0;

  // Slides: parsed script + CTA, or single freeform, or empty
  const slides = useMemo(() => {
    if (isFreeform) return [{ num: 1, text: freeformText.trim() }];
    const parsed = inputScript ? parseSlides(inputScript) : [];
    if (parsed.length > 0) parsed.push({ num: parsed.length + 1, text: 'Follow for more Cybersecurity and AI Stories', isCta: true });
    return parsed;
  }, [inputScript, isFreeform, freeformText]);

  // Per-slide prompts. Style selector chooses between freeform (no prefix),
  // 16-GAMI Scene (origami diorama), and Infographic (paper data-viz layout).
  // CTA slide always renders the Skyframe logo (lightbulb + quad-drone filament,
  // neon yellow outline) via buildSkyframeLogoPrompt — picks one of the logo
  // variations at random so closers stay visually fresh across carousels.
  const slidePrompts = useMemo(() => slides.map(s => {
    if (s.isCta) return buildSkyframeLogoPrompt(style);
    if (style === 'scene') return `${GAMI_ART_STYLE}\n\n${s.text}`;
    if (style === 'infographic') return `${INFOGRAPHIC_STYLE}\n\nThe infographic subject is:\n"${s.text}"\n\nExtract 2 to 4 key facts, stats, steps, or comparisons from this topic and render each as a distinct labeled paper element with crisp legible typography cut from layered paper. Hierarchy flows top-to-bottom.`;
    return s.text;
  }), [slides, style]);

  const result = nodeOutputs?.[id] || {};
  const slideResults = result.slides || [];
  const batchStatus = result.batchStatus || 'idle'; // idle | generating | done | error

  const doneCount = slideResults.filter(s => s.status === 'done').length;
  const genCount = slideResults.filter(s => s.status === 'polling' || s.status === 'submitting').length;
  const errCount = slideResults.filter(s => s.status === 'error').length;
  const isGenerating = batchStatus === 'generating';

  const safeIndex = Math.min(viewIndex, Math.max(slides.length - 1, 0));
  const currentSlide = slides[safeIndex];
  const currentResult = slideResults[safeIndex];
  const currentUrl = currentResult?.url || '';

  const copyUrl = async () => {
    if (!currentUrl) return;
    await navigator.clipboard.writeText(currentUrl).catch(() => {});
    setUrlCopied(true);
    setTimeout(() => setUrlCopied(false), 1500);
  };
  const copyPrompt = async () => {
    const p = slidePrompts[safeIndex];
    if (!p) return;
    await navigator.clipboard.writeText(p).catch(() => {});
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 1500);
  };
  // Single-image download — same blob-fetch + open-in-tab fallback as the
  // Download All button, just for the currently-viewed slide.
  const downloadCurrent = async () => {
    if (!currentUrl || downloading) return;
    setDownloading(true);
    try {
      const resp = await fetch(currentUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `image2_slide_${safeIndex + 1}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(currentUrl, '_blank');
    } finally {
      setDownloading(false);
    }
  };
  const prev = () => setViewIndex(i => Math.max(0, i - 1));
  const next = () => setViewIndex(i => Math.min(slides.length - 1, i + 1));

  const headerStatusColor = isGenerating ? '#e85d75' : doneCount > 0 ? '#00FFFF' : '#10a37f';

  return (
    <div className="cv-node cv-image2" style={{ '--status-color': headerStatusColor }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="prompt-in" />

      <div className="cv-image2-header">
        <span className="cv-image2-dot" />
        <span className="cv-image2-title">IMAGE-2</span>
        <span className="cv-image2-badge">{isFreeform ? 'Freeform' : inputScript ? 'Batch' : 'GPT · OpenAI'}</span>
        {slides.length > 0 && (
          <span className="cv-gami-slide-count">{isFreeform ? '1 image' : `${slides.length} slides`}</span>
        )}
      </div>

      {/* Freeform textarea when no script wired */}
      {!inputScript && (
        <div className="cv-gami-freeform">
          <textarea className="cv-gami-freeform-input" rows={3}
            placeholder="Free-form prompt — Image-2 is typography-native. Chalkboards, signs, posters, menus, UI mockups, packaging."
            value={freeformText}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); setFreeformText(e.target.value); }} />
          {!freeformText.trim() && <div className="cv-gami-freeform-hint">Or wire a script to the left handle</div>}
          {freeformText.trim() && (
            <button className="cv-btn cv-btn-sm cv-gami-prompt-preview"
              onClick={(e) => { e.stopPropagation(); copyPrompt(); }}
              title="Copy the full composed prompt (style block + your text) — paste into ChatGPT/Midjourney/etc. to compare against our pipeline's output before generating">
              {promptCopied ? 'Copied!' : 'Copy Prompt (preview)'}
            </button>
          )}
        </div>
      )}

      {/* Controls — show when script wired OR freeform has text */}
      {(inputScript || isFreeform) && (
        <div className="cv-image2-controls">
          <select
            className="cv-blotato-select cv-image2-ar"
            value={aspectRatio}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); setAspectRatio(e.target.value); }}
          >
            {IMAGE2_ASPECT_RATIOS.map(ar => <option key={ar} value={ar}>{ar}</option>)}
          </select>

          <select
            className="cv-blotato-select"
            value={style}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); setStyle(e.target.value); }}
            title="None = raw prompt. Scene = 16-GAMI origami diorama. Infographic = 16-GAMI data-viz layout with typography + callouts (plays to Image-2's typography strength)."
          >
            <option value="none">Free</option>
            <option value="scene">Scene</option>
            <option value="infographic">Infographic</option>
          </select>
        </div>
      )}

      <div className="cv-blotato-field">
        <input className="cv-blotato-input" type={showKey ? 'text' : 'password'} placeholder="KIE API Key"
          value={apiKey} onClick={(e) => e.stopPropagation()} onChange={(e) => saveKey(e.target.value)} />
        <button className="cv-btn cv-btn-sm" title={showKey ? 'Hide key' : 'Show key'}
          onClick={(e) => { e.stopPropagation(); setShowKey(!showKey); }}>{showKey ? '◉' : '○'}</button>
      </div>

      {/* Batch progress bar */}
      {slideResults.length > 0 && (
        <div className="cv-gami-batch-bar">
          <div className="cv-gami-batch-progress">
            {slideResults.map((sr, i) => (
              <div key={i} className={`cv-gami-batch-pip cv-gami-pip-${sr.status || 'idle'}`}
                onClick={(e) => { e.stopPropagation(); setViewIndex(i); setExpanded(true); }}
                title={`Slide ${i + 1}: ${sr.status}`} />
            ))}
          </div>
          <span className="cv-gami-batch-stats">
            {doneCount}/{slides.length} done{genCount > 0 ? ` / ${genCount} gen` : ''}{errCount > 0 ? ` / ${errCount} err` : ''}
          </span>
        </div>
      )}

      {/* Slide viewer toggle */}
      {slideResults.length > 0 && (
        <button className="cv-gami-viewer-toggle" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
          {expanded ? 'Hide Viewer' : 'View Slides'} ({doneCount} ready)
        </button>
      )}

      {/* Download All — fetches every completed image. Falls back to opening
          the URL in a new tab if the kie.ai CDN blocks cross-origin blob fetch. */}
      {doneCount > 0 && (
        <button
          className="cv-btn cv-btn-sm cv-btn-download-all"
          onClick={async (e) => {
            e.stopPropagation();
            const ready = slideResults
              .map((sr, i) => ({ ...sr, idx: i }))
              .filter(sr => sr.status === 'done' && sr.url);
            for (const sr of ready) {
              try {
                const resp = await fetch(sr.url);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const blob = await resp.blob();
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `image2_slide_${sr.idx + 1}.png`;
                a.click();
                URL.revokeObjectURL(a.href);
              } catch {
                window.open(sr.url, '_blank');
              }
              await new Promise(r => setTimeout(r, 150));
            }
          }}
        >
          Download All ({doneCount})
        </button>
      )}

      {expanded && slides.length > 0 && (
        <div className="cv-gami-viewer">
          <div className="cv-gami-viewer-nav">
            <button className="cv-gami-nav-btn" disabled={safeIndex === 0} onClick={(e) => { e.stopPropagation(); prev(); }}>&#9664;</button>
            <span className="cv-gami-nav-label">Slide {safeIndex + 1} / {slides.length}</span>
            <button className="cv-gami-nav-btn" disabled={safeIndex >= slides.length - 1} onClick={(e) => { e.stopPropagation(); next(); }}>&#9654;</button>
          </div>

          <div className="cv-gami-viewer-text">{currentSlide?.text || ''}</div>

          {currentUrl ? (
            <div className="cv-gami-viewer-img-wrap">
              <img src={currentUrl} alt={`Slide ${safeIndex + 1}`} className="cv-gami-viewer-img"
                onClick={(e) => { e.stopPropagation(); window.open(currentUrl, '_blank'); }} />
              <div className="cv-gami-viewer-actions">
                <button className="cv-btn cv-btn-sm" onClick={(e) => { e.stopPropagation(); copyUrl(); }}>
                  {urlCopied ? 'Copied!' : 'Copy URL'}
                </button>
                <button className="cv-btn cv-btn-sm" onClick={(e) => { e.stopPropagation(); copyPrompt(); }}
                  disabled={!slidePrompts[safeIndex]}
                  title="Copy the full image prompt that produced this slide">
                  {promptCopied ? 'Copied!' : 'Copy Prompt'}
                </button>
                <button className="cv-btn cv-btn-sm" onClick={(e) => { e.stopPropagation(); downloadCurrent(); }}
                  disabled={downloading}
                  title="Download this image as PNG">
                  {downloading ? '...' : 'Download'}
                </button>
              </div>
            </div>
          ) : currentResult?.status === 'polling' ? (
            <div className="cv-gami-viewer-pending">Generating... ({currentResult.elapsed || 0}s)</div>
          ) : currentResult?.status === 'error' ? (
            <div className="cv-gami-viewer-error">{currentResult.error}</div>
          ) : (
            <div className="cv-gami-viewer-pending">Pending</div>
          )}
        </div>
      )}

      <button
        className="cv-btn cv-btn-image2"
        disabled={slides.length === 0 || !apiKey || isGenerating}
        onClick={(e) => {
          e.stopPropagation();
          onImageTwoBatchGenerate(id, apiKey, slidePrompts, aspectRatio);
          setExpanded(true);
        }}
      >
        {isGenerating ? `Generating ${genCount}/${slides.length}...`
          : isFreeform ? (doneCount > 0 ? 'Regenerate' : 'Generate Image')
          : doneCount > 0 ? `Regenerate All (${slides.length})` : `Generate All (${slides.length})`}
      </button>

      <Handle type="source" position={Position.Right} id="image-out" />
    </div>
  );
}

/* ===== QC GATE NODE — deterministic ARES-style ship gate for canvas flows ===== */
// V1 is a pure visualizer: shows SHIP/QUARANTINE/REJECT on the wire at a chokepoint.
// The operator is the "Oracle narrator" — they decide whether to wire onward based on the verdict.
// V2 can add automatic blocking if the human-in-the-loop pattern proves too slow.

function QCGateNode({ id }) {
  const { edges, nodeOutputs } = useContext(CanvasCtx);
  const [mode, setMode] = useState('text'); // 'text' | 'metadata'
  const [manualText, setManualText] = useState('');
  const [expanded, setExpanded] = useState(false);

  const upstream = (() => {
    const inEdge = edges?.find(e => e.target === id);
    if (!inEdge) return null;
    return nodeOutputs?.[inEdge.source] || null;
  })();

  const upstreamText = (() => {
    if (!upstream) return '';
    if (typeof upstream === 'string') return upstream;
    return upstream.prompt || upstream.script || upstream.content || upstream.text || '';
  })();

  const activeInput = upstreamText || manualText;

  let verdict = null;
  if (activeInput || mode === 'metadata') {
    if (mode === 'text') {
      verdict = scanText(activeInput);
    } else {
      try {
        const parsed = typeof activeInput === 'string' && activeInput
          ? JSON.parse(activeInput)
          : (upstream && typeof upstream === 'object' ? upstream : {});
        verdict = shipGate(parsed, 0);
      } catch (e) {
        verdict = { verdict: 'REJECT', reasons: [`JSON parse failed: ${e.message}`], warnings: [], violations: [], taintScore: 0 };
      }
    }
  }

  const verdictColors = {
    SHIP: '#00FFFF',
    QUARANTINE: '#f4a261',
    REJECT: '#e74c3c',
  };
  const vc = verdict ? verdictColors[verdict.verdict] : '#555';
  const taintBar = verdict ? `${Math.round(verdict.taintScore * 100)}%` : '—';

  const copy = async () => {
    if (!verdict) return;
    const txt = JSON.stringify({ verdict: verdict.verdict, taintScore: verdict.taintScore, violations: verdict.violations, warnings: verdict.warnings, reasons: verdict.reasons }, null, 2);
    await navigator.clipboard.writeText(txt).catch(() => {});
  };

  return (
    <div className="cv-node cv-qcgate" style={{ '--verdict-color': vc }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="qc-in" />

      <div className="cv-qcgate-header">
        <span className="cv-qcgate-shield">⬢</span>
        <span className="cv-qcgate-title">QC GATE</span>
        <span className="cv-qcgate-badge">ARES</span>
      </div>

      <div className="cv-qcgate-mode">
        <button
          className={`cv-qcgate-modebtn ${mode === 'text' ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setMode('text'); }}
        >Text</button>
        <button
          className={`cv-qcgate-modebtn ${mode === 'metadata' ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setMode('metadata'); }}
        >Metadata</button>
      </div>

      {!upstream && (
        <textarea
          className="cv-qcgate-input"
          placeholder={mode === 'text' ? 'Paste text to scan for injection signatures, or wire a node into the left handle.' : 'Paste metadata JSON with title, description, chapters, vertical_clips.'}
          value={manualText}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); setManualText(e.target.value); }}
          rows={3}
        />
      )}

      {upstream && (
        <div className="cv-qcgate-upstream">
          <span className="cv-qcgate-upstream-label">↑ wired input</span>
          <div className="cv-qcgate-upstream-text">{String(upstreamText).slice(0, 120)}{String(upstreamText).length > 120 ? '…' : ''}</div>
        </div>
      )}

      {verdict && (
        <div className="cv-qcgate-verdict">
          <div className="cv-qcgate-verdict-row">
            <span className="cv-qcgate-verdict-badge" style={{ background: vc }}>{verdict.verdict}</span>
            <span className="cv-qcgate-taint">taint {taintBar}</span>
          </div>
          <div className="cv-qcgate-counts">
            <span>{verdict.violations.length} violations</span>
            <span>·</span>
            <span>{verdict.warnings.length} warnings</span>
            {verdict.reasons.length > 0 && <><span>·</span><span>{verdict.reasons.length} reasons</span></>}
          </div>

          {(verdict.violations.length > 0 || verdict.warnings.length > 0 || verdict.reasons.length > 0) && (
            <>
              <button
                className="cv-qcgate-expand"
                onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
              >{expanded ? '▾ hide detail' : '▸ show detail'}</button>
              {expanded && (
                <div className="cv-qcgate-detail">
                  {verdict.reasons.map((r, i) => (
                    <div key={'r' + i} className="cv-qcgate-line cv-qcgate-reason">REJECT: {r}</div>
                  ))}
                  {verdict.warnings.map((w, i) => (
                    <div key={'w' + i} className="cv-qcgate-line cv-qcgate-warning">WARN: {w}</div>
                  ))}
                  {verdict.violations.map((v, i) => (
                    <div key={'v' + i} className="cv-qcgate-line cv-qcgate-violation">
                      <span className="cv-qcgate-vtype">{v.type}</span>
                      <span className="cv-qcgate-vfield">{v.field}</span>
                      <span className="cv-qcgate-vmatch">"{v.match}"</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <button className="cv-btn cv-btn-sm cv-qcgate-copy" onClick={(e) => { e.stopPropagation(); copy(); }}>
            Copy Report
          </button>
        </div>
      )}

      <Handle type="source" position={Position.Right} id="qc-pass" />
    </div>
  );
}
/* ===== ASSET SEQUENCE NODE — labeled list of typed media for downstream compositors ===== */
//
// Holds an ordered list of typed assets (image / video / text / hyperframes
// overlay) — the operator's "mise en place" for a Cartesian Composer render. Wires
// downstream into Composer's content-pool handle; each Composer zone picks
// from this pool by label rather than pasting URLs.
//
// Publishes `{ type: 'asset-sequence', assets: [...] }` on every change
// (no manual publish button — the auto-write keeps downstream in sync).
const ASSET_SEQUENCE_TYPES = [
  { id: 'image',       label: 'Image' },
  { id: 'video',       label: 'Video' },
  { id: 'text',        label: 'Text' },
  { id: 'hyperframes', label: 'Hyperframes' },
];

const newAssetId = () => `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const newAsset = (n) => ({
  id: newAssetId(),
  label: `Asset ${n}`,
  type: 'image',
  url: '',
  text: '',
  color: '#ffffff',
  bg: 'rgba(0,0,0,0.55)',
  fontSize: 40,
  // width/height are populated by probeMediaDimensions on URL blur. Drives
  // the lock-aspect drag in Cartesian Composer's visual editor; 0 means
  // "unknown — fall back to free resize."
  width: 0,
  height: 0,
});

// Browser-side media probe — returns { width, height } for an image or
// video URL. Routes local file paths through the local-image/local-video
// proxies (the browser can't load raw Windows paths). Returns null on
// error, timeout, or for unprobeable types. Hyperframes assets are mp4
// renders so we treat them as video. The 8s timeout keeps a misbehaving
// CDN from leaving a probe Promise hanging forever — at worst the zone
// just won't lock-aspect.
const probeMediaDimensions = (url, type) => {
  if (!url) return Promise.resolve(null);
  if (type !== 'image' && type !== 'video' && type !== 'hyperframes') {
    return Promise.resolve(null);
  }
  const probeType = type === 'hyperframes' ? 'video' : type;
  const isHttp = /^https?:\/\//.test(url);
  const probeUrl = isHttp ? url
    : probeType === 'image'
      ? `http://localhost:3001/api/local-image?path=${encodeURIComponent(url)}`
      : `http://localhost:3001/api/local-video?path=${encodeURIComponent(url)}`;
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    const timer = setTimeout(() => done(null), 8000);
    if (probeType === 'image') {
      const img = new window.Image();
      img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => done(null);
      img.src = probeUrl;
    } else {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.onloadedmetadata = () => done({ width: v.videoWidth, height: v.videoHeight });
      v.onerror = () => done(null);
      v.src = probeUrl;
    }
  });
};

// Sentence-aware greedy chunker. Splits text into N chunks of roughly
// equal char-length, packing whole sentences. Last chunk takes the
// remainder — never drops content (per feedback_no_silent_truncation).
// Used by AssetSequenceNode when a script wire is connected upstream.
function chunkScriptForLabels(text, n) {
  if (!text || n < 1) return [];
  const sentences = text.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) || [text];
  const trimmed = sentences.map(s => s.trim()).filter(Boolean);
  if (trimmed.length <= n) return trimmed;
  const totalChars = trimmed.reduce((sum, s) => sum + s.length, 0);
  const targetSize = totalChars / n;
  const chunks = [];
  let buf = '';
  for (const s of trimmed) {
    if (buf && (buf.length + s.length) > targetSize && chunks.length < n - 1) {
      chunks.push(buf.trim());
      buf = s;
    } else {
      buf = buf ? `${buf} ${s}` : s;
    }
  }
  if (buf) chunks.push(buf.trim());
  return chunks;
}

const labelFromChunk = (chunk) => {
  const words = chunk.split(/\s+/);
  const head = words.slice(0, 6).join(' ');
  return words.length > 6 ? `${head}…` : head;
};

function AssetSequenceNode({ id }) {
  const { openFilePicker: assetOpenFilePicker } = useContext(CanvasCtx);
  const { onAssetSequencePublish, edges, nodeOutputs } = useContext(CanvasCtx);
  const [assets, setAssets] = useState([newAsset(1), newAsset(2)]);
  // When a script-emitting node is wired into the left input, slice the
  // script into N chunks and seed slot labels from those chunks. URL/type/
  // styling per slot are preserved across re-chunks. Default 5 — covers
  // the typical 60s POV reel cadence.
  const [chunkCount, setChunkCount] = useState(5);

  // Find an upstream script source via the script-in handle.
  const inboundEdge = edges?.find(e => e.target === id && e.targetHandle === 'script-in');
  const upstreamScript = inboundEdge ? (nodeOutputs?.[inboundEdge.source]?.script || '') : '';
  const isScriptPaced = Boolean(upstreamScript);

  // Re-chunk + relabel whenever the upstream script content or chunk count
  // changes. We only TOUCH labels — URLs, types, text, styling stay put.
  // If the user adds extra slots beyond N via "+ Add asset", those are
  // left alone (no auto-deletion). If N grows, we append fresh slots.
  //
  // Lint note: this is the legitimate "synchronize state from external
  // context-shaped data" pattern. The upstream script lives in CanvasCtx,
  // not in props or local state, so deriving in render isn't an option
  // without restructuring the asset model.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (!upstreamScript) return;
    const chunks = chunkScriptForLabels(upstreamScript, chunkCount);
    setAssets(prev => {
      const next = prev.slice();
      let changed = false;
      chunks.forEach((chunk, i) => {
        const label = labelFromChunk(chunk);
        // Also populate `text` with the full chunk so text-type slots render
        // the chunk content directly into Cartesian's contentText pipeline.
        // This is the unlock that lets a text-mode slot represent a script
        // beat as on-screen overlay text without manual copy-paste.
        if (next[i]) {
          if (next[i].label !== label || next[i].text !== chunk) {
            next[i] = { ...next[i], label, text: chunk };
            changed = true;
          }
        } else {
          next[i] = { ...newAsset(i + 1), label, text: chunk };
          changed = true;
        }
      });
      return changed ? next : prev;  // bail when idempotent — avoids a redundant publish
    });
  }, [upstreamScript, chunkCount]);

  // Auto-publish to nodeOutputs on every change. Downstream Cartesian Composer
  // reads this and exposes asset labels in each zone's "Source" dropdown.
  useEffect(() => {
    onAssetSequencePublish?.(id, { type: 'asset-sequence', assets });
  }, [id, assets, onAssetSequencePublish]);

  const updateAsset = (idx, patch) => {
    setAssets(prev => prev.map((a, i) => i === idx ? { ...a, ...patch } : a));
  };
  const addAsset = () => setAssets(prev => [...prev, newAsset(prev.length + 1)]);
  const removeAsset = (idx) => setAssets(prev => prev.filter((_, i) => i !== idx));

  // Fire-and-forget probe: when a URL field blurs (or type changes against
  // an already-set URL), look up the asset's pixel dimensions so downstream
  // Cartesian zones can lock-aspect drag against it. Stale probes are no-ops
  // because we re-resolve the asset by id before patching.
  const probeAsset = (idx) => {
    const a = assets[idx];
    if (!a) return;
    probeMediaDimensions(a.url, a.type).then((dim) => {
      if (!dim) return;
      setAssets(prev => prev.map(x => x.id === a.id
        ? { ...x, width: dim.width, height: dim.height }
        : x));
    });
  };

  const dotColor = assets.some(a => a.url || a.text) ? '#14b8a6' : '#555';

  return (
    <div className="cv-node cv-asset-sequence nowheel" style={{ '--status-color': dotColor, '--node-accent': '#14b8a6' }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="script-in" />

      <div className="cv-asset-sequence-header">
        <div className="cv-asset-sequence-dot" />
        <span className="cv-asset-sequence-title">Asset Sequence</span>
        <span className="cv-asset-sequence-badge">{assets.length} item{assets.length === 1 ? '' : 's'}</span>
      </div>

      {isScriptPaced && (
        <div className="cv-asset-sequence-script-bar">
          <span className="cv-asset-sequence-script-tag">📝 script-paced</span>
          <label className="cv-asset-sequence-chunk-input">
            chunks
            <input
              type="number"
              min={1}
              max={20}
              value={chunkCount}
              onChange={(e) => { e.stopPropagation(); setChunkCount(Math.max(1, Math.min(20, +e.target.value || 1))); }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag"
            />
          </label>
        </div>
      )}

      <div className="cv-asset-sequence-list">
        {assets.map((asset, idx) => (
          <div key={asset.id} className="cv-asset-sequence-item">
            <div className="cv-asset-sequence-row">
              <input
                type="text"
                className="cv-asset-sequence-input cv-asset-sequence-input-label nodrag"
                value={asset.label}
                onChange={(e) => { e.stopPropagation(); updateAsset(idx, { label: e.target.value }); }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                placeholder={`Asset ${idx + 1}`}
              />
              <select
                className="cv-asset-sequence-input cv-asset-sequence-input-type nodrag"
                value={asset.type}
                onChange={(e) => {
                  e.stopPropagation();
                  updateAsset(idx, { type: e.target.value, width: 0, height: 0 });
                  // Re-probe with the new type — image probe and video probe
                  // use different APIs and may yield different results for
                  // the same URL (or one might fail where the other works).
                  setTimeout(() => probeAsset(idx), 0);
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {ASSET_SEQUENCE_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              <button
                className="cv-asset-sequence-remove"
                onClick={(e) => { e.stopPropagation(); removeAsset(idx); }}
                title="Remove asset"
              >×</button>
            </div>

            {(asset.type === 'image' || asset.type === 'video' || asset.type === 'hyperframes') && (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="text"
                  className="cv-asset-sequence-input cv-asset-sequence-input-url nodrag"
                  placeholder={
                    asset.type === 'image' ? 'image URL or absolute path (kie.ai URL, E:\\... , /renders/...)' :
                    asset.type === 'video' ? 'video URL or absolute path (E:\\... , /renders/...)' :
                    'hyperframes mp4 URL or absolute path'
                  }
                  value={asset.url}
                  onChange={(e) => {
                    e.stopPropagation();
                    // Clear stale dimensions while typing — they're about to be
                    // wrong. The probe runs on blur to avoid hammering on every
                    // keystroke during paste/edit.
                    updateAsset(idx, { url: e.target.value, width: 0, height: 0 });
                  }}
                  onBlur={(e) => { e.stopPropagation(); probeAsset(idx); }}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button
                  className="nodrag"
                  onClick={(e) => {
                    e.stopPropagation();
                    const exts = asset.type === 'image' ? ['png','jpg','jpeg','webp','gif','svg','avif']
                              : asset.type === 'video' ? ['mp4','mov','webm','mkv','m4v']
                              : ['mp4','mov','webm']; // hyperframes mp4
                    assetOpenFilePicker({
                      key: `asset-seq-${asset.type}`,
                      label: `a ${asset.type === 'hyperframes' ? 'hyperframes video' : asset.type}`,
                      startDir: '.',
                      exts,
                    }, (p) => { updateAsset(idx, { url: p, width: 0, height: 0 }); setTimeout(() => probeAsset(idx), 0); });
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="Browse"
                  style={{ padding: '4px 7px', fontSize: 12, background: 'var(--bg-card, #1a1a24)', border: '1px solid var(--border, #2a2a35)', borderRadius: 3, cursor: 'pointer' }}
                >📁</button>
              </div>
            )}

            {asset.type === 'text' && (
              <>
                <input
                  type="text"
                  className="cv-asset-sequence-input cv-asset-sequence-input-text nodrag"
                  placeholder="text content"
                  value={asset.text}
                  onChange={(e) => { e.stopPropagation(); updateAsset(idx, { text: e.target.value }); }}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                />
                <div className="cv-asset-sequence-style-row">
                  <label>color<input type="text" className="nodrag" value={asset.color}
                    onChange={(e) => { e.stopPropagation(); updateAsset(idx, { color: e.target.value }); }}
                    onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} /></label>
                  <label>bg<input type="text" className="nodrag" value={asset.bg}
                    onChange={(e) => { e.stopPropagation(); updateAsset(idx, { bg: e.target.value }); }}
                    onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} /></label>
                  <label>size<input type="number" className="nodrag" value={asset.fontSize} min={8} max={200}
                    onChange={(e) => { e.stopPropagation(); updateAsset(idx, { fontSize: +e.target.value }); }}
                    onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} /></label>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <button
        className="cv-asset-sequence-add"
        onClick={(e) => { e.stopPropagation(); addAsset(); }}
      >+ Add asset</button>

      <Handle type="source" position={Position.Right} id="sequence-out" />
    </div>
  );
}

/* ===== MOTION BAKE NODE — script → per-beat motion graphics → asset-sequence pool ===== */
//
// Bridges Niche Script Gen → Cartesian Composer. Two-phase by design:
//   1. "Plan beats" calls /api/motion-bake/plan — Claude reads the script,
//      picks 3-7 high-impact moments, picks a template + fills its fields
//      per beat. Result lands in node state for review.
//   2. "Bake all beats" calls /api/motion-bake/render — sequentially renders
//      each beat through the Hyperframes CLI, returns asset-sequence shape.
//
// Output: `{ type: 'asset-sequence', assets: [...] }` — drop-in compatible
// with Cartesian's content-pool handle (same shape Asset Sequence emits).

const MOTION_BAKE_TEMPLATE_LABELS = {
  'terminal':     'Terminal Block',
  'lower-third':  'Lower Third',
  'callout':      'Callout Card',
  'code-reveal':  'Code Reveal',
  'stat-slam':    'Stat Slam',
};

function MotionBakeNode({ id }) {
  const { edges, nodeOutputs, onMotionBakePlan, onMotionBakeRender, onAssetSequencePublish } = useContext(CanvasCtx);
  const [accentColor, setAccentColor] = useState('#C9A227');
  const [scriptOverride, setScriptOverride] = useState('');

  // Resolve upstream script — wired edge wins over local textarea fallback.
  // Accepts the same shapes other downstream nodes use (script / prompt /
  // caption / hook fields on the source node's output).
  let upstreamScript = '';
  for (const edge of (edges || []).filter(e => e.target === id)) {
    const src = nodeOutputs?.[edge.source];
    if (!src) continue;
    upstreamScript = src.script || src.prompt || src.caption || src.hook || '';
    if (upstreamScript) break;
  }
  const script = (upstreamScript || scriptOverride).trim();

  const result = nodeOutputs?.[id] || {};
  const planStatus = result.planStatus || 'idle';
  const bakeStatus = result.bakeStatus || 'idle';
  const beats = Array.isArray(result.beats) ? result.beats : [];
  const assets = Array.isArray(result.assets) ? result.assets : [];
  const error = result.error || '';

  // Auto-publish assets to nodeOutputs in the asset-sequence shape so the
  // wired Cartesian Composer downstream sees them in its content-pool the
  // same way it sees a manual Asset Sequence node's output. Only runs when
  // a bake completes — until then nothing flows downstream.
  useEffect(() => {
    if (assets.length === 0) return;
    const usable = assets.filter(a => a.url);
    if (usable.length === 0) return;
    onAssetSequencePublish?.(id, { type: 'asset-sequence', assets: usable });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, assets.length]);

  const canPlan = !!script && planStatus !== 'planning';
  const canBake = beats.length > 0 && bakeStatus !== 'baking';

  const dotColor = bakeStatus === 'baking' || planStatus === 'planning' ? '#e85d75'
    : assets.length > 0 && assets.every(a => a.url) ? '#00FFFF'
    : beats.length > 0 ? '#7ed957'
    : canPlan ? '#7ed957'
    : '#555';

  return (
    <div className="cv-node cv-motion-bake nowheel" style={{ '--status-color': dotColor, '--node-accent': '#7ed957' }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="script-in" />

      <div className="cv-motion-bake-header">
        <div className="cv-motion-bake-dot" />
        <span className="cv-motion-bake-title">Motion Bake</span>
        <span className="cv-motion-bake-badge">
          {beats.length > 0 ? `${beats.length} beat${beats.length === 1 ? '' : 's'}` : 'script → motion'}
        </span>
      </div>

      <div className="cv-motion-bake-baseinfo">
        <span className={`cv-motion-bake-input-dot ${script ? 'active' : ''}`} />
        <span>
          {script
            ? `script wired (${script.split(/\s+/).length} words)`
            : 'wire a script (or paste below)'}
        </span>
      </div>

      {!upstreamScript && (
        <textarea
          className="cv-motion-bake-script nodrag"
          placeholder="Paste script here (or wire a Niche Script Gen / Generator output)"
          value={scriptOverride}
          onChange={(e) => { e.stopPropagation(); setScriptOverride(e.target.value); }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          rows={3}
        />
      )}

      <label
        className="cv-motion-bake-accent nodrag"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        title="Brand accent color baked into every template (terminal prompt symbol, lower-third bar, callout border, stat number color)."
      >
        <span>accent</span>
        <input
          type="color"
          className="nodrag"
          value={accentColor}
          onChange={(e) => { e.stopPropagation(); setAccentColor(e.target.value); }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
        <span className="cv-motion-bake-accent-hex">{accentColor}</span>
      </label>

      <button
        className="cv-btn cv-btn-motion-bake-plan"
        disabled={!canPlan}
        onClick={(e) => {
          e.stopPropagation();
          onMotionBakePlan(id, { script, accentColor });
        }}
      >
        {planStatus === 'planning' ? 'Planning beats…'
          : beats.length > 0 ? 'Re-plan beats'
          : 'Plan beats'}
      </button>

      {beats.length > 0 && (
        <div className="cv-motion-bake-beats">
          {beats.map((beat, i) => {
            const asset = assets[i];
            const status = asset?.error ? 'error'
              : asset?.url ? 'done'
              : bakeStatus === 'baking' ? 'pending'
              : 'planned';
            return (
              <div key={i} className={`cv-motion-bake-beat cv-motion-bake-beat-${status}`}>
                <div className="cv-motion-bake-beat-row">
                  <span className="cv-motion-bake-beat-num">#{i + 1}</span>
                  <span className="cv-motion-bake-beat-label">{beat.label || `Beat ${i + 1}`}</span>
                  <span className="cv-motion-bake-beat-tpl">{MOTION_BAKE_TEMPLATE_LABELS[beat.templateId] || beat.templateId}</span>
                  <span className="cv-motion-bake-beat-dur">{(beat.durationSec || 0).toFixed(1)}s</span>
                </div>
                {beat.scriptText && (
                  <div className="cv-motion-bake-beat-script">"{beat.scriptText}"</div>
                )}
                {asset?.error && (
                  <div className="cv-motion-bake-beat-error">{asset.error}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {beats.length > 0 && (
        <button
          className="cv-btn cv-btn-motion-bake-render"
          disabled={!canBake}
          onClick={(e) => {
            e.stopPropagation();
            onMotionBakeRender(id, { beats, accentColor });
          }}
        >
          {bakeStatus === 'baking' ? 'Baking… (this takes a minute)'
            : assets.length > 0 ? 'Re-bake all beats'
            : 'Bake all beats'}
        </button>
      )}

      {assets.length > 0 && (
        <div className="cv-motion-bake-result">
          {assets.filter(a => a.url).length} of {assets.length} baked → published to asset pool
        </div>
      )}

      {error && <div className="cv-motion-bake-error">{error}</div>}

      <Handle type="source" position={Position.Right} id="sequence-out" />
    </div>
  );
}

/* ===== SKYFRAME PICKER NODE — operator-controlled placement of taste-baked Skyframe effects ===== */
//
// Per-slot picker for the 6 Skyframe components. Each slot renders ONE
// effect at full-frame transparent .webm via /api/remotion/skyframe-effect,
// caches by sha1(component + props + durationSec). Output is asset-sequence
// shape — Cartesian.content-pool sees the slots as 'hyperframes' assets
// with no Cartesian changes needed.
//
// v1 limit: every effect renders 1080x1920 transparent. Cartesian zone gives
// free TIMING + ORDER, but POSITION is baked into each effect's own props
// (KaraokeCard.position, etc). Drag-around positioning = v2.

const SKYFRAME_EFFECTS = [
  { id: 'RayBanIntro',   label: 'Ray-Ban Intro' },
  { id: 'KaraokeCard',   label: 'Karaoke Card' },
  { id: 'CompactCard',   label: 'Compact Card' },
  { id: 'Win95Terminal', label: 'Win95 Terminal' },
  { id: 'OpusGlisten',   label: 'Opus Glisten' },
  { id: 'AsciiPlanet',   label: 'ASCII Planet' },
];

const SKYFRAME_DEFAULT_PROPS = {
  RayBanIntro:   { topWord: "You're", heroPhrase: 'BURNING THROUGH', midWord: 'your', pixelPhrase: 'CLOUD CODE', subtitle: 'context is bloated.' },
  KaraokeCard:   { position: 'bottom-left', eyebrow: 'Tip 1', words: ['Keep','CLAUDE.md','under','40K','characters'], heroWord: 'CLAUDE.md' },
  CompactCard:   { command: '/compact', subtitle: 'without breaking content', sideArt: 'trashCompactor', sideArtInputLabel: '245K', sideArtResultLabel: '40K' },
  Win95Terminal: { command: '/clear', payoff: 'Fresh context. No drift.' },
  OpusGlisten:   { word: 'Opus' },
  AsciiPlanet:   {},
};

const SKYFRAME_DEFAULT_DURATION = {
  RayBanIntro: 3.0,
  KaraokeCard: 5.0,
  CompactCard: 5.0,
  Win95Terminal: 6.0,
  OpusGlisten: 3.5,
  AsciiPlanet: 5.0,
};

const KARAOKE_POSITIONS = ['bottom-left', 'bottom-right', 'top-left', 'top-right'];
const COMPACT_SIDE_ART = [
  { id: 'trashCompactor', label: 'trash compactor' },
  { id: 'none',           label: 'none' },
];

const newSkyframeSlot = (effectType, n) => ({
  id: `sf${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
  label: `${effectType} ${n}`,
  effectType,
  durationSec: SKYFRAME_DEFAULT_DURATION[effectType] || 5,
  props: { ...SKYFRAME_DEFAULT_PROPS[effectType] },
  renderStatus: 'idle',
  url: '',
  error: '',
});

// CompactCard: server-side component reads sideArtProps.{inputLabel,resultLabel}
// nested. KaraokeCard: words must be an array on the wire. Flatten/normalize
// here so the editor stays simple but the API gets the canonical shape.
function buildSkyframePropsForRender(effectType, props) {
  if (effectType === 'CompactCard') {
    const { sideArt, sideArtInputLabel, sideArtResultLabel, ...rest } = props || {};
    return {
      ...rest,
      sideArt: sideArt === 'none' ? null : sideArt,
      sideArtProps: (sideArtInputLabel || sideArtResultLabel)
        ? { inputLabel: sideArtInputLabel || '', resultLabel: sideArtResultLabel || '' }
        : undefined,
    };
  }
  if (effectType === 'KaraokeCard') {
    const { words, ...rest } = props || {};
    return {
      ...rest,
      words: Array.isArray(words) ? words : String(words || '').split(/\s+/).filter(Boolean),
    };
  }
  return { ...(props || {}) };
}

// HandleWithTip — wraps a React Flow Handle with an on-hover floating
// tooltip showing one line of wiring info. Reusable across all nodes; this
// is the first use site, others will follow as the cohesive aesthetic
// rolls out. Tooltip floats outside the node border (12-14px gap) on the
// opposite side of where the handle sits, with a slight box-shadow for
// depth. Font matches the node's mono interior.
function HandleWithTip({ tip, position, ...handleProps }) {
  const [show, setShow] = useState(false);
  const sideStyle = (() => {
    if (position === Position.Left)   return { right: 'calc(100% + 14px)', top: handleProps.style?.top || '50%', transform: 'translateY(-50%)' };
    if (position === Position.Right)  return { left:  'calc(100% + 14px)', top: handleProps.style?.top || '50%', transform: 'translateY(-50%)' };
    if (position === Position.Top)    return { bottom: 'calc(100% + 14px)', left: '50%', transform: 'translateX(-50%)' };
    if (position === Position.Bottom) return { top:    'calc(100% + 14px)', left: '50%', transform: 'translateX(-50%)' };
    return {};
  })();
  return (
    <>
      <Handle
        position={position}
        {...handleProps}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      />
      {show && tip && (
        <div className="cv-handle-tip" style={{ position: 'absolute', ...sideStyle }}>
          {tip}
        </div>
      )}
    </>
  );
}

function SkyframePickerNode({ id }) {
  const { onSkyframeRender, onAssetSequencePublish } = useContext(CanvasCtx);
  const [slots, setSlots] = useState(() => [newSkyframeSlot('RayBanIntro', 1)]);

  // Auto-publish only the rendered slots. Unrendered slots are config-only;
  // they shouldn't surface in Cartesian's Source dropdown until they have a
  // URL. Same shape Asset Sequence emits, so Cartesian's content-pool
  // handler treats them identically.
  useEffect(() => {
    const usable = slots.filter(s => s.url).map(s => ({
      id: s.id,
      label: s.label || s.effectType,
      type: 'hyperframes',
      url: s.url,
      width: 1080,
      height: 1920,
    }));
    onAssetSequencePublish?.(id, { type: 'asset-sequence', assets: usable });
  }, [id, slots, onAssetSequencePublish]);

  const updateSlot = (idx, patch) =>
    setSlots(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));

  // Any prop edit invalidates the existing render — the cache key would
  // change anyway, so clear the URL/status so the operator sees they need
  // to re-render before the asset is fresh.
  const updateSlotProps = (idx, propPatch) =>
    setSlots(prev => prev.map((s, i) => i === idx
      ? { ...s, props: { ...s.props, ...propPatch }, url: '', renderStatus: 'idle', error: '' }
      : s));

  const changeEffectType = (idx, newType) =>
    setSlots(prev => prev.map((s, i) => i === idx ? {
      ...s,
      effectType: newType,
      props: { ...SKYFRAME_DEFAULT_PROPS[newType] },
      durationSec: SKYFRAME_DEFAULT_DURATION[newType] || 5,
      label: `${newType} ${idx + 1}`,
      url: '', renderStatus: 'idle', error: '',
    } : s));

  const addSlot = () => setSlots(prev => [...prev, newSkyframeSlot('KaraokeCard', prev.length + 1)]);
  const removeSlot = (idx) => setSlots(prev => prev.filter((_, i) => i !== idx));

  const renderSlot = async (idx) => {
    const s = slots[idx];
    if (!s) return;
    setSlots(prev => prev.map((x, i) => i === idx ? { ...x, renderStatus: 'rendering', error: '' } : x));
    try {
      const data = await onSkyframeRender({
        component: s.effectType,
        props: buildSkyframePropsForRender(s.effectType, s.props),
        durationSec: s.durationSec,
      });
      setSlots(prev => prev.map((x, i) => i === idx
        ? { ...x, renderStatus: 'done', url: data.url, error: '' }
        : x));
    } catch (err) {
      setSlots(prev => prev.map((x, i) => i === idx
        ? { ...x, renderStatus: 'error', error: err.message || String(err) }
        : x));
    }
  };

  const renderAll = async () => {
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].renderStatus === 'done' && slots[i].url) continue;
      await renderSlot(i);
    }
  };

  const anyRendering = slots.some(s => s.renderStatus === 'rendering');
  const doneCount = slots.filter(s => s.renderStatus === 'done').length;

  const dotColor = anyRendering ? '#e85d75'
    : doneCount === slots.length && doneCount > 0 ? '#00FFFF'
    : doneCount > 0 ? '#FFD24A'
    : '#555';

  // Stop-propagation helpers for nested form controls (avoids React Flow
  // hijacking clicks/drags on text inputs inside the node).
  const stop = (e) => { e.stopPropagation(); };

  return (
    <div className="cv-node cv-skyframe-picker nowheel" style={{ '--status-color': dotColor }}>
      <NodeDeleteBtn nodeId={id} />

      <div className="cv-skyframe-header">
        <div className="cv-skyframe-dot" />
        <span>SKYFRAME PICKER</span>
        <span className="cv-skyframe-counter">{doneCount}/{slots.length}</span>
      </div>

      <div className="cv-skyframe-slots">
        {slots.map((s, idx) => (
          <div key={s.id} className="cv-skyframe-slot">
            <div className="cv-skyframe-slot-row">
              <input
                type="text"
                className="cv-skyframe-input cv-skyframe-input-label nodrag"
                value={s.label}
                onChange={(e) => { stop(e); updateSlot(idx, { label: e.target.value }); }}
                onClick={stop} onMouseDown={stop}
                placeholder={`${s.effectType} ${idx + 1}`}
              />
              <select
                className="cv-skyframe-select nodrag"
                value={s.effectType}
                onChange={(e) => { stop(e); changeEffectType(idx, e.target.value); }}
                onClick={stop} onMouseDown={stop}
              >
                {SKYFRAME_EFFECTS.map(eff => <option key={eff.id} value={eff.id}>{eff.label}</option>)}
              </select>
              <button
                className="cv-skyframe-x"
                onClick={(e) => { stop(e); removeSlot(idx); }}
                title="Remove slot"
              >×</button>
            </div>

            <div className="cv-skyframe-meta">
              <label className="cv-skyframe-meta-field nodrag" onClick={stop} onMouseDown={stop}>
                <span>dur</span>
                <input
                  type="number" min={0.5} max={30} step={0.5}
                  value={s.durationSec}
                  onChange={(e) => { stop(e); updateSlot(idx, { durationSec: Math.max(0.5, Math.min(30, +e.target.value || 1)), url: '', renderStatus: 'idle', error: '' }); }}
                  onClick={stop} onMouseDown={stop}
                  className="nodrag"
                />
                <span>s</span>
              </label>
              <span className={`cv-skyframe-stat cv-skyframe-stat-${s.renderStatus}`}>
                {s.renderStatus === 'rendering' ? 'rendering…'
                  : s.renderStatus === 'done' ? '✓ done'
                  : s.renderStatus === 'error' ? '⚠ error'
                  : 'idle'}
              </span>
            </div>

            {s.effectType === 'RayBanIntro' && (
              <div className="cv-skyframe-fields">
                {['topWord','heroPhrase','midWord','pixelPhrase','subtitle'].map(k => (
                  <label key={k} className="cv-skyframe-field nodrag" onClick={stop} onMouseDown={stop}>
                    <span>{k}</span>
                    <input type="text" className="nodrag" value={s.props[k] || ''}
                      onChange={(e) => { stop(e); updateSlotProps(idx, { [k]: e.target.value }); }}
                      onClick={stop} onMouseDown={stop} />
                  </label>
                ))}
              </div>
            )}

            {s.effectType === 'KaraokeCard' && (
              <div className="cv-skyframe-fields">
                <label className="cv-skyframe-field nodrag" onClick={stop} onMouseDown={stop}>
                  <span>position</span>
                  <select className="nodrag" value={s.props.position || 'bottom-left'}
                    onChange={(e) => { stop(e); updateSlotProps(idx, { position: e.target.value }); }}
                    onClick={stop} onMouseDown={stop}>
                    {KARAOKE_POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
                <label className="cv-skyframe-field nodrag" onClick={stop} onMouseDown={stop}>
                  <span>eyebrow</span>
                  <input type="text" className="nodrag" value={s.props.eyebrow || ''}
                    onChange={(e) => { stop(e); updateSlotProps(idx, { eyebrow: e.target.value }); }}
                    onClick={stop} onMouseDown={stop} />
                </label>
                <label className="cv-skyframe-field nodrag" onClick={stop} onMouseDown={stop}>
                  <span>words</span>
                  <input type="text" className="nodrag"
                    value={Array.isArray(s.props.words) ? s.props.words.join(' ') : (s.props.words || '')}
                    onChange={(e) => { stop(e); updateSlotProps(idx, { words: e.target.value.split(/\s+/).filter(Boolean) }); }}
                    onClick={stop} onMouseDown={stop} />
                </label>
                <label className="cv-skyframe-field nodrag" onClick={stop} onMouseDown={stop}>
                  <span>hero word</span>
                  <input type="text" className="nodrag" value={s.props.heroWord || ''}
                    onChange={(e) => { stop(e); updateSlotProps(idx, { heroWord: e.target.value }); }}
                    onClick={stop} onMouseDown={stop} />
                </label>
              </div>
            )}

            {s.effectType === 'CompactCard' && (
              <div className="cv-skyframe-fields">
                <label className="cv-skyframe-field nodrag" onClick={stop} onMouseDown={stop}>
                  <span>command</span>
                  <input type="text" className="nodrag" value={s.props.command || ''}
                    onChange={(e) => { stop(e); updateSlotProps(idx, { command: e.target.value }); }}
                    onClick={stop} onMouseDown={stop} />
                </label>
                <label className="cv-skyframe-field nodrag" onClick={stop} onMouseDown={stop}>
                  <span>subtitle</span>
                  <input type="text" className="nodrag" value={s.props.subtitle || ''}
                    onChange={(e) => { stop(e); updateSlotProps(idx, { subtitle: e.target.value }); }}
                    onClick={stop} onMouseDown={stop} />
                </label>
                <label className="cv-skyframe-field nodrag" onClick={stop} onMouseDown={stop}>
                  <span>side art</span>
                  <select className="nodrag" value={s.props.sideArt || 'trashCompactor'}
                    onChange={(e) => { stop(e); updateSlotProps(idx, { sideArt: e.target.value }); }}
                    onClick={stop} onMouseDown={stop}>
                    {COMPACT_SIDE_ART.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                </label>
                {s.props.sideArt === 'trashCompactor' && (
                  <>
                    <label className="cv-skyframe-field nodrag" onClick={stop} onMouseDown={stop}>
                      <span>input</span>
                      <input type="text" className="nodrag" value={s.props.sideArtInputLabel || ''}
                        onChange={(e) => { stop(e); updateSlotProps(idx, { sideArtInputLabel: e.target.value }); }}
                        onClick={stop} onMouseDown={stop} />
                    </label>
                    <label className="cv-skyframe-field nodrag" onClick={stop} onMouseDown={stop}>
                      <span>result</span>
                      <input type="text" className="nodrag" value={s.props.sideArtResultLabel || ''}
                        onChange={(e) => { stop(e); updateSlotProps(idx, { sideArtResultLabel: e.target.value }); }}
                        onClick={stop} onMouseDown={stop} />
                    </label>
                  </>
                )}
              </div>
            )}

            {s.effectType === 'Win95Terminal' && (
              <div className="cv-skyframe-fields">
                <label className="cv-skyframe-field nodrag" onClick={stop} onMouseDown={stop}>
                  <span>command</span>
                  <input type="text" className="nodrag" value={s.props.command || ''}
                    onChange={(e) => { stop(e); updateSlotProps(idx, { command: e.target.value }); }}
                    onClick={stop} onMouseDown={stop} />
                </label>
                <label className="cv-skyframe-field nodrag" onClick={stop} onMouseDown={stop}>
                  <span>payoff</span>
                  <input type="text" className="nodrag" value={s.props.payoff || ''}
                    onChange={(e) => { stop(e); updateSlotProps(idx, { payoff: e.target.value }); }}
                    onClick={stop} onMouseDown={stop} />
                </label>
              </div>
            )}

            {s.effectType === 'OpusGlisten' && (
              <div className="cv-skyframe-fields">
                <label className="cv-skyframe-field nodrag" onClick={stop} onMouseDown={stop}>
                  <span>word</span>
                  <input type="text" className="nodrag" value={s.props.word || ''}
                    onChange={(e) => { stop(e); updateSlotProps(idx, { word: e.target.value }); }}
                    onClick={stop} onMouseDown={stop} />
                </label>
                <div className="cv-skyframe-hint">one opus per video — don't dilute the signature</div>
              </div>
            )}

            {s.effectType === 'AsciiPlanet' && (
              <div className="cv-skyframe-hint">
                decorative spinning disc — no props, use sparingly
              </div>
            )}

            {s.error && <div className="cv-skyframe-err">{s.error}</div>}

            <button
              className="cv-skyframe-btn-slot nodrag"
              onClick={(e) => { stop(e); renderSlot(idx); }}
              onMouseDown={stop}
              disabled={s.renderStatus === 'rendering'}
            >
              {s.renderStatus === 'rendering' ? 'rendering…'
                : s.renderStatus === 'done' ? 're-render'
                : 'render slot'}
            </button>
          </div>
        ))}
      </div>

      <button
        className="cv-skyframe-add"
        onClick={(e) => { stop(e); addSlot(); }}
      >+ add slot</button>

      <button
        className="cv-skyframe-btn-all nodrag"
        onClick={(e) => { stop(e); renderAll(); }}
        onMouseDown={stop}
        disabled={anyRendering || slots.length === 0}
      >
        {anyRendering ? 'rendering…' : 'render all'}
      </button>

      <HandleWithTip
        type="source"
        position={Position.Right}
        id="sequence-out"
        tip="output → asset-sequence · drop into Cartesian Composer (content-pool)"
      />
    </div>
  );
}

/* ===== COMMAND RUNNER NODE — Block 2 of the endgame build plan ============= */
//
// Tier-1 shell command runner: spawns one-shot commands (ffmpeg, npm,
// pipeline-cli, git) and streams stdout/stderr/exit live via SSE from
// /api/exec. No PTY, no interactive prompts — that's Block 3's escalation
// path if v1 turns out insufficient.
//
// No wire I/O in v1 — operator types commands directly. Block 4 will add
// a `context-in` left handle so upstream wires can inject commands.
//
// SSE parsing: EventSource doesn't support POST, so we use fetch +
// ReadableStream + manual SSE frame parser. Each event is "event: X\ndata: Y\n\n".

const MAX_OUTPUT_LINES = 5000;     // cap to keep React happy when commands spew MB

function CommandRunnerNode({ id }) {
  // Block 4: read upstream wire content. CommandRunnerNode is the substrate
  // for the agent-orchestration pattern after the Codex shelving — a script
  // gen / PRD chat / transcript node wires into context-in, the operator
  // picks an inject mode, and the wire flows into the spawned process.
  const { edges, nodeOutputs } = useContext(CanvasCtx);

  const [command, setCommand] = useState('');
  const [cwd, setCwd] = useState('');                    // empty = server default (breadstick repo)
  const [output, setOutput] = useState([]);              // [{ stream: 'stdout'|'stderr', text }]
  const [status, setStatus] = useState('idle');          // 'idle' | 'running' | 'done' | 'error' | 'killed'
  const [exitCode, setExitCode] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [injectMode, setInjectMode] = useState('none');  // 'none' | 'stdin' | 'preamble' | 'wire-file'
  const abortRef = useRef(null);
  const outputRef = useRef(null);

  // Resolve upstream content from any node wired into the context-in handle.
  // Common text-emitting field priority: script (most ARES/Niche outputs)
  // → prd (PRD Chat) → prompt (Pixel Forge, Image-2) → text/caption/hook
  // (fallbacks). First non-empty wins.
  let upstreamContent = '';
  for (const edge of (edges || []).filter(e => e.target === id && e.targetHandle === 'context-in')) {
    const src = nodeOutputs?.[edge.source];
    if (!src) continue;
    upstreamContent = src.script || src.prd || src.prompt || src.text || src.caption || src.hook || '';
    if (upstreamContent) break;
  }
  const wireBytes = upstreamContent ? new Blob([upstreamContent]).size : 0;
  const hasWire = wireBytes > 0;

  // Auto-scroll to bottom on new output. scrollIntoView would be jankier
  // (animates the whole node); direct scrollTop set is instant + smooth.
  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output, status]);

  // Append a chunk to output. Splits on newlines and treats trailing
  // partial line as continuation of the previous line (concatenated, not a
  // new entry) so progress bars / carriage-return updates don't explode the
  // line count. Caps at MAX_OUTPUT_LINES — drops oldest lines past the cap.
  const appendChunk = (stream, text) => {
    setOutput(prev => {
      const next = prev.slice();
      // Append text to most recent same-stream line if it didn't end in \n;
      // otherwise start new lines for each \n-terminated chunk.
      const parts = text.split('\n');
      const last = next[next.length - 1];
      if (last && last.stream === stream && !last.endedWithNewline) {
        last.text += parts.shift();
        last.endedWithNewline = parts.length > 0 || text.endsWith('\n');
      }
      for (let i = 0; i < parts.length; i++) {
        const isLast = i === parts.length - 1;
        if (isLast && parts[i] === '') break;   // trailing empty after split('\n')
        next.push({
          stream,
          text: parts[i],
          endedWithNewline: !isLast || text.endsWith('\n'),
        });
      }
      // Cap output length — drop oldest lines, preserve scroll anchor.
      if (next.length > MAX_OUTPUT_LINES) {
        return next.slice(next.length - MAX_OUTPUT_LINES);
      }
      return next;
    });
  };

  const run = async () => {
    if (!command.trim() || status === 'running') return;
    setOutput([]);
    setStatus('running');
    setExitCode(null);
    setJobId(null);

    const ac = new AbortController();
    abortRef.current = ac;

    // Build inject payload from the wire if a mode is selected. The three
    // idioms map to PRD's spec: stdin (proc.stdin pipe), preamble (CLAUDE.md
    // pre-write before spawn), wire-file (stage to wire-buffer/<id>.txt).
    const body = { command, cwd: cwd || undefined };
    if (hasWire && injectMode !== 'none') {
      if (injectMode === 'stdin') {
        body.stdinPayload = upstreamContent;
      } else if (injectMode === 'preamble') {
        body.preamble = { content: upstreamContent };
      } else if (injectMode === 'wire-file') {
        body.stageWireBuffer = { nodeId: id, content: upstreamContent };
      }
    }

    try {
      const res = await fetch('http://localhost:3001/api/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        appendChunk('stderr', `[error] ${err.error || 'request failed'}\n`);
        setStatus('error');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      // Manual SSE parser — events are "event: X\ndata: Y\n\n"
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split('\n\n');
        buf = events.pop();   // last fragment may be incomplete
        for (const raw of events) {
          if (!raw.trim()) continue;
          let event = '', data = '';
          for (const line of raw.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (!event) continue;
          let parsed = {};
          try { parsed = JSON.parse(data); } catch { /* malformed SSE frame — skip */ }
          if (event === 'start') setJobId(parsed.jobId);
          else if (event === 'stdout') appendChunk('stdout', parsed.text || '');
          else if (event === 'stderr') appendChunk('stderr', parsed.text || '');
          else if (event === 'preamble') {
            appendChunk('stdout', `[wire → ${parsed.filename} preamble · ${parsed.bytes} bytes]\n`);
          } else if (event === 'wireBuffer') {
            appendChunk('stdout', `[wire → ${parsed.relPath} · ${parsed.bytes} bytes]\n`);
          } else if (event === 'stdin') {
            appendChunk('stdout', `[wire → stdin · ${parsed.bytes} bytes]\n`);
          } else if (event === 'exit') {
            setExitCode(parsed.code);
            setStatus(parsed.code === 0 ? 'done' : 'error');
          } else if (event === 'error') {
            appendChunk('stderr', `[error] ${parsed.message || 'unknown'}\n`);
            setStatus('error');
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setStatus('killed');
      } else {
        appendChunk('stderr', `[fetch error] ${err.message}\n`);
        setStatus('error');
      }
    } finally {
      abortRef.current = null;
    }
  };

  const stop = async () => {
    if (jobId) {
      // Hit the stop endpoint server-side first so taskkill kills the
      // process tree before we drop the SSE connection. If we just abort
      // the fetch, the server sees req.on('close') and tries to kill —
      // but on Windows the proc.kill() in that path is unreliable for
      // shell-spawned children. The explicit stop call uses taskkill /T.
      try {
        await fetch(`http://localhost:3001/api/exec/${jobId}/stop`, { method: 'POST' });
      } catch { /* server may already be torn down — abort below catches the rest */ }
    }
    if (abortRef.current) {
      abortRef.current.abort();
    }
    setStatus('killed');
  };

  const clear = () => {
    setOutput([]);
    setStatus('idle');
    setExitCode(null);
    setJobId(null);
  };

  // Cleanup on unmount — if the node is deleted mid-run, abort the fetch
  // and the server's req.on('close') handler will kill the process tree.
  // Also clean up any wire-buffer file staged by this node so we don't
  // accumulate stale buffers as nodes get added/removed across sessions.
  useEffect(() => () => {
    if (abortRef.current) abortRef.current.abort();
    fetch(`http://localhost:3001/api/wire-buffer/${id}`, { method: 'DELETE' })
      .catch(() => { /* server gone or buffer never existed — both fine */ });
  }, [id]);

  const stop_ = (e) => { e.stopPropagation(); };
  const dotColor = status === 'running' ? '#4ade80'
    : status === 'done' ? '#00FFFF'
    : status === 'error' ? '#e74c3c'
    : status === 'killed' ? '#FFD24A'
    : '#555';

  return (
    <div className="cv-node cv-cmd-runner nowheel" style={{ '--status-color': dotColor }}>
      <NodeDeleteBtn nodeId={id} />

      <HandleWithTip
        type="target"
        position={Position.Left}
        id="context-in"
        tip="context in ← wire any text-emitting node (script, prompt, transcript, prd)"
      />

      <div className="cv-cmd-header">
        <div className="cv-cmd-dot" />
        <span>COMMAND RUNNER</span>
        {exitCode !== null && (
          <span className={`cv-cmd-exit cv-cmd-exit-${exitCode === 0 ? 'ok' : 'err'}`}>
            exit {exitCode}
          </span>
        )}
        {status === 'running' && <span className="cv-cmd-exit cv-cmd-exit-running">running…</span>}
        {status === 'killed' && <span className="cv-cmd-exit cv-cmd-exit-killed">killed</span>}
      </div>

      {hasWire && (
        <div className="cv-cmd-wire">
          <span className="cv-cmd-wire-tag">📌 wire · {wireBytes.toLocaleString()} bytes</span>
          <select
            className="cv-cmd-wire-mode nodrag"
            value={injectMode}
            onChange={(e) => { stop_(e); setInjectMode(e.target.value); }}
            onClick={stop_} onMouseDown={stop_}
            disabled={status === 'running'}
          >
            <option value="none">no inject</option>
            <option value="stdin">via stdin</option>
            <option value="preamble">CLAUDE.md preamble</option>
            <option value="wire-file">stage to wire-buffer file</option>
          </select>
        </div>
      )}
      {hasWire && injectMode === 'wire-file' && (
        <div className="cv-cmd-wire-hint">→ wire-buffer/{id}.txt (relative to repo)</div>
      )}

      <div className="cv-cmd-field">
        <input
          type="text"
          className="cv-cmd-input nodrag"
          placeholder="ffmpeg -version"
          value={command}
          onChange={(e) => { stop_(e); setCommand(e.target.value); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && status !== 'running') { stop_(e); run(); } }}
          onClick={stop_} onMouseDown={stop_}
          disabled={status === 'running'}
        />
      </div>

      <div className="cv-cmd-field">
        <input
          type="text"
          className="cv-cmd-input cv-cmd-cwd nodrag"
          placeholder="cwd (default: breadstick repo)"
          value={cwd}
          onChange={(e) => { stop_(e); setCwd(e.target.value); }}
          onClick={stop_} onMouseDown={stop_}
          disabled={status === 'running'}
        />
      </div>

      <div className="cv-cmd-output nodrag" ref={outputRef} onMouseDown={stop_} onClick={stop_}>
        {output.length === 0 && status === 'idle' && (
          <div className="cv-cmd-empty">no output yet — type a command and hit run</div>
        )}
        {output.map((line, i) => (
          <div key={i} className={`cv-cmd-line cv-cmd-line-${line.stream}`}>
            {line.text || ' '}
          </div>
        ))}
        {status === 'running' && <div className="cv-cmd-cursor">▋</div>}
      </div>

      <div className="cv-cmd-buttons">
        {status === 'running' ? (
          <button className="cv-cmd-btn cv-cmd-btn-stop nodrag"
            onClick={(e) => { stop_(e); stop(); }} onMouseDown={stop_}>
            stop
          </button>
        ) : (
          <button className="cv-cmd-btn cv-cmd-btn-run nodrag"
            onClick={(e) => { stop_(e); run(); }} onMouseDown={stop_}
            disabled={!command.trim()}>
            run
          </button>
        )}
        <button className="cv-cmd-btn cv-cmd-btn-clear nodrag"
          onClick={(e) => { stop_(e); clear(); }} onMouseDown={stop_}
          disabled={output.length === 0 && status === 'idle'}>
          clear
        </button>
      </div>
    </div>
  );
}

/* ===== TERMINAL NODE — Block 3 of the endgame build plan ================= */
//
// Real PTY terminal embedded in a canvas node. Tier 2: full TUI support
// (Claude Code, Codex, htop, vim, anything interactive). Bidirectional
// WebSocket to /ws/terminal/<nodeId> on the Express server, which spawns
// a node-pty shell and pipes I/O.
//
// Token auth: fetch /api/terminal/token (localhost-only) at mount, append
// as ?token= query param. Server validates before completing the upgrade
// handshake. Both gates (localhost + token) are mandatory per PRD.

// Bounded plain-text tail for LivePreview log mode. 16KB ≈ ~250 lines of
// typical terminal output — enough to read recent context, small enough that
// downstream re-renders stay cheap.
const TERMINAL_STDOUT_TAIL_CAP = 16 * 1024;

function TerminalNode({ id }) {
  const { onAssetSequencePublish } = useContext(CanvasCtx);
  const [status, setStatus] = useState('idle');         // idle | connecting | connected | disconnected | error
  const [errorMsg, setErrorMsg] = useState('');
  const [restartCounter, setRestartCounter] = useState(0);  // bump to force a reconnect
  const containerRef = useRef(null);
  const terminalRef = useRef(null);
  const wsRef = useRef(null);
  // LivePreview tap buffers (Block 4.5 — wire-out from Terminal). Kept in
  // refs so the hot WS handler doesn't trigger re-renders per chunk; published
  // to nodeOutputs in coalesced flushes for downstream LivePreviewNode.
  const stdoutBufRef = useRef('');          // rolling plain-text tail (bounded)
  const urlsRef = useRef([]);               // detected URLs (deduped, most recent last)
  const latestFileRef = useRef(null);       // { relPath, kind, mtime }
  const publishTimerRef = useRef(null);
  const publishRef = useRef(onAssetSequencePublish);
  publishRef.current = onAssetSequencePublish;

  useEffect(() => {
    if (!containerRef.current) return undefined;
    let cancelled = false;
    let resizeObserver = null;

    (async () => {
      try {
        setStatus('connecting');
        setErrorMsg('');

        // SECURITY GATE 2 (token) — fetch fresh per mount. Token rotates
        // on server restart so a stale browser tab can't reconnect after
        // a server bounce.
        const tokenRes = await fetch('http://localhost:3001/api/terminal/token');
        if (!tokenRes.ok) throw new Error(`token fetch failed (HTTP ${tokenRes.status})`);
        const { token } = await tokenRes.json();
        if (cancelled) return;

        // xterm.js terminal — JetBrains Mono matches the rest of the
        // Blotato-aligned aesthetic. Theme uses the canvas palette so
        // colored CLI output (git log, npm warnings) stays on-brand.
        const terminal = new XTerminal({
          fontFamily: "JetBrains Mono, ui-monospace, Consolas, monospace",
          fontSize: 11,
          lineHeight: 1.25,
          cursorBlink: true,
          allowProposedApi: true,
          scrollback: 5000,
          theme: {
            background: '#0a0a0f',
            foreground: '#e8e8e8',
            cursor: '#10b981',
            cursorAccent: '#0a0a0f',
            selectionBackground: 'rgba(16, 185, 129, 0.3)',
            black:         '#1f2937',
            red:           '#ef4444',
            green:         '#4ade80',
            yellow:        '#FFD24A',
            blue:          '#3b82f6',
            magenta:       '#a855f7',
            cyan:          '#00ffff',
            white:         '#e8e8e8',
            brightBlack:   '#374151',
            brightRed:     '#f87171',
            brightGreen:   '#86efac',
            brightYellow:  '#fde047',
            brightBlue:    '#60a5fa',
            brightMagenta: '#c084fc',
            brightCyan:    '#22d3ee',
            brightWhite:   '#f3f4f6',
          },
        });
        const fit = new FitAddon();
        terminal.loadAddon(fit);
        terminal.loadAddon(new WebLinksAddon());
        terminal.open(containerRef.current);
        try { fit.fit(); } catch { /* container not yet sized */ }
        terminalRef.current = terminal;

        if (cancelled) {
          terminal.dispose();
          return;
        }

        // WS handshake — token in query param. The nodeId is part of the
        // path so the server's PTY tracker can key by it (one PTY per
        // canvas node, killed on node delete via WS close).
        const ws = new WebSocket(
          `ws://localhost:3001/ws/terminal/${id}?token=${encodeURIComponent(token)}`
        );
        wsRef.current = ws;

        ws.onopen = () => {
          if (cancelled) { ws.close(); return; }
          setStatus('connected');
          // Send initial size so the PTY's TIOCGWINSZ matches the renderer
          // before any input. Without this, line-wrap goes wrong on first
          // command output for narrow terminals.
          ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
        };

        // Debounced publish to nodeOutputs. Coalesces tap updates so a noisy
        // PTY (htop, vim redraws, `ls` floods) doesn't trigger 100 re-renders
        // a second downstream. 120ms is fast enough that LivePreview still
        // feels live but slow enough to amortize batched updates.
        const schedulePublish = () => {
          if (publishTimerRef.current) return;
          publishTimerRef.current = setTimeout(() => {
            publishTimerRef.current = null;
            if (!publishRef.current) return;
            publishRef.current(id, {
              stdoutTail: stdoutBufRef.current,
              urls: [...urlsRef.current],
              latestFile: latestFileRef.current,
              terminalLive: true,
            });
          }, 120);
        };

        ws.onmessage = (ev) => {
          let parsed;
          try { parsed = JSON.parse(ev.data); } catch { return; }
          if (parsed.type === 'data') {
            terminal.write(parsed.data);
          } else if (parsed.type === 'plain') {
            // ANSI-stripped stdout slice for the wire-out log tail.
            stdoutBufRef.current = (stdoutBufRef.current + (parsed.text || '')).slice(-TERMINAL_STDOUT_TAIL_CAP);
            schedulePublish();
          } else if (parsed.type === 'urls') {
            // Server already deduped against its session set, but guard
            // against client-side dupes after a reconnect.
            const fresh = (parsed.urls || []).filter(u => !urlsRef.current.includes(u));
            if (fresh.length) {
              urlsRef.current = [...urlsRef.current, ...fresh].slice(-32);
              schedulePublish();
            }
          } else if (parsed.type === 'cwd-file') {
            latestFileRef.current = {
              relPath: parsed.relPath,
              kind: parsed.kind,
              mtime: parsed.mtime,
            };
            schedulePublish();
          } else if (parsed.type === 'exit') {
            terminal.write(`\r\n\x1b[33m[shell exited code ${parsed.code}]\x1b[0m\r\n`);
            setStatus('disconnected');
          } else if (parsed.type === 'error') {
            terminal.write(`\r\n\x1b[31m[error: ${parsed.message}]\x1b[0m\r\n`);
            setStatus('error');
            setErrorMsg(parsed.message || 'unknown error');
          }
        };

        ws.onerror = () => {
          if (cancelled) return;
          setStatus('error');
          setErrorMsg('WebSocket error — is the server running on port 3001?');
        };

        ws.onclose = () => {
          if (cancelled) return;
          setStatus(prev => prev === 'error' ? prev : 'disconnected');
        };

        // Terminal → WS. Each keystroke (and paste) flows through onData
        // as a string. Wrap in JSON so the server can disambiguate input
        // from resize messages.
        terminal.onData((data) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'data', data }));
          }
        });

        // Container resize → fit.fit() → push new cols/rows to the PTY.
        // Without this, line wrap and TUI redraws (htop, vim) get stuck
        // at the original 80x24 default.
        resizeObserver = new ResizeObserver(() => {
          if (cancelled) return;
          try {
            fit.fit();
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
            }
          } catch { /* terminal disposed mid-observation */ }
        });
        resizeObserver.observe(containerRef.current);
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setErrorMsg(err.message || String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
      if (resizeObserver) resizeObserver.disconnect();
      if (publishTimerRef.current) { clearTimeout(publishTimerRef.current); publishTimerRef.current = null; }
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* already closed */ }
        wsRef.current = null;
      }
      if (terminalRef.current) {
        try { terminalRef.current.dispose(); } catch { /* already disposed */ }
        terminalRef.current = null;
      }
    };
  }, [id, restartCounter]);

  const stop_ = (e) => { e.stopPropagation(); };

  const dotColor = status === 'connected' ? '#10b981'
    : status === 'connecting' ? '#FFD24A'
    : status === 'error' ? '#e74c3c'
    : status === 'disconnected' ? '#FFD24A'
    : '#555';

  const restart = () => setRestartCounter(c => c + 1);

  return (
    <div className="cv-node cv-terminal nowheel" style={{ '--status-color': dotColor }}>
      <NodeDeleteBtn nodeId={id} />

      <div className="cv-terminal-header">
        <div className="cv-terminal-dot" />
        <span>TERMINAL</span>
        <span className={`cv-terminal-stat cv-terminal-stat-${status}`}>
          {status === 'connecting' ? 'connecting…'
            : status === 'connected' ? '● live'
            : status === 'disconnected' ? 'closed'
            : status === 'error' ? '⚠ error'
            : ''}
        </span>
      </div>

      {errorMsg && (
        <div className="cv-terminal-err">{errorMsg}</div>
      )}

      <div
        className="cv-terminal-pane nodrag"
        ref={containerRef}
        onClick={stop_}
        onMouseDown={stop_}
        onWheel={stop_}
      />

      {(status === 'disconnected' || status === 'error') && (
        <button
          className="cv-terminal-btn-restart nodrag"
          onClick={(e) => { stop_(e); restart(); }}
          onMouseDown={stop_}
        >
          restart shell
        </button>
      )}

      {/* LivePreview wire-outs. Three vertically stacked handles on the right
          edge — operator's wire-choice IS the preview mode. Each handle's
          label shows on hover so it's obvious which downstream behavior to
          expect. */}
      <HandleWithTip
        type="source"
        position={Position.Right}
        id="stdout-out"
        tip="stdout → LivePreview log mode (ANSI-stripped tail)"
        style={{ top: '30%' }}
      />
      <HandleWithTip
        type="source"
        position={Position.Right}
        id="urls-out"
        tip="urls → LivePreview iframe mode (auto-detected http/localhost URLs)"
        style={{ top: '55%' }}
      />
      <HandleWithTip
        type="source"
        position={Position.Right}
        id="cwd-out"
        tip="cwd file → LivePreview file mode (newest file in working dir)"
        style={{ top: '80%' }}
      />
    </div>
  );
}

/* ===== LIVE PREVIEW NODE — Block 5 of the endgame build plan ============= */
//
// Wire-driven display. Mode is determined by which output handle on the
// upstream node the incoming edge originates from — no operator-side mode
// toggle. Closes the "closed container" UX: agent runs in TerminalNode,
// LivePreview renders what the agent builds, operator watches both.
//
// Modes by sourceHandle:
//   stdout-out → log    (ANSI-stripped tail, monospace, auto-scroll bottom)
//   urls-out   → iframe (latest detected http/localhost URL)
//   cwd-out    → file   (img/video/audio/html/text based on file kind)
//
// Per feedback_memory_as_wire: the wire IS the context. Picking a wire is
// the only configuration. LivePreview has zero settings.

function LivePreviewNode({ id }) {
  const { edges, nodeOutputs } = useContext(CanvasCtx);
  const logRef = useRef(null);
  const [textContent, setTextContent] = useState('');
  const [textErr, setTextErr] = useState('');

  // Find the upstream wire. First matching edge wins — LivePreview takes one
  // input. Operator can change mode by dragging a different output handle of
  // the same upstream node into LivePreview's input.
  const inEdge = (edges || []).find(e => e.target === id);
  const upstream = inEdge ? nodeOutputs?.[inEdge.source] : null;
  const sourceHandle = inEdge?.sourceHandle || '';

  // Mode resolution. Default fallbacks let LivePreview also accept other
  // upstream types — e.g., a Niche Script Gen wire shows the script text
  // (log mode), an image-emitting node shows the image (file mode).
  let mode = 'idle';
  if (sourceHandle === 'stdout-out' && upstream?.stdoutTail) mode = 'log';
  else if (sourceHandle === 'urls-out' && upstream?.urls?.length) mode = 'url';
  else if (sourceHandle === 'cwd-out' && upstream?.latestFile) mode = 'file';
  else if (upstream?.stdoutTail) mode = 'log';
  else if (upstream?.urls?.length) mode = 'url';
  else if (upstream?.latestFile) mode = 'file';
  else if (upstream?.script || upstream?.text) mode = 'log';
  else if (upstream?.url) mode = 'url-static';

  // Auto-scroll log to bottom on update (the tail is what matters).
  useEffect(() => {
    if (mode !== 'log') return;
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [upstream?.stdoutTail, upstream?.script, upstream?.text, mode]);

  // Fetch text-file contents when in file mode and kind is 'text'. The
  // server's /api/local-text endpoint already caps at 1MB so this is safe to
  // hit on every mtime change.
  const latestFile = upstream?.latestFile;
  const fileKey = latestFile ? `${latestFile.relPath}::${latestFile.mtime}` : '';
  useEffect(() => {
    if (mode !== 'file' || !latestFile) return;
    if (latestFile.kind !== 'text') { setTextContent(''); setTextErr(''); return; }
    let cancelled = false;
    (async () => {
      try {
        // The file watcher emitted a relPath relative to __dirname. The
        // text endpoint wants an absolute path — but it also accepts relative
        // ones from cwd. Use the absolute form to be safe.
        const r = await fetch(`http://localhost:3001/api/local-text?path=${encodeURIComponent(latestFile.relPath)}`);
        const data = await r.json();
        if (cancelled) return;
        if (!r.ok) { setTextErr(data.error || `HTTP ${r.status}`); setTextContent(''); }
        else { setTextErr(''); setTextContent(data.content || ''); }
      } catch (err) {
        if (!cancelled) { setTextErr(err.message); setTextContent(''); }
      }
    })();
    return () => { cancelled = true; };
  }, [mode, fileKey, latestFile]);

  const latestUrl = mode === 'url'
    ? upstream.urls[upstream.urls.length - 1]
    : (mode === 'url-static' ? upstream.url : '');

  const wired = !!inEdge;
  const live = !!upstream?.terminalLive;
  const dotColor = !wired ? '#555'
    : mode === 'idle' ? '#FFD24A'
    : live ? '#34d399'
    : '#00ffff';

  const modeLabel = mode === 'log' ? 'LOG TAIL'
    : mode === 'url' ? 'URL · iframe'
    : mode === 'url-static' ? 'URL · iframe'
    : mode === 'file' ? `FILE · ${latestFile?.kind || 'unknown'}`
    : wired ? 'WAITING…'
    : 'NO WIRE';

  // File-kind renderer. Uses the existing /api/local-image and /api/local-video
  // endpoints (both are generic sendFile under the hood; the names are legacy).
  const renderFile = () => {
    if (!latestFile) return null;
    const encoded = encodeURIComponent(latestFile.relPath);
    const imgUrl = `http://localhost:3001/api/local-image?path=${encoded}`;
    const vidUrl = `http://localhost:3001/api/local-video?path=${encoded}`;
    const cacheBust = `&t=${latestFile.mtime || Date.now()}`;
    if (latestFile.kind === 'image') {
      return <img src={imgUrl + cacheBust} alt={latestFile.relPath}
        style={{ width: '100%', borderRadius: 4, background: '#0a0a0f' }} />;
    }
    if (latestFile.kind === 'video') {
      return <video key={fileKey} src={vidUrl} controls muted loop playsInline
        style={{ width: '100%', borderRadius: 4, background: '#0a0a0f' }} />;
    }
    if (latestFile.kind === 'audio') {
      return <audio key={fileKey} src={vidUrl} controls
        style={{ width: '100%' }} />;
    }
    if (latestFile.kind === 'html') {
      return <iframe key={fileKey} src={imgUrl + cacheBust} title={latestFile.relPath}
        sandbox="allow-scripts allow-same-origin"
        style={{ width: '100%', height: 280, border: '1px solid #333', borderRadius: 4, background: '#fff' }} />;
    }
    if (latestFile.kind === 'text') {
      if (textErr) return <div style={{ fontSize: 11, color: '#e85d75', padding: 6 }}>{textErr}</div>;
      return (
        <pre style={{
          margin: 0, padding: 8, fontSize: 10, lineHeight: 1.4,
          background: '#0a0a0f', color: '#e8e8e8',
          borderRadius: 4, maxHeight: 280, overflow: 'auto',
          fontFamily: 'JetBrains Mono, ui-monospace, Consolas, monospace',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {textContent || <span style={{ opacity: 0.5 }}>loading…</span>}
        </pre>
      );
    }
    // unknown — just show the path
    return (
      <div style={{ fontSize: 11, padding: 8, color: '#999', fontFamily: 'monospace' }}>
        {latestFile.relPath} <span style={{ opacity: 0.6 }}>({latestFile.kind})</span>
      </div>
    );
  };

  return (
    <div className="cv-node nowheel" style={{
      '--status-color': dotColor,
      '--node-accent': '#34d399',
      minWidth: 320,
      maxWidth: 480,
    }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="preview-in" />

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 10px', borderBottom: '1px solid rgba(52, 211, 153, 0.25)',
        background: 'linear-gradient(90deg, rgba(52,211,153,0.15), transparent)',
      }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%', background: dotColor,
          boxShadow: live ? `0 0 6px ${dotColor}` : 'none',
        }} />
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: '#e8e8e8' }}>
          LIVE PREVIEW
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 9, color: '#34d399', fontFamily: 'monospace', letterSpacing: 0.5 }}>
          {modeLabel}
        </span>
      </div>

      <div style={{ padding: 8, boxSizing: 'border-box' }}>
        {!wired && (
          <div style={{ fontSize: 11, color: '#888', padding: 12, textAlign: 'center', fontStyle: 'italic' }}>
            wire a Terminal output handle<br />
            <span style={{ fontSize: 10, opacity: 0.7 }}>
              stdout · urls · cwd
            </span>
          </div>
        )}

        {wired && mode === 'idle' && (
          <div style={{ fontSize: 11, color: '#FFD24A', padding: 12, textAlign: 'center' }}>
            waiting for upstream signal…
          </div>
        )}

        {mode === 'log' && (
          <div ref={logRef}
            className="nodrag nowheel"
            onMouseDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            style={{
              fontSize: 10, lineHeight: 1.4, padding: 8,
              background: '#0a0a0f', color: '#e8e8e8',
              borderRadius: 4, maxHeight: 280, overflow: 'auto',
              fontFamily: 'JetBrains Mono, ui-monospace, Consolas, monospace',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
            {upstream?.stdoutTail || upstream?.script || upstream?.text || ''}
          </div>
        )}

        {(mode === 'url' || mode === 'url-static') && latestUrl && (
          <div>
            <div style={{
              fontSize: 9, color: '#34d399', fontFamily: 'monospace',
              padding: '4px 6px', marginBottom: 6,
              background: 'rgba(52,211,153,0.08)', borderRadius: 3,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {latestUrl}
            </div>
            <iframe key={latestUrl}
              src={latestUrl}
              title="LivePreview"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              style={{
                width: '100%', height: 320,
                border: '1px solid #333', borderRadius: 4, background: '#fff',
              }} />
          </div>
        )}

        {mode === 'file' && renderFile()}
      </div>
    </div>
  );
}

/* ===== SUNO NODE — Block 6 of the endgame build plan ====================== */
//
// Music generation via kie.ai's Suno model. Reuses /api/kie/create +
// /api/kie/status — same create+poll pattern as KieImg2VidNode. Wire input
// via context-in (Block 4 doctrine) lets a script gen / diary / Maestro
// session drive the prompt. Output shape { url, type:'audio', duration }
// feeds downstream — Cartesian as audio bed, Stack Video as audio track,
// or a wired Command Runner that processes the file.
//
// Honest v1 limit: kie.ai's exact Suno model name + input schema may need
// fine-tuning per your account. Default model is 'suno-v3-5' with a
// best-guess input shape; if generation errors, the UI surfaces the kie.ai
// response so we can adjust the model id or input fields without code surgery.

const SUNO_GENRES = ['EDM', 'Hip-Hop', 'Lo-fi', 'Synthwave', 'Rock', 'Pop', 'Ambient', 'Folk', 'Classical', 'Jazz', 'R&B', 'Cinematic', 'Trap', 'Drum & Bass'];
const SUNO_MOODS = ['Energetic', 'Chill', 'Dark', 'Uplifting', 'Melancholic', 'Aggressive', 'Romantic', 'Mysterious', 'Dreamy', 'Triumphant', 'Tense', 'Nostalgic'];
// kie.ai Suno model versions per https://docs.kie.ai/suno-api/generate-music
// V5 is the newest stable; V5_5 is the experimental successor. Older V4_*
// variants stay listed for cost/style fallbacks.
const SUNO_MODELS = ['V5', 'V5_5', 'V4_5PLUS', 'V4_5ALL', 'V4_5', 'V4'];
// Suno has no dedicated voice_gender param — we pass the choice as a
// bracketed style cue AND a negativeTags counter-push for stronger steering.
const SUNO_VOCALS = ['auto', 'male', 'female'];
// Optional vocal-style modifier composed with gender. Per the entrepeneur4lyf
// meta-tags guide (reference_suno_meta_tags_guide.md), these stack with the
// gender token: "male vocals, raspy, powerful" is valid and stronger than
// gender alone. 'none' means don't add a style modifier.
const SUNO_VOCAL_STYLES = ['none', 'powerful', 'soulful', 'whispered', 'raspy', 'falsetto', 'smooth', 'clear', 'deep', 'rap', 'sung R&B', 'spoken word', 'screamed', 'vulnerable', 'melodic', 'autotuned'];
// Default lyrics scaffold when operator enables custom mode with no wire seed.
// Per the guide, missing section markers cause Suno to generate continuous
// loops — so we always seed with at least an Intro/Verse/Chorus skeleton.
const SUNO_LYRICS_SCAFFOLD = `[Intro]

[Verse]

[Chorus]

[Verse]

[Chorus]

[Bridge]

[Chorus]

[Outro]`;

function SunoNode({ id }) {
  const { edges, nodeOutputs, onAssetSequencePublish } = useContext(CanvasCtx);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('kie-api-key') || '');
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState('V5');
  const [showModel, setShowModel] = useState(false);
  const [promptOverride, setPromptOverride] = useState('');
  const [genre, setGenre] = useState('EDM');
  const [mood, setMood] = useState('Energetic');
  const [instrumental, setInstrumental] = useState(false);
  const [vocals, setVocals] = useState(() => localStorage.getItem('suno-vocals') || 'auto');
  const [vocalStyle, setVocalStyle] = useState(() => localStorage.getItem('suno-vocal-style') || 'none');
  // Custom mode unlocks the [Verse]/[Chorus] structure tags + explicit style
  // and title fields per the entrepeneur4lyf meta-tags guide. Off by default
  // so existing v1 setups stay 100% backwards-compatible.
  const [customMode, setCustomMode] = useState(() => localStorage.getItem('suno-custom-mode') === '1');
  const [lyrics, setLyrics] = useState('');
  const [styleField, setStyleField] = useState('');
  const [title, setTitle] = useState('');
  const [negTagsFree, setNegTagsFree] = useState('');
  const [status, setStatus] = useState('idle');   // idle | submitting | polling | done | error
  const [resultUrl, setResultUrl] = useState('');
  const [resultTitle, setResultTitle] = useState('');
  const [duration, setDuration] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [savedPath, setSavedPath] = useState('');
  const pollCancelRef = useRef(false);

  const saveKey = (v) => { setApiKey(v); localStorage.setItem('kie-api-key', v); };

  // Resolve upstream wire content (Block 4 pattern) — script/prompt/etc
  let upstreamContent = '';
  for (const edge of (edges || []).filter(e => e.target === id && e.targetHandle === 'context-in')) {
    const src = nodeOutputs?.[edge.source];
    if (!src) continue;
    upstreamContent = src.script || src.prompt || src.text || src.caption || src.hook || src.prd || '';
    if (upstreamContent) break;
  }
  const hasWire = !!upstreamContent;
  // Quick-mode prompts are short (<200 chars) — truncate to the first
  // sentence-ish chunk so we don't blow the API limit. Custom-mode lyrics
  // can run ~3000 chars (Suno's effective limit), so we keep that nearly full.
  const wirePromptSeed = hasWire
    ? (upstreamContent.split(/[.!?\n]/)[0] || upstreamContent).slice(0, 200).trim()
    : '';
  const wireLyricsSeed = hasWire ? upstreamContent.slice(0, 3000).trim() : '';
  const finalPrompt = (promptOverride.trim() || wirePromptSeed || '').slice(0, 1000);
  const finalLyrics = (lyrics.trim() || wireLyricsSeed || '').slice(0, 3000);
  // kie.ai's `prompt` field carries different content per mode:
  //   quick mode  → finalPrompt (description) wrapped with bracketed style cue
  //   custom mode → finalLyrics (lyrics with [Verse]/[Chorus] structure markers)
  const apiPromptReady = customMode ? !!finalLyrics : !!finalPrompt;

  // Build the comma-separated style string per the meta-tags guide priority
  // order: Genre → Mood → Vocal Gender → Vocal Style. Used as a bracketed
  // cue in quick mode or as the dedicated `style` field in custom mode
  // (operator can override the field manually).
  const buildAutoStyle = () => {
    const parts = [genre, mood];
    if (!instrumental && vocals !== 'auto') parts.push(`${vocals} vocals`);
    if (!instrumental && vocalStyle !== 'none') parts.push(vocalStyle);
    return parts.filter(Boolean).join(', ');
  };

  // Combine auto-derived vocal exclusion with the operator's free-form
  // negative tags. Suno respects negativeTags more strongly than positive-only
  // cues, so this is the cleanest way to push generation away from unwanted
  // features (e.g. 'distorted, lo-fi, autotuned' or 'female vocals').
  const buildNegativeTags = () => {
    const autoVocal = (!instrumental && vocals === 'male') ? 'female vocals'
                    : (!instrumental && vocals === 'female') ? 'male vocals'
                    : '';
    const free = negTagsFree.trim();
    const combined = [autoVocal, free].filter(Boolean).join(', ');
    return combined || undefined;
  };

  // Publish to nodeOutputs whenever the result lands. Using the generic
  // shallow-merge publisher (named onAssetSequencePublish for legacy reasons,
  // but functionally a no-shape publish into nodeOutputs[id]). Also auto-
  // saves the mp3 to sounds/suno/ so songs accumulate as real deliverables
  // — the kie.ai CDN URL still works during the session, but the on-disk
  // file is the truth that survives canvas reloads.
  useEffect(() => {
    if (!resultUrl) return;
    onAssetSequencePublish?.(id, {
      url: resultUrl,
      type: 'audio',
      duration,
      title: resultTitle,
    });
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('http://localhost:3001/api/suno/save-to-disk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: resultUrl, title: resultTitle }),
        });
        const d = await r.json();
        if (cancelled) return;
        if (r.ok && d.relativePath) {
          setSavedPath(d.relativePath);
          // Re-publish with localPath so downstream nodes can prefer the disk
          // copy over the kie.ai CDN URL (CDNs expire; disk doesn't).
          onAssetSequencePublish?.(id, {
            url: resultUrl,
            localPath: d.relativePath,
            type: 'audio',
            duration,
            title: resultTitle,
          });
        }
      } catch { /* non-fatal — CDN URL still works for the session */ }
    })();
    return () => { cancelled = true; };
  }, [id, resultUrl, duration, resultTitle, onAssetSequencePublish]);

  // Cancel any in-flight polling on unmount so we don't leak setTimeout chains
  useEffect(() => () => { pollCancelRef.current = true; }, []);

  const stop_ = (e) => { e.stopPropagation(); };

  const generate = async () => {
    if (!apiKey) { setError('KIE_API_KEY required (paste it above or set in .env)'); setStatus('error'); return; }
    if (customMode && !finalLyrics) { setError('lyrics required in custom mode (wire one in, paste, or click + scaffold)'); setStatus('error'); return; }
    if (!customMode && !finalPrompt) { setError('prompt required (wire one in or paste below)'); setStatus('error'); return; }

    setStatus('submitting');
    setError('');
    setResultUrl('');
    setResultTitle('');
    setDuration(0);
    setElapsed(0);
    setSavedPath('');
    pollCancelRef.current = false;

    const autoStyle = buildAutoStyle();
    const negativeTags = buildNegativeTags();

    // Body shape differs by mode. Quick mode packs everything into prompt as
    // a bracketed style cue. Custom mode separates lyrics (prompt), style,
    // and title for full Suno control.
    const body = { apiKey, model, instrumental, customMode };
    if (customMode) {
      body.prompt = finalLyrics;
      body.style = (styleField.trim() || autoStyle);
      if (title.trim()) body.title = title.trim();
    } else {
      body.prompt = `${finalPrompt} [${autoStyle}]`;
    }
    if (negativeTags) body.negativeTags = negativeTags;

    try {
      const res = await fetch('http://localhost:3001/api/suno/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data?.data?.taskId) {
        throw new Error(data?.error?.message || data?.error || data?.msg || `HTTP ${res.status} — kie.ai rejected the request (check model id "${model}" against your account's supported list)`);
      }
      const tid = data.data.taskId;
      setStatus('polling');

      // Poll every 10s up to 5 min. Suno typically takes 30-90s.
      // Status enum per docs: PENDING / TEXT_SUCCESS / FIRST_SUCCESS / SUCCESS
      // (success path) and CREATE_TASK_FAILED / GENERATE_AUDIO_FAILED /
      // CALLBACK_EXCEPTION / SENSITIVE_WORD_ERROR (failure paths). FIRST_SUCCESS
      // means the first of two tracks is ready — we accept that as "done"
      // for faster perceived completion.
      let secs = 0;
      const poll = async () => {
        if (pollCancelRef.current) return;
        secs += 10;
        setElapsed(secs);
        try {
          const pr = await fetch(`http://localhost:3001/api/suno/status/${tid}`, { headers: { 'x-kie-key': apiKey } });
          const pd = await pr.json();
          const st = pd?.data?.status;
          const sunoData = pd?.data?.response?.sunoData;

          // Done: status indicates success AND we have at least one clip with audioUrl
          if ((st === 'SUCCESS' || st === 'FIRST_SUCCESS') && Array.isArray(sunoData) && sunoData.length > 0) {
            const first = sunoData.find(c => c.audioUrl) || sunoData[0];
            const url = first?.audioUrl || first?.streamAudioUrl || '';
            if (!url) {
              setError(`status ${st} but no audioUrl — raw: ${JSON.stringify(pd.data).slice(0, 200)}`);
              setStatus('error');
              return;
            }
            setResultUrl(url);
            setResultTitle(first.title || '');
            setDuration(Number(first.duration) || 0);
            setStatus('done');
            return;
          }

          // Failure states
          if (st === 'CREATE_TASK_FAILED' || st === 'GENERATE_AUDIO_FAILED'
              || st === 'CALLBACK_EXCEPTION' || st === 'SENSITIVE_WORD_ERROR') {
            setError(pd.data?.errorMessage || `kie.ai status: ${st}`);
            setStatus('error');
            return;
          }

          if (secs >= 300) {
            setError(`timeout (5 min) — last status: ${st || 'unknown'}`);
            setStatus('error');
            return;
          }
          setTimeout(poll, 10000);
        } catch (pollErr) {
          setError(`poll error: ${pollErr.message}`);
          setStatus('error');
        }
      };
      setTimeout(poll, 10000);
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  };

  const dotColor = status === 'submitting' || status === 'polling' ? '#fb923c'
    : status === 'done' ? '#00FFFF'
    : status === 'error' ? '#e74c3c'
    : '#555';

  return (
    <div className="cv-node cv-suno nowheel" style={{ '--status-color': dotColor }}>
      <NodeDeleteBtn nodeId={id} />
      <HandleWithTip
        type="target"
        position={Position.Left}
        id="context-in"
        tip="prompt seed ← wire any text-emitting node (script, diary, transcript, prd)"
      />
      <HandleWithTip
        type="source"
        position={Position.Right}
        id="audio-out"
        tip="output → audio mp3 · wire to Cartesian / Stack Video / Command Runner for downstream use"
      />

      <div className="cv-suno-header">
        <div className="cv-suno-dot" />
        <span>SUNO</span>
        {status === 'submitting' && <span className="cv-suno-stat cv-suno-stat-running">submitting…</span>}
        {status === 'polling' && <span className="cv-suno-stat cv-suno-stat-running">polling · {elapsed}s</span>}
        {status === 'done' && <span className="cv-suno-stat cv-suno-stat-done">✓ done</span>}
        {status === 'error' && <span className="cv-suno-stat cv-suno-stat-error">⚠ error</span>}
      </div>

      {hasWire && (
        <div className="cv-suno-wire">
          {customMode
            ? `📌 wire → lyrics · ${wireLyricsSeed.length} chars`
            : `📌 wire seed · ${wirePromptSeed.length} chars`}
        </div>
      )}

      {!customMode && (
        <div className="cv-suno-field">
          <textarea
            className="cv-suno-textarea nodrag"
            placeholder={hasWire ? `(wire seed in use — type to override)` : 'EDM track about late-night coding…'}
            value={promptOverride}
            rows={3}
            onChange={(e) => { stop_(e); setPromptOverride(e.target.value); }}
            onClick={stop_} onMouseDown={stop_}
          />
        </div>
      )}

      <button
        className="cv-suno-model-toggle nodrag"
        onClick={(e) => { stop_(e); const next = !customMode; setCustomMode(next); localStorage.setItem('suno-custom-mode', next ? '1' : '0'); }}
        onMouseDown={stop_}
        title="custom mode unlocks lyrics with [Verse]/[Chorus] structure + explicit style + title (Suno meta-tags-guide)"
      >
        {customMode ? '▾ custom mode' : '▸ custom mode (advanced)'}
      </button>

      {customMode && (
        <>
          <div className="cv-suno-field">
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap', fontSize: 10 }}>
              <span style={{ opacity: 0.6, marginRight: 4 }}>lyrics</span>
              <button
                className="nodrag"
                style={{ fontSize: 10, padding: '2px 6px', border: '1px solid #444', background: 'transparent', color: '#aaa', borderRadius: 3, cursor: 'pointer' }}
                onClick={(e) => { stop_(e); setLyrics(l => l.trim() ? l : SUNO_LYRICS_SCAFFOLD); }}
                onMouseDown={stop_}
                title="insert Intro/Verse/Chorus/Bridge/Outro skeleton (only if empty)"
              >+ scaffold</button>
              <button
                className="nodrag"
                style={{ fontSize: 10, padding: '2px 6px', border: '1px solid #444', background: 'transparent', color: '#aaa', borderRadius: 3, cursor: 'pointer' }}
                onClick={(e) => { stop_(e); setLyrics(l => `${l}${l && !l.endsWith('\n') ? '\n' : ''}[Verse]\n`); }}
                onMouseDown={stop_}
              >+[Verse]</button>
              <button
                className="nodrag"
                style={{ fontSize: 10, padding: '2px 6px', border: '1px solid #444', background: 'transparent', color: '#aaa', borderRadius: 3, cursor: 'pointer' }}
                onClick={(e) => { stop_(e); setLyrics(l => `${l}${l && !l.endsWith('\n') ? '\n' : ''}[Chorus]\n`); }}
                onMouseDown={stop_}
              >+[Chorus]</button>
              <button
                className="nodrag"
                style={{ fontSize: 10, padding: '2px 6px', border: '1px solid #444', background: 'transparent', color: '#aaa', borderRadius: 3, cursor: 'pointer' }}
                onClick={(e) => { stop_(e); setLyrics(l => `${l}${l && !l.endsWith('\n') ? '\n' : ''}[Bridge]\n`); }}
                onMouseDown={stop_}
              >+[Bridge]</button>
            </div>
            <textarea
              className="cv-suno-textarea nodrag"
              placeholder={hasWire ? `(wire seed → lyrics if empty)` : '[Intro]\n[Verse]\nYour lyrics here…\n[Chorus]\nHook line here…'}
              value={lyrics}
              rows={14}
              onChange={(e) => { stop_(e); setLyrics(e.target.value); }}
              onClick={stop_} onMouseDown={stop_}
              style={{ width: '100%', boxSizing: 'border-box', resize: 'none' }}
            />
          </div>

          <div className="cv-suno-field">
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, fontSize: 10 }}>
              <span style={{ opacity: 0.6, marginRight: 4 }}>style</span>
              <button
                className="nodrag"
                style={{ fontSize: 10, padding: '2px 6px', border: '1px solid #444', background: 'transparent', color: '#aaa', borderRadius: 3, cursor: 'pointer' }}
                onClick={(e) => { stop_(e); setStyleField(buildAutoStyle()); }}
                onMouseDown={stop_}
                title="rebuild style string from the dropdowns below (Genre, Mood, Vocals, Vocal Style)"
              >↻ from dropdowns</button>
            </div>
            <textarea
              className="cv-suno-textarea nodrag"
              placeholder={`auto-seeded from dropdowns if empty · e.g. "${buildAutoStyle()}"`}
              value={styleField}
              rows={3}
              onChange={(e) => { stop_(e); setStyleField(e.target.value); }}
              onClick={stop_} onMouseDown={stop_}
              style={{ width: '100%', boxSizing: 'border-box', resize: 'none' }}
            />
          </div>

          <div className="cv-suno-field">
            <input
              type="text"
              className="cv-suno-input nodrag"
              placeholder="title (optional)"
              value={title}
              onChange={(e) => { stop_(e); setTitle(e.target.value); }}
              onClick={stop_} onMouseDown={stop_}
            />
          </div>
        </>
      )}

      <div className="cv-suno-row">
        <label className="cv-suno-label nodrag" onClick={stop_} onMouseDown={stop_}>
          <span>genre</span>
          <select className="cv-suno-select nodrag" value={genre}
            onChange={(e) => { stop_(e); setGenre(e.target.value); }}
            onClick={stop_} onMouseDown={stop_}>
            {SUNO_GENRES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <label className="cv-suno-label nodrag" onClick={stop_} onMouseDown={stop_}>
          <span>mood</span>
          <select className="cv-suno-select nodrag" value={mood}
            onChange={(e) => { stop_(e); setMood(e.target.value); }}
            onClick={stop_} onMouseDown={stop_}>
            {SUNO_MOODS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="cv-suno-label nodrag" onClick={stop_} onMouseDown={stop_}>
          <span>vocals</span>
          <select
            className="cv-suno-select nodrag"
            value={vocals}
            onChange={(e) => { stop_(e); setVocals(e.target.value); localStorage.setItem('suno-vocals', e.target.value); }}
            onClick={stop_} onMouseDown={stop_}
            disabled={instrumental}
            title={instrumental ? 'disabled while instrumental is on' : 'pick a vocalist gender or leave auto for Suno to decide'}>
            {SUNO_VOCALS.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
      </div>

      <div className="cv-suno-row">
        <label className="cv-suno-label nodrag" onClick={stop_} onMouseDown={stop_}>
          <span>vocal style</span>
          <select
            className="cv-suno-select nodrag"
            value={vocalStyle}
            onChange={(e) => { stop_(e); setVocalStyle(e.target.value); localStorage.setItem('suno-vocal-style', e.target.value); }}
            onClick={stop_} onMouseDown={stop_}
            disabled={instrumental}
            style={{ fontSize: 12 }}
            title={instrumental ? 'disabled while instrumental is on' : 'stacks with gender · e.g. "male vocals, raspy"'}>
            {SUNO_VOCAL_STYLES.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
      </div>

      <label className="cv-suno-toggle nodrag" onClick={stop_} onMouseDown={stop_}>
        <input
          type="checkbox"
          checked={instrumental}
          onChange={(e) => { stop_(e); setInstrumental(e.target.checked); }}
          onClick={stop_} onMouseDown={stop_}
        />
        <span>instrumental (no vocals)</span>
      </label>

      <div className="cv-suno-field">
        <input
          type="text"
          className="cv-suno-input nodrag"
          placeholder="negative tags · e.g. distorted, lo-fi, autotuned"
          value={negTagsFree}
          onChange={(e) => { stop_(e); setNegTagsFree(e.target.value); }}
          onClick={stop_} onMouseDown={stop_}
          title="comma-separated styles to PUSH AWAY from — Suno respects negativeTags strongly"
        />
      </div>

      <div className="cv-suno-field">
        <input
          type={showKey ? 'text' : 'password'}
          className="cv-suno-input nodrag"
          placeholder="KIE_API_KEY"
          value={apiKey}
          onChange={(e) => { stop_(e); saveKey(e.target.value); }}
          onClick={stop_} onMouseDown={stop_}
        />
        <button className="cv-suno-eye nodrag"
          onClick={(e) => { stop_(e); setShowKey(s => !s); }}
          onMouseDown={stop_}
          title={showKey ? 'hide' : 'show'}
        >{showKey ? '◉' : '○'}</button>
      </div>

      <button className="cv-suno-model-toggle nodrag"
        onClick={(e) => { stop_(e); setShowModel(s => !s); }}
        onMouseDown={stop_}
      >
        {showModel ? '▾ model' : '▸ model'} · {model}
      </button>
      {showModel && (
        <div className="cv-suno-field">
          <select
            className="cv-suno-select nodrag"
            value={model}
            onChange={(e) => { stop_(e); setModel(e.target.value); }}
            onClick={stop_} onMouseDown={stop_}
          >
            {SUNO_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      )}

      {error && <div className="cv-suno-err">{error}</div>}

      {resultUrl && (
        <div className="cv-suno-result">
          {resultTitle && <div className="cv-suno-result-title">{resultTitle}</div>}
          <audio controls src={resultUrl} className="cv-suno-audio nodrag"
            onClick={stop_} onMouseDown={stop_} />
          <a className="cv-suno-link nodrag"
            href={resultUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={stop_} onMouseDown={stop_}
          >open mp3 ↗</a>
          {savedPath && (
            <div style={{ fontSize: 10, opacity: 0.75, marginTop: 4, fontFamily: 'monospace' }}>
              💾 {savedPath}
            </div>
          )}
        </div>
      )}

      <button
        className="cv-suno-btn nodrag"
        onClick={(e) => { stop_(e); generate(); }}
        onMouseDown={stop_}
        disabled={status === 'submitting' || status === 'polling' || !apiPromptReady || !apiKey}
      >
        {status === 'submitting' ? 'submitting…'
          : status === 'polling' ? `polling · ${elapsed}s`
          : status === 'done' ? 'regenerate'
          : 'generate'}
      </button>
    </div>
  );
}

/* ===== MIND WIRE NODE — Block 7 of the endgame build plan ================ */
//
// Wraps the operator's "external mind" — voice memo transcripts, Maestro
// session logs, Obsidian notes, freeform paste — as a wire-able canvas
// input. Closes the "wire your notes, your conversations, your mind" lane
// of the painted endgame vision.
//
// v1 modes: paste (textarea) and file (load any local text file via path).
// Both deliver to downstream as `{ text }` for any consumer (Command Runner
// preamble, Suno prompt seed, future analysis nodes). Voice memo / Maestro
// / Obsidian are all "load this file" with different paths — quickpick UI
// for each source can come later if the operator reaches for it often enough.

function MindWireNode({ id }) {
  const { openFilePicker: mwOpenFilePicker } = useContext(CanvasCtx);
  const { onAssetSequencePublish } = useContext(CanvasCtx);
  const [source, setSource] = useState('paste');     // 'paste' | 'file'
  const [pasteText, setPasteText] = useState('');
  const [filePath, setFilePath] = useState('');
  const [fileText, setFileText] = useState('');
  const [fileBytes, setFileBytes] = useState(0);
  const [fileMtime, setFileMtime] = useState(0);
  const [status, setStatus] = useState('idle');      // idle | loading | done | error
  const [error, setError] = useState('');

  const stop_ = (e) => { e.stopPropagation(); };

  // Resolved text — paste mode uses local state, file mode uses last load
  const resolvedText = source === 'paste' ? pasteText : fileText;
  const resolvedBytes = resolvedText ? new Blob([resolvedText]).size : 0;

  // Publish to nodeOutputs whenever resolvedText changes. Multiple field
  // names (text/script/prompt/content) so any downstream consumer's
  // wire-resolution scan picks it up — Block 4 wire-input pattern reads
  // script/prompt/text in priority order.
  useEffect(() => {
    if (!resolvedText) {
      onAssetSequencePublish?.(id, { text: '', script: '', prompt: '', content: '' });
      return;
    }
    onAssetSequencePublish?.(id, {
      text: resolvedText,
      script: resolvedText,
      prompt: resolvedText,
      content: resolvedText,
      source,
      bytes: resolvedBytes,
    });
  }, [id, resolvedText, resolvedBytes, source, onAssetSequencePublish]);

  const loadFile = async () => {
    const trimmed = filePath.trim();
    if (!trimmed) { setError('paste a file path first'); setStatus('error'); return; }
    setStatus('loading');
    setError('');
    try {
      const res = await fetch(`http://localhost:3001/api/local-text?path=${encodeURIComponent(trimmed)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setFileText(data.content || '');
      setFileBytes(data.bytes || 0);
      setFileMtime(data.mtime || 0);
      setStatus('done');
    } catch (err) {
      setError(err.message);
      setStatus('error');
      setFileText('');
      setFileBytes(0);
    }
  };

  const dotColor = status === 'loading' ? '#38bdf8'
    : resolvedText ? '#00FFFF'
    : status === 'error' ? '#e74c3c'
    : '#555';

  // Format mtime for the file source — "loaded 2m ago"-style display so the
  // operator can tell at a glance if the file is stale relative to a recent
  // edit upstream (e.g., a Scribe transcript that just landed).
  const mtimeLabel = (() => {
    if (!fileMtime) return '';
    const ageMs = Date.now() - fileMtime;
    const sec = Math.floor(ageMs / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    return `${day}d ago`;
  })();

  return (
    <div className="cv-node cv-mindwire nowheel" style={{ '--status-color': dotColor }}>
      <NodeDeleteBtn nodeId={id} />
      <HandleWithTip
        type="source"
        position={Position.Right}
        id="mind-out"
        tip="output → text · wire to Command Runner / Suno / any text-consuming node"
      />

      <div className="cv-mindwire-header">
        <div className="cv-mindwire-dot" />
        <span>MIND WIRE</span>
        {resolvedText && (
          <span className="cv-mindwire-stat">{resolvedBytes.toLocaleString()} bytes</span>
        )}
      </div>

      <div className="cv-mindwire-source-row">
        <label className="cv-mindwire-source-opt nodrag" onClick={stop_} onMouseDown={stop_}>
          <input
            type="radio"
            name={`mw-src-${id}`}
            checked={source === 'paste'}
            onChange={() => { setSource('paste'); }}
            onClick={stop_} onMouseDown={stop_}
          />
          <span>paste</span>
        </label>
        <label className="cv-mindwire-source-opt nodrag" onClick={stop_} onMouseDown={stop_}>
          <input
            type="radio"
            name={`mw-src-${id}`}
            checked={source === 'file'}
            onChange={() => { setSource('file'); }}
            onClick={stop_} onMouseDown={stop_}
          />
          <span>file</span>
        </label>
        <span className="cv-mindwire-hint">
          file = voice memo transcript / maestro log / obsidian note / any .txt or .md
        </span>
      </div>

      {source === 'paste' && (
        <div className="cv-mindwire-field">
          <textarea
            className="cv-mindwire-textarea nodrag"
            placeholder="paste your notes, transcript, or anything here…"
            value={pasteText}
            rows={6}
            onChange={(e) => { stop_(e); setPasteText(e.target.value); }}
            onClick={stop_} onMouseDown={stop_}
          />
        </div>
      )}

      {source === 'file' && (
        <>
          <div className="cv-mindwire-field cv-mindwire-file-row">
            <input
              type="text"
              className="cv-mindwire-input nodrag"
              placeholder="absolute path: E:\transcripts\foo.txt"
              value={filePath}
              onChange={(e) => { stop_(e); setFilePath(e.target.value); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { stop_(e); loadFile(); } }}
              onClick={stop_} onMouseDown={stop_}
            />
            <button
              className="nodrag"
              onClick={(e) => { stop_(e); mwOpenFilePicker({
                key: 'mindwire', label: 'a text file',
                startDir: '.',
                exts: ['md', 'txt', 'json', 'yaml', 'yml', 'log', 'csv'],
              }, (p) => setFilePath(p)); }}
              onMouseDown={stop_}
              title="Browse for file"
              style={{ padding: '6px 9px', fontSize: 13, background: 'var(--bg-card, #1a1a24)', border: '1px solid var(--border, #2a2a35)', borderRadius: 4, cursor: 'pointer' }}
            >📁</button>
            <button
              className="cv-mindwire-btn-load nodrag"
              onClick={(e) => { stop_(e); loadFile(); }}
              onMouseDown={stop_}
              disabled={status === 'loading' || !filePath.trim()}
            >
              {status === 'loading' ? 'loading…' : 'load'}
            </button>
          </div>
          {fileText && (
            <div className="cv-mindwire-file-meta">
              {fileBytes.toLocaleString()} bytes · loaded {mtimeLabel}
            </div>
          )}
          {fileText && (
            <div className="cv-mindwire-preview nodrag" onClick={stop_} onMouseDown={stop_}>
              {fileText.slice(0, 800)}
              {fileText.length > 800 && <span className="cv-mindwire-truncated">… ({(fileText.length - 800).toLocaleString()} more chars)</span>}
            </div>
          )}
        </>
      )}

      {error && <div className="cv-mindwire-err">{error}</div>}
    </div>
  );
}

/* ===== CARTESIAN COMPOSER NODE — timed overlays at exact pixel coordinates over a base video ===== */
//
// v1: typed/dropdown form per zone. No visual zone editor (drag-on-thumbnail
// is v2). Coordinates are PERCENTAGES of the base video frame (resolution-
// agnostic). Time windows are seconds from base start. Output duration =
// base video duration.
//
// Zone content can be INLINE (paste URL / type text) or pulled FROM A WIRED
// ASSET SEQUENCE on the content-pool handle. When a zone's source is set to
// an asset, the zone's type + content fields auto-mirror the asset.
const CARTESIAN_ZONE_TYPES = [
  { id: 'image',       label: 'Image' },
  { id: 'video',       label: 'Video' },
  { id: 'text',        label: 'Text' },
  { id: 'hyperframes', label: 'Hyperframes overlay' },
];

// Per-type accent colors for the visual editor overlay rectangles.
// Borrow from the related canvas-node accents so visual identity is
// consistent across the app: image=Image-2 green, video=Video Source blue,
// text=yellow (typography), hyperframes=Hyperframes cyan.
const CARTESIAN_TYPE_COLORS = {
  image:       '#10a37f',
  video:       '#3b82f6',
  text:        '#facc15',
  hyperframes: '#00bcd4',
};

// Per-corner sign table for the visual editor's resize handles. wSign/hSign
// = +1 means the dimension grows when the mouse delta is positive in that
// axis (and the opposite anchor stays put). Lives at module scope so the
// drag-handler useEffect deps stay clean.
const CORNER_SIGNS = {
  'resize-se': { wSign: +1, hSign: +1 },
  'resize-sw': { wSign: -1, hSign: +1 },
  'resize-ne': { wSign: +1, hSign: -1 },
  'resize-nw': { wSign: -1, hSign: -1 },
};

// Motion kinds available for entry/exit. 'fade' is the v1-compatible
// default (opacity ramp only, no transform). The slide directions describe
// the FINAL motion direction relative to the zone's resting position:
// slide-up entry rises into place from below; slide-up exit leaves upward.
const CARTESIAN_MOTION_KINDS = [
  { id: 'fade',        label: 'fade' },
  { id: 'slide-up',    label: 'slide ↑' },
  { id: 'slide-down',  label: 'slide ↓' },
  { id: 'slide-left',  label: 'slide ←' },
  { id: 'slide-right', label: 'slide →' },
  { id: 'scale',       label: 'scale' },
];

const CARTESIAN_DEFAULT_ZONE = () => ({
  id: `z${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
  type: 'text',
  x: 10, y: 10, w: 30, h: 12,
  startSec: 0, endSec: 5,
  contentUrl: '',
  contentText: '',
  contentColor: '#ffffff',
  contentBg: 'rgba(0,0,0,0.55)',
  contentFontSize: 40,
  contentAlign: 'center',
  // Default to 'contain' so the user can SEE the whole asset without it
  // being silently cropped. Cropping was the #1 source of confusion in the
  // pre-default-contain flow ("did my image get clipped? where did the
  // text go?"). Switch to 'cover' explicitly when you want fill-the-zone.
  contentFit: 'contain',
  loop: true,             // video/hyperframes zones loop the asset across the window
  fadeIn: 0,              // seconds — opacity 0→1 over this many seconds at the zone's start
  fadeOut: 0,             // seconds — opacity 1→0 over this many seconds before the zone's end
  // Entry/exit motion layered on top of the opacity ramp. Same duration
  // as fadeIn/fadeOut. 'fade' = no transform (v1 behavior).
  entry: { kind: 'fade' },
  exit:  { kind: 'fade' },
  // Probed pixel dimensions of the inline contentUrl (image/video). Drives
  // lock-aspect drag. 0 means unprobed — drag stays free in that case.
  // Asset-linked zones read dimensions from the linked asset instead.
  contentWidth: 0,
  contentHeight: 0,
});

function CartesianComposerNode({ id }) {
  const { edges, nodeOutputs, onCartesianRender } = useContext(CanvasCtx);
  const [zones, setZones] = useState([CARTESIAN_DEFAULT_ZONE()]);
  // Loop the base video across the comp duration when the file is shorter
  // than what the user wants. Default off — preserves "play through once"
  // semantics for full-length videos. Turn on for short clips you want to
  // tile under a longer overlay sequence (also fixes the freeze-tail bug
  // when the file's container claims more frames than the codec actually has).
  const [baseLoop, setBaseLoop] = useState(false);
  // Visual editor state — togglable panel with HTML5 video + scrubber + zone
  // overlay rectangles. Drag/resize on the rectangles writes back to the
  // same `zones` state the typed form reads (single source of truth).
  const [visualOpen, setVisualOpen] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const videoRef = useRef(null);
  const stageRef = useRef(null);
  // Active drag/resize on a zone rectangle. Null when idle.
  // Schema: { zoneIdx, mode: 'move', startMouseX, startMouseY, startX, startY, stageW, stageH }
  const [dragState, setDragState] = useState(null);
  // Selection bridge — links overlay rectangles ↔ form rows. Click on either
  // side highlights the matching item on the other. Cleared when the
  // selected zone is removed.
  const [selectedZoneIdx, setSelectedZoneIdx] = useState(null);
  const zoneRowRefs = useRef({});

  const beginDrag = (e, idx, mode) => {
    if (!stageRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    // Selecting on mousedown (not click) so a drag-in-progress immediately
    // shows which zone is active, even if the user never finishes the drag.
    setSelectedZoneIdx(idx);
    const stageRect = stageRef.current.getBoundingClientRect();
    // Resolve effective pixel dims for lock-aspect resize. Linked assets
    // win over inline contentWidth/Height (the user picked the asset
    // deliberately, so its aspect is the source of truth). 0 → no lock.
    const z = zones[idx];
    let assetW = 0, assetH = 0;
    if (z.sourceAssetId) {
      const linked = assetPool.find(a => a.id === z.sourceAssetId);
      if (linked && linked.width && linked.height) {
        assetW = linked.width;
        assetH = linked.height;
      }
    } else if (z.contentWidth && z.contentHeight) {
      assetW = z.contentWidth;
      assetH = z.contentHeight;
    }
    setDragState({
      zoneIdx: idx,
      mode,                          // 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se'
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startX: z.x,
      startY: z.y,
      startW: z.w,
      startH: z.h,
      stageW: stageRect.width,
      stageH: stageRect.height,
      assetW, assetH,
    });
  };
  const onRectMouseDown = (e, idx) => beginDrag(e, idx, 'move');
  const onHandleMouseDown = (e, idx, corner) => beginDrag(e, idx, `resize-${corner}`);

  useEffect(() => {
    if (!dragState) return;
    const round1 = (n) => Math.round(n * 10) / 10;
    const MIN = 1; // % — keeps rectangles from inverting or vanishing
    // Percent-aspect: the zoneW% / zoneH% ratio that preserves the asset's
    // PIXEL aspect inside the stage's display rect. Derived from the asset
    // and stage dimensions so the math is correct whether the base is
    // portrait, square, or landscape. 0 means "no lock available."
    const pctAspect = (dragState.assetW > 0 && dragState.assetH > 0)
      ? (dragState.assetW * dragState.stageH) / (dragState.assetH * dragState.stageW)
      : 0;

    const onMove = (e) => {
      const dxPct = ((e.clientX - dragState.startMouseX) / dragState.stageW) * 100;
      const dyPct = ((e.clientY - dragState.startMouseY) / dragState.stageH) * 100;
      let next = null;

      if (dragState.mode === 'move') {
        next = { x: dragState.startX + dxPct, y: dragState.startY + dyPct };
      } else {
        const { wSign, hSign } = CORNER_SIGNS[dragState.mode];
        // Lock-aspect engages only when (a) we know the asset's pixel
        // dimensions AND (b) the user is NOT holding Shift. Holding Shift
        // is the standard "break the lock" gesture across motion editors.
        const lockAspect = pctAspect > 0 && !e.shiftKey;

        let newW, newH;
        if (lockAspect) {
          // Project the user's drag onto a diagonal that preserves the
          // asset aspect: pick whichever delta dominates (in width-equivalent
          // units), drive the resize from it, derive the other dimension
          // from pctAspect. This feels natural — the corner tracks the
          // mouse along the dominant axis, the other axis follows.
          const wContribution = Math.abs(wSign * dxPct);
          const hContribution = Math.abs(hSign * dyPct) * pctAspect;
          if (wContribution >= hContribution) {
            newW = dragState.startW + wSign * dxPct;
            newH = newW / pctAspect;
          } else {
            newH = dragState.startH + hSign * dyPct;
            newW = newH * pctAspect;
          }
        } else {
          newW = dragState.startW + wSign * dxPct;
          newH = dragState.startH + hSign * dyPct;
        }

        // Clamp to MIN. When locked, re-derive the other dimension after
        // clamping so we don't break the aspect ratio at extreme shrink.
        newW = Math.max(MIN, newW);
        newH = Math.max(MIN, newH);
        if (lockAspect) {
          if (newW === MIN && newH * pctAspect > MIN) newH = MIN / pctAspect;
          if (newH === MIN && newW / pctAspect > MIN) newW = MIN * pctAspect;
        }

        // Anchor adjustments — west/north corners need x/y to track the
        // changing width/height so the OPPOSITE corner stays nailed in
        // place. (SE corner has no adjustments: NW is anchored, x/y don't
        // move regardless of resize direction.)
        let newX = dragState.startX;
        let newY = dragState.startY;
        if (wSign < 0) newX = dragState.startX + (dragState.startW - newW);
        if (hSign < 0) newY = dragState.startY + (dragState.startH - newH);

        next = { x: newX, y: newY, w: newW, h: newH };
      }

      if (!next) return;
      const rounded = {};
      for (const k of Object.keys(next)) rounded[k] = round1(next[k]);
      setZones(prev => prev.map((z, i) => i === dragState.zoneIdx ? { ...z, ...rounded } : z));
    };
    const onUp = () => setDragState(null);
    // Listen on window so dragging works even when the cursor leaves the
    // stage box (otherwise dragging fast escapes the rectangle and stalls).
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragState]);

  // Resolve upstream base video — prefer edges wired to base-video handle,
  // fall back to any unhandled edge with a usable url (back-compat for users
  // who wired before the second handle existed).
  let upstreamVideoUrl = '';
  let upstreamDuration = 0;
  const baseEdges = (edges || []).filter(e => e.target === id && (!e.targetHandle || e.targetHandle === 'base-video'));
  for (const edge of baseEdges) {
    const src = nodeOutputs?.[edge.source];
    if (!src) continue;
    // Skip asset-sequence outputs — those go through content-pool.
    if (src.type === 'asset-sequence') continue;
    if (src.url) {
      upstreamVideoUrl = src.url;
      upstreamDuration = src.duration || src.durationSec || 0;
      break;
    }
    if (src.videos?.length) {
      const done = src.videos.find(v => v.status === 'done' && v.url);
      if (done) {
        upstreamVideoUrl = done.url;
        upstreamDuration = done.duration || done.durationSec || 0;
        break;
      }
    }
  }

  // Aggregate the asset pool from every wired Asset Sequence node.
  const assetPool = [];
  const poolEdges = (edges || []).filter(e => e.target === id && e.targetHandle === 'content-pool');
  for (const edge of poolEdges) {
    const src = nodeOutputs?.[edge.source];
    if (!src?.assets) continue;
    for (const a of src.assets) assetPool.push(a);
  }
  // Back-compat: a sequence wired to the only-existing base-video handle
  // still contributes to the pool (so users don't lose connections after
  // upgrading to two-handle UI).
  for (const edge of baseEdges) {
    const src = nodeOutputs?.[edge.source];
    if (src?.type === 'asset-sequence' && Array.isArray(src.assets)) {
      for (const a of src.assets) assetPool.push(a);
    }
  }

  const result = nodeOutputs?.[id] || {};
  const status = result.status || 'idle';
  const finalUrl = result.url || '';
  const error = result.error || '';

  const updateZone = (idx, patch) => {
    setZones(prev => prev.map((z, i) => i === idx ? { ...z, ...patch } : z));
  };

  // Probe an inline contentUrl on blur so the visual editor can lock-aspect
  // resize against the asset's pixel dimensions. Asset-linked zones don't
  // need this — they inherit dimensions from the linked asset directly.
  const probeZone = (idx) => {
    const z = zones[idx];
    if (!z || z.sourceAssetId) return;          // linked zones use asset dims
    if (z.type !== 'image' && z.type !== 'video' && z.type !== 'hyperframes') return;
    probeMediaDimensions(z.contentUrl, z.type).then((dim) => {
      if (!dim) return;
      setZones(prev => prev.map(x => x.id === z.id
        ? { ...x, contentWidth: dim.width, contentHeight: dim.height }
        : x));
    });
  };

  // Default sequencing: new zone starts 1s after the latest end, runs for 5s.
  // Removes the friction of manually computing "where did the last one end +
  // when should this one start" each time. Manually edited values stick —
  // this only fires at zone creation.
  const addZone = () => setZones(prev => {
    const maxEnd = prev.length
      ? Math.max(...prev.map(z => Number(z.endSec) || 0))
      : -1;
    const startSec = prev.length ? +(maxEnd + 1).toFixed(2) : 0;
    const endSec = +(startSec + 5).toFixed(2);
    return [...prev, { ...CARTESIAN_DEFAULT_ZONE(), startSec, endSec }];
  });
  // Bulk: re-space all existing zones to 5s duration, 1s gap, in current
  // array order. For when the timing has drifted and you want to reset.
  const autoSequenceZones = () => setZones(prev => prev.map((z, i) => {
    const startSec = i * 6;          // 5s duration + 1s gap
    const endSec = startSec + 5;
    return { ...z, startSec, endSec };
  }));
  const removeZone = (idx) => {
    setZones(prev => prev.filter((_, i) => i !== idx));
    // Drop selection if the removed zone was selected; shift the index if
    // it pointed past the removed slot.
    setSelectedZoneIdx((prev) => {
      if (prev == null) return prev;
      if (prev === idx) return null;
      return prev > idx ? prev - 1 : prev;
    });
  };

  // When selection changes (typically via a rectangle click), bring the
  // matching form row into view. `block: 'nearest'` makes this a no-op
  // when the row is already visible — avoids jumpy auto-scroll on every
  // click within the form panel itself.
  useEffect(() => {
    if (selectedZoneIdx == null) return;
    const z = zones[selectedZoneIdx];
    if (!z) return;
    const el = zoneRowRefs.current[z.id];
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedZoneIdx]);

  const canRender = !!upstreamVideoUrl && zones.length > 0 && status !== 'rendering';

  const dotColor = status === 'rendering' ? '#e85d75'
    : finalUrl ? '#00FFFF'
    : status === 'error' ? '#e74c3c'
    : canRender ? '#a855f7'
    : '#555';

  return (
    // `nowheel` lets the wheel scroll inside this node instead of triggering
    // React Flow's canvas zoom. The Cartesian node is tall (visual editor +
    // multiple zones), so this matches user intent — wheel over the node = scroll
    // the form, wheel over empty canvas = zoom. Same pattern used by FFmpeg /
    // Chroma Composite nodes.
    <div className="cv-node cv-cartesian nowheel" style={{ '--status-color': dotColor, '--node-accent': '#a855f7' }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="base-video" style={{ top: '40%' }} />
      <Handle type="target" position={Position.Left} id="content-pool" style={{ top: '70%' }} />

      <div className="cv-cartesian-header">
        <div className="cv-cartesian-dot" />
        <span className="cv-cartesian-title">Cartesian Composer</span>
        <span className="cv-cartesian-badge">{zones.length} zone{zones.length === 1 ? '' : 's'}</span>
      </div>

      <div className="cv-cartesian-baseinfo">
        <span className={`cv-cartesian-input-dot ${upstreamVideoUrl ? 'active' : ''}`} />
        <span>
          {upstreamVideoUrl
            ? `base wired (${upstreamDuration ? upstreamDuration.toFixed(1) + 's' : '?s'})`
            : 'wire a base video into the left handle'}
        </span>
      </div>
      <div className="cv-cartesian-baseinfo">
        <span className={`cv-cartesian-input-dot ${assetPool.length > 0 ? 'active' : ''}`} />
        <span>
          {assetPool.length > 0
            ? `${assetPool.length} asset${assetPool.length === 1 ? '' : 's'} in pool`
            : 'wire an Asset Sequence for content reuse (optional)'}
        </span>
      </div>

      {upstreamVideoUrl && (
        <label
          className="cv-cartesian-base-loop nodrag"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          title="If the base video is shorter than your overlay sequence, repeat it from the start. Without this, the base freezes on its last frame and the overlays keep running over a still image. Also fixes the freeze-on-last-frame issue for files whose container metadata reports a longer duration than the codec actually has."
        >
          <input
            type="checkbox"
            className="nodrag"
            checked={baseLoop}
            onChange={(e) => { e.stopPropagation(); setBaseLoop(e.target.checked); }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
          <span>Repeat base video if shorter than overlays</span>
        </label>
      )}

      {/* Visual editor — togglable panel for thumbnail + scrubber. Step 1
          ships this scaffold; later steps add zone overlay rectangles that
          read/write the same `zones` state the typed form below uses. */}
      {upstreamVideoUrl && (
        <button
          className="cv-cartesian-visual-toggle nodrag"
          onClick={(e) => { e.stopPropagation(); setVisualOpen((v) => !v); }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {visualOpen ? '▾  Hide visual editor' : '▸  Visual editor'}
        </button>
      )}

      {visualOpen && upstreamVideoUrl && (
        <div className="cv-cartesian-visual">
          <div ref={stageRef} className="cv-cartesian-visual-stage">
            {/* Overlay rectangles: one per zone, positioned by % coords.
                Layer is pointer-events: none so the video stays scrub-able
                between rectangles; rectangles themselves opt back in to
                receive mousedown for drag. */}
            <video
              ref={videoRef}
              // Resolve any non-http source through the existing local-video
              // endpoint so the browser can fetch Windows / project-relative
              // paths the same way the server can.
              src={(() => {
                const u = String(upstreamVideoUrl);
                if (/^https?:\/\//.test(u)) return u;
                return `http://localhost:3001/api/local-video?path=${encodeURIComponent(u)}`;
              })()}
              muted
              preload="metadata"
              className="cv-cartesian-visual-video nodrag"
              onLoadedMetadata={(e) => {
                setVideoDuration(e.currentTarget.duration || 0);
                setVideoLoaded(true);
              }}
              onError={() => { setVideoLoaded(false); setVideoDuration(0); }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            />
            <div className="cv-cartesian-visual-overlay">
              {zones.map((zone, idx) => {
                // Resolve effective type: asset-linked zones inherit the
                // asset's type so the color matches what'll actually render.
                let effType = zone.type;
                let lockW = 0, lockH = 0;
                if (zone.sourceAssetId) {
                  const a = assetPool.find(x => x.id === zone.sourceAssetId);
                  if (a) {
                    effType = a.type;
                    lockW = a.width || 0;
                    lockH = a.height || 0;
                  }
                } else {
                  lockW = zone.contentWidth || 0;
                  lockH = zone.contentHeight || 0;
                }
                // Simplified aspect label when probe data is available —
                // gives the user a "lock active, here's the ratio" hint
                // without taking up much pixel real estate.
                let aspectLabel = '';
                if (lockW > 0 && lockH > 0) {
                  const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
                  const g = gcd(Math.round(lockW), Math.round(lockH));
                  aspectLabel = `${Math.round(lockW / g)}:${Math.round(lockH / g)}`;
                }
                const color = CARTESIAN_TYPE_COLORS[effType] || '#a855f7';
                const isDragging = dragState && dragState.zoneIdx === idx;
                const isSelected = selectedZoneIdx === idx;
                // Time-aware visibility: zone is "active" when scrubTime
                // falls within [startSec, endSec) — matches the comp's
                // gating logic exactly. Inactive zones still render but
                // dimmed, so dragging/positioning a zone whose window is
                // far from the current scrub time still feels visible.
                // Fallback: if the video hasn't loaded yet, treat all
                // zones as active so users see them immediately.
                const isActive = !videoLoaded
                  || (scrubTime >= (Number(zone.startSec) || 0) && scrubTime < (Number(zone.endSec) || 0));
                return (
                  <div
                    key={zone.id}
                    className={`cv-cartesian-visual-rect nodrag${isDragging ? ' dragging' : ''}${isActive ? '' : ' inactive'}${isSelected ? ' selected' : ''}`}
                    style={{
                      left:   `${zone.x}%`,
                      top:    `${zone.y}%`,
                      width:  `${zone.w}%`,
                      height: `${zone.h}%`,
                      borderColor: color,
                      background: `${color}22`,
                    }}
                    onMouseDown={(e) => onRectMouseDown(e, idx)}
                    onClick={(e) => e.stopPropagation()}
                    title={aspectLabel
                      ? `Drag to move zone #${idx + 1}\nResize handles lock to ${aspectLabel} — hold Shift to free-resize`
                      : `Drag to move zone #${idx + 1}`}
                  >
                    <span
                      className="cv-cartesian-visual-rect-label"
                      style={{ background: color }}
                    >
                      #{idx + 1} · {effType}{aspectLabel ? ` · ${aspectLabel}` : ''}
                    </span>
                    {/* Four corner resize handles. Each corner anchors the
                        opposite corner: pulling SE grows w/h, NW grows up
                        and to the left (changes x, y, w, h together). */}
                    {['nw', 'ne', 'sw', 'se'].map((corner) => (
                      <div
                        key={corner}
                        className={`cv-cartesian-visual-rect-handle ${corner} nodrag`}
                        onMouseDown={(e) => onHandleMouseDown(e, idx, corner)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="cv-cartesian-visual-scrubber">
            <input
              type="range"
              className="nodrag"
              min={0}
              max={videoDuration || 0}
              step={0.01}
              value={scrubTime}
              disabled={!videoLoaded}
              onChange={(e) => {
                e.stopPropagation();
                const t = +e.target.value;
                setScrubTime(t);
                if (videoRef.current) videoRef.current.currentTime = t;
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            />
            <span className="cv-cartesian-visual-time">
              {scrubTime.toFixed(2)}s{videoDuration > 0 ? ` / ${videoDuration.toFixed(1)}s` : ''}
            </span>
          </div>
        </div>
      )}

      <div className="cv-cartesian-zones">
        {zones.map((zone, idx) => {
          const linkedAsset = zone.sourceAssetId ? assetPool.find(a => a.id === zone.sourceAssetId) : null;
          const effectiveType = linkedAsset?.type || zone.type;
          const isSelectedRow = selectedZoneIdx === idx;
          return (
          <div
            key={zone.id}
            ref={(el) => { if (el) zoneRowRefs.current[zone.id] = el; else delete zoneRowRefs.current[zone.id]; }}
            className={`cv-cartesian-zone${linkedAsset ? ' cv-cartesian-zone-linked' : ''}${isSelectedRow ? ' cv-cartesian-zone-selected' : ''}`}
            onClick={(e) => { e.stopPropagation(); setSelectedZoneIdx(idx); }}
          >
            {assetPool.length > 0 && (
              <div className="cv-cartesian-zone-row">
                <span className="cv-cartesian-zone-label">src</span>
                <select
                  className="cv-cartesian-input cv-cartesian-input-source nodrag"
                  value={zone.sourceAssetId || ''}
                  onChange={(e) => {
                    e.stopPropagation();
                    const newId = e.target.value || null;
                    const a = newId ? assetPool.find(x => x.id === newId) : null;
                    // If the asset carries timing hints (Pinner does — its
                    // anchorSec is the word's spoken-at timestamp), snap the
                    // zone's startSec/endSec to honor them. Operators can
                    // still adjust manually after.
                    const patch = { sourceAssetId: newId };
                    if (a && Number.isFinite(a.anchorSec)) {
                      patch.startSec = +Number(a.anchorSec).toFixed(2);
                      if (Number.isFinite(a.durationSec)) {
                        patch.endSec = +(Number(a.anchorSec) + Number(a.durationSec)).toFixed(2);
                      }
                    }
                    // Asset can hint a default frame position (e.g., Pinner's
                    // transparent overlays want full-frame, not the default
                    // 30%x12% corner). Operator can resize after.
                    if (a) {
                      if (Number.isFinite(a.defaultX)) patch.x = a.defaultX;
                      if (Number.isFinite(a.defaultY)) patch.y = a.defaultY;
                      if (Number.isFinite(a.defaultW)) patch.w = a.defaultW;
                      if (Number.isFinite(a.defaultH)) patch.h = a.defaultH;
                    }
                    updateZone(idx, patch);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <option value="">— Inline —</option>
                  {assetPool.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                      {Number.isFinite(a.anchorSec) ? ` @ ${a.anchorSec.toFixed(2)}s` : ''}
                      {` (${a.type})`}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="cv-cartesian-zone-row">
              <span className="cv-cartesian-zone-label">#{idx + 1}</span>
              <select
                className="cv-cartesian-input cv-cartesian-input-type nodrag"
                value={effectiveType}
                disabled={!!linkedAsset}
                title={linkedAsset ? `type from asset: ${linkedAsset.label}` : 'zone content type'}
                onChange={(e) => {
                  e.stopPropagation();
                  // Switching types invalidates the previous probe (image
                  // and video probes use different APIs). Clear so a stale
                  // 16:9 image dim doesn't leak into a portrait video.
                  updateZone(idx, { type: e.target.value, contentWidth: 0, contentHeight: 0 });
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {CARTESIAN_ZONE_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              <button
                className="cv-cartesian-zone-remove"
                onClick={(e) => { e.stopPropagation(); removeZone(idx); }}
                title="Remove zone"
              >×</button>
            </div>

            {(effectiveType === 'image' || effectiveType === 'video' || effectiveType === 'hyperframes') && (
              <div className="cv-cartesian-zone-row cv-cartesian-zone-fit-row">
                <span className="cv-cartesian-zone-sublabel">fit</span>
                <select
                  className="cv-cartesian-input nodrag"
                  value={zone.contentFit || 'contain'}
                  onChange={(e) => { e.stopPropagation(); updateZone(idx, { contentFit: e.target.value }); }}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="contain = fit the whole asset inside the zone, letterbox if aspect doesn't match (default — no silent cropping). cover = fill the zone, crop overflow."
                >
                  <option value="contain">contain (fit, may letterbox)</option>
                  <option value="cover">cover (fill, may crop)</option>
                </select>
                {(effectiveType === 'video' || effectiveType === 'hyperframes') && (
                  <label
                    className="cv-cartesian-zone-loop nodrag"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    title="Loop the asset across the zone window — fixes the freeze-on-last-frame when asset is shorter than the zone"
                  >
                    <input
                      type="checkbox"
                      className="nodrag"
                      checked={zone.loop !== false}
                      onChange={(e) => { e.stopPropagation(); updateZone(idx, { loop: e.target.checked }); }}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    />
                    loop
                  </label>
                )}
              </div>
            )}

            <div className="cv-cartesian-grid">
              <label>x%<input type="number" className="nodrag" value={zone.x} min={0} max={100}
                onChange={(e) => { e.stopPropagation(); updateZone(idx, { x: +e.target.value }); }}
                onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} /></label>
              <label>y%<input type="number" className="nodrag" value={zone.y} min={0} max={100}
                onChange={(e) => { e.stopPropagation(); updateZone(idx, { y: +e.target.value }); }}
                onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} /></label>
              <label>w%<input type="number" className="nodrag" value={zone.w} min={1} max={100}
                onChange={(e) => { e.stopPropagation(); updateZone(idx, { w: +e.target.value }); }}
                onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} /></label>
              <label>h%<input type="number" className="nodrag" value={zone.h} min={1} max={100}
                onChange={(e) => { e.stopPropagation(); updateZone(idx, { h: +e.target.value }); }}
                onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} /></label>
            </div>

            <div className="cv-cartesian-grid cv-cartesian-grid-2">
              <label>start s<input type="number" className="nodrag" value={zone.startSec} min={0} step={0.1}
                onChange={(e) => { e.stopPropagation(); updateZone(idx, { startSec: +e.target.value }); }}
                onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} /></label>
              <label>end s<input type="number" className="nodrag" value={zone.endSec} min={0} step={0.1}
                onChange={(e) => { e.stopPropagation(); updateZone(idx, { endSec: +e.target.value }); }}
                onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} /></label>
            </div>

            <div className="cv-cartesian-grid cv-cartesian-grid-2">
              <label>fade in s<input type="number" className="nodrag" value={zone.fadeIn || 0} min={0} step={0.05}
                onChange={(e) => { e.stopPropagation(); updateZone(idx, { fadeIn: Math.max(0, +e.target.value) }); }}
                onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} /></label>
              <label>fade out s<input type="number" className="nodrag" value={zone.fadeOut || 0} min={0} step={0.05}
                onChange={(e) => { e.stopPropagation(); updateZone(idx, { fadeOut: Math.max(0, +e.target.value) }); }}
                onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} /></label>
            </div>

            <div className="cv-cartesian-grid cv-cartesian-grid-2">
              <label title="Motion layered on the fade-in window. 'fade' = opacity-only (v1 default). Picking a slide/scale auto-bumps fade in to 0.4s if you hadn't set one — the motion needs a duration to play.">entry
                <select
                  className="nodrag"
                  value={(zone.entry && zone.entry.kind) || 'fade'}
                  onChange={(e) => {
                    e.stopPropagation();
                    const kind = e.target.value;
                    const patch = { entry: { kind } };
                    // Motion needs a non-zero window. Auto-bump fadeIn so
                    // picking "slide ↑" instantly does what it says.
                    if (kind !== 'fade' && (!zone.fadeIn || zone.fadeIn <= 0)) {
                      patch.fadeIn = 0.4;
                    }
                    updateZone(idx, patch);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {CARTESIAN_MOTION_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
                </select>
              </label>
              <label title="Motion layered on the fade-out window. 'fade' = opacity-only (v1 default). Picking a slide/scale auto-bumps fade out to 0.4s if you hadn't set one.">exit
                <select
                  className="nodrag"
                  value={(zone.exit && zone.exit.kind) || 'fade'}
                  onChange={(e) => {
                    e.stopPropagation();
                    const kind = e.target.value;
                    const patch = { exit: { kind } };
                    if (kind !== 'fade' && (!zone.fadeOut || zone.fadeOut <= 0)) {
                      patch.fadeOut = 0.4;
                    }
                    updateZone(idx, patch);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {CARTESIAN_MOTION_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
                </select>
              </label>
            </div>

            {linkedAsset ? (
              <div className="cv-cartesian-zone-linked-info">
                using <strong>{linkedAsset.label}</strong>
                {linkedAsset.type === 'text'
                  ? <> — “{(linkedAsset.text || '').slice(0, 40)}{(linkedAsset.text || '').length > 40 ? '…' : ''}”</>
                  : linkedAsset.url
                    ? <> — <code>{linkedAsset.url.split('/').pop().slice(0, 40)}</code></>
                    : <> — <em style={{ color: '#e74c3c' }}>asset has no content</em></>}
              </div>
            ) : (
              <>
                {(zone.type === 'image' || zone.type === 'video' || zone.type === 'hyperframes') && (
                  <input
                    type="text"
                    className="cv-cartesian-input cv-cartesian-input-url nodrag"
                    placeholder={zone.type === 'image' ? 'image URL or absolute path' : 'video URL or absolute path'}
                    value={zone.contentUrl}
                    onChange={(e) => {
                      e.stopPropagation();
                      // Drop stale dims while typing — they're about to be wrong.
                      // The probe re-runs on blur and re-populates them.
                      updateZone(idx, { contentUrl: e.target.value, contentWidth: 0, contentHeight: 0 });
                    }}
                    onBlur={(e) => { e.stopPropagation(); probeZone(idx); }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  />
                )}

                {zone.type === 'text' && (
                  <>
                    <input
                      type="text"
                      className="cv-cartesian-input cv-cartesian-input-text nodrag"
                      placeholder="text content"
                      value={zone.contentText}
                      onChange={(e) => { e.stopPropagation(); updateZone(idx, { contentText: e.target.value }); }}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    />
                    <div className="cv-cartesian-grid cv-cartesian-grid-3">
                      <label>color<input type="text" className="nodrag" value={zone.contentColor}
                        onChange={(e) => { e.stopPropagation(); updateZone(idx, { contentColor: e.target.value }); }}
                        onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} /></label>
                      <label>bg<input type="text" className="nodrag" value={zone.contentBg}
                        onChange={(e) => { e.stopPropagation(); updateZone(idx, { contentBg: e.target.value }); }}
                        onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} /></label>
                      <label>size<input type="number" className="nodrag" value={zone.contentFontSize} min={8} max={200}
                        onChange={(e) => { e.stopPropagation(); updateZone(idx, { contentFontSize: +e.target.value }); }}
                        onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} /></label>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        );})}
      </div>

      <div className="cv-cartesian-zone-actions">
        <button
          className="cv-cartesian-add"
          onClick={(e) => { e.stopPropagation(); addZone(); }}
        >+ Add zone</button>
        <button
          className="cv-cartesian-resequence"
          disabled={zones.length < 2}
          title="Re-space all zones to 5s duration with 1s gaps, in current order"
          onClick={(e) => { e.stopPropagation(); autoSequenceZones(); }}
        >↻ Auto-sequence</button>
        <button
          className="cv-cartesian-syncpool"
          disabled={assetPool.length === 0}
          title="Create one zone per asset in the pool, each linked + auto-sequenced. Existing zones with content are preserved; only assets without a sourcing zone get new zones."
          onClick={(e) => {
            e.stopPropagation();
            setZones(prev => {
              // Canonical starter — single default zone, no user edits.
              // In that case, REPLACE with one zone per asset. Otherwise
              // APPEND zones only for assets that aren't already sourced.
              const isStarter = prev.length === 1
                && !prev[0].sourceAssetId
                && !prev[0].contentUrl
                && !prev[0].contentText;
              const claimed = new Set(prev.filter(z => z.sourceAssetId).map(z => z.sourceAssetId));
              const baseZones = isStarter ? [] : prev;
              const fresh = assetPool
                .filter(a => !claimed.has(a.id))
                .map((a, idx) => {
                  const slot = baseZones.length + idx;
                  const startSec = slot * 6;
                  return {
                    ...CARTESIAN_DEFAULT_ZONE(),
                    sourceAssetId: a.id,
                    type: a.type || 'image',
                    startSec,
                    endSec: startSec + 5,
                  };
                });
              return [...baseZones, ...fresh];
            });
          }}
        >📥 Sync from pool</button>
      </div>

      <button
        className="cv-btn cv-btn-cartesian"
        disabled={!canRender}
        onClick={(e) => {
          e.stopPropagation();
          // Expand asset references into concrete content before sending. The
          // server endpoint stays asset-agnostic — it only sees fully-resolved
          // zones with contentUrl/contentText.
          const expandedZones = zones.map(z => {
            if (!z.sourceAssetId) return z;
            const a = assetPool.find(x => x.id === z.sourceAssetId);
            if (!a) return z;  // asset went away — fall back to inline fields
            return {
              ...z,
              type: a.type,
              contentUrl: a.url || z.contentUrl,
              contentText: a.text || z.contentText,
              contentColor: a.color || z.contentColor,
              contentBg: a.bg || z.contentBg,
              contentFontSize: a.fontSize || z.contentFontSize,
            };
          });
          onCartesianRender(id, { videoUrl: upstreamVideoUrl, zones: expandedZones, durationSec: upstreamDuration, baseLoop });
        }}
      >
        {status === 'rendering' ? 'Rendering...' : finalUrl ? 'Re-render' : 'Render composite'}
      </button>

      {finalUrl && (
        <div className="cv-cartesian-result">
          <a
            href={`http://localhost:3001${finalUrl}`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            open final mp4
          </a>
        </div>
      )}

      {error && <div className="cv-cartesian-error">{error}</div>}

      <Handle type="source" position={Position.Right} id="composite-out" />
    </div>
  );
}

/* ===== PIXEL FORGE NODE — Midjourney-ready pixel-art prompt generator ===== */
function PixelForgeNode({ id }) {
  const { edges, nodeOutputs, onPixelForgeGenerate } = useContext(CanvasCtx);
  const [subject, setSubject] = useState('');
  const [bitDepth, setBitDepth] = useState('16');
  const [style, setStyle] = useState('none');
  const [assetType, setAssetType] = useState('background');
  const [viewAngle, setViewAngle] = useState('default');
  const [quality, setQuality] = useState(['clean']);
  const [viewIndex, setViewIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  // Upstream subject input — wire any script/prompt source to drive the subject
  const upstreamSubject = (() => {
    const inEdge = edges?.find(e => e.target === id);
    if (!inEdge) return '';
    const src = nodeOutputs?.[inEdge.source];
    return (src?.script || src?.prompt || src?.caption || src?.hook || '').trim();
  })();

  const activeSubject = (upstreamSubject || subject).trim();
  const canGenerate = activeSubject.length > 0;

  const toggleQuality = (qid) => {
    setQuality(prev => prev.includes(qid) ? prev.filter(q => q !== qid) : [...prev, qid]);
  };

  const result = nodeOutputs?.[id] || {};
  const prompts = result.prompts || [];
  const safeIndex = Math.min(viewIndex, Math.max(prompts.length - 1, 0));
  const current = prompts[safeIndex];

  const copy = async () => {
    if (!current) return;
    await navigator.clipboard.writeText(current.prompt).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Group style presets by category for the dropdown
  const styleByCat = {};
  pxStylePresets.forEach(s => {
    (styleByCat[s.category] = styleByCat[s.category] || []).push(s);
  });

  return (
    <div className="cv-node cv-pixel-forge" style={{ '--status-color': prompts.length > 0 ? '#00FFFF' : canGenerate ? '#f97316' : '#555', '--node-accent': '#f97316' }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="subject-in" />

      <div className="cv-pixel-forge-header">
        <span className="cv-pixel-forge-dot" />
        <span className="cv-pixel-forge-title">PIXEL FORGE</span>
        <span className="cv-pixel-forge-badge">Midjourney</span>
      </div>

      {/* Subject — upstream wins, freeform fallback */}
      {!upstreamSubject && (
        <textarea
          className="cv-gami-freeform-input" rows={2}
          placeholder="Subject — e.g. 'a wizard in a cave with a glowing staff'"
          value={subject}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); setSubject(e.target.value); }}
        />
      )}
      {upstreamSubject && (
        <div className="cv-carousel-inputs">
          <div className="cv-carousel-input-row">
            <span className="cv-carousel-input-dot active" />
            <span>Subject from upstream: "{upstreamSubject.slice(0, 60)}{upstreamSubject.length > 60 ? '…' : ''}"</span>
          </div>
        </div>
      )}

      {/* Bit-depth: 4-button row */}
      <div className="cv-pixel-forge-row">
        <span className="cv-pixel-forge-label">Bit</span>
        {pxBitDepths.map(d => (
          <button
            key={d.id}
            className={`cv-pixel-forge-pill ${bitDepth === d.id ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setBitDepth(d.id); }}
            title={`${d.era} · ${d.console}`}
          >{d.label}</button>
        ))}
      </div>

      {/* Style preset (grouped by category) */}
      <div className="cv-pixel-forge-row">
        <span className="cv-pixel-forge-label">Style</span>
        <select className="cv-blotato-select" value={style}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); setStyle(e.target.value); }}
          style={{ flex: 1 }}>
          {Object.entries(styleByCat).map(([cat, items]) => (
            <optgroup key={cat} label={cat}>
              {items.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Asset type */}
      <div className="cv-pixel-forge-row">
        <span className="cv-pixel-forge-label">Asset</span>
        <select className="cv-blotato-select" value={assetType}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); setAssetType(e.target.value); }}
          style={{ flex: 1 }}>
          {pxAssetTypes.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
      </div>

      {/* View angle */}
      <div className="cv-pixel-forge-row">
        <span className="cv-pixel-forge-label">View</span>
        <select className="cv-blotato-select" value={viewAngle}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); setViewAngle(e.target.value); }}
          style={{ flex: 1 }}>
          {pxViewAngles.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
      </div>

      {/* Quality multi-select chips */}
      <div className="cv-pixel-forge-row cv-pixel-forge-quality">
        {pxQualityMods.map(q => (
          <button
            key={q.id}
            className={`cv-pixel-forge-chip ${quality.includes(q.id) ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); toggleQuality(q.id); }}
          >{q.label}</button>
        ))}
      </div>

      {/* Generate */}
      <button className="cv-btn cv-btn-pixel-forge"
        disabled={!canGenerate}
        onClick={(e) => { e.stopPropagation(); onPixelForgeGenerate(id, { subject: activeSubject, bitDepth, style, assetType, viewAngle, quality }); setExpanded(true); }}>
        {prompts.length > 0 ? 'Regenerate 3 Variations' : 'Forge 3 Variations'}
      </button>

      {/* Viewer */}
      {prompts.length > 0 && (
        <button className="cv-gami-viewer-toggle" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
          {expanded ? 'Hide Prompts' : 'View Prompts'} ({prompts.length})
        </button>
      )}

      {expanded && prompts.length > 0 && (
        <div className="cv-gami-viewer">
          <div className="cv-gami-viewer-nav">
            <button className="cv-gami-nav-btn" disabled={safeIndex === 0}
              onClick={(e) => { e.stopPropagation(); setViewIndex(i => Math.max(0, i - 1)); }}>&#9664;</button>
            <span className="cv-gami-nav-label">Variation {safeIndex + 1} / {prompts.length} · {current?.mood}</span>
            <button className="cv-gami-nav-btn" disabled={safeIndex >= prompts.length - 1}
              onClick={(e) => { e.stopPropagation(); setViewIndex(i => Math.min(prompts.length - 1, i + 1)); }}>&#9654;</button>
          </div>
          <div className="cv-pixel-forge-prompt-box">{current?.prompt || ''}</div>
          <button className="cv-btn cv-btn-sm" onClick={(e) => { e.stopPropagation(); copy(); }}>
            {copied ? 'Copied!' : 'Copy Prompt'}
          </button>
        </div>
      )}

      <Handle type="source" position={Position.Right} id="prompt-out" />
    </div>
  );
}

/* ===== 16-GAMI SPRITE FORGE — sectioned prompt builder for 3 layouts ===== */
//
// Three modes — World Build / Hero Card / Asset Gallery. Each mode shows its
// own sectioned form (no raw JSON authoring). The 16-gami anchor pattern
// (aesthetic_constraints / sculpture_composition / technical_notes) is
// assembled internally and routed to kie.ai under either Nano Banana Pro or
// GPT Image-2. Single target handle on the left for theme/subject override;
// two source handles on the right (prompt JSON + image URL) for downstream
// composition (Cartesian, Carousel, ChromaComposite, etc.).
//
// Why sectioned-over-textarea: a constrained form prevents the user from
// leaving slots blank or describing the wrong things. Schema-as-UI beats
// schema-as-text-blob, especially for someone who hasn't internalized the
// anchor pattern yet.

function SFWiredIndicator({ label }) {
  return (
    <div className="cv-sf-wired">
      ─◄ wired from <strong>[{label}]</strong>
    </div>
  );
}

function SpriteForgeNode({ id }) {
  const { edges, nodeOutputs, onSpriteForgeGenerate, setChunkOutput, resumeKiePoll, mutateNodeOutput } = useContext(CanvasCtx);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('kie-api-key') || '');
  const [mode, setMode] = useState('hero-card');
  const [provider, setProvider] = useState('nano-banana-pro');
  const [aspectRatio, setAspectRatio] = useState('2:3');
  const [palette, setPalette] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);

  const [wbTheme, setWbTheme] = useState('');
  const [wbTone, setWbTone] = useState('');
  const [wbCenterpiece, setWbCenterpiece] = useState('');
  const [wbAppTitle, setWbAppTitle] = useState('');

  const [hcTitle, setHcTitle] = useState('');
  const [hcSubtitle, setHcSubtitle] = useState('');
  const [hcHeroDesc, setHcHeroDesc] = useState('');
  const [hcStats, setHcStats] = useState(SF_DEFAULT_STATS);
  const [hcSidebar, setHcSidebar] = useState(SF_DEFAULT_SIDEBAR);
  const [hcParty, setHcParty] = useState(SF_DEFAULT_PARTY);
  const [hcActions, setHcActions] = useState(SF_DEFAULT_ACTIONS);
  const [hcTagline1, setHcTagline1] = useState('');
  const [hcTagline2, setHcTagline2] = useState('');
  const [hcEmblem, setHcEmblem] = useState('');
  const [hcCorner, setHcCorner] = useState('COMING SOON');

  const [agTheme, setAgTheme] = useState('');
  const [agBands, setAgBands] = useState(SF_DEFAULT_BANDS);

  const saveKey = (v) => { setApiKey(v); localStorage.setItem('kie-api-key', v); };

  // Upstream wire seed — first incoming edge contributes its script/prompt/caption
  // as a theme override for the current mode (per CLAUDE.md: no useMemo on
  // nodeOutputs consumers — compute fresh every render via IIFE).
  const upstreamSubject = (() => {
    const inEdge = edges?.find(e => e.target === id && e.targetHandle !== 'chunks-in');
    if (!inEdge) return '';
    const src = nodeOutputs?.[inEdge.source];
    return (src?.script || src?.prompt || src?.caption || src?.hook || '').trim();
  })();

  // Walk all incoming edges, route any source emitting __chunkType into
  // the wiredChunks map. Computed every render — NO useMemo (CLAUDE.md
  // rule: nodeOutputs consumers compute fresh).
  const wiredChunks = (() => {
    const map = {};
    for (const edge of (edges || []).filter(e => e.target === id)) {
      const src = nodeOutputs?.[edge.source];
      if (src?.__chunkType) map[src.__chunkType] = src;
    }
    return map;
  })();

  const isWired = (chunkType) => Boolean(wiredChunks[chunkType]);
  const wiredSourceShort = (chunkType) => {
    const edge = (edges || []).find(e => e.target === id && nodeOutputs?.[e.source]?.__chunkType === chunkType);
    return edge ? String(edge.source).slice(0, 8) : '';
  };

  // Local copy of pickEmittedUrl — keeps SF node self-contained for interaction handlers.
  function pickEmittedUrlLocal(results, pinned) {
    if (pinned) {
      const p = results.find(r => r.id === pinned && r.status === 'done');
      if (p) return p.url;
    }
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i].status === 'done') return results[i].url;
    }
    return '';
  }

  const pinSlot = (slotId) => mutateNodeOutput(id, (node) => {
    const nextPinned = node.pinned === slotId ? null : slotId;
    return { ...node, pinned: nextPinned, url: pickEmittedUrlLocal(node.results || [], nextPinned) };
  });

  const deleteSlot = (slotId) => mutateNodeOutput(id, (node) => {
    const results = (node.results || []).filter(r => r.id !== slotId);
    const pinned = node.pinned === slotId ? null : node.pinned;
    return { ...node, results, pinned, url: pickEmittedUrlLocal(results, pinned) };
  });

  const clearQueue = () => mutateNodeOutput(id, (node) => ({ ...node, queue: [] }));

  // Reconcile aspect ratio if the user flipped providers and current AR isn't
  // valid for the new provider — fall back to first allowed option silently
  // (no setState in render; just use the safe value when sending).
  const arOptions = SF_AR_OPTIONS[provider];
  const safeAr = arOptions.includes(aspectRatio) ? aspectRatio : arOptions[0];

  let assembled = '';
  if (mode === 'world-build') {
    const wb = wiredChunks['sf-world-identity'] || {};
    assembled = buildWorldBuildPrompt({
      theme:       wb.theme       || upstreamSubject || wbTheme,
      tone:        wb.tone        || wbTone,
      centerpiece: wb.centerpiece || wbCenterpiece,
      appTitle:    wb.appTitle    || wbAppTitle,
      palette:     wiredChunks['sf-palette']?.palette || palette,
      ar:          safeAr,
    });
  } else if (mode === 'hero-card') {
    const hi = wiredChunks['sf-hero-identity'] || {};
    const tg = wiredChunks['sf-taglines']      || {};
    assembled = buildHeroCardPrompt({
      title:    hi.title    || hcTitle,
      subtitle: hi.subtitle || hcSubtitle,
      heroDesc: hi.heroDesc || upstreamSubject || hcHeroDesc,
      emblem:   hi.emblem   || hcEmblem,
      stats:    wiredChunks['sf-stats']?.stats     || hcStats,
      sidebar:  wiredChunks['sf-sidebar']?.sidebar || hcSidebar,
      party:    wiredChunks['sf-party']?.party     || hcParty,
      actions:  wiredChunks['sf-actions']?.actions || hcActions,
      tagline1: tg.taglineRed  || hcTagline1,
      tagline2: tg.taglineNavy || hcTagline2,
      corner:   tg.corner      || hcCorner,
      palette:  wiredChunks['sf-palette']?.palette || palette,
      ar:       safeAr,
    });
  } else {
    const ab = wiredChunks['sf-asset-bands'] || {};
    assembled = buildAssetGalleryPrompt({
      theme:   ab.theme || upstreamSubject || agTheme,
      bands:   ab.bands || agBands,
      palette: wiredChunks['sf-palette']?.palette || palette,
      ar:      safeAr,
    });
  }

  const result = nodeOutputs?.[id] || {};
  const headerStatusColor = result.batchStatus === 'generating' ? '#e85d75'
                          : result.batchStatus === 'done'       ? '#00FFFF'
                          :                                        '#a0392e';
  const canForge = !!apiKey && assembled.length > 100;

  // One-shot mount-time restore from localStorage.
  useEffect(() => {
    let stored = null;
    try {
      const raw = localStorage.getItem(`sf-state-${id}`);
      if (raw) stored = JSON.parse(raw);
    } catch { stored = null; }
    if (!stored) return;

    const { results = [], queue = [], pinned = null } = stored;
    const sanitized = results.map(r => (r.status === 'polling' && !r.taskId)
      ? { ...r, status: 'error', error: 'poll lost on refresh — re-run' }
      : r
    );

    const computeUrl = () => {
      if (pinned) {
        const p = sanitized.find(r => r.id === pinned && r.status === 'done');
        if (p) return p.url;
      }
      for (let i = sanitized.length - 1; i >= 0; i--) {
        if (sanitized[i].status === 'done') return sanitized[i].url;
      }
      return '';
    };

    const computedBatchStatus = sanitized.some(r => r.status === 'polling') || queue.length > 0
      ? 'generating'
      : sanitized.some(r => r.status === 'done') ? 'done'
      : sanitized.some(r => r.status === 'error') ? 'error'
      : 'idle';

    setChunkOutput(id, {
      results: sanitized,
      queue,
      pinned,
      batchStatus: computedBatchStatus,
      url: computeUrl(),
    });

    // Resume polling for in-flight slots with taskId.
    // Sequential: resume just the one polling slot (there should only be one).
    const kieKey = localStorage.getItem('kie-api-key') || '';
    for (const slot of sanitized) {
      if (slot.status === 'polling' && slot.taskId && kieKey) {
        setTimeout(() => resumeKiePoll(id, kieKey, slot.id), 100);
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Write-on-change persistence — debounced 250ms.
  const myOutput = nodeOutputs?.[id];
  useEffect(() => {
    if (!myOutput) return;
    // Persist only the durable fields. url + batchStatus are derived.
    const blob = JSON.stringify({
      results: myOutput.results || [],
      queue:   myOutput.queue   || [],
      pinned:  myOutput.pinned  ?? null,
    });
    const t = setTimeout(() => {
      try {
        localStorage.setItem(`sf-state-${id}`, blob);
        if (blob.length > 1_000_000) {
          console.warn(`[sprite-forge] node ${id} state blob exceeds 1MB — consider deleting old slots`);
        }
      } catch (e) {
        console.warn('[sprite-forge] localStorage write failed:', e.message);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [id, myOutput]);

  const handleForge = (e) => {
    e.stopPropagation();
    if (!canForge) return;
    onSpriteForgeGenerate(id, apiKey, assembled, provider, safeAr);
  };

  const updateListItem = (setter, index, patch) => {
    setter(prev => prev.map((item, i) => i === index ? { ...item, ...patch } : item));
  };
  const updateListString = (setter, index, value) => {
    setter(prev => prev.map((item, i) => i === index ? value : item));
  };

  return (
    <div className="cv-node cv-sprite-forge" style={{ '--status-color': headerStatusColor, '--node-accent': '#a0392e' }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="subject-in" style={{ top: '30%' }} />
      <Handle type="target" position={Position.Left} id="chunks-in" style={{ top: '70%' }} />

      <div className="cv-sf-header">
        <span className="cv-sf-dot" />
        <span className="cv-sf-title">SPRITE FORGE</span>
        <span className="cv-sf-badge">16-gami</span>
      </div>

      <div className="cv-sf-tab-row">
        {Object.entries(SF_MODE_LABELS).map(([m, label]) => (
          <button key={m}
            className={`cv-sf-tab ${mode === m ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setMode(m); }}
          >{label}</button>
        ))}
      </div>

      <div className="cv-sf-row">
        <div className="cv-sf-provider">
          <button
            className={`cv-sf-prov ${provider === 'nano-banana-pro' ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setProvider('nano-banana-pro'); }}
            title="Nano Banana Pro — origami/papercraft strength"
          >Nano Banana</button>
          <button
            className={`cv-sf-prov ${provider === 'image-2' ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setProvider('image-2'); }}
            title="GPT Image-2 — typography strength"
          >Image-2</button>
        </div>
        <select className="cv-blotato-select cv-sf-ar"
          value={safeAr}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); setAspectRatio(e.target.value); }}>
          {arOptions.map(ar => <option key={ar} value={ar}>{ar}</option>)}
        </select>
      </div>

      {upstreamSubject && (
        <div className="cv-sf-upstream">
          <span className="cv-sf-upstream-dot" /> upstream seed: "{upstreamSubject.slice(0, 60)}{upstreamSubject.length > 60 ? '…' : ''}"
        </div>
      )}

      {mode === 'world-build' && (
        <div className="cv-sf-form">
          {isWired('sf-world-identity')
            ? <SFWiredIndicator label={`World Identity:${wiredSourceShort('sf-world-identity')}`} />
            : <>
              <label className="cv-sf-label">Theme</label>
              <input className="cv-sf-input" placeholder="FarmVille homestead · cyberpunk plaza · undersea colony…"
                value={wbTheme} onClick={(e) => e.stopPropagation()}
                onChange={(e) => { e.stopPropagation(); setWbTheme(e.target.value); }} />
              <label className="cv-sf-label">Tone</label>
              <input className="cv-sf-input" placeholder="cozy · heroic · dark · playful…"
                value={wbTone} onClick={(e) => e.stopPropagation()}
                onChange={(e) => { e.stopPropagation(); setWbTone(e.target.value); }} />
              <label className="cv-sf-label">Centerpiece</label>
              <input className="cv-sf-input" placeholder="big red barn cluster · central shrine · shipwreck reef…"
                value={wbCenterpiece} onClick={(e) => e.stopPropagation()}
                onChange={(e) => { e.stopPropagation(); setWbCenterpiece(e.target.value); }} />
              <label className="cv-sf-label">App title (top-left card)</label>
              <input className="cv-sf-input" placeholder="Farmstead Voxels · Reef Builder · Skyline Voxels…"
                value={wbAppTitle} onClick={(e) => e.stopPropagation()}
                onChange={(e) => { e.stopPropagation(); setWbAppTitle(e.target.value); }} />
            </>}
        </div>
      )}

      {mode === 'hero-card' && (
        <div className="cv-sf-form">
          {isWired('sf-hero-identity')
            ? <SFWiredIndicator label={`Hero Identity:${wiredSourceShort('sf-hero-identity')}`} />
            : <>
              <label className="cv-sf-label">Title (large pixel-block)</label>
              <input className="cv-sf-input" placeholder="BRAVE BEYOND FATE · AGENT-VILLE…"
                value={hcTitle} onClick={(e) => e.stopPropagation()}
                onChange={(e) => { e.stopPropagation(); setHcTitle(e.target.value); }} />
              <label className="cv-sf-label">Subtitle</label>
              <input className="cv-sf-input" placeholder="A FANTASY ACTION RPG · BI-WEEKLY REVIEW…"
                value={hcSubtitle} onClick={(e) => e.stopPropagation()}
                onChange={(e) => { e.stopPropagation(); setHcSubtitle(e.target.value); }} />
              <label className="cv-sf-label">Hero description</label>
              <textarea className="cv-sf-textarea" rows={2}
                placeholder="blonde knight in navy plate, blue cape, oversized greatsword tip-down, ornate shield…"
                value={hcHeroDesc} onClick={(e) => e.stopPropagation()}
                onChange={(e) => { e.stopPropagation(); setHcHeroDesc(e.target.value); }} />
              <label className="cv-sf-label">Top-left emblem</label>
              <input className="cv-sf-input" placeholder="red kite-shield with crossed swords · wheat sheaf chip…"
                value={hcEmblem} onClick={(e) => e.stopPropagation()}
                onChange={(e) => { e.stopPropagation(); setHcEmblem(e.target.value); }} />
            </>}
          {isWired('sf-taglines')
            ? <SFWiredIndicator label={`Taglines:${wiredSourceShort('sf-taglines')}`} />
            : <>
              <label className="cv-sf-label">Tagline (red)</label>
              <input className="cv-sf-input" placeholder="THE WORLD REMEMBERS THOSE WHO DARE."
                value={hcTagline1} onClick={(e) => e.stopPropagation()}
                onChange={(e) => { e.stopPropagation(); setHcTagline1(e.target.value); }} />
              <label className="cv-sf-label">Tagline (navy)</label>
              <input className="cv-sf-input" placeholder="CHOOSE YOUR PATH. SHAPE YOUR LEGEND. DETERMINE YOUR FATE."
                value={hcTagline2} onClick={(e) => e.stopPropagation()}
                onChange={(e) => { e.stopPropagation(); setHcTagline2(e.target.value); }} />
            </>}
          {isWired('sf-stats')
            ? <SFWiredIndicator label={`Stats:${wiredSourceShort('sf-stats')}`} />
            : <>
              <label className="cv-sf-label">5 Stat bars (label · color)</label>
              {hcStats.map((s, i) => (
                <div key={i} className="cv-sf-pair">
                  <input className="cv-sf-input cv-sf-input-sm" placeholder="STR" value={s.label}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => { e.stopPropagation(); updateListItem(setHcStats, i, { label: e.target.value }); }} />
                  <input className="cv-sf-input cv-sf-input-sm" placeholder="red" value={s.color}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => { e.stopPropagation(); updateListItem(setHcStats, i, { color: e.target.value }); }} />
                </div>
              ))}
            </>}
          {isWired('sf-sidebar')
            ? <SFWiredIndicator label={`Sidebar:${wiredSourceShort('sf-sidebar')}`} />
            : <>
              <label className="cv-sf-label">4 Sidebar icons (label · icon)</label>
              {hcSidebar.map((s, i) => (
                <div key={i} className="cv-sf-pair">
                  <input className="cv-sf-input cv-sf-input-sm" placeholder="HP" value={s.label}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => { e.stopPropagation(); updateListItem(setHcSidebar, i, { label: e.target.value }); }} />
                  <input className="cv-sf-input cv-sf-input-sm" placeholder="heart" value={s.icon}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => { e.stopPropagation(); updateListItem(setHcSidebar, i, { icon: e.target.value }); }} />
                </div>
              ))}
            </>}
          {isWired('sf-party')
            ? <SFWiredIndicator label={`Party:${wiredSourceShort('sf-party')}`} />
            : <>
              <label className="cv-sf-label">4 Party members</label>
              {hcParty.map((p, i) => (
                <input key={i} className="cv-sf-input" placeholder={`Party ${i + 1}`} value={p}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => { e.stopPropagation(); updateListString(setHcParty, i, e.target.value); }} />
              ))}
            </>}
          {isWired('sf-actions')
            ? <SFWiredIndicator label={`Actions:${wiredSourceShort('sf-actions')}`} />
            : <>
              <label className="cv-sf-label">4 Action buttons (label · icon)</label>
              {hcActions.map((a, i) => (
                <div key={i} className="cv-sf-pair">
                  <input className="cv-sf-input cv-sf-input-sm" placeholder="FIGHT" value={a.label}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => { e.stopPropagation(); updateListItem(setHcActions, i, { label: e.target.value }); }} />
                  <input className="cv-sf-input cv-sf-input-sm" placeholder="sword" value={a.icon}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => { e.stopPropagation(); updateListItem(setHcActions, i, { icon: e.target.value }); }} />
                </div>
              ))}
            </>}
          {!isWired('sf-taglines') && (
            <>
              <label className="cv-sf-label">Bottom-right corner</label>
              <input className="cv-sf-input" placeholder="COMING SOON · DEMO · CYCLE 01…"
                value={hcCorner} onClick={(e) => e.stopPropagation()}
                onChange={(e) => { e.stopPropagation(); setHcCorner(e.target.value); }} />
            </>
          )}
        </div>
      )}

      {mode === 'asset-gallery' && (
        <div className="cv-sf-form">
          {isWired('sf-asset-bands')
            ? <SFWiredIndicator label={`Asset Bands:${wiredSourceShort('sf-asset-bands')}`} />
            : <>
              <label className="cv-sf-label">Theme</label>
              <input className="cv-sf-input" placeholder="pastoral farmstead · cyberpunk street · undersea reef…"
                value={agTheme} onClick={(e) => e.stopPropagation()}
                onChange={(e) => { e.stopPropagation(); setAgTheme(e.target.value); }} />
              <label className="cv-sf-label">7 Bands (name + comma-separated items)</label>
              {agBands.map((b, i) => (
                <div key={i} className="cv-sf-band">
                  <input className="cv-sf-input cv-sf-input-sm" placeholder="BAND NAME" value={b.name}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => { e.stopPropagation(); updateListItem(setAgBands, i, { name: e.target.value }); }} />
                  <textarea className="cv-sf-textarea" rows={1} placeholder="grass, path, dirt, water, stone…"
                    value={b.items} onClick={(e) => e.stopPropagation()}
                    onChange={(e) => { e.stopPropagation(); updateListItem(setAgBands, i, { items: e.target.value }); }} />
                </div>
              ))}
            </>}
        </div>
      )}

      <div className="cv-sf-shared">
        {isWired('sf-palette')
          ? <SFWiredIndicator label={`Palette:${wiredSourceShort('sf-palette')}`} />
          : <>
            <label className="cv-sf-label">Color palette (optional)</label>
            <input className="cv-sf-input" placeholder="barn red, leaf green, wheat gold, cream paper, slate roof…"
              value={palette} onClick={(e) => e.stopPropagation()}
              onChange={(e) => { e.stopPropagation(); setPalette(e.target.value); }} />
          </>}
      </div>

      <div className="cv-blotato-field">
        <input className="cv-blotato-input" type="password" placeholder="KIE API Key"
          value={apiKey} onClick={(e) => e.stopPropagation()} onChange={(e) => saveKey(e.target.value)} />
      </div>

      {(() => {
        const inflightOrQueued = (result.results || []).some(r => r.status === 'polling')
                              || (result.queue   || []).length > 0;
        const generateLabel = inflightOrQueued ? '▶ Generate (+1 → queue)' : '▶ Generate';
        return (
          <button className="cv-btn cv-btn-sprite-forge"
            disabled={!canForge}
            onClick={handleForge}>
            {generateLabel}
          </button>
        );
      })()}

      {(() => {
        const results = result.results || [];
        const queue   = result.queue   || [];
        const pinned  = result.pinned  ?? null;
        if (results.length === 0 && queue.length === 0) return null;
        return (
          <div className="cv-sf-strip">
            <div className="cv-sf-strip-thumbs">
              {results.map((r) => {
                const isPin = r.id === pinned;
                return (
                  <div key={r.id}
                       className={`cv-sf-thumb cv-sf-thumb-${r.status}${isPin ? ' is-pinned' : ''}`}
                       onClick={(e) => { e.stopPropagation(); /* modal preview lands later */ }}>
                    {r.status === 'done' && r.url && <img src={r.url} alt="" />}
                    {r.status === 'polling' && (
                      <div className="cv-sf-thumb-state">
                        <span className="cv-sf-spinner" />
                        <span className="cv-sf-thumb-elapsed">{r.elapsed}s</span>
                      </div>
                    )}
                    {r.status === 'error' && (
                      <div className="cv-sf-thumb-state cv-sf-thumb-err" title={r.error}>×</div>
                    )}
                    {isPin && <span className="cv-sf-thumb-star">★</span>}
                    <button className="cv-sf-thumb-pin"
                      onClick={(e) => { e.stopPropagation(); pinSlot(r.id); }}
                      title={isPin ? 'unpin' : 'pin (use this as output)'}>★</button>
                    <button className="cv-sf-thumb-del"
                      onClick={(e) => { e.stopPropagation(); deleteSlot(r.id); }}
                      title="delete">×</button>
                  </div>
                );
              })}
              {queue.map((q, i) => (
                <div key={q.id} className="cv-sf-thumb cv-sf-thumb-queued" title={`queued #${i + 1}`}>
                  <span className="cv-sf-thumb-state">···</span>
                </div>
              ))}
            </div>
            <div className="cv-sf-strip-meta">
              {results.filter(r => r.status === 'done').length} done ·{' '}
              {results.filter(r => r.status === 'polling').length} polling ·{' '}
              {queue.length} queued
              {queue.length > 0 && (
                <button className="cv-sf-clear-btn"
                  onClick={(e) => { e.stopPropagation(); clearQueue(); }}>× clear</button>
              )}
            </div>
          </div>
        );
      })()}

      <button className="cv-btn cv-btn-sm cv-sf-preview-btn"
        onClick={(e) => { e.stopPropagation(); setShowPrompt(!showPrompt); }}>
        {showPrompt ? 'Hide JSON Preview' : 'Preview JSON'}
      </button>

      {showPrompt && (
        <pre className="cv-sf-prompt-box">{assembled}</pre>
      )}

      <Handle type="source" position={Position.Right} id="prompt-out" style={{ top: '40%' }} />
      <Handle type="source" position={Position.Right} id="image-out" style={{ top: '60%' }} />
    </div>
  );
}

/* ===== PRD MAKER — 6 Lens nodes + Prompt Card + PRD Chat (Anthropic / OpenAI) ===== */
//
// Operator workflow: drop 6 Lens nodes (one per dimension), fill each, wire all
// into a PRD Chat node, pick a model, hit Generate. The Chat node auto-assembles
// the [PROBLEM LENS] {content} ... payload and prepends the synthesis prompt.
//
// Why 3 component types but 8 palette entries: the 6 lens entries all spawn the
// same `prd-lens` component but with a different `data.lens` discriminator.
// Saves ~600 lines of duplication and keeps lens placeholders in one place.

const PRD_LENSES = {
  PROBLEM: {
    label: 'Problem Lens',
    color: '#ef4444',
    desc: 'Pain + evidence it hurts',
    scaffold:
      'CORE PAIN\n\n\nWHERE THE PAIN LIVES (specific stages)\n- \n\nCURRENT WORKAROUNDS (and why they fail)\n- \n\nSTAKES / COST OF FAILURE\n- \n\nTRIGGER MOMENTS (when pain peaks)\n- \n\nWHO FEELS THIS MOST\n- \n\nEVIDENCE THIS IS REAL\n- ',
    seedQuestions: [
      "In one sentence — what's the core pain?",
      "Where exactly does this pain live? (workflow stages, tools, contexts)",
      "What workarounds do people use today, and why don't they actually work?",
      "What's the cost when this pain goes unaddressed? (money, time, reputation, morale)",
      "Who feels this pain most acutely, and how do you know it's real?",
    ],
  },
  MARKET: {
    label: 'Market Lens',
    color: '#eab308',
    desc: 'Sentiment, demand signals, competitive landscape',
    scaffold:
      'DEMAND SIGNALS\n- \n\nSENTIMENT (what people are saying / how they feel)\n- \n\nCOMPETITIVE LANDSCAPE\n- direct competitors:\n- adjacent solutions:\n- white space:\n\nPRICING / WTP signals\n- \n\nGROWTH / TIMING (why now)\n- ',
    seedQuestions: [
      "What demand signals tell you people want this? (search trends, communities asking, paid alternatives)",
      "What are people actually saying — what's the sentiment? Quote them if you can.",
      "Who are the direct competitors, and what's the white space they leave open?",
      "What pricing signals exist? What are people paying for the workaround today?",
      "Why now? What's changed (tech, market, behavior) that makes this the right moment?",
    ],
  },
  USER: {
    label: 'User Lens',
    color: '#3b82f6',
    desc: 'Who specifically experiences this and their context',
    scaffold:
      'WHO (specific persona, not abstract)\n- \n\nCONTEXT (where, when, with what tools)\n- \n\nBEHAVIOR (what they currently do)\n- \n\nVOCABULARY (their words, not yours)\n- \n\nJOBS-TO-BE-DONE\n- \n\nWHAT GOOD LOOKS LIKE TO THEM\n- ',
    seedQuestions: [
      "Describe the user as specifically as possible — role, context, tooling.",
      "When and where do they encounter the pain? Walk through a real day.",
      "What do they do today to cope? (workflows, tools, hacks)",
      "In their own words — what do they call the problem? What language do they avoid?",
      "What's the job they're hiring this product to do for them?",
    ],
  },
  VISION: {
    label: 'Vision Lens',
    color: '#a855f7',
    desc: 'Desired future state, the big idea',
    scaffold:
      'THE BIG IDEA (one sentence)\n\n\nDESIRED EXPERIENCE\n- \n\nCORE BET / TESTABLE HYPOTHESIS\n- \n\nWHY THIS, WHY NOW\n- \n\nTHE 10x MOMENT (what feels magic)\n- ',
    seedQuestions: [
      "In one sentence — what's the big idea? What does the future look like?",
      "What's the magic moment? What does it feel like when the product works perfectly?",
      "What's the testable hypothesis — the bet you're making?",
      "Why this specific approach, and why now?",
      "What would 10× better than today's options look like?",
    ],
  },
  BUILD: {
    label: 'Build Lens',
    color: '#10b981',
    desc: 'Functional specs and technical constraints',
    scaffold:
      'FUNCTIONAL REQUIREMENTS (P0)\n- \n\nP1 (next-up)\n- \n\nP2 (later)\n- \n\nTECHNICAL CONSTRAINTS\n- stack:\n- integrations:\n- performance / scale:\n\nDATA MODEL / KEY ENTITIES\n- \n\nDEPENDENCIES / EXTERNAL APIS\n- ',
    seedQuestions: [
      "What are the P0 (must-have) functional requirements?",
      "What's P1 (next-up) and P2 (later)?",
      "What's the tech stack, integrations, and performance/scale ceiling?",
      "What's the core data model — key entities and relationships?",
      "What external APIs or dependencies will this rely on?",
    ],
  },
  BOUNDARY: {
    label: 'Boundary Lens',
    color: '#f97316',
    desc: 'Non-goals, risks, open questions',
    scaffold:
      'NON-GOALS (explicitly NOT building)\n- \n\nKNOWN RISKS\n- \n\nOPEN QUESTIONS\n- \n\nASSUMPTIONS WORTH CHECKING\n- \n\nWHAT WE WILL CUT IF TIME RUNS OUT\n- ',
    seedQuestions: [
      "What are you explicitly NOT building? (non-goals)",
      "What are the known risks — technical, market, execution?",
      "What open questions still need answers?",
      "What assumptions are worth pressure-testing?",
      "If time runs short, what gets cut first?",
    ],
  },
};

const PRD_LENS_ORDER = ['PROBLEM', 'MARKET', 'USER', 'VISION', 'BUILD', 'BOUNDARY'];

const PRD_SYNTHESIS_PROMPT = `ROLE
You are a senior product strategist synthesizing a PRD from modular research inputs. Each input is a labeled "lens" — a focused view on one dimension. Integrate them into one coherent PRD without losing the specific signal each lens provides.

INPUTS
You will receive one or more of these labeled lenses:
[PROBLEM LENS] — the pain point and evidence it hurts
[MARKET LENS] — sentiment, demand signals, competitive landscape
[USER LENS] — who specifically experiences this and their context
[VISION LENS] — the desired future state, the big idea
[BUILD LENS] — functional specs and technical constraints
[BOUNDARY LENS] — non-goals, risks, open questions

Some lenses may be missing or sparse. Do not fabricate. Flag gaps.

SYNTHESIS RULES
1. Treat each lens as primary source material. Quote and reference specifics — don't abstract them away.
2. When lenses conflict, DO NOT average or smooth. Surface the conflict in "Tensions to Resolve."
3. Distinguish grounded claims (from lenses) vs. your inferences. Mark inferences [ASSUMPTION].
4. If a critical question isn't answered by the lenses, list under "Open Questions" — don't guess.
5. Use the user's actual voice and stakes from the User Lens. No generic persona language.
6. No marketing tone. Concrete, specific, unsentimental.

OUTPUT
1. TL;DR (3-4 sentences)
2. Problem Statement (Problem Lens)
3. Target User (User Lens, specific)
4. Market Context (Market Lens)
5. Vision & Core Bet (Vision Lens, as testable hypothesis)
6. Functional Requirements (Build Lens, prioritized P0/P1/P2)
7. Technical Considerations (Build Lens)
8. Non-Goals (Boundary Lens)
9. Success Metrics (derived from Vision + User)
10. Risks (Boundary Lens + synthesis)
11. Tensions to Resolve (conflicts between lenses, flagged not smoothed)
12. Open Questions
13. Lens Coverage (which lenses were rich, sparse, missing)

Begin synthesis when lenses are provided.`;

function PRDLensNode({ id, data }) {
  const { onLensPublish, onLensEnhance, onLensCraft } = useContext(CanvasCtx);
  const lensId = (data && data.lens) || 'PROBLEM';
  const def = PRD_LENSES[lensId] || PRD_LENSES.PROBLEM;
  const [content, setContent] = useState('');
  const [copied, setCopied] = useState(false);
  // Enhance flow — `enhancing` gates the button while the API call is in
  // flight; `prevContent` is captured *before* replacement so Undo restores
  // exactly what the operator had. Cleared when the operator types again
  // (an explicit edit invalidates the undo target — same convention as
  // most native editors). prevContent ALSO covers Undo-after-Craft —
  // Generate captures the prior content (usually empty), Undo restores it.
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceError, setEnhanceError] = useState('');
  const [prevContent, setPrevContent] = useState(null);

  // Craft flow — three modes ('lens' | 'crafting' | 'generating'). Operator
  // clicks Craft on an empty lens, fills 1-N seed questions, hits Generate;
  // synthesized lens content lands in the textarea and mode returns to lens.
  const [mode, setMode] = useState('lens');
  const [craftAnswers, setCraftAnswers] = useState([]);
  const [craftError, setCraftError] = useState('');

  // Publish on every content change so PRD Chat sees it via nodeOutputs.
  useEffect(() => {
    onLensPublish?.(id, { type: 'prd-lens', lens: lensId, content });
  }, [id, lensId, content, onLensPublish]);

  const onContentChange = (val) => {
    setContent(val);
    // Manual edit invalidates the undo target — same as text editors.
    if (prevContent !== null) setPrevContent(null);
    if (enhanceError) setEnhanceError('');
  };

  const loadScaffold = () => {
    if (content.trim() && !window.confirm('Replace current content with the scaffold template?')) return;
    setContent(def.scaffold);
    setPrevContent(null);
  };
  const clearAll = () => {
    if (!content.trim()) return;
    if (!window.confirm('Clear this lens?')) return;
    setContent('');
    setPrevContent(null);
  };
  const copy = async () => {
    if (!content) return;
    await navigator.clipboard.writeText(content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const enhance = async () => {
    if (!onLensEnhance || enhancing || content.trim().length < 30) return;
    setEnhancing(true);
    setEnhanceError('');
    try {
      const sharpened = await onLensEnhance(lensId, content);
      if (sharpened && sharpened !== content) {
        setPrevContent(content);
        setContent(sharpened);
      }
    } catch (err) {
      setEnhanceError(err?.message || 'Enhance failed');
    } finally {
      setEnhancing(false);
    }
  };

  const undoEnhance = () => {
    if (prevContent === null) return;
    setContent(prevContent);
    setPrevContent(null);
  };

  const startCraft = () => {
    if (content.trim() && !window.confirm('Crafting will replace your current content (Undo can restore it). Continue?')) return;
    setCraftAnswers(new Array(def.seedQuestions?.length || 5).fill(''));
    setCraftError('');
    setMode('crafting');
  };

  const cancelCraft = () => {
    setMode('lens');
    setCraftAnswers([]);
    setCraftError('');
  };

  const updateCraftAnswer = (idx, val) => {
    setCraftAnswers((prev) => {
      const next = [...prev];
      next[idx] = val;
      return next;
    });
    if (craftError) setCraftError('');
  };

  const generateFromCraft = async () => {
    if (!onLensCraft || mode !== 'crafting') return;
    const hasAnswer = craftAnswers.some((a) => a && a.trim().length > 0);
    if (!hasAnswer) return;
    setMode('generating');
    setCraftError('');
    try {
      const synthesized = await onLensCraft(lensId, craftAnswers);
      if (synthesized) {
        setPrevContent(content);
        setContent(synthesized);
        setMode('lens');
        setCraftAnswers([]);
      } else {
        setCraftError('Craft returned empty content');
        setMode('crafting');
      }
    } catch (err) {
      setCraftError(err?.message || 'Craft failed');
      setMode('crafting');
    }
  };

  const filled = content.trim().length > 20;
  const crafting = mode === 'crafting' || mode === 'generating';
  const generating = mode === 'generating';
  const answeredCount = craftAnswers.filter((a) => a && a.trim().length > 0).length;
  const totalQuestions = (def.seedQuestions || []).length;
  const dotColor = enhancing || generating
    ? '#e85d75'
    : crafting || filled
      ? def.color
      : '#555';
  const canEnhance = !enhancing && content.trim().length >= 30;
  const canGenerate = !generating && answeredCount > 0;

  // Header badge text reflects the current mode.
  const badgeText = enhancing
    ? 'enhancing...'
    : generating
      ? 'crafting...'
      : crafting
        ? `crafting (${answeredCount}/${totalQuestions} answered)`
        : content.length
          ? `${content.length} ch`
          : 'empty';

  return (
    <div className="cv-node cv-prd-lens nowheel" style={{ '--status-color': dotColor, '--node-accent': def.color }}>
      <NodeDeleteBtn nodeId={id} />

      <div className="cv-prd-lens-header">
        <div className="cv-prd-lens-dot" />
        <span className="cv-prd-lens-title" style={{ color: def.color }}>{def.label}</span>
        <span className="cv-prd-lens-badge">{badgeText}</span>
      </div>

      <div className="cv-prd-lens-desc">{def.desc}</div>

      {!crafting && (
        <>
          <textarea
            className="cv-prd-lens-textarea nodrag"
            value={content}
            placeholder={`Drop your ${def.label.toLowerCase()} content here, click "Load scaffold" for a starter template, or "✸ Craft" to walk through guided questions.`}
            onChange={(e) => { e.stopPropagation(); onContentChange(e.target.value); }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            rows={10}
            disabled={enhancing}
          />

          <div className="cv-prd-lens-aibtns">
            <button
              className="cv-prd-lens-btn-enhance"
              onClick={(e) => { e.stopPropagation(); enhance(); }}
              disabled={!canEnhance}
              title={content.trim().length < 30 ? 'Write at least a sentence first — enhance sharpens what\'s there, not what\'s missing' : 'Sharpen this lens with Claude'}
            >
              {enhancing ? 'Sharpening...' : '✦ Enhance'}
            </button>
            <button
              className="cv-prd-lens-btn-craft"
              onClick={(e) => { e.stopPropagation(); startCraft(); }}
              disabled={enhancing || !def.seedQuestions || def.seedQuestions.length === 0}
              title="Start from guided questions when you don't know where to begin"
            >
              ✸ Craft
            </button>
          </div>

          {prevContent !== null && !enhancing && (
            <button
              className="cv-prd-lens-btn-undo"
              onClick={(e) => { e.stopPropagation(); undoEnhance(); }}
              title="Restore the version before Enhance / Craft"
            >
              ↶ Undo
            </button>
          )}

          {enhanceError && (
            <div className="cv-prd-lens-error">{enhanceError}</div>
          )}

          <div className="cv-prd-lens-actions">
            <button className="cv-prd-lens-btn" onClick={(e) => { e.stopPropagation(); loadScaffold(); }}>Load scaffold</button>
            <button className="cv-prd-lens-btn" onClick={(e) => { e.stopPropagation(); copy(); }} disabled={!content}>{copied ? 'Copied!' : 'Copy'}</button>
            <button className="cv-prd-lens-btn cv-prd-lens-btn-danger" onClick={(e) => { e.stopPropagation(); clearAll(); }} disabled={!content}>Clear</button>
          </div>
        </>
      )}

      {crafting && (
        <div className="cv-prd-lens-craft-form">
          {(def.seedQuestions || []).map((q, idx) => (
            <div key={idx} className="cv-prd-lens-craft-q">
              <label className="cv-prd-lens-craft-question">{idx + 1}. {q}</label>
              <textarea
                className="cv-prd-lens-craft-textarea nodrag"
                value={craftAnswers[idx] || ''}
                onChange={(e) => { e.stopPropagation(); updateCraftAnswer(idx, e.target.value); }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                rows={3}
                disabled={generating}
                placeholder="Skip if you don't have a clear answer."
              />
            </div>
          ))}

          {craftError && (
            <div className="cv-prd-lens-error">{craftError}</div>
          )}

          <div className="cv-prd-lens-craft-actions">
            <button
              className="cv-prd-lens-btn"
              onClick={(e) => { e.stopPropagation(); cancelCraft(); }}
              disabled={generating}
            >
              Cancel
            </button>
            <button
              className="cv-prd-lens-btn-craft"
              onClick={(e) => { e.stopPropagation(); generateFromCraft(); }}
              disabled={!canGenerate}
              title={answeredCount === 0 ? 'Answer at least one question first' : 'Synthesize a lens draft from your answers'}
            >
              {generating ? 'Crafting...' : '✸ Generate from answers'}
            </button>
          </div>
        </div>
      )}

      <Handle type="source" position={Position.Right} id="lens-out" />
    </div>
  );
}

function PRDPromptCardNode({ id }) {
  const { onLensPublish } = useContext(CanvasCtx);
  const [content, setContent] = useState(PRD_SYNTHESIS_PROMPT);
  const [copied, setCopied] = useState(false);

  // Publish on every change so a wired PRD Chat can swap in a custom prompt.
  // Default content matches PRD_SYNTHESIS_PROMPT, so wiring without editing
  // is identical to leaving the wire off — the override only matters when
  // the operator actually changes the text.
  useEffect(() => {
    onLensPublish?.(id, { type: 'prd-prompt', prompt: content });
  }, [id, content, onLensPublish]);

  const copy = async () => {
    await navigator.clipboard.writeText(content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const reset = () => {
    if (content === PRD_SYNTHESIS_PROMPT) return;
    if (!window.confirm('Reset prompt to the default synthesis template?')) return;
    setContent(PRD_SYNTHESIS_PROMPT);
  };
  const edited = content !== PRD_SYNTHESIS_PROMPT;

  return (
    <div className="cv-node cv-prd-prompt nowheel" style={{ '--status-color': '#0ea5e9', '--node-accent': '#0ea5e9' }}>
      <NodeDeleteBtn nodeId={id} />
      <div className="cv-prd-prompt-header">
        <div className="cv-prd-prompt-dot" />
        <span className="cv-prd-prompt-title">PRD Synthesis Prompt</span>
        <span className="cv-prd-prompt-badge">{edited ? 'edited' : 'default'}</span>
      </div>
      <div className="cv-prd-prompt-desc">
        Wire into PRD Chat to feed it. Edit to engineer your own.
      </div>
      <textarea
        className="cv-prd-prompt-textarea nodrag"
        value={content}
        onChange={(e) => { e.stopPropagation(); setContent(e.target.value); }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        spellCheck={false}
      />
      <div className="cv-prd-prompt-actions">
        <button className="cv-prd-prompt-btn" onClick={(e) => { e.stopPropagation(); copy(); }}>
          {copied ? 'Copied!' : 'Copy prompt'}
        </button>
        <button className="cv-prd-prompt-btn cv-prd-prompt-btn-ghost" onClick={(e) => { e.stopPropagation(); reset(); }} disabled={!edited}>
          Reset
        </button>
      </div>
      <Handle type="source" position={Position.Right} id="prompt-out" />
    </div>
  );
}

const PRD_MODEL_OPTIONS = [
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', provider: 'anthropic' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic' },
  { id: 'gpt-5', label: 'GPT-5', provider: 'openai' },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'openai' },
];

function PRDChatNode({ id }) {
  const { edges, nodeOutputs, anthropicApiKey, onPRDGenerate } = useContext(CanvasCtx);

  const [modelId, setModelId] = useState('claude-opus-4-7');
  const [showKeys, setShowKeys] = useState(false);
  const [openaiKey, setOpenaiKey] = useState(() => localStorage.getItem('openai-api-key') || '');
  const [anthropicKeyOverride, setAnthropicKeyOverride] = useState(() => localStorage.getItem('prd-anthropic-key-override') || '');
  const [copied, setCopied] = useState(false);

  const saveOpenaiKey = (v) => { setOpenaiKey(v); localStorage.setItem('openai-api-key', v); };
  const saveAnthropicOverride = (v) => { setAnthropicKeyOverride(v); localStorage.setItem('prd-anthropic-key-override', v); };

  const model = PRD_MODEL_OPTIONS.find(m => m.id === modelId) || PRD_MODEL_OPTIONS[0];
  const effectiveAnthropicKey = anthropicKeyOverride || anthropicApiKey || '';

  // Scan upstream lens edges. Group by lens name; latest-wired wins on duplicates
  // (deterministic by edge order in the array — React Flow preserves insertion).
  const wiredLenses = useMemo(() => {
    const found = {};
    if (!Array.isArray(edges)) return found;
    for (const edge of edges) {
      if (edge.target !== id) continue;
      const out = nodeOutputs?.[edge.source];
      if (!out || out.type !== 'prd-lens') continue;
      if (!out.lens || !PRD_LENSES[out.lens]) continue;
      // Empty content still counts as "wired" so the operator sees the slot exists,
      // but the assembled payload below skips empty lenses.
      found[out.lens] = out.content || '';
    }
    return found;
  }, [edges, id, nodeOutputs]);

  // Optional prompt-in wire — when a Prompt Card is wired in, its content
  // overrides the default PRD_SYNTHESIS_PROMPT. Lets operators engineer their
  // own synthesis prompt without forking the canvas component.
  const wiredPrompt = useMemo(() => {
    if (!Array.isArray(edges)) return null;
    const inEdge = edges.find(e => e.target === id && e.targetHandle === 'prompt-in');
    if (!inEdge) return null;
    const out = nodeOutputs?.[inEdge.source];
    if (!out || out.type !== 'prd-prompt') return null;
    const text = (out.prompt || '').trim();
    return text.length > 0 ? text : null;
  }, [edges, id, nodeOutputs]);

  const filledLensCount = PRD_LENS_ORDER.filter(l => (wiredLenses[l] || '').trim().length > 20).length;
  const wiredLensCount = Object.keys(wiredLenses).length;

  const result = nodeOutputs?.[id] || { status: 'idle' };
  const status = result.status || 'idle';
  const prdText = result.prd || '';
  const errMsg = result.error || '';
  const elapsed = result.elapsed || 0;

  const hasKey = model.provider === 'anthropic' ? !!effectiveAnthropicKey : !!openaiKey;
  const canGenerate = hasKey && filledLensCount > 0 && status !== 'generating';

  const generate = () => {
    if (!canGenerate) return;
    onPRDGenerate?.(id, {
      provider: model.provider,
      model: model.id,
      apiKey: model.provider === 'anthropic' ? effectiveAnthropicKey : openaiKey,
      lenses: wiredLenses,
      systemPrompt: wiredPrompt || PRD_SYNTHESIS_PROMPT,
    });
  };

  const copyPrd = async () => {
    if (!prdText) return;
    await navigator.clipboard.writeText(prdText).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const statusColors = { idle: '#555', generating: '#e85d75', done: '#00FFFF', error: '#e74c3c' };
  const statusLabels = {
    idle: 'Wire lenses + pick a model',
    generating: `Generating PRD (${elapsed}s)`,
    done: 'PRD ready',
    error: errMsg || 'Failed',
  };

  return (
    <div className="cv-node cv-prd-chat nowheel" style={{ '--status-color': statusColors[status], '--node-accent': '#f59e0b' }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="lens-pool" style={{ top: '35%' }} />
      <Handle type="target" position={Position.Left} id="prompt-in" style={{ top: '70%' }} />

      <div className="cv-prd-chat-header">
        <div className="cv-prd-chat-dot" />
        <span className="cv-prd-chat-title">PRD Chat</span>
        <span className="cv-prd-chat-badge">{statusLabels[status]}</span>
      </div>

      {wiredPrompt && (
        <div className="cv-prd-chat-prompt-bar">
          <span className="cv-prd-chat-prompt-tag">📝 custom prompt wired</span>
          <span className="cv-prd-chat-prompt-meta">{wiredPrompt.length} chars</span>
        </div>
      )}

      <div className="cv-prd-chat-section">
        <label className="cv-prd-chat-label">Model</label>
        <select
          className="cv-prd-chat-select nodrag"
          value={modelId}
          onChange={(e) => { e.stopPropagation(); setModelId(e.target.value); }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {PRD_MODEL_OPTIONS.map(m => (
            <option key={m.id} value={m.id}>{m.label} ({m.provider})</option>
          ))}
        </select>
      </div>

      <div className="cv-prd-chat-section">
        <button
          className="cv-prd-chat-keys-toggle"
          onClick={(e) => { e.stopPropagation(); setShowKeys(s => !s); }}
        >
          {showKeys ? '▾' : '▸'} API keys ({hasKey ? '✓' : '✗ missing'})
        </button>
        {showKeys && (
          <div className="cv-prd-chat-keys">
            <label className="cv-prd-chat-keylabel">Anthropic key {anthropicApiKey ? '(inherits global if blank)' : '(required)'}</label>
            <input
              type="password"
              className="cv-prd-chat-keyinput nodrag"
              value={anthropicKeyOverride}
              placeholder={anthropicApiKey ? 'Leave blank to inherit' : 'sk-ant-...'}
              onChange={(e) => { e.stopPropagation(); saveAnthropicOverride(e.target.value); }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            />
            <label className="cv-prd-chat-keylabel">OpenAI key</label>
            <input
              type="password"
              className="cv-prd-chat-keyinput nodrag"
              value={openaiKey}
              placeholder="sk-..."
              onChange={(e) => { e.stopPropagation(); saveOpenaiKey(e.target.value); }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </div>

      <div className="cv-prd-chat-lens-summary">
        <div className="cv-prd-chat-lens-row">
          <span className="cv-prd-chat-lens-count">{filledLensCount} / 6 filled</span>
          <span className="cv-prd-chat-lens-count cv-prd-chat-lens-count-dim">{wiredLensCount} wired</span>
        </div>
        <div className="cv-prd-chat-lens-pills">
          {PRD_LENS_ORDER.map(lensId => {
            const def = PRD_LENSES[lensId];
            const c = (wiredLenses[lensId] || '').trim();
            const state = !(lensId in wiredLenses) ? 'missing' : c.length > 20 ? 'filled' : 'wired-empty';
            return (
              <span
                key={lensId}
                className={`cv-prd-chat-lens-pill cv-prd-chat-lens-pill-${state}`}
                style={state === 'filled' ? { background: def.color, borderColor: def.color, color: '#0a0a0f' } : {}}
                title={`${def.label}: ${state === 'filled' ? 'filled' : state === 'wired-empty' ? 'wired but empty' : 'not wired'}`}
              >
                {lensId.slice(0, 3)}
              </span>
            );
          })}
        </div>
      </div>

      <button
        className="cv-prd-chat-generate"
        onClick={(e) => { e.stopPropagation(); generate(); }}
        disabled={!canGenerate}
        title={!hasKey ? 'Add an API key for the selected provider' : filledLensCount === 0 ? 'Wire at least one filled lens' : ''}
      >
        {status === 'generating' ? 'Generating...' : 'Generate PRD'}
      </button>

      {prdText && (
        <div className="cv-prd-chat-output">
          <div className="cv-prd-chat-output-head">
            <span>PRD output</span>
            <button className="cv-prd-chat-output-copy" onClick={(e) => { e.stopPropagation(); copyPrd(); }}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <pre className="cv-prd-chat-output-pre">{prdText}</pre>
        </div>
      )}

      {errMsg && status === 'error' && (
        <div className="cv-prd-chat-error">{errMsg}</div>
      )}

      <Handle type="source" position={Position.Right} id="prd-out" />
    </div>
  );
}

/* ===== PRD DESIGN SOURCE NODE — JSON tokens as the brand "compass" ===== */
//
// Holds a small JSON object describing the PRD aesthetic (palette, typography,
// tone). Publishes { type: 'prd-design', design } so PRDRenderNode can consume it.
// "Compass not canvas": this is the anchoring layer for the visual idea, not
// a full design system. ~5 fields is enough.

const PRD_DESIGN_DEFAULT = {
  name: 'Skyframe',
  palette: {
    bg: '#0a0a0f',
    fg: '#e8e8e8',
    accent: '#C9A227',
    muted: '#666666',
  },
  typography: {
    heading: 'Audiowide, sans-serif',
    body: 'SpaceMono, monospace',
  },
  tone: 'dark, gold, technical',
};

function PRDDesignSourceNode({ id }) {
  const { onLensPublish } = useContext(CanvasCtx);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(PRD_DESIGN_DEFAULT, null, 2));
  const [parseError, setParseError] = useState('');

  // Parse + publish whenever JSON changes (debounced via state)
  const parsed = useMemo(() => {
    try {
      const obj = JSON.parse(jsonText);
      if (typeof obj !== 'object' || obj === null) throw new Error('Root must be an object');
      return obj;
    } catch (e) {
      return null;
    }
  }, [jsonText]);

  useEffect(() => {
    if (parsed) {
      setParseError('');
      onLensPublish?.(id, { type: 'prd-design', design: parsed });
    } else {
      try { JSON.parse(jsonText); } catch (e) { setParseError(e.message); }
    }
  }, [parsed, jsonText, id, onLensPublish]);

  const loadDefault = () => {
    setJsonText(JSON.stringify(PRD_DESIGN_DEFAULT, null, 2));
  };

  const palette = parsed?.palette || {};
  const typography = parsed?.typography || {};
  const tone = parsed?.tone || '';
  const name = parsed?.name || '';

  return (
    <div className="cv-node nowheel" style={{
      '--status-color': '#ec4899',
      '--node-accent': '#ec4899',
      width: 360,
      background: 'var(--bg-panel)',
      border: '1.5px solid #ec4899',
      borderRadius: 12,
      padding: 14,
    }}>
      <Handle type="source" position={Position.Right} id="design-out" />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ec4899', boxShadow: '0 0 8px #ec4899' }} />
        <span style={{ fontWeight: 700, color: '#ec4899', flex: 1 }}>Design Source</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted, #888)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {parseError ? 'invalid' : (name || 'unnamed')}
        </span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted, #888)', marginBottom: 10 }}>
        JSON tokens — the PRD's aesthetic compass
      </div>

      {/* JSON textarea */}
      <textarea
        className="nodrag"
        value={jsonText}
        onChange={(e) => setJsonText(e.target.value)}
        spellCheck={false}
        style={{
          width: '100%',
          minHeight: 180,
          fontFamily: 'Consolas, "Courier New", monospace',
          fontSize: 11,
          lineHeight: 1.4,
          background: '#0a0a0f',
          color: '#e8e8e8',
          border: `1px solid ${parseError ? '#ef4444' : 'rgba(236, 72, 153, 0.4)'}`,
          borderRadius: 6,
          padding: 8,
          resize: 'vertical',
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />
      {parseError && (
        <div style={{ marginTop: 6, fontSize: 10, color: '#ef4444', fontFamily: 'monospace' }}>
          {parseError}
        </div>
      )}

      {/* Live preview */}
      {parsed && (
        <div style={{
          marginTop: 10,
          padding: 10,
          background: palette.bg || '#0a0a0f',
          color: palette.fg || '#e8e8e8',
          borderRadius: 6,
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {['bg', 'fg', 'accent', 'muted'].map(k => (
              <div key={k} title={`${k}: ${palette[k] || ''}`}
                style={{
                  width: 22, height: 22, borderRadius: 4,
                  background: palette[k] || '#000',
                  border: '1px solid rgba(255,255,255,0.18)',
                }} />
            ))}
          </div>
          <div style={{
            fontFamily: typography.heading || 'sans-serif',
            color: palette.accent || '#C9A227',
            fontSize: 18,
            letterSpacing: '0.04em',
            marginBottom: 4,
          }}>
            {name || 'Brand'}
          </div>
          <div style={{
            fontFamily: typography.body || 'sans-serif',
            fontSize: 11,
            opacity: 0.85,
          }}>
            tone: {tone || '—'}
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button
          className="nodrag"
          onClick={(e) => { e.stopPropagation(); loadDefault(); }}
          style={{
            flex: 1,
            padding: '6px 10px',
            background: 'rgba(236, 72, 153, 0.15)',
            color: '#ec4899',
            border: '1px solid rgba(236, 72, 153, 0.45)',
            borderRadius: 5,
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Load Skyframe default
        </button>
      </div>
    </div>
  );
}

/* ===== PRD RENDER NODE — branded HTML preview + downloads ===== */
//
// Inputs (left handles):
//   prd-in    : consumes from PRD Chat (reads .prd from source's nodeOutput)
//   design-in : consumes from Design Source (reads .design where type='prd-design')
// Output:
//   none — terminal node. Provides preview + download .html + Print to PDF.

// Tiny inline markdown → HTML. Handles headings, paragraphs, lists, bold/italic/code.
function prdMdToHtml(md) {
  if (!md) return '';
  const inline = (s) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

  const lines = md.split('\n');
  const out = [];
  let inList = null, inCode = false, codeBuf = [], para = [];
  const flushPara = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
  const flushList = () => { if (inList) { out.push(`</${inList}>`); inList = null; } };

  // Pipe-table detectors. A table is a row of `| a | b | c |` followed by a
  // separator like `|---|---|---|`, then more pipe rows until a non-pipe line.
  const isPipeRow = (s) => /^\s*\|.+\|\s*$/.test(s);
  const isSeparatorRow = (s) => /^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(s);
  const splitCells = (s) => s.trim().slice(1, -1).split('|').map(c => c.trim());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCode) { out.push('<pre><code>' + codeBuf.join('\n') + '</code></pre>'); codeBuf = []; inCode = false; }
      else { flushPara(); flushList(); inCode = true; }
      continue;
    }
    if (inCode) { codeBuf.push(line.replace(/&/g, '&amp;').replace(/</g, '&lt;')); continue; }

    // Pipe table — must check before lists/paragraphs since the row matches neither.
    if (isPipeRow(line) && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      flushPara(); flushList();
      const headerCells = splitCells(line);
      i++; // skip separator
      const bodyRows = [];
      while (i + 1 < lines.length && isPipeRow(lines[i + 1])) {
        i++;
        bodyRows.push(splitCells(lines[i]));
      }
      let html = '<table><thead><tr>';
      html += headerCells.map(c => `<th>${inline(c)}</th>`).join('');
      html += '</tr></thead><tbody>';
      html += bodyRows.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('');
      html += '</tbody></table>';
      out.push(html);
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flushPara(); flushList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }

    const ul = line.match(/^[-*]\s+(.*)$/);
    if (ul) {
      flushPara();
      if (inList !== 'ul') { flushList(); out.push('<ul>'); inList = 'ul'; }
      out.push('<li>' + inline(ul[1]) + '</li>');
      continue;
    }
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ol) {
      flushPara();
      if (inList !== 'ol') { flushList(); out.push('<ol>'); inList = 'ol'; }
      out.push('<li>' + inline(ol[1]) + '</li>');
      continue;
    }

    if (!line.trim()) { flushPara(); flushList(); continue; }
    para.push(line);
  }
  flushPara(); flushList();
  if (inCode) out.push('<pre><code>' + codeBuf.join('\n') + '</code></pre>');
  return out.join('\n');
}

function buildPrdBrandedHtml(prdText, design) {
  const safe = (v, fb) => (v && typeof v === 'string' ? v : fb);
  const name = safe(design?.name, 'PRD').replace(/[<>]/g, '');
  const palette = design?.palette || {};
  const typography = design?.typography || {};
  const bg = safe(palette.bg, '#0a0a0f');
  const fg = safe(palette.fg, '#e8e8e8');
  const accent = safe(palette.accent, '#C9A227');
  const muted = safe(palette.muted, '#666666');
  const headingFont = safe(typography.heading, 'system-ui, sans-serif');
  const bodyFont = safe(typography.body, 'system-ui, sans-serif');
  const body = prdMdToHtml(prdText);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${name} — PRD</title>
<style>
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { background: ${bg}; color: ${fg}; font-family: ${bodyFont}; line-height: 1.6; padding: 56px 64px; min-height: 100vh; }
.prd-container { max-width: 820px; margin: 0 auto; }
.prd-header { border-bottom: 2px solid ${accent}; padding-bottom: 18px; margin-bottom: 36px; }
.prd-eyebrow { color: ${muted}; font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; margin: 0 0 6px; font-family: ${bodyFont}; }
.prd-name { font-family: ${headingFont}; font-size: 38px; color: ${accent}; letter-spacing: 0.04em; margin: 0; }
h1, h2, h3, h4 { font-family: ${headingFont}; color: ${fg}; margin: 1.6em 0 0.6em; line-height: 1.2; }
h1 { font-size: 30px; color: ${accent}; }
h2 { font-size: 24px; }
h3 { font-size: 20px; }
h4 { font-size: 17px; color: ${muted}; }
p { margin: 0.7em 0; }
ul, ol { margin: 0.7em 0; padding-left: 1.6em; }
li { margin: 0.25em 0; }
strong { color: ${accent}; }
em { color: ${fg}; opacity: 0.85; }
code { background: rgba(255,255,255,0.06); color: ${accent}; padding: 1px 5px; border-radius: 3px; font-family: 'Consolas', monospace; font-size: 0.92em; }
pre { background: rgba(255,255,255,0.04); border-left: 3px solid ${accent}; padding: 14px 18px; overflow-x: auto; margin: 1em 0; border-radius: 4px; }
pre code { background: none; color: ${fg}; padding: 0; }
table { width: 100%; border-collapse: collapse; margin: 1.2em 0; font-size: 0.94em; }
thead th { color: ${accent}; font-family: ${headingFont}; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; font-size: 12px; padding: 10px 14px; text-align: left; border-bottom: 2px solid ${accent}; }
tbody td { padding: 10px 14px; vertical-align: top; border-bottom: 1px solid rgba(255,255,255,0.10); }
tbody tr:last-child td { border-bottom: none; }
@media print {
  body { background: #ffffff !important; color: #1a1a1a !important; padding: 32px 40px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .prd-eyebrow { color: #555555 !important; }
  h1, h2, h3 { color: #111111 !important; }
  h1.prd-name, h1 { color: ${accent} !important; }
  h4 { color: #444444 !important; }
  p, li, td { color: #1a1a1a !important; }
  em { color: #333333 !important; opacity: 1; }
  code { background: #f0f0f0 !important; color: ${accent} !important; }
  pre { background: #f7f7f7 !important; border-left-color: ${accent} !important; }
  pre code { color: #1a1a1a !important; background: none !important; }
  thead th { color: ${accent} !important; border-bottom-color: ${accent} !important; }
  tbody td { border-bottom: 1px solid #cccccc !important; }
  .prd-header { border-bottom-color: ${accent} !important; }
  @page { margin: 0.6in; }
}
</style>
</head>
<body>
<div class="prd-container">
<div class="prd-header">
<p class="prd-eyebrow">Product Requirements</p>
<h1 class="prd-name">${name}</h1>
</div>
${body}
</div>
</body>
</html>`;
}

function PRDRenderNode({ id }) {
  const { edges, nodeOutputs } = useContext(CanvasCtx);

  // Trace inputs
  const prdText = useMemo(() => {
    if (!Array.isArray(edges)) return '';
    const inEdge = edges.find(e => e.target === id && e.targetHandle === 'prd-in');
    if (!inEdge) return '';
    const out = nodeOutputs?.[inEdge.source];
    return out?.prd || '';
  }, [edges, id, nodeOutputs]);

  const design = useMemo(() => {
    if (!Array.isArray(edges)) return null;
    const inEdge = edges.find(e => e.target === id && e.targetHandle === 'design-in');
    if (!inEdge) return null;
    const out = nodeOutputs?.[inEdge.source];
    if (!out || out.type !== 'prd-design') return null;
    return out.design || null;
  }, [edges, id, nodeOutputs]);

  const ready = !!prdText && !!design;
  const html = useMemo(() => (ready ? buildPrdBrandedHtml(prdText, design) : ''), [prdText, design, ready]);

  const downloadHtml = () => {
    if (!html) return;
    const safeName = (design?.name || 'PRD').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${safeName}_prd.html`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const printPdf = () => {
    if (!html) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch (_) {} }, 300);
  };

  return (
    <div className="cv-node nowheel" style={{
      '--status-color': '#22c55e',
      '--node-accent': '#22c55e',
      width: 420,
      background: 'var(--bg-panel)',
      border: '1.5px solid #22c55e',
      borderRadius: 12,
      padding: 14,
    }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="prd-in" style={{ top: '32%' }} />
      <Handle type="target" position={Position.Left} id="design-in" style={{ top: '68%' }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 8px #22c55e' }} />
        <span style={{ fontWeight: 700, color: '#22c55e', flex: 1 }}>PRD Render</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted, #888)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {ready ? 'ready' : !prdText && !design ? 'no inputs' : !prdText ? 'wire PRD' : 'wire design'}
        </span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted, #888)', marginBottom: 10 }}>
        Branded preview — wire <span style={{ color: '#f59e0b' }}>PRD Chat → prd-in</span> + <span style={{ color: '#ec4899' }}>Design Source → design-in</span>
      </div>

      {/* Preview */}
      <div style={{
        height: 280,
        overflow: 'auto',
        background: design?.palette?.bg || '#0a0a0f',
        border: '1px solid rgba(34, 197, 94, 0.3)',
        borderRadius: 6,
        padding: 0,
      }}>
        {ready ? (
          <iframe
            title="PRD branded preview"
            srcDoc={html}
            style={{ width: '100%', height: '100%', border: 'none', background: 'transparent' }}
          />
        ) : (
          <div style={{
            height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted, #888)', fontSize: 12, fontStyle: 'italic',
          }}>
            Wire both inputs to render preview
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button
          className="nodrag"
          onClick={(e) => { e.stopPropagation(); downloadHtml(); }}
          disabled={!ready}
          style={{
            flex: 1,
            padding: '6px 10px',
            background: ready ? 'rgba(34, 197, 94, 0.15)' : 'rgba(255,255,255,0.04)',
            color: ready ? '#22c55e' : '#666',
            border: `1px solid ${ready ? 'rgba(34, 197, 94, 0.45)' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: 5,
            fontSize: 11,
            fontWeight: 600,
            cursor: ready ? 'pointer' : 'not-allowed',
          }}
        >
          Download .html
        </button>
        <button
          className="nodrag"
          onClick={(e) => { e.stopPropagation(); printPdf(); }}
          disabled={!ready}
          style={{
            flex: 1,
            padding: '6px 10px',
            background: ready ? 'rgba(34, 197, 94, 0.15)' : 'rgba(255,255,255,0.04)',
            color: ready ? '#22c55e' : '#666',
            border: `1px solid ${ready ? 'rgba(34, 197, 94, 0.45)' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: 5,
            fontSize: 11,
            fontWeight: 600,
            cursor: ready ? 'pointer' : 'not-allowed',
          }}
        >
          Print → PDF
        </button>
      </div>
    </div>
  );
}

/* ===== POP BEATS NODE — inject pop sounds at motion-graphic event timestamps ===== */
//
// Wires a video from upstream, accepts a comma-separated list of timestamps
// (and optionally an EDL output type later — see PRD P1), picks a pop sound,
// hits /api/pop-beats. Output URL flows downstream like any other video node.
//
// The pop sounds bundled with Breadstick are the placeholders synthesized via
// FFmpeg on 2026-05-03. Replace files in pipeline/sounds/pops/ to swap them.

const POP_SOUNDS = [
  { id: 'subtle', label: 'Subtle', desc: 'gentle UI tap' },
  { id: 'sharp',  label: 'Sharp',  desc: 'percussive click' },
  { id: 'soft',   label: 'Soft',   desc: 'air-pop, breathy' },
];

function PopBeatsNode({ id }) {
  const { edges, nodeOutputs, onPopBeatsRender } = useContext(CanvasCtx);
  const [timestampsText, setTimestampsText] = useState('');
  const [sound, setSound] = useState('subtle');
  const [gainDb, setGainDb] = useState(-6);
  const [copied, setCopied] = useState(false);

  // Trace video input — first wired video URL wins.
  const upstreamVideoUrl = useMemo(() => {
    if (!Array.isArray(edges)) return '';
    for (const edge of edges) {
      if (edge.target !== id) continue;
      const src = nodeOutputs?.[edge.source];
      if (!src) continue;
      // Single-video output (most common shape)
      if (src.url && typeof src.url === 'string') return src.url;
      // FFmpeg grade / chroma composite shape: { graded: [{url, status}] }
      if (Array.isArray(src.graded)) {
        const done = src.graded.find(g => g.status === 'done' && g.url);
        if (done) return done.url;
      }
      // UGC video / frame sandwich shape: { videos: [{url, status}] }
      if (Array.isArray(src.videos)) {
        const done = src.videos.find(v => v.status === 'done' && v.url);
        if (done) return done.url;
      }
    }
    return '';
  }, [edges, id, nodeOutputs]);

  // Parse the comma-separated timestamp string into a clean number array.
  const pops = useMemo(() => {
    return timestampsText
      .split(/[,\s]+/)
      .map(s => parseFloat(s.trim()))
      .filter(n => Number.isFinite(n) && n >= 0);
  }, [timestampsText]);

  const result = nodeOutputs?.[id] || { status: 'idle' };
  const status = result.status || 'idle';
  const outputUrl = result.url || '';
  const errMsg = result.error || '';
  const popCount = result.popCount || 0;

  const canGenerate = upstreamVideoUrl && pops.length > 0 && status !== 'rendering';

  const generate = () => {
    if (!canGenerate) return;
    onPopBeatsRender?.(id, { videoUrl: upstreamVideoUrl, pops, sound, gainDb });
  };

  const copyUrl = async () => {
    if (!outputUrl) return;
    await navigator.clipboard.writeText(`http://localhost:3001${outputUrl}`).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const dotColor = status === 'rendering' ? '#e85d75'
    : outputUrl ? '#00FFFF'
    : status === 'error' ? '#e74c3c'
    : canGenerate ? '#a3e635' : '#555';

  return (
    <div className="cv-node cv-pop-beats nowheel" style={{ '--status-color': dotColor, '--node-accent': '#a3e635' }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="video-in" />

      <div className="cv-pop-beats-header">
        <div className="cv-pop-beats-dot" />
        <span className="cv-pop-beats-title">Pop Beats</span>
        <span className="cv-pop-beats-badge">{pops.length} pop{pops.length === 1 ? '' : 's'}</span>
      </div>

      <div className="cv-pop-beats-input-row">
        <span className={`cv-pop-beats-input-dot ${upstreamVideoUrl ? 'active' : ''}`} />
        <span>{upstreamVideoUrl ? 'video wired' : 'wire a video into the left handle'}</span>
      </div>

      <label className="cv-pop-beats-label">Timestamps (seconds, comma-separated)</label>
      <textarea
        className="cv-pop-beats-textarea nodrag"
        value={timestampsText}
        placeholder="e.g.  2.5, 5.8, 9.1, 12.4"
        onChange={(e) => { e.stopPropagation(); setTimestampsText(e.target.value); }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        rows={3}
      />

      <label className="cv-pop-beats-label">Sound</label>
      <div className="cv-pop-beats-sounds">
        {POP_SOUNDS.map(s => (
          <button
            key={s.id}
            className={`cv-pop-beats-sound ${sound === s.id ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setSound(s.id); }}
            title={s.desc}
          >
            {s.label}
          </button>
        ))}
      </div>

      <label className="cv-pop-beats-label">Gain: {gainDb >= 0 ? '+' : ''}{gainDb} dB</label>
      <input
        type="range"
        className="cv-pop-beats-slider nodrag"
        min={-18} max={3} step={1}
        value={gainDb}
        onChange={(e) => { e.stopPropagation(); setGainDb(parseInt(e.target.value, 10)); }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      />

      <button
        className="cv-pop-beats-generate"
        onClick={(e) => { e.stopPropagation(); generate(); }}
        disabled={!canGenerate}
        title={!upstreamVideoUrl ? 'Wire a video into the left handle' : pops.length === 0 ? 'Enter at least one timestamp' : ''}
      >
        {status === 'rendering' ? 'Injecting pops...' : outputUrl ? 'Re-render' : 'Inject pops'}
      </button>

      {outputUrl && (
        <div className="cv-pop-beats-output">
          <video src={`http://localhost:3001${outputUrl}`} controls className="cv-pop-beats-video" />
          <div className="cv-pop-beats-output-row">
            <span className="cv-pop-beats-output-meta">{popCount} pops applied</span>
            <button className="cv-pop-beats-copy" onClick={(e) => { e.stopPropagation(); copyUrl(); }}>
              {copied ? 'Copied!' : 'Copy URL'}
            </button>
          </div>
        </div>
      )}

      {errMsg && status === 'error' && (
        <div className="cv-pop-beats-error">{errMsg}</div>
      )}

      <Handle type="source" position={Position.Right} id="popped-out" />
    </div>
  );
}

/* ===== STACKED VIDEO NODE — vstack/hstack composer for split-frame edits ===== */
//
// Two video inputs (top-in + bottom-in), scaled and padded to preserve aspect
// within their panel, then stacked vertically or horizontally. Output is a single
// video at the chosen resolution. Distinct from Cartesian Composer — this is
// full-frame side-by-side, not coordinate-based overlays.

const STACK_RESOLUTIONS = [
  { id: 'portrait',  label: '1080×1920 portrait',  width: 1080, height: 1920 },
  { id: 'landscape', label: '1920×1080 landscape', width: 1920, height: 1080 },
  { id: 'square',    label: '1080×1080 square',    width: 1080, height: 1080 },
];

function StackedVideoNode({ id }) {
  const { edges, nodeOutputs, onStackVideoRender } = useContext(CanvasCtx);
  const [orientation, setOrientation] = useState('vertical');
  const [resolutionId, setResolutionId] = useState('portrait');
  const [audioMode, setAudioMode] = useState('top');
  const [syncMode, setSyncMode] = useState('shortest');
  const [fit, setFit] = useState('contain');
  const [copied, setCopied] = useState(false);

  // Trace video URLs by handle. top-in vs bottom-in lets the operator wire
  // either input to either source — the handles stay positionally consistent.
  const { topUrl, bottomUrl } = useMemo(() => {
    let top = '', bot = '';
    if (!Array.isArray(edges)) return { topUrl: '', bottomUrl: '' };
    const pickUrl = (src) => {
      if (!src) return '';
      if (src.url && typeof src.url === 'string') return src.url;
      if (Array.isArray(src.graded)) {
        const done = src.graded.find(g => g.status === 'done' && g.url);
        if (done) return done.url;
      }
      if (Array.isArray(src.videos)) {
        const done = src.videos.find(v => v.status === 'done' && v.url);
        if (done) return done.url;
      }
      return '';
    };
    for (const edge of edges) {
      if (edge.target !== id) continue;
      const url = pickUrl(nodeOutputs?.[edge.source]);
      if (!url) continue;
      if (edge.targetHandle === 'top-in') top = url;
      else if (edge.targetHandle === 'bottom-in') bot = url;
      else if (!top) top = url;
      else if (!bot) bot = url;
    }
    return { topUrl: top, bottomUrl: bot };
  }, [edges, id, nodeOutputs]);

  const resolution = STACK_RESOLUTIONS.find(r => r.id === resolutionId) || STACK_RESOLUTIONS[0];

  const result = nodeOutputs?.[id] || { status: 'idle' };
  const status = result.status || 'idle';
  const outputUrl = result.url || '';
  const errMsg = result.error || '';

  const canGenerate = topUrl && bottomUrl && status !== 'rendering';

  const generate = () => {
    if (!canGenerate) return;
    onStackVideoRender?.(id, {
      topUrl, bottomUrl,
      orientation,
      width: resolution.width,
      height: resolution.height,
      audioMode, syncMode, fit,
    });
  };

  const copyUrl = async () => {
    if (!outputUrl) return;
    await navigator.clipboard.writeText(`http://localhost:3001${outputUrl}`).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const dotColor = status === 'rendering' ? '#e85d75'
    : outputUrl ? '#00FFFF'
    : status === 'error' ? '#e74c3c'
    : canGenerate ? '#fb7185' : '#555';

  return (
    <div className="cv-node cv-stack-video nowheel" style={{ '--status-color': dotColor, '--node-accent': '#fb7185' }}>
      <NodeDeleteBtn nodeId={id} />
      <Handle type="target" position={Position.Left} id="top-in" style={{ top: '30%' }} />
      <Handle type="target" position={Position.Left} id="bottom-in" style={{ top: '70%' }} />

      <div className="cv-stack-video-header">
        <div className="cv-stack-video-dot" />
        <span className="cv-stack-video-title">Stacked Video</span>
        <span className="cv-stack-video-badge">{orientation === 'vertical' ? 'vstack' : 'hstack'}</span>
      </div>

      <div className="cv-stack-video-inputs">
        <div className="cv-stack-video-input-row">
          <span className={`cv-stack-video-input-dot ${topUrl ? 'active' : ''}`} />
          <span>{topUrl ? `${orientation === 'vertical' ? 'top' : 'left'} wired` : `wire ${orientation === 'vertical' ? 'top' : 'left'} video`}</span>
        </div>
        <div className="cv-stack-video-input-row">
          <span className={`cv-stack-video-input-dot ${bottomUrl ? 'active' : ''}`} />
          <span>{bottomUrl ? `${orientation === 'vertical' ? 'bottom' : 'right'} wired` : `wire ${orientation === 'vertical' ? 'bottom' : 'right'} video`}</span>
        </div>
      </div>

      <label className="cv-stack-video-label">Orientation</label>
      <div className="cv-stack-video-buttons">
        <button
          className={`cv-stack-video-btn ${orientation === 'vertical' ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setOrientation('vertical'); }}
        >Vertical (top + bottom)</button>
        <button
          className={`cv-stack-video-btn ${orientation === 'horizontal' ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setOrientation('horizontal'); }}
        >Horizontal (left + right)</button>
      </div>

      <label className="cv-stack-video-label">Resolution</label>
      <select
        className="cv-stack-video-select nodrag"
        value={resolutionId}
        onChange={(e) => { e.stopPropagation(); setResolutionId(e.target.value); }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {STACK_RESOLUTIONS.map(r => (
          <option key={r.id} value={r.id}>{r.label}</option>
        ))}
      </select>

      <label className="cv-stack-video-label">Fit</label>
      <div className="cv-stack-video-buttons">
        <button
          className={`cv-stack-video-btn ${fit === 'contain' ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setFit('contain'); }}
          title="Letterbox — preserves full source, may show bars"
        >Contain (letterbox)</button>
        <button
          className={`cv-stack-video-btn ${fit === 'cover' ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setFit('cover'); }}
          title="Crop to fill — no bars, edges may be lost"
        >Cover (crop)</button>
      </div>

      <label className="cv-stack-video-label">Audio source</label>
      <select
        className="cv-stack-video-select nodrag"
        value={audioMode}
        onChange={(e) => { e.stopPropagation(); setAudioMode(e.target.value); }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <option value="top">{orientation === 'vertical' ? 'Top' : 'Left'} only</option>
        <option value="bottom">{orientation === 'vertical' ? 'Bottom' : 'Right'} only</option>
        <option value="mix">Mix both</option>
        <option value="none">No audio</option>
      </select>

      <label className="cv-stack-video-label">Sync mode</label>
      <select
        className="cv-stack-video-select nodrag"
        value={syncMode}
        onChange={(e) => { e.stopPropagation(); setSyncMode(e.target.value); }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <option value="shortest">Trim to shortest</option>
        <option value="loop-shorter">Loop shorter (P1 — degrades to shortest in v1)</option>
        <option value="hold-last">Hold last frame (P1 — degrades to shortest in v1)</option>
      </select>

      <button
        className="cv-stack-video-generate"
        onClick={(e) => { e.stopPropagation(); generate(); }}
        disabled={!canGenerate}
        title={!topUrl || !bottomUrl ? 'Wire both video inputs' : ''}
      >
        {status === 'rendering' ? 'Stacking...' : outputUrl ? 'Re-stack' : 'Stack videos'}
      </button>

      {outputUrl && (
        <div className="cv-stack-video-output">
          <video src={`http://localhost:3001${outputUrl}`} controls className="cv-stack-video-preview" />
          <div className="cv-stack-video-output-row">
            <span className="cv-stack-video-output-meta">{resolution.label}</span>
            <button className="cv-stack-video-copy" onClick={(e) => { e.stopPropagation(); copyUrl(); }}>
              {copied ? 'Copied!' : 'Copy URL'}
            </button>
          </div>
        </div>
      )}

      {errMsg && status === 'error' && (
        <div className="cv-stack-video-error">{errMsg}</div>
      )}

      <Handle type="source" position={Position.Right} id="stacked-out" />
    </div>
  );
}

const PALETTE_CATEGORIES = ['Characters', 'Script', 'Image', 'Video', 'Compositing', 'Distribution', 'PRD Maker', 'Substrate'];
const PALETTE_COLLAPSE_KEY = 'cv-palette-categories-v2'; // v2 added Characters category

function NodePalette({ collapsed, onToggle, extraItems = [], onResetCanvas }) {
  // Persist per-category open/closed state across reloads. Default: Script + Image
  // open (most common starting points), the rest collapsed to keep the panel calm.
  const [openCats, setOpenCats] = useState(() => {
    try {
      const saved = localStorage.getItem(PALETTE_COLLAPSE_KEY);
      if (saved) return JSON.parse(saved);
    } catch { /* fall through */ }
    return { Characters: true, Script: true, Image: true, Video: false, Compositing: false, Distribution: false, 'PRD Maker': false };
  });

  const toggleCat = (cat) => {
    setOpenCats(prev => {
      const next = { ...prev, [cat]: !prev[cat] };
      try { localStorage.setItem(PALETTE_COLLAPSE_KEY, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  };

  const onDragStart = (e, nodeType, defaultData) => {
    e.dataTransfer.setData('application/reactflow-type', nodeType);
    e.dataTransfer.setData('application/reactflow-data', JSON.stringify(defaultData || {}));
    e.dataTransfer.effectAllowed = 'move';
  };

  // Group nodes by category preserving PALETTE_CATEGORIES order
  const nodesByCat = {};
  PALETTE_CATEGORIES.forEach(c => { nodesByCat[c] = []; });
  // Dynamic extras (e.g. character cards driven by useCharacters()) come first
  // within their category so they appear at the top of the list.
  for (const n of [...extraItems, ...PALETTE_NODES]) {
    const cat = n.category || 'Script';
    if (!nodesByCat[cat]) nodesByCat[cat] = [];
    nodesByCat[cat].push(n);
  }

  return (
    <div className={`cv-palette ${collapsed ? 'cv-palette-collapsed' : ''}`}>
      <button className="cv-palette-toggle" onClick={onToggle}>
        {collapsed ? '+' : '<'}
      </button>
      {!collapsed && (
        <div className="cv-palette-body">
          <div className="cv-palette-title">NODES</div>
          <button
            type="button"
            className="cv-palette-reset"
            onClick={() => {
              if (window.confirm('Reset canvas? This removes every node and edge. Cannot be undone.')) {
                onResetCanvas?.();
              }
            }}
            title="Remove every node and edge from the canvas"
          >
            Reset Canvas
          </button>
          {PALETTE_CATEGORIES.map(cat => {
            const items = nodesByCat[cat] || [];
            if (items.length === 0) return null;
            const isOpen = !!openCats[cat];
            return (
              <div key={cat} className="cv-palette-cat">
                <button
                  className={`cv-palette-cat-header ${isOpen ? 'open' : ''}`}
                  onClick={() => toggleCat(cat)}
                  type="button"
                >
                  <span className="cv-palette-cat-arrow">{isOpen ? '▾' : '▸'}</span>
                  <span className="cv-palette-cat-label">{cat}</span>
                  <span className="cv-palette-cat-count">{items.length}</span>
                </button>
                {isOpen && items.map((n) => (
                  <div key={paletteItemKey(n)} className="cv-palette-item"
                    draggable
                    onDragStart={(e) => onDragStart(e, n.type, n.data)}
                    style={{ '--palette-color': n.color }}>
                    <div className="cv-palette-icon">{n.icon}</div>
                    <div className="cv-palette-info">
                      <div className="cv-palette-label">{n.label}</div>
                      <div className="cv-palette-desc">{n.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ===== MAIN CANVAS ===== */
let _dropId = 0;

/* ===== ONBOARDING MODAL — first-run template picker + API key collection ===== */
function OnboardingModal({ anthropicKey, onAnthropicKey, kieKey, onKieKey, onPick, onSkip }) {
  const [showAnthropic, setShowAnthropic] = useState(false);
  const [showKie, setShowKie] = useState(false);
  return (
    <div className="cv-onboarding-overlay" onClick={(e) => { if (e.target === e.currentTarget) onSkip(); }}>
      <div className="cv-onboarding-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cv-onboarding-header">
          <h2 className="cv-onboarding-title">Welcome to Breadstick</h2>
          <p className="cv-onboarding-subtitle">Pick a starting point. You can always drag more nodes later.</p>
        </div>

        {/* API keys — paste once, persisted per browser */}
        <div className="cv-onboarding-keys">
          <div className="cv-onboarding-key-row">
            <label className="cv-onboarding-key-label">Anthropic API Key</label>
            <input
              type={showAnthropic ? 'text' : 'password'}
              className="cv-onboarding-key-input"
              placeholder="sk-ant-..."
              value={anthropicKey}
              onChange={(e) => onAnthropicKey(e.target.value)}
              autoComplete="off"
            />
            <button type="button" className="cv-btn cv-btn-sm" onClick={() => setShowAnthropic(!showAnthropic)}>
              {showAnthropic ? 'Hide' : 'Show'}
            </button>
          </div>
          <div className="cv-onboarding-key-row">
            <label className="cv-onboarding-key-label">KIE.AI API Key</label>
            <input
              type={showKie ? 'text' : 'password'}
              className="cv-onboarding-key-input"
              placeholder="kie-..."
              value={kieKey}
              onChange={(e) => onKieKey(e.target.value)}
              autoComplete="off"
            />
            <button type="button" className="cv-btn cv-btn-sm" onClick={() => setShowKie(!showKie)}>
              {showKie ? 'Hide' : 'Show'}
            </button>
          </div>
          <div className="cv-onboarding-key-hint">
            Anthropic powers script generation. KIE handles image + video generation.
            Both stay in your browser only — Breadstick is BYOK.
          </div>
        </div>

        {/* Templates — pick one to drop pre-positioned nodes on the canvas */}
        <div className="cv-onboarding-templates">
          {CANVAS_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              className="cv-onboarding-template"
              onClick={() => onPick(t.id)}
            >
              <span className="cv-onboarding-template-icon">{t.icon}</span>
              <div className="cv-onboarding-template-body">
                <div className="cv-onboarding-template-title">{t.title}</div>
                <div className="cv-onboarding-template-desc">{t.desc}</div>
                <div className="cv-onboarding-template-pipeline">{t.pipeline}</div>
              </div>
            </button>
          ))}
        </div>

        <button type="button" className="cv-onboarding-skip" onClick={onSkip}>
          Skip — start with empty canvas
        </button>
      </div>
    </div>
  );
}

// Drop-id counter for template-applied nodes (parallel to the palette drop counter).
let _onboardingDropId = 1000;

/* ===== FILE PICKER MODAL — server-backed filesystem browser ================
   Why server-backed: native HTML <input type="file"> can't return a real
   filesystem path (browser security). For our case, client + server run on
   the same machine, so the server's filesystem IS the user's filesystem.
   `/api/fs/browse` returns dir/file listings; the user navigates and picks;
   the modal returns the real absolute path. No file upload, no double-copy
   of gigabyte videos. Per-call config: startDir, exts[], label, key (for
   localStorage memory of last-used dir per node type). */
function FilePickerModal({ state, onClose }) {
  const { open, opts, onPicked } = state || {};
  const [path, setPath] = useState('');
  const [pathInput, setPathInput] = useState('');
  const [listing, setListing] = useState({ dirs: [], files: [], parent: null });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState('');

  useEffect(() => {
    if (open) {
      const start = opts?.startDir || '';
      setPath(start);
      setPathInput(start);
      setSelected('');
      setErr('');
    }
  }, [open, opts?.startDir]);

  useEffect(() => {
    if (!open || !path) return;
    let cancelled = false;
    setLoading(true);
    const extParam = (opts?.exts || []).join(',');
    const url = `http://localhost:3001/api/fs/browse?path=${encodeURIComponent(path)}${extParam ? `&ext=${extParam}` : ''}`;
    fetch(url)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (data.error) { setErr(data.error); setListing({ dirs: [], files: [], parent: null }); }
        else { setListing(data); setErr(''); setPathInput(data.path); }
        setLoading(false);
      })
      .catch(e => { if (!cancelled) { setErr(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [open, path, opts?.exts]);

  if (!open) return null;

  const pick = (filePath) => {
    if (opts?.key) {
      try {
        const recents = JSON.parse(localStorage.getItem('filepicker-recents') || '{}');
        const parent = filePath.replace(/[\\/][^\\/]+$/, '');
        recents[opts.key] = parent || filePath;
        localStorage.setItem('filepicker-recents', JSON.stringify(recents));
      } catch { /* localStorage may be unavailable */ }
    }
    if (onPicked) onPicked(filePath);
    onClose();
  };

  const formatSize = (b) => {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
    return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        background: 'var(--bg-panel, #16161f)',
        border: '1px solid var(--border, #2a2a35)',
        borderRadius: 10,
        width: 'min(720px, 92vw)',
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }}>
        <div style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--border, #2a2a35)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text, #e8e8e8)', flex: 1 }}>
            Pick {opts?.label || 'a file'}
            {opts?.exts?.length ? (
              <span style={{ opacity: 0.5, fontWeight: 400, marginLeft: 8, fontSize: 11 }}>
                .{opts.exts.join(' / .')}
              </span>
            ) : null}
          </span>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: 'var(--text-muted, #888)',
            fontSize: 18, cursor: 'pointer', padding: '0 4px',
          }}>×</button>
        </div>

        <div style={{ padding: '10px 14px', display: 'flex', gap: 6, alignItems: 'center' }}>
          {listing.parent && (
            <button onClick={() => setPath(listing.parent)} style={{
              background: 'var(--bg-card, #1a1a24)',
              border: '1px solid var(--border, #2a2a35)',
              color: 'var(--text, #e8e8e8)',
              padding: '5px 9px',
              borderRadius: 5,
              cursor: 'pointer',
              fontSize: 12,
            }} title="Go up">↑</button>
          )}
          <input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') setPath(pathInput); }}
            placeholder="path"
            style={{
              flex: 1,
              padding: '6px 10px',
              fontSize: 11,
              fontFamily: 'JetBrains Mono, ui-monospace, Consolas, monospace',
              background: 'var(--bg-card, #1a1a24)',
              border: '1px solid var(--border, #2a2a35)',
              borderRadius: 5,
              color: 'var(--text, #e8e8e8)',
            }}
          />
          <button onClick={() => setPath(pathInput)} style={{
            background: 'var(--bg-card, #1a1a24)',
            border: '1px solid var(--border, #2a2a35)',
            color: 'var(--text, #e8e8e8)',
            padding: '5px 12px',
            borderRadius: 5,
            cursor: 'pointer',
            fontSize: 12,
          }}>Go</button>
        </div>

        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '4px 8px 8px',
          minHeight: 200,
        }}>
          {loading && <div style={{ padding: 14, fontSize: 12, opacity: 0.6 }}>Loading…</div>}
          {err && <div style={{ padding: 14, fontSize: 12, color: '#e74c3c' }}>{err}</div>}
          {!loading && !err && listing.dirs.length === 0 && listing.files.length === 0 && (
            <div style={{ padding: 14, fontSize: 12, opacity: 0.5 }}>
              empty {opts?.exts?.length ? `(no .${opts.exts.join('/.')} files here)` : ''}
            </div>
          )}
          {listing.dirs.map(d => (
            <div
              key={d.path}
              onClick={() => setPath(d.path)}
              style={{
                padding: '7px 10px',
                cursor: 'pointer',
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                borderRadius: 4,
                color: 'var(--text, #e8e8e8)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-card, #1a1a24)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontSize: 13 }}>📁</span>
              <span>{d.name}</span>
            </div>
          ))}
          {listing.files.map(f => {
            const isSelected = selected === f.path;
            return (
              <div
                key={f.path}
                onClick={() => setSelected(f.path)}
                onDoubleClick={() => pick(f.path)}
                style={{
                  padding: '7px 10px',
                  cursor: 'pointer',
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  borderRadius: 4,
                  background: isSelected ? 'var(--gold-dim, rgba(201, 162, 39, 0.18))' : 'transparent',
                  color: 'var(--text, #e8e8e8)',
                  border: isSelected ? '1px solid var(--gold, #C9A227)' : '1px solid transparent',
                }}
                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-card, #1a1a24)'; }}
                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ fontSize: 13 }}>📄</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                <span style={{ opacity: 0.5, fontSize: 10, fontFamily: 'monospace' }}>{formatSize(f.size)}</span>
              </div>
            );
          })}
        </div>

        <div style={{
          padding: '10px 14px',
          borderTop: '1px solid var(--border, #2a2a35)',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
        }}>
          <span style={{ flex: 1, fontSize: 11, opacity: 0.55, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {opts?.pickFolder
              ? `pick this folder: ${path.replace(/^.*[\\/]/, '') || path}`
              : (selected ? selected.replace(/^.*[\\/]/, '') : 'double-click a file, or select + Pick')}
          </span>
          <button onClick={onClose} style={{
            background: 'transparent',
            border: '1px solid var(--border, #2a2a35)',
            color: 'var(--text-muted, #888)',
            padding: '6px 14px',
            borderRadius: 5,
            cursor: 'pointer',
            fontSize: 12,
          }}>Cancel</button>
          <button
            onClick={() => pick(opts?.pickFolder ? path : selected)}
            disabled={opts?.pickFolder ? !path : !selected}
            style={{
              background: (opts?.pickFolder ? path : selected) ? 'var(--gold, #C9A227)' : 'var(--bg-card, #1a1a24)',
              border: '1px solid ' + ((opts?.pickFolder ? path : selected) ? 'var(--gold, #C9A227)' : 'var(--border, #2a2a35)'),
              color: (opts?.pickFolder ? path : selected) ? '#0a0a0f' : 'var(--text-muted, #666)',
              padding: '6px 18px',
              borderRadius: 5,
              cursor: (opts?.pickFolder ? path : selected) ? 'pointer' : 'not-allowed',
              fontSize: 12,
              fontWeight: 700,
            }}
          >{opts?.pickFolder ? 'Pick this folder' : 'Pick'}</button>
        </div>
      </div>
    </div>
  );
}

/* ===== LAST-ERROR PILL — floating top-right copy affordance =================
   Scans nodeOutputs for any entry with an `error` field, surfaces them in a
   single click-to-copy pill. Click → clipboard gets all active errors with
   nodeId + nodeType prefix per entry. Hidden when no errors. Solves the
   "screenshot the error and paste here" friction (2026-05-11). */
function LastErrorPill({ nodeOutputs, nodes }) {
  const [copied, setCopied] = useState(false);
  const errors = useMemo(() => {
    const out = [];
    for (const [nid, no] of Object.entries(nodeOutputs || {})) {
      if (no?.error) {
        const node = nodes?.find(n => n.id === nid);
        out.push({ nodeId: nid, nodeType: node?.type || 'unknown', error: String(no.error) });
      }
    }
    return out;
  }, [nodeOutputs, nodes]);

  if (errors.length === 0) return null;

  const copy = async (e) => {
    e.stopPropagation();
    const text = errors.map(x => `[${x.nodeType} · ${x.nodeId}]\n${x.error}`).join('\n\n---\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked — user can still expand the node to see error */ }
  };

  const single = errors[0];
  const preview = single.error.length > 70 ? single.error.slice(0, 70) + '…' : single.error;

  return (
    <div
      onClick={copy}
      title={`Copy ${errors.length} active error${errors.length > 1 ? 's' : ''} to clipboard`}
      style={{
        position: 'absolute',
        top: 14,
        right: 14,
        zIndex: 50,
        background: copied ? 'rgba(46, 204, 113, 0.95)' : 'rgba(231, 76, 60, 0.95)',
        color: '#fff',
        padding: '9px 14px',
        borderRadius: 10,
        fontSize: 12,
        fontWeight: 600,
        maxWidth: 380,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        cursor: 'pointer',
        boxShadow: copied ? '0 4px 16px rgba(46, 204, 113, 0.4)' : '0 4px 16px rgba(231, 76, 60, 0.4)',
        border: '1px solid rgba(255,255,255,0.25)',
        transition: 'background 0.2s, box-shadow 0.2s',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <span style={{ fontSize: 14 }}>{copied ? '✓' : '⚠'}</span>
      <span style={{
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontFamily: 'JetBrains Mono, ui-monospace, Consolas, monospace',
        fontSize: 11,
        fontWeight: 500,
      }}>
        {copied
          ? `copied ${errors.length} error${errors.length > 1 ? 's' : ''}`
          : errors.length === 1
            ? `${single.nodeType}: ${preview}`
            : `${errors.length} errors — click to copy all`}
      </span>
      <span style={{ fontSize: 13, opacity: 0.9 }}>{copied ? '' : '📋'}</span>
    </div>
  );
}

// Module-scope helper: pick the URL to emit on the SpriteForge output wire.
// Prefers the pinned result (if done), otherwise falls back to latest done.
function pickEmittedUrl(results, pinned) {
  if (pinned) {
    const pin = results.find(r => r.id === pinned && r.status === 'done');
    if (pin) return pin.url;
  }
  for (let i = results.length - 1; i >= 0; i--) {
    if (results[i].status === 'done') return results[i].url;
  }
  return '';
}

function CanvasInner() {
  const { characters } = useCharacters();
  const { apiKey, model, setApiKey, setModel } = useApiSettings();
  const { screenToFlowPosition } = useReactFlow();
  // Recipe system — canvas-level workflow templates. Operator picks from the
  // top-center dropdown; the ASCII wiring diagram appears as a draggable label
  // on the canvas. See src/canvas/recipes.js.
  const [selectedRecipeId, setSelectedRecipeId] = useState(null);
  const selectedRecipe = selectedRecipeId ? getRecipeById(selectedRecipeId) : null;
  // File picker — single global modal, opened on demand by any node. Per-node
  // opts: { startDir, exts, label, key }. `key` is the localStorage slot for
  // remembering the last-used directory per node-type.
  const [filePickerState, setFilePickerState] = useState({ open: false, opts: null, onPicked: null });
  const openFilePicker = useCallback((opts, onPicked) => {
    let startDir = opts.startDir || '';
    if (opts.key) {
      try {
        const recents = JSON.parse(localStorage.getItem('filepicker-recents') || '{}');
        if (recents[opts.key]) startDir = recents[opts.key];
      } catch { /* localStorage may be unavailable */ }
    }
    setFilePickerState({ open: true, opts: { ...opts, startDir }, onPicked });
  }, []);
  const closeFilePicker = useCallback(() => {
    setFilePickerState({ open: false, opts: null, onPicked: null });
  }, []);
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);

  // Onboarding gate — first-run modal with template picker + API keys
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try { return !localStorage.getItem(ONBOARDING_KEY); }
    catch { return false; }
  });
  // KIE key isn't in useApiSettings; mirror localStorage directly so the modal can collect it.
  const [kieKey, setKieKeyState] = useState(() => localStorage.getItem('kie-api-key') || '');
  const setKieKey = (v) => { setKieKeyState(v); try { localStorage.setItem('kie-api-key', v); } catch { /* noop */ } };
  const dismissOnboarding = () => {
    try { localStorage.setItem(ONBOARDING_KEY, '1'); } catch { /* noop */ }
    setShowOnboarding(false);
  };
  const [showPanel, setShowPanel] = useState(false);
  const [showVideoPanel, setShowVideoPanel] = useState(false);
  const [script, setScript] = useState('');
  const [prompts, setPrompts] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState(null);
  const [kieResult, setKieResult] = useState({ status: 'idle', url: '', taskId: '', elapsed: 0, error: '' });
  const [gamiResult, setGamiResult] = useState({ status: 'idle', url: '', taskId: '', elapsed: 0, error: '' });
  // nodeOutputs declared after restored useMemo below so it can hydrate from localStorage.

  // Initial canvas is empty by design (2026-04-25). New operators get the
  // onboarding modal which drops a curated template; returning operators
  // get whatever they saved last. Characters, script-type groups, conversion-
  // level groups, and the ElevenLabs/Caption outputs all live in the side
  // palette — drag-on-demand instead of pre-loaded clutter.
  const initial = useMemo(() => ({ nodes: [], edges: [] }), []);

  // Restore the full canvas — nodes + edges + nodeOutputs (v5+).
  // Saved state is authoritative: if the operator deleted a node and saved,
  // it stays deleted on reload. (Earlier merge-with-initial behavior was
  // removed because it caused deleted-default nodes to spontaneously
  // reappear after refresh.) Older v4 saves stored only positions and are
  // discarded on version mismatch; the canvas comes back empty and the
  // onboarding modal handles first-load UX.
  const restored = useMemo(() => {
    try {
      const saved = localStorage.getItem(CANVAS_KEY);
      if (!saved) return null;
      const parsed = JSON.parse(saved);
      if (parsed.version !== CANVAS_VERSION) return null;
      if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;
      // Migration 2026-04-25: strip `deletable: false` from previously pinned
      // initial nodes (characters, group containers, preset outputs). These
      // are now palette-addable, so they should also be removable.
      const liberatedNodes = parsed.nodes.map((n) => {
        if (n.deletable === false) {
          // eslint-disable-next-line no-unused-vars
          const { deletable, ...rest } = n;
          return rest;
        }
        return n;
      });
      // Drop ghost outputs — entries whose node no longer exists (deleted
      // after its last output landed). A stale errored entry would otherwise
      // resurface on every reload as an error pill labeled "unknown" with no
      // node on the canvas to anchor or clear it.
      const savedOutputs = parsed.nodeOutputs && typeof parsed.nodeOutputs === 'object' ? parsed.nodeOutputs : {};
      const liveIds = new Set(liberatedNodes.map((n) => n.id));
      const prunedOutputs = {};
      for (const [nid, out] of Object.entries(savedOutputs)) {
        if (liveIds.has(nid)) prunedOutputs[nid] = out;
      }
      return {
        nodes: liberatedNodes,
        edges: parsed.edges,
        // Scrub on restore too: heals saves written before the save-side
        // per-field scrub existed (a persisted renderStatus:'rendering'
        // otherwise bricks the node's button until the node is deleted).
        nodeOutputs: scrubEphemeralOutputs(prunedOutputs),
      };
    } catch { return null; }
  }, []);

  const [nodes, setNodes, onNodesChange] = useNodesState(restored?.nodes || initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(restored?.edges || initial.edges);
  const [nodeOutputs, setNodeOutputs] = useState(() => restored?.nodeOutputs || {});

  // Conductor needs to read current nodes/edges/outputs inside async callbacks
  // without stale closures. Render-time ref sync is the established no-useEffect
  // alternative used across this file.
  const nodesRef = useRef(nodes);            nodesRef.current = nodes;
  const edgesRef = useRef(edges);            edgesRef.current = edges;
  const nodeOutputsRef = useRef(nodeOutputs); nodeOutputsRef.current = nodeOutputs;

  // Persist the full canvas — nodes + edges + nodeOutputs — debounced to 1s
  // so rapid node drags / edge connects don't thrash localStorage.
  // In-flight statuses are dropped (they can't resume across reloads).
  // Quota-exceeded falls back to nodes + edges only (drops nodeOutputs).
  useEffect(() => {
    const t = setTimeout(() => {
      const cleanOutputs = scrubEphemeralOutputs(nodeOutputs);
      const fullPayload = JSON.stringify({ version: CANVAS_VERSION, nodes, edges, nodeOutputs: cleanOutputs });
      try {
        localStorage.setItem(CANVAS_KEY, fullPayload);
      } catch {
        // QuotaExceededError — likely from large image/video URL bundles in nodeOutputs.
        // Fall back to nodes + edges only so wiring at least survives.
        try {
          localStorage.setItem(CANVAS_KEY, JSON.stringify({ version: CANVAS_VERSION, nodes, edges, nodeOutputs: {} }));
        } catch { /* localStorage unavailable — give up gracefully */ }
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [nodes, edges, nodeOutputs]);

  const onConnect = useCallback((params) => {
    // Tag edge with source node type + accent color for glow
    const sourceNode = nodes.find(n => n.id === params.source);
    const sourceType = sourceNode?.type || '';
    // For type nodes, distinguish script types (blue) from conversion levels (purple)
    let accentOverride = null;
    if (sourceType === 'type') {
      accentOverride = sourceNode?.data?.cvId ? '#c27adb' : '#5b8def';
    }
    setEdges((eds) => addEdge({ ...params, type: 'pulse', data: { sourceType, color: accentOverride } }, eds));
  }, [setEdges, nodes]);

  // Drag-and-drop from palette
  const onDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/reactflow-type');
    if (!type) return;
    let data = {};
    try { data = JSON.parse(e.dataTransfer.getData('application/reactflow-data') || '{}'); } catch {}
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    _dropId += 1;

    // Special-case spawning for templated palette items that need more than
    // one node (character, group-with-children). Default path: single node.
    let newNodes;

    if (type === 'character' && data.characterId) {
      const c = characters.find(ch => ch.id === data.characterId);
      if (!c) return;
      newNodes = [{ id: `drop-character-${_dropId}`, type: 'character', position, data: { character: c } }];
    } else if (type === 'group-script-types') {
      const groupId = `drop-group-st-${_dropId}`;
      const groupH = 32 + scriptTypes.length * 58;
      newNodes = [
        { id: groupId, type: 'group', position, style: { width: 195, height: groupH }, data: { label: 'Script Types', variant: 'st' } },
        ...scriptTypes.map((st, i) => ({
          id: `drop-st-${st.id}-${_dropId}`,
          type: 'type',
          position: { x: 15, y: 28 + i * 58 },
          parentId: groupId,
          expandParent: true,
          data: { name: st.name, meta: st.duration, stId: st.id },
        })),
      ];
    } else if (type === 'group-conversion-levels') {
      const groupId = `drop-group-cv-${_dropId}`;
      const groupH = 32 + conversionLevels.length * 58;
      newNodes = [
        { id: groupId, type: 'group', position, style: { width: 195, height: groupH }, data: { label: 'Conversion Levels', variant: 'cv' } },
        ...conversionLevels.map((cl, i) => ({
          id: `drop-cv-${cl.id}-${_dropId}`,
          type: 'type',
          position: { x: 15, y: 28 + i * 58 },
          parentId: groupId,
          expandParent: true,
          data: { name: cl.name, meta: cl.ratio, cvId: cl.id },
        })),
      ];
    } else {
      newNodes = [{ id: `drop-${type}-${_dropId}`, type, position, data: { ...data } }];
    }

    setNodes((nds) => [...nds, ...newNodes]);
  }, [screenToFlowPosition, setNodes, characters]);

  // Apply an onboarding template — drop its pre-positioned nodes onto the canvas
  // (no auto-wiring; operator drags connections themselves to learn the gesture).
  const applyTemplate = useCallback((templateId) => {
    const tpl = CANVAS_TEMPLATES.find(t => t.id === templateId);
    if (!tpl) { dismissOnboarding(); return; }
    const newNodes = tpl.nodes.map((n) => {
      _onboardingDropId += 1;
      return {
        id: `tpl-${n.type}-${_onboardingDropId}`,
        type: n.type,
        position: n.position,
        data: {},
      };
    });
    setNodes((nds) => [...nds, ...newNodes]);
    dismissOnboarding();
  }, [setNodes]);

  // Resolve pipeline from current connections
  const resolved = useMemo(() => resolvePipeline(nodes, edges), [nodes, edges]);

  // Determine status
  let status = 'idle';
  if (isGenerating) status = 'generating';
  else if (script) status = 'done';
  else if (resolved.count === 4 && apiKey) status = 'ready';

  // Actions
  const onSpawn = useCallback((charNodeId) => {
    setNodes((cur) => {
      const cn = cur.find((n) => n.id === charNodeId);
      if (!cn?.data?.character) return cur;
      const charId = cn.data.character.id;
      // Guard: if ingredient nodes already exist, don't re-spawn
      if (cur.some((n) => n.id.startsWith(`pp-${charId}-`) || n.id.startsWith(`hk-${charId}-`))) return cur;
      const { nodes: nn, edges: ne } = spawnIngredients(cn.data.character, charNodeId, cn.position);
      // Clean up any stale edges with same IDs before adding fresh ones
      const newIds = new Set(ne.map((e) => e.id));
      setEdges((eds) => [...eds.filter((e) => !newIds.has(e.id)), ...ne]);
      return [...cur, ...nn];
    });
  }, [setNodes, setEdges]);

  const onDespawn = useCallback((charId) => {
    const isIngredient = (id) => id.startsWith(`pp-${charId}-`) || id.startsWith(`hk-${charId}-`);
    // Compute wired set inside setEdges updater, then coordinate node removal from there
    setEdges((curEdges) => {
      // Ingredients wired to ANY non-character, non-ingredient node are protected from collapse
      const wired = new Set();
      curEdges.forEach((e) => {
        if (isIngredient(e.source) && !isIngredient(e.target) && !e.target.startsWith('char-')) wired.add(e.source);
      });
      // Remove unwired ingredient nodes
      setNodes((curNodes) => curNodes.filter((n) => !isIngredient(n.id) || wired.has(n.id)));
      // Remove edges touching unwired ingredients
      return curEdges.filter((e) => {
        if (isIngredient(e.source) && !wired.has(e.source)) return false;
        if (isIngredient(e.target) && !wired.has(e.target)) return false;
        return true;
      });
    });
  }, [setNodes, setEdges]);

  const hasIngredients = useCallback((charId) => {
    return nodes.some((n) => n.id.startsWith(`pp-${charId}-`) || n.id.startsWith(`hk-${charId}-`));
  }, [nodes]);

  const onGenerate = useCallback(async (overrideNodeId) => {
    if (!resolved.character || resolved.count < 4) return;
    setIsGenerating(true);
    setGenError(null);
    // If called from a UGC Gen node, also write to nodeOutputs
    if (overrideNodeId) {
      setNodeOutputs((prev) => ({ ...prev, [overrideNodeId]: { status: 'generating', script: '', prompts: null, error: '' } }));
    }
    try {
      const sys = buildSystemPrompt(resolved.character, resolved.selections);
      const usr = buildUserPrompt(resolved.character, resolved.selections);
      const res = await fetch('http://localhost:3001/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, model, system: sys, messages: [{ role: 'user', content: usr }] }),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      const text = data.content?.[0]?.text || '';
      setScript(text);
      const prodPrompts = buildProductionPrompts(resolved.character, resolved.selections, text);
      setPrompts(prodPrompts);
      if (overrideNodeId) {
        setNodeOutputs((prev) => ({ ...prev, [overrideNodeId]: { status: 'done', script: text, prompts: prodPrompts, character: resolved.character, error: '' } }));
      }
    } catch (err) {
      setGenError(err.message);
      if (overrideNodeId) {
        setNodeOutputs((prev) => ({ ...prev, [overrideNodeId]: { status: 'error', script: '', prompts: null, error: err.message } }));
      }
    } finally {
      setIsGenerating(false);
    }
  }, [resolved, apiKey, model]);

  const onCopyPrompt = useCallback(async () => {
    if (!resolved.character || resolved.count < 4) return;
    await navigator.clipboard.writeText(buildClipboardPrompt(resolved.character, resolved.selections)).catch(() => {});
  }, [resolved]);

  const onDeleteNode = useCallback((nodeId) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    // Drop the node's output too — a leftover entry (e.g. an error) has no
    // node to anchor it, so it would persist and resurface as an "unknown"
    // error pill on the next reload.
    setNodeOutputs((prev) => {
      if (!(nodeId in prev)) return prev;
      const next = { ...prev };
      delete next[nodeId];
      return next;
    });
  }, [setNodes, setEdges]);

  // kie.ai video generation with polling
  const kieTimerRef = { current: null };
  const onKieGenerate = useCallback(async (kieKey, prompt, duration) => {
    if (!kieKey || !prompt) return;
    setKieResult({ status: 'submitting', url: '', taskId: '', elapsed: 0, error: '' });
    try {
      const res = await fetch('http://localhost:3001/api/kie/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: kieKey, prompt, aspectRatio: '9:16', duration }),
      });
      const data = await res.json();
      if (!res.ok || !data?.data?.taskId) throw new Error(data?.error || 'Failed to create task');
      const taskId = data.data.taskId;
      setKieResult((prev) => ({ ...prev, status: 'polling', taskId }));

      // Poll every 15s for up to 10 minutes
      let elapsed = 0;
      const poll = async () => {
        elapsed += 15;
        setKieResult((prev) => ({ ...prev, elapsed }));
        try {
          const pr = await fetch(`http://localhost:3001/api/kie/status/${taskId}`, { headers: { 'x-kie-key': kieKey } });
          const pd = await pr.json();
          const taskStatus = pd?.data?.status;
          if (taskStatus === 'completed' || taskStatus === 'succeed') {
            const resultJson = JSON.parse(pd.data.resultJson || '{}');
            const url = resultJson.resultUrls?.[0] || '';
            setKieResult({ status: 'done', url, taskId, elapsed, error: '' });
            return;
          }
          if (taskStatus === 'failed') {
            setKieResult((prev) => ({ ...prev, status: 'error', error: 'Generation failed' }));
            return;
          }
          if (elapsed >= 600) {
            setKieResult((prev) => ({ ...prev, status: 'error', error: 'Timeout (10 min)' }));
            return;
          }
          setTimeout(poll, 15000);
        } catch (pollErr) {
          setKieResult((prev) => ({ ...prev, status: 'error', error: pollErr.message }));
        }
      };
      setTimeout(poll, 15000);
    } catch (err) {
      setKieResult({ status: 'error', url: '', taskId: '', elapsed: 0, error: err.message });
    }
  }, []);

  const onGamiGenerate = useCallback(async (kieKey, prompt, resolution, ar) => {
    if (!kieKey || !prompt) return;
    setGamiResult({ status: 'submitting', url: '', taskId: '', elapsed: 0, error: '' });
    try {
      const res = await fetch('http://localhost:3001/api/kie/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: kieKey,
          model: 'nano-banana-pro',
          input: { prompt, image_input: [], aspect_ratio: ar || '1:1', resolution: resolution || '2K', output_format: 'png' },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.data?.taskId) throw new Error(data?.error || 'Failed to create task');
      const taskId = data.data.taskId;
      setGamiResult((prev) => ({ ...prev, status: 'polling', taskId }));

      let elapsed = 0;
      const poll = async () => {
        elapsed += 10;
        setGamiResult((prev) => ({ ...prev, elapsed }));
        try {
          const pr = await fetch(`http://localhost:3001/api/kie/status/${taskId}`, { headers: { 'x-kie-key': kieKey } });
          const pd = await pr.json();
          const st = pd?.data?.state || pd?.data?.status;
          if (st === 'success' || st === 'completed' || st === 'succeed') {
            const resultJson = JSON.parse(pd.data.resultJson || '{}');
            const url = resultJson.resultUrls?.[0] || '';
            setGamiResult({ status: 'done', url, taskId, elapsed, error: '' });
            return;
          }
          if (st === 'fail' || st === 'failed') {
            setGamiResult((prev) => ({ ...prev, status: 'error', error: pd.data?.failMsg || 'Generation failed' }));
            return;
          }
          if (elapsed >= 300) {
            setGamiResult((prev) => ({ ...prev, status: 'error', error: 'Timeout (5 min)' }));
            return;
          }
          setTimeout(poll, 10000);
        } catch (pollErr) {
          setGamiResult((prev) => ({ ...prev, status: 'error', error: pollErr.message }));
        }
      };
      setTimeout(poll, 10000);
    } catch (err) {
      setGamiResult({ status: 'error', url: '', taskId: '', elapsed: 0, error: err.message });
    }
  }, []);

  // GPT Image-2 via kie.ai — per-node state so multiple instances can run independently.
  // Image-2 batch generation — parallel kie.ai gpt-image-2-text-to-image tasks.
  // Mirrors onGamiArtBatchGenerate so downstream consumers (frame-sandwich, carousel,
  // remotion-compositor) get the same .slides[] shape regardless of source.
  const onImageTwoBatchGenerate = useCallback(async (nodeId, kieKey, prompts, aspectRatio) => {
    if (!kieKey || !prompts?.length) return;
    const initial = prompts.map(() => ({ status: 'submitting', url: '', taskId: '', elapsed: 0, error: '' }));
    setNodeOutputs((prev) => ({ ...prev, [nodeId]: { batchStatus: 'generating', slides: initial } }));

    const updateSlide = (index, patch) => {
      setNodeOutputs((prev) => {
        const node = prev[nodeId] || {};
        const slides = [...(node.slides || [])];
        slides[index] = { ...slides[index], ...patch };
        const allDone = slides.every(s => s.status === 'done' || s.status === 'error');
        // Also surface .url of the first done slide for single-image consumers
        const firstDone = slides.find(s => s.status === 'done' && s.url);
        return {
          ...prev,
          [nodeId]: {
            ...node,
            slides,
            batchStatus: allDone ? 'done' : 'generating',
            url: firstDone?.url || '',
          },
        };
      });
    };

    for (let i = 0; i < prompts.length; i++) {
      (async (idx) => {
        try {
          const input = { prompt: prompts[idx], nsfw_checker: false };
          if (aspectRatio && aspectRatio !== 'auto') input.aspect_ratio = aspectRatio;
          const res = await fetch('http://localhost:3001/api/kie/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: kieKey, model: 'gpt-image-2-text-to-image', input }),
          });
          const data = await res.json();
          if (!res.ok || !data?.data?.taskId) throw new Error(data?.error || 'Failed to create task');
          const taskId = data.data.taskId;
          updateSlide(idx, { status: 'polling', taskId });

          let elapsed = 0;
          const poll = async () => {
            elapsed += 10;
            updateSlide(idx, { elapsed });
            try {
              const pr = await fetch(`http://localhost:3001/api/kie/status/${taskId}`, { headers: { 'x-kie-key': kieKey } });
              const pd = await pr.json();
              const st = pd?.data?.state || pd?.data?.status;
              if (st === 'success' || st === 'completed' || st === 'succeed') {
                const resultJson = JSON.parse(pd.data.resultJson || '{}');
                const url = resultJson.resultUrls?.[0] || '';
                updateSlide(idx, { status: 'done', url, elapsed });
                return;
              }
              if (st === 'fail' || st === 'failed') {
                updateSlide(idx, { status: 'error', error: pd.data?.failMsg || 'Generation failed' });
                return;
              }
              if (elapsed >= 300) {
                updateSlide(idx, { status: 'error', error: 'Timeout (5 min)' });
                return;
              }
              setTimeout(poll, 10000);
            } catch (pollErr) {
              updateSlide(idx, { status: 'error', error: pollErr.message });
            }
          };
          setTimeout(poll, 10000);
        } catch (err) {
          updateSlide(idx, { status: 'error', error: err.message });
        }
      })(i);
    }
  }, []);

  // Batch kie.ai image generation — fires all slides in parallel, polls each independently
  const onGamiArtBatchGenerate = useCallback(async (nodeId, kieKey, prompts, resolution, ar) => {
    if (!kieKey || !prompts?.length) return;
    const initial = prompts.map(() => ({ status: 'submitting', url: '', taskId: '', elapsed: 0, error: '' }));
    setNodeOutputs((prev) => ({ ...prev, [nodeId]: { batchStatus: 'generating', slides: initial } }));

    const updateSlide = (index, patch) => {
      setNodeOutputs((prev) => {
        const node = prev[nodeId] || {};
        const slides = [...(node.slides || [])];
        slides[index] = { ...slides[index], ...patch };
        const allDone = slides.every(s => s.status === 'done' || s.status === 'error');
        return { ...prev, [nodeId]: { ...node, slides, batchStatus: allDone ? 'done' : 'generating' } };
      });
    };

    // Fire each slide as a parallel task
    for (let i = 0; i < prompts.length; i++) {
      (async (idx) => {
        try {
          const res = await fetch('http://localhost:3001/api/kie/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              apiKey: kieKey,
              model: 'nano-banana-pro',
              input: { prompt: prompts[idx], image_input: [], aspect_ratio: ar || '1:1', resolution: resolution || '2K', output_format: 'png' },
            }),
          });
          const data = await res.json();
          if (!res.ok || !data?.data?.taskId) throw new Error(data?.error || 'Failed to create task');
          const taskId = data.data.taskId;
          updateSlide(idx, { status: 'polling', taskId });

          let elapsed = 0;
          const poll = async () => {
            elapsed += 10;
            updateSlide(idx, { elapsed });
            try {
              const pr = await fetch(`http://localhost:3001/api/kie/status/${taskId}`, { headers: { 'x-kie-key': kieKey } });
              const pd = await pr.json();
              const st = pd?.data?.state || pd?.data?.status;
              if (st === 'success' || st === 'completed' || st === 'succeed') {
                const resultJson = JSON.parse(pd.data.resultJson || '{}');
                const url = resultJson.resultUrls?.[0] || '';
                updateSlide(idx, { status: 'done', url, elapsed });
                return;
              }
              if (st === 'fail' || st === 'failed') {
                updateSlide(idx, { status: 'error', error: pd.data?.failMsg || 'Generation failed' });
                return;
              }
              if (elapsed >= 300) {
                updateSlide(idx, { status: 'error', error: 'Timeout (5 min)' });
                return;
              }
              setTimeout(poll, 10000);
            } catch (pollErr) {
              updateSlide(idx, { status: 'error', error: pollErr.message });
            }
          };
          setTimeout(poll, 10000);
        } catch (err) {
          updateSlide(idx, { status: 'error', error: err.message });
        }
      })(i);
    }
  }, []);

  // ── Sprite Forge sequential queue ─────────────────────────────────────────
  // Three callbacks defined in dependency order so each setTimeout closure
  // resolves the name at call-time (not definition-time), avoiding
  // "Cannot access before initialization" with circular useCallback refs.

  // startKieJob — calls maybeStartNextJob (via setTimeout → late binding OK)
  const startKieJob = useCallback(async (nodeId, kieKey) => {
    // Find the current polling slot that doesn't yet have a taskId.
    // React anti-pattern caveat: we read state via the setter's prev arg and
    // stash into an outer closure. This is safe here because (a) we're called
    // from setTimeout/event handlers (synchronous flush, no concurrent
    // transitions), (b) the closure assignment is idempotent so StrictMode
    // double-invocation is harmless. If PT15 browser testing reveals any
    // "pollingSlot always null" bugs, refactor to a useRef mirror of nodeOutputs.
    let pollingSlot = null;
    setNodeOutputs((prev) => {
      const node = prev[nodeId];
      if (!node) return prev;
      pollingSlot = (node.results || []).find(r => r.status === 'polling' && !r.taskId);
      return prev;
    });
    if (!pollingSlot) return;
    const { id: slotId, prompt, provider, ar } = pollingSlot;

    const patchSlot = (patch) => {
      setNodeOutputs((prev) => {
        const node = prev[nodeId] || {};
        const results = (node.results || []).map(r => r.id === slotId ? { ...r, ...patch } : r);
        const stillPolling = results.some(r => r.status === 'polling');
        const queueEmpty = (node.queue || []).length === 0;
        const batchStatus = stillPolling || !queueEmpty
          ? 'generating'
          : results.some(r => r.status === 'done') ? 'done'
          : results.some(r => r.status === 'error') ? 'error'
          : 'idle';
        return {
          ...prev,
          [nodeId]: {
            ...node,
            results,
            batchStatus,
            url: pickEmittedUrl(results, node.pinned ?? null),
          },
        };
      });
    };

    const finishSlot = (patch) => {
      patchSlot(patch);
      setTimeout(() => maybeStartNextJob(nodeId, kieKey), 0);
    };

    try {
      const input = provider === 'image-2'
        ? { prompt, nsfw_checker: false, ...(ar && ar !== 'auto' ? { aspect_ratio: ar } : {}) }
        : { prompt, image_input: [], aspect_ratio: ar || '1:1', resolution: '2K', output_format: 'png' };
      const model = provider === 'image-2' ? 'gpt-image-2-text-to-image' : 'nano-banana-pro';
      const res = await fetch('http://localhost:3001/api/kie/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: kieKey, model, input }),
      });
      const data = await res.json();
      if (!res.ok || !data?.data?.taskId) throw new Error(data?.error || 'Failed to create task');
      const taskId = data.data.taskId;
      patchSlot({ taskId });

      let elapsed = 0;
      const poll = async () => {
        elapsed += 10;
        patchSlot({ elapsed });
        try {
          const pr = await fetch(`http://localhost:3001/api/kie/status/${taskId}`, { headers: { 'x-kie-key': kieKey } });
          const pd = await pr.json();
          const st = pd?.data?.state || pd?.data?.status;
          if (st === 'success' || st === 'completed' || st === 'succeed') {
            const resultJson = JSON.parse(pd.data.resultJson || '{}');
            const url = resultJson.resultUrls?.[0] || '';
            finishSlot({ status: 'done', url, elapsed });
            return;
          }
          if (st === 'fail' || st === 'failed') {
            finishSlot({ status: 'error', error: pd.data?.failMsg || 'Generation failed', elapsed });
            return;
          }
          if (elapsed >= 300) {
            finishSlot({ status: 'error', error: 'Timeout (5 min)', elapsed });
            return;
          }
          setTimeout(poll, 10000);
        } catch (pollErr) {
          finishSlot({ status: 'error', error: pollErr.message, elapsed });
        }
      };
      setTimeout(poll, 10000);
    } catch (err) {
      finishSlot({ status: 'error', error: err.message });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // maybeStartNextJob — promotes queue head when no slot is polling.
  // References startKieJob via setTimeout (late binding — both consts initialized by call-time).
  const maybeStartNextJob = useCallback((nodeId, kieKey) => {
    // React anti-pattern caveat: we read state via the setter's prev arg and
    // stash into an outer closure. This is safe here because (a) we're called
    // from setTimeout/event handlers (synchronous flush, no concurrent
    // transitions), (b) the closure assignment is idempotent so StrictMode
    // double-invocation is harmless. If PT15 browser testing reveals any
    // "shouldStart never true" bugs, refactor to a useRef mirror of nodeOutputs.
    let shouldStart = false;
    setNodeOutputs((prev) => {
      const node = prev[nodeId] || {};
      const results = node.results || [];
      const queue   = node.queue   || [];
      const anyPolling = results.some(r => r.status === 'polling');
      if (anyPolling || queue.length === 0) {
        shouldStart = false;
        return prev;
      }
      const next = queue[0];
      const slot = {
        id: next.id, status: 'polling',
        prompt: next.prompt, provider: next.provider, ar: next.ar,
        url: '', taskId: '', elapsed: 0, error: '', ts: Date.now(),
      };
      const nextResults = [...results, slot];
      shouldStart = true;
      return {
        ...prev,
        [nodeId]: {
          ...node,
          results: nextResults,
          queue: queue.slice(1),
          batchStatus: 'generating',
          url: pickEmittedUrl(nextResults, node.pinned ?? null),
        },
      };
    });
    if (shouldStart) {
      setTimeout(() => startKieJob(nodeId, kieKey), 0);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // resumeKiePoll — resumes polling for a slot that ALREADY has a taskId.
  // Called on mount for any 'polling' slot that survived a localStorage restore.
  // startKieJob handles taskId-less new slots; this handles already-dispatched ones.
  const resumeKiePoll = useCallback((nodeId, kieKey, slotId) => {
    // Read the slot we're resuming. Anti-pattern caveat documented in startKieJob.
    let slotSnapshot = null;
    setNodeOutputs((prev) => {
      const node = prev[nodeId];
      if (!node) return prev;
      slotSnapshot = (node.results || []).find(r => r.id === slotId);
      return prev;
    });
    if (!slotSnapshot || slotSnapshot.status !== 'polling' || !slotSnapshot.taskId) return;
    const { taskId } = slotSnapshot;
    let elapsed = slotSnapshot.elapsed || 0;

    const patchSlot = (patch) => {
      setNodeOutputs((prev) => {
        const node = prev[nodeId] || {};
        const results = (node.results || []).map(r => r.id === slotId ? { ...r, ...patch } : r);
        const stillPolling = results.some(r => r.status === 'polling');
        const queueEmpty = (node.queue || []).length === 0;
        const batchStatus = stillPolling || !queueEmpty
          ? 'generating'
          : results.some(r => r.status === 'done') ? 'done'
          : results.some(r => r.status === 'error') ? 'error'
          : 'idle';
        return {
          ...prev,
          [nodeId]: {
            ...node,
            results,
            batchStatus,
            url: pickEmittedUrl(results, node.pinned ?? null),
          },
        };
      });
    };

    const finishSlot = (patch) => {
      patchSlot(patch);
      setTimeout(() => maybeStartNextJob(nodeId, kieKey), 0);
    };

    const poll = async () => {
      elapsed += 10;
      patchSlot({ elapsed });
      try {
        const pr = await fetch(`http://localhost:3001/api/kie/status/${taskId}`, { headers: { 'x-kie-key': kieKey } });
        const pd = await pr.json();
        const st = pd?.data?.state || pd?.data?.status;
        if (st === 'success' || st === 'completed' || st === 'succeed') {
          const resultJson = JSON.parse(pd.data.resultJson || '{}');
          const url = resultJson.resultUrls?.[0] || '';
          finishSlot({ status: 'done', url, elapsed });
          return;
        }
        if (st === 'fail' || st === 'failed') {
          finishSlot({ status: 'error', error: pd.data?.failMsg || 'Generation failed', elapsed });
          return;
        }
        if (elapsed >= 300) {
          finishSlot({ status: 'error', error: 'Timeout (5 min)', elapsed });
          return;
        }
        setTimeout(poll, 10000);
      } catch (pollErr) {
        finishSlot({ status: 'error', error: pollErr.message, elapsed });
      }
    };
    setTimeout(poll, 10000);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // onSpriteForgeGenerate — public entry point. Snapshot-at-enqueue: editing
  // fields after clicking Generate does NOT mutate the queued job.
  const onSpriteForgeGenerate = useCallback((nodeId, kieKey, prompt, provider, ar) => {
    if (!kieKey || !prompt) return;

    const jobId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `sf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    setNodeOutputs((prev) => {
      const node = prev[nodeId] || {};
      const results = node.results || [];
      const queue   = node.queue   || [];
      const pinned  = node.pinned ?? null;

      const anyPolling = results.some(r => r.status === 'polling');
      if (anyPolling) {
        // Already running — enqueue.
        const job = { id: jobId, prompt, provider, ar, snapshotAt: Date.now() };
        return {
          ...prev,
          [nodeId]: {
            ...node,
            results,
            queue: [...queue, job],
            pinned,
            batchStatus: 'generating',
            url: pickEmittedUrl(results, pinned),
          },
        };
      }

      // Start immediately — push a polling slot.
      const slot = {
        id: jobId, status: 'polling', prompt, provider, ar,
        url: '', taskId: '', elapsed: 0, error: '', ts: Date.now(),
      };
      const nextResults = [...results, slot];
      return {
        ...prev,
        [nodeId]: {
          ...node,
          results: nextResults,
          queue,
          pinned,
          batchStatus: 'generating',
          url: pickEmittedUrl(nextResults, pinned),
        },
      };
    });

    // Kick off kie.ai. If we enqueued instead of starting, maybeStartNextJob
    // is a no-op because anyPolling will be true.
    setTimeout(() => maybeStartNextJob(nodeId, kieKey), 0);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Generic handler — lets any chunk node write its full output blob to nodeOutputs[nodeId].
  // Replaces (not merges) the slot so each chunk node owns its complete output shape.
  const setChunkOutput = useCallback((nodeId, data) => {
    setNodeOutputs((prev) => ({ ...prev, [nodeId]: data }));
  }, []);

  // Generic patch helper — lets node components apply arbitrary mutations to their own
  // nodeOutputs slot without needing a dedicated CanvasView handler per interaction.
  const mutateNodeOutput = useCallback((nodeId, fn) => {
    setNodeOutputs((prev) => ({ ...prev, [nodeId]: fn(prev[nodeId] || {}) }));
  }, []);

  // UGC script generation — uses character profile + AI Content System psychology framework
  const onUgcGenerate = useCallback(async (nodeId, character, selections) => {
    if (!character) return;
    setNodeOutputs((prev) => ({ ...prev, [nodeId]: { status: 'generating', script: '', prompts: null, error: '' } }));
    try {
      const sys = buildSystemPrompt(character, selections);
      const usr = buildUserPrompt(character, selections);
      const res = await fetch('http://localhost:3001/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, model, system: sys, messages: [{ role: 'user', content: usr }] }),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      const text = data.content?.[0]?.text || '';
      const prodPrompts = buildProductionPrompts(character, selections, text);
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { status: 'done', script: text, prompts: prodPrompts, character, error: '' } }));
    } catch (err) {
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { status: 'error', script: '', prompts: null, error: err.message } }));
    }
  }, [apiKey, model]);

  // Avatar Frame — scans a local folder for images
  const onAvatarScanFolder = useCallback(async (nodeId, folderPath) => {
    if (!folderPath) return;
    setNodeOutputs((prev) => ({ ...prev, [nodeId]: { status: 'scanning', images: [], error: '' } }));
    try {
      const res = await fetch(`http://localhost:3001/api/scan-folder?path=${encodeURIComponent(folderPath)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Scan failed');
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { status: 'done', images: data.images, error: '' } }));
    } catch (err) {
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { status: 'error', images: [], error: err.message } }));
    }
  }, []);

  // Clip Splitter — parses script into 5s clip definitions with Kling prompts
  const onClipSplit = useCallback(async (nodeId, scriptText, character) => {
    if (!scriptText) return;
    setNodeOutputs((prev) => ({ ...prev, [nodeId]: { status: 'generating', clips: [], error: '' } }));

    const charId = character?.id || '';
    const brollActions = characterBroll[charId] || [`${character?.name || 'Character'} performing a characteristic action in their environment. No speaking.`];
    const speechStyle = characterSpeechStyle[charId] || `Speaks naturally as ${character?.name || 'the character'}. Conversational cadence.`;
    const continuity = characterContinuity[charId];
    const ugc = continuity?.ugc || {};
    // Strip double quotes from all character data to prevent JSON breakage in Claude's output
    const sanitize = (s) => (s || '').replace(/"/g, "'").replace(/—/g, '-').replace(/–/g, '-');
    const charDesc = sanitize(ugc.character || character?.avatar || '');
    const settingDesc = sanitize(ugc.setting || '');
    const lightingDesc = sanitize(ugc.lighting || 'Natural diffused lighting. iPhone HDR auto-exposure.');
    const paletteDesc = sanitize(ugc.palette || '');
    const styleDesc = sanitize(ugc.style || 'iPhone 15 Pro front-camera selfie with slight handheld camera shake.');
    const ambience = sanitize(characterAmbience?.[charId] || 'Natural room ambient');
    const charName = character?.name || 'Character';

    const systemPrompt = `You are a video clip planner for AI avatar UGC content. You split scripts into clips for Kling 3.0 first-frame-to-video generation.

The avatar photo is provided as the FIRST FRAME. Kling animates from that photo. Your prompt tells Kling WHAT THE CHARACTER DOES — the action, the speaking, the emotion. The prompt must be rich and detailed so Kling produces realistic results.

CLIP RULES:
- TALKING clips: 9 seconds. Dialogue MUST be 22 words or fewer (~2.5 words/sec, slow deliberate pacing). Pack 1-2 short sentences per clip.
- B-ROLL clips: 10 seconds. NO dialogue, NO lip movement. Voiceover added in post.
- MAXIMUM 7 clips, MAXIMUM 63 seconds total. Aim for 5-6 clips.
- Structure: 1 hook (9s) + 3-4 dialogue (9s each) + optional 1 b-roll (10s) + 1 CTA (9s)
- Merge short sentences greedily into 9s clips. Do NOT make a clip for every sentence.

FOR EACH CLIP, generate a prompt in this EXACT structure (as a single string in the "prompt" field):

VISUAL PROMPT:
CHARACTER: ${charDesc}
SETTING: ${settingDesc}
LIGHTING: ${lightingDesc}
COLOR PALETTE: ${paletteDesc}
STYLE: ${styleDesc}

SCENE ACTION:
[What ${charName} physically does in this clip — specific body language, gestures, expressions]

CAMERA:
[Camera movement — slow push-in, static medium, slight drift, etc.]

MOOD: [1-3 mood words]

PERFORMANCE (V4):
- Speaking mid-thought, not performing
- Natural pauses and micro-hesitations allowed
- Emotional restraint over theatrics
- Influencer cadence BANNED — real person energy only
- Quiet confidence over hype

DIALOGUE:
"[The exact dialogue line for this clip, or NONE for b-roll]"

BACKGROUND SOUND:
${ambience}

REALISM RULES (MANDATORY — V4):
- True handheld iPhone 15 Pro front-camera micro-shake throughout
- Mouth and lip sync remain flawless even after 12 seconds — lip sync protection critical
- Zero finger warping, zero finger overlap near camera

SPEECH STYLE: ${speechStyle}

B-ROLL OPTIONS (pick from these for b-roll clips):
${brollActions.map((a, i) => `${i + 1}. ${a}`).join('\n')}

OUTPUT FORMAT — respond with ONLY a valid JSON array. No markdown fences, no commentary.
Do NOT include a "prompt" field. Instead include these short fields that I will assemble into the final prompt:
- "scene_action": what the character physically does (1-2 sentences)
- "camera": camera movement (e.g. "Slow push-in to close-up")
- "mood": 1-3 mood words (e.g. "warm, revelatory")

NEVER use double quotes inside string values. Use single quotes. NEVER use em dashes.

[
  { "type": "hook", "duration": 9, "dialogue": "the hook line", "scene_action": "what character does", "camera": "camera move", "mood": "mood words" },
  { "type": "dialogue", "duration": 9, "dialogue": "sentence or two", "scene_action": "action", "camera": "camera", "mood": "mood" },
  { "type": "broll", "duration": 10, "dialogue": "", "scene_action": "b-roll scene description", "camera": "camera", "mood": "mood" },
  { "type": "cta", "duration": 9, "dialogue": "closing line", "scene_action": "action", "camera": "camera", "mood": "mood" }
]`;

    try {
      const res = await fetch('http://localhost:3001/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, model, system: systemPrompt, messages: [{ role: 'user', content: `Split this script into 9-second video clips:\n\n${scriptText}` }] }),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      const raw = data.content?.[0]?.text || '';
      // Parse JSON — strip markdown fences, fix newlines and bad chars inside strings
      let jsonStr = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      // Walk through and fix everything inside quoted strings: newlines, unescaped quotes, tabs
      let fixed = '';
      let inString = false;
      let escaped = false;
      for (let ci = 0; ci < jsonStr.length; ci++) {
        const ch = jsonStr[ci];
        if (escaped) { fixed += ch; escaped = false; continue; }
        if (ch === '\\') { fixed += ch; escaped = true; continue; }
        if (ch === '"') {
          // Check if this quote is inside a string and looks like an unescaped interior quote
          // Heuristic: if we're in a string and the next non-space char is NOT : , ] } then it's interior
          if (inString) {
            const rest = jsonStr.substring(ci + 1).trimStart();
            const nextChar = rest[0] || '';
            if (nextChar === ':' || nextChar === ',' || nextChar === ']' || nextChar === '}' || nextChar === '') {
              inString = false; fixed += ch; continue;
            }
            // Interior quote — escape it
            fixed += '\\"'; continue;
          }
          inString = true; fixed += ch; continue;
        }
        if (inString && (ch === '\n' || ch === '\r')) { if (ch === '\n') fixed += '\\n'; continue; }
        if (inString && ch === '\t') { fixed += '\\t'; continue; }
        fixed += ch;
      }
      let rawClips;
      try {
        rawClips = JSON.parse(fixed);
      } catch (parseErr) {
        console.error('Clip JSON parse failed. First 500 chars:', fixed.substring(0, 500));
        throw new Error(`JSON parse failed: ${parseErr.message}`);
      }
      if (!Array.isArray(rawClips)) throw new Error('Expected JSON array');

      // Lean V4 (kie 2500-char cap): the avatar photo is Kling's first frame, so it
      // already carries appearance/setting/look. Collapse the repeated visual-continuity
      // paragraphs to their first sentence (a boundary, never a mid-sentence cut) and keep
      // the V4 PERFORMANCE/REALISM guidance verbatim. The first sentence is an essence, not
      // a truncation. See docs/superpowers/specs/2026-06-13-ugc-lean-v4-prompt-cap-design.md
      const firstSentence = (s) => {
        const t = (s || '').trim();
        if (!t) return '';
        const m = t.match(/^.*?[.!?](?=\s|$)/);
        return (m ? m[0] : t).trim();
      };
      const charEssence = firstSentence(charDesc);
      const settingEssence = firstSentence(settingDesc);
      const lookEssence = firstSentence(styleDesc);
      const clips = rawClips.map(clip => {
        const isBroll = clip.type === 'broll';
        const dialogueLine = clip.dialogue ? `DIALOGUE: '${clip.dialogue}'` : 'DIALOGUE: NONE - voiceover in post';
        const perfRules = isBroll
          ? 'PERFORMANCE: NO dialogue, NO lip movement. Pure physical presence. Breathing visible.'
          : `PERFORMANCE (V4): Speaking mid-thought, not performing. Natural pauses allowed. Emotional restraint over theatrics. Influencer cadence BANNED. Quiet confidence over hype.`;
        const prompt = [
          `CHARACTER: ${charEssence}${charEssence ? ' (face & wardrobe locked by the first frame.)' : ''}`,
          `SETTING: ${settingEssence}`,
          `LOOK: ${lookEssence}`,
          `SCENE ACTION: ${clip.scene_action || clip.prompt || ''}`,
          `CAMERA: ${clip.camera || 'Static medium shot'}`,
          `MOOD: ${clip.mood || 'natural'}`,
          perfRules,
          dialogueLine,
          `BACKGROUND SOUND: ${ambience}`,
          `REALISM RULES (V4): True handheld iPhone 15 Pro front-camera micro-shake throughout. Mouth and lip sync remain flawless. Zero finger warping. Zero finger overlap near camera.`,
        ].join('\n');
        return { ...clip, prompt };
      });

      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { status: 'done', clips, error: '' } }));
    } catch (err) {
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { status: 'error', clips: [], error: err.message } }));
    }
  }, [apiKey, model]);

  // Character Scene — generates character in new scene using Avatar Frame reference
  const onCharacterSceneGenerate = useCallback(async (nodeId, kieKey, scenePrompt, refImage, genModel, aspectRatio, resolution) => {
    if (!scenePrompt?.trim()) return;
    setNodeOutputs((prev) => ({ ...prev, [nodeId]: { batchStatus: 'generating', uploadStatus: '', slides: [{ status: 'submitting', url: '', taskId: '', elapsed: 0, error: '' }] } }));

    // Upload reference image to public URL if we have one
    let refUrl = '';
    if (refImage?.path) {
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], uploadStatus: 'Uploading reference...' } }));
      try {
        const uploadRes = await fetch('http://localhost:3001/api/upload-image', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: refImage.path }),
        });
        const uploadData = await uploadRes.json();
        if (uploadRes.ok && uploadData.url) {
          refUrl = uploadData.url;
          setNodeOutputs((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], uploadStatus: `Ref uploaded (${uploadData.method || 'ok'})` } }));
        }
      } catch { /* proceed without ref */ }
    }

    // Build model-specific kie.ai body
    let taskBody;
    if (genModel === 'gpt-image-2-image-to-image') {
      taskBody = {
        apiKey: kieKey, model: 'gpt-image-2-image-to-image',
        input: { prompt: scenePrompt, input_urls: refUrl ? [refUrl] : [], aspect_ratio: aspectRatio, resolution },
      };
    } else {
      taskBody = {
        apiKey: kieKey, model: 'nano-banana-2',
        input: { prompt: scenePrompt, image_input: refUrl ? [refUrl] : [], aspect_ratio: aspectRatio, resolution, output_format: 'png' },
      };
    }

    const updateSlide = (patch) => {
      setNodeOutputs((prev) => {
        const node = prev[nodeId] || {};
        const slides = [...(node.slides || [])];
        slides[0] = { ...slides[0], ...patch };
        const done = slides[0].status === 'done' || slides[0].status === 'error';
        return { ...prev, [nodeId]: { ...node, slides, batchStatus: done ? 'done' : 'generating' } };
      });
    };

    try {
      const res = await fetch('http://localhost:3001/api/kie/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taskBody),
      });
      const data = await res.json();
      if (!res.ok || !data?.data?.taskId) throw new Error(data?.error || 'No taskId returned');
      const taskId = data.data.taskId;
      updateSlide({ status: 'polling', taskId });

      let elapsed = 0;
      const poll = async () => {
        elapsed += 10;
        updateSlide({ elapsed });
        try {
          const pr = await fetch(`http://localhost:3001/api/kie/status/${taskId}`, { headers: { 'x-kie-key': kieKey } });
          const pd = await pr.json();
          const st = pd?.data?.state || pd?.data?.status;
          if (st === 'success' || st === 'completed' || st === 'succeed') {
            const rj = JSON.parse(pd.data.resultJson || '{}');
            updateSlide({ status: 'done', url: rj.resultUrls?.[0] || '', elapsed });
            return;
          }
          if (st === 'fail' || st === 'failed') { updateSlide({ status: 'error', error: pd.data?.failMsg || 'Generation failed' }); return; }
          if (elapsed >= 300) { updateSlide({ status: 'error', error: 'Timeout (5 min)' }); return; }
          setTimeout(poll, 10000);
        } catch (err) { updateSlide({ status: 'error', error: err.message }); }
      };
      setTimeout(poll, 10000);
    } catch (err) {
      updateSlide({ status: 'error', error: err.message });
    }
  }, []);

  // Arecibo Recap — weekly transmission (GET recap, then render video+still)
  const onAreciboRecap = useCallback(async (nodeId) => {
    setNodeOutputs((prev) => ({...prev, [nodeId]: {...prev[nodeId], status: 'loading', error: ''}}));
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 60 * 1000);
    try {
      const res = await fetch('http://localhost:3001/api/arecibo/recap', {signal: ac.signal});
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'recap failed');
      setNodeOutputs((prev) => ({...prev, [nodeId]: {recap: data, status: 'done', error: ''}}));
    } catch (err) {
      const msg = err.name === 'AbortError' ? 'recap timed out (60s) — is the server running?' : err.message;
      setNodeOutputs((prev) => ({...prev, [nodeId]: {...prev[nodeId], status: 'error', error: msg}}));
    } finally {
      clearTimeout(t);
    }
  }, []);

  const onAreciboRender = useCallback(async (nodeId) => {
    let recap;
    setNodeOutputs((prev) => {
      recap = prev[nodeId]?.recap;
      return {...prev, [nodeId]: {...prev[nodeId], status: 'rendering', error: ''}};
    });
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 10 * 60 * 1000);
    try {
      if (!recap) throw new Error('generate a recap first');
      const res = await fetch('http://localhost:3001/api/arecibo/render', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({bits: recap.bits, sections: recap.sections, caption: recap.caption, weekLabel: recap.weekLabel, highlight: recap.highlight}),
        signal: ac.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'render failed');
      setNodeOutputs((prev) => ({...prev, [nodeId]: {...prev[nodeId], status: 'done', videoUrl: data.videoUrl, stillUrl: data.stillUrl}}));
    } catch (err) {
      const msg = err.name === 'AbortError' ? 'render timed out (10m) — check the server log' : err.message;
      setNodeOutputs((prev) => ({...prev, [nodeId]: {...prev[nodeId], status: 'error', error: msg}}));
    } finally {
      clearTimeout(t);
    }
  }, []);

  // ── Conductor (chat-composed pipelines) ──────────────────────────────
  // conductorBatch: { conductorId, batchId, nodes: [{id,label}], warnings,
  //                   rejectedRefs } | null  (null = no proposal pending)
  const [conductorBatch, setConductorBatch] = useState(null);
  const conductorAbortRef = useRef(null);
  const conductorBatchSeq = useRef(0);

  // System prompt compiled once per runtime-context identity (cache-friendly).
  // scriptTypes / conversionLevels are module-static imports → only characters varies.
  const conductorSystem = useMemo(
    () => compileCatalogPrompt({ characters, scriptTypes, conversionLevels }),
    [characters]
  );
  const conductorCtxData = useMemo(
    () => ({ characters, scriptTypes, conversionLevels }),
    [characters]
  );

  const onConductorSend = useCallback(async (nodeId, text) => {
    const prior = nodeOutputsRef.current?.[nodeId]?.turns || [];
    const turns = [...prior, { role: 'user', text }];
    setNodeOutputs((prev) => ({ ...prev, [nodeId]: { ...(prev[nodeId] || {}), status: 'composing', turns } }));

    const callModel = async (messages) => {
      conductorAbortRef.current?.abort();
      const ac = new AbortController();
      conductorAbortRef.current = ac;
      const resp = await fetch('http://localhost:3001/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ac.signal,
        body: JSON.stringify({
          apiKey, model: 'claude-opus-4-8', maxTokens: 8000,
          lane: 'conductor', system: conductorSystem, messages,
        }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json?.error?.message || json?.error || `API ${resp.status}`);
      return (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    };

    try {
      const apiTurns = turns.map((t) => ({ role: t.role, content: t.text }));
      let raw = await callModel(apiTurns);
      let env = parseEnvelope(raw);
      if (!env.ok) {
        // One retry with the parse error fed back as a correction turn.
        raw = await callModel([...apiTurns,
          { role: 'assistant', content: raw },
          { role: 'user', content: `Your last message failed to parse (${env.error}). Re-send as ONE raw JSON envelope { "reply", "spec" } with no code fences.` }]);
        env = parseEnvelope(raw);
      }
      if (!env.ok) {
        setNodeOutputs((prev) => ({ ...prev, [nodeId]: { ...(prev[nodeId] || {}), status: 'idle',
          turns: [...turns, { role: 'assistant', text: `Couldn't parse a proposal. Raw reply:\n${env.raw}` }] } }));
        return;
      }

      let card = null;
      if (env.spec) {
        const isRevision = conductorBatch && conductorBatch.conductorId === nodeId;
        const batchId = isRevision ? conductorBatch.batchId : ++conductorBatchSeq.current;
        // Free space: right of current content (ignore this batch's own ghosts on revision).
        const others = nodesRef.current.filter((n) => !n.id.startsWith(`cmp-${batchId}-`));
        const maxX = others.length ? Math.max(...others.map((n) => n.position?.x ?? 0)) : 0;
        const origin = { x: maxX + 420, y: 80 };
        const deps = { ctx: conductorCtxData, batchId, origin };

        const result = isRevision
          ? applyRevision(nodesRef.current, edgesRef.current, env.spec, deps, conductorBatch.rejectedRefs)
          : applySpec(env.spec, deps);

        if (!result.ok) {
          setNodeOutputs((prev) => ({ ...prev, [nodeId]: { ...(prev[nodeId] || {}), status: 'idle',
            turns: [...turns, { role: 'assistant', text: `${env.reply}\n\n⚠ Proposal rejected: ${result.error}` }] } }));
          return;
        }

        if (isRevision) {
          setNodes(result.nodes);
          setEdges(result.edges);
        } else {
          setNodes((nds) => [...nds, ...result.nodes]);
          setEdges((eds) => [...eds, ...result.edges]);
        }

        const batchNodes = result.nodes
          .filter((n) => n.id.startsWith(`cmp-${batchId}-`))
          .map((n) => ({ id: n.id, label: n.data?.label || n.data?.character?.name || CATALOG_TITLES[n.type] || n.type }));
        setConductorBatch({
          conductorId: nodeId, batchId, nodes: batchNodes,
          warnings: result.warnings,
          rejectedRefs: isRevision ? conductorBatch.rejectedRefs : [],
        });
        card = {
          lane: env.spec.lane, intent: env.spec.intent,
          nodeCount: batchNodes.length,
          edgeCount: result.edges.filter((e) => e.id.startsWith(`cmp-${batchId}-e-`)).length,
          rationale: env.spec.rationale || '', warnings: result.warnings,
        };
      }

      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { ...(prev[nodeId] || {}),
        status: env.spec ? 'reviewing' : 'idle',
        turns: [...turns, { role: 'assistant', text: env.reply, card }],
        lastSpec: env.spec || prev[nodeId]?.lastSpec || null,
        intent: env.spec?.intent || prev[nodeId]?.intent || null,
      } }));
    } catch (err) {
      if (err.name === 'AbortError') return;
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { ...(prev[nodeId] || {}), status: 'error', error: String(err.message || err),
        turns: [...turns, { role: 'assistant', text: `Error: ${err.message || err}` }] } }));
    }
  }, [apiKey, conductorSystem, conductorCtxData, conductorBatch, setNodes, setEdges]);

  const onConductorAccept = useCallback(() => {
    if (!conductorBatch) return;
    const r = acceptBatch(nodesRef.current, edgesRef.current, conductorBatch.batchId);
    setNodes(r.nodes);
    setEdges(r.edges);
    setNodeOutputs((prev) => {
      const o = prev[conductorBatch.conductorId] || {};
      return { ...prev, [conductorBatch.conductorId]: { ...o, status: 'idle',
        turns: [...(o.turns || []), { role: 'assistant', text: `Accepted — ${conductorBatch.nodes.length} nodes are now yours.` }] } };
    });
    setConductorBatch(null);
  }, [conductorBatch, setNodes, setEdges]);

  const onConductorDiscard = useCallback(() => {
    if (!conductorBatch) return;
    const r = discardBatch(nodesRef.current, edgesRef.current, conductorBatch.batchId);
    setNodes(r.nodes);
    setEdges(r.edges);
    setNodeOutputs((prev) => {
      const o = prev[conductorBatch.conductorId] || {};
      return { ...prev, [conductorBatch.conductorId]: { ...o, status: 'idle',
        turns: [...(o.turns || []), { role: 'assistant', text: 'Discarded. Tell me what to change and I\'ll re-propose.' }] } };
    });
    setConductorBatch(null);
  }, [conductorBatch, setNodes, setEdges]);

  const onConductorRejectNode = useCallback((nodeId) => {
    if (!conductorBatch) return;
    const ref = nodeId.replace(`cmp-${conductorBatch.batchId}-`, '');
    const r = rejectBatchNode(nodesRef.current, edgesRef.current, nodeId);
    setNodes(r.nodes);
    setEdges(r.edges);
    setConductorBatch((b) => {
      if (!b) return b;
      const remaining = b.nodes.filter((n) => n.id !== nodeId);
      if (remaining.length === 0) return null;
      return { ...b, nodes: remaining, rejectedRefs: [...b.rejectedRefs, ref] };
    });
  }, [conductorBatch, setNodes, setEdges]);

  const onConductorHover = useCallback((nodeId, hot) => {
    setNodes((nds) => nds.map((n) => n.id === nodeId
      ? { ...n, className: hot ? 'cv-ghost cv-ghost-hot' : 'cv-ghost' } : n));
  }, [setNodes]);

  // Clip Frames batch — generates one Nano Banana image per clip using character visual + clip context
  const onClipFramesBatchGenerate = useCallback(async (nodeId, kieKey, clips, avatarRefUrl, resolution) => {
    if (!clips?.length) return;
    const initial = clips.map(() => ({ status: 'submitting', url: '', taskId: '', elapsed: 0, error: '' }));
    setNodeOutputs((prev) => ({ ...prev, [nodeId]: { batchStatus: 'generating', slides: initial } }));

    // If avatar ref is local, upload it first for image_input
    let refUrl = avatarRefUrl || '';
    if (refUrl && /^[a-zA-Z]:/.test(refUrl)) {
      try {
        const uploadRes = await fetch('http://localhost:3001/api/upload-image', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: refUrl }),
        });
        const uploadData = await uploadRes.json();
        if (uploadRes.ok && uploadData.url) refUrl = uploadData.url;
      } catch { /* use without ref */ refUrl = ''; }
    }

    const updateSlide = (index, patch) => {
      setNodeOutputs((prev) => {
        const node = prev[nodeId] || {};
        const slides = [...(node.slides || [])];
        slides[index] = { ...slides[index], ...patch };
        const allDone = slides.every(s => s.status === 'done' || s.status === 'error');
        return { ...prev, [nodeId]: { ...node, slides, batchStatus: allDone ? 'done' : 'generating' } };
      });
    };

    for (let i = 0; i < clips.length; i++) {
      (async (idx) => {
        const clip = clips[idx];
        // Build prompt based on clip type — character in the appropriate scene
        let scenePrompt;
        if (clip.type === 'broll') {
          scenePrompt = `Photorealistic iPhone selfie-style photograph. ${clip.prompt}. Natural lighting, authentic UGC aesthetic, shot on iPhone 15 Pro. No text overlays.`;
        } else {
          scenePrompt = `Photorealistic iPhone front-camera selfie photograph of a person speaking directly to camera. The expression and body language convey: ${clip.type === 'hook' ? 'attention-grabbing directness' : clip.type === 'cta' ? 'warm invitation, slight smile' : 'engaged, conversational'}. ${clip.prompt}. Natural lighting, authentic UGC aesthetic, shot on iPhone 15 Pro. Shallow depth of field. No text overlays.`;
        }

        try {
          const res = await fetch('http://localhost:3001/api/kie/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              apiKey: kieKey,
              model: 'nano-banana-pro',
              input: {
                prompt: scenePrompt,
                image_input: refUrl ? [refUrl] : [],
                aspect_ratio: '9:16',
                resolution: resolution || '2K',
                output_format: 'png',
              },
            }),
          });
          const data = await res.json();
          if (!res.ok || !data?.data?.taskId) throw new Error(data?.error || 'Failed');
          const taskId = data.data.taskId;
          updateSlide(idx, { status: 'polling', taskId });

          let elapsed = 0;
          const poll = async () => {
            elapsed += 10;
            updateSlide(idx, { elapsed });
            try {
              const pr = await fetch(`http://localhost:3001/api/kie/status/${taskId}`, { headers: { 'x-kie-key': kieKey } });
              const pd = await pr.json();
              const st = pd?.data?.state || pd?.data?.status;
              if (st === 'success' || st === 'completed' || st === 'succeed') {
                const rj = JSON.parse(pd.data.resultJson || '{}');
                updateSlide(idx, { status: 'done', url: rj.resultUrls?.[0] || '', elapsed });
                return;
              }
              if (st === 'fail' || st === 'failed') { updateSlide(idx, { status: 'error', error: pd.data?.failMsg || 'Failed' }); return; }
              if (elapsed >= 300) { updateSlide(idx, { status: 'error', error: 'Timeout (5 min)' }); return; }
              setTimeout(poll, 10000);
            } catch (e) { updateSlide(idx, { status: 'error', error: e.message }); }
          };
          setTimeout(poll, 10000);
        } catch (err) { updateSlide(idx, { status: 'error', error: err.message }); }
      })(i);
    }
  }, []);

  // UGC Video batch — fires all clips to the selected route.
  // opts: { kieKey, route, soulId } — accepts legacy string kieKey for back-compat.
  const onUgcVideoBatchGenerate = useCallback(async (nodeId, opts, clips, frameUrls) => {
    const { kieKey, route = 'kie:kling-3.0', soulId } =
      (typeof opts === 'string') ? { kieKey: opts } : (opts || {});
    const pairCount = Math.min(clips?.length || 0, frameUrls?.length || 0);
    if (pairCount === 0) return;

    // Higgsfield route: CLI auto-uploads local frame paths, sidesteps catbox.
    if (route.startsWith('hf:')) {
      const hfModel = route.slice(3);
      const initialHf = Array.from({ length: pairCount }, () => ({ status: 'submitting', url: '', taskId: '', elapsed: 0, error: '' }));
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { batchStatus: 'generating', videos: initialHf } }));

      const updateHf = (index, patch) => {
        setNodeOutputs((prev) => {
          const node = prev[nodeId] || {};
          const videos = [...(node.videos || [])];
          videos[index] = { ...videos[index], ...patch };
          const allDone = videos.every(v => v.status === 'done' || v.status === 'error');
          return { ...prev, [nodeId]: { ...node, videos, batchStatus: allDone ? 'done' : 'generating' } };
        });
      };

      // 5 parallel jobs at a time. CLI auto-uploads local paths; pre-resolve not needed.
      for (let batch = 0; batch < pairCount; batch += 5) {
        const end = Math.min(batch + 5, pairCount);
        const promises = [];
        for (let i = batch; i < end; i++) {
          promises.push((async (idx) => {
            const clip = clips[idx];
            try {
              const job = await hfCreateVideoJob({
                model: hfModel,
                prompt: clip.prompt,
                image: frameUrls[idx],   // local abs path — CLI uploads automatically
                duration: clip.duration || 5,
                soulId: soulId || undefined,
              });
              const jobId = job?.id || job?.jobId || job?.job_id;
              if (!jobId) throw new Error('No jobId returned from Higgsfield');
              updateHf(idx, { status: 'polling', taskId: jobId });

              // Tick elapsed counter for UI; pollJobUntilDone handles real polling.
              let elapsed = 0;
              const ticker = setInterval(() => { elapsed += 5; updateHf(idx, { elapsed }); }, 5000);
              try {
                const final = await hfPollJobUntilDone(jobId, { intervalMs: 5000, timeoutMs: 600000 });
                const status = String(final?.status || '').toLowerCase();
                if (['done', 'completed', 'success', 'succeeded'].includes(status)) {
                  const url = final?.result?.url || final?.url || final?.output?.url
                    || final?.video_url || final?.result_url || final?.output_url
                    || final?.results?.[0]?.url || '';
                  updateHf(idx, { status: 'done', url, elapsed });
                } else {
                  updateHf(idx, { status: 'error', error: final?.error || final?.fail_reason || `status=${status}` });
                }
              } finally { clearInterval(ticker); }
            } catch (err) { updateHf(idx, { status: 'error', error: err.message }); }
          })(i));
        }
        await Promise.all(promises);
        if (end < pairCount) await new Promise(r => setTimeout(r, 1000));
      }
      return;
    }

    // kie.ai route (default, untouched logic below).
    const initial = Array.from({ length: pairCount }, () => ({ status: 'resolving', url: '', taskId: '', elapsed: 0, error: '' }));
    setNodeOutputs((prev) => ({ ...prev, [nodeId]: { batchStatus: 'generating', videos: initial } }));

    // Resolve a local frame to a public URL kie can fetch. PRIMARY: kie's File
    // Upload API (kie serves from its own CDN — the tunnel doesn't route
    // /api/local-image and free hosts hand kie URLs its fetcher drops).
    // FALLBACK: /api/resolve-public-url (legacy tunnel-or-host upload).
    const resolveFrameUrl = async (framePath) => {
      try {
        const up = await fetch('http://localhost:3001/api/kie/upload-file', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: kieKey, path: framePath }),
        });
        const upData = await up.json();
        if (up.ok && upData.url) return upData.url;
      } catch { /* fall through to the legacy resolver */ }
      const resolveRes = await fetch('http://localhost:3001/api/resolve-public-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: framePath }),
      });
      const resolveData = await resolveRes.json();
      if (!resolveRes.ok || !resolveData.url) throw new Error(resolveData.error || 'Resolve failed');
      return resolveData.url;
    };

    // Resolve all local frame images to public URLs (kie upload first, fallback below)
    const publicUrls = [];
    for (let i = 0; i < pairCount; i++) {
      const framePath = frameUrls[i];
      const isLocal = /^[a-zA-Z]:/.test(framePath) || (framePath.startsWith('/') && !framePath.startsWith('http'));
      if (isLocal) {
        try {
          publicUrls.push(await resolveFrameUrl(framePath));
        } catch (err) {
          publicUrls.push(null);
          initial[i] = { status: 'error', url: '', error: `Frame resolve failed: ${err.message}` };
        }
      } else {
        publicUrls.push(framePath); // already a URL
      }
    }

    setNodeOutputs((prev) => ({ ...prev, [nodeId]: { batchStatus: 'generating', videos: initial.map((v, i) => publicUrls[i] ? { ...v, status: 'submitting' } : v) } }));

    const updateVideo = (index, patch) => {
      setNodeOutputs((prev) => {
        const node = prev[nodeId] || {};
        const videos = [...(node.videos || [])];
        videos[index] = { ...videos[index], ...patch };
        const allDone = videos.every(v => v.status === 'done' || v.status === 'error');
        return { ...prev, [nodeId]: { ...node, videos, batchStatus: allDone ? 'done' : 'generating' } };
      });
    };

    // Fire in batches of 5 to respect rate limits
    for (let batch = 0; batch < pairCount; batch += 5) {
      const end = Math.min(batch + 5, pairCount);
      const batchPromises = [];

      for (let i = batch; i < end; i++) {
        if (!publicUrls[i]) continue; // skip frames that failed resolve
        batchPromises.push((async (idx) => {
          const clip = clips[idx];
          try {
            const res = await fetch('http://localhost:3001/api/kie/create', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                apiKey: kieKey,
                model: 'kling-3.0/video',
                input: {
                  prompt: clip.prompt,
                  image_urls: [publicUrls[idx]],
                  sound: true,
                  duration: String(clip.duration || 5),
                  aspect_ratio: '9:16',
                  mode: 'pro',
                  multi_shots: false,
                  multi_prompt: [],
                },
              }),
            });
            const data = await res.json();
            if (!res.ok || !data?.data?.taskId) throw new Error(data?.error || data?.message || 'Failed');
            const taskId = data.data.taskId;
            updateVideo(idx, { status: 'polling', taskId });

            let elapsed = 0;
            const poll = async () => {
              elapsed += 15;
              updateVideo(idx, { elapsed });
              try {
                const pr = await fetch(`http://localhost:3001/api/kie/status/${taskId}`, { headers: { 'x-kie-key': kieKey } });
                const pd = await pr.json();
                const st = pd?.data?.state || pd?.data?.status;
                if (st === 'success' || st === 'completed' || st === 'succeed') {
                  const resultJson = JSON.parse(pd.data.resultJson || '{}');
                  const url = resultJson.resultUrls?.[0] || '';
                  updateVideo(idx, { status: 'done', url, elapsed });
                  return;
                }
                if (st === 'fail' || st === 'failed') { updateVideo(idx, { status: 'error', error: pd.data?.failMsg || 'Failed' }); return; }
                if (elapsed >= 600) { updateVideo(idx, { status: 'error', error: 'Timeout (10 min)' }); return; }
                setTimeout(poll, 15000);
              } catch (pollErr) { updateVideo(idx, { status: 'error', error: pollErr.message }); }
            };
            setTimeout(poll, 15000);
          } catch (err) { updateVideo(idx, { status: 'error', error: err.message }); }
        })(i));
      }

      await Promise.all(batchPromises);
      if (end < clips.length) await new Promise(r => setTimeout(r, 1500));
    }
  }, []);

  // Niche script generation via Anthropic API — writes to nodeOutputs[nodeId].script
  const onNicheGenerate = useCallback(async (nodeId, topic, tone, length, researchLive = false, recipeId = null) => {
    if (!topic || !apiKey) return;
    setNodeOutputs((prev) => ({ ...prev, [nodeId]: { status: 'generating', script: '', error: '' } }));

    // Recipe-shape path — when a recipe is selected, use its scriptShape
    // instead of the carousel framing. The output is a SHORTFORM SPOKEN script
    // (single paragraph, Teleprompter-ready), not a slide-by-slide carousel.
    if (recipeId) {
      const recipe = getRecipeById(recipeId);
      if (recipe?.scriptShape) {
        const researchClauseR = researchLive
          ? `\n\nLIVE RESEARCH: Use the web_search tool to ground every factual claim. If search returns nothing usable, say so and stop — do NOT invent details, names, dates, or quotes.`
          : '';
        const systemPromptR = `You are a Ray-Ban POV shortform scriptwriter for a creator. You write the SPOKEN dialog that a creator reads off Teleprompter while recording vertical POV footage. Your output is the words only — no slide breaks, no metadata, no commentary.

Tone: ${tone}. Pacing: natural conversational, ~2.5 words/sec read aloud, slight deliberate slowdown on hero phrases.

${recipe.scriptShape}${researchClauseR}`;
        const userPromptR = `Topic: ${topic}`;
        try {
          const res = await fetch('http://localhost:3001/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey, model, system: systemPromptR, messages: [{ role: 'user', content: userPromptR }], webSearch: !!researchLive }),
          });
          if (!res.ok) throw new Error(`API error ${res.status}`);
          const data = await res.json();
          const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
          setNodeOutputs((prev) => ({ ...prev, [nodeId]: { status: 'done', script: text, recipeId, error: '' } }));
        } catch (err) {
          setNodeOutputs((prev) => ({ ...prev, [nodeId]: { status: 'error', script: '', error: err.message } }));
        }
        return;
      }
    }

    // Default carousel-storytelling path (unchanged)
    const lengthSpec = NICHE_LENGTHS.find(l => l.id === length) || NICHE_LENGTHS[1];
    const parseRange = (s) => {
      const parts = String(s).split('-').map(p => parseInt(p, 10));
      return { min: parts[0] || 1, max: parts[1] || parts[0] || 1 };
    };
    const slidesR = parseRange(lengthSpec.slides);
    const wordsR = parseRange(lengthSpec.words);
    const maxPerSlide = Math.max(1, Math.ceil(wordsR.max / slidesR.max));
    const researchClause = researchLive
      ? `\n- This topic may involve current events past your training cutoff. Use the web_search tool to ground every factual claim in recent, verified sources. If search returns nothing usable, say so on slide 1 and stop, do NOT invent details, names, dates, or quotes.`
      : '';
    const systemPrompt = `You are a visual storytelling scriptwriter for educational carousel content. Each script becomes a multi-slide post where every slide is paired with a generated image downstream. You write only the words; imagery is handled by a separate visual pipeline.

CRITICAL — the script is ABOUT THE TOPIC, never about the medium. Do not write about "the paper", "the fold", "origami", "cardstock", "the diorama", "layers unfolding", or any meta-reference to how the visual will be rendered. The protagonist or subject is whatever the topic dictates — a person, a system, an idea, a concept — never paper or a fold. Treat the visual style as invisible to the reader.

HARD LENGTH BUDGET — these limits are non-negotiable and override every other instruction including tone:
- TOTAL: ${wordsR.max} words MAX across the entire script. Going over breaks the carousel layout.
- SLIDES: ${lengthSpec.slides} numbered slides, no more.
- PER SLIDE: ${maxPerSlide} words MAX per slide. 1-2 sentences typical, 3 only when essential.
- The tone (${tone}) controls voice, pacing, and word choice. It does NOT add words. Educational, Dramatic, Inspirational, Analytical, and Narrative all share the exact same length budget.

Style:
- Numbered slides, one concept per slide
- Vivid, visual language that translates well to imagery WITHOUT naming the medium
- Slide 1 must be a scroll-stopping hook
- Final slide is a clear takeaway or call to reflection
- NEVER use em dashes (—) or en dashes (–). Use commas, periods, colons, or hyphens (-) instead. The downstream renderer cannot display them.${researchClause}

Output ONLY the script text. Each slide on its own line, prefixed with the slide number. No metadata, no commentary, no source citations in the body.`;

    const userPrompt = `Write a ${tone} visual storytelling script about: ${topic}`;

    try {
      const res = await fetch('http://localhost:3001/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, model, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }], webSearch: !!researchLive }),
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { status: 'done', script: text, error: '' } }));
    } catch (err) {
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { status: 'error', script: '', error: err.message } }));
    }
  }, [apiKey, model]);

  // ── executeGraph lane runner (Tier 2.1 engine) ──────────────────────────
  // Strangler wiring: runs the whole upstream lane of a target node through
  // the engine. Per-node buttons are untouched. Engine writes the exact
  // legacy nodeOutputs shapes, so node UIs render results unchanged.
  const [laneRun, setLaneRun] = useState({ status: 'idle', targetId: null, error: '' });
  const onRunLane = useCallback(async (targetNodeId, { force = false } = {}) => {
    registerLaneExecutors();
    setLaneRun({ status: 'running', targetId: targetNodeId, error: '' });
    const report = (nodeId, patch) =>
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], ...patch } }));
    try {
      const result = await executeGraph({
        nodes, edges, targetId: targetNodeId,
        outputs: nodeOutputs,
        force,
        ctx: {
          server: 'http://localhost:3001',
          keys: { anthropic: apiKey, kie: localStorage.getItem('kie-api-key') || '', model },
          report,
        },
      });
      setLaneRun({ status: result.error ? 'error' : 'done', targetId: targetNodeId, error: result.error || '' });
    } catch (err) {
      setLaneRun({ status: 'error', targetId: targetNodeId, error: err.message });
    }
  }, [nodes, edges, nodeOutputs, apiKey, model]);

  // Mirror node-local form state into node.data so the engine executors can
  // read each node's parameters (topic/tone/length, aspectRatio/resolution,
  // duration/videoMode/motionPrompt, carousel config). Node components call
  // this from their onChange handlers — never during render.
  const syncNodeData = useCallback((nodeId, patch) => {
    setNodes((nds) => nds.map((nd) => (nd.id === nodeId ? { ...nd, data: { ...nd.data, ...patch } } : nd)));
  }, [setNodes]);

  // Carousel render — sends config + image URLs to server, runs render.py
  const onCarouselRender = useCallback(async (nodeId, config, imageUrls, opts = {}) => {
    setNodeOutputs((prev) => ({ ...prev, [nodeId]: { renderStatus: 'rendering', renderedSlides: [], error: '' } }));
    const name = `carousel_${nodeId.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
    try {
      const res = await fetch('http://localhost:3001/api/carousel/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, config, imageUrls: imageUrls || [] }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Render failed');
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { renderStatus: 'done', renderedSlides: data.slides, zones: data.zones || {}, error: '' } }));

      // Optional Stage 3: animate terminal slides via Remotion
      if (opts.animate) {
        const zones = data.zones || {};
        const terminalIdxs = (config.slides || [])
          .map((s, i) => ({ s, idx: i + 1 }))
          .filter(({ s }) => s.type === 'terminal_body');

        if (terminalIdxs.length === 0) {
          setNodeOutputs((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], animateStatus: 'skipped' } }));
          return;
        }

        const initialAnims = terminalIdxs.map(({ idx }) => ({ slideIdx: idx, status: 'pending', url: '', error: '' }));
        setNodeOutputs((prev) => ({
          ...prev,
          [nodeId]: { ...prev[nodeId], animateStatus: 'animating', terminalAnimations: initialAnims },
        }));

        const updateAnim = (slideIdx, patch) => {
          setNodeOutputs((prev) => {
            const node = prev[nodeId] || {};
            const anims = (node.terminalAnimations || []).map((a) =>
              a.slideIdx === slideIdx ? { ...a, ...patch } : a,
            );
            const allDone = anims.every((a) => a.status === 'done' || a.status === 'error');
            return { ...prev, [nodeId]: { ...node, terminalAnimations: anims, animateStatus: allDone ? 'done' : 'animating' } };
          });
        };

        // Sequential — Remotion is heavy; parallel renders thrash Chromium
        for (const { s, idx } of terminalIdxs) {
          const zone = zones[`slide_${idx}`];
          if (!zone) {
            updateAnim(idx, { status: 'error', error: 'no zone in zones.json' });
            continue;
          }
          updateAnim(idx, { status: 'rendering' });
          try {
            const animRes = await fetch('http://localhost:3001/api/remotion/animate-terminal', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                slidePath: `slide_${idx}.png`,
                terminalZone: zone,
                terminal: s.terminal,
                templateId: config.template,
                name,
                slideIdx: idx,
              }),
            });
            const animData = await animRes.json();
            if (!animRes.ok || !animData.success) throw new Error(animData.error || 'Animate failed');
            updateAnim(idx, { status: 'done', url: animData.url, durationSec: animData.durationSec });
          } catch (err) {
            updateAnim(idx, { status: 'error', error: err.message });
          }
        }
      }
    } catch (err) {
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { renderStatus: 'error', renderedSlides: [], zones: {}, error: err.message } }));
    }
  }, []);

  // Batch video prompt generation — one motion prompt per image
  const onVideoPromptBatchGenerate = useCallback(async (nodeId, imageUrls, scriptSlides, motionStyle) => {
    if (!apiKey || !imageUrls?.length) return;
    const initial = imageUrls.map((url) => ({ status: 'generating', videoPrompt: '', imageUrl: url, error: '' }));
    setNodeOutputs((prev) => ({ ...prev, [nodeId]: { batchStatus: 'generating', prompts: initial } }));

    const styleGuides = {
      'origami-unfold': 'Everything is made of paper. Paper folds slowly open and unfurl to reveal the scene. Crease lines bend and relax. Layered cardstock separates into depth planes. Tiny paper flaps lift at edges. Nothing moves that isn\'t paper — no wind, no explosions, no particles. Motion comes from folding, unfolding, creasing, and settling. Think stop-motion paper craft.',
      'paper-physics': 'A stop-motion animation of origami paper blocks folding themselves. Everything else stays perfectly frozen and unchanged. Soft studio lighting, clean shadows, high-detail paper textures, no additional elements or movement anywhere else, smooth loop-friendly animation of the page-folding only.',
      'gentle-ambient': 'Slow, meditative: soft light shifts across paper surfaces, gentle shadow movement, slight depth-of-field drift. Everything breathes slowly.',
      'dramatic-reveal': 'Slow camera pull-back reveals the full paper diorama. Light sweeps across layered cardstock, illuminating fold geometry progressively.',
      'kinetic-energy': 'Quick paper folds snap open in sequence, cardstock panels flip and settle, energetic but still paper-bound. Bold camera angle shift.',
    };

    const updatePrompt = (index, patch) => {
      setNodeOutputs((prev) => {
        const node = prev[nodeId] || {};
        const prompts = [...(node.prompts || [])];
        prompts[index] = { ...prompts[index], ...patch };
        const allDone = prompts.every(p => p.status === 'done' || p.status === 'error');
        return { ...prev, [nodeId]: { ...node, prompts, batchStatus: allDone ? 'done' : 'generating' } };
      });
    };

    const systemPrompt = `You are a Kling 2.6 video prompt specialist. You write prompts for image-to-video generation of origami/paper craft art.

KLING 2.6 FORMULA: Subject + Action + Environment + Style + Camera Movement

CRITICAL RULES:
- Everything is made of PAPER. All motion must be paper-based: folding, unfolding, creasing, curling, settling, layering.
- NO explosions, NO particles flying, NO wind effects, NO water, NO fire. Only paper physics.
- 40-60 words maximum (Kling chokes on long prompts)
- Follow the formula: what paper element (subject) does what fold/unfold action (action) in what paper setting (environment) with what paper aesthetic (style) shot how (camera)
- Motion style: ${styleGuides[motionStyle] || styleGuides['origami-unfold']}

Output ONLY the prompt. No labels, no metadata, no quotes.`;

    for (let i = 0; i < imageUrls.length; i++) {
      (async (idx) => {
        const slideContext = scriptSlides[idx] ? ` telling the story: "${scriptSlides[idx]}"` : '';
        const userPrompt = `Kling 2.6 prompt for slide ${idx + 1}. The image is a 16-gami origami sculpture — multi-layered cut paper and cardstock with stair-stepped pixelated folds${slideContext}. Write the motion prompt using Subject + Action + Environment + Style + Camera Movement.`;
        try {
          const res = await fetch('http://localhost:3001/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey, model, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
          });
          if (!res.ok) throw new Error(`API error ${res.status}`);
          const data = await res.json();
          const prompt = data.content?.[0]?.text || '';
          updatePrompt(idx, { status: 'done', videoPrompt: prompt });
        } catch (err) {
          updatePrompt(idx, { status: 'error', error: err.message });
        }
      })(i);
    }
  }, [apiKey, model]);

  // Batch KIE img2vid — fires all clips in parallel
  const onKieImg2VidBatchGenerate = useCallback(async (nodeId, kieKey, modelName, pairs, dur) => {
    if (!kieKey || !pairs?.length) return;
    const initial = pairs.map(() => ({ status: 'submitting', url: '', taskId: '', elapsed: 0, error: '' }));
    setNodeOutputs((prev) => ({ ...prev, [nodeId]: { batchStatus: 'generating', videos: initial } }));

    const updateVideo = (index, patch) => {
      setNodeOutputs((prev) => {
        const node = prev[nodeId] || {};
        const videos = [...(node.videos || [])];
        videos[index] = { ...videos[index], ...patch };
        const allDone = videos.every(v => v.status === 'done' || v.status === 'error');
        return { ...prev, [nodeId]: { ...node, videos, batchStatus: allDone ? 'done' : 'generating' } };
      });
    };

    for (let i = 0; i < pairs.length; i++) {
      (async (idx) => {
        const { videoPrompt, imageUrl } = pairs[idx];
        try {
          const res = await fetch('http://localhost:3001/api/kie/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              apiKey: kieKey, model: modelName,
              input: { prompt: videoPrompt, image_urls: [imageUrl], sound: false, duration: String(dur) },
            }),
          });
          const data = await res.json();
          if (!res.ok || !data?.data?.taskId) throw new Error(data?.error || data?.message || 'Failed');
          const taskId = data.data.taskId;
          updateVideo(idx, { status: 'polling', taskId });

          let elapsed = 0;
          const poll = async () => {
            elapsed += 15;
            updateVideo(idx, { elapsed });
            try {
              const pr = await fetch(`http://localhost:3001/api/kie/status/${taskId}`, { headers: { 'x-kie-key': kieKey } });
              const pd = await pr.json();
              const st = pd?.data?.state || pd?.data?.status;
              if (st === 'success' || st === 'completed' || st === 'succeed') {
                const resultJson = JSON.parse(pd.data.resultJson || '{}');
                const url = resultJson.resultUrls?.[0] || '';
                updateVideo(idx, { status: 'done', url, elapsed });
                return;
              }
              if (st === 'fail' || st === 'failed') { updateVideo(idx, { status: 'error', error: pd.data?.failMsg || 'Failed' }); return; }
              if (elapsed >= 600) { updateVideo(idx, { status: 'error', error: 'Timeout (10 min)' }); return; }
              setTimeout(poll, 15000);
            } catch (pollErr) { updateVideo(idx, { status: 'error', error: pollErr.message }); }
          };
          setTimeout(poll, 15000);
        } catch (err) { updateVideo(idx, { status: 'error', error: err.message }); }
      })(i);
    }
  }, []);

  // Title Card batch generation — Nano Banana text-on-paper first frames
  const onTitleCardBatchGenerate = useCallback(async (nodeId, kieKey, prompts, resolution, ar) => {
    if (!kieKey || !prompts?.length) return;
    const initial = prompts.map(() => ({ status: 'submitting', url: '', taskId: '', elapsed: 0, error: '' }));
    setNodeOutputs((prev) => ({ ...prev, [nodeId]: { batchStatus: 'generating', slides: initial } }));

    const updateSlide = (index, patch) => {
      setNodeOutputs((prev) => {
        const node = prev[nodeId] || {};
        const slides = [...(node.slides || [])];
        slides[index] = { ...slides[index], ...patch };
        const allDone = slides.every(s => s.status === 'done' || s.status === 'error');
        return { ...prev, [nodeId]: { ...node, slides, batchStatus: allDone ? 'done' : 'generating' } };
      });
    };

    for (let i = 0; i < prompts.length; i++) {
      (async (idx) => {
        try {
          const res = await fetch('http://localhost:3001/api/kie/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              apiKey: kieKey,
              model: 'nano-banana-pro',
              input: { prompt: prompts[idx], image_input: [], aspect_ratio: ar || '9:16', resolution: resolution || '2K', output_format: 'png' },
            }),
          });
          const data = await res.json();
          if (!res.ok || !data?.data?.taskId) throw new Error(data?.error || 'Failed to create task');
          const taskId = data.data.taskId;
          updateSlide(idx, { status: 'polling', taskId });

          let elapsed = 0;
          const poll = async () => {
            elapsed += 10;
            updateSlide(idx, { elapsed });
            try {
              const pr = await fetch(`http://localhost:3001/api/kie/status/${taskId}`, { headers: { 'x-kie-key': kieKey } });
              const pd = await pr.json();
              const st = pd?.data?.state || pd?.data?.status;
              if (st === 'success' || st === 'completed' || st === 'succeed') {
                const resultJson = JSON.parse(pd.data.resultJson || '{}');
                const url = resultJson.resultUrls?.[0] || '';
                updateSlide(idx, { status: 'done', url, elapsed });
                return;
              }
              if (st === 'fail' || st === 'failed') {
                updateSlide(idx, { status: 'error', error: pd.data?.failMsg || 'Generation failed' });
                return;
              }
              if (elapsed >= 300) {
                updateSlide(idx, { status: 'error', error: 'Timeout (5 min)' });
                return;
              }
              setTimeout(poll, 10000);
            } catch (pollErr) {
              updateSlide(idx, { status: 'error', error: pollErr.message });
            }
          };
          setTimeout(poll, 10000);
        } catch (err) {
          updateSlide(idx, { status: 'error', error: err.message });
        }
      })(i);
    }
  }, []);

  // Frame Sandwich — pairs first+last frames → Kling 3.0 with stop-motion prompt
  const onFrameSandwichGenerate = useCallback(async (nodeId, kieKey, pairs, motionPrompt, dur, ar, videoMode) => {
    if (!kieKey || !pairs?.length) return;
    const initial = pairs.map(() => ({ status: 'submitting', url: '', taskId: '', elapsed: 0, error: '' }));
    setNodeOutputs((prev) => ({ ...prev, [nodeId]: { batchStatus: 'generating', videos: initial } }));

    const updateVideo = (index, patch) => {
      setNodeOutputs((prev) => {
        const node = prev[nodeId] || {};
        const videos = [...(node.videos || [])];
        videos[index] = { ...videos[index], ...patch };
        const allDone = videos.every(v => v.status === 'done' || v.status === 'error');
        return { ...prev, [nodeId]: { ...node, videos, batchStatus: allDone ? 'done' : 'generating' } };
      });
    };

    for (let i = 0; i < pairs.length; i++) {
      (async (idx) => {
        const { first, last } = pairs[idx];
        try {
          const res = await fetch('http://localhost:3001/api/kie/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              apiKey: kieKey,
              model: 'kling-3.0/video',
              input: {
                prompt: motionPrompt,
                image_urls: [first, last],
                sound: false,
                duration: String(dur),
                aspect_ratio: ar || '9:16',
                mode: videoMode || 'pro',
                multi_shots: false,
                multi_prompt: [],
              },
            }),
          });
          const data = await res.json();
          if (!res.ok || !data?.data?.taskId) throw new Error(data?.error || data?.message || 'Failed');
          const taskId = data.data.taskId;
          updateVideo(idx, { status: 'polling', taskId });

          let elapsed = 0;
          const poll = async () => {
            elapsed += 15;
            updateVideo(idx, { elapsed });
            try {
              const pr = await fetch(`http://localhost:3001/api/kie/status/${taskId}`, { headers: { 'x-kie-key': kieKey } });
              const pd = await pr.json();
              const st = pd?.data?.state || pd?.data?.status;
              if (st === 'success' || st === 'completed' || st === 'succeed') {
                const resultJson = JSON.parse(pd.data.resultJson || '{}');
                const url = resultJson.resultUrls?.[0] || '';
                updateVideo(idx, { status: 'done', url, elapsed });
                return;
              }
              if (st === 'fail' || st === 'failed') { updateVideo(idx, { status: 'error', error: pd.data?.failMsg || 'Failed' }); return; }
              if (elapsed >= 600) { updateVideo(idx, { status: 'error', error: 'Timeout (10 min)' }); return; }
              setTimeout(poll, 15000);
            } catch (pollErr) { updateVideo(idx, { status: 'error', error: pollErr.message }); }
          };
          setTimeout(poll, 15000);
        } catch (err) { updateVideo(idx, { status: 'error', error: err.message }); }
      })(i);
    }
  }, []);

  // Remotion compositor — sends slide+video pairs to server for Remotion rendering
  const onRemotionComposite = useCallback(async (nodeId, pairs) => {
    if (!pairs?.length) return;
    const initial = pairs.map((_, i) => ({ status: 'rendering', url: '', error: '' }));
    setNodeOutputs((prev) => ({ ...prev, [nodeId]: { batchStatus: 'rendering', composites: initial } }));

    const name = `comp_${nodeId.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
    try {
      const res = await fetch('http://localhost:3001/api/remotion/composite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, pairs }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error('Server returned invalid response — is the Express server running on port 3001?'); }
      if (!res.ok || !data.success) throw new Error(data.error || 'Composite failed');

      const composites = data.results.map(r => ({
        status: r.status,
        url: r.url || '',
        error: r.error || '',
      }));
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { batchStatus: 'done', composites } }));
    } catch (err) {
      const errorComposites = pairs.map(() => ({ status: 'error', url: '', error: err.message }));
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { batchStatus: 'error', composites: errorComposites } }));
    }
  }, []);

  // FFmpeg color grade — batch process videos
  const onFfmpegGrade = useCallback(async (nodeId, videoUrls, settings) => {
    if (!videoUrls?.length) return;
    const initial = videoUrls.map(() => ({ status: 'grading', url: '', error: '' }));
    setNodeOutputs((prev) => ({ ...prev, [nodeId]: { batchStatus: 'grading', graded: initial } }));

    const updateGraded = (index, patch) => {
      setNodeOutputs((prev) => {
        const node = prev[nodeId] || {};
        const graded = [...(node.graded || [])];
        graded[index] = { ...graded[index], ...patch };
        const allDone = graded.every(g => g.status === 'done' || g.status === 'error');
        return { ...prev, [nodeId]: { ...node, graded, batchStatus: allDone ? 'done' : 'grading' } };
      });
    };

    for (let i = 0; i < videoUrls.length; i++) {
      try {
        const res = await fetch('http://localhost:3001/api/ffmpeg/grade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoUrl: videoUrls[i],
            settings,
            name: `${nodeId.replace(/[^a-zA-Z0-9]/g, '_')}_clip${i + 1}_${Date.now()}`,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Grade failed');
        updateGraded(i, { status: 'done', url: data.url });
      } catch (err) {
        updateGraded(i, { status: 'error', error: err.message });
      }
    }
  }, []);

  // Chroma composite — character-over-slide via FFmpeg chromakey + overlay
  const onChromaComposite = useCallback(async (nodeId, params) => {
    setNodeOutputs((prev) => ({ ...prev, [nodeId]: { status: 'rendering', url: '' } }));
    try {
      const res = await fetch('http://localhost:3001/api/ffmpeg/chroma-composite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...params,
          name: `${nodeId.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Composite failed');
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { status: 'done', url: data.url } }));
    } catch (err) {
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { status: 'error', url: '', error: err.message } }));
    }
  }, []);

  // Hyperframes overlay — HTML+GSAP caption burned over a clip via headless Chrome + FFmpeg
  const onHyperframesOverlay = useCallback(async (nodeId, params) => {
    setNodeOutputs((prev) => ({ ...prev, [nodeId]: { status: 'rendering', url: '' } }));
    try {
      const res = await fetch('http://localhost:3001/api/hyperframes/overlay-caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...params,
          name: `${nodeId.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Hyperframes render failed');
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { status: 'done', url: data.url, width: data.width, height: data.height, duration: data.duration } }));
    } catch (err) {
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { status: 'error', url: '', error: err.message } }));
    }
  }, []);

  // Chroma stylize — greenscreen video → effect preset → transparent .webm
  const onChromaStylize = useCallback(async (nodeId, params) => {
    setNodeOutputs((prev) => ({ ...prev, [nodeId]: { status: 'rendering', url: '' } }));
    try {
      const res = await fetch('http://localhost:3001/api/ffmpeg/chroma-stylize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...params,
          name: `${nodeId.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Stylize failed');
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { status: 'done', url: data.url, preset: data.preset } }));
    } catch (err) {
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { status: 'error', url: '', error: err.message } }));
    }
  }, []);

  // Chroma motion (Tier 2) — Remotion-driven animated character over slide
  const onChromaMotion = useCallback(async (nodeId, params) => {
    setNodeOutputs((prev) => ({ ...prev, [nodeId]: { status: 'rendering', url: '' } }));
    try {
      const res = await fetch('http://localhost:3001/api/remotion/chroma-motion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...params,
          name: `${nodeId.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Chroma motion render failed');
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { status: 'done', url: data.url, durationSec: data.durationSec } }));
    } catch (err) {
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { status: 'error', url: '', error: err.message } }));
    }
  }, []);

  // ── B-Roll: suggest cuts from the catalog, then render+splice ──────────
  // Two-step (matches the CLI mental model): first call writes plan to
  // node state for review, second call ships it to /api/broll/render.
  const onBrollSuggest = useCallback(async (nodeId, { videoUrl, transcript, durationSec, maxCuts = 3 }) => {
    setNodeOutputs((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], suggestStatus: 'thinking', plan: null, error: '' } }));
    try {
      const res = await fetch('http://localhost:3001/api/broll/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, videoDurationSec: durationSec, maxCuts }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Suggest failed');
      setNodeOutputs((prev) => ({
        ...prev,
        [nodeId]: { ...prev[nodeId], suggestStatus: 'done', plan: data.plan, videoUrl, error: '' },
      }));
    } catch (err) {
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], suggestStatus: 'error', error: err.message } }));
    }
  }, []);

  const onBrollRender = useCallback(async (nodeId, { videoUrl, plan }) => {
    setNodeOutputs((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], renderStatus: 'rendering', url: '', error: '' } }));
    try {
      // videoUrl can be /renders/... (server local path) or absolute URL/path.
      const videoPath = videoUrl.startsWith('http') ? videoUrl : videoUrl;
      // 4K renders can take 20+ minutes; bump fetch timeout to 60min so we
      // don't abandon a still-running render on the server.
      const ac = new AbortController();
      const timeoutHandle = setTimeout(() => ac.abort(), 60 * 60 * 1000);
      const res = await fetch('http://localhost:3001/api/broll/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoPath,
          plan,
          name: `${nodeId.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`,
        }),
        signal: ac.signal,
      }).finally(() => clearTimeout(timeoutHandle));
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Render failed');
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], renderStatus: 'done', url: data.url, error: '' } }));
    } catch (err) {
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], renderStatus: 'error', error: err.message } }));
    }
  }, []);

  // Video Source — pure local publish, no API call. Writes the chosen URL/path
  // and metadata into nodeOutputs so downstream nodes (B-roll, Hyperframes,
  // FFmpegGrade, ChromaComposite) can consume it via their existing `.url`
  // lookups.
  const onVideoSourcePublish = useCallback((nodeId, payload) => {
    setNodeOutputs((prev) => ({
      ...prev,
      [nodeId]: { ...prev[nodeId], ...payload },
    }));
  }, []);

  // Asset Sequence — pure local publish, no API call. Each AssetSequenceNode
  // auto-writes its full asset list to nodeOutputs on every change so the
  // wired Cartesian Composer downstream can render its "Source" dropdowns
  // off the latest pool without manual publish clicks.
  const onAssetSequencePublish = useCallback((nodeId, payload) => {
    setNodeOutputs((prev) => ({
      ...prev,
      [nodeId]: { ...prev[nodeId], ...payload },
    }));
  }, []);

  // PRD Lens publish — same shallow pattern as Asset Sequence: every textarea
  // change updates nodeOutputs[lensId] with { type: 'prd-lens', lens, content }
  // so PRD Chat can scan upstream edges and assemble the synthesis payload.
  const onLensPublish = useCallback((nodeId, payload) => {
    setNodeOutputs((prev) => ({
      ...prev,
      [nodeId]: { ...prev[nodeId], ...payload },
    }));
  }, []);

  // PRD Chat generate — routes to /api/generate (Anthropic) or /api/openai/generate
  // (OpenAI) based on selected provider. Assembles [PROBLEM LENS] {content} ...
  // payload from wired lenses, prepends the synthesis system prompt, returns the
  // synthesized PRD text into nodeOutputs[chatId].prd.
  const onPRDGenerate = useCallback(async (chatId, opts) => {
    const { provider, model: pickedModel, apiKey: pickedKey, lenses, systemPrompt } = opts || {};
    if (!pickedKey || !lenses) return;
    // Caller resolves the system prompt (wired Prompt Card content vs. default
    // PRD_SYNTHESIS_PROMPT). Falling back here too keeps the handler safe even
    // if a future caller forgets to pass one.
    const resolvedSystem = (typeof systemPrompt === 'string' && systemPrompt.trim().length > 0)
      ? systemPrompt
      : PRD_SYNTHESIS_PROMPT;

    const startedAt = Date.now();
    setNodeOutputs((prev) => ({ ...prev, [chatId]: { ...prev[chatId], status: 'generating', prd: '', error: '', elapsed: 0, startedAt } }));

    // Tick elapsed every second so the operator sees progress on long calls.
    const tick = setInterval(() => {
      setNodeOutputs((prev) => {
        const cur = prev[chatId];
        if (!cur || cur.status !== 'generating' || cur.startedAt !== startedAt) return prev;
        return { ...prev, [chatId]: { ...cur, elapsed: Math.round((Date.now() - startedAt) / 1000) } };
      });
    }, 1000);

    // Assemble the user payload — preserve lens order, skip empties.
    const segments = PRD_LENS_ORDER
      .filter(lensId => (lenses[lensId] || '').trim().length > 0)
      .map(lensId => `[${lensId} LENS]\n${lenses[lensId].trim()}`);
    if (segments.length === 0) {
      clearInterval(tick);
      setNodeOutputs((prev) => ({ ...prev, [chatId]: { ...prev[chatId], status: 'error', error: 'No filled lenses wired' } }));
      return;
    }
    const userMessage = segments.join('\n\n');

    try {
      const endpoint = provider === 'openai'
        ? 'http://localhost:3001/api/openai/generate'
        : 'http://localhost:3001/api/generate';

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: pickedKey,
          model: pickedModel,
          system: resolvedSystem,
          messages: [{ role: 'user', content: userMessage }],
          // PRD synthesis covers 13 sections — needs headroom past the default 4096.
          // 16K is enough for the longest seen output; 32K cap is server-enforced.
          maxTokens: 16384,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const errMsg = data?.error?.message || data?.error || `API error ${res.status}`;
        throw new Error(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));
      }

      // Extract text — Anthropic returns { content: [{ type:'text', text:'...'}] },
      // our /api/openai/generate normalizes to { content: '...' }.
      let text = '';
      if (provider === 'openai') {
        text = (data.content || '').toString();
      } else {
        text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      }
      clearInterval(tick);
      setNodeOutputs((prev) => ({ ...prev, [chatId]: { ...prev[chatId], status: 'done', prd: text, error: '', elapsed: Math.round((Date.now() - startedAt) / 1000) } }));
    } catch (err) {
      clearInterval(tick);
      setNodeOutputs((prev) => ({ ...prev, [chatId]: { ...prev[chatId], status: 'error', prd: '', error: err.message || String(err) } }));
    }
  }, []);

  // Pop Beats — POST to /api/pop-beats, server runs FFmpeg asplit+adelay+amix
  // and returns the output video URL. nodeOutputs[id].url flows downstream.
  const onPopBeatsRender = useCallback(async (nodeId, opts) => {
    const { videoUrl, pops, sound, gainDb } = opts || {};
    if (!videoUrl || !Array.isArray(pops) || pops.length === 0) return;
    setNodeOutputs((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], status: 'rendering', url: '', error: '' } }));
    try {
      const res = await fetch('http://localhost:3001/api/pop-beats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl, pops, sound, gainDb,
          name: `popped_${nodeId.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Pop Beats render failed');
      setNodeOutputs((prev) => ({
        ...prev,
        [nodeId]: { ...prev[nodeId], status: 'done', url: data.url, popCount: data.popCount, sound: data.sound, error: '' },
      }));
    } catch (err) {
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], status: 'error', url: '', error: err.message || String(err) } }));
    }
  }, []);

  // PRD Lens Enhance — sharpens the operator's lens content via Claude.
  // Returns the sharpened string directly (Promise<string>) — different shape
  // from other handlers because the result IS the value, not a status payload.
  // Lens-aware: the system prompt knows the lens taxonomy so the model stays
  // in the right scope (Problem stays Problem, doesn't drift into Vision, etc).
  const onLensEnhance = useCallback(async (lensType, currentContent) => {
    if (!apiKey) throw new Error('Anthropic API key required (set in API Settings panel)');
    if (!currentContent || currentContent.trim().length < 30) {
      throw new Error('Content too short to sharpen');
    }

    const lensDefs = `[PROBLEM] pain + evidence it hurts
[MARKET] sentiment, demand signals, competitive landscape
[USER] who specifically experiences this and their context
[VISION] desired future state, the big idea
[BUILD] functional specs and technical constraints
[BOUNDARY] non-goals, risks, open questions`;

    const systemPrompt = `You are a senior product strategist sharpening a single PRD Lens.

LENS DEFINITIONS:
${lensDefs}

The operator has written content for the [${lensType}] lens. Tighten and sharpen what they wrote.

RULES:
- Preserve their specifics (names, numbers, examples, edge cases). These are the load-bearing details — abstracting them away destroys the value.
- Preserve their structure (section headers, bullet organization, indentation).
- Sharpen the prose: tighten verbose phrasing, add precision where vague, cut filler words and corporate hedging.
- Stay strictly in the [${lensType}] lens. Don't add content from other lenses, even if it would be improvement — leave cross-lens content where it is.
- If they have placeholder scaffold sections (e.g. a heading with no content under it), leave the heading and add "[fill in: <one-line hint>]" so the operator sees what they skipped.
- No marketing tone. No emojis. No "Here's your sharpened version:" preamble. No markdown decoration beyond what they had.

Output ONLY the sharpened lens content. Nothing before, nothing after.`;

    const res = await fetch('http://localhost:3001/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        model: model || 'claude-sonnet-4-6',
        system: systemPrompt,
        messages: [{ role: 'user', content: currentContent }],
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error?.message || data?.error || `API error ${res.status}`;
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    return text;
  }, [apiKey, model]);

  // Craft from answers — operator filled 1-N seed questions for the lens; LLM
  // synthesizes a scaffold-shaped draft. Mirrors onLensEnhance: same Anthropic
  // proxy, same key+model from scope. Blank answers are skipped so the operator
  // can leave Qs they don't have a clear take on, and missing scaffold sections
  // come back as [fill in: ...] markers instead of fabricated content.
  const onLensCraft = useCallback(async (lensType, answers) => {
    if (!apiKey) throw new Error('Anthropic API key required (set in API Settings panel)');
    const lensDef = PRD_LENSES[lensType];
    if (!lensDef) throw new Error(`Unknown lens type: ${lensType}`);
    const questions = lensDef.seedQuestions || [];
    if (questions.length === 0) throw new Error(`No seed questions defined for ${lensType}`);
    const filled = (answers || [])
      .map((a, i) => ({ q: questions[i], a: (a || '').trim() }))
      .filter((x) => x.q && x.a.length > 0);
    if (filled.length === 0) throw new Error('Answer at least one seed question first');

    const lensDefsBlock = `[PROBLEM] pain + evidence it hurts
[MARKET] sentiment, demand signals, competitive landscape
[USER] who specifically experiences this and their context
[VISION] desired future state, the big idea
[BUILD] functional specs and technical constraints
[BOUNDARY] non-goals, risks, open questions`;

    const systemPrompt = `You are a senior product strategist drafting a single PRD Lens from operator-supplied seed answers.

LENS DEFINITIONS:
${lensDefsBlock}

The operator answered seed questions for the [${lensType}] lens. Synthesize those answers into a lens-shaped draft using the scaffold below.

TARGET SCAFFOLD (keep these section headings; populate the content under each from the answers):
${lensDef.scaffold}

RULES:
- Use the operator's specifics — names, numbers, quotes, examples, edge cases. These are the load-bearing details; abstracting them away destroys the value.
- Preserve the scaffold's structure: keep all section headings exactly. Populate bullets under each from the answers.
- Where an answer is missing, shallow, or doesn't cover a scaffold section, insert "[fill in: <one-line hint specific to that section>]" rather than fabricating content. Make the hint about what THAT section needs — not generic.
- Use the operator's voice and vocabulary from the answers. No marketing tone, no corporate hedging, no emojis.
- Stay strictly in the [${lensType}] lens. If an answer drifts into another lens's territory, leave the content where it is — don't relocate it across lenses.
- No "Here's your draft:" preamble. No markdown decoration beyond what the scaffold uses.

Output ONLY the lens content. Nothing before, nothing after.`;

    const userMessage = filled
      .map((x, i) => `Q${i + 1}: ${x.q}\nA: ${x.a}`)
      .join('\n\n');

    const res = await fetch('http://localhost:3001/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        model: model || 'claude-sonnet-4-6',
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error?.message || data?.error || `API error ${res.status}`;
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    return text;
  }, [apiKey, model]);

  // Stacked Video — POST to /api/stack-video, server runs scale+pad+vstack/hstack
  // and returns the composite. Same nodeOutputs.url shape so downstream nodes
  // (FFmpeg grade, Pop Beats, etc.) can consume it transparently.
  const onStackVideoRender = useCallback(async (nodeId, opts) => {
    const { topUrl, bottomUrl, orientation, width, height, audioMode, syncMode } = opts || {};
    if (!topUrl || !bottomUrl) return;
    setNodeOutputs((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], status: 'rendering', url: '', error: '' } }));
    try {
      const res = await fetch('http://localhost:3001/api/stack-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topUrl, bottomUrl, orientation, width, height, audioMode, syncMode,
          name: `stacked_${nodeId.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Stacked Video render failed');
      setNodeOutputs((prev) => ({
        ...prev,
        [nodeId]: { ...prev[nodeId], status: 'done', url: data.url, orientation: data.orientation, width: data.width, height: data.height, error: '' },
      }));
    } catch (err) {
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], status: 'error', url: '', error: err.message || String(err) } }));
    }
  }, []);

  // ARES Script Gen — corpus-aware Claude call. Sends beats + framing +
  // length + optional note to /api/ares/generate. Server handles the
  // corpus (Beat Sheet + Timeline + synthesis + persona) and the framing
  // rules. We just write the result to nodeOutputs in the same shape
  // NicheScriptGen uses, so downstream consumers work unchanged.
  const onAresGenerate = useCallback(async (nodeId, { beats, framing, length, format, customNote }) => {
    if (!apiKey) {
      setNodeOutputs((prev) => ({
        ...prev,
        [nodeId]: { ...prev[nodeId], status: 'error', error: 'Anthropic API key not set' },
      }));
      return;
    }
    setNodeOutputs((prev) => ({
      ...prev,
      [nodeId]: { ...prev[nodeId], status: 'generating', script: '', error: '' },
    }));
    try {
      // Longform can take 30-60s on Opus; allow 5min ceiling.
      const ac = new AbortController();
      const timeoutHandle = setTimeout(() => ac.abort(), 5 * 60 * 1000);
      const res = await fetch('http://localhost:3001/api/ares/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ beats, framing, length, format, customNote, apiKey, model }),
        signal: ac.signal,
      }).finally(() => clearTimeout(timeoutHandle));
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Generate failed');
      setNodeOutputs((prev) => ({
        ...prev,
        [nodeId]: {
          ...prev[nodeId],
          status: 'done',
          script: data.script,
          wordCount: data.wordCount,
          beats: data.beats,
          framing: data.framing,
          length: data.length,
          format: data.format,
          error: '',
        },
      }));
    } catch (err) {
      setNodeOutputs((prev) => ({
        ...prev,
        [nodeId]: { ...prev[nodeId], status: 'error', error: err.message },
      }));
    }
  }, [apiKey, model]);

  // Motion Bake — two-phase. Plan calls Claude (~5s), Render calls
  // Hyperframes CLI sequentially (~20-40s per beat). Both write back to
  // nodeOutputs. The bake also publishes the asset-sequence shape so
  // a wired Cartesian downstream picks up the assets without an extra step.
  const onMotionBakePlan = useCallback(async (nodeId, { script, accentColor }) => {
    setNodeOutputs((prev) => ({
      ...prev,
      [nodeId]: { ...prev[nodeId], planStatus: 'planning', beats: [], assets: [], error: '' },
    }));
    try {
      const res = await fetch('http://localhost:3001/api/motion-bake/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script, accentColor }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Plan failed');
      setNodeOutputs((prev) => ({
        ...prev,
        [nodeId]: { ...prev[nodeId], planStatus: 'done', beats: data.plan?.beats || [], error: '' },
      }));
    } catch (err) {
      setNodeOutputs((prev) => ({
        ...prev,
        [nodeId]: { ...prev[nodeId], planStatus: 'error', error: err.message },
      }));
    }
  }, []);

  const onMotionBakeRender = useCallback(async (nodeId, { beats, accentColor }) => {
    setNodeOutputs((prev) => ({
      ...prev,
      [nodeId]: { ...prev[nodeId], bakeStatus: 'baking', assets: [], error: '' },
    }));
    try {
      // Per-beat render through the Hyperframes CLI is slow (~20-40s each).
      // Allow a generous 30 minute fetch ceiling for a 6-beat plan.
      const ac = new AbortController();
      const timeoutHandle = setTimeout(() => ac.abort(), 30 * 60 * 1000);
      const res = await fetch('http://localhost:3001/api/motion-bake/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          beats,
          accentColor,
          name: `${nodeId.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`,
        }),
        signal: ac.signal,
      }).finally(() => clearTimeout(timeoutHandle));
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Bake failed');
      setNodeOutputs((prev) => ({
        ...prev,
        [nodeId]: { ...prev[nodeId], bakeStatus: 'done', assets: data.assets || [], error: '' },
      }));
    } catch (err) {
      setNodeOutputs((prev) => ({
        ...prev,
        [nodeId]: { ...prev[nodeId], bakeStatus: 'error', error: err.message },
      }));
    }
  }, []);

  // Skyframe Picker — single-effect transparent .webm render via the
  // server's cached endpoint. Pure async; the picker node owns its own slot
  // state and updates per-slot status from the resolved value (or thrown
  // error). Cache hits return in <100ms; cold renders take 5-30s depending
  // on effect complexity (Win95Terminal is the longest — code streams +
  // typing + wipe + payoff). The 5-min ceiling is generous headroom.
  const onSkyframeRender = useCallback(async ({ component, props, durationSec }) => {
    const ac = new AbortController();
    const timeoutHandle = setTimeout(() => ac.abort(), 5 * 60 * 1000);
    try {
      const res = await fetch('http://localhost:3001/api/remotion/skyframe-effect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ component, props, durationSec }),
        signal: ac.signal,
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Skyframe render failed');
      return data;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }, []);

  // Cartesian Composer — POST zones + base video to /api/remotion/cartesian-composite,
  // server stages the base, ffprobes for dimensions/duration, spawns Remotion.
  // 4K + many zones can take a while; allow up to 30 minutes patience client-side.
  const onCartesianRender = useCallback(async (nodeId, { videoUrl, zones, durationSec, baseLoop }) => {
    setNodeOutputs((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], status: 'rendering', url: '', error: '' } }));
    try {
      const ac = new AbortController();
      const timeoutHandle = setTimeout(() => ac.abort(), 30 * 60 * 1000);
      const res = await fetch('http://localhost:3001/api/remotion/cartesian-composite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl,
          zones,
          durationSec: durationSec || undefined,
          baseLoop: !!baseLoop,
          name: `${nodeId.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`,
        }),
        signal: ac.signal,
      }).finally(() => clearTimeout(timeoutHandle));
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Render failed');
      setNodeOutputs((prev) => ({
        ...prev,
        [nodeId]: {
          ...prev[nodeId],
          status: 'done', url: data.url, error: '',
          width: data.width, height: data.height, durationSec: data.durationSec,
          isImage: data.isImage, probedDurationSec: data.probedDurationSec,
        },
      }));
    } catch (err) {
      setNodeOutputs((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], status: 'error', error: err.message } }));
    }
  }, []);

  // Pixel Forge — pure local prompt assembly (Midjourney-targeted), no API call.
  // Emits 3 mood variations and writes both `.prompt` (variation[0]) and `.script`
  // so downstream nodes that read either shape (Image-2 freeform, output, etc.)
  // can consume the result without special-casing.
  const onPixelForgeGenerate = useCallback((nodeId, params) => {
    const variations = [
      { mood: 'baseline' },
      { mood: 'dramatic lighting' },
      { mood: 'vibrant colors' },
    ];
    const moodSuffix = (m) => m === 'baseline' ? '' : `, ${m}, ${m === 'dramatic lighting' ? 'moody atmosphere' : 'dynamic composition'}`;
    const results = variations.map((v, i) => {
      const r = buildPixelArtPrompt({
        subject: params.subject + moodSuffix(v.mood),
        bitDepth: params.bitDepth,
        style: params.style,
        assetType: params.assetType,
        viewAngle: params.viewAngle,
        quality: params.quality,
      });
      return { index: i + 1, mood: v.mood, prompt: r.prompt };
    });
    setNodeOutputs((prev) => ({
      ...prev,
      [nodeId]: {
        prompts: results,
        prompt: results[0].prompt,
        script: results[0].prompt,
        status: 'done',
      },
    }));
  }, []);

  // Context value — no useEffect needed, nodes read from context on render
  const onDeleteEdge = useCallback((edgeId) => {
    setEdges((eds) => eds.filter((e) => e.id !== edgeId));
  }, [setEdges]);

  const ctx = useMemo(() => ({
    onSpawn,
    onDespawn,
    hasIngredients,
    onGenerate,
    onCopyPrompt,
    onKieGenerate,
    onGamiGenerate,
    onImageTwoBatchGenerate,
    onGamiArtBatchGenerate,
    onUgcGenerate,
    onAvatarScanFolder,
    onCharacterSceneGenerate,
    onAreciboRecap,
    onAreciboRender,
    onConductorSend,
    onConductorAccept,
    onConductorDiscard,
    onConductorRejectNode,
    onConductorHover,
    conductorBatch,
    onClipSplit,
    onUgcVideoBatchGenerate,
    onNicheGenerate,
    onRunLane,
    laneRun,
    syncNodeData,
    onCarouselRender,
    onVideoPromptBatchGenerate,
    onKieImg2VidBatchGenerate,
    onTitleCardBatchGenerate,
    onFrameSandwichGenerate,
    onRemotionComposite,
    onFfmpegGrade,
    openFilePicker,
    onChromaComposite,
    onChromaMotion,
    onChromaStylize,
    onHyperframesOverlay,
    onBrollSuggest,
    onBrollRender,
    onVideoSourcePublish,
    onAssetSequencePublish,
    onMotionBakePlan,
    onMotionBakeRender,
    onAresGenerate,
    onSkyframeRender,
    onCartesianRender,
    onPixelForgeGenerate,
    onSpriteForgeGenerate,
    setChunkOutput,
    onLensPublish,
    onLensEnhance,
    onLensCraft,
    onPRDGenerate,
    onPopBeatsRender,
    onStackVideoRender,
    onDeleteNode,
    onDeleteEdge,
    onOpenPanel: () => setShowPanel(true),
    onOpenVideo: () => setShowVideoPanel(true),
    pipeline: { count: resolved.count, status, charName: resolved.character?.name, preview: script?.substring(0, 80), error: genError },
    prompts,
    script,
    edges,
    kieResult,
    gamiResult,
    nodeOutputs,
    nodes,
    anthropicApiKey: apiKey,
    anthropicModel: model,
    startKieJob,
    maybeStartNextJob,
    resumeKiePoll,
    mutateNodeOutput,
  }), [onSpawn, onDespawn, hasIngredients, onGenerate, onCopyPrompt, onKieGenerate, onGamiGenerate, onImageTwoBatchGenerate, onGamiArtBatchGenerate, onUgcGenerate, onAvatarScanFolder, onCharacterSceneGenerate, onAreciboRecap, onAreciboRender, onConductorSend, onConductorAccept, onConductorDiscard, onConductorRejectNode, onConductorHover, conductorBatch, onClipSplit, onUgcVideoBatchGenerate, onNicheGenerate, onRunLane, laneRun, syncNodeData, onCarouselRender, onVideoPromptBatchGenerate, onKieImg2VidBatchGenerate, onTitleCardBatchGenerate, onFrameSandwichGenerate, onRemotionComposite, onFfmpegGrade, onChromaComposite, onChromaMotion, onChromaStylize, onHyperframesOverlay, openFilePicker, onBrollSuggest, onBrollRender, onVideoSourcePublish, onAssetSequencePublish, onMotionBakePlan, onMotionBakeRender, onAresGenerate, onSkyframeRender, onCartesianRender, onPixelForgeGenerate, onSpriteForgeGenerate, setChunkOutput, mutateNodeOutput, onLensPublish, onLensEnhance, onPRDGenerate, onPopBeatsRender, onStackVideoRender, onDeleteNode, onDeleteEdge, resolved, status, script, genError, prompts, edges, kieResult, gamiResult, nodeOutputs, nodes, apiKey, model, startKieJob, maybeStartNextJob, resumeKiePoll]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build dynamic character palette entries from the live characters list.
  // Re-renders when the operator adds/removes characters via the +Add Character form.
  const characterPaletteItems = useMemo(() => characters.map((c) => ({
    type: 'character',
    label: c.name,
    icon: '👤',
    desc: c.niche || c.handle || 'AI influencer character',
    color: c.accentColor || '#C9A227',
    category: 'Characters',
    data: { characterId: c.id },
  })), [characters]);

  // Reset canvas — wipe every node, edge, and per-node result. Saved state
  // catches up via the existing 1s-debounced persist effect.
  const onResetCanvas = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setNodeOutputs({});
  }, [setNodes, setEdges]);

  return (
    <CanvasCtx.Provider value={ctx}>
      <div style={{ width: '100%', height: 'calc(100vh - 50px)', position: 'relative', display: 'flex' }}>
        <NodePalette collapsed={paletteCollapsed} onToggle={() => setPaletteCollapsed(!paletteCollapsed)} extraItems={characterPaletteItems} onResetCanvas={onResetCanvas} />
        <div style={{ flex: 1, position: 'relative' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDragOver={onDragOver}
            onDrop={onDrop}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={{ type: 'pulse' }}
            fitView
            minZoom={0.3}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#1a1a24" gap={20} size={1} />
            <Controls />
            <MiniMap nodeColor={() => '#444'} maskColor="rgba(10,10,15,0.85)" />
            <ReviewBar />
            <Panel position="top-center" className="cv-recipe-picker">
              <select
                className="cv-recipe-select nodrag"
                value={selectedRecipeId || ''}
                onChange={(e) => setSelectedRecipeId(e.target.value || null)}
                title="Locked workflow templates with wiring diagrams"
              >
                <option value="">📋 Recipes — pick a workflow</option>
                {RECIPES.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </Panel>
            {selectedRecipe && (
              <Panel position="top-center" className="cv-recipe-diagram nodrag">
                <div className="cv-recipe-diagram-header">
                  <div className="cv-recipe-diagram-title">
                    <span className="cv-recipe-diagram-badge">RECIPE</span>
                    <strong>{selectedRecipe.name}</strong>
                    <span className="cv-recipe-diagram-locked">locked {selectedRecipe.lockedAt}</span>
                  </div>
                  <button
                    className="cv-recipe-diagram-close"
                    onClick={() => setSelectedRecipeId(null)}
                    title="Close diagram"
                  >×</button>
                </div>
                <div className="cv-recipe-diagram-desc">{selectedRecipe.description}</div>
                <pre className="cv-recipe-diagram-art">{selectedRecipe.diagram}</pre>
                {selectedRecipe.locks?.length > 0 && (
                  <div className="cv-recipe-diagram-locks">
                    <div className="cv-recipe-diagram-locks-title">🔒 Locks</div>
                    <ul>
                      {selectedRecipe.locks.map((l, i) => <li key={i}>{l}</li>)}
                    </ul>
                  </div>
                )}
                <div className="cv-recipe-diagram-footer">
                  <span>Skill: <code>{selectedRecipe.skillFile}</code></span>
                  <span>Canonical: <code>{selectedRecipe.canonicalComposition}</code></span>
                </div>
              </Panel>
            )}
          </ReactFlow>
          {showPanel && <ScriptPanel script={script} prompts={prompts} onClose={() => setShowPanel(false)} />}
          {showVideoPanel && <VideoPanel character={resolved.character} script={script} onClose={() => setShowVideoPanel(false)} />}
          <ApiPanel apiKey={apiKey} model={model} onKeyChange={setApiKey} onModelChange={setModel} />
          <LastErrorPill nodeOutputs={nodeOutputs} nodes={nodes} />
          <FilePickerModal state={filePickerState} onClose={closeFilePicker} />
        </div>
      </div>
      {showOnboarding && (
        <OnboardingModal
          anthropicKey={apiKey}
          onAnthropicKey={setApiKey}
          kieKey={kieKey}
          onKieKey={setKieKey}
          onPick={applyTemplate}
          onSkip={dismissOnboarding}
        />
      )}
    </CanvasCtx.Provider>
  );
}

export default function CanvasView() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
      <VoiceDock />
    </ReactFlowProvider>
  );
}
