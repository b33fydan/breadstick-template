import { useState } from 'react';
import { NEON_VEIL_PROJECT } from './studioFixture';
import { OVERLAY_CATALOG } from './overlayCatalog';
import {
  selectShot, addComment, getSelectedShot,
  setVideo, setOverlayEffect, setOverlayParam,
  startRender, renderSucceeded, renderFailed, setViewing,
} from './studioState';
import { API_BASE, validateOverlay, buildOverlayBody, probeVideo, renderOverlay } from './studioRender';

const C = {
  bg: '#0a0a0f', panel: '#0e0e16', deep: '#101019', surf: '#15151f',
  border: '#23232e', text: '#e8e8e8', sub: '#c9c9d2', muted: '#8a8a96',
  dim: '#5f5f6a', gold: '#C9A227', amber: '#E0A93B',
  goldBg: '#16140d', goldThumb: '#1c1810', goldDim: '#a98c2e', amberBorder: '#4a3c1a',
  err: '#E0564A',
};
const fieldStyle = { width: '100%', boxSizing: 'border-box', fontSize: 12, color: C.text, background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 7px', marginTop: 3 };
const labelStyle = { fontSize: 11, color: C.muted, marginTop: 8, display: 'block' };

function Field({ label, children }) {
  return (<label style={labelStyle}>{label}{children}</label>);
}
function Text({ value, onChange, placeholder }) {
  return <input style={fieldStyle} value={value || ''} placeholder={placeholder || ''} onChange={(e) => onChange(e.target.value)} />;
}
function Select({ value, onChange, options }) {
  return (
    <select style={fieldStyle} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

// Per-effect param form, bound to overlays[0].params via onParam(key, value).
function EffectParamForm({ effect, params, onParam }) {
  switch (effect) {
    case 'title-card':
      return (<>
        <Field label="Title"><Text value={params.title} onChange={(v) => onParam('title', v)} placeholder="Main title" /></Field>
        <Field label="Subtitle"><Text value={params.subtitle} onChange={(v) => onParam('subtitle', v)} placeholder="Optional" /></Field>
      </>);
    case 'lower-third':
      return (<>
        <Field label="Name"><Text value={params.lowerName} onChange={(v) => onParam('lowerName', v)} placeholder="Person name" /></Field>
        <Field label="Role"><Text value={params.role} onChange={(v) => onParam('role', v)} placeholder="Title / role" /></Field>
        <Field label="Side"><Select value={params.side || 'left'} onChange={(v) => onParam('side', v)} options={['left', 'right']} /></Field>
      </>);
    case 'highlight-sweep':
      return (<>
        <Field label="Caption"><Text value={params.caption} onChange={(v) => onParam('caption', v)} placeholder="Caption line" /></Field>
        <Field label="Target word"><Text value={params.targetWord} onChange={(v) => onParam('targetWord', v)} placeholder="Word to sweep" /></Field>
        <Field label="Direction"><Select value={params.direction || 'ltr'} onChange={(v) => onParam('direction', v)} options={['ltr', 'rtl']} /></Field>
        <Field label="Position"><Select value={params.position || 'bottom'} onChange={(v) => onParam('position', v)} options={['bottom', 'top', 'center']} /></Field>
      </>);
    case 'burst-lines':
      return (<>
        <Field label="Timestamp (s)"><Text value={params.timestamp} onChange={(v) => onParam('timestamp', v)} placeholder="0.5" /></Field>
        <Field label="Density"><Select value={params.density || 'medium'} onChange={(v) => onParam('density', v)} options={['low', 'medium', 'high']} /></Field>
      </>);
    case 'hook-caption':
    default:
      return (<>
        <Field label="Caption"><Text value={params.caption} onChange={(v) => onParam('caption', v)} placeholder="Hook caption" /></Field>
        <Field label="Position"><Select value={params.position || 'bottom'} onChange={(v) => onParam('position', v)} options={['bottom', 'top', 'center']} /></Field>
      </>);
  }
}

function BoardMetaHeader({ project, importPath, setImportPath, onImport, importing, importError }) {
  const { title, meta } = project;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 500 }}>{title}</div>
          <div style={{ fontSize: 12, color: C.muted }}>{meta.aspect} · {meta.resolution} · {meta.grade} grade</div>
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: C.sub, background: C.surf, border: `1px solid ${C.border}`, padding: '5px 9px', borderRadius: 6 }}>♪ {meta.soundtrack}</span>
        <span title="Crystalize into a reusable recipe (coming soon)" style={{ fontSize: 12, color: '#7a7a85', border: `1px dashed #3a3a46`, padding: '5px 10px', borderRadius: 6 }}>◇ Crystalize → recipe</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <input
          style={{ ...fieldStyle, marginTop: 0, flex: 1 }}
          value={importPath}
          placeholder="Paste a local video path, e.g. E:\renders\longform\take7.mp4"
          onChange={(e) => setImportPath(e.target.value)}
        />
        <button onClick={onImport} disabled={importing} style={{ fontSize: 12, color: C.bg, background: C.gold, padding: '7px 12px', borderRadius: 6, fontWeight: 500, border: 'none', cursor: importing ? 'default' : 'pointer', opacity: importing ? 0.6 : 1 }}>
          {importing ? 'Loading…' : '↑ Import video'}
        </button>
      </div>
      {importError && <div style={{ fontSize: 11, color: C.err, marginTop: 4 }}>{importError}</div>}
    </div>
  );
}

