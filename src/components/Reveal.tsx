"use client";

import { useEffect, useRef, type CSSProperties, type ElementType, type ReactNode } from "react";

interface RevealProps {
  children: ReactNode;
  /** Element to render as. Defaults to a div. */
  as?: ElementType;
  /** Stagger delay in milliseconds before this item animates in. */
  delay?: number;
  className?: string;
}

/**
 * Reveals its children with a lift-and-fade once they scroll into view, driven
 * by an IntersectionObserver rather than a scroll listener. Each instance
 * observes itself a single time, then disconnects.
 *
 * The visual transition is defined by the `[data-reveal]` rule in globals.css;
 * this component only adds that attribute and flips `data-shown` on entry. It
 * is style-agnostic so multiple concept pages can reuse it.
 */
export function Reveal({ children, as, delay = 0, className = "" }: RevealProps) {
  const Tag = (as ?? "div") as ElementType;
  const elementRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          element.dataset.shown = "true";
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={elementRef}
      data-reveal=""
      className={className}
      style={{ transitionDelay: `${delay}ms` } as CSSProperties}
    >
      {children}
    </Tag>
  );
}
