// Session from lib/services/session.dart: a staff member is a Firebase user
// minted by the verifyStaff callable (uid `staff_<username>`) whose token
// carries a `role` claim the rules accept. Anyone else is a customer.
import { firebase } from '../kiosk/firebase.ts';
import { staffUsernameFor } from '../kiosk/staff-hint.ts';

export { hasStoredStaffUser, staffUsernameFor } from '../kiosk/staff-hint.ts';

export type StaffRole = 'admin' | 'staff';

export interface Staff {
  username: string;
  role: StaffRole;
  isAdmin: boolean;
}

/** The role from token claims if firestore.rules treats it as staff. */
export function staffRoleFor(claims: Record<string, unknown> | undefined): StaffRole | null {
  const role = claims?.role;
  return role === 'admin' || role === 'staff' ? role : null;
}

const make = (username: string, role: StaffRole): Staff => ({
  username,
  role,
  isAdmin: role === 'admin' || username.toLowerCase() === 'admin',
});

type Listener = (staff: Staff | null) => void;
const listeners = new Set<Listener>();
let current: Staff | null | undefined;
let bound = false;

function emit(next: Staff | null) {
  if (current === next || (current && next && current.username === next.username && current.role === next.role)) return;
  current = next;
  for (const fn of listeners) fn(next);
}

async function bind() {
  if (bound) return;
  bound = true;
  const [{ auth }, { onAuthStateChanged }] = await Promise.all([firebase(), import('firebase/auth')]);
  onAuthStateChanged(auth, (user) => {
    const username = user ? staffUsernameFor(user.uid) : null;
    if (!user || !username) {
      emit(null);
      return;
    }
    emit(current?.username === username ? current : make(username, username.toLowerCase() === 'admin' ? 'admin' : 'staff'));
    user
      .getIdTokenResult()
      .then((token) => {
        const role = staffRoleFor(token.claims);
        if (!role) void logout();
        else emit(make(username, role));
      })
      .catch(() => {});
  });
}

/** Calls `fn` now with the session once known, and on every change. */
export function watchStaff(fn: Listener): () => void {
  listeners.add(fn);
  if (current !== undefined) fn(current);
  bind().catch((e: unknown) => {
    bound = false;
    console.warn('Staff session unavailable', e);
    emit(null);
  });
  return () => listeners.delete(fn);
}

export const currentStaff = (): Staff | null => current ?? null;

/** Ends the Firebase staff session too (custom token from verifyStaff). */
export async function logout(): Promise<void> {
  emit(null);
  try {
    const [{ auth }, { signOut }] = await Promise.all([firebase(), import('firebase/auth')]);
    await signOut(auth);
  } catch {
    // Already signed out or offline: the session is gone either way.
  }
}

/** verifyStaff's custom token, signed in. */
export async function signInWithToken(token: string): Promise<void> {
  const [{ auth }, { signInWithCustomToken }] = await Promise.all([firebase(), import('firebase/auth')]);
  await signInWithCustomToken(auth, token);
}

/** A callable's error as Flutter's FirebaseFunctionsException saw it. */
export function fnError(e: unknown): { code: string; message: string } | null {
  if (!e || typeof e !== 'object' || !('code' in e)) return null;
  const code = String((e as { code: unknown }).code).replace(/^functions\//, '');
  const message = (e as { message?: unknown }).message;
  return { code, message: typeof message === 'string' && message ? message : code };
}

export const isAuthCode = (code: string): boolean => code === 'unauthenticated' || code === 'permission-denied';
