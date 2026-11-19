import Link from "next/link";
import type { ComponentProps } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "danger-solid" | "ghost-icon";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-sm border font-semibold whitespace-nowrap no-underline cursor-pointer " +
  "transition-colors disabled:cursor-not-allowed aria-disabled:cursor-not-allowed";

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm max-md:h-11",
  md: "h-9 px-3.5 text-base max-md:h-11",
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent border-accent text-accent-fg hover:bg-accent-hover hover:border-accent-hover hover:text-accent-fg " +
    "disabled:bg-off-soft disabled:border-line disabled:text-fg-read",
  secondary:
    "bg-surface border-line-strong text-fg shadow-sm hover:bg-surface-hover hover:text-fg " +
    "disabled:text-fg-read disabled:border-line disabled:bg-surface",
  danger:
    "bg-surface border-err text-err hover:bg-err hover:text-err-fg " +
    "disabled:text-fg-read disabled:border-line disabled:bg-surface",
  "danger-solid": "bg-err border-err text-err-fg hover:opacity-90 hover:text-err-fg disabled:opacity-60",
  "ghost-icon":
    "size-8 max-md:size-11 p-0 border-transparent bg-transparent text-fg-muted hover:bg-surface-hover " +
    "disabled:text-line-strong disabled:bg-transparent aria-disabled:text-line-strong aria-disabled:hover:bg-transparent",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "sm", extra = ""): string {
  const sizeClass = variant === "ghost-icon" ? "" : SIZES[size];
  return `${BASE} ${sizeClass} ${VARIANTS[variant]} ${extra}`.trim();
}

type ButtonProps = ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize };

export function Button({ variant, size, className = "", type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

type LinkButtonProps = ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize };

export function LinkButton({ variant, size, className = "", ...rest }: LinkButtonProps) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}
