/**
 * T-7.WEB.01 — the session the shell speaks with.
 *
 * The platform's identity is a cookie, not a header this process asserts about itself:
 * `erpv1_session` is `HttpOnly`, so only the server ever reads it, and the backend resolves
 * the caller, the company they are acting in and their capabilities from the row behind it.
 * This module is the frontend's whole side of that:
 *
 * * `sessionCookie()` reads the incoming request's cookie — `next/headers`, the only place in
 *   this repository that imports it — and builds the `Cookie` header `./api` forwards. An
 *   empty string is "no session", and every route answers that with 401.
 * * `signIn`, `verifyMfa`, `switchCompany` and `signOut` are the four transitions, each called
 *   from a server action (`app/session-actions.ts`) so that a cookie the backend sets is
 *   written to the **browser**, never to the component that asked.
 * * `sessionFailure` is what a page does with a refusal, so a session that expired or was
 *   revoked lands on the sign-in screen with the reason — not on a blank page, and not on a
 *   stack trace — and a session that still owes a second factor lands on the prompt.
 *
 * Nothing here is reachable from the browser: the module reads `next/headers`, which is what
 * makes Next refuse to bundle it into a client component, and no value it holds is ever
 * prefixed with the platform's public-bundle marker.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  apiBaseUrl,
  describeFailure,
  MfaRequired,
  refusal,
  request,
  Unauthenticated,
  type Session,
  type SessionCookie,
} from "./api";

/** The cookie the backend mints: HttpOnly, SameSite=Lax, Secure behind TLS. */
export const SESSION_COOKIE = "erpv1_session";

/** Why the browser is standing on the sign-in screen. */
export type SignInReason = "expired" | "mfa" | "signed_out";

/** The one sentence a reason prints, or `null` for an ordinary visit. */
export function signInNotice(reason: string | undefined): string | null {
  switch (reason) {
    case "expired":
      return "Your session ended or was revoked. Sign in to carry on.";
    case "mfa":
      return "This session still owes a second factor. Enter the code to finish signing in.";
    case "signed_out":
      return "You have been signed out.";
    default:
      return null;
  }
}

/** Where the sign-in screen lives, with the reason attached. */
export function signInHref(reason?: SignInReason): string {
  return reason ? `/login?reason=${reason}` : "/login";
}

/** Send the browser to the sign-in screen, with the reason. Never returns. */
export function redirectToSignIn(reason?: SignInReason): never {
  redirect(signInHref(reason));
}

/**
 * What a page does with a failure. A refusal that means "there is no usable session here"
 * is not rendered as a notice: the browser is sent to the sign-in screen and told why, which
 * is the one way back. Everything else — a 403, a domain refusal — keeps the shell standing.
 */
export function sessionFailure(error: unknown): { title: string; detail: string } {
  if (error instanceof Unauthenticated) redirectToSignIn("expired");
  if (error instanceof MfaRequired) redirectToSignIn("mfa");
  return describeFailure(error);
}

/** The `Cookie` header for this request, or `""` when it carries no session. */
export async function sessionCookie(): Promise<SessionCookie> {
  const store = await cookies();
  const value = store.get(SESSION_COOKIE)?.value ?? "";
  return value === "" ? "" : `${SESSION_COOKIE}=${value}`;
}

/**
 * What the shell could learn about the request's session, without throwing. Four states, kept
 * apart on purpose: "nobody claimed to be anyone", "a session that is usable", "a session that
 * still owes a second factor" and "a cookie the backend will not take" are answered by four
 * different screens, and collapsing the last two into "not signed in" would send someone with a
 * half-finished sign-in back to a password form they have already passed.
 */
export type SessionState =
  /** No cookie was sent at all. */
  | { status: "none"; cookie: "" }
  /** A session the backend acknowledges. */
  | { status: "ready"; cookie: SessionCookie; session: Session }
  /** A session that exists and still owes a second factor: every other route refuses it. */
  | { status: "mfa"; cookie: SessionCookie; message: string }
  /** The cookie names nothing the backend accepts: expired, revoked, or never issued. */
  | { status: "refused"; cookie: SessionCookie; message: string };

