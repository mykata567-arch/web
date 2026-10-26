import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "小五易错字 · 一家人，一本字",
  description: "记录易错字，每天听写一点点。全家共用，自动安排复习。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
