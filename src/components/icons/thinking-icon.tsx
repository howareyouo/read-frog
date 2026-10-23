import { cn } from "@/utils/styles/utils"

/* The morph runs in CSS (`rf-thinking-morph` in theme-tokens.css) by animating
   the `d` attribute. The three keyframe shapes share an identical command
   structure (M + 4×C + Z, 26 numbers each) with the path below, which is what
   lets CSS interpolate between them. Keep them in lockstep if you ever redraw
   one. */
const CIRCLE_CLOCKWISE =
  "M 12 8 C 14.21 8 16 9.79 16 12 C 16 14.21 14.21 16 12 16 C 9.79 16 8 14.21 8 12 C 8 9.79 9.79 8 12 8 Z"

interface ThinkingIconProps extends React.ComponentProps<"svg"> {
  animated?: boolean
}

export function ThinkingIcon({ animated = true, className, ...props }: ThinkingIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4", className)}
      {...props}
    >
      <path
        d={CIRCLE_CLOCKWISE}
        className={cn(animated && "animate-rf-thinking-morph")}
      />
    </svg>
  )
}
