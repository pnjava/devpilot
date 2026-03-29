import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Member = {
  id: string;
  display_name: string;
  email: string;
  bitbucket_name: string | null;
  organisation: string;
  active: number;
};

const EMPTY_FORM = { display_name: "", email: "", bitbucket_name: "", organisation: "aciworldwide" };

export default function TeamMembers() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getTeamMembers();
      setMembers(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.display_name.trim() || !form.email.trim()) {
      setFormError("Name and email are required.");
      return;
    }
    setSaving(true);
    try {
      await api.addTeamMember({
        display_name: form.display_name.trim(),
        email: form.email.trim(),
        bitbucket_name: form.bitbucket_name.trim() || undefined,
        organisation: form.organisation.trim() || "aciworldwide",
      });
      setForm(EMPTY_FORM);
      await load();
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(member: Member) {
    try {
      await api.updateTeamMember(member.id, { active: member.active === 0 });
      setMembers((prev) =>
        prev.map((m) => (m.id === member.id ? { ...m, active: member.active === 0 ? 1 : 0 } : m))
      );
    } catch (e: any) {
      alert("Failed to update: " + e.message);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Remove "${name}" from the team? This cannot be undone.`)) return;
    try {
      await api.deleteTeamMember(id);
      setMembers((prev) => prev.filter((m) => m.id !== id));
    } catch (e: any) {
      alert("Failed to remove: " + e.message);
    }
  }

  const filtered = members.filter(
    (m) =>
      m.display_name.toLowerCase().includes(search.toLowerCase()) ||
      m.email.toLowerCase().includes(search.toLowerCase()) ||
      (m.bitbucket_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      m.organisation.toLowerCase().includes(search.toLowerCase())
  );

  const active = filtered.filter((m) => m.active === 1);
  const inactive = filtered.filter((m) => m.active === 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white mb-1">Team Members</h2>
        <p className="text-sm text-slate-400">
          Manage the team. Active members are used to filter PR views and activity feeds.
        </p>
      </div>

      {/* Add Member Form */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
        <h3 className="text-sm font-medium text-slate-300 mb-3">Add Member</h3>
        <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <input
            type="text"
            placeholder="Full name *"
            value={form.display_name}
            onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            className="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="email"
            placeholder="Email *"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="text"
            placeholder="Bitbucket display name"
            value={form.bitbucket_name}
            onChange={(e) => setForm({ ...form, bitbucket_name: e.target.value })}
            className="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex gap-2">
            <select
              value={form.organisation}
              onChange={(e) => setForm({ ...form, organisation: e.target.value })}
              className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="aciworldwide">ACI Worldwide</option>
              <option value="peerislands">PeerIslands</option>
            </select>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded transition-colors"
            >
              {saving ? "Adding…" : "Add"}
            </button>
          </div>
        </form>
        {formError && <p className="mt-2 text-sm text-red-400">{formError}</p>}
      </div>

      {/* Search + Stats */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <input
          type="search"
          placeholder="Search members…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex gap-3 text-sm text-slate-400 shrink-0">
          <span><span className="text-green-400 font-medium">{members.filter((m) => m.active === 1).length}</span> active</span>
          <span><span className="text-slate-500 font-medium">{members.filter((m) => m.active === 0).length}</span> inactive</span>
          <span><span className="text-white font-medium">{members.length}</span> total</span>
        </div>
      </div>

      {loading && <p className="text-slate-400 text-sm">Loading…</p>}
      {error && <p className="text-red-400 text-sm">Error: {error}</p>}

      {!loading && (
        <>
          <MemberTable
            members={active}
            title="Active"
            titleClass="text-green-400"
            onToggle={handleToggle}
            onDelete={handleDelete}
          />
          {inactive.length > 0 && (
            <MemberTable
              members={inactive}
              title="Inactive"
              titleClass="text-slate-500"
              onToggle={handleToggle}
              onDelete={handleDelete}
            />
          )}
          {filtered.length === 0 && !loading && (
            <p className="text-slate-500 text-sm text-center py-8">No members found.</p>
          )}
        </>
      )}
    </div>
  );
}

function MemberTable({
  members,
  title,
  titleClass,
  onToggle,
  onDelete,
}: {
  members: Member[];
  title: string;
  titleClass: string;
  onToggle: (m: Member) => void;
  onDelete: (id: string, name: string) => void;
}) {
  if (members.length === 0) return null;
  return (
    <div>
      <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${titleClass}`}>
        {title} ({members.length})
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-700">
              <th className="pb-2 pr-4 font-medium">Name</th>
              <th className="pb-2 pr-4 font-medium hidden sm:table-cell">Email</th>
              <th className="pb-2 pr-4 font-medium hidden md:table-cell">Bitbucket</th>
              <th className="pb-2 pr-4 font-medium hidden lg:table-cell">Org</th>
              <th className="pb-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {members.map((m) => (
              <tr key={m.id} className="group hover:bg-slate-800/50">
                <td className="py-2 pr-4 text-white font-medium">{m.display_name}</td>
                <td className="py-2 pr-4 text-slate-400 hidden sm:table-cell">{m.email}</td>
                <td className="py-2 pr-4 text-slate-400 hidden md:table-cell">
                  {m.bitbucket_name ?? <span className="text-slate-600 italic">—</span>}
                </td>
                <td className="py-2 pr-4 hidden lg:table-cell">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    m.organisation === "peerislands"
                      ? "bg-purple-900/50 text-purple-300"
                      : "bg-blue-900/50 text-blue-300"
                  }`}>
                    {m.organisation === "peerislands" ? "PeerIslands" : "ACI"}
                  </span>
                </td>
                <td className="py-2 text-right">
                  <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => onToggle(m)}
                      className={`text-xs px-2 py-1 rounded transition-colors ${
                        m.active === 1
                          ? "text-yellow-400 hover:bg-yellow-900/30"
                          : "text-green-400 hover:bg-green-900/30"
                      }`}
                      title={m.active === 1 ? "Deactivate" : "Activate"}
                    >
                      {m.active === 1 ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      onClick={() => onDelete(m.id, m.display_name)}
                      className="text-xs px-2 py-1 rounded text-red-400 hover:bg-red-900/30 transition-colors"
                      title="Remove"
                    >
                      Remove
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
