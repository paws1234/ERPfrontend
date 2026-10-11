import type { Metadata } from "next";
import type { ReactNode } from "react";

import { readSessionState } from "@/lib/session";

import { SessionBar } from "./session-bar";

export const metadata: Metadata = {
  title: "ERP",
  description: "Modular ERP platform — accounting, inventory, supply chain, sales, HR",
};

/**
 * The shell around every screen: the same header, and — read from the session the backend
 * acknowledges, never from anything the browser states about itself — who is signed in and in
 * which company they are acting.
 *
 * A request with no usable session is not an error here: the header says "Sign in" and each
 * screen says what it could not read. Nothing is asked of the backend for a browser that has
 * no cookie yet.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const state = await readSessionState();

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
          <nav style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
            <a href="/" style={{ color: "inherit" }}>
              Ledger
            </a>
            {state.status === "ready" ? (
              <SessionBar
                login={state.session.login}
                displayName={state.session.display_name ?? null}
                company={state.session.company}
                companies={state.session.companies}
                mustChangePassword={state.session.must_change_password}
              />
            ) : (
              <a href="/login" style={{ color: "inherit" }}>
                Sign in
              </a>
            )}
          </nav>
        </header>
        <main style={{ padding: "1.5rem", maxWidth: 960, margin: "0 auto" }}>{children}</main>
      </body>
    </html>
  );
}
