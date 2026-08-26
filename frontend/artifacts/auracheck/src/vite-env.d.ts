/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute URL of the api-server when it's deployed on a different origin than this build (e.g. Vercel + Render). Unset locally. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
