import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cx } from "@/lib/format";

type Variant = "primary" | "secondary" | "ghost";
type Size = "md" | "sm";

const variantClasses: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent/90",
  secondary: "bg-raised text-text-primary hover:bg-raised/80 border border-border",
  ghost: "bg-transparent text-text-secondary hover:bg-white/5 hover:text-text-primary",
};

const sizeClasses: Record<Size, string> = {
  md: "h-12 px-6 text-sm",
  sm: "h-9 px-4 text-xs",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-pill font-semibold transition",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
    >
      {children}
    </button>
  );
}
