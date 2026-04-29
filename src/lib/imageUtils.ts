/**
 * Difference Image Hashing (dHash)
 * Downscales image to 9x8, converts to grayscale, and compares adjacent pixels.
 * Highly robust to aspect ratio changes and slight crops.
 */
export async function generatePerceptualHash(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject('Could not get canvas context');

      // 9x8 for dHash gives 64 bits of differences
      const width = 9;
      const height = 8;
      canvas.width = width;
      canvas.height = height;

      // Draw and resize
      ctx.drawImage(img, 0, 0, width, height);

      // Get pixel data
      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;

      // Grayscale
      let pixels: number[] = [];
      for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
        pixels.push(avg);
      }

      // Generate dHash bits
      let hash = '';
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width - 1; x++) {
          const left = pixels[y * width + x];
          const right = pixels[y * width + x + 1];
          hash += left < right ? '1' : '0';
        }
      }

      // Convert bits to hex (64 bits -> 16 hex chars)
      let hexHash = '';
      for (let i = 0; i < hash.length; i += 4) {
        const chunk = hash.substring(i, i + 4);
        hexHash += parseInt(chunk, 2).toString(16);
      }

      URL.revokeObjectURL(img.src);
      resolve(hexHash);
    };
    img.onerror = reject;
  });
}

/**
 * Normalizes call strings
 */
export function createExactKey(phone: string, time: string, duration: string): string {
  const p = phone.replace(/[^0-9]/g, '').slice(-10); // Last 10 digits
  const t = time.toLowerCase().trim();
  const d = duration.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  return `${p}_${t}_${d}`;
}
