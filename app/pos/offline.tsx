"use client";

/**
 * T-6.OFFLINE.01 — the offline sheet: what this terminal rings up while the network is
 * away, and what becomes of it when the network is back.
 *
 * This is the client half of the till's offline operation. The queue lives in the
 * terminal's own storage (`lib/offline`), so it survives a reload or a power cut; the
 * *replay* goes through the server action in `./actions`, because the browser never
 * holds the identity the backend needs and never calls the API itself — the same rule
 * every other screen follows.
 *
 * What this panel deliberately does **not** do:
 *
 * * it does not guess an availability: the shelf it will not oversell is the one the
 *   operator counted here, in `CODE=QUANTITY` lines, when the connection dropped;
 * * it does not quietly drop a refused sale: a sale the server would not take stays in
 *   the queue with the server's own reason beside it, for a person to resolve;
 * * it does not read a missing figure as a zero: the report is read through
 *   `lib/offline`'s own reader, which says "not a report" rather than inventing counts.
 */

import { useActionState, useEffect, useRef, useState } from "react";

import {
  createQueue,
  syncBody,
  type Difference,
  type Queue,
  type QueuedSale,
  type ReportRead,
} from "@/lib/offline";

import { replayQueue, type QueueState } from "./actions";
import { BUTTON, INPUT, LABEL, Said } from "./ui";

/** The terminal's storage, or a memory stand-in where the browser has none (a build). */
function terminalStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function Counts({ report }: { report: ReportRead }) {
  return (
    <p style={{ margin: "0.25rem 0", fontSize: "0.9rem" }}>
      {report.terminal}: {report.queued} queued · {report.accepted} accepted ·{" "}
      {report.duplicates} already stored · {report.rejected} refused
    </p>
  );
}

