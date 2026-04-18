import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

let pool: Pool | null = null;

export function getDb(): Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("Missing DATABASE_URL environment variable");
    }
    pool = new Pool({ connectionString: url });
  }
  return pool;
}

export function hasDb(): boolean {
  return !!process.env.DATABASE_URL;
}