/**
 * Read the session as the backend sees it — a revoked cookie reads as no session, which is the
 * point of asking the backend rather than trusting the browser. Never throws: a screen that
 * cannot be told who is there renders the sign-in screen, not a stack trace.
 */
export async function readSessionState(): Promise<SessionState> {
  const cookie = await sessionCookie();
  if (cookie === "") return { status: "none", cookie: "" };
  try {
    const session = await request<Session>("/api/v1/auth/session", cookie);
    return { status: "ready", cookie, session };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // `mfa_required` is not "no session": the cookie is good and the sign-in is half done.
    return error instanceof MfaRequired
      ? { status: "mfa", cookie, message }
      : { status: "refused", cookie, message };
  }
}

/**
 * Sign in. Called from a server action alone: `cookies()` is writable there and nowhere a
 * page renders, which is exactly where the backend's `Set-Cookie` has to be forwarded.
 *
 * A session that owes a second factor is **returned**, not thrown — `mfa_pending` is a state
 * the sign-in screen has a prompt for, and the cookie that carries it is already set.
 */
export async function signIn(
  login: string,
  password: string,
  company?: string,
): Promise<Session> {
  const response = await fetch(`${apiBaseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // A blank company is omitted, not sent empty: the backend needs it only when the person
    // works in several, and it says so by refusing rather than by guessing.
    body: JSON.stringify({
      login,
      password,
      ...(company === undefined || company === "" ? {} : { company }),
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    // A failed sign-in leaves no half-session behind: whatever cookie the browser arrived
    // with is not one this form can vouch for.
    await forget();
    throw await refusal(response);
  }
  await remember(response);
  return (await response.json()) as Session;
}

/** Answer the second factor a sign-in still owes. The cookie already names the session. */
export async function verifyMfa(code: string): Promise<Session> {
  return request<Session>("/api/v1/auth/mfa/verify", await sessionCookie(), {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

/** Act in another company the caller is a member of. The session names it from here on. */
export async function switchCompany(company: string): Promise<Session> {
  return request<Session>("/api/v1/auth/company", await sessionCookie(), {
    method: "POST",
    body: JSON.stringify({ company }),
  });
}

/**
 * Sign out: the backend revokes the session row, and the browser's copy goes either way — a
 * browser that cannot reach the platform must still be able to leave it.
 */
export async function signOut(): Promise<void> {
  const cookie = await sessionCookie();
  try {
    if (cookie !== "") {
      await fetch(`${apiBaseUrl}/api/v1/auth/logout`, {
        method: "POST",
        headers: { Cookie: cookie },
        cache: "no-store",
      });
    }
  } catch {
    // Unreachable platform: the row expires on its own. The browser is signed out regardless.
  }
  await forget();
}

/**
 * Write the backend's `Set-Cookie` to the browser, with the value and lifetime it stated and
 * the attributes that keep it out of reach of scripts.
 */
async function remember(response: Response): Promise<void> {
  const stated = response.headers
    .getSetCookie()
    .find((line) => line.startsWith(`${SESSION_COOKIE}=`));
  if (stated === undefined) return;
  const [pair, ...attributes] = stated.split(";");
  const value = pair.slice(pair.indexOf("=") + 1);
  const maxAge = attributes
    .map((attribute) => attribute.trim())
    .find((attribute) => attribute.toLowerCase().startsWith("max-age="));
  const store = await cookies();
  store.set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    // The deployment terminates TLS; plain-http development is the one place this is off.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(maxAge === undefined ? {} : { maxAge: Number(maxAge.slice("max-age=".length)) }),
  });
}

/** Drop the browser's copy of the session cookie. */
async function forget(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
