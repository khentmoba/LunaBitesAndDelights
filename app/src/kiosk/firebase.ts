// Firebase for the kiosk, as lib/services/firebase_init.dart and functions.dart
// set it up: the lunaexpress web app, App Check through reCAPTCHA Enterprise when
// a site key is built in, callables in us-central1 with a 15 s timeout, and
// Firebase Auth for the staff session.
// Each SDK is loaded lazily on first use so pages only download what they need
// (e.g. checkout uses firestore/lite instead of the full 581 KB Firestore SDK,
// and staff reports/dashboard never download Firestore at all).
import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { Firestore as LiteFirestore } from 'firebase/firestore/lite';
import type { Functions } from 'firebase/functions';

const emulators = import.meta.env.PUBLIC_FIREBASE_EMULATORS === '1';

const config = {
  apiKey: 'AIzaSyBAtF167ua5zEH-xhP2U9dObFWlQz3lF-Y',
  appId: '1:379163254734:web:01c36b90af156f2efa159f',
  messagingSenderId: '379163254734',
  projectId: emulators ? 'demo-lunaexpress' : 'lunaexpress',
  authDomain: 'lunaexpress.firebaseapp.com',
  storageBucket: 'lunaexpress.firebasestorage.app',
  measurementId: 'G-PJYTNGQR09',
};

let appPromise: Promise<FirebaseApp> | null = null;
let authPromise: Promise<Auth> | null = null;
let functionsPromise: Promise<Functions> | null = null;
let dbLitePromise: Promise<LiteFirestore> | null = null;
let dbPromise: Promise<Firestore> | null = null;

function memo<T>(get: () => Promise<T>, reset: () => void): Promise<T> {
  return get().catch((e: unknown) => {
    reset();
    throw e;
  });
}

export function firebaseApp(): Promise<FirebaseApp> {
  appPromise ??= memo(async () => {
    const { initializeApp, getApps } = await import('firebase/app');
    const app = getApps()[0] ?? initializeApp(config);
    if (!emulators) {
      const siteKey = import.meta.env.PUBLIC_RECAPTCHA_SITE_KEY;
      if (siteKey) {
        import('firebase/app-check')
          .then(({ initializeAppCheck, ReCaptchaEnterpriseProvider }) =>
            initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true }),
          )
          .catch((e: unknown) => console.warn('AppCheck activation failed', e));
      }
    }
    return app;
  }, () => { appPromise = null; });
  return appPromise;
}

export function firebaseAuth(): Promise<Auth> {
  authPromise ??= memo(async () => {
    const [app, authSdk] = await Promise.all([firebaseApp(), import('firebase/auth')]);
    const auth = authSdk.getAuth(app);
    if (emulators) authSdk.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    return auth;
  }, () => { authPromise = null; });
  return authPromise;
}

export function firebaseFunctions(): Promise<Functions> {
  functionsPromise ??= memo(async () => {
    const [app, fns] = await Promise.all([firebaseApp(), import('firebase/functions')]);
    const functions = fns.getFunctions(app, 'us-central1');
    if (emulators) fns.connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    return functions;
  }, () => { functionsPromise = null; });
  return functionsPromise;
}

export function firebaseDbLite(): Promise<LiteFirestore> {
  dbLitePromise ??= memo(async () => {
    const [app, fs] = await Promise.all([firebaseApp(), import('firebase/firestore/lite')]);
    const db = fs.getFirestore(app);
    if (emulators) fs.connectFirestoreEmulator(db, '127.0.0.1', 8080);
    return db;
  }, () => { dbLitePromise = null; });
  return dbLitePromise;
}

export function firebaseDb(): Promise<Firestore> {
  dbPromise ??= memo(async () => {
    const [app, fs] = await Promise.all([firebaseApp(), import('firebase/firestore')]);
    const db = fs.getFirestore(app);
    if (emulators) fs.connectFirestoreEmulator(db, '127.0.0.1', 8080);
    return db;
  }, () => { dbPromise = null; });
  return dbPromise;
}

/** callFn from lib/services/functions.dart: the callable's data as an object. */
export async function callFn<T = Record<string, unknown>>(name: string, params: object = {}, timeoutSecs = 15): Promise<T> {
  const [functions, { httpsCallable }] = await Promise.all([firebaseFunctions(), import('firebase/functions')]);
  const result = await httpsCallable(functions, name, { timeout: timeoutSecs * 1000 })(params);
  return result.data as T;
}
