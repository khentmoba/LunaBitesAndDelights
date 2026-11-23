/// <reference types="google.maps" />

interface ImportMetaEnv {
  /** "1" points Firestore, Functions and Auth at the local emulators (demo project). */
  readonly PUBLIC_FIREBASE_EMULATORS?: string;
  /** reCAPTCHA Enterprise site key for App Check. Empty skips App Check. */
  readonly PUBLIC_RECAPTCHA_SITE_KEY?: string;
  /** Google Maps browser key for the delivery map. Empty leaves the map without tiles. */
  readonly PUBLIC_GOOGLE_MAPS_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
