/**
 * CSS-only tooltip: shown on hover and keyboard focus of the wrapped element.
 * The trigger must reference it with aria-describedby={id}.
 */
export function Tooltip({ id, text, children }: { id: string; text: string; children: React.ReactNode }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none invisible absolute right-0 bottom-full z-20 mb-1.5 w-max max-w-[240px] rounded-sm bg-bar px-2.5 py-1.5 text-left text-xs font-normal text-bar-fg opacity-0 shadow-md transition-opacity group-focus-within/tip:visible group-focus-within/tip:opacity-100 group-hover/tip:visible group-hover/tip:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
