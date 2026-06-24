import { useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { CanvasCtx } from './CanvasView.jsx';

// Prop Lab — canvas-side ARES prop ideation surface. Sister to the chat-time
// ares-prop-creator skill. Operator describes a prop idea in plain language;
// Claude returns { pitch, spec (6 elements), buildPrompt }. Entries accumulate
// in localStorage and persist across reloads. Build trigger is "copy build
// prompt" → paste into a Claude Code session with ares-prop-creator loaded.
//
// See docs/superpowers/specs/2026-05-18-prop-lab-node-design.md for the
// full design rationale + LLM prompt template.

const NODE_ACCENT = '#fbbf24';
const STORAGE_KEY = 'propLab/library';
const STORAGE_VERSION = 1;

const MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Sonnet' },
  { id: 'claude-opus-4-7', label: 'Opus' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku' },
];

// Pin dropdowns. Empty `value` = "let Claude pick" — sent as null in the
// constraints block so the LLM treats it as free.
const PICK_PLACEHOLDER = { value: '', label: 'Other / let Claude pick' };

const INVARIANT_OPTIONS = [
  PICK_PLACEHOLDER,
  { value: 'Packet Binding', label: 'Packet Binding' },
  { value: 'Phase Enforcement', label: 'Phase Enforcement' },
  { value: 'Evidence Grounding', label: 'Evidence Grounding' },
  { value: 'Deterministic Verdicts', label: 'Deterministic Verdicts' },
  { value: 'Firewall (regex-gate)', label: 'Firewall (regex-gate)' },
  { value: 'Hot-Swap (fresh-agent spawn)', label: 'Hot-Swap (fresh-agent spawn)' },
];

const VISUAL_OPTIONS = [
  PICK_PLACEHOLDER,
  { value: 'Wireframe geometric', label: 'Wireframe geometric' },
  { value: 'Solid sculpted', label: 'Solid sculpted' },
  { value: 'Line + orb', label: 'Line + orb' },
  { value: 'Particle swarm', label: 'Particle swarm' },
  { value: 'Glyph-symbol', label: 'Glyph-symbol' },
  { value: 'Holographic panel', label: 'Holographic panel' },
];

const ANCHOR_OPTIONS = [
  PICK_PLACEHOLDER,
  { value: 'Palm-center', label: 'Palm-center' },
  { value: 'Floats above palm', label: 'Floats above palm' },
  { value: 'Wrist-locked', label: 'Wrist-locked' },
  { value: 'Fingertip', label: 'Fingertip' },
  { value: 'Two-handed', label: 'Two-handed' },
];

const GESTURE_OPTIONS = [
  PICK_PLACEHOLDER,
  { value: 'Thumb-scale', label: 'Thumb-scale' },
  { value: 'Wrist-roll rotate', label: 'Wrist-roll rotate' },
  { value: 'Sudden-yank snap', label: 'Sudden-yank snap' },
  { value: 'Sustained-tilt threshold', label: 'Sustained-tilt threshold' },
  { value: 'Pinch-drop', label: 'Pinch-drop' },
  { value: 'Push toward camera', label: 'Push toward camera' },
];

const DEMO_OPTIONS = [
  PICK_PLACEHOLDER,
  { value: 'Emergent reveal', label: 'Emergent reveal' },
  { value: 'Threshold snap', label: 'Threshold snap' },
  { value: 'Transformation', label: 'Transformation' },
  { value: 'Spawn-and-merge', label: 'Spawn-and-merge' },
  { value: 'Pass/reject judgment', label: 'Pass/reject judgment' },
];

const AUDIO_OPTIONS = [
  PICK_PLACEHOLDER,
  { value: 'Glassy chime', label: 'Glassy chime' },
  { value: 'Low-harmonic resonance', label: 'Low-harmonic resonance' },
  { value: 'Snap-release click', label: 'Snap-release click' },
  { value: 'Brass click', label: 'Brass click' },
  { value: 'Granular swarm', label: 'Granular swarm' },
  { value: 'Sine pip', label: 'Sine pip' },
];

const ELEMENT_FIELDS = ['invariant', 'visual', 'anchor', 'gesture', 'demo', 'audio'];

const SYSTEM_PROMPT = `You are a design assistant specing a new prop for the ARES Concept Composer — a hand-tracked WebGL stage in a video tool. Each prop physically enacts an ARES invariant via gesture + visual + audio. You output a structured JSON spec.

Output ONLY valid JSON matching this exact shape:
{
  "pitch": "1–3 sentence natural-language pitch",
  "spec": {
    "invariant": "the ARES invariant this prop enacts (1 sentence)",
    "visual": "material + motion vocabulary + shape language (1–2 sentences)",
    "anchor": "where on the hand the prop sits + offset (1 sentence)",
    "gesture": "the motion that triggers the demo moment (1–2 sentences)",
    "demo": "the wow-moment that makes the invariant click (1–2 sentences)",
    "audio": "timbre + when it fires (1–2 sentences)"
  },
  "buildPrompt": "a ready-to-paste instruction for a Claude Code session that has the ares-prop-creator skill loaded. It should hand all 6 elements verbatim and request direct mechanical implementation per the 5-step pattern (gesture recognizer + glyph factory + audio palette + factory map entry + dropdown option). Use the canonical PascalName + lowercase short-name convention. Reference docs/superpowers/specs/ for the spec filename pattern."
}

ARES invariants (canon, exactly 6):
- Packet Binding — agents can only see facts from their assigned evidence packet
- Phase Enforcement — judgment runs in strict phases that must complete in order
- Evidence Grounding — every claim traces back to a cited source
- Deterministic Verdicts — same input → same verdict; no random sampling at decision time
- Firewall (regex-gate) — inputs are screened by a regex rule before entering the system
- Hot-Swap (fresh-agent spawn) — every cycle of judgment runs in a fresh agent with no carry-over identity

Existing props (reference, don't duplicate concept; you CAN reference for family resemblance):
- Sealed Lattice Cube (Packet Binding, wireframe dodecahedron, thumb-scale)
- Phase Disc (Phase Enforcement, 3 sectors + spotlight, wrist-roll)
- Citation Wire (Evidence Grounding, two-hand line+orb, sudden-yank)
- Verdict Scale (Deterministic Verdicts, brass balance, sustained-tilt)
- Firewall Gate (Firewall, cyan wire-ring above palm, thumb-scale, internal-timer reveal)
- Hot-Swap Swarm (Hot-Swap, particle swarm two-handed, sudden-yank, color-lerp transit)
- Firewall HUD (Firewall readable variant, holographic regex panel, pinch-drop, token stream)

Implementation conventions (reference for the spec text — keeps the spec implementable):
- World mapping: FOV 50°, camera z=3, aspect 1280/720 (computed in conceptStage.js)
- GLYPH_FACTORIES map keys are lowercase short-names; glyph factory directories are PascalCase
- Audio palette lives in src/lib/audioPalettes.js (Web Audio API; fire-and-forget play functions)
- Gesture recognizers in src/lib/gestures/ (side-effect registerPropRecognizer call)
- Glyph factories in src/concept-glyphs/<PascalName>/index.js
- Dropdown registration in src/canvas/ConceptComposerNode.jsx

No markdown fences. No prose around the JSON. JSON only.`;

// ─── localStorage helpers ─────────────────────────────────────────────────

function loadLibrary() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (parsed?.version !== STORAGE_VERSION) {
      console.warn(`[PropLab] unknown library version ${parsed?.version}; ignoring`);
      return [];
    }
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch (err) {
    console.error('[PropLab] failed to load library:', err);
    return [];
  }
}

