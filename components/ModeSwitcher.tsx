"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Mode } from "@/lib/types";

export function ModeSwitcher({ initialMode }: { initialMode: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function change(next: Mode) {
    if (next === mode) return;
    setMode(next);
    await fetch("/api/mode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: next }),
    });
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-[9px] uppercase tracking-widest2 text-smoke sm:inline">
        Mode
      </span>
      <div className="flex border border-ink/20">
        {(["baseline", "tobe"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => change(m)}
            aria-pressed={mode === m}
            className={`px-2.5 py-1.5 text-[9px] uppercase tracking-widest2 transition-colors ${
              mode === m ? "bg-ink text-white" : "text-smoke hover:bg-bone"
            } ${pending ? "opacity-70" : ""}`}
          >
            {m === "baseline" ? "Baseline" : "To-Be"}
          </button>
        ))}
      </div>
    </div>
  );
}