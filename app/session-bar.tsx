"use client";

/**
 * T-7.WEB.01 — who the shell is signed in as, and the two things that change it.
 *
 * A client component for one reason: a refusal has to be able to appear where the form is. It
 * holds no identity of its own — it is handed the name, the company and the companies the
 * person may act in, and its only reach across the network is the two server actions, which
 * change the session on the server and re-read every screen from it.
 */

import { useActionState } from "react";
import type { CSSProperties } from "react";

import { signOutAction, switchCompanyAction, type SwitchState } from "./session-actions";

const SELECT: CSSProperties = {
  padding: "0.15rem 0.3rem",
  border: "1px solid #4b5158",
  borderRadius: 4,
  background: "#16181d",
  color: "inherit",
  font: "inherit",
  fontSize: "0.85rem",
};

const QUIET: CSSProperties = {
  padding: "0.15rem 0.5rem",
  border: "1px solid #4b5158",
  borderRadius: 4,
  background: "transparent",
  color: "inherit",
  font: "inherit",
  fontSize: "0.85rem",
  cursor: "pointer",
};

const WHO: CSSProperties = {
  color: "#c9ced6",
  fontSize: "0.85rem",
};

export function SessionBar({
  login,
  displayName,
  company,
  companies,
  mustChangePassword,
}: {
  login: string;
  displayName: string | null;
  company: string;
  companies: string[];
  mustChangePassword: boolean;
}) {
  const [switched, switchTo, switching] = useActionState<SwitchState | null, FormData>(
    switchCompanyAction,
    null,
  );
  return (
    <>
      <span style={WHO}>
        {displayName ?? login} · {company}
      </span>
      {mustChangePassword ? (
        <span style={{ ...WHO, color: "#f5c2c2" }}>password change due</span>
      ) : null}
      {companies.length > 1 ? (
        <form action={switchTo} style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
          <label htmlFor="company-to-act-in" style={WHO}>
            Act in
          </label>
          <select
            id="company-to-act-in"
            name="company"
            defaultValue={company}
            style={SELECT}
            disabled={switching}
          >
            {companies.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          <button type="submit" style={QUIET} disabled={switching}>
            {switching ? "Switching…" : "Switch"}
          </button>
        </form>
      ) : null}
      <form action={signOutAction}>
        <button type="submit" style={QUIET}>
          Sign out
        </button>
      </form>
      {switched === null || switched.message === null ? null : (
        <span role="status" style={WHO}>
          {switched.message}
        </span>
      )}
    </>
  );
}
