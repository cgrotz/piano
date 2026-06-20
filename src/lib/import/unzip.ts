/**
 * The single swappable seam for zip decompression.
 *
 * This is the ONLY thing that changes if we drop fflate for another library:
 * provide a different implementation of this shape and rewire it where the
 * importer is constructed. The `.mxl` container logic (see importer.ts) depends
 * only on this port, never on a concrete zip library.
 *
 * Returns a map of archive entry path -> raw bytes. `.mxl` files are tiny
 * (kilobytes), so decompressing the whole archive at once is fine.
 */
export interface Unzip {
  (data: Uint8Array): Promise<Record<string, Uint8Array>>;
}
