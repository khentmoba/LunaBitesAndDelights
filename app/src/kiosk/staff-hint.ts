// The staff hint customer pages read without loading Firebase: whether this
// browser holds a staff user (uid `staff_<username>`, minted by verifyStaff).

/** The staff username for a Firebase uid minted by verifyStaff, or null. */
export const staffUsernameFor = (uid: string): string | null =>
  uid.startsWith('staff_') && uid.length > 6 ? uid.substring(6) : null;

/**
 * Whether this browser holds a signed-in staff user, read straight from the
 * Firebase Auth IndexedDB store so customer pages need not load the SDK to
 * find out. False on any doubt.
 */
export function hasStoredStaffUser(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open('firebaseLocalStorageDb');
      open.onupgradeneeded = () => {
        open.transaction?.abort();
        resolve(false);
      };
      open.onerror = () => resolve(false);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('firebaseLocalStorage')) {
          db.close();
          resolve(false);
          return;
        }
        const all = db.transaction('firebaseLocalStorage', 'readonly').objectStore('firebaseLocalStorage').getAll();
        all.onsuccess = () => {
          db.close();
          const rows = all.result as { fbase_key?: string; value?: { uid?: string } }[];
          resolve(rows.some((r) => r.fbase_key?.startsWith('firebase:authUser:') && staffUsernameFor(r.value?.uid ?? '') !== null));
        };
        all.onerror = () => {
          db.close();
          resolve(false);
        };
      };
    } catch {
      resolve(false);
    }
  });
}

