// Runs the RLS suite against a real Supabase project through the Management API
// query endpoint, without ever persisting anything.
//
// The endpoint has no session, so this adapter emulates one: every call replays the
// "persisted" log (fixture writes made outside a transaction) plus the statements of
// the open transaction, then runs the new statement, all inside one DO block that
// always ends by raising. The raise aborts the whole request, so fixture rows,
// role switches and test writes are rolled back by Postgres itself. Only identity
// sequence values can advance (sequences are not transactional).
//
// Token: injected by the network proxy for api.supabase.com. Never read or logged here.

export type Row = Record<string, unknown>;
export type Db = {
  query(sql: string, params?: unknown[]): Promise<{ rows: Row[] }>;
  end(): Promise<void>;
};

const SENTINEL = "OHT:";

function literal(v: unknown): string {
  if (v === null || v === undefined) return "null";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return `'${s.replace(/'/g, "''")}'`;
}

export function inline(sql: string, params: unknown[] = []): string {
  return sql.replace(/\$(\d+)/g, (_, n: string) => literal(params[Number(n) - 1]));
}

function exec(stmt: string): string {
  return `execute ${literal(stmt)};`;
}

export function buildBlock(replay: string[], stmt: string): string {
  const isSelect = /^\s*select\b/i.test(stmt);
  const final = isSelect
    ? `execute ${literal(`select coalesce(jsonb_agg(t), '[]'::jsonb) from (${stmt}) t`)} into rows;`
    : exec(stmt);
  return `do $oht$
declare rows jsonb := '[]'::jsonb; out jsonb;
begin
  begin
    ${replay.map(exec).join("\n    ")}
    ${final}
    out := jsonb_build_object('ok', true, 'rows', rows);
  exception when others then
    out := jsonb_build_object('ok', false, 'message', sqlerrm, 'code', sqlstate);
  end;
  raise exception using message = '${SENTINEL}' || out::text;
end
$oht$;`;
}

export class RemoteDb implements Db {
  private persisted: string[] = [];
  private tx: string[] | null = null;

  constructor(private readonly ref: string) {}

  async query(sql: string, params: unknown[] = []): Promise<{ rows: Row[] }> {
    const stmt = inline(sql, params).trim();
    // The DO block body is dollar-quoted with $oht$; a statement containing it could escape the block.
    if (stmt.includes("$oht$")) throw new Error("statement contains the reserved $oht$ tag");
    if (/^begin$/i.test(stmt)) {
      this.tx = [];
      return { rows: [] };
    }
    if (/^(rollback|commit)$/i.test(stmt)) {
      if (/^commit$/i.test(stmt)) throw new Error("RemoteDb never commits");
      this.tx = null;
      return { rows: [] };
    }
    const rows = await this.run([...this.persisted, ...(this.tx ?? [])], stmt);
    // Only successful statements are replayed later.
    if (this.tx) this.tx.push(stmt);
    else if (!/^\s*select\b/i.test(stmt)) this.persisted.push(stmt);
    return { rows };
  }

  private async run(replay: string[], stmt: string): Promise<Row[]> {
    const res = await fetch(`https://api.supabase.com/v1/projects/${this.ref}/database/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: buildBlock(replay, stmt) }),
    });
    const text = await res.text();
    const msg = findSentinel(text);
    if (msg === null) throw new Error(`unexpected response ${res.status}: ${text.slice(0, 300)}`);
    const payload = JSON.parse(balanced(msg.slice(msg.indexOf(SENTINEL) + SENTINEL.length)));
    if (!payload.ok) throw new Error(payload.message);
    return payload.rows as Row[];
  }

  async end(): Promise<void> {}
}

/** The payload travels inside the API's error message; find that string in the JSON body. */
function findSentinel(text: string): string | null {
  const walk = (v: unknown): string | null => {
    if (typeof v === "string") return v.includes(SENTINEL) ? v : null;
    if (v && typeof v === "object") {
      for (const x of Object.values(v)) {
        const hit = walk(x);
        if (hit) return hit;
      }
    }
    return null;
  };
  try {
    return walk(JSON.parse(text));
  } catch {
    return text.includes(SENTINEL) ? text : null;
  }
}

function balanced(s: string): string {
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return s.slice(0, i + 1);
  }
  throw new Error("could not parse remote payload");
}
