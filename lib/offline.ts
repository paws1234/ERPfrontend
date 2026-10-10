/**
 * T-6.OFFLINE.01 — the terminal's queue: what a till rings up with the network away.
 *
 * A terminal that loses the connection has to keep selling, so it keeps what it sold and
 * sends it when it is back. Three things are logic rather than presentation, and they are
 * here once so the screen and the tests read them the same way:
 *
 * * **The queue outlives the terminal.** It is written to the terminal's own storage after
 *   every sale, so a till that is switched off — or reloaded — with sales still queued
 *   comes back with them, in the order they happened.
 * * **What the till cannot see, it must not promise.** The stock the till knows about is
 *   the figure its operator counted when the network dropped, and that figure is spent
 *   sale by sale: a sale that would take the shelf below nothing is refused unless the
 *   terminal was explicitly configured to allow it (`POS_OFFLINE_OVERSELL`). The refusal
 *   is the till's own, before anything is queued — the platform's rule (a location never
 *   goes negative) is the backend's, and this is the till keeping the same promise while
 *   it cannot ask.
 * * **A report is read, never assumed.** The sync answers with counts and with the rows
 *   the server refused; the queue is cleared of exactly the numbers that were accepted or
 *   already stored, and the refusals stay, with their reasons, for a person to resolve.
 *
 * The amounts compared here are exact decimal strings through `lib/pos`'s own reader
 * (`0.1 + 0.2` is not `0.3`, and a shelf count stated as a binary float would be a
 * different fact from the figure the ledger keeps).
 */

// The extension is stated because a test loads this module through node's own loader as
// well as through the bundler (`allowImportingTsExtensions`), and one reader of money is
// the point: `lib/pos` already owns the exact arithmetic.
import { amount } from "./pos.ts";
import type { components } from "./contract";

export type SyncLine = components["schemas"]["PosSyncLineIn"];
export type SyncTender = components["schemas"]["PosSyncTenderIn"];
export type SyncSale = components["schemas"]["PosSyncSaleIn"];

/** How the terminal's stock policy is stated (`POS_OFFLINE_OVERSELL`, read off the server). */
export const OVERSELL_ENV = "POS_OFFLINE_OVERSELL";

const QUEUE_KEY = "erpv1.pos.queue";
const STOCK_KEY = "erpv1.pos.stock";
const REPORT_KEY = "erpv1.pos.report";
const COUNTER_KEY = "erpv1.pos.counter";

/** One sale the till rang up offline: the contract's own shape, plus when it happened. */
export interface QueuedSale extends SyncSale {
  queuedAt: string;
}

/** The bit of the browser this needs — so a test can supply its own. */
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SaleAllowed {
  ok: boolean;
  /** Why not, or — when it was allowed by policy — that it was. */
  reason: string;
}

export interface Difference {
  number: string;
  item: string;
  barcode: string;
  quantity: string;
  location: string;
  onHand: string;
  oversellAllowed: boolean;
}

export interface ReportRead {
  terminal: string;
  queued: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  differences: Difference[];
  /** Number → what became of it, exactly as the server stated it. */
  outcomes: Map<string, { outcome: string; reason: string | null }>;
}

/** Whether a stated policy says the till may sell beyond what it can see. */
export function oversellAllowed(value: string | undefined | null): boolean {
  const stated = (value ?? "").trim().toLowerCase();
  return stated === "1" || stated === "true" || stated === "yes";
}

/**
 * The shelf as the till knows it: `CODE=QUANTITY` lines, one per code.
 *
 * A line it cannot read is dropped rather than read as zero — a count nobody could read
 * is not a count of nothing, and treating it as nothing would refuse a sale that could
 * have been made.
 */
export function parseStock(text: string): Record<string, string> {
  const stock: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const [code = "", figure = ""] = line.split("=");
    const counted = amount(figure.trim());
    if (code.trim() !== "" && counted !== null) {
      stock[code.trim()] = counted.text;
    }
  }
  return stock;
}

/** Read one sync report as the terminal shows it, or `null` when it is not one. */
export function readReport(value: unknown): ReportRead | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const report = value as Record<string, unknown>;
  const count = (key: string): number | null =>
    typeof report[key] === "number" ? (report[key] as number) : null;
  const queued = count("queued");
  const accepted = count("accepted");
  const duplicates = count("duplicates");
  const rejected = count("rejected");
  if (
    typeof report.terminal !== "string" ||
    queued === null ||
    accepted === null ||
    duplicates === null ||
    rejected === null
  ) {
    return null;
  }
  const outcomes = new Map<string, { outcome: string; reason: string | null }>();
  for (const row of Array.isArray(report.outcomes) ? report.outcomes : []) {
    const entry = row as Record<string, unknown>;
    if (typeof entry.number === "string" && typeof entry.outcome === "string") {
      outcomes.set(entry.number, {
        outcome: entry.outcome,
        reason: typeof entry.reason === "string" ? entry.reason : null,
      });
    }
  }
  const differences: Difference[] = [];
  for (const row of Array.isArray(report.differences) ? report.differences : []) {
    const entry = row as Record<string, unknown>;
    differences.push({
      number: String(entry.number ?? ""),
      item: String(entry.item ?? ""),
      barcode: String(entry.barcode ?? ""),
      quantity: String(entry.quantity ?? ""),
      location: String(entry.location ?? ""),
      onHand: String(entry.on_hand ?? ""),
      oversellAllowed: entry.oversell_allowed === true,
    });
  }
  return { terminal: report.terminal, queued, accepted, duplicates, rejected, differences, outcomes };
}