function VideoPlayer({ project, onSetViewing }) {
  const { video, render } = project;
  if (!video) {
    return (
      <div style={{ aspectRatio: '16 / 9', background: C.deep, border: `1px solid ${C.border}`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.dim, fontSize: 12 }}>
        Import a video to begin
      </div>
    );
  }
  const showComposited = render.viewing === 'composited' && render.resultUrl;
  const src = showComposited ? render.resultUrl : video.url;
  const canToggle = render.status === 'done' && render.resultUrl;
  return (
    <div>
      <video key={src} src={src} controls style={{ width: '100%', aspectRatio: '16 / 9', background: '#000', border: `1px solid ${C.border}`, borderRadius: 8, objectFit: 'contain' }} />
      {canToggle && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {['original', 'composited'].map((w) => (
              <button key={w} onClick={() => onSetViewing(w)} style={{ fontSize: 11, padding: '4px 9px', borderRadius: 6, border: `1px solid ${render.viewing === w ? C.gold : C.border}`, background: render.viewing === w ? C.goldBg : 'transparent', color: render.viewing === w ? C.gold : C.sub, cursor: 'pointer' }}>{w}</button>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          <span title={render.resultUrl} style={{ fontSize: 10, color: C.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}>{render.resultUrl.replace(API_BASE, '')}</span>
        </div>
      )}
    </div>
  );
}

function ShotCard({ shot, selected, onSelect }) {
  return (
    <button onClick={() => onSelect(shot.id)} style={{ flex: 1, minWidth: 0, textAlign: 'left', padding: 0, cursor: 'pointer', border: `1.5px solid ${selected ? C.gold : C.border}`, borderRadius: 6, overflow: 'hidden', background: selected ? C.goldBg : C.panel }}>
      <div style={{ aspectRatio: '1 / 1', background: selected ? C.goldThumb : C.surf, position: 'relative', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 4 }}>
        <span style={{ position: 'absolute', top: 3, left: 5, fontSize: 11, color: selected ? C.gold : C.muted, fontWeight: selected ? 500 : 400 }}>{shot.index}</span>
        {shot.comments.length > 0 && <span style={{ position: 'absolute', top: 3, right: 4, fontSize: 10, color: selected ? C.gold : '#7a7a85' }}>💬{shot.comments.length}</span>}
        {shot.overlays.length > 0 && <span style={{ fontSize: 13, color: selected ? C.goldDim : C.dim }}>▭</span>}
      </div>
      <div style={{ fontSize: 11, padding: '4px 5px', color: selected ? C.text : C.sub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shot.label}</div>
    </button>
  );
}

function ShotStrip({ project, onSelect }) {
  return (
    <div>
      <div style={{ margin: '11px 0 6px', fontSize: 11, color: C.muted }}>shots</div>
      <div style={{ display: 'flex', gap: 6 }}>
        {project.shots.map((shot) => <ShotCard key={shot.id} shot={shot} selected={shot.id === project.selectedShotId} onSelect={onSelect} />)}
        <span title="Add a shot (coming soon)" style={{ width: 34, border: `1.5px dashed #3a3a46`, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6a6a75', fontSize: 16 }}>+</span>
      </div>
    </div>
  );
}

function CommentComposer({ onAdd }) {
  const [kind, setKind] = useState(null);
  const [text, setText] = useState('');
  if (!kind) {
    return (
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => setKind('note')} style={{ flex: 1, textAlign: 'center', fontSize: 11, color: C.sub, border: `1px solid ${C.border}`, borderRadius: 6, padding: 6, background: 'transparent', cursor: 'pointer' }}>💬 note</button>
        <button onClick={() => setKind('change-request')} style={{ flex: 1, textAlign: 'center', fontSize: 11, color: C.amber, border: `1px solid ${C.amberBorder}`, borderRadius: 6, padding: 6, background: 'transparent', cursor: 'pointer' }}>⚡ change-request</button>
      </div>
    );
  }
  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onAdd({ kind, text: trimmed });
    setText(''); setKind(null);
  };
  return (
    <div>
      <div style={{ fontSize: 11, color: kind === 'change-request' ? C.amber : C.muted, marginBottom: 4 }}>{kind === 'change-request' ? '⚡ change-request' : '💬 note'}</div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} autoFocus rows={2} placeholder="Type your comment…" style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, color: C.text, background: C.surf, border: `1px solid ${C.border}`, borderRadius: 6, padding: 6, resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button onClick={submit} style={{ flex: 1, fontSize: 11, color: C.bg, background: C.gold, border: 'none', borderRadius: 6, padding: 6, fontWeight: 500, cursor: 'pointer' }}>Add</button>
        <button onClick={() => { setKind(null); setText(''); }} style={{ fontSize: 11, color: C.muted, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 10px', cursor: 'pointer' }}>Cancel</button>
      </div>
    </div>
  );
}

function ShotInspector({ shot, hasVideo, render, onSetEffect, onSetParam, onRender, onAddComment }) {
  if (!shot) {
    return <div style={{ flex: 1, minWidth: 0, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, color: C.muted, fontSize: 12 }}>Select a shot to edit.</div>;
  }
  const overlay = shot.overlays[0] || null;
  const params = overlay?.params || {};
  const validationError = overlay ? validateOverlay(overlay.type, params) : 'pick an overlay';
  const rendering = render.status === 'rendering';
  const canRender = hasVideo && overlay && !validationError && !rendering;
  const renderHint = !hasVideo ? 'import a video first' : !overlay ? 'pick an overlay' : validationError || (rendering ? 'rendering…' : null);

  return (
    <div style={{ flex: 1, minWidth: 0, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 15, fontWeight: 500, color: C.gold }}>Shot {shot.index}</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>{shot.cameraType}</div>

      <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>overlay</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {OVERLAY_CATALOG.map((c) => {
          const active = overlay?.type === c.type;
          return (
            <button key={c.type} onClick={() => onSetEffect(shot.id, c.type)} style={{ fontSize: 11, color: active ? C.gold : C.sub, background: active ? C.goldBg : C.surf, border: `1px solid ${active ? C.gold : C.border}`, padding: '4px 7px', borderRadius: 5, cursor: 'pointer' }}>{c.glyph} {c.label}</button>
          );
        })}
      </div>

      {overlay && (
        <div style={{ marginTop: 4 }}>
          <EffectParamForm effect={overlay.type} params={params} onParam={(k, v) => onSetParam(shot.id, k, v)} />
          <Field label="Accent"><Text value={params.accentColor} onChange={(v) => onSetParam(shot.id, 'accentColor', v)} placeholder="#C9A227" /></Field>
          <Field label="Quality"><Select value={params.quality || 'standard'} onChange={(v) => onSetParam(shot.id, 'quality', v)} options={['draft', 'standard', 'high']} /></Field>
          <button onClick={() => onRender(shot)} disabled={!canRender} style={{ width: '100%', marginTop: 10, fontSize: 12, color: C.bg, background: canRender ? C.gold : C.surf, border: 'none', borderRadius: 6, padding: 8, fontWeight: 500, cursor: canRender ? 'pointer' : 'default', opacity: canRender ? 1 : 0.7 }}>
            {rendering ? 'Rendering… (long videos take longer)' : 'Render overlay'}
          </button>
          {renderHint && !rendering && <div style={{ fontSize: 10, color: C.dim, marginTop: 4, textAlign: 'center' }}>{renderHint}</div>}
          {render.status === 'error' && <div style={{ fontSize: 11, color: C.err, marginTop: 6 }}>render failed: {render.error}</div>}
        </div>
      )}

      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, marginTop: 12 }}>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>comments</div>
        {shot.comments.length === 0 && <div style={{ fontSize: 12, color: C.dim, marginBottom: 10 }}>no comments yet</div>}
        {shot.comments.map((cm) => (
          <div key={cm.id} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: cm.kind === 'change-request' ? C.amber : C.muted, marginBottom: 2 }}>{cm.kind === 'change-request' ? '⚡ change-request' : '💬 note'} · {cm.author} · {cm.date}</div>
            <div style={{ fontSize: 12, color: '#dcdce2', lineHeight: 1.5 }}>{cm.text}</div>
          </div>
        ))}
        <div style={{ marginTop: 4 }}><CommentComposer onAdd={(c) => onAddComment(shot.id, c)} /></div>
      </div>
    </div>
  );
}

export default function StudioView() {
  const [project, setProject] = useState(NEON_VEIL_PROJECT);
  const [importPath, setImportPath] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);
  const selected = getSelectedShot(project);

  const handleSelect = (shotId) => setProject((p) => selectShot(p, shotId));
  const handleSetEffect = (shotId, type) => setProject((p) => setOverlayEffect(p, shotId, type));
  const handleSetParam = (shotId, key, value) => setProject((p) => setOverlayParam(p, shotId, key, value));
  const handleSetViewing = (which) => setProject((p) => setViewing(p, which));
  const handleAddComment = (shotId, { kind, text }) =>
    setProject((p) => addComment(p, shotId, {
      id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind, author: 'You', date: new Date().toISOString().slice(0, 10), text,
    }));

  const handleImport = async () => {
    const path = importPath.trim();
    if (!path) return;
    setImporting(true); setImportError(null);
    try {
      const meta = await probeVideo(path);
      if (meta.isImage) throw new Error('That file is an image, not a video');
      setProject((p) => setVideo(p, {
        path,
        url: `${API_BASE}/api/local-video?path=${encodeURIComponent(path)}`,
        width: meta.width, height: meta.height, durationSec: meta.durationSec,
      }));
    } catch (e) {
      setImportError(e.message);
    } finally {
      setImporting(false);
    }
  };

  const handleRender = async (shot) => {
    const overlay = shot.overlays[0];
    if (!overlay || !project.video) return;
    if (validateOverlay(overlay.type, overlay.params)) return;
    setProject((p) => startRender(p));
    const opId = `studio_${shot.id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`.replace(/[^A-Za-z0-9_]/g, '_');
    try {
      const url = await renderOverlay(buildOverlayBody({
        effect: overlay.type, params: overlay.params, videoPath: project.video.path,
        accentColor: overlay.params.accentColor || '#C9A227', quality: overlay.params.quality || 'standard', name: opId,
      }));
      setProject((p) => renderSucceeded(p, url));
    } catch (e) {
      setProject((p) => renderFailed(p, e.message));
    }
  };

  return (
    <div style={{ background: C.bg, color: C.text, padding: 16, minHeight: '100%', fontFamily: 'var(--sans, system-ui, sans-serif)' }}>
      <BoardMetaHeader project={project} importPath={importPath} setImportPath={setImportPath} onImport={handleImport} importing={importing} importError={importError} />
      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
        <div style={{ flex: 1.5, minWidth: 0 }}>
          <VideoPlayer project={project} onSetViewing={handleSetViewing} />
          <ShotStrip project={project} onSelect={handleSelect} />
        </div>
        <ShotInspector
          shot={selected}
          hasVideo={!!project.video}
          render={project.render}
          onSetEffect={handleSetEffect}
          onSetParam={handleSetParam}
          onRender={handleRender}
          onAddComment={handleAddComment}
        />
      </div>
    </div>
  );
}
