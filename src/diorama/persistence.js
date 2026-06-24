const VERSION = 1;

export function exportDiorama(ornamentState, cameraPos, cameraTarget) {
  const data = {
    version: VERSION,
    roomTheme: 'cozy-default',
    exportedAt: new Date().toISOString(),
    ornaments: ornamentState,
    camera: {
      position: cameraPos,
      target: cameraTarget,
    },
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'diorama.json';
  a.click();
  URL.revokeObjectURL(url);
}

export function importDiorama() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return reject(new Error('No file selected'));
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!data.version || !Array.isArray(data.ornaments)) {
            return reject(new Error('Invalid diorama file'));
          }
          resolve(data);
        } catch (err) {
          reject(err);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  });
}
