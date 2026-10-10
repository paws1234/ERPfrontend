/**
 * The POS till — the page shell: which terminal is trading, the shift its drawer is in,
 * and what the day came to, with the till itself in `./till`.
 *
 * Rendered on the server from the API, like every other screen: this process talks to
 * the API and never to the database. The terminal lives in the URL
 * (`/pos?terminal=TILL-1`) because a shift is read **per terminal**, and a page that
 * baked one in would be a page showing some other shop's drawer.
 *
 * Identity comes from `instanceIdentity()`, the one place runtime identity is read.
 */

import { companyProfile, describeFailure, instanceIdentity } from "@/lib/api";
import {
  currentShift,
  dayReport,
  reportRows,
  shiftReport,
  type PosShift,
  type ZReport,
} from "@/lib/pos";

import { oversellAllowed } from "@/lib/offline";

import { OfflineSheet } from "./offline";
import { ShiftPanel } from "./shift-panel";
import { Till } from "./till";
import { AmountRows, BUTTON, INPUT } from "./ui";

// A drawer is live data: rendered per request, never cached at build.
export const dynamic = "force-dynamic";

interface Read<T> {
  value: T | null;
  failure: { title: string; detail: string } | null;
}

/** A read the page renders as a message when it is refused, rather than a blank page. */
async function read<T>(call: () => Promise<T>): Promise<Read<T>> {
  try {
    return { value: await call(), failure: null };
  } catch (error) {
    return { value: null, failure: describeFailure(error) };
  }
}

/** A read nobody asked for. */
function unasked<T>(): Read<T> {
  return { value: null, failure: null };
}

function Notice({ failure }: { failure: { title: string; detail: string } }) {
  return (
    <div
      style={{
        border: "1px solid #d9a300",
        background: "#fff8e6",
        padding: "1rem",
        borderRadius: 6,
        marginBottom: "0.75rem",
      }}
    >
      <strong>{failure.title}</strong>
      <p style={{ margin: "0.25rem 0 0" }}>{failure.detail}</p>
    </div>
  );
}

export default async function PosPage({
  searchParams,
}: {
  searchParams: Promise<{ terminal?: string; on?: string }>;
}) {
  const { terminal: chosenTerminal, on: chosenDay } = await searchParams;
  const terminal = chosenTerminal?.trim() ?? "";
  const day = chosenDay?.trim() ?? "";
  const identity = instanceIdentity();

  // Independent reads, so they are asked for together rather than one after another.
  const [company, shift, takings] = await Promise.all([
    read(() => companyProfile(identity)),
    terminal === "" ? unasked<PosShift>() : read(() => currentShift(identity, terminal)),
    day === "" ? unasked<ZReport>() : read(() => dayReport(identity, day)),
  ]);

  const trading = shift.value;
  const shiftZ = trading ? await read(() => shiftReport(identity, trading.id)) : unasked<ZReport>();

  return (
    <section>
      <h1 style={{ marginBottom: 0 }}>Point of sale</h1>
      <p style={{ color: "#5b6470" }}>
        {company.value
          ? `Company ${company.value.code} · base currency ${company.value.base_currency}`
          : "No company bound to this instance yet."}
        {company.value?.cash_drawer_required === true
          ? " · tills must trade inside an open shift"
          : ""}
      </p>

      <form
        method="get"
        action="/pos"
        style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}
      >
        <label htmlFor="terminal" style={{ color: "#5b6470" }}>
          Terminal
        </label>
        <input
          id="terminal"
          name="terminal"
          defaultValue={terminal}
          placeholder="TILL-1"
          style={INPUT}
        />
        {/* The day being read is kept across a change of terminal. */}
        <input type="hidden" name="on" value={day} />
        <button type="submit" style={BUTTON}>
          Trade this till
        </button>
      </form>

      {company.failure ? <Notice failure={company.failure} /> : null}

      {terminal === "" ? (
        <p style={{ color: "#5b6470" }}>
          State the terminal this till is trading as: its shift, its drawer and its
          movements are all read per terminal.
        </p>
      ) : (
        <>
          {shift.failure ? <Notice failure={shift.failure} /> : null}
          {shiftZ.failure ? <Notice failure={shiftZ.failure} /> : null}
          <OfflineSheet
            terminal={terminal}
            allowOversell={oversellAllowed(process.env.POS_OFFLINE_OVERSELL)}
          />

          <ShiftPanel
            terminal={terminal}
            shift={shift.value}
            policy={company.value?.cash_drawer_required ?? null}
            report={shiftZ.value}
          />
        </>
      )}

      {/* Keyed on the terminal: this is the one client component holding a basket, and a
          change of terminal must not carry TILL-1's open sale over to TILL-2's shift —
          the key drops that state rather than letting it be completed on the wrong till. */}
      <Till key={terminal} terminal={terminal} currency={company.value?.base_currency ?? ""} />

      <div style={{ marginTop: "1rem" }}>
        <h2 style={{ fontSize: "1.1rem", margin: "0 0 0.5rem" }}>The day's Z-report</h2>
        <form
          method="get"
          action="/pos"
          style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}
        >
          <input type="hidden" name="terminal" value={terminal} />
          <input type="date" name="on" defaultValue={day} style={INPUT} />
          <button type="submit" style={BUTTON}>
            Read the day
          </button>
        </form>
        {takings.failure ? <Notice failure={takings.failure} /> : null}
        {takings.value ? <AmountRows rows={reportRows(takings.value)} /> : null}
      </div>
    </section>
  );
}
