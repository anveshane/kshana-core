/**
 * SVG ID namespacing helper.
 * Prefixes SVG element IDs by placement number to prevent collisions
 * when multiple infographic components are rendered in the same bundle.
 */

/**
 * Generate a namespaced SVG ID for a given placement.
 * @param placementNumber - The placement number (e.g., 1, 2, 3)
 * @param localId - The local ID within the component (e.g., 'gradient1', 'clip-path')
 * @returns Namespaced ID (e.g., 'info1_gradient1')
 */
export function svgId(placementNumber: number, localId: string): string {
  return `info${placementNumber}_${localId}`;
}

/**
 * Generate a url(#...) reference for a namespaced SVG ID.
 * @param placementNumber - The placement number
 * @param localId - The local ID within the component
 * @returns URL reference (e.g., 'url(#info1_gradient1)')
 */
export function svgUrl(placementNumber: number, localId: string): string {
  return `url(#${svgId(placementNumber, localId)})`;
}
