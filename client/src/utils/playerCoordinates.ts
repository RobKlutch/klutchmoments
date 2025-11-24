/**
 * Ensure a player object has complete normalized coordinates for detection API
 * Returns null if any essential coordinates are missing - no fabricated defaults
 */
export function normalizePlayerForDetection(player: any): {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
} | null {
  if (!player || typeof player.id !== 'string') {
    console.warn('normalizePlayerForDetection: Invalid player object - no ID', player);
    return null;
  }

  // Extract x/y - require at least one valid source
  const x = typeof player.x === 'number' ? player.x : 
            (typeof player.topLeftX === 'number' ? player.topLeftX : null);
  const y = typeof player.y === 'number' ? player.y : 
            (typeof player.topLeftY === 'number' ? player.topLeftY : null);
  
  // Extract width/height - must be present
  const width = typeof player.width === 'number' ? player.width : null;
  const height = typeof player.height === 'number' ? player.height : null;
  
  // Fail fast if essential coordinates are missing
  if (x === null || y === null || width === null || height === null) {
    console.warn('normalizePlayerForDetection: Missing essential coordinates', {
      id: player.id,
      hasX: x !== null,
      hasY: y !== null,
      hasWidth: width !== null,
      hasHeight: height !== null
    });
    return null;
  }
  
  // Compute center if missing
  const centerX = typeof player.centerX === 'number' ? player.centerX : (x + width / 2);
  const centerY = typeof player.centerY === 'number' ? player.centerY : (y + height / 2);
  
  return {
    id: player.id,
    x,
    y,
    width,
    height,
    centerX,
    centerY
  };
}
