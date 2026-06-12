import { redirect } from "next/navigation";
import { checkCode, setUnlocked } from "@/lib/unlock";

export const metadata = { title: "Unlock" };

const safeNext = (n: string | undefined) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/");

async function unlock(formData: FormData) {
  "use server";
  const code = String(formData.get("code") ?? "");
  const next = safeNext(String(formData.get("next") ?? "/"));
  if (checkCode(code)) {
    await setUnlocked();
    redirect(next);
  }
  redirect(`/unlock?error=1&next=${encodeURIComponent(next)}`);
}

export default async function UnlockPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const error = sp.error === "1";

  return (
    <main className="mx-auto max-w-md px-5 sm:px-8 py-20">
      <p className="eyebrow">Members of the conference</p>
      <h1 className="mt-2 font-display text-3xl sm:text-4xl text-ink">A closer look.</h1>
      <p className="mt-3 text-ink-mute">
        A few views — the closure-risk model, the finance scenario tool, and the bright-spots analysis — read better
        with context. Enter the access code shared with conference leadership to view them.
      </p>

      <form action={unlock} className="mt-7 panel rounded-lg p-6">
        <input type="hidden" name="next" value={next} />
        <label htmlFor="code" className="text-sm text-ink">Access code</label>
        <input
          id="code" name="code" type="password" autoFocus autoComplete="off"
          className="mt-2 w-full px-3.5 py-2 bg-vellum border border-rule rounded-md text-ink focus:outline-none focus:ring-1 focus:ring-teal/40"
          placeholder="••••••••"
        />
        {error && <p className="mt-2 text-sm text-ember">That code didn&rsquo;t match. Try again.</p>}
        <button type="submit" className="mt-4 w-full px-4 py-2 rounded-md bg-teal text-white font-medium hover:bg-teal/90 transition-colors">
          Unlock
        </button>
      </form>

      <a href={next === "/" ? "/" : next} className="mt-5 inline-block text-sm text-ink-mute hover:text-ink">← Back</a>
    </main>
  );
}
