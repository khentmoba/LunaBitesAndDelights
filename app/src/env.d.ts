interface ImportMetaEnv {
  /** "1" points Firestore, Functions and Auth at the local emulators (demo project). */
  readonly PUBLIC_FIREBASE_EMULATORS?: string;
  /** reCAPTCHA Enterprise site key for App Check. Empty skips App Check. */
  readonly PUBLIC_RECAPTCHA_SITE_KEY?: string;
  /** MapTiler key for the delivery map. Empty leaves the map without tiles. */
  readonly PUBLIC_MAPTILER_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
