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
    let settled = false;
    const finish = (value: boolean, db?: IDBDatabase) => {
      if (settled) return;
      settled = true;
      try {
        db?.close();
      } catch {
        // Ignore close errors after aborted transactions.
      }
      resolve(value);
    };
    try {
      const open = indexedDB.open('firebaseLocalStorageDb');
      open.onupgradeneeded = () => {
        open.transaction?.abort();
        finish(false);
      };
      open.onblocked = () => finish(false);
      open.onerror = () => finish(false);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('firebaseLocalStorage')) {
          finish(false, db);
          return;
        }
        try {
          const tx = db.transaction('firebaseLocalStorage', 'readonly');
          tx.onabort = () => finish(false, db);
          tx.onerror = () => finish(false, db);
          const all = tx.objectStore('firebaseLocalStorage').getAll();
          all.onsuccess = () => {
            const rows = all.result as { fbase_key?: string; value?: { uid?: string } }[];
            finish(
              rows.some((r) => r.fbase_key?.startsWith('firebase:authUser:') && staffUsernameFor(r.value?.uid ?? '') !== null),
              db,
            );
          };
          all.onerror = () => finish(false, db);
        } catch {
          finish(false, db);
        }
      };
    } catch {
      finish(false);
    }
  });
}

