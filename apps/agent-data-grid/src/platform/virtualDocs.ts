/**
 * Virtual-document shim for the ported OpenIDEA UI kit.
 *
 * The real implementation opens read-only generated documents (decompiled
 * class files, diffs) through the backend. This app has no such backend, so
 * the kit-facing API is stubbed to report "no document".
 */

export interface VirtualDocument {
  path: string
  content: string
}

export function isVirtualDocument(_path: string): boolean {
  return false
}

/** Virtual URIs are `openidea-virtual://...`; this app has none. */
export function isVirtualUri(_uri: string): boolean {
  return false
}

export async function openVirtualDocument(_path: string): Promise<VirtualDocument | null> {
  return null
}
