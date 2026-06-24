// src/workspace/WorkspaceContext.jsx — cross-view workspace state provider.
// Thin React wrapper over workspaceStore.js. The `storage` event listener gives
// the cross-tab sync ThemeContext lacks: another tab's write re-hydrates us.
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { WORKSPACE_KEY, readWorkspace, mergeWorkspace, writeWorkspace } from './workspaceStore';

const WorkspaceCtx = createContext({
  activeView: 'classic',
  activeCharacterId: null,
  setActiveView: () => {},
  setActiveCharacterId: () => {},
});

export function WorkspaceProvider({ children }) {
  const [state, setState] = useState(() => readWorkspace());

  // Cross-tab sync: a `storage` event fires only in OTHER tabs, so re-reading
  // here never echoes our own writes.
  useEffect(() => {
    const onStorage = (e) => { if (e.key === WORKSPACE_KEY) setState(readWorkspace()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const patch = useCallback((p) => {
    setState((prev) => writeWorkspace(mergeWorkspace(prev, p)));
  }, []);

  const setActiveView = useCallback((v) => patch({ activeView: v }), [patch]);
  const setActiveCharacterId = useCallback((id) => patch({ activeCharacterId: id }), [patch]);

  return (
    <WorkspaceCtx.Provider value={{ ...state, setActiveView, setActiveCharacterId }}>
      {children}
    </WorkspaceCtx.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspace() { return useContext(WorkspaceCtx); }
