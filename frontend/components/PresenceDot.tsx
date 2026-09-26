export function PresenceDot({ online, className }: { online: boolean; className?: string }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-bg-navy ${
        online ? "bg-success" : "bg-slate-600"
      } ${className || ""}`}
      role="status"
      aria-label={online ? "Online" : "Offline"}
    />
  );
}
