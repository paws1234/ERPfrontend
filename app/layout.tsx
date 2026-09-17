import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "ERP",
  description: "Modular ERP platform — accounting, inventory, supply chain, sales, HR",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, sans-serif",
          background: "#f6f7f9",
          color: "#16181d",
        }}
      >
        <header
          style={{
            padding: "0.75rem 1.5rem",
            background: "#16181d",
            color: "#f6f7f9",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <strong>ERP</strong>
          <nav style={{ display: "flex", gap: "1rem" }}>
            <a href="/" style={{ color: "inherit" }}>
              Ledger
            </a>
          </nav>
        </header>
        <main style={{ padding: "1.5rem", maxWidth: 960, margin: "0 auto" }}>{children}</main>
      </body>
    </html>
  );
}
