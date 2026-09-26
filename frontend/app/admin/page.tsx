"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { getToken, getUser, getDashboardPath } from "@/lib/auth";
import { SpinnerIcon } from "@/components/ui/icons";

/** Redirect /admin to /admin/login or dashboard. */
export default function AdminPage() {
  const router = useRouter();

  useEffect(() => {
    const user = getUser();
    const token = getToken();
    if (token && user && user.role === "ADMIN") {
      router.replace(getDashboardPath(user));
    } else {
      router.replace("/admin/login");
    }
  }, [router]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg-deep">
      <div className="flex items-center gap-2.5 text-slate-400">
        <SpinnerIcon className="h-4 w-4 animate-spin text-admin" />
        <p className="text-sm">Redirecting…</p>
      </div>
    </main>
  );
}
