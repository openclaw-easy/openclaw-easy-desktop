import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../lib/utils"

// Base classes carry the glass-glow motion system:
//   - press-pulse:  scale-down + coral glow ring on :active
//   - ripple-glow:  one-shot radial glow centered on the click
//   - transition-* on transform / shadow / colors so hover lift &
//     active spring-back read smoothly
// Variants layer their colors + variant-specific hover treatment on top.
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium",
    "ring-offset-background",
    "press-pulse ripple-glow",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-150",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    "disabled:pointer-events-none disabled:opacity-50",
  ].join(" "),
  {
    variants: {
      variant: {
        // Default = brand-coral primary. Hover lifts slightly + adds
        // a coral glow halo; active state cancels the lift.
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 hover:-translate-y-px hover:shadow-glow active:translate-y-0",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:-translate-y-px hover:shadow-[0_0_18px_rgba(220,38,38,0.30)] active:translate-y-0",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground hover:border-ring/50 hover:shadow-glow",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:-translate-y-px hover:shadow-soft-md active:translate-y-0",
        ghost:
          "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
