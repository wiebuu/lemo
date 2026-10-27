/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Firebase web app settings (Project settings → Your apps), in web/.env.local */
  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_APP_ID?: string
  /** Where the analyzer lives when it isn't on this site's own address, e.g. https://api.lemodysounds.online */
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
