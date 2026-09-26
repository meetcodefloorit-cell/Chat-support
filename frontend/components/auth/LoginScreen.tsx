"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { login } from "@/lib/api";
import { clearSession, getToken, getUser, saveSession, getDashboardPath } from "@/lib/auth";
import { parseError } from "@/lib/parseError";
import { UserRole } from "@/lib/types";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Tone } from "@/components/ui/Button";
import { GlowBackground } from "@/components/ui/GlowBackground";
import { HeadsetIcon, AlertTriangleIcon } from "@/components/ui/icons";

interface RoleConfig {
  tone: Tone;
  title: string;
  subtitle: string;
  accessLabel: string;
  identifierLabel: string;
  identifierType: "email" | "text";
  identifierPlaceholder: string;
  glow: string;
  iconGradient: string;
  icon: React.ReactNode;
}

const shieldIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-7 h-7">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
    />
  </svg>
);

const memberIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-7 h-7">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
    />
  </svg>
);

const configs: Record<UserRole, RoleConfig> = {
  ADMIN: {
    tone: "admin",
    title: "Admin Panel",
    subtitle: "Full system control and management",
    accessLabel: "Administrator Access",
    identifierLabel: "Email",
    identifierType: "email",
    identifierPlaceholder: "admin@company.com",
    glow: "shadow-glow-admin",
    iconGradient: "from-admin to-admin-dark",
    icon: shieldIcon,
  },
  OPERATOR: {
    tone: "operator",
    title: "Operator Panel",
    subtitle: "Manage members and handle support chats",
    accessLabel: "Operator Access",
    identifierLabel: "Email or access ID",
    identifierType: "text",
    identifierPlaceholder: "email@company.com or 8-digit ID",
    glow: "shadow-glow-operator",
    iconGradient: "from-operator to-operator-dark",
    icon: <HeadsetIcon className="w-7 h-7" />,
  },
  MEMBER: {
    tone: "member",
    title: "Member Panel",
    subtitle: "Connect with your support team",
    accessLabel: "Member Access",
    identifierLabel: "Email or access ID",
    identifierType: "text",
    identifierPlaceholder: "email@company.com or 8-digit ID",
    glow: "shadow-glow-member",
    iconGradient: "from-member to-member-dark",
    icon: memberIcon,
  },
};

const roleNoun: Record<UserRole, string> = {
  ADMIN: "an Admin",
  OPERATOR: "an Operator",
  MEMBER: "a Member",
};

export function LoginScreen({ role }: { role: UserRole }) {
  const router = useRouter();
  const config = configs[role];

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const user = getUser();
    const token = getToken();
    if (token && user) {
      if (user.role === role) {
        router.replace(getDashboardPath(user));
      } else {
        // Different role is logged in; force a fresh login for this panel.
        clearSession();
      }
    }
  }, [router, role]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const payload = await login(identifier, password);
      if (payload.user.role !== role) {
        setError(`This account is not ${roleNoun[role]}. Please use the correct panel.`);
        setLoading(false);
        return;
      }
      saveSession(payload);
      router.replace(getDashboardPath(payload.user));
    } catch (err) {
      setError(parseError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative min-h-screen flex items-center justify-center p-4">
      <GlowBackground />
      <div className="relative z-10 w-full max-w-md animate-fade-in">
        <div className="text-center mb-8">
          <div
            className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br ${config.iconGradient} text-white mb-4 ${config.glow}`}
          >
            {config.icon}
          </div>
          <h1 className="text-2xl font-bold text-white">{config.title}</h1>
          <p className="text-slate-400 mt-1 text-sm">{config.subtitle}</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl shadow-soft-lg overflow-hidden">
          <div className={`bg-gradient-to-r ${config.iconGradient} px-6 py-3`}>
            <p className="text-white/90 text-sm font-medium text-center">{config.accessLabel}</p>
          </div>

          <form onSubmit={onSubmit} className="p-6 space-y-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">{config.identifierLabel}</label>
              <Input
                type={config.identifierType}
                tone={config.tone}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                placeholder={config.identifierPlaceholder}
                autoComplete="username"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">Password</label>
              <Input
                type="password"
                tone={config.tone}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 bg-danger-light border border-danger/30 text-red-300 rounded-lg px-3.5 py-2.5 text-sm">
                <AlertTriangleIcon className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" tone={config.tone} loading={loading} fullWidth size="lg">
              {loading ? "Signing in…" : `Sign in as ${role.charAt(0) + role.slice(1).toLowerCase()}`}
            </Button>
          </form>
        </div>

        <div className="text-center mt-6">
          <Link href="/" className="text-sm text-slate-500 hover:text-slate-300 transition-colors">
            Back to panel selection
          </Link>
        </div>
      </div>
    </main>
  );
}
