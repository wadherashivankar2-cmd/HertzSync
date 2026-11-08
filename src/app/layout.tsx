import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HertzSync Operator Console",
  description: "Reliability layer between business events and Solana DevNet",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var saved = localStorage.getItem('hertzsync-theme') || localStorage.getItem('tricklesettle-theme');
                  var theme = saved;
                  if (!theme) {
                    theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
                  }
                  if (theme === 'light') {
                    document.documentElement.setAttribute('data-theme', 'light');
                    document.documentElement.classList.add('light');
                  } else {
                    document.documentElement.setAttribute('data-theme', 'dark');
                    document.documentElement.classList.remove('light');
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="antialiased min-h-screen bg-bg text-text selection:bg-[var(--accent)] selection:text-[var(--accent-text)]">
        {/* Role 2 decorative background fade: covers bottom 28% of viewport, pointer-events none */}
        <div
          id="role2-fade"
          className="fixed inset-x-0 bottom-0 h-[28vh] pointer-events-none z-0"
          aria-hidden="true"
          style={{ background: "linear-gradient(to top, var(--role2-fade), transparent)" }}
        />
        <div className="relative z-10 box-border w-full max-w-full">{children}</div>
      </body>
    </html>
  );
}
