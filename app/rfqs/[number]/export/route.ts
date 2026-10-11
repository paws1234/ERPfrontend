/**
 * T-2.PROC.04 — the export: the same matrix as a CSV file.
 *
 * A route handler rather than a client-side download, so "the matrix was exported"
 * is a URL a person can keep, and so the export is produced by the same
 * `comparisonCsv` the check covers. It reads the RFQ through the generated client
 * like every other screen and holds no data of its own.
 */

import { ApiFailure, MfaRequired, NotPermitted, readRfq, Unauthenticated } from "@/lib/api";
import { redirectToSignIn, sessionCookie } from "@/lib/session";
import { buildComparison, comparisonCsv } from "@/lib/comparison";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ number: string }> },
) {
  const { number } = await params;
  let csv: string;
  try {
    csv = comparisonCsv(buildComparison(await readRfq(await sessionCookie(), number)));
  } catch (error) {
    // A session that is gone is not a download: the browser is sent to the sign-in screen,
    // which is the one thing an expired cookie can be told to do — never a stack trace.
    if (error instanceof Unauthenticated) redirectToSignIn("expired");
    if (error instanceof MfaRequired) redirectToSignIn("mfa");
    const detail = error instanceof Error ? error.message : String(error);
    const status =
      error instanceof NotPermitted ? 403 : error instanceof ApiFailure ? error.status : 502;
    return new Response(detail, {
      status,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const safeNumber = number.replace(/[^a-zA-Z0-9._-]/g, "_") || "rfq";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="comparative-statement-${safeNumber}.csv"`,
    },
  });
}
