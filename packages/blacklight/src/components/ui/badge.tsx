import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { type VariantProps, cva } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-none border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-surface-raised text-secondary-foreground",
        destructive: "bg-status-critical/10 text-status-critical",
        outline: "border-border-mid text-foreground",
        ghost: "text-muted-foreground hover:bg-surface-raised hover:text-foreground",

        /* Severity variants */
        critical: "bg-status-critical/10 text-status-critical font-mono text-[9px] font-bold uppercase tracking-wider",
        high: "bg-status-high/10 text-status-high font-mono text-[9px] font-bold uppercase tracking-wider",
        warn: "bg-status-warn/10 text-status-warn font-mono text-[9px] font-bold uppercase tracking-wider",
        success:
          "border-status-success bg-status-success/10 text-status-success font-mono text-[9px] font-bold uppercase tracking-wider",
        neutral:
          "border-status-pending/30 bg-status-pending/10 text-status-pending font-mono text-[9px] font-bold uppercase tracking-wider",

        /* Status pill variants */
        "status-passed":
          "border-status-success bg-status-success/10 text-status-success font-mono text-[10px] uppercase",
        "status-failed":
          "border-status-critical bg-status-critical/10 text-status-critical font-mono text-[10px] uppercase",
        "status-running": "border-status-warn bg-status-warn/10 text-status-warn font-mono text-[10px] uppercase",
        "status-pending":
          "border-status-pending/30 bg-status-pending/10 text-status-pending font-mono text-[10px] uppercase",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  });
}

export { Badge, badgeVariants };
