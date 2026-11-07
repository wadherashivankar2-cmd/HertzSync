import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TrickleSettle Operator Console",
  description: "Reliability layer between business events and Solana DevNet",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-[#0F172A] text-[#F1F5F9]">
        {children}
      </body>
    </html>
  );
}

