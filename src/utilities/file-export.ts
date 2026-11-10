import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export interface FileExportOptions {
  filename: string;
  content: string | Uint8Array | Blob;
  mimeType: string;
  dialogTitle?: string;
}

/**
 * Converts text, Uint8Array, or Blob to base64 safely without call-stack overflow.
 */
async function toBase64(content: string | Uint8Array | Blob): Promise<string> {
  if (typeof content === 'string') {
    const bytes = new TextEncoder().encode(content);
    let binary = '';
    const len = bytes.byteLength;
    const chunkSize = 8192;
    for (let i = 0; i < len; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, len)));
    }
    return btoa(binary);
  }
  if (content instanceof Uint8Array) {
    let binary = '';
    const len = content.byteLength;
    const chunkSize = 8192;
    for (let i = 0; i < len; i += chunkSize) {
      binary += String.fromCharCode(...content.subarray(i, Math.min(i + chunkSize, len)));
    }
    return btoa(binary);
  }
  if (content instanceof Blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(content);
    });
  }
  return '';
}

/**
 * Exports/downloads a file seamlessly across Web browsers and Android Native (Capacitor).
 *
 * - On Android Native: Writes the file to the app cache directory via `@capacitor/filesystem`
 *   and invokes the native OS Share / Save dialog via `@capacitor/share` so the user can
 *   save to Downloads, Google Drive, or open in third-party viewers.
 * - On Web: Creates a temporary Blob and triggers an anchor element with the download attribute.
 */
export async function exportFile(options: FileExportOptions): Promise<void> {
  const { filename, content, mimeType, dialogTitle = 'Save or Share File' } = options;

  if (Capacitor.isNativePlatform()) {
    try {
      const base64Data = await toBase64(content);
      const writeResult = await Filesystem.writeFile({
        path: filename,
        data: base64Data,
        directory: Directory.Cache,
      });

      const fileUri = writeResult.uri;

      await Share.share({
        title: filename,
        text: filename,
        url: fileUri,
        dialogTitle,
      });
      return;
    } catch (err: any) {
      // If the user dismissed the share dialog, do not re-throw as an error
      if (err?.message?.includes('canceled') || err?.message?.includes('dismissed')) {
        return;
      }
      console.warn('[file-export] Native filesystem/share export failed, attempting web fallback:', err);
    }
  }

  // Web Browser fallback
  let blob: Blob;
  if (content instanceof Blob) {
    blob = content;
  } else if (content instanceof Uint8Array) {
    blob = new Blob([content as any], { type: mimeType });
  } else {
    blob = new Blob([content], { type: mimeType });
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