/**
 * The body of `POST /api/v1/pos/sync`: the queue in the order it happened, with the
 * policy the terminal was trading under, so the report can say what a shortfall means.
 */
export function syncBody(
  terminal: string,
  locationCode: string,
  oversellAllowed: boolean,
  sales: QueuedSale[],
): Record<string, unknown> {
  return {
    terminal,
    location_code: locationCode,
    oversell_allowed: oversellAllowed,
    sales: sales.map((sale) => {
      // Only what the sale states: a key holding `undefined` is not a blank field the
      // backend may read, it is a field the till never stated — the same distinction
      // `app/pos/offline.py` draws when it reads the queue.
      const sent: Record<string, unknown> = { number: sale.number };
      for (const key of ["sold_on", "customer_code", "currency"] as const) {
        if (sale[key] !== undefined) {
          sent[key] = sale[key];
        }
      }
      sent.lines = sale.lines;
      sent.tenders = sale.tenders;
      return sent;
    }),
  };
}

/** The queue, as the terminal keeps it. */
export interface Queue {
  pending(): QueuedSale[];
  /** The next number this terminal rings a sale under — counted, never re-used. */
  next(terminal: string): string;
  add(sale: SyncSale): QueuedSale;
  /** The stock the operator counted when the network dropped. */
  count(text: string): Record<string, string>;
  cached(): Record<string, string>;
  canSell(barcode: string, quantity: string, allowed: boolean): SaleAllowed;
  spend(barcode: string, quantity: string): void;
  /** What the report leaves behind: accepted and stored numbers go, refusals stay. */
  apply(value: unknown): ReportRead | null;
  lastReport(): ReportRead | null;
}

function read<T>(store: Store, key: string, fallback: T): T {
  const raw = store.getItem(key);
  if (raw === null) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function createQueue(store: Store, now: () => string = () => new Date().toISOString()): Queue {
  const write = (key: string, value: unknown): void => store.setItem(key, JSON.stringify(value));
  const pending = (): QueuedSale[] => read<QueuedSale[]>(store, QUEUE_KEY, []);
  const cached = (): Record<string, string> => read<Record<string, string>>(store, STOCK_KEY, {});

  return {
    pending,
    cached,
    count(text) {
      const counted = parseStock(text);
      write(STOCK_KEY, counted);
      return counted;
    },
    next(terminal) {
      const counted = read<number>(store, COUNTER_KEY, 0) + 1;
      write(COUNTER_KEY, counted);
      // Padded, and rooted in the terminal, so a number read off a slip says which till
      // wrote it — the backend identifies a queued sale by this and by nothing else.
      return `${terminal}-${String(counted).padStart(6, "0")}`;
    },
    add(sale) {
      const queued: QueuedSale = { ...sale, queuedAt: now() };
      const queue = pending();
      queue.push(queued);
      write(QUEUE_KEY, queue);
      return queued;
    },
    canSell(barcode, quantity, allowed) {
      const counted = amount(quantity);
      const shelf = amount(cached()[barcode] ?? "");
      if (counted === null || counted.units <= 0n) {
        return { ok: false, reason: `${quantity} is not a quantity this till can sell` };
      }
      if (shelf === null) {
        // No count for this code: the till does not know what is on the shelf, and a
        // sale it cannot check is refused rather than guessed at.
        return {
          ok: false,
          reason: `no shelf count for ${barcode}; count the shelf before selling offline`,
        };
      }
      const left = shelf.units - counted.units;
      if (left >= 0n) {
        return { ok: true, reason: "" };
      }
      return allowed
        ? {
            ok: true,
            reason:
              `allowed by policy: ${barcode} is counted at ${shelf.text} and selling` +
              ` ${counted.text} takes it below nothing`,
          }
        : {
            ok: false,
            reason: `${barcode} is counted at ${shelf.text}; selling ${counted.text} would leave nothing`,
          };
    },
    spend(barcode, quantity) {
      const counted = amount(quantity);
      const shelf = amount(cached()[barcode] ?? "");
      if (counted === null || shelf === null) {
        return;
      }
      const left = shelf.units - counted.units;
      const stated = amount(String(left > 0n ? left : 0n));
      write(STOCK_KEY, { ...cached(), [barcode]: stated?.text ?? shelf.text });
    },
    apply(value) {
      const report = readReport(value);
      if (report === null) {
        return null;
      }
      const kept = pending().filter(
        (sale) => report.outcomes.get(sale.number)?.outcome === "rejected",
      );
      write(QUEUE_KEY, kept);
      // The report itself is stored as it arrived, and read back through `readReport`:
      // the terminal's own reading is derived, never the thing that was written down.
      write(REPORT_KEY, value);
      return report;
    },
    lastReport() {
      return readReport(read<unknown>(store, REPORT_KEY, null));
    },
  };
}
