// Google Drive helper — replaces the gws CLI flow with the official googleapis
// SDK + Service Account JWT auth. Eliminates the spawn-subprocess-keyring chain
// and the 30s timeouts that were polluting test runs.
//
// Setup (one-time):
//   1. Create a Service Account in Google Cloud Console
//   2. Download its JSON key, save to .secrets/<name>.json (gitignored)
//   3. Set GOOGLE_DRIVE_SA_KEY=<absolute path to JSON> in .env
//   4. Share each Drive folder you need with the SA's email as Editor
//
// All operations are in-process async fetches — no shells, no Python, no keyring.

import { google } from 'googleapis';
import { createReadStream, createWriteStream } from 'fs';
import { basename } from 'path';

let _drive = null;

function getDriveClient() {
  if (_drive) return _drive;

  const keyFile = process.env.GOOGLE_DRIVE_SA_KEY;
  if (!keyFile) {
    throw new Error('GOOGLE_DRIVE_SA_KEY env var not set — point it at the Service Account JSON path');
  }

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });

  _drive = google.drive({ version: 'v3', auth });
  return _drive;
}

// List files in a folder. Returns [{id, name, mimeType, createdTime}, ...]
// matching the shape the existing call-sites expect from the gws helper.
export async function driveListFolder(folderId) {
  const drive = getDriveClient();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType, createdTime)',
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files || [];
}

// Download a Drive file by ID to a local path. Streams to disk.
export async function driveDownload(fileId, outputPath) {
  const drive = getDriveClient();
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' }
  );
  await new Promise((resolve, reject) => {
    const out = createWriteStream(outputPath);
    res.data.on('end', resolve).on('error', reject).pipe(out);
    out.on('error', reject);
  });
}

// Upload a local file to a Drive folder. Returns {id, name, mimeType, ...}.
// `name` defaults to the source filename when omitted.
export async function driveUpload(filePath, parentId, name = null) {
  const drive = getDriveClient();
  const finalName = name || basename(filePath);
  const res = await drive.files.create({
    requestBody: {
      name: finalName,
      parents: parentId ? [parentId] : undefined,
    },
    media: {
      body: createReadStream(filePath),
    },
    fields: 'id, name, mimeType, parents',
    supportsAllDrives: true,
  });
  return res.data;
}

// Move a file to trash. Used to clear /Short form IN/ after processing.
export async function driveTrash(fileId) {
  const drive = getDriveClient();
  await drive.files.update({
    fileId,
    requestBody: { trashed: true },
    supportsAllDrives: true,
  });
}
