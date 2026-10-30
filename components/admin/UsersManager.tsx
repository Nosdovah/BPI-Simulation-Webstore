"use client";

import { useEffect, useMemo, useState } from "react";
import { ROLE_DEFS, ROLE_ORDER } from "@/lib/auth/rbac";
import { ROLES, type Role, type UserStatus } from "@/lib/auth/types";

type PublicUser = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  roles: Role[];
  primaryRole: Role;
  status: UserStatus;
  createdAt: number;
  lastLoginAt: number | null;
};

const STATUS_STYLE: Record<UserStatus, string> = {
  ACTIVE: "text-ink",
  PENDING: "text-brass",
  SUSPENDED: "text-alert",
};

function when(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Tabel manajemen user.
 *
 * Semua aksi dikirim ke /api/admin/users (PATCH) yang memeriksa permission
 * di server. UI hanya menyembunyikan tombol — bukan sebagai pengaman, tapi
 * supaya operator tidak menekan hal yang pasti ditolak.
 */
export function UsersManager({ selfId }: { selfId: string }) {
  const [users, setUsers] = useState<PublicUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState<"ALL" | Role>("ALL");

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      const data = (await res.json()) as {
        ok: boolean;
        items?: PublicUser[];
        message?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.message ?? "Gagal memuat daftar user.");
        return;
      }
      setUsers(data.items ?? []);
    } catch {
      setError("Tidak dapat menghubungi server.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function patch(id: string, body: Record<string, unknown>, label: string) {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string };
      if (!res.ok || !data.ok) {
        setError(data.message ?? "Perubahan ditolak.");
        return;
      }
      setNotice(label);
      await load();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setBusyId(null);
    }
  }

  const filtered = useMemo(() => {
    if (!users) return null;
    const q = filter.trim().toLowerCase();
    return users.filter((u) => {
      const matchQ =
        !q || u.email.toLowerCase().includes(q) || u.name.toLowerCase().includes(q);
      const matchR = roleFilter === "ALL" || u.roles.includes(roleFilter);
      return matchQ && matchR;
    });
  }, [users, filter, roleFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="mb-1 block text-[10px] uppercase tracking-widest2 text-smoke">
            Cari nama / email
          </label>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="kata kunci…"
            className="w-full border border-ink/20 bg-white px-3 py-2 text-sm outline-none focus:border-ink"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-widest2 text-smoke">
            Filter role
          </label>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as "ALL" | Role)}
            className="border border-ink/20 bg-white px-3 py-2 text-sm outline-none focus:border-ink"
          >
            <option value="ALL">Semua role</option>
            {ROLE_ORDER.map((r) => (
              <option key={r} value={r}>
                {ROLE_DEFS[r].label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="border border-ink/20 px-4 py-2 text-[11px] uppercase tracking-widest2 hover:bg-ink hover:text-white"
        >
          Muat ulang
        </button>
      </div>

      {error && (
        <div className="border border-alert/30 bg-alert/5 px-4 py-3 text-[12px] text-alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="border border-ink/20 bg-bone px-4 py-3 text-[12px] text-ink">
          {notice}
        </div>
      )}

      {!filtered && !error && (
        <p className="text-[12px] text-smoke">Memuat…</p>
      )}

      {filtered && filtered.length === 0 && (
        <p className="text-[12px] text-smoke">Tidak ada user yang cocok dengan filter.</p>
      )}

      {filtered && filtered.length > 0 && (
        <div className="overflow-x-auto border border-ink/10">
          <table className="w-full min-w-[820px] text-left text-[12px]">
            <thead className="bg-bone">
              <tr className="text-[10px] uppercase tracking-widest2 text-smoke">
                <th className="px-3 py-2 font-normal">User</th>
                <th className="px-3 py-2 font-normal">Role</th>
                <th className="px-3 py-2 font-normal">Status</th>
                <th className="px-3 py-2 font-normal">Dibuat</th>
                <th className="px-3 py-2 font-normal">Terakhir masuk</th>
                <th className="px-3 py-2 font-normal">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/10">
              {filtered.map((u) => {
                const self = u.id === selfId;
                const busy = busyId === u.id;
                return (
                  <tr key={u.id} className={busy ? "opacity-50" : undefined}>
                    <td className="px-3 py-3 align-top">
                      <p className="text-ink">{u.name}</p>
                      <p className="text-[11px] text-smoke">{u.email}</p>
                      {self && (
                        <span className="mt-1 inline-block border border-brass px-1 text-[9px] uppercase tracking-widest2 text-brass">
                          akun Anda
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <select
                        disabled={self || busy}
                        value={u.primaryRole}
                        onChange={(e) =>
                          void patch(
                            u.id,
                            { roles: [e.target.value] },
                            `Role ${u.email} diubah menjadi ${e.target.value}.`
                          )
                        }
                        className="border border-ink/20 bg-white px-2 py-1 text-[11px] outline-none focus:border-ink disabled:opacity-50"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_DEFS[r].label}
                          </option>
                        ))}
                      </select>
                      {u.roles.length > 1 && (
                        <p className="mt-1 text-[10px] text-smoke">
                          +{u.roles.length - 1} role lain
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <select
                        disabled={self || busy}
                        value={u.status}
                        onChange={(e) =>
                          void patch(
                            u.id,
                            { status: e.target.value },
                            `Status ${u.email} diubah menjadi ${e.target.value}.`
                          )
                        }
                        className={`border border-ink/20 bg-white px-2 py-1 text-[11px] outline-none focus:border-ink disabled:opacity-50 ${STATUS_STYLE[u.status]}`}
                      >
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="PENDING">PENDING</option>
                        <option value="SUSPENDED">SUSPENDED</option>
                      </select>
                    </td>
                    <td className="px-3 py-3 align-top text-[11px] text-smoke">
                      {when(u.createdAt)}
                    </td>
                    <td className="px-3 py-3 align-top text-[11px] text-smoke">
                      {when(u.lastLoginAt)}
                    </td>
                    <td className="px-3 py-3 align-top">
                      {self ? (
                        <span className="text-[10px] uppercase tracking-widest2 text-smoke">
                          terkunci
                        </span>
                      ) : (
                        <span className="text-[10px] uppercase tracking-widest2 text-smoke">
                          ubah lewat kolom role/status
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-smoke">
        Pengaman: Super Admin tidak dapat mengubah role atau status akunnya sendiri, supaya
        sistem tidak bisa kehilangan admin terakhir. Perubahan role berlaku pada login
        berikutnya — sesi yang sedang berjalan memakai role saat cookie diterbitkan.
      </p>
    </div>
  );
}
