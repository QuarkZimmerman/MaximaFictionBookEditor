/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Dev override of the core origin (e.g. `http://127.0.0.1:41237`) for the RPC client. */
  readonly VITE_MFBE_CORE?: string;
}

// Compile-time constants injected by `define` in vite.config.ts.

/** Core session token taken from MFBE_TOKEN at build/dev time; empty when not provided. */
declare const __MFBE_TOKEN__: string;

/** UI package version (package.json). */
declare const __MFBE_UI_VERSION__: string;
