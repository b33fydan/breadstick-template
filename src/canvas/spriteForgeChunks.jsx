import React, { useContext, useEffect, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { CanvasCtx } from './CanvasView.jsx';
import {
  SF_DEFAULT_PARTY,
  SF_DEFAULT_STATS,
  SF_DEFAULT_SIDEBAR,
  SF_DEFAULT_ACTIONS,
  SF_DEFAULT_BANDS,
} from '../data/spriteForge';

// Shared visual shell for every Sprite Forge chunk node.
// Renders the SF accent dot, title, "SF" badge, body, and a right-side
// output handle. Children = the form fields.
function ChunkShell({ title, badge = 'SF', children }) {
  return (
    <div className="cv-node cv-sf-chunk" style={{ '--status-color': '#a0392e', '--node-accent': '#a0392e' }}>
      <div className="cv-sf-chunk-header">
        <span className="cv-sf-dot" />
        <span className="cv-sf-chunk-title">{title}</span>
        <span className="cv-sf-chunk-badge">{badge}</span>
      </div>
      <div className="cv-sf-chunk-body">{children}</div>
      <Handle type="source" position={Position.Right} id="chunk-out" />
    </div>
  );
}

// ---- SFPaletteNode --------------------------------------------------------
export function SFPaletteNode({ id }) {
  const { setChunkOutput } = useContext(CanvasCtx);
  const [palette, setPalette] = useState('');

  useEffect(() => {
    setChunkOutput(id, { __chunkType: 'sf-palette', palette });
  }, [id, palette, setChunkOutput]);

  return (
    <ChunkShell title="PALETTE">
      <label className="cv-sf-label">Palette (free text — colors, mood, references)</label>
      <textarea
        className="cv-sf-textarea"
        rows={4}
        placeholder="muted navy + gold leaf · stained glass jewel tones · 16-bit autumn…"
        value={palette}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => { e.stopPropagation(); setPalette(e.target.value); }}
      />
    </ChunkShell>
  );
}

// ---- SFHeroIdentityNode ---------------------------------------------------
export function SFHeroIdentityNode({ id }) {
  const { setChunkOutput } = useContext(CanvasCtx);
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [heroDesc, setHeroDesc] = useState('');
  const [emblem, setEmblem] = useState('');

  useEffect(() => {
    setChunkOutput(id, { __chunkType: 'sf-hero-identity', title, subtitle, heroDesc, emblem });
  }, [id, title, subtitle, heroDesc, emblem, setChunkOutput]);

  return (
    <ChunkShell title="HERO IDENTITY">
      <label className="cv-sf-label">Title (large pixel-block)</label>
      <input className="cv-sf-input" placeholder="BRAVE BEYOND FATE · AGENT-VILLE…"
        value={title} onClick={(e) => e.stopPropagation()}
        onChange={(e) => { e.stopPropagation(); setTitle(e.target.value); }} />

      <label className="cv-sf-label">Subtitle</label>
      <input className="cv-sf-input" placeholder="A FANTASY ACTION RPG · BI-WEEKLY REVIEW…"
        value={subtitle} onClick={(e) => e.stopPropagation()}
        onChange={(e) => { e.stopPropagation(); setSubtitle(e.target.value); }} />

      <label className="cv-sf-label">Hero description (large textarea)</label>
      <textarea className="cv-sf-textarea" rows={4}
        placeholder="blonde knight in navy plate, blue cape, oversized greatsword tip-down, ornate shield…"
        value={heroDesc} onClick={(e) => e.stopPropagation()}
        onChange={(e) => { e.stopPropagation(); setHeroDesc(e.target.value); }} />

      <label className="cv-sf-label">Top-left emblem</label>
      <input className="cv-sf-input" placeholder="red kite-shield with crossed swords · wheat sheaf chip…"
        value={emblem} onClick={(e) => e.stopPropagation()}
        onChange={(e) => { e.stopPropagation(); setEmblem(e.target.value); }} />
    </ChunkShell>
  );
}

