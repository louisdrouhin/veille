"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./button";

type Props = ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize; pendingLabel?: React.ReactNode };

/** Submit button that disables itself while its form's server action runs. */
export function SubmitButton({ variant, size, className = "", pendingLabel, children, disabled, ...rest }: Props) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={buttonClass(variant, size, `${className} ${pending ? "opacity-70" : ""}`)}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...rest}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
