import { useState } from 'react';

const ACCENT_COLORS = [
  '#4A90D9', '#E85D3A', '#7BAE7F', '#D4A853',
  '#9B59B6', '#E74C8B', '#1ABC9C', '#E67E22',
];

const emptyForm = {
  name: '',
  handle: '',
  cameoName: '',
  niche: '',
  tagline: '',
  demographic: '',
  platformStrategy: '',
  accentColor: '#9B59B6',
  avatar: '',
  voice: '',
  painPoints: ['', '', '', '', ''],
  hooks: ['', '', '', '', ''],
  monetization: { product: '', price: '$9', triggers: ['', '', '', ''] },
  ctaStyle: '',
};

export default function AddCharacterForm({ onAdd, onCancel }) {
  const [form, setForm] = useState(emptyForm);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const setPainPoint = (i, value) => {
    const updated = [...form.painPoints];
    updated[i] = value;
    set('painPoints', updated);
  };

  const setHook = (i, value) => {
    const updated = [...form.hooks];
    updated[i] = value;
    set('hooks', updated);
  };

  const setTrigger = (i, value) => {
    const triggers = [...form.monetization.triggers];
    triggers[i] = value.toUpperCase();
    set('monetization', { ...form.monetization, triggers });
  };

  const addPainPoint = () => set('painPoints', [...form.painPoints, '']);
  const addHook = () => set('hooks', [...form.hooks, '']);

  const canSubmit =
    form.name.trim() &&
    form.niche.trim() &&
    form.painPoints.filter((p) => p.trim()).length >= 5 &&
    form.hooks.filter((h) => h.trim()).length >= 5;

  const handleSubmit = (e) => {
    e.preventDefault();
    onAdd({
      ...form,
      painPoints: form.painPoints.filter((p) => p.trim()),
      hooks: form.hooks.filter((h) => h.trim()),
      monetization: {
        ...form.monetization,
        triggers: form.monetization.triggers.filter((t) => t.trim()),
      },
    });
  };

  return (
    <form className="add-character-form" onSubmit={handleSubmit}>
      <h3>New Character</h3>

      <div className="form-grid">
        <label>
          Name *
          <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Mia Chen" />
        </label>
        <label>
          Handle
          <input value={form.handle} onChange={(e) => set('handle', e.target.value)} placeholder="@handle" />
        </label>
        <label>
          Cameo Name (Sora 2 — deprecated)
          <input value={form.cameoName} onChange={(e) => set('cameoName', e.target.value)} placeholder="@cameoname (Sora 2 only — deprecated)" />
        </label>
        <label>
          Niche *
          <input value={form.niche} onChange={(e) => set('niche', e.target.value)} placeholder="Money Intelligence" />
        </label>
        <label>
          Tagline
          <input value={form.tagline} onChange={(e) => set('tagline', e.target.value)} placeholder="One-line description" />
        </label>
        <label>
          Demographic
          <input value={form.demographic} onChange={(e) => set('demographic', e.target.value)} placeholder="Men 35-55" />
        </label>
        <label>
          Platform Strategy
          <input value={form.platformStrategy} onChange={(e) => set('platformStrategy', e.target.value)} placeholder="TikTok test → Facebook scale" />
        </label>
      </div>

      <label>
        Accent Color
        <div className="color-picker">
          {ACCENT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`color-swatch ${form.accentColor === c ? 'selected' : ''}`}
              style={{ background: c }}
              onClick={() => set('accentColor', c)}
            />
          ))}
        </div>
      </label>

      <label>
        Avatar Description
        <textarea value={form.avatar} onChange={(e) => set('avatar', e.target.value)} rows={3} placeholder="Full visual description for image generation..." />
      </label>

      <label>
        Voice Description
        <textarea value={form.voice} onChange={(e) => set('voice', e.target.value)} rows={3} placeholder="How they speak, phrases they use, what they NEVER do..." />
      </label>

      <div className="form-section">
        <h4>Pain Points (min 5) *</h4>
        {form.painPoints.map((p, i) => (
          <input key={i} value={p} onChange={(e) => setPainPoint(i, e.target.value)} placeholder={`Pain point ${i + 1}`} />
        ))}
        <button type="button" className="btn-add-row" onClick={addPainPoint}>+ Add Pain Point</button>
      </div>

      <div className="form-section">
        <h4>Hooks (min 5) *</h4>
        {form.hooks.map((h, i) => (
          <input key={i} value={h} onChange={(e) => setHook(i, e.target.value)} placeholder={`Hook ${i + 1}`} />
        ))}
        <button type="button" className="btn-add-row" onClick={addHook}>+ Add Hook</button>
      </div>

      <div className="form-section">
        <h4>Monetization</h4>
        <div className="form-grid">
          <label>
            Product Name
            <input value={form.monetization.product} onChange={(e) => set('monetization', { ...form.monetization, product: e.target.value })} />
          </label>
          <label>
            Price
            <input value={form.monetization.price} onChange={(e) => set('monetization', { ...form.monetization, price: e.target.value })} />
          </label>
        </div>
        <h4>ManyChat Triggers</h4>
        <div className="form-grid triggers">
          {form.monetization.triggers.map((t, i) => (
            <input key={i} value={t} onChange={(e) => setTrigger(i, e.target.value)} placeholder={`Trigger ${i + 1}`} />
          ))}
        </div>
      </div>

      <label>
        CTA Style
        <input value={form.ctaStyle} onChange={(e) => set('ctaStyle', e.target.value)} placeholder='Buddy energy. "Link in bio, brother."' />
      </label>

      <div className="form-actions">
        <button type="button" className="btn-cancel" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-submit" disabled={!canSubmit}>Add Character</button>
      </div>
    </form>
  );
}
