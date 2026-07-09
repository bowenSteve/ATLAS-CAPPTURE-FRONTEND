import React, { useState, useEffect, useCallback } from "react";
import { adminListUsers, adminUpdateUser, adminDeleteUser } from "../../services/api";

export default function Users() {
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // { id, credits, role, is_active }
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminListUsers(0, 50, search);
      setUsers(res?.items ?? []);
      setTotal(res?.total ?? 0);
    } catch {}
    setLoading(false);
  }, [search]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  function startEdit(user) {
    setEditing({ id: user.id, name: user.name, credits: user.credits, role: user.role, is_active: user.is_active });
  }

  async function saveEdit() {
    setSaving(true);
    try {
      const updated = await adminUpdateUser(editing.id, {
        name: editing.name,
        credits: Number(editing.credits),
        role: editing.role,
        is_active: editing.is_active,
      });
      setUsers((prev) => prev.map((u) => (u.id === editing.id ? { ...u, ...updated } : u)));
      setEditing(null);
    } catch {}
    setSaving(false);
  }

  async function deleteUser(id) {
    if (!window.confirm("Delete this user permanently?")) return;
    await adminDeleteUser(id);
    setUsers((prev) => prev.filter((u) => u.id !== id));
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Users <span className="text-gray-400 font-normal text-base">({total})</span></h2>
        <button onClick={load} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition">Refresh</button>
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by email or name…"
        className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-indigo-500 transition mb-4"
      />

      {loading ? (
        <div className="py-10 text-center text-gray-400 text-sm">Loading…</div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
          <table className="w-full text-xs">
            <thead className="border-b border-gray-100 dark:border-gray-800">
              <tr className="text-gray-400">
                <th className="text-left px-4 py-3 font-medium">Email</th>
                <th className="text-left px-4 py-3 font-medium">Credits</th>
                <th className="text-left px-4 py-3 font-medium">Role</th>
                <th className="text-left px-4 py-3 font-medium">Jobs</th>
                <th className="text-left px-4 py-3 font-medium">Last Active</th>
                <th className="text-left px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-gray-50 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                  <td className="px-4 py-2.5">
                    <div className="text-gray-900 dark:text-white font-medium">{u.email}</div>
                    <div className="text-gray-400">{u.name}</div>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300 font-medium">{u.credits?.toFixed(1)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      u.role === "admin"
                        ? "bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300"
                        : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                    }`}>
                      {u.role}
                    </span>
                    {!u.is_active && <span className="ml-1 text-red-400 text-xs">disabled</span>}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{u.annotation_count}</td>
                  <td className="px-4 py-2.5 text-gray-400">
                    {u.last_active
                      ? new Date(u.last_active).toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi" })
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-2">
                      <button
                        onClick={() => startEdit(u)}
                        className="text-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteUser(u.id)}
                        className="text-red-400 hover:text-red-500 transition"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-sm border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Edit User #{editing.id}</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Name</label>
                <input
                  type="text"
                  value={editing.name || ""}
                  onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))}
                  className="mt-1 w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 transition"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Credits</label>
                <input
                  type="number"
                  step="0.1"
                  value={editing.credits}
                  onChange={(e) => setEditing((p) => ({ ...p, credits: e.target.value }))}
                  className="mt-1 w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 transition"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Role</label>
                <select
                  value={editing.role}
                  onChange={(e) => setEditing((p) => ({ ...p, role: e.target.value }))}
                  className="mt-1 w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 transition"
                >
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="active"
                  checked={editing.is_active}
                  onChange={(e) => setEditing((p) => ({ ...p, is_active: e.target.checked }))}
                  className="rounded"
                />
                <label htmlFor="active" className="text-sm text-gray-700 dark:text-gray-300">Account active</label>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={saveEdit}
                disabled={saving}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 rounded-xl text-sm transition disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => setEditing(null)}
                className="flex-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-900 dark:text-white font-medium py-2.5 rounded-xl text-sm transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
