export async function readImageBlob(blob: Blob): Promise<{
  bytes: Uint8Array;
  width: number;
  height: number;
  mimeType: string;
}> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const mimeType = blob.type || 'image/png';

  let width = 0;
  let height = 0;

  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      width = bitmap.width;
      height = bitmap.height;
      bitmap.close();
    } catch {
      // Fallback a Image se createImageBitmap fallisce
    }
  }

  if (width === 0 || height === 0) {
    await new Promise<void>((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        width = img.naturalWidth || img.width;
        height = img.naturalHeight || img.height;
        URL.revokeObjectURL(url);
        resolve();
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(new Error(`Impossibile decodificare l'immagine: ${err}`));
      };
      img.src = url;
    });
  }

  if (width <= 0) width = 400;
  if (height <= 0) height = 400;

  return { bytes, width, height, mimeType };
}
