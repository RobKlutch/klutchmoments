/**
 * **BULLETPROOF SELECTEDPLAYER ACCESS**
 * 
 * This utility provides 100% safe access to selectedPlayer properties,
 * preventing ANY runtime errors from property access on null/undefined values.
 * 
 * USAGE: Replace direct selectedPlayer.property access with safeGet(selectedPlayer, 'property', defaultValue)
 * 
 * Example:
 * - Instead of: selectedPlayer.x 
 * - Use: safeGet(selectedPlayer, 'x', 0)
 */

export interface SafePlayer {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  description: string;
  centerX?: number;
  centerY?: number;
  topLeftX?: number;
  topLeftY?: number;
  [key: string]: any; // Allow other properties
}

/**
 * **RUNTIME VALIDATION**: Safely get a property from selectedPlayer with comprehensive validation
 */
export function safeGet<T>(player: any, property: string, defaultValue: T): T {
  try {
    // Null/undefined check
    if (!player || player === null || player === undefined) {
      console.warn(`🛡️ SAFE_ACCESS: player is null/undefined, returning default for ${property}:`, defaultValue);
      return defaultValue;
    }
    
    // Type validation
    if (typeof player !== 'object') {
      console.warn(`🛡️ SAFE_ACCESS: player is not an object (${typeof player}), returning default for ${property}:`, defaultValue);
      return defaultValue;
    }
    
    // Property existence check
    if (!(property in player)) {
      console.warn(`🛡️ SAFE_ACCESS: property '${property}' does not exist in player, returning default:`, defaultValue);
      return defaultValue;
    }
    
    // Value validation
    const value = player[property];
    if (value === null || value === undefined) {
      console.warn(`🛡️ SAFE_ACCESS: property '${property}' is null/undefined, returning default:`, defaultValue);
      return defaultValue;
    }
    
    return value;
  } catch (error) {
    console.error(`🛡️ SAFE_ACCESS ERROR: Exception while accessing ${property}:`, error);
    return defaultValue;
  }
}

/**
 * **SAFE PLAYER VALIDATOR**: Validates and normalizes a player object
 */
export function createSafePlayer(player: any): SafePlayer | null {
  try {
    if (!player || typeof player !== 'object') {
      console.warn('🛡️ SAFE_PLAYER: Invalid player object, returning null');
      return null;
    }
    
    return {
      id: safeGet(player, 'id', 'unknown'),
      x: safeGet(player, 'x', 0),
      y: safeGet(player, 'y', 0),
      width: safeGet(player, 'width', 0.1),
      height: safeGet(player, 'height', 0.1),
      confidence: safeGet(player, 'confidence', 0),
      description: safeGet(player, 'description', 'Unknown Player'),
      centerX: safeGet(player, 'centerX', safeGet(player, 'x', 0)),
      centerY: safeGet(player, 'centerY', safeGet(player, 'y', 0)),
      topLeftX: safeGet(player, 'topLeftX', safeGet(player, 'x', 0) - safeGet(player, 'width', 0.1) / 2),
      topLeftY: safeGet(player, 'topLeftY', safeGet(player, 'y', 0) - safeGet(player, 'height', 0.1) / 2),
      // Copy any additional properties safely
      ...Object.keys(player).reduce((acc, key) => {
        if (!['id', 'x', 'y', 'width', 'height', 'confidence', 'description', 'centerX', 'centerY', 'topLeftX', 'topLeftY'].includes(key)) {
          acc[key] = player[key];
        }
        return acc;
      }, {} as Record<string, any>)
    };
  } catch (error) {
    console.error('🛡️ SAFE_PLAYER ERROR: Exception while creating safe player:', error);
    return null;
  }
}

/**
 * **SAFE BOOLEAN CHECKS**: Safe existence and comparison checks
 */
export function hasValidPlayer(player: any): boolean {
  return createSafePlayer(player) !== null;
}

export function playerEquals(player1: any, player2: any): boolean {
  try {
    const safe1 = createSafePlayer(player1);
    const safe2 = createSafePlayer(player2);
    
    if (!safe1 || !safe2) return false;
    
    return safe1.id === safe2.id;
  } catch (error) {
    console.error('🛡️ PLAYER_EQUALS ERROR:', error);
    return false;
  }
}

/**
 * **COORDINATE ACCESS**: Safe coordinate getters with fallbacks
 */
export function getSafeCoordinates(player: any): { x: number; y: number; width: number; height: number } {
  const safePlayer = createSafePlayer(player);
  return safePlayer ? {
    x: safePlayer.x,
    y: safePlayer.y,
    width: safePlayer.width,
    height: safePlayer.height
  } : { x: 0, y: 0, width: 0.1, height: 0.1 };
}

export function getSafeId(player: any): string {
  return safeGet(player, 'id', 'unknown');
}

export function getSafeDescription(player: any): string {
  return safeGet(player, 'description', 'Unknown Player');
}