// ---- SFTaglinesNode -------------------------------------------------------
export function SFTaglinesNode({ id }) {
  const { setChunkOutput } = useContext(CanvasCtx);
  const [taglineRed, setTaglineRed] = useState('');
  const [taglineNavy, setTaglineNavy] = useState('');
  const [corner, setCorner] = useState('COMING SOON');

  useEffect(() => {
    setChunkOutput(id, { __chunkType: 'sf-taglines', taglineRed, taglineNavy, corner });
  }, [id, taglineRed, taglineNavy, corner, setChunkOutput]);

  return (
    <ChunkShell title="TAGLINES">
      <label className="cv-sf-label">Tagline (red)</label>
      <textarea className="cv-sf-textarea" rows={2}
        placeholder="THE WORLD REMEMBERS THOSE WHO DARE."
        value={taglineRed} onClick={(e) => e.stopPropagation()}
        onChange={(e) => { e.stopPropagation(); setTaglineRed(e.target.value); }} />

      <label className="cv-sf-label">Tagline (navy)</label>
      <textarea className="cv-sf-textarea" rows={2}
        placeholder="CHOOSE YOUR PATH. SHAPE YOUR LEGEND. DETERMINE YOUR FATE."
        value={taglineNavy} onClick={(e) => e.stopPropagation()}
        onChange={(e) => { e.stopPropagation(); setTaglineNavy(e.target.value); }} />

      <label className="cv-sf-label">Corner badge</label>
      <input className="cv-sf-input" placeholder="COMING SOON · NEW · LIMITED"
        value={corner} onClick={(e) => e.stopPropagation()}
        onChange={(e) => { e.stopPropagation(); setCorner(e.target.value); }} />
    </ChunkShell>
  );
}

// ---- SFWorldIdentityNode --------------------------------------------------
export function SFWorldIdentityNode({ id }) {
  const { setChunkOutput } = useContext(CanvasCtx);
  const [theme, setTheme] = useState('');
  const [tone, setTone] = useState('');
  const [centerpiece, setCenterpiece] = useState('');
  const [appTitle, setAppTitle] = useState('');

  useEffect(() => {
    setChunkOutput(id, { __chunkType: 'sf-world-identity', theme, tone, centerpiece, appTitle });
  }, [id, theme, tone, centerpiece, appTitle, setChunkOutput]);

  return (
    <ChunkShell title="WORLD IDENTITY">
      <label className="cv-sf-label">Theme</label>
      <textarea className="cv-sf-textarea" rows={2}
        placeholder="FarmVille homestead · cyberpunk plaza · undersea colony…"
        value={theme} onClick={(e) => e.stopPropagation()}
        onChange={(e) => { e.stopPropagation(); setTheme(e.target.value); }} />

      <label className="cv-sf-label">Tone</label>
      <input className="cv-sf-input" placeholder="cozy · heroic · dark · playful…"
        value={tone} onClick={(e) => e.stopPropagation()}
        onChange={(e) => { e.stopPropagation(); setTone(e.target.value); }} />

      <label className="cv-sf-label">Centerpiece</label>
      <input className="cv-sf-input" placeholder="big red barn cluster · central shrine · shipwreck reef…"
        value={centerpiece} onClick={(e) => e.stopPropagation()}
        onChange={(e) => { e.stopPropagation(); setCenterpiece(e.target.value); }} />

      <label className="cv-sf-label">App title (top-left card)</label>
      <input className="cv-sf-input" placeholder="Farmstead Voxels · Reef Builder · Skyline Voxels…"
        value={appTitle} onClick={(e) => e.stopPropagation()}
        onChange={(e) => { e.stopPropagation(); setAppTitle(e.target.value); }} />
    </ChunkShell>
  );
}

// ---- SFStatsNode ----------------------------------------------------------
export function SFStatsNode({ id }) {
  const { setChunkOutput } = useContext(CanvasCtx);
  const [stats, setStats] = useState(SF_DEFAULT_STATS);

  useEffect(() => {
    setChunkOutput(id, { __chunkType: 'sf-stats', stats });
  }, [id, stats, setChunkOutput]);

  const updateRow = (i, patch) => {
    setStats(prev => prev.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  };

  return (
    <ChunkShell title="STATS">
      <label className="cv-sf-label">5 stat bars (label · color)</label>
      {stats.map((s, i) => (
        <div key={i} className="cv-sf-pair">
          <input className="cv-sf-input cv-sf-input-sm" placeholder="STR"
            value={s.label} onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); updateRow(i, { label: e.target.value }); }} />
          <input className="cv-sf-input cv-sf-input-sm" placeholder="red"
            value={s.color} onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); updateRow(i, { color: e.target.value }); }} />
        </div>
      ))}
    </ChunkShell>
  );
}

// ---- SFSidebarNode --------------------------------------------------------
export function SFSidebarNode({ id }) {
  const { setChunkOutput } = useContext(CanvasCtx);
  const [sidebar, setSidebar] = useState(SF_DEFAULT_SIDEBAR);

  useEffect(() => {
    setChunkOutput(id, { __chunkType: 'sf-sidebar', sidebar });
  }, [id, sidebar, setChunkOutput]);

  const updateRow = (i, patch) => {
    setSidebar(prev => prev.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  };

  return (
    <ChunkShell title="SIDEBAR">
      <label className="cv-sf-label">4 sidebar stats (label · icon)</label>
      {sidebar.map((s, i) => (
        <div key={i} className="cv-sf-pair">
          <input className="cv-sf-input cv-sf-input-sm" placeholder="HP"
            value={s.label} onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); updateRow(i, { label: e.target.value }); }} />
          <input className="cv-sf-input cv-sf-input-sm" placeholder="heart"
            value={s.icon} onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); updateRow(i, { icon: e.target.value }); }} />
        </div>
      ))}
    </ChunkShell>
  );
}

