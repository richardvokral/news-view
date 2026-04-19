import { getDb, hasDb } from "@/lib/db";
import type { WidgetConfig } from "@/types/dashboard";

function isValidLayout(data: unknown): data is WidgetConfig[] {
  if (!Array.isArray(data)) return false;
  return data.every((item) => {
    if (!item || typeof item !== "object") return false;
    const w = item as Record<string, unknown>;
    return (
      typeof w.id === "string" &&
      typeof w.type === "string" &&
      typeof w.title === "string"
    );
  });
}

export async function getUserLayout(
  email: string
): Promise<WidgetConfig[] | null> {
  if (!hasDb()) return null;
  const { rows } = await getDb().query<{ widgets: unknown }>(
    "SELECT widgets FROM dashboard_user_layouts WHERE email = $1",
    [email.toLowerCase()]
  );
  if (rows.length === 0) return null;
  return isValidLayout(rows[0].widgets) ? rows[0].widgets : null;
}

export async function getAdminDefault(): Promise<WidgetConfig[] | null> {
  if (!hasDb()) return null;
  const { rows } = await getDb().query<{ widgets: unknown }>(
    "SELECT widgets FROM dashboard_defaults WHERE id = 1"
  );
  if (rows.length === 0) return null;
  return isValidLayout(rows[0].widgets) ? rows[0].widgets : null;
}

export async function saveUserLayout(
  email: string,
  widgets: WidgetConfig[]
): Promise<void> {
  if (!hasDb()) throw new Error("Database not configured");
  await getDb().query(
    `INSERT INTO dashboard_user_layouts (email, widgets)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (email) DO UPDATE
       SET widgets = EXCLUDED.widgets, updated_at = NOW()`,
    [email.toLowerCase(), JSON.stringify(widgets)]
  );
}

export async function saveAdminDefault(
  email: string,
  widgets: WidgetConfig[]
): Promise<void> {
  if (!hasDb()) throw new Error("Database not configured");
  await getDb().query(
    `INSERT INTO dashboard_defaults (id, widgets, updated_by)
     VALUES (1, $1::jsonb, $2)
     ON CONFLICT (id) DO UPDATE
       SET widgets = EXCLUDED.widgets,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
    [JSON.stringify(widgets), email]
  );
}

export async function deleteUserLayout(email: string): Promise<void> {
  if (!hasDb()) throw new Error("Database not configured");
  await getDb().query(
    "DELETE FROM dashboard_user_layouts WHERE email = $1",
    [email.toLowerCase()]
  );
}
