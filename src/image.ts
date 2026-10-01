import type { StoredImage } from './types.ts';

const readAsDataUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/**
 * Đọc ảnh người dùng tải lên. Ảnh lớn hơn maxSide được thu nhỏ (JPEG) để yêu cầu gửi Gemini
 * và project lưu trong trình duyệt không quá nặng; ảnh nhỏ giữ nguyên.
 */
export async function readImageFile(file: File, maxSide = 1536): Promise<StoredImage> {
  const original = await readAsDataUrl(file);
  const mimeType = file.type || 'image/png';
  try {
    const img = new Image();
    img.src = original;
    await img.decode();
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale >= 1) return { base64: original, mimeType };
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return { base64: original, mimeType };
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { base64: canvas.toDataURL('image/jpeg', 0.9), mimeType: 'image/jpeg' };
  } catch {
    // Trình duyệt không giải mã được (vd. HEIC): gửi nguyên ảnh gốc.
    return { base64: original, mimeType };
  }
}
