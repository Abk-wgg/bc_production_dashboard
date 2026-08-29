import type { Metadata } from "next";
import Nav from "@/components/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Production board",
  description: "Read-only view of Business Central production orders",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <header className="site-header">
          <span className="brand">Production board</span>
          <Nav />
        </header>
        {children}
      </body>
    </html>
  );
}
