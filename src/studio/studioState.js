// src/studio/studioState.js — pure transitions for the Studio project.
// Each returns a new project (or the same reference when nothing changes),
// so StudioView can drive them from useState and they unit-test without React.

export function selectShot(project, shotId) {
  if (project.selectedShotId === shotId) return project;
  if (!project.shots.some((s) => s.id === shotId)) return project;
  return { ...project, selectedShotId: shotId };
}

export function addComment(project, shotId, comment) {
  if (!project.shots.some((s) => s.id === shotId)) return project;
  return {
    ...project,
    shots: project.shots.map((s) =>
      s.id === shotId ? { ...s, comments: [...s.comments, comment] } : s
    ),
  };
}

export function getSelectedShot(project) {
  return project.shots.find((s) => s.id === project.selectedShotId) ?? null;
}

const FRESH_RENDER = { status: 'idle', resultUrl: null, error: null, viewing: 'original' };

export function setVideo(project, video) {
  return { ...project, video, render: { ...FRESH_RENDER } };
}

export function clearVideo(project) {
  return setVideo(project, null);
}

function mapShot(project, shotId, fn) {
  return { ...project, shots: project.shots.map((s) => (s.id === shotId ? fn(s) : s)) };
}

export function setOverlayEffect(project, shotId, type) {
  const shot = project.shots.find((s) => s.id === shotId);
  if (!shot) return project;
  const cur = shot.overlays[0];
  if (cur && cur.type === type) return project; // no-op: same type, keep everything
  // type changed, so create new shot and new project
  return mapShot(project, shotId, (s) => {
    const overlay = { id: cur?.id ?? `ov-${shotId}`, type, params: {} };
    return { ...s, overlays: [overlay, ...s.overlays.slice(1)] };
  });
}

export function setOverlayParam(project, shotId, key, value) {
  return mapShot(project, shotId, (s) => {
    const cur = s.overlays[0] || { id: `ov-${shotId}`, type: null, params: {} };
    const overlay = { ...cur, params: { ...cur.params, [key]: value } };
    return { ...s, overlays: [overlay, ...s.overlays.slice(1)] };
  });
}

export function startRender(project) {
  return { ...project, render: { ...project.render, status: 'rendering', resultUrl: null, error: null } };
}

export function renderSucceeded(project, url) {
  return { ...project, render: { status: 'done', resultUrl: url, error: null, viewing: 'composited' } };
}

export function renderFailed(project, msg) {
  return { ...project, render: { ...project.render, status: 'error', error: msg } };
}

export function setViewing(project, which) {
  return { ...project, render: { ...project.render, viewing: which } };
}
