/** Save a blob as `<name>.<ext>`, with characters that aren't allowed in file names replaced. */
export function downloadFile(name: string, ext: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'route'}.${ext}`;
  a.click();
  // Some browsers start the download asynchronously, so keep the URL alive briefly.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
