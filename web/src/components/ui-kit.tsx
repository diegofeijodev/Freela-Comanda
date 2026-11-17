import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold md:text-3xl">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, delta, hint }: { label: string; value: ReactNode; delta?: number | null; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {delta != null && isFinite(delta) && (
        <div className={cn("mt-1 text-xs", delta >= 0 ? "text-success" : "text-destructive")}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs período anterior
        </div>
      )}
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function Panel({ title, children, className, actions, vivo }: { title?: string; children: ReactNode; className?: string; actions?: ReactNode; vivo?: boolean }) {
  return (
    <section className={cn("rounded-xl border bg-card p-4", className)}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="font-sans text-sm font-semibold uppercase tracking-wide text-muted-foreground" aria-live={vivo ? "polite" : undefined}>{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{children}</div>;
}

const BADGE: Record<string, string> = {
  ok: "bg-success/15 text-success",
  bad: "bg-destructive/15 text-destructive",
  warn: "bg-warning/15 text-warning",
  gold: "bg-primary/15 text-primary",
  muted: "bg-muted text-muted-foreground",
};
export function Tag({ tone = "muted", children }: { tone?: keyof typeof BADGE; children: ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", BADGE[tone])}>{children}</span>;
}

export const STATUS_INV: Record<string, { label: string; tone: keyof typeof BADGE }> = {
  aberto: { label: "Aberto", tone: "gold" },
  em_contagem: { label: "Em contagem", tone: "warn" },
  aguardando_aprovacao: { label: "Aguardando aprovação", tone: "gold" },
  fechado: { label: "Fechado", tone: "muted" },
};
export const STATUS_LISTA: Record<string, { label: string; tone: keyof typeof BADGE }> = {
  gerada: { label: "Gerada", tone: "gold" },
  enviada: { label: "Enviada ao fornecedor", tone: "warn" },
  recebida_parcial: { label: "Recebida parcial", tone: "warn" },
  recebida: { label: "Recebida", tone: "ok" },
};
