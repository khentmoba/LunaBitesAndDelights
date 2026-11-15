// Firebase for the kiosk, as lib/services/firebase_init.dart and functions.dart
// set it up: the lunaexpress web app, App Check through reCAPTCHA Enterprise when
// a site key is built in, callables in us-central1 with a 15 s timeout, and
// Firebase Auth for the staff session.
// Loaded on first use so the menu and cart never download the SDK.
import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
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

interface Services {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  functions: Functions;
}

let ready: Promise<Services> | null = null;

async function start(): Promise<Services> {
  const [{ initializeApp, getApps }, firestore, fns, authSdk] = await Promise.all([
    import('firebase/app'),
    import('firebase/firestore'),
    import('firebase/functions'),
    import('firebase/auth'),
  ]);
  const app = getApps()[0] ?? initializeApp(config);
  const auth = authSdk.getAuth(app);
  const db = firestore.getFirestore(app);
  const functions = fns.getFunctions(app, 'us-central1');
  if (emulators) {
    authSdk.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    firestore.connectFirestoreEmulator(db, '127.0.0.1', 8080);
    fns.connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  } else {
    const siteKey = import.meta.env.PUBLIC_RECAPTCHA_SITE_KEY;
    if (siteKey) {
      import('firebase/app-check')
        .then(({ initializeAppCheck, ReCaptchaEnterpriseProvider }) =>
          initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true }),
        )
        .catch((e: unknown) => console.warn('AppCheck activation failed', e));
    }
  }
  return { app, auth, db, functions };
}

export function firebase(): Promise<Services> {
  ready ??= start().catch((e: unknown) => {
    ready = null;
    throw e;
  });
  return ready;
}

/** callFn from lib/services/functions.dart: the callable's data as an object. */
export async function callFn<T = Record<string, unknown>>(name: string, params: object = {}, timeoutSecs = 15): Promise<T> {
  const [{ functions }, { httpsCallable }] = await Promise.all([firebase(), import('firebase/functions')]);
  const result = await httpsCallable(functions, name, { timeout: timeoutSecs * 1000 })(params);
  return result.data as T;
}
