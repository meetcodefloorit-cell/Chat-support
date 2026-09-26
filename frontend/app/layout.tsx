import "./globals.css";
import { ReactNode } from "react";
import { Inter } from "next/font/google";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata = {
  title: "Chat Support",
  description: "Multi-project real-time support system",
};

export const viewport = {
  themeColor: "#111827",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="antialiased font-sans">
        <ConfirmProvider>{children}</ConfirmProvider>
      </body>
    </html>
  );
}