function Differences({ rows }: { rows: Difference[] }) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <table style={{ borderCollapse: "collapse", fontSize: "0.85rem", marginTop: "0.25rem" }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left", paddingRight: "0.75rem" }}>Sale</th>
          <th style={{ textAlign: "left", paddingRight: "0.75rem" }}>Item</th>
          <th style={{ textAlign: "right", paddingRight: "0.75rem" }}>Sold</th>
          <th style={{ textAlign: "right", paddingRight: "0.75rem" }}>On hand</th>
          <th style={{ textAlign: "left" }}>At</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.number}-${row.barcode}`}>
            <td style={{ paddingRight: "0.75rem" }}>{row.number}</td>
            <td style={{ paddingRight: "0.75rem" }}>{row.item}</td>
            <td style={{ paddingRight: "0.75rem", textAlign: "right" }}>{row.quantity}</td>
            <td style={{ paddingRight: "0.75rem", textAlign: "right" }}>{row.onHand}</td>
            <td>{row.location}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function OfflineSheet({
  terminal,
  allowOversell,
}: {
  terminal: string;
  /** `POS_OFFLINE_OVERSELL`, read on the server and stated here rather than guessed. */
  allowOversell: boolean;
}) {
  const queue = useRef<Queue | null>(null);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<number>(0);
  const [sale, setSale] = useState<string>("");
  const [state, submit, busy] = useActionState<QueueState | null, FormData>(
    replayQueue,
    null,
  );

  const shop = (): Queue | null => {
    if (queue.current === null) {
      const store = terminalStore();
      queue.current = store === null ? null : createQueue(store);
    }
    return queue.current;
  };

  const refresh = (): void => {
    const till = shop();
    setPending(till === null ? 0 : till.pending().length);
    setCounted(till === null ? {} : till.cached());
  };

  useEffect(refresh, []);

  // A report that came back is applied to the queue: accepted and already-stored numbers
  // leave, refusals stay with the server's reason beside them.
  useEffect(() => {
    const report = state?.report;
    if (report === undefined || report === null) {
      return;
    }
    shop()?.apply(report);
    refresh();
  }, [state]);

  const record = (form: FormData): void => {
    const till = shop();
    if (till === null) {
      setSale("This terminal has nowhere to keep a queue; it cannot sell offline.");
      return;
    }
    const barcode = String(form.get("barcode") ?? "").trim();
    const quantity = String(form.get("quantity") ?? "1").trim();
    const allowed = till.canSell(barcode, quantity, allowOversell);
    if (!allowed.ok) {
      setSale(allowed.reason);
      return;
    }
    const number = till.next(terminal);
    till.add({
      number,
      sold_on: String(form.get("sold_on") ?? "") || undefined,
      lines: [
        {
          barcode,
          base_price: String(form.get("base_price") ?? "").trim(),
          quantity,
          uom: String(form.get("uom") ?? "").trim() || undefined,
        },
      ],
      tenders: [
        {
          tender_type: "cash",
          amount: String(form.get("amount") ?? "").trim(),
        },
      ],
    });
    till.spend(barcode, quantity);
    setSale(`Sale ${number} is queued${allowed.reason === "" ? "" : ` — ${allowed.reason}`}.`);
    refresh();
  };

  const report = (state?.report ?? null) as ReportRead | null;
  const waiting = shop()?.pending() ?? [];
  const refused = report === null
    ? []
    : waiting.filter((row) => report.outcomes.get(row.number)?.outcome === "rejected");

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e6e8eb",
        borderRadius: 6,
        padding: "0.75rem",
        marginTop: "1rem",
      }}
    >
      <h2 style={{ fontSize: "1.1rem", margin: "0 0 0.25rem" }}>Offline sheet</h2>
      <p style={{ color: "#5b6470", fontSize: "0.85rem", margin: "0 0 0.5rem" }}>
        {pending} sale{pending === 1 ? "" : "s"} queued on {terminal}. Shelf counts are the
        figures this terminal knows;{" "}
        {allowOversell
          ? "selling beyond them is allowed by this terminal's configuration"
          : "selling beyond them is refused here"}
        .
      </p>
      <Said state={state} />

      <form
        action={(form) => {
          shop()?.count(String(form.get("stock") ?? ""));
          refresh();
        }}
        style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}
      >
        <label htmlFor="stock" style={LABEL}>
          Shelf count
        </label>
        <textarea
          id="stock"
          name="stock"
          rows={3}
          placeholder={"4000000000017=12\n4000000000024=4"}
          style={{ ...INPUT, width: "20rem", fontFamily: "monospace" }}
        />
        <button type="submit" style={BUTTON}>
          Count the shelf
        </button>
      </form>
      <p style={{ color: "#5b6470", fontSize: "0.8rem", margin: "0 0 0.5rem" }}>
        {Object.keys(counted).length === 0
          ? "Nobody has counted a shelf at this terminal yet."
          : `Counted: ${Object.entries(counted)
              .map(([code, figure]) => `${code}=${figure}`)
              .join(" · ")}`}
      </p>

      <form action={record} style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
        <input name="barcode" placeholder="Barcode" required style={INPUT} />
        <input name="quantity" placeholder="Qty" inputMode="decimal" defaultValue="1" style={INPUT} />
        <input
          name="base_price"
          placeholder="Shelf price, e.g. 12.50"
          inputMode="decimal"
          required
          style={INPUT}
        />
        <input name="uom" placeholder="UoM" style={INPUT} />
        <input
          name="amount"
          placeholder="Cash taken, e.g. 14.00"
          inputMode="decimal"
          required
          style={INPUT}
        />
        <button type="submit" style={BUTTON}>
          Queue the sale
        </button>
      </form>
      {sale === "" ? null : (
        <p role="status" style={{ color: "#5b6470", fontSize: "0.85rem", margin: "0.25rem 0 0" }}>
          {sale}
        </p>
      )}

      <form
        action={submit}
        style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginTop: "0.75rem" }}
      >
        <input name="location_code" placeholder="Location code" required style={INPUT} />
        <input type="hidden" name="terminal" value={terminal} />
        <input type="hidden" name="oversell_allowed" value={allowOversell ? "true" : "false"} />
        <input type="hidden" name="queue" value={JSON.stringify(waiting)} />
        <button type="submit" disabled={busy || pending === 0} style={BUTTON}>
          {busy ? "Synchronising…" : "Synchronise now"}
        </button>
      </form>

      {refused.length === 0 ? null : (
        <p role="alert" style={{ color: "#8a1c1c", fontSize: "0.85rem", margin: "0.25rem 0 0" }}>
          The queue still holds{" "}
          {refused
            .map((row) => `${row.number} (${report?.outcomes.get(row.number)?.reason ?? ""})`)
            .join("; ")}
        </p>
      )}
      {report === null ? null : (
        <>
          <Counts report={report} />
          <Differences rows={report.differences} />
        </>
      )}
    </div>
  );
}
