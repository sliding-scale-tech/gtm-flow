// RFC 4180 CSV: quoted fields, "" escapes, commas/newlines inside quotes, CRLF or LF.
// Streaming: push() text chunks as they arrive (chunks may split anywhere), end() flushes the last row.
export class CsvStream {
  private row: string[] = [];
  private field = "";
  private quoted = false;
  private pendingQuote = false; // saw `"` inside quotes at chunk end: either "" escape or closing quote
  private pendingCR = false;
  private started = false;
  private header: string[] | null = null;

  push(chunk: string): Record<string, string>[] {
    const out: Record<string, string>[] = [];
    let s = chunk;
    if (!this.started && s.length) { this.started = true; if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); } // BOM
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (this.pendingCR) { this.pendingCR = false; if (c === "\n") continue; }
      if (this.pendingQuote) {
        this.pendingQuote = false;
        if (c === '"') { this.field += '"'; continue; }
        this.quoted = false; // it was a closing quote; fall through to handle c unquoted
      }
      if (this.quoted) {
        if (c === '"') this.pendingQuote = true;
        else this.field += c;
      } else if (c === '"') this.quoted = true;
      else if (c === ",") { this.row.push(this.field); this.field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r") this.pendingCR = true;
        this.endRow(out);
      } else this.field += c;
    }
    return out;
  }

  end(): Record<string, string>[] {
    const out: Record<string, string>[] = [];
    if (this.pendingQuote) { this.pendingQuote = false; this.quoted = false; }
    if (this.field !== "" || this.row.length) this.endRow(out);
    return out;
  }

  private endRow(out: Record<string, string>[]) {
    this.row.push(this.field);
    this.field = "";
    const r = this.row;
    this.row = [];
    if (!r.some((v) => v.trim() !== "")) return;
    if (!this.header) { this.header = r.map((h) => h.trim()); return; }
    const h = this.header;
    out.push(Object.fromEntries(h.map((k, i) => [k, r[i] ?? ""])));
  }

  get columns(): string[] | null { return this.header; }
}

export function parseCsv(input: string): Record<string, string>[] {
  const p = new CsvStream();
  return [...p.push(input), ...p.end()];
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const cell = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // spreadsheet formula injection
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(cell).join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\r\n");
}