function saveLibrary(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, entries }));
  } catch (err) {
    console.error('[PropLab] failed to save library:', err);
  }
}

function makeEntryId() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const nonce = Math.random().toString(36).slice(2, 5);
  return `pl-${ts}-${nonce}`;
}

function sortEntries(entries) {
  // Starred first, then most-recent first. Returns a new array.
  return [...entries].sort((a, b) => {
    if (!!a.starred !== !!b.starred) return a.starred ? -1 : 1;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
}

// ─── LLM call ─────────────────────────────────────────────────────────────

function buildUserPrompt({ prompt, mode, pins }) {
  let composed = prompt.trim();
  // Only include constraint block for pinned/detailed modes with actual pins set.
  if (mode !== 'quick') {
    const setPins = ELEMENT_FIELDS.filter((f) => pins[f] && pins[f].trim());
    if (setPins.length) {
      const lines = setPins.map((f) => `- ${f}: ${pins[f]}`);
      composed += `\n\nConstraints (MUST honor):\n${lines.join('\n')}`;
    }
  }
  return composed;
}

function parseResponse(raw) {
  // Strip code fences if Claude wraps despite the instruction.
  let text = (raw || '').trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: err.message, raw };
  }
  const spec = parsed.spec || {};
  const cleanSpec = {};
  for (const f of ELEMENT_FIELDS) {
    cleanSpec[f] = typeof spec[f] === 'string' && spec[f].trim()
      ? spec[f].trim()
      : 'TBD — manual cleanup';
  }
  return {
    ok: true,
    entry: {
      pitch: typeof parsed.pitch === 'string' ? parsed.pitch.trim() : 'TBD — manual cleanup',
      spec: cleanSpec,
      buildPrompt: typeof parsed.buildPrompt === 'string' ? parsed.buildPrompt.trim() : 'TBD — manual cleanup',
    },
  };
}

