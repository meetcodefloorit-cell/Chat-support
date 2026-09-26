import { cn } from "@/lib/cn";

/**
 * Fixed, pointer-events-none decorative backdrop for full-screen hero compositions (landing,
 * logins): two large soft diagonal glow swooshes in opposite corners plus two sparse dot-grid
 * patches — matches the reference login's deep-navy/electric-blue visual language. Intentionally
 * NOT used inside dense app shells (dashboards) to avoid competing with real content.
 */
export function GlowBackground({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none fixed inset-0 overflow-hidden bg-bg-deep", className)}
    >
      {/* top-left swoosh */}
      <div className="absolute -top-40 -left-40 h-[32rem] w-[32rem] rounded-full bg-gradient-to-br from-operator/30 via-operator-dark/10 to-transparent blur-3xl" />
      {/* bottom-right swoosh */}
      <div className="absolute -bottom-48 -right-32 h-[36rem] w-[36rem] rounded-full bg-gradient-to-tl from-operator-dark/30 via-member/10 to-transparent blur-3xl" />
      {/* soft center glow behind hero content */}
      <div className="absolute left-1/2 top-0 h-[28rem] w-[40rem] -translate-x-1/2 rounded-full bg-operator/10 blur-3xl" />

      {/* dot-grid accents */}
      <div
        className="bg-dot-grid absolute right-8 top-8 h-32 w-32 opacity-40"
        style={{ maskImage: "radial-gradient(circle, black, transparent 75%)" }}
      />
      <div
        className="bg-dot-grid absolute bottom-8 left-8 h-32 w-32 opacity-40"
        style={{ maskImage: "radial-gradient(circle, black, transparent 75%)" }}
      />
    </div>
  );
}
