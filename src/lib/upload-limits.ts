// TODO: read these from config.ts (EXTRACT) once Dev B exports it.

export const PDF_MAX_BYTES = 4_000_000;
export const IMAGE_MAX_BYTES = 3_500_000; // JPG or PNG, one page or photo
export const PDF_MAX_PAGES = 40;

export function megabytesLabel(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1).replace(/\.0$/, "");
}
