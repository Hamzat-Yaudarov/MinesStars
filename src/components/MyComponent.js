import React from 'react';
import CONFIG from '../config';

export default function MyComponent() {
  const { conversion, resources, pickaxeLevels, withdrawal } = CONFIG;

  return (
    <div className="miniapp-config-preview">
      <h2 className="preview-title">Mines Stars — Config Preview</h2>
      <section className="conversion">
        <p className="conversion-text">200 Mines Coin = 1 STARS</p>
      </section>

      <section className="resources">
        <h3 className="section-title">Resources (price / base chance)</h3>
        <ul className="resource-list">
          {Object.entries(resources).map(([key, val]) => (
            <li key={key} className={`resource-item resource-${key}`}>
              <strong>{key}</strong>: {val.price} coins — {(val.baseChance * 100).toFixed(2)}% — range {val.baseRange[0]}–{val.baseRange[1]}
            </li>
          ))}
        </ul>
      </section>

      <section className="pickaxe-levels">
        <h3 className="section-title">Pickaxe levels</h3>
        <div className="levels-grid">
          {pickaxeLevels.map((lvl) => (
            <div key={lvl.level} className="level-card">
              <div className="level-header">Level {lvl.level}</div>
              <div className="level-cost">Cost: {lvl.cost.toLocaleString()} coins</div>
              <div className="level-ranges">
                <small>Coal: {lvl.ranges.coal[0]}–{lvl.ranges.coal[1]}</small>
                <small>Copper: {lvl.ranges.copper[0]}–{lvl.ranges.copper[1]}</small>
                <small>Iron: {lvl.ranges.iron[0]}–{lvl.ranges.iron[1]}</small>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="withdrawal">
        <h3 className="section-title">Withdrawals</h3>
        <p className="withdrawal-text">Fee: {withdrawal.feePercent}% — allowed amounts (stars): {withdrawal.allowedAmountsStars.join(', ')}</p>
      </section>

      <style jsx>{`
        .miniapp-config-preview { padding: 16px; font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial; }
        .preview-title { margin: 0 0 12px 0; }
        .section-title { margin: 12px 0 8px 0; }
        .resource-list { list-style: none; padding: 0; margin: 0; }
        .resource-item { padding: 6px 0; }
        .levels-grid { display:flex; gap:10px; flex-wrap:wrap; }
        .level-card { border:1px solid #e6e6e6; padding:10px; border-radius:8px; width:200px; }
        .level-header { font-weight:600; }
        .level-cost { color:#333; margin-top:6px; }
        .level-ranges small { display:block; color:#666; }
      `}</style>
    </div>
  );
}