// ---- SFPartyNode ----------------------------------------------------------
export function SFPartyNode({ id }) {
  const { setChunkOutput } = useContext(CanvasCtx);
  const [party, setParty] = useState(SF_DEFAULT_PARTY);

  useEffect(() => {
    setChunkOutput(id, { __chunkType: 'sf-party', party });
  }, [id, party, setChunkOutput]);

  const updateRow = (i, value) => {
    setParty(prev => prev.map((row, idx) => idx === i ? value : row));
  };

  return (
    <ChunkShell title="PARTY">
      <label className="cv-sf-label">4 party members (descriptions)</label>
      {party.map((p, i) => (
        <textarea key={i} className="cv-sf-textarea" rows={2}
          placeholder={`party member ${i + 1} description`}
          value={p} onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); updateRow(i, e.target.value); }} />
      ))}
    </ChunkShell>
  );
}

// ---- SFActionsNode --------------------------------------------------------
export function SFActionsNode({ id }) {
  const { setChunkOutput } = useContext(CanvasCtx);
  const [actions, setActions] = useState(SF_DEFAULT_ACTIONS);

  useEffect(() => {
    setChunkOutput(id, { __chunkType: 'sf-actions', actions });
  }, [id, actions, setChunkOutput]);

  const updateRow = (i, patch) => {
    setActions(prev => prev.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  };

  return (
    <ChunkShell title="ACTIONS">
      <label className="cv-sf-label">4 action buttons (label · icon)</label>
      {actions.map((a, i) => (
        <div key={i} className="cv-sf-pair">
          <input className="cv-sf-input cv-sf-input-sm" placeholder="FIGHT"
            value={a.label} onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); updateRow(i, { label: e.target.value }); }} />
          <input className="cv-sf-input cv-sf-input-sm" placeholder="sword"
            value={a.icon} onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); updateRow(i, { icon: e.target.value }); }} />
        </div>
      ))}
    </ChunkShell>
  );
}

// ---- SFAssetBandsNode -----------------------------------------------------
export function SFAssetBandsNode({ id }) {
  const { setChunkOutput } = useContext(CanvasCtx);
  const [theme, setTheme] = useState('');
  const [bands, setBands] = useState(SF_DEFAULT_BANDS);

  useEffect(() => {
    setChunkOutput(id, { __chunkType: 'sf-asset-bands', theme, bands });
  }, [id, theme, bands, setChunkOutput]);

  const updateBand = (i, patch) => {
    setBands(prev => prev.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  };

  const addBand = () => setBands(prev => [...prev, { name: '', items: '' }]);
  const removeBand = (i) => setBands(prev => prev.filter((_, idx) => idx !== i));

  return (
    <ChunkShell title="ASSET BANDS">
      <label className="cv-sf-label">Theme (gallery overall direction)</label>
      <textarea className="cv-sf-textarea" rows={2}
        placeholder="medieval fantasy weapons · sci-fi consumables · seasonal cards…"
        value={theme} onClick={(e) => e.stopPropagation()}
        onChange={(e) => { e.stopPropagation(); setTheme(e.target.value); }} />

      <label className="cv-sf-label">Bands (one per row — each band = category name + items)</label>
      {bands.map((b, i) => (
        <div key={i} className="cv-sf-pair">
          <input className="cv-sf-input cv-sf-input-sm" placeholder="TERRAIN TILES"
            value={b.name} onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); updateBand(i, { name: e.target.value }); }} />
          <textarea className="cv-sf-textarea" rows={2}
            placeholder={`band ${i + 1} items`}
            value={b.items} onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); updateBand(i, { items: e.target.value }); }} />
          <button className="cv-sf-band-remove" onClick={(e) => { e.stopPropagation(); removeBand(i); }}>×</button>
        </div>
      ))}
      <button className="cv-sf-band-add" onClick={(e) => { e.stopPropagation(); addBand(); }}>+ Add band</button>
    </ChunkShell>
  );
}

// ---- Export map (registered into nodeTypes in CanvasView) -----------------
// eslint-disable-next-line react-refresh/only-export-components
export const SF_CHUNK_TYPES = {
  'sf-palette':        SFPaletteNode,
  'sf-hero-identity':  SFHeroIdentityNode,
  'sf-taglines':       SFTaglinesNode,
  'sf-world-identity': SFWorldIdentityNode,
  'sf-stats':          SFStatsNode,
  'sf-sidebar':        SFSidebarNode,
  'sf-party':          SFPartyNode,
  'sf-actions':        SFActionsNode,
  'sf-asset-bands':    SFAssetBandsNode,
};
