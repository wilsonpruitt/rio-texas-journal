import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

// Modest, single reusable access code for the less-intuitive (inferential / predictive)
// insights. Not a security boundary — just keeps the modeling views from casual public
// view. Override the code via the RTJ_UNLOCK_CODE env var without a redeploy.
const CODE = process.env.RTJ_UNLOCK_CODE ?? "rio2026";
export const UNLOCK_COOKIE = "rtj_unlock";
const TOKEN = "1";

export function checkCode(code: string): boolean {
  return code.trim().toLowerCase() === CODE.toLowerCase();
}

export async function isUnlocked(): Promise<boolean> {
  const c = await cookies();
  return c.get(UNLOCK_COOKIE)?.value === TOKEN;
}

export async function setUnlocked(): Promise<void> {
  const c = await cookies();
  c.set(UNLOCK_COOKIE, TOKEN, {
    httpOnly: true, sameSite: "lax", path: "/",
    maxAge: 60 * 60 * 24 * 180, // ~6 months
  });
}

// For whole-page gates: redirect to /unlock if not unlocked.
export async function requireUnlock(next: string): Promise<void> {
  if (!(await isUnlocked())) redirect(`/unlock?next=${encodeURIComponent(next)}`);
}
