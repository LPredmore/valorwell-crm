const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const TARGET_BYTES = 1900 * 1024;
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export type PreparedCover = { file: File; width: number; height: number };

/**
 * Do not crop or pad the selected artwork. The editor must send the same composition
 * shown in the preview. Convert WebP and compress oversized uploads to JPEG because
 * the YouTube thumbnail API expects an image smaller than 2 MB.
 */
export async function prepareCoverFile(file: File): Promise<PreparedCover> {
  if (!TYPES.has(file.type)) {
    throw new Error('Choose a PNG, JPG or WebP image.');
  }
  if (!file.size) throw new Error('The selected image is empty.');
  const bitmap = await createImageBitmap(file);
  try {
    const width = bitmap.width;
    const height = bitmap.height;
    if (!width || !height) throw new Error('Could not read the selected image dimensions.');

    if (file.type !== 'image/webp' && file.size <= TARGET_BYTES) {
      return { file, width, height };
    }

    const canvas = document.createElement('canvas');
    // Large images are downscaled without changing their aspect ratio.
    const scale = Math.min(1, 1920 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable in this browser.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const toJpeg = (quality: number) => new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not compress this image.')), 'image/jpeg', quality);
    });
    let output: Blob | null = null;
    for (const quality of [0.92, 0.84, 0.74, 0.62]) {
      output = await toJpeg(quality);
      if (output.size <= TARGET_BYTES) break;
    }
    if (!output || output.size > MAX_UPLOAD_BYTES) {
      throw new Error('This image could not be compressed under 2 MB. Please choose a smaller file.');
    }
    const name = file.name.replace(/\.[^.]*$/, '') + '.jpg';
    return {
      file: new File([output], name, { type: 'image/jpeg' }),
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    bitmap.close();
  }
}
