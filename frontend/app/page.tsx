"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { getUser, getDashboardPath } from "@/lib/auth";
import { GlowBackground } from "@/components/ui/GlowBackground";
import { Badge } from "@/components/ui/Badge";
import { HeadsetIcon, ChevronRightIcon, ZapIcon, ShieldCheckIcon, UsersIcon } from "@/components/ui/icons";

// Main panel: Admin and Operator only. Members use direct link from operator (e.g. /member/15121519).
const panels = [
  {
    role: "Admin",
    path: "/admin/login",
    desc: "Manage projects, operators, users and broadcasts.",
    tone: "admin" as const,
    access: "Full Access",
    accessColor: "emerald" as const,
    icon: <ShieldCheckIcon className="h-6 w-6" />,
  },
  {
    role: "Operator",
    path: "/operator/login",
    desc: "Handle live conversations across your assigned projects.",
    tone: "operator" as const,
    access: "Team Access",
    accessColor: "blue" as const,
    icon: <HeadsetIcon className="h-6 w-6" />,
  },
];

const highlights = [
  { icon: <ZapIcon className="h-4 w-4" />, label: "Real-time Chat", desc: "Instant communication", tone: "admin" as const },
  { icon: <ShieldCheckIcon className="h-4 w-4" />, label: "Secure & Reliable", desc: "Your data, our priority", tone: "admin" as const },
  { icon: <UsersIcon className="h-4 w-4" />, label: "Better Support", desc: "Happier customers", tone: "operator" as const },
];

const toneIconBg: Record<"admin" | "operator", string> = {
  admin: "bg-gradient-to-br from-admin to-admin-dark shadow-glow-admin",
  operator: "bg-gradient-to-br from-operator to-operator-dark shadow-glow-operator",
};

const toneCardBorder: Record<"admin" | "operator", string> = {
  admin: "border-admin/25 hover:border-admin/40 hover:shadow-glow-admin",
  operator: "border-operator/25 hover:border-operator/40 hover:shadow-glow-operator",
};

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const user = getUser();
    if (user) {
      router.replace(getDashboardPath(user));
    }
  }, [router]);

  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center overflow-y-auto p-6">
      <GlowBackground />

      <div className="relative z-10 flex flex-col items-center text-center animate-fade-in">
        <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-2xl border border-operator/30 bg-gradient-to-br from-bg-navy-elevated to-bg-navy text-operator shadow-glow-operator">
          <HeadsetIcon className="h-9 w-9" />
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
          <span className="text-white">Chat </span>
          <span className="bg-gradient-to-r from-operator to-member bg-clip-text text-transparent">
            Support
          </span>
        </h1>
        <p className="mt-3 text-sm text-slate-400">Sign in to continue</p>
        <div className="mt-4 h-0.5 w-24 rounded-full bg-gradient-to-r from-operator to-member" />
      </div>

      <div className="relative z-10 mt-10 grid w-full max-w-3xl grid-cols-1 gap-5 sm:grid-cols-2">
        {panels.map((panel, i) => (
          <Link
            key={panel.role}
            href={panel.path}
            style={{ animationDelay: `${i * 80}ms` }}
            className={`group relative flex animate-fade-in flex-col rounded-2xl border bg-white/[0.03] p-6 backdrop-blur-xl outline-none transition-all duration-300 hover:-translate-y-1 focus-visible:-translate-y-1 ${toneCardBorder[panel.tone]}`}
          >
            <div className="flex items-center justify-between">
              <div className={`flex h-12 w-12 items-center justify-center rounded-full text-white ${toneIconBg[panel.tone]}`}>
                {panel.icon}
              </div>
              <Badge color={panel.accessColor} dot>
                {panel.access}
              </Badge>
            </div>
            <h2 className="mt-5 text-2xl font-bold text-white">{panel.role}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{panel.desc}</p>
            <div
              className={`mt-6 flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all group-hover:brightness-110 ${toneIconBg[panel.tone]}`}
            >
              Sign In
              <ChevronRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </div>
          </Link>
        ))}
      </div>

      <div className="relative z-10 mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
        {highlights.map((h, i) => (
          <div key={h.label} className="flex items-center gap-6">
            {i > 0 && <div className="hidden h-8 w-px bg-white/10 sm:block" />}
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-operator">
                {h.icon}
              </span>
              <div className="text-left">
                <div className="text-xs font-semibold text-slate-200">{h.label}</div>
                <div className="text-[11px] text-slate-500">{h.desc}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
