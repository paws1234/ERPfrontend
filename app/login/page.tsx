/**
 * T-7.WEB.01 — the sign-in screen: the way in, and the reason the browser is standing here.
 *
 * Rendered on the server, because what it shows is decided by the session the backend
 * acknowledges rather than by anything the browser says about itself: no cookie, a cookie that
 * has been revoked, a session that still owes a second factor, and a session that is complete
 * are four different screens. The screen holds no form state of its own — the two steps are
 * `./form`, which cannot reach the backend at all.
 *
 * A reason in the query string is why the browser arrived (`?reason=expired`, `mfa`,
 * `signed_out`), and it is printed rather than assumed, so a session that ended says so instead
 * of looking like a first visit.
 */

import type { CSSProperties } from "react";

import { readSessionState, signInNotice } from "@/lib/session";

import { signOutAction } from "../session-actions";
import { SecondFactorForm, SignInForm } from "./form";

// Who is signed in is a fact about this request: never cached at build.
export const dynamic = "force-dynamic";

const QUIET: CSSProperties = {
  padding: "0.2rem 0.5rem",
  border: "1px solid #c9ced6",
  borderRadius: 4,
  background: "transparent",
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
};

function Notice({ children }: { children: string }) {
  return (
    <div
      style={{
        border: "1px solid #d9a300",
        background: "#fff8e6",
        padding: "0.75rem 1rem",
        borderRadius: 6,
        marginBottom: "1rem",
      }}
    >
      {children}
    </div>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string | string[] }>;
}) {
  const stated = (await searchParams).reason;
  const state = await readSessionState();
  // What the backend said about the cookie it was given, or what the redirect said about why the
  // session went: either way this is the sentence at the top of the screen. The notice a reason
  // states is the more useful one — it knows *why* the browser is here.
  const notice =
    signInNotice(Array.isArray(stated) ? stated[0] : stated) ??
    (state.status === "ready" ? null : state.status === "none" ? null : state.message);
  // A session that is complete has nothing to do here; one that owes a second factor has exactly
  // one thing to do, and it is not typing a password again.
  const owesSecondFactor = state.status === "mfa" || (state.status === "ready" && state.session.mfa_pending);

  return (
    <section>
      <h1 style={{ marginBottom: 0 }}>Sign in</h1>
      <p style={{ color: "#5b6470" }}>
        {state.status === "ready" && !state.session.mfa_pending
          ? `Signed in as ${state.session.display_name ?? state.session.login}, acting in ${state.session.company}.`
          : "The platform answers nothing about a company until it knows who is asking."}
      </p>

      {notice === null ? null : <Notice>{notice}</Notice>}

      {owesSecondFactor ? (
        <>
          <p style={{ color: "#5b6470" }}>
            One step left: this session owes a second factor, and every other screen refuses it
            until the code is answered.
          </p>
          <SecondFactorForm />
        </>
      ) : null}

      {owesSecondFactor ? null : state.status === "ready" ? (
        <p>
          <a href="/" style={{ color: "#1d4ed8" }}>
            Go to the ledger
          </a>
        </p>
      ) : (
        <SignInForm />
      )}

      {state.status === "none" ? null : (
        <form action={signOutAction} style={{ marginTop: "1.25rem" }}>
          <button type="submit" style={QUIET}>
            Sign out of this browser
          </button>
        </form>
      )}
    </section>
  );
}
