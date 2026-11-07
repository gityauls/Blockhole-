"use client";

import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

type PortalProps = {
  open: boolean;
  className?: string;
};

/** The brand portal: closed at rest, animated only in response to the user. */
export function Portal({ open, className }: PortalProps) {
  const reducedMotion = useReducedMotion();
  const src = !open
    ? "/brand/portal-closed.png"
    : reducedMotion
      ? "/brand/portal-open.png"
      : "/brand/portal.gif";

  return (
    // Pixel art must stay at integer scales, which next/image would resample.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={160}
      height={160}
      draggable={false}
      className={cn("select-none [image-rendering:pixelated]", className)}
    />
  );
}
