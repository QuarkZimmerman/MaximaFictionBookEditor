/**
 * The assistant's sign of work in the banner and the status bar (feature 008, FR-084, FR-086):
 * an atom whose electrons turn, in the theme's text colour; still under reduced motion
 * (layout.css). Kept outside `ui/src/ai/`, whose modules are the lazy chunk.
 */

export function AiAtom({ className }: { className?: string }) {
  return (
    <svg
      className={`mfbe-ai-atom${className ? ` ${className}` : ''}`}
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      data-testid="ai-atom"
    >
      <g fill="none" stroke="currentColor" strokeWidth="0.9">
        <ellipse cx="8" cy="8" rx="6.5" ry="2.4" />
        <ellipse cx="8" cy="8" rx="6.5" ry="2.4" transform="rotate(60 8 8)" />
        <ellipse cx="8" cy="8" rx="6.5" ry="2.4" transform="rotate(120 8 8)" />
      </g>
      <circle cx="8" cy="8" r="1.6" fill="currentColor" />
      <g className="mfbe-ai-atom-electrons" fill="currentColor">
        <circle cx="14.5" cy="8" r="1.2" />
        <circle cx="4.75" cy="13.63" r="1.2" />
        <circle cx="4.75" cy="2.37" r="1.2" />
      </g>
    </svg>
  );
}
