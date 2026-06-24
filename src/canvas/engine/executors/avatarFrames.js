/**
 * Avatar Frames executor — folder-scan path of onAvatarScanFolder
 * (CanvasView.jsx:14610-14621). Output shape:
 *   { status: 'scanning'|'done'|'error', images, error }
 * images = data.images verbatim ([{ path, ... }]). Not retryable — a failed
 * local folder scan won't heal on retry.
 */
export const avatarFramesExecutor = {
  async execute({ node, report, server, fetchImpl = fetch }) {
    const folderPath = node.data?.folderPath;
    if (!folderPath) throw new Error('avatar-frame node has no folder set');
    report({ status: 'scanning', images: [], error: '' });
    const res = await fetchImpl(`${server}/api/scan-folder?path=${encodeURIComponent(folderPath)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Scan failed');
    return { status: 'done', images: data.images, error: '' };
  },
};
