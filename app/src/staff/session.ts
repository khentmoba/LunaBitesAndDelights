// Session: a staff member is a Firebase user
// minted by the verifyStaff callable (uid `staff_<username>`) whose token
// carries a `role` claim the rules accept. Anyone else is a customer.
import { firebaseAuth } from '../kiosk/firebase.ts';
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

/** Decides how to handle a getIdTokenResult() error without wiping offline sessions. */
export function tokenErrorAction(code: string, hasMatchingCurrent: boolean): 'keep' | 'defer' | 'logout' {
  if (code === 'auth/network-request-failed') {
    return hasMatchingCurrent ? 'keep' : 'defer';
  }
  return 'logout';
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
let authSeq = 0;

function emit(next: Staff | null) {
  if (current === next || (current && next && current.username === next.username && current.role === next.role)) return;
  current = next;
  for (const fn of listeners) fn(next);
}

async function bind() {
  if (bound) return;
  bound = true;
  const [auth, { onAuthStateChanged }] = await Promise.all([firebaseAuth(), import('firebase/auth')]);
  onAuthStateChanged(auth, (user) => {
    const seq = ++authSeq;
    const username = user ? staffUsernameFor(user.uid) : null;
    if (!user || !username) {
      emit(null);
      return;
    }
    user
      .getIdTokenResult()
      .then((token) => {
        if (seq !== authSeq) return;
        const role = staffRoleFor(token.claims);
        if (!role) void logout();
        else emit(make(username, role));
      })
      .catch((e: unknown) => {
        if (seq !== authSeq) return;
        console.warn('Staff token verification failed', e);
        const code = typeof (e as { code?: unknown })?.code === 'string' ? (e as { code: string }).code : '';
        const action = tokenErrorAction(code, current?.username === username);
        if (action === 'keep') return;
        if (action === 'defer') {
          emit(null);
          return;
        }
        void logout();
      });
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
  authSeq++;
  emit(null);
  try {
    const [auth, { signOut }] = await Promise.all([firebaseAuth(), import('firebase/auth')]);
    await signOut(auth);
  } catch {
    // Already signed out or offline: the session is gone either way.
  }
}

/** verifyStaff's custom token, signed in. */
export async function signInWithToken(token: string): Promise<void> {
  const [auth, { signInWithCustomToken }] = await Promise.all([firebaseAuth(), import('firebase/auth')]);
  await signInWithCustomToken(auth, token);
}

/** A callable's error code and message, or null when it is not a callable error. */
export function fnError(e: unknown): { code: string; message: string } | null {
  if (!e || typeof e !== 'object' || !('code' in e)) return null;
  const code = String((e as { code: unknown }).code).replace(/^functions\//, '');
  const message = (e as { message?: unknown }).message;
  return { code, message: typeof message === 'string' && message ? message : code };
}

export const isAuthCode = (code: string): boolean => code === 'unauthenticated' || code === 'permission-denied';

export function isAuthErrorText(message: string): boolean {
  const e = message.toLowerCase();
  return e.includes('sign in') || e.includes('unauthenticated') || e.includes('permission-denied');
}

export function staffErrorMessage(e: unknown, prefix: string, offline: string): string {
  const fe = fnError(e);
  if (!fe) return offline;
  if (isAuthCode(fe.code)) {
    void logout();
    return `Staff session expired (${fe.code}). Please sign in again.`;
  }
  return `${prefix}: ${fe.message}`;
}
