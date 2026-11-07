// Feature 010 (US8): the markdown-it plugins without type declarations of their own.
declare module 'markdown-it-deflist' {
  const plugin: (md: unknown) => void;
  export default plugin;
}
declare module 'markdown-it-footnote' {
  const plugin: (md: unknown) => void;
  export default plugin;
}
declare module 'markdown-it-sub' {
  const plugin: (md: unknown) => void;
  export default plugin;
}
declare module 'markdown-it-sup' {
  const plugin: (md: unknown) => void;
  export default plugin;
}
declare module 'markdown-it-task-lists' {
  const plugin: (md: unknown, options?: { enabled?: boolean; label?: boolean }) => void;
  export default plugin;
}
