export function buildWebSocketUrl(token: string, projectId: number): string {
  const configured = process.env.NEXT_PUBLIC_WS_BASE;
  if (configured) {
    const separator = configured.includes("?") ? "&" : "?";
    return `${configured}${separator}token=${encodeURIComponent(token)}&project_id=${projectId}`;
  }

  if (typeof window === "undefined") {
    return "";
  }

  const apiBase = process.env.NEXT_PUBLIC_API_BASE;
  if (apiBase && apiBase.startsWith("http")) {
    const url = new URL(apiBase);
    const wsProtocol = url.protocol === "https:" ? "wss" : "ws";
    return `${wsProtocol}://${url.host}/ws?token=${encodeURIComponent(token)}&project_id=${projectId}`;
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/ws?token=${encodeURIComponent(token)}&project_id=${projectId}`;
}
