/**
 * Session-scoped storage helper
 * 
 * Prevents state pollution across sessions by namespacing all localStorage keys
 * with the current sessionId. This ensures that:
 * - Player selections don't persist across "Start New Highlight" 
 * - Each video upload gets a clean slate
 * - Timeline never auto-hydrates player selections from previous sessions
 */

interface SessionStorageHelper {
  get: <T>(key: string) => T | null;
  set: <T>(key: string, value: T) => void;
  clearAll: () => void;
  clearKey: (key: string) => void;
}

export function createSessionStorage(sessionId: string): SessionStorageHelper {
  const prefix = `klutch:${sessionId}:`;
  
  return {
    get<T>(key: string): T | null {
      try {
        const item = localStorage.getItem(prefix + key);
        return item ? JSON.parse(item) : null;
      } catch (error) {
        console.error(`Failed to get ${prefix}${key}:`, error);
        return null;
      }
    },
    
    set<T>(key: string, value: T): void {
      try {
        localStorage.setItem(prefix + key, JSON.stringify(value));
      } catch (error) {
        console.error(`Failed to set ${prefix}${key}:`, error);
      }
    },
    
    clearAll(): void {
      const keysToRemove = Object.keys(localStorage)
        .filter(k => k.startsWith(prefix));
      
      keysToRemove.forEach(k => localStorage.removeItem(k));
      console.log(`🧹 Cleared all session storage for ${sessionId}:`, keysToRemove.length, 'keys removed');
    },
    
    clearKey(key: string): void {
      localStorage.removeItem(prefix + key);
    }
  };
}

/**
 * Clear all keys for a specific session
 */
export function clearSessionStorage(sessionId: string): void {
  const prefix = `klutch:${sessionId}:`;
  const keysToRemove = Object.keys(localStorage)
    .filter(k => k.startsWith(prefix));
  
  keysToRemove.forEach(k => localStorage.removeItem(k));
  console.log(`🧹 Cleared session storage for ${sessionId}:`, keysToRemove.length, 'keys removed');
}

/**
 * Get all stored session IDs
 */
export function getAllSessionIds(): string[] {
  const sessionIds = new Set<string>();
  
  Object.keys(localStorage).forEach(key => {
    if (key.startsWith('klutch:')) {
      const match = key.match(/^klutch:([^:]+):/);
      if (match) {
        sessionIds.add(match[1]);
      }
    }
  });
  
  return Array.from(sessionIds);
}

/**
 * Clean up old sessions (keep only the N most recent)
 */
export function cleanupOldSessions(keepCount: number = 5): void {
  const sessionIds = getAllSessionIds();
  
  // If we have more sessions than we want to keep, remove the oldest
  if (sessionIds.length > keepCount) {
    const toRemove = sessionIds.slice(0, sessionIds.length - keepCount);
    toRemove.forEach(sessionId => clearSessionStorage(sessionId));
    console.log(`🧹 Cleaned up ${toRemove.length} old sessions`);
  }
}
