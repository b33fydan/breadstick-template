import ToggleCard from './ToggleCard';
import { scriptTypes, conversionLevels } from '../data/scriptTypes';

export default function IngredientSelectors({ character, selections, onSelect }) {
  const accent = character.accentColor;
  const isShowcase = character.isUGC || character.monetization?.isShowcase;

  return (
    <div className="ingredient-selectors">
      {/* PAIN POINTS */}
      <section className="ingredient-section">
        <div className="ingredient-header">
          <h3>Pain Point</h3>
          <span className="ingredient-hint">The emotional trigger driving the script</span>
        </div>
        <div className="ingredient-grid">
          {character.painPoints.map((pp, i) => (
            <ToggleCard
              key={i}
              label={`Pain Point ${i + 1}`}
              description={pp}
              isSelected={selections.painPoint === i}
              onClick={() => onSelect('painPoint', i)}
              accent={accent}
            />
          ))}
        </div>
      </section>

      {/* HOOKS */}
      <section className="ingredient-section">
        <div className="ingredient-header">
          <h3>Hook</h3>
          <span className="ingredient-hint">The first 3 seconds — stops the scroll</span>
        </div>
        <div className="ingredient-grid">
          {character.hooks.map((hook, i) => (
            <ToggleCard
              key={i}
              label={`Hook ${i + 1}`}
              description={hook}
              isSelected={selections.hook === i}
              onClick={() => onSelect('hook', i)}
              accent={accent}
            />
          ))}
        </div>
      </section>

      {/* SCRIPT TYPE */}
      <section className="ingredient-section">
        <div className="ingredient-header">
          <h3>Script Type</h3>
          <span className="ingredient-hint">Structure and pacing of the script</span>
        </div>
        <div className="ingredient-grid">
          {scriptTypes.map((st) => (
            <ToggleCard
              key={st.id}
              label={`${st.name} (${st.duration})`}
              description={st.description}
              isSelected={selections.scriptType === st.id}
              onClick={() => onSelect('scriptType', st.id)}
              accent={accent}
            />
          ))}
        </div>
      </section>

      {/* CONVERSION LEVEL */}
      <section className="ingredient-section">
        <div className="ingredient-header">
          <h3>Conversion Level</h3>
          <span className="ingredient-hint">How hard the CTA pushes</span>
        </div>
        <div className="ingredient-grid">
          {conversionLevels.map((cl) => (
            <ToggleCard
              key={cl.id}
              label={`${cl.name} — ${cl.ratio}`}
              description={cl.description}
              isSelected={selections.conversionLevel === cl.id}
              onClick={() => onSelect('conversionLevel', cl.id)}
              accent={accent}
            />
          ))}
        </div>
      </section>

      {/* MONETIZATION / MANYCHAT */}
      <section className="ingredient-section">
        <div className="ingredient-header">
          <h3>{isShowcase ? 'UGC Showcase' : 'Monetization Path'}</h3>
          <span className="ingredient-hint">{isShowcase ? 'Product categories and CTA style for ad creatives' : 'Product, trigger word, and CTA mechanism'}</span>
        </div>

        <div className="monetization-info">
          <div className="monetization-product">
            <span className="monetization-label">{isShowcase ? 'Showcase Type' : 'Product'}</span>
            <span className="monetization-value">{character.monetization.product}</span>
          </div>
          {isShowcase && character.monetization.productCategories ? (
            <div className="monetization-product">
              <span className="monetization-label">Product Categories</span>
              <div className="category-tags">
                {character.monetization.productCategories.map((cat) => (
                  <span key={cat} className="category-tag" style={{ '--card-accent': accent }}>{cat}</span>
                ))}
              </div>
            </div>
          ) : (
            <div className="monetization-product">
              <span className="monetization-label">Price</span>
              <span className="monetization-value">{character.monetization.price}</span>
            </div>
          )}
        </div>

        {!isShowcase && character.monetization.triggers.length > 0 && (
          <div className="trigger-section">
            <span className="monetization-label">ManyChat Trigger Word</span>
            <div className="trigger-grid">
              {character.monetization.triggers.map((trigger) => (
                <button
                  key={trigger}
                  className={`trigger-btn ${selections.trigger === trigger ? 'selected' : ''}`}
                  onClick={() => onSelect('trigger', trigger)}
                  style={{ '--card-accent': accent }}
                >
                  {trigger}
                </button>
              ))}
            </div>
          </div>
        )}

        {!isShowcase && (
          <div className="cta-mechanism-section">
            <span className="monetization-label">CTA Mechanism</span>
            <div className="trigger-grid">
              {['Link in Bio', 'DM Trigger', 'Comment Trigger'].map((mech) => (
                <button
                  key={mech}
                  className={`trigger-btn ${selections.ctaMechanism === mech ? 'selected' : ''}`}
                  onClick={() => onSelect('ctaMechanism', mech)}
                  style={{ '--card-accent': accent }}
                >
                  {mech}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="cta-style-preview">
          <span className="monetization-label">CTA Style</span>
          <p className="cta-style-text">{character.ctaStyle}</p>
        </div>
      </section>
    </div>
  );
}
