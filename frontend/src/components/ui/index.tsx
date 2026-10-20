/** shadcn/ui-style primitives (hand-written so the project has no CLI step). Same API shape and tokens. */
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2, X } from "lucide-react";
import * as React from "react";
import { cn } from "@/utils/cn";
import { initials } from "@/utils/format";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        outline: "border bg-transparent hover:bg-accent",
        ghost: "hover:bg-accent",
        destructive: "bg-danger text-white hover:bg-danger/90",
        subtle: "bg-muted hover:bg-accent",
      },
      size: { default: "h-9 px-3.5", sm: "h-8 px-2.5 text-xs", icon: "h-8 w-8", lg: "h-10 px-5" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { loading?: boolean }
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, loading, children, disabled, ...p }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...p}>
    {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{children}
  </button>
));

export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("rounded-lg border bg-card", className)} {...p} />;
export const CardHeader = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("flex items-start justify-between gap-3 px-4 pt-4", className)} {...p} />;
export const CardTitle = ({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) => <h3 className={cn("text-sm font-semibold tracking-tight", className)} {...p} />;
export const CardBody = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("p-4", className)} {...p} />;

const field = "w-full rounded-md border bg-transparent px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50";
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cn(field, "h-9", className)} {...p} />);
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} className={cn(field, "min-h-[80px] py-2", className)} {...p} />);
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => <select ref={ref} className={cn(field, "h-9 bg-background pr-8", className)} {...p} />);
export const Label = ({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label className={cn("mb-1.5 block text-xs font-medium text-muted-foreground", className)} {...p} />;
export const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <div><Label>{label}</Label>{children}{hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}</div>
);

const badgeTones = {
  neutral: "bg-muted text-muted-foreground", success: "bg-success/15 text-success", warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger", info: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
};
export type Tone = keyof typeof badgeTones;
export const Badge = ({ tone = "neutral", className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) => (
  <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", badgeTones[tone], className)} {...p} />
);
export const statusTone = (s: string): Tone =>
  ({ completed: "success", approved: "success", healthy: "success", in_progress: "info", in_review: "warning", needs_attention: "warning",
     changes_requested: "danger", at_risk: "danger", urgent: "danger", high: "warning", open: "info", resolved: "success" } as Record<string, Tone>)[s] ?? "neutral";

export const Progress = ({ value, className, tone = "bg-primary" }: { value: number; className?: string; tone?: string }) => (
  <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
    <div className={cn("h-full rounded-full transition-all duration-500", tone)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
  </div>
);

export const Spinner = ({ className }: { className?: string }) => <Loader2 className={cn("h-4 w-4 animate-spin text-muted-foreground", className)} />;
export const PageLoader = () => <div className="grid h-48 place-items-center"><Spinner className="h-5 w-5" /></div>;
export const Empty = ({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) => (
  <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed px-6 py-10 text-center">
    <p className="font-medium">{title}</p>{hint && <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>}{action && <div className="mt-3">{action}</div>}
  </div>
);
export const ErrorState = ({ message, retry }: { message: string; retry?: () => void }) => (
  <div className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm"><p className="text-danger">{message}</p>
    {retry && <Button variant="outline" size="sm" className="mt-2" onClick={retry}>Try again</Button>}</div>
);

export const Avatar = ({ name, src, className }: { name?: string; src?: string | null; className?: string }) =>
  src ? <img src={src} alt="" className={cn("h-7 w-7 rounded-full object-cover", className)} /> :
    <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-semibold", className)}>{initials(name)}</span>;

export function Dialog({ open, onClose, title, description, children, wide }: { open: boolean; onClose: () => void; title: string; description?: string; children: React.ReactNode; wide?: boolean }) {
  React.useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div role="dialog" aria-modal="true" className={cn("relative z-10 max-h-[90vh] w-full animate-fade-in overflow-y-auto rounded-xl border bg-card p-5 shadow-2xl scroll-thin", wide ? "max-w-2xl" : "max-w-md")}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div><h2 className="text-base font-semibold tracking-tight">{title}</h2>{description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}</div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }: { tabs: { id: string; label: string; icon?: React.ReactNode; badge?: number }[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b scroll-thin" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cn("-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
            value === t.id ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>
          {t.icon}{t.label}{!!t.badge && <span className="rounded-full bg-danger px-1.5 text-[10px] text-white">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

export const Stat = ({ label, value, hint, icon }: { label: string; value: React.ReactNode; hint?: string; icon?: React.ReactNode }) => (
  <Card><CardBody className="flex items-start justify-between">
    <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>{hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}</div>
    {icon && <span className="text-muted-foreground">{icon}</span>}
  </CardBody></Card>
);