async function callPropLabLLM({ prompt, mode, pins, model, apiKey }) {
  const userContent = buildUserPrompt({ prompt, mode, pins });
  const res = await fetch('http://localhost:3001/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      model,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
      max_tokens: 2000,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  return parseResponse(text);
}

// ─── Component ────────────────────────────────────────────────────────────

const EMPTY_PINS = { invariant: '', visual: '', anchor: '', gesture: '', demo: '', audio: '' };

export default function PropLabNode({ id }) {
  const { onDeleteNode, anthropicApiKey, anthropicModel } = useContext(CanvasCtx);

  const [mode, setMode] = useState('quick');
  const [pins, setPins] = useState(EMPTY_PINS);
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState(anthropicModel || 'claude-sonnet-4-6');
  const [libraryRaw, setLibraryRaw] = useState(() => loadLibrary());
  const [expandedId, setExpandedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editBuffer, setEditBuffer] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const library = useMemo(() => sortEntries(libraryRaw), [libraryRaw]);

  // Persist whenever library mutates.
  useEffect(() => {
    saveLibrary(libraryRaw);
  }, [libraryRaw]);

  const setPin = useCallback((field, value) => {
    setPins((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleGenerate = useCallback(async () => {
    if (busy) return;
    const trimmed = prompt.trim();
    if (!trimmed) {
      setErrorMsg('Write a prop idea first.');
      return;
    }
    if (!anthropicApiKey) {
      setErrorMsg('Set Anthropic key in the canvas API panel.');
      return;
    }
    setBusy(true);
    setErrorMsg('');
    setStatusMsg(`Calling Claude (model: ${MODELS.find((m) => m.id === model)?.label || model})…`);
    try {
      const result = await callPropLabLLM({ prompt: trimmed, mode, pins, model, apiKey: anthropicApiKey });
      const now = new Date().toISOString();
      const entry = {
        id: makeEntryId(),
        createdAt: now,
        starred: false,
        mode,
        originalPrompt: trimmed,
        pins: { ...pins },
        ...(result.ok
          ? result.entry
          : {
              pitch: `Couldn't parse JSON — raw response below.\n\n${result.raw || '(empty)'}`,
              spec: ELEMENT_FIELDS.reduce((acc, f) => { acc[f] = 'TBD — manual cleanup'; return acc; }, {}),
              buildPrompt: 'TBD — manual cleanup',
            }),
        needsCleanup: !result.ok,
      };
      setLibraryRaw((prev) => [entry, ...prev]);
      setExpandedId(entry.id);
      setPrompt('');
      setStatusMsg(result.ok ? 'Spec saved to library.' : 'Saved with TBD markers — manual cleanup needed.');
    } catch (err) {
      const msg = err.status === 429
        ? 'Rate limited. Try again in a moment.'
        : err.status >= 500
          ? `Claude proxy error (HTTP ${err.status}).`
          : `Failed to reach Claude: ${err.message}`;
      setErrorMsg(msg);
      setStatusMsg('');
    } finally {
      setBusy(false);
    }
  }, [busy, prompt, mode, pins, model, anthropicApiKey]);

  const handleToggleExpand = useCallback((entryId) => {
    setExpandedId((prev) => (prev === entryId ? null : entryId));
    setEditingId(null);
    setEditBuffer(null);
  }, []);

  const handleStar = useCallback((entryId) => {
    setLibraryRaw((prev) => prev.map((e) => (e.id === entryId ? { ...e, starred: !e.starred } : e)));
  }, []);

  const handleDelete = useCallback((entryId) => {
    if (confirmDeleteId !== entryId) {
      setConfirmDeleteId(entryId);
      setTimeout(() => setConfirmDeleteId((curr) => (curr === entryId ? null : curr)), 2500);
      return;
    }
    setLibraryRaw((prev) => prev.filter((e) => e.id !== entryId));
    setConfirmDeleteId(null);
    if (expandedId === entryId) setExpandedId(null);
    if (editingId === entryId) { setEditingId(null); setEditBuffer(null); }
  }, [confirmDeleteId, expandedId, editingId]);

  const handleEditStart = useCallback((entry) => {
    setEditingId(entry.id);
    setEditBuffer({
      pitch: entry.pitch,
      spec: { ...entry.spec },
      buildPrompt: entry.buildPrompt,
    });
  }, []);

  const handleEditCancel = useCallback(() => {
    setEditingId(null);
    setEditBuffer(null);
  }, []);

  const handleEditSave = useCallback(() => {
    if (!editingId || !editBuffer) return;
    setLibraryRaw((prev) => prev.map((e) => (
      e.id === editingId
        ? { ...e, pitch: editBuffer.pitch, spec: { ...editBuffer.spec }, buildPrompt: editBuffer.buildPrompt, needsCleanup: false }
        : e
    )));
    setEditingId(null);
    setEditBuffer(null);
  }, [editingId, editBuffer]);

  const handleEditField = useCallback((field, value) => {
    setEditBuffer((prev) => (
      ELEMENT_FIELDS.includes(field)
        ? { ...prev, spec: { ...prev.spec, [field]: value } }
        : { ...prev, [field]: value }
    ));
  }, []);

  const handleCopyBuild = useCallback(async (entry) => {
    try {
      await navigator.clipboard.writeText(entry.buildPrompt || '');
      setStatusMsg('Build prompt copied to clipboard.');
      setTimeout(() => setStatusMsg((curr) => (curr === 'Build prompt copied to clipboard.' ? '' : curr)), 2000);
    } catch (err) {
      setErrorMsg(`Clipboard failed: ${err.message}`);
    }
  }, []);

  const handleClearLibrary = useCallback(() => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 2500);
      return;
    }
    setLibraryRaw([]);
    setExpandedId(null);
    setEditingId(null);
    setEditBuffer(null);
    setConfirmClear(false);
  }, [confirmClear]);

  return (
    <div
      style={{
        background: 'var(--bg-panel, #1a1a24)',
        color: '#e8e8e8',
        border: `1.5px solid ${NODE_ACCENT}`,
        borderRadius: 8,
        padding: 12,
        width: 580,
        fontSize: 12,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 8,
          paddingBottom: 8,
          borderBottom: `1px solid ${NODE_ACCENT}`,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            background: busy ? '#f59e0b' : errorMsg ? '#ef4444' : '#666',
          }}
        />
        <strong style={{ flex: 1 }}>Prop Lab</strong>
        <span style={{ color: NODE_ACCENT, fontSize: 10 }}>ARES IDEATION</span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDeleteNode(id); }}
          title="Delete node"
          style={deleteBtnStyle}
        >×</button>
      </div>

      {/* Mode toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <label style={pinLabelStyle}>Mode</label>
        <div style={{ display: 'flex', gap: 0, flex: 1 }}>
          {['quick', 'pinned', 'detailed'].map((m) => (
            <button
              key={m}
              type="button"
              className="nodrag"
              onClick={(e) => { e.stopPropagation(); setMode(m); }}
              style={segmentedBtnStyle(mode === m)}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Pin fields */}
      {mode !== 'quick' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
          <PinSelect label="Invariant" value={pins.invariant} options={INVARIANT_OPTIONS} onChange={(v) => setPin('invariant', v)} />
          <PinSelect label="Anchor" value={pins.anchor} options={ANCHOR_OPTIONS} onChange={(v) => setPin('anchor', v)} />
          {mode === 'detailed' && (
            <>
              <PinSelect label="Visual" value={pins.visual} options={VISUAL_OPTIONS} onChange={(v) => setPin('visual', v)} />
              <PinSelect label="Gesture" value={pins.gesture} options={GESTURE_OPTIONS} onChange={(v) => setPin('gesture', v)} />
              <PinSelect label="Demo" value={pins.demo} options={DEMO_OPTIONS} onChange={(v) => setPin('demo', v)} />
              <PinSelect label="Audio" value={pins.audio} options={AUDIO_OPTIONS} onChange={(v) => setPin('audio', v)} />
            </>
          )}
        </div>
      )}

      {/* Prompt textarea */}
      <textarea
        className="nodrag"
        value={prompt}
        onChange={(e) => { e.stopPropagation(); setPrompt(e.target.value); }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        placeholder="Describe the prop idea + its behavior…"
        rows={8}
        style={textareaStyle}
      />

      {/* Generate row */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
        <button
          type="button"
          className="nodrag"
          onClick={(e) => { e.stopPropagation(); handleGenerate(); }}
          disabled={busy}
          style={{ ...generateBtnStyle, opacity: busy ? 0.7 : 1, cursor: busy ? 'wait' : 'pointer' }}
        >
          {busy ? 'Generating…' : '✨ Generate Spec'}
        </button>
        <select
          className="nodrag"
          value={model}
          onChange={(e) => { e.stopPropagation(); setModel(e.target.value); }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          style={modelSelectStyle}
        >
          {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </div>

      {/* Status line */}
      {(statusMsg || errorMsg) && (
        <div
          style={{
            fontSize: 10,
            color: errorMsg ? '#ef4444' : '#22c55e',
            marginBottom: 8,
            padding: '4px 6px',
            background: errorMsg ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)',
            borderRadius: 3,
          }}
        >
          {errorMsg || statusMsg}
        </div>
      )}

      {/* Library header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 8,
          paddingTop: 8,
          borderTop: `1px solid rgba(251, 191, 36, 0.3)`,
        }}
      >
        <strong style={{ fontSize: 11, color: NODE_ACCENT }}>Library ({library.length})</strong>
        <span style={{ flex: 1 }} />
        {library.length > 0 && (
          <button
            type="button"
            className="nodrag"
            onClick={(e) => { e.stopPropagation(); handleClearLibrary(); }}
            style={{ ...linkBtnStyle, color: confirmClear ? '#ef4444' : '#888' }}
          >
            {confirmClear ? `Confirm clear ${library.length}?` : `Clear (${library.length})`}
          </button>
        )}
        <button
          type="button"
          className="nodrag"
          onClick={(e) => { e.stopPropagation(); setLibraryCollapsed((v) => !v); }}
          style={linkBtnStyle}
        >
          {libraryCollapsed ? '▸ Expand' : '▾ Collapse'}
        </button>
      </div>

      {/* Library list */}
      {!libraryCollapsed && (
        <div style={{ maxHeight: 480, overflowY: 'auto', marginTop: 6 }} className="nodrag">
          {library.length === 0 ? (
            <div style={emptyStateStyle}>No entries yet. Generate your first.</div>
          ) : (
            library.map((entry) => (
              <LibraryCard
                key={entry.id}
                entry={entry}
                expanded={expandedId === entry.id}
                editing={editingId === entry.id}
                editBuffer={editBuffer}
                confirmDelete={confirmDeleteId === entry.id}
                onToggleExpand={() => handleToggleExpand(entry.id)}
                onStar={() => handleStar(entry.id)}
                onDelete={() => handleDelete(entry.id)}
                onCopyBuild={() => handleCopyBuild(entry)}
                onEditStart={() => handleEditStart(entry)}
                onEditCancel={handleEditCancel}
                onEditSave={handleEditSave}
                onEditField={handleEditField}
              />
            ))
          )}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        id="prop-lab-out"
        style={{ background: NODE_ACCENT, width: 12, height: 12 }}
      />
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function PinSelect({ label, value, options, onChange }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={pinLabelStyle}>{label}</span>
      <select
        className="nodrag"
        value={value}
        onChange={(e) => { e.stopPropagation(); onChange(e.target.value); }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        style={pinSelectStyle}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function LibraryCard({ entry, expanded, editing, editBuffer, confirmDelete, onToggleExpand, onStar, onDelete, onCopyBuild, onEditStart, onEditCancel, onEditSave, onEditField }) {
  const dateLabel = (entry.createdAt || '').slice(0, 10);
  const invariantSummary = entry.spec?.invariant?.split(/[.——]/)[0]?.slice(0, 40) || 'TBD';
  const headline = `${entry.pitch?.split(/[.\n]/)[0]?.slice(0, 50) || 'Untitled'} — ${invariantSummary} · ${dateLabel}`;

  return (
    <div
      style={{
        border: `1px solid ${entry.needsCleanup ? '#ef4444' : 'rgba(251,191,36,0.25)'}`,
        borderRadius: 4,
        marginBottom: 6,
        background: 'rgba(0,0,0,0.18)',
      }}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
        style={cardHeaderBtnStyle}
      >
        <span style={{ marginRight: 6 }}>{expanded ? '▾' : '▸'}</span>
        <span style={{ flex: 1, textAlign: 'left' }}>{headline}</span>
        {entry.starred && <span style={{ color: '#fbbf24', marginRight: 4 }}>⭐</span>}
        {entry.needsCleanup && <span style={{ color: '#ef4444', fontSize: 9, marginRight: 4 }}>NEEDS CLEANUP</span>}
      </button>

      {expanded && (
        <div style={{ padding: 8, borderTop: '1px solid rgba(251,191,36,0.2)' }}>
          {editing && editBuffer ? (
            <EditView buffer={editBuffer} onField={onEditField} />
          ) : (
            <ReadView entry={entry} />
          )}

          <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
            {editing ? (
              <>
                <button onClick={(e) => { e.stopPropagation(); onEditSave(); }} style={smallBtnStyle('#22c55e')}>✓ Save</button>
                <button onClick={(e) => { e.stopPropagation(); onEditCancel(); }} style={smallBtnStyle('#666')}>✕ Cancel</button>
              </>
            ) : (
              <>
                <button onClick={(e) => { e.stopPropagation(); onCopyBuild(); }} style={smallBtnStyle('#06b6d4')}>⎘ Copy build</button>
                <button onClick={(e) => { e.stopPropagation(); onEditStart(); }} style={smallBtnStyle('#666')}>✎ Edit</button>
                <button onClick={(e) => { e.stopPropagation(); onStar(); }} style={smallBtnStyle(entry.starred ? '#fbbf24' : '#666')}>
                  {entry.starred ? '⭐ Unstar' : '☆ Star'}
                </button>
                <button onClick={(e) => { e.stopPropagation(); onDelete(); }} style={smallBtnStyle(confirmDelete ? '#ef4444' : '#666')}>
                  {confirmDelete ? 'Confirm?' : '🗑 Delete'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ReadView({ entry }) {
  return (
    <>
      <SectionHeader>Pitch</SectionHeader>
      <p style={paragraphStyle}>{entry.pitch}</p>

      <SectionHeader>Spec</SectionHeader>
      <ul style={specListStyle}>
        {ELEMENT_FIELDS.map((f) => (
          <li key={f} style={{ marginBottom: 3 }}>
            <span style={{ color: '#fbbf24', textTransform: 'capitalize' }}>{f}:</span>{' '}
            <span>{entry.spec?.[f] || 'TBD'}</span>
          </li>
        ))}
      </ul>

      <SectionHeader>Build prompt</SectionHeader>
      <textarea
        readOnly
        value={entry.buildPrompt || ''}
        rows={8}
        style={{ ...textareaStyle, fontFamily: 'monospace', fontSize: 10, background: '#0a0a0f', marginBottom: 0 }}
      />
    </>
  );
}

function EditView({ buffer, onField }) {
  return (
    <>
      <SectionHeader>Pitch</SectionHeader>
      <textarea
        className="nodrag"
        value={buffer.pitch}
        onChange={(e) => { e.stopPropagation(); onField('pitch', e.target.value); }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        rows={3}
        style={textareaStyle}
      />

      <SectionHeader>Spec</SectionHeader>
      {ELEMENT_FIELDS.map((f) => (
        <div key={f} style={{ marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: '#fbbf24', textTransform: 'capitalize' }}>{f}</span>
          <textarea
            className="nodrag"
            value={buffer.spec[f] || ''}
            onChange={(e) => { e.stopPropagation(); onField(f, e.target.value); }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            rows={2}
            style={{ ...textareaStyle, marginBottom: 0 }}
          />
        </div>
      ))}

      <SectionHeader>Build prompt</SectionHeader>
      <textarea
        className="nodrag"
        value={buffer.buildPrompt || ''}
        onChange={(e) => { e.stopPropagation(); onField('buildPrompt', e.target.value); }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        rows={8}
        style={{ ...textareaStyle, fontFamily: 'monospace', fontSize: 10 }}
      />
    </>
  );
}

function SectionHeader({ children }) {
  return (
    <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '6px 0 3px' }}>
      {children}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────

const pinLabelStyle = {
  color: '#888',
  fontSize: 10,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};

const pinSelectStyle = {
  background: 'var(--bg, #0a0a0f)',
  color: '#e8e8e8',
  border: `1px solid ${NODE_ACCENT}`,
  borderRadius: 4,
  padding: '4px 6px',
  fontSize: 11,
  cursor: 'pointer',
};

const segmentedBtnStyle = (active) => ({
  flex: 1,
  background: active ? `linear-gradient(180deg, ${NODE_ACCENT}dd, ${NODE_ACCENT}aa)` : 'transparent',
  color: active ? '#1a1a24' : '#e8e8e8',
  border: `1px solid ${NODE_ACCENT}`,
  padding: '4px 8px',
  fontSize: 11,
  fontWeight: active ? 600 : 400,
  cursor: 'pointer',
});

const textareaStyle = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'var(--bg, #0a0a0f)',
  color: '#e8e8e8',
  border: `1px solid ${NODE_ACCENT}`,
  borderRadius: 4,
  padding: 6,
  fontSize: 11,
  resize: 'vertical',
  marginBottom: 6,
  fontFamily: 'inherit',
};

const generateBtnStyle = {
  flex: 1,
  background: `linear-gradient(180deg, ${NODE_ACCENT}dd, ${NODE_ACCENT}aa)`,
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  padding: '8px 12px',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
};

const modelSelectStyle = {
  background: 'var(--bg, #0a0a0f)',
  color: '#e8e8e8',
  border: `1px solid ${NODE_ACCENT}`,
  borderRadius: 4,
  padding: '6px 8px',
  fontSize: 11,
  cursor: 'pointer',
};

const deleteBtnStyle = {
  width: 20,
  height: 20,
  borderRadius: '50%',
  background: 'rgba(231, 76, 60, 0.15)',
  border: '1px solid rgba(231, 76, 60, 0.4)',
  color: '#e74c3c',
  fontSize: 13,
  fontWeight: 'bold',
  cursor: 'pointer',
  padding: 0,
  lineHeight: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const linkBtnStyle = {
  background: 'none',
  border: 'none',
  color: '#888',
  fontSize: 10,
  cursor: 'pointer',
  padding: '2px 4px',
};

const emptyStateStyle = {
  padding: 16,
  textAlign: 'center',
  color: '#666',
  fontSize: 11,
  border: '1px dashed rgba(251,191,36,0.25)',
  borderRadius: 4,
};

const cardHeaderBtnStyle = {
  width: '100%',
  background: 'none',
  border: 'none',
  color: '#e8e8e8',
  fontSize: 11,
  padding: '6px 8px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  textAlign: 'left',
};

const paragraphStyle = {
  margin: '0 0 6px',
  fontSize: 11,
  lineHeight: 1.4,
  color: '#e8e8e8',
};

const specListStyle = {
  margin: '0 0 6px',
  paddingLeft: 14,
  fontSize: 11,
  lineHeight: 1.5,
  color: '#e8e8e8',
};

function smallBtnStyle(accent) {
  return {
    background: `${accent}33`,
    color: accent,
    border: `1px solid ${accent}66`,
    borderRadius: 3,
    padding: '4px 8px',
    fontSize: 10,
    cursor: 'pointer',
    fontWeight: 500,
  };
}
