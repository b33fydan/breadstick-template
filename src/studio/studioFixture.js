// src/studio/studioFixture.js — seeded example project for the static Studio view.
// shot-3 is the only fully-fleshed shot; shots 2 and 4 are intentionally empty.
export const NEON_VEIL_PROJECT = {
  id: 'proj-neon-veil',
  title: 'Neon Veil TVC',
  meta: {
    aspect: '16:9',
    resolution: '4K',
    grade: 'teal-magenta',
    vo: 'Muffled VO, picks up at the hook…',
    soundtrack: 'neon_veil_theme.mp3',
  },
  videoSrc: null,
  selectedShotId: 'shot-3',
  video: null,
  render: { status: 'idle', resultUrl: null, error: null, viewing: 'original' },
  shots: [
    {
      id: 'shot-1', index: 1, role: 'establish', label: 'Wide aerial',
      cameraType: 'Wide aerial night',
      overlays: [{ id: 'ov-1a', type: 'lower-third', params: {} }],
      comments: [
        { id: 'c-1a', kind: 'note', author: 'Sam Lee', date: '2026-06-20',
          text: 'establishing drone shot' },
      ],
    },
    {
      id: 'shot-2', index: 2, role: 'build', label: 'Low backlit',
      cameraType: 'Low angle backlit',
      overlays: [], comments: [],
    },
    {
      id: 'shot-3', index: 3, role: 'hook', label: 'OTS',
      cameraType: 'OTS · low angle backlit',
      overlays: [{ id: 'ov-3a', type: 'lower-third', params: {} }],
      comments: [
        { id: 'c-3a', kind: 'change-request', author: 'Sam Lee', date: '2026-06-20',
          text: 'add muffled SFX, song picks up here' },
        { id: 'c-3b', kind: 'note', author: 'Sam Lee', date: '2026-06-20',
          text: 'this is the hook shot' },
      ],
    },
    {
      id: 'shot-4', index: 4, role: 'build', label: 'Dolly in',
      cameraType: 'Dolly in',
      overlays: [], comments: [],
    },
    {
      id: 'shot-5', index: 5, role: 'cta', label: 'Close-up',
      cameraType: 'Close-up',
      overlays: [],
      comments: [
        { id: 'c-5a', kind: 'note', author: 'Sam Lee', date: '2026-06-20',
          text: 'logo reveal beat' },
      ],
    },
  ],
};
