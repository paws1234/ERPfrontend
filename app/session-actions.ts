"use server";

/**
 * T-7.WEB.01 — the session's transitions, as server actions.
 *
 * These are the only places the browser can change who it is, and they are server actions for
 * the reason every other write in this repository is one: the session cookie is `HttpOnly`, so
 * the browser never holds the identity the backend trusts and never sets it itself — it asks
 * the server to, and the server writes the cookie the backend minted onto the response
 * (`lib/session`).
 *
 * Each action answers with a sentence rather than throwing, so a wrong password, an expired
 * code and an unreachable platform all arrive on the form as words. The one exception is
 * success: signing in, finishing a second factor and signing out all move the browser, so they
 * `redirect()` — after the `try`, never inside it, so a redirect is not mistaken for a failure.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { describeFailure, MfaRequired } from "@/lib/api";
import { signIn, signInHref, signOut, switchCompany, verifyMfa } from "@/lib/session";

/** What the sign-in form is waiting for: the next thing to ask, and what to say. */
export interface SignInState {
  /** `credentials` until the backend states that a second factor is owed. */
  stage: "credentials" | "mfa";
  /** The sentence to show, or `null` for nothing yet. */
  message: string | null;
}

/** What the company switcher has to say, if anything. */
export interface SwitchState {
  message: string | null;
}

/**
 * The one sentence a refused action shows. Nothing here swallows a refusal, and the wording is
 * the backend's own when it stated one — a mistyped password has to read "those credentials were
 * not accepted", not a sentence about signing in that the person is already doing.
 */
function describe(error: unknown): string {
  return describeFailure(error).detail;
}

/** A trimmed form field. A blank one is the empty string, never `undefined`. */
function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Sign in with a login and a password. The optional company is only needed by someone who
 * works in several, and the backend refuses rather than guesses when it is.
 *
 * A session that owes a second factor comes back as the second step of the same form: the
 * cookie is already the browser's, and the only thing missing is the code.
 */
export async function signInAction(
  _previous: SignInState | null,
  form: FormData,
): Promise<SignInState> {
  const login = field(form, "login");
  const password = field(form, "password");
  if (login === "" || password === "") {
    return { stage: "credentials", message: "Enter the login and the password." };
  }
  try {
    const session = await signIn(login, password, field(form, "company"));
    if (session.mfa_pending) {
      return { stage: "mfa", message: `Enter the code that finishes signing in ${session.login}.` };
    }
  } catch (error) {
    return {
      stage: error instanceof MfaRequired ? "mfa" : "credentials",
      message: describe(error),
    };
  }
  revalidatePath("/", "layout");
  redirect("/");
}

/** Answer the second factor. The cookie already names the session that owes it. */
export async function verifyMfaAction(
  _previous: SignInState | null,
  form: FormData,
): Promise<SignInState> {
  const code = field(form, "code");
  if (code === "") {
    return { stage: "mfa", message: "Enter the code, or one of the recovery codes." };
  }
  try {
    await verifyMfa(code);
  } catch (error) {
    return { stage: "mfa", message: describe(error) };
  }
  revalidatePath("/", "layout");
  redirect("/");
}

/** Sign out, wherever the form was rendered: the row is revoked and the cookie is dropped. */
export async function signOutAction(): Promise<void> {
  await signOut();
  redirect(signInHref("signed_out"));
}

/**
 * Act in another company the caller is a member of.
 *
 * Every screen is read back from the backend under the session's company, so the whole layout
 * is re-validated rather than the page alone: a figure from the company just left must not
 * survive the switch.
 */
export async function switchCompanyAction(
  _previous: SwitchState | null,
  form: FormData,
): Promise<SwitchState> {
  const company = field(form, "company");
  if (company === "") {
    return { message: "Choose a company to act in." };
  }
  try {
    const session = await switchCompany(company);
    revalidatePath("/", "layout");
    return { message: `Now acting in ${session.company}.` };
  } catch (error) {
    return { message: describe(error) };
  }
}
