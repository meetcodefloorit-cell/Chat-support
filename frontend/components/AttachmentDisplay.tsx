"use client";

import { useEffect, useState } from "react";
import { fetchAttachment } from "@/lib/api";
import { Skeleton } from "@/components/ui/Skeleton";
import { PaperclipIcon } from "@/components/ui/icons";
import { Tone } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

interface AttachmentDisplayProps {
  url: string;
  filename?: string | null;
  mime?: string | null;
  token: string | null;
  isMe?: boolean;
  tone?: Tone;
  className?: string;
}

const toneLinkColor: Record<Tone, string> = {
  admin: "text-admin hover:text-admin-dark",
  operator: "text-operator hover:text-operator-dark",
  member: "text-member hover:text-member-dark",
  neutral: "text-slate-300 hover:text-white",
  danger: "text-danger hover:text-red-700",
};

export function AttachmentImage({ url, token, className }: Omit<AttachmentDisplayProps, "filename" | "mime" | "isMe" | "tone">) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!token || !url) return;
    const isSecure = url.includes("/attachments/");
    if (!isSecure) {
      const base = process.env.NEXT_PUBLIC_API_BASE || "/api";
      setBlobUrl(url.startsWith("http") ? url : `${base.replace(/\/$/, "")}${url.startsWith("/") ? url : `/${url}`}`);
      return;
    }
    let revoked = false;
    let objectUrl: string | null = null;
    fetchAttachment(token, url)
      .then((u) => {
        if (!revoked) { objectUrl = u; setBlobUrl(u); }
        else URL.revokeObjectURL(u);
      })
      .catch(() => { if (!revoked) setError(true); });
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, url]);

  if (error) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
        <PaperclipIcon className="h-3.5 w-3.5" /> Failed to load image
      </span>
    );
  }
  if (!blobUrl) return <Skeleton className={className || "h-24 w-24"} />;
  return (
    <a href={blobUrl} target="_blank" rel="noopener noreferrer" className="block">
      <img
        src={blobUrl}
        alt="Attachment"
        className={cn("max-h-48 max-w-full rounded-xl border border-black/5", className)}
      />
    </a>
  );
}

export function AttachmentLink({
  url,
  filename,
  token,
  isMe,
  tone = "operator",
  className,
}: Omit<AttachmentDisplayProps, "mime">) {
  const handleClick = async (e: React.MouseEvent) => {
    if (!token || !url) return;
    const isSecure = url.includes("/attachments/");
    if (isSecure) {
      e.preventDefault();
      try {
        const u = await fetchAttachment(token, url);
        const a = document.createElement("a");
        a.href = u;
        a.download = filename || "attachment";
        a.click();
        URL.revokeObjectURL(u);
      } catch {
        const base = process.env.NEXT_PUBLIC_API_BASE || "/api";
        window.open(url.startsWith("http") ? url : `${base.replace(/\/$/, "")}${url.startsWith("/") ? url : `/${url}`}`, "_blank");
      }
    }
  };

  const content = (
    <>
      <PaperclipIcon className="h-3.5 w-3.5 shrink-0" />
      <span className="underline">{filename || "Attachment"}</span>
    </>
  );

  if (!url.includes("/attachments/")) {
    const base = process.env.NEXT_PUBLIC_API_BASE || "/api";
    const href = url.startsWith("http") ? url : `${base.replace(/\/$/, "")}${url.startsWith("/") ? url : `/${url}`}`;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn("inline-flex items-center gap-1.5 text-sm", toneLinkColor[tone], className)}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 text-left text-sm",
        isMe ? "text-white/90 hover:text-white" : toneLinkColor[tone],
        className,
      )}
    >
      {content}
    </button>
  );
}
