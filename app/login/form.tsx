"use client";

/**
 * T-7.WEB.01 — the sign-in form's two steps, and nothing else.
 *
 * A client component because the second step is decided by what the first one answered: the
 * same form asks for a login and a password, and then — when the backend says the session owes
 * a second factor — for the code that finishes it. What it may **not** do is talk to the
 * backend: it holds no cookie and imports no client (`lib/api` is not reachable from here, and
 * `lib/session` would not bundle), so its only way across the network is the two server actions
 * below, which write the cookie on the server's side of the wire.
 */

import { useActionState } from "react";
import type { CSSProperties } from "react";

import { signInAction, verifyMfaAction, type SignInState } from "../session-actions";

const FIELD: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.2rem",
  marginBottom: "0.6rem",
};

const LABEL: CSSProperties = {
  color: "#5b6470",
  fontSize: "0.85rem",
};

const INPUT: CSSProperties = {
  padding: "0.4rem 0.5rem",
  border: "1px solid #c9ced6",
  borderRadius: 4,
  font: "inherit",
};

const BUTTON: CSSProperties = {
  padding: "0.45rem 0.9rem",
  border: "1px solid #16181d",
  borderRadius: 4,
  background: "#16181d",
  color: "#f6f7f9",
  font: "inherit",
  cursor: "pointer",
};

/** What the form was told, as an alert rather than as a quietly appearing line. */
function Refused({ message }: { message: string | null }) {
  if (message === null) {
    return null;
  }
  return (
    <p role="alert" style={{ color: "#8a1c1c", margin: "0.5rem 0 0", fontSize: "0.9rem" }}>
      {message}
    </p>
  );
}

/** The code that finishes a sign-in the backend says owes a second factor. */
export function SecondFactorForm({ message = null }: { message?: string | null }) {
  const [state, verify, pending] = useActionState<SignInState | null, FormData>(
    verifyMfaAction,
    null,
  );
  return (
    <form action={verify} style={{ maxWidth: 320 }}>
      <div style={FIELD}>
        <label htmlFor="code" style={LABEL}>
          Authenticator code, or a recovery code
        </label>
        <input id="code" name="code" autoComplete="one-time-code" required style={INPUT} />
      </div>
      <button type="submit" style={BUTTON} disabled={pending}>
        {pending ? "Checking…" : "Verify"}
      </button>
      <Refused message={state?.message ?? message} />
    </form>
  );
}

/** The credentials, and — when the backend answers that one is owed — the code after them. */
export function SignInForm() {
  const [state, submit, pending] = useActionState<SignInState | null, FormData>(
    signInAction,
    null,
  );
  if (state?.stage === "mfa") {
    return <SecondFactorForm message={state.message} />;
  }
  return (
    <form action={submit} style={{ maxWidth: 320 }}>
      <div style={FIELD}>
        <label htmlFor="login" style={LABEL}>
          Login
        </label>
        <input id="login" name="login" autoComplete="username" required style={INPUT} />
      </div>
      <div style={FIELD}>
        <label htmlFor="password" style={LABEL}>
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          style={INPUT}
        />
      </div>
      <div style={FIELD}>
        <label htmlFor="company" style={LABEL}>
          Company — only if you work in several
        </label>
        <input id="company" name="company" autoComplete="off" style={INPUT} />
      </div>
      <button type="submit" style={BUTTON} disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <Refused message={state?.message ?? null} />
    </form>
  );
}
