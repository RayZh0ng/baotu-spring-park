import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createExperience } from './three/experience.js';
import { WEATHER_LIST, WEATHER_PRESETS } from './data/weather.js';
import { POIS, POI_MAP, TOUR_POIS, PARK_QUOTES } from './data/pois.js';
import Minimap from './ui/Minimap.jsx';
import Joystick from './ui/Joystick.jsx';
import PoiList from './ui/PoiList.jsx';
import {
  WEATHER_ICONS,
  CATEGORY_ICONS,
  WalkIcon,
  TourIcon,
  PlayIcon,
  PauseIcon,
  PrevIcon,
  NextIcon,
  CloseIcon,
  HelpIcon,
  CompassIcon,
} from './ui/Icons.jsx';

const params = new URLSearchParams(window.location.search);

export default function App() {
  const canvasRef = useRef(null);
  const expRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [weatherId, setWeatherId] = useState(() => {
    const w = params.get('weather');
    return WEATHER_PRESETS[w] ? w : 'sunny';
  });
  const [mode, setMode] = useState('walk');
  const [tourPaused, setTourPaused] = useState(false);
  const [tourPoi, setTourPoi] = useState(TOUR_POIS[0]);
  const [panelOpen, setPanelOpen] = useState(() => {
    if (params.get('panel') === '0') return false;
    return window.innerWidth >= 820;
  });
  const [helpOpen, setHelpOpen] = useState(false);
  const [poiListOpen, setPoiListOpen] = useState(false);
  const [nearby, setNearby] = useState(null);
  const [infoPoi, setInfoPoi] = useState(null);
  const [fade, setFade] = useState(false);
  const [weatherToast, setWeatherToast] = useState(null);
  const [mobile, setMobile] = useState(() => window.innerWidth < 820);
  const [quote] = useState(() => PARK_QUOTES[Math.floor(Math.random() * PARK_QUOTES.length)]);
  const [showHint, setShowHint] = useState(true);
  const weatherToastTimer = useRef(0);

  const noUI = params.get('ui') === '0';

  /* ---------- 启动 3D 体验 ---------- */
  useEffect(() => {
    const exp = createExperience({
      canvas: canvasRef.current,
      onEvent: (ev) => {
        if (ev.type === 'ready') {
          setReady(true);
          setWeatherId(ev.weather);
          setTimeout(() => setLoaded(true), 320);
        } else if (ev.type === 'weather') {
          setWeatherId(ev.id);
          const preset = WEATHER_PRESETS[ev.id];
          if (preset) {
            setWeatherToast(preset);
            window.clearTimeout(weatherToastTimer.current);
            weatherToastTimer.current = window.setTimeout(() => setWeatherToast(null), 2600);
          }
        } else if (ev.type === 'mode') {
          setMode(ev.mode);
          if (ev.mode === 'tour') setInfoPoi(null);
          setFade(true);
          setTimeout(() => setFade(false), 460);
        } else if (ev.type === 'poi') {
          setTourPoi(ev.poi);
        } else if (ev.type === 'nearby') {
          setNearby(ev.poi);
        } else if (ev.type === 'teleport') {
          setFade(true);
          setInfoPoi(null);
          setTimeout(() => setFade(false), 420);
        } else if (ev.type === 'tourPause') {
          setTourPaused(ev.paused);
        }
      },
    });
    expRef.current = exp;
    return () => {
      exp.dispose();
      expRef.current = null;
    };
  }, []);

  /* ---------- 视口变化 ---------- */
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 820);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /* ---------- 键盘快捷键 ---------- */
  useEffect(() => {
    if (noUI) return undefined;
    const onKey = (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      const exp = expRef.current;
      if (!exp) return;
      if (e.code === 'KeyF') {
        exp.setMode(mode === 'tour' ? 'walk' : 'tour');
      } else if (e.code === 'KeyM') {
        setPanelOpen((v) => !v);
      } else if (e.code === 'KeyH' || e.key === '?') {
        setHelpOpen((v) => !v);
      } else if (e.code === 'KeyL') {
        setPoiListOpen((v) => !v);
      } else if (e.code === 'Escape') {
        setHelpOpen(false);
        setPoiListOpen(false);
        setInfoPoi(null);
      } else if (e.code === 'Space') {
        if (mode === 'tour') {
          e.preventDefault();
          exp.toggleTourPaused();
        }
      } else if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
        const idx = WEATHER_LIST.findIndex((w) => w.id === weatherId);
        const next =
          e.code === 'BracketRight'
            ? WEATHER_LIST[(idx + 1) % WEATHER_LIST.length].id
            : WEATHER_LIST[(idx - 1 + WEATHER_LIST.length) % WEATHER_LIST.length].id;
        exp.setWeather(next);
      } else if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5)) - 1;
        if (n >= 0 && n < WEATHER_LIST.length) exp.setWeather(WEATHER_LIST[n].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, weatherId, noUI]);

  /* 首次提示自动隐藏 */
  useEffect(() => {
    if (!loaded) return undefined;
    const t = setTimeout(() => setShowHint(false), 10000);
    return () => clearTimeout(t);
  }, [loaded]);

  const currentWeather = WEATHER_PRESETS[weatherId] || WEATHER_PRESETS.sunny;
  const WeatherIcon = WEATHER_ICONS[currentWeather.icon] || WEATHER_ICONS.sun;
  const activePoi = mode === 'tour' ? tourPoi : infoPoi;
  const CatIcon = activePoi ? CATEGORY_ICONS[activePoi.cat] || CATEGORY_ICONS.spring : null;

  const setWeather = useCallback((id) => {
    expRef.current?.setWeather(id);
    setWeatherId(id);
  }, []);

  const toggleMode = useCallback(() => {
    expRef.current?.setMode(mode === 'tour' ? 'walk' : 'tour');
  }, [mode]);

  const openPoi = useCallback((poi) => {
    setInfoPoi(poi);
  }, []);

  const gotoPoi = useCallback((poi) => {
    const exp = expRef.current;
    if (!exp) return;
    exp.teleportToPoi(poi.id);
    setInfoPoi(poi);
    setPoiListOpen(false);
  }, []);

  /* 供 QA 脚本操作 UI */
  useEffect(() => {
    window.__ui = {
      setPanelOpen,
      setHelpOpen,
      setPoiListOpen,
      setInfoPoi,
      gotoPoi: (id) => {
        const poi = POI_MAP[id];
        if (poi) gotoPoi(poi);
      },
      getState: () => ({ weatherId, mode, panelOpen, loaded }),
    };
  }, [gotoPoi, mode, panelOpen, loaded, weatherId]);

  const tourIndex = useMemo(() => {
    const i = TOUR_POIS.findIndex((p) => p.id === tourPoi?.id);
    return i < 0 ? 0 : i;
  }, [tourPoi]);

  const showWeatherPanel = !noUI && panelOpen;

  return (
    <div className={`app ${mobile ? 'is-mobile' : ''} ${noUI ? 'is-bare' : ''}`}>
      <canvas ref={canvasRef} className="scene-canvas" aria-label="趵突泉 3D 园林" />

      {/* 加载 / 开场 */}
      {!noUI && (
        <div className={`loading-screen ${loaded ? 'is-hidden' : ''}`}>
          <div className="loading-bg" />
          <div className="loading-content">
            <div className="seal" aria-hidden="true">
              <span>泉</span>
            </div>
            <h1 className="loading-title">
              <span>趵</span>
              <span>突</span>
              <span>泉</span>
            </h1>
            <p className="loading-sub">BAOTU SPRING · 天下第一泉</p>
            <p className="loading-quote">
              「{quote.text}」<em>—— {quote.from}</em>
            </p>
            <div className="loading-progress">
              <div className="loading-progress-bar" />
            </div>
            <p className="loading-tip">{ready ? '入园…' : '正在生成这座数字园林…'}</p>
          </div>
          <div className="loading-foot">济南 · 泉城 · 数字园林</div>
        </div>
      )}

      {/* 顶部品牌 + 天气 */}
      {!noUI && (
        <header className={`hud-top ${loaded ? 'is-visible' : ''}`}>
          <div className="brand">
            <div className="brand-seal" aria-hidden="true">泉</div>
            <div className="brand-text">
              <span className="brand-cn">趵突泉</span>
              <span className="brand-en">BAOTU SPRING</span>
            </div>
            <span className="brand-divider" />
            <span className="brand-sub">天下第一泉 · 济南 · 数字园林</span>
          </div>

          <div className="hud-right">
            <button
              type="button"
              className={`chip weather-chip ${panelOpen ? 'is-active' : ''}`}
              onClick={() => setPanelOpen((v) => !v)}
              aria-expanded={panelOpen}
              title="天气系统"
            >
              <WeatherIcon className="chip-icon" />
              <span className="chip-label">{currentWeather.name}</span>
              <span className="chip-sub">{currentWeather.en}</span>
            </button>
            <button
              type="button"
              className={`icon-btn ${poiListOpen ? 'is-active' : ''}`}
              onClick={() => setPoiListOpen((v) => !v)}
              aria-label="景点列表"
              title="景点列表（L）"
            >
              <CompassIcon />
            </button>
            <button type="button" className="icon-btn" onClick={() => setHelpOpen(true)} aria-label="帮助" title="游园须知（H）">
              <HelpIcon />
            </button>
          </div>
        </header>
      )}

      {/* 天气面板 */}
      {!noUI && (
        <aside className={`weather-panel ${showWeatherPanel ? 'is-open' : ''}`} aria-hidden={!showWeatherPanel}>
          <div className="panel-head">
            <div>
              <h2>天气</h2>
              <span>WEATHER SYSTEM · 九象</span>
            </div>
            <button type="button" className="icon-btn small" onClick={() => setPanelOpen(false)} aria-label="收起天气面板">
              <CloseIcon />
            </button>
          </div>
          <div className="weather-grid">
            {WEATHER_LIST.map((w) => {
              const Icon = WEATHER_ICONS[w.icon] || WEATHER_ICONS.sun;
              return (
                <button
                  key={w.id}
                  type="button"
                  className={`weather-card ${weatherId === w.id ? 'is-active' : ''}`}
                  onClick={() => setWeather(w.id)}
                  style={{ '--accent': w.accent }}
                  title={w.tagline}
                >
                  <Icon className="weather-icon" />
                  <span className="weather-name">{w.name}</span>
                  <span className="weather-en">{w.en}</span>
                </button>
              );
            })}
          </div>
          <div className="weather-desc">
            <span className="weather-desc-tag">{currentWeather.tagline}</span>
            <p>{currentWeather.desc}</p>
          </div>
          <div className="panel-foot">
            <span>按 1 – 9 快速切换 · M 收起</span>
            <span className="panel-foot-sep">点击右上角天气可随时换景</span>
          </div>
        </aside>
      )}

      {/* 景点卡片 */}
      {!noUI && activePoi && (
        <section className={`poi-card ${mode === 'tour' ? 'is-tour' : ''}`}>
          <div className="poi-card-head">
            <span className="poi-cat">
              {CatIcon && <CatIcon />}
              <span>{activePoi.name}</span>
            </span>
            {mode !== 'tour' && (
              <button type="button" className="icon-btn small" onClick={() => setInfoPoi(null)} aria-label="关闭">
                <CloseIcon />
              </button>
            )}
          </div>
          <span className="poi-en">{activePoi.en}</span>
          <p className="poi-desc">{activePoi.desc}</p>
          {mode === 'tour' ? (
            <div className="poi-progress">
              <span>{String(tourIndex + 1).padStart(2, '0')}</span>
              <div className="poi-progress-line">
                <i style={{ width: `${((tourIndex + 1) / TOUR_POIS.length) * 100}%` }} />
              </div>
              <span>{String(TOUR_POIS.length).padStart(2, '0')}</span>
            </div>
          ) : (
            <div className="poi-actions">
              <span className="poi-coord">
                {activePoi.pos[0].toFixed(0)} E · {activePoi.pos[1].toFixed(0)} S
              </span>
              <button type="button" className="poi-action-btn" onClick={() => setPoiListOpen(true)}>
                园中十六景
              </button>
            </div>
          )}
        </section>
      )}

      {/* 小地图 */}
      {!noUI && (
        <div className={`minimap ${loaded ? 'is-visible' : ''}`}>
          <div className="minimap-head">
            <span>园图</span>
            <span className="minimap-head-en">PARK PLAN</span>
          </div>
          <div className="minimap-inner">
            <Minimap activePoiId={activePoi?.id} onSelect={gotoPoi} />
            <div className="minimap-north">N</div>
          </div>
          <div className="minimap-caption">
            <CompassIcon />
            <span>趵突泉公园</span>
            <button type="button" className="minimap-more" onClick={() => setPoiListOpen(true)}>
              十六景
            </button>
          </div>
        </div>
      )}

      {/* 底部控制 */}
      {!noUI && (
        <div className={`hud-bottom ${loaded ? 'is-visible' : ''}`}>
          {mode === 'walk' ? (
            <div className="mode-switch">
              <button type="button" className="mode-btn is-active">
                <WalkIcon />
                <span>自由漫游</span>
              </button>
              <button type="button" className="mode-btn" onClick={toggleMode}>
                <TourIcon />
                <span>自动导览</span>
                <em className="mode-hint">F</em>
              </button>
            </div>
          ) : (
            <div className="tour-bar">
              <button type="button" className="tour-btn" onClick={() => expRef.current?.prevPoi()} aria-label="上一站">
                <PrevIcon />
              </button>
              <button
                type="button"
                className="tour-btn primary"
                onClick={() => expRef.current?.toggleTourPaused()}
                aria-label={tourPaused ? '继续' : '暂停'}
              >
                {tourPaused ? <PlayIcon /> : <PauseIcon />}
              </button>
              <button type="button" className="tour-btn" onClick={() => expRef.current?.nextPoi()} aria-label="下一站">
                <NextIcon />
              </button>
              <div className="tour-meta">
                <span className="tour-title">AUTO TOUR · {tourPaused ? 'PAUSED' : 'PLAYING'}</span>
                <span className="tour-status">
                  第 {tourIndex + 1} / {TOUR_POIS.length} 站 · {tourPoi?.name}
                </span>
              </div>
              <button type="button" className="tour-exit" onClick={toggleMode}>
                退出导览
              </button>
            </div>
          )}
        </div>
      )}

      {/* 移动端摇杆 */}
      {!noUI && mobile && loaded && mode === 'walk' && (
        <Joystick onMove={(x, y) => expRef.current?.walker?.setMoveInput(x, y)} />
      )}

      {/* 附近景点提示 */}
      {!noUI && mode === 'walk' && nearby && !activePoi && !poiListOpen && (
        <button type="button" className={`nearby-pill ${loaded ? 'is-visible' : ''}`} onClick={() => openPoi(nearby)}>
          <span className="nearby-dot" />
          <span className="nearby-label">已至</span>
          <span className="nearby-name">{nearby.name}</span>
          <span className="nearby-go">查看</span>
        </button>
      )}

      {/* 景点总览 */}
      {!noUI && poiListOpen && (
        <PoiList
          activeId={activePoi?.id}
          onSelect={gotoPoi}
          onClose={() => setPoiListOpen(false)}
        />
      )}

      {/* 帮助 */}
      {!noUI && helpOpen && (
        <div className="modal-mask" onClick={() => setHelpOpen(false)}>
          <div className="help-modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-head">
              <div>
                <h2>游园须知</h2>
                <span>HOW TO EXPLORE</span>
              </div>
              <button type="button" className="icon-btn small" onClick={() => setHelpOpen(false)} aria-label="关闭">
                <CloseIcon />
              </button>
            </div>
            <div className="help-grid">
              <div className="help-item">
                <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>
                <span>步行游园 / 方向键同样可用</span>
              </div>
              <div className="help-item">
                <kbd>Shift</kbd>
                <span>疾行</span>
              </div>
              <div className="help-item">
                <kbd>拖动</kbd>
                <span>按住画面环顾四周</span>
              </div>
              <div className="help-item">
                <kbd>F</kbd>
                <span>切换自由漫游 / 自动导览</span>
              </div>
              <div className="help-item">
                <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>…</kbd>
                <span>切换九种天气</span>
              </div>
              <div className="help-item">
                <kbd>M</kbd>
                <span>收起或展开天气面板</span>
              </div>
              <div className="help-item">
                <kbd>L</kbd>
                <span>打开园中十六景列表</span>
              </div>
              <div className="help-item">
                <kbd>空格</kbd>
                <span>导览中暂停 / 继续</span>
              </div>
            </div>
            <p className="help-foot">
              这是一座写意的数字园林：泉池、亭台、桥廊按史料与实景意象重构；九种天气会真实改变光、雾、水汽、粒子与灯影。
              点击左下园图上的金点，可直接前往园中十六景。
            </p>
          </div>
        </div>
      )}

      {/* 首次操作提示 */}
      {!noUI && showHint && loaded && !nearby && !poiListOpen && (
        <div className="hint-toast">
          <span>{mobile ? '左侧摇杆行走' : 'WASD 步行 · 拖动环顾'}</span>
          <span className="hint-dot" />
          <span>{mobile ? '右上角切换天气' : '按 1–9 切换天气'}</span>
          <span className="hint-dot" />
          <span>按 F 开始自动导览</span>
        </div>
      )}

      {/* 天气切换提示 */}
      {!noUI && weatherToast && (
        <div className={`weather-toast ${weatherToast.id === 'storm' ? 'is-storm' : ''}`}>
          <span className="weather-toast-line" />
          <span className="weather-toast-label">天气 · WEATHER</span>
          <span className="weather-toast-name" style={{ color: weatherToast.accent }}>
            {weatherToast.name}
          </span>
          <span className="weather-toast-tag">{weatherToast.tagline}</span>
        </div>
      )}

      {/* 转场遮罩 */}
      <div className={`fade-mask ${fade ? 'is-on' : ''}`} />
    </div>
  );
}
