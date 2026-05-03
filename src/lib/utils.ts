import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export async function compressImage(base64: string, maxSizeKB: number = 700): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = base64;
    img.onerror = (err) => reject(new Error("Failed to load image for compression"));
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      
      // If image is very large, start by downscaling
      const maxDimension = 1024;
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = (height / width) * maxDimension;
          width = maxDimension;
        } else {
          width = (width / height) * maxDimension;
          height = maxDimension;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      
      // Try different qualities until it fits under maxSizeKB
      // Note: base64 overhead is ~33%. 
      // If we want string length < 1,000,000, binary size should be < 750,000.
      let quality = 0.9;
      let compressed = canvas.toDataURL('image/jpeg', quality);
      
      let attempts = 0;
      while (compressed.length > 900000 && quality > 0.1 && attempts < 10) {
        quality -= 0.1;
        compressed = canvas.toDataURL('image/jpeg', quality);
        attempts++;
      }
      
      resolve(compressed);
    };
  });
}
