import React from 'react';
import { POIS, POI_CATEGORIES } from '../data/pois.js';
import { CATEGORY_ICONS, CloseIcon } from './Icons.jsx';

/** 景点总览：可点击瞬移 */
export default function PoiList({ activeId, onSelect, onClose }) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="poi-list-modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div>
            <h2>园中十六景</h2>
            <span>SCENES OF BAOTU SPRING</span>
          </div>
          <button type="button" className="icon-btn small" onClick={onClose} aria-label="关闭">
            <CloseIcon />
          </button>
        </div>
        <p className="poi-list-hint">点击任一景点，即可瞬移前往（自由漫游）。</p>
        <div className="poi-list-grid">
          {POIS.map((poi, i) => {
            const Icon = CATEGORY_ICONS[poi.cat] || CATEGORY_ICONS.spring;
            return (
              <button
                key={poi.id}
                type="button"
                className={`poi-list-item ${activeId === poi.id ? 'is-active' : ''}`}
                onClick={() => onSelect(poi)}
              >
                <span className="poi-list-index">{String(i + 1).padStart(2, '0')}</span>
                <Icon className="poi-list-icon" />
                <span className="poi-list-text">
                  <span className="poi-list-name">{poi.name}</span>
                  <span className="poi-list-en">{POI_CATEGORIES[poi.cat]?.name || ''} · {poi.en}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
