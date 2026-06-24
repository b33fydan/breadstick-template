import { useRef, useState, useEffect, useCallback } from 'react';
import { createScene } from './scene';
import { buildRoom } from './roomBuilder';
import { OrnamentSystem } from './ornamentSystem';
import { exportDiorama, importDiorama } from './persistence';
import { ORNAMENTS } from './ornamentCatalog';
import { createLivePoller } from './dioramaLive';
import DioramaSidebar from './DioramaSidebar';
import './DioramaView.css';

const STORAGE_KEY = 'breadstick-diorama';

export default function DioramaView() {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [entered, setEntered] = useState(false);
  const [selectedOrnament, setSelectedOrnament] = useState(null);
  const [placedCount, setPlacedCount] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedInfo, setSelectedInfo] = useState(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const { scene, camera, renderer, controls, dispose, handleResize } = createScene(canvas);
    const { room, zones } = buildRoom();
    scene.add(room);

    const system = new OrnamentSystem(scene, zones, camera, renderer);
    system.onChange(() => {
      setPlacedCount(system.placed.length);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(system.getState()));
      } catch (_) { /* quota */ }
    });
    system.onSelect((id, placedId) => {
      if (id) {
        const item = system.placed.find(p => p.userData.placedId === placedId);
        setSelectedInfo({ id, placedId, zone: item?.userData.zone || 'unknown' });
      } else {
        setSelectedInfo(null);
      }
    });

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        system.loadState(JSON.parse(saved));
        setPlacedCount(system.placed.length);
      } catch (_) { /* corrupt */ }
    }

    sceneRef.current = { scene, camera, renderer, controls, system, dispose, handleResize };

    handleResize();
    setReady(true);

    let raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      system.update(performance.now());
      renderer.render(scene, camera);
    };
    loop();

    // ── live ornaments: poll feeds, drive ornament state (visibility-gated) ──
    const fetchJson = (path) => fetch(`http://localhost:3001${path}`).then((r) => r.json());
    const poller = createLivePoller({
      system,
      getPlaced: () => system.getState().map((s) => ({ ornamentId: s.id, placedId: s.placedId })),
      catalog: ORNAMENTS,
      deps: { fetchJson },
    });
    const onVisibility = () => {
      if (document.visibilityState === 'visible') poller.start();
      else poller.stop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    if (document.visibilityState === 'visible') poller.start();

    return () => {
      cancelAnimationFrame(raf);
      poller.stop();
      document.removeEventListener('visibilitychange', onVisibility);
      system.dispose();
      dispose();
    };
  }, []);

  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.system.setActiveOrnament(selectedOrnament);
    }
  }, [selectedOrnament]);

  const handleExport = useCallback(() => {
    if (!sceneRef.current) return;
    const { system, camera, controls } = sceneRef.current;
    exportDiorama(
      system.getState(),
      camera.position.toArray(),
      controls.target.toArray()
    );
  }, []);

  const handleImport = useCallback(async () => {
    if (!sceneRef.current) return;
    try {
      const data = await importDiorama();
      sceneRef.current.system.loadState(data.ornaments);
      if (data.camera?.position) {
        sceneRef.current.camera.position.fromArray(data.camera.position);
      }
      if (data.camera?.target) {
        sceneRef.current.controls.target.fromArray(data.camera.target);
      }
      setPlacedCount(sceneRef.current.system.placed.length);
    } catch (_) { /* cancelled or invalid */ }
  }, []);

  const handleEnter = () => setEntered(true);

  return (
    <div className="diorama-container">
      <canvas ref={canvasRef} className="diorama-canvas" />

      {ready && !entered && (
        <div className="diorama-loading">
          <div className="loading-title">YOUR ROOM</div>
          <div className="loading-sub">a cozy corner of Breadstick</div>
          <button className="diorama-enter-btn" onClick={handleEnter}>
            ENTER
          </button>
        </div>
      )}

      {entered && (
        <DioramaSidebar
          selectedOrnament={selectedOrnament}
          onSelect={setSelectedOrnament}
          placedCount={placedCount}
          onExport={handleExport}
          onImport={handleImport}
          open={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          selectedInfo={selectedInfo}
        />
      )}
    </div>
  );
}
