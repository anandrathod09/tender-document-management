/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Product name shown in the app until the real name is decided. */
  readonly VITE_PRODUCT_NAME?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
