/**
 * T-2.PROC.04 — the export: the same matrix as a CSV file.
 *
 * A route handler rather than a client-side download, so "the matrix was exported"
 * is a URL a person can keep, and so the export is produced by the same
 * `comparisonCsv` the check covers. It reads the RFQ through the generated client
 * like every other screen and holds no data of its own.
 */

import { instanceIdentity, readRfq } from "@/lib/api";
import { buildComparison, comparisonCsv } from "@/lib/comparison";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ number: string }> },
) {
  const { number } = await params;
  let csv: string;
  try {
    csv = comparisonCsv(buildComparison(await readRfq(instanceIdentity(), number)));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return new Response(detail, {
      status: 502,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="comparative-statement-${number}.csv"`,
    },
  });
}
