"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

/**
 * Staff & role management (plan §11.5).
 * Invite by email (account must exist), activate/suspend/revoke, last
 * superadmin is protected server-side.
 */

interface StaffRow {
  id: string;
  email: string | null;
  roleName: string;
  status: string;
  invitedAt: string;
}

interface RoleRow {
  id: string;
  name: string;
  isSystem: boolean;
}

export default function StaffManager() {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const [staffRes, rolesRes] = await Promise.all([
      fetch("/api/admin/staff"),
      fetch("/api/admin/roles"),
    ]);
    const staffBody = await staffRes.json();
    const rolesBody = await rolesRes.json();
    if (staffBody.ok) setStaff(staffBody.data.staff);
    if (rolesBody.ok) {
      setRoles(rolesBody.data.roles);
      if (!inviteRole && rolesBody.data.roles.length > 0) {
        setInviteRole(rolesBody.data.roles[0].id);
      }
    }
  }, [inviteRole]);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    const res = await fetch("/api/admin/staff/invitations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, roleId: inviteRole }),
    });
    const body = await res.json();
    setMessage(body.ok ? "Invitation created." : body.message ?? "Invite failed");
    if (body.ok) {
      setInviteEmail("");
      void load();
    }
  }

  async function act(id: string, action: string) {
    const res = await fetch(`/api/admin/staff/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const body = await res.json();
    setMessage(body.ok ? `${action} done.` : body.message ?? "Action failed");
    void load();
  }

  const inputClass =
    "border-4 border-black bg-white px-3 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-black";

  return (
    <div>
      <h1 className="text-3xl font-black uppercase tracking-tighter">Staff & Roles</h1>

      <form onSubmit={invite} className="mt-6 flex flex-wrap items-end gap-3 border-4 border-black bg-white p-4 shadow-neo">
        <label className="text-xs font-black uppercase">
          Email
          <input
            type="email"
            required
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className={`${inputClass} mt-1 block`}
            placeholder="staff@college.edu"
          />
        </label>
        <label className="text-xs font-black uppercase">
          Role
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
            className={`${inputClass} mt-1 block`}
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.isSystem ? " (system)" : ""}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="primary">
          Invite
        </Button>
        <p className="text-xs font-bold text-black/50">
          The person must already have an account with this email.
        </p>
      </form>

      {message && (
        <p className="mt-3 border-4 border-black bg-neo-secondary px-3 py-2 text-sm font-bold">{message}</p>
      )}

      <div className="mt-6 overflow-x-auto border-4 border-black bg-white shadow-neo">
        <table className="w-full text-left text-sm">
          <thead className="border-b-4 border-black bg-neo-secondary">
            <tr>
              <th className="px-3 py-2 font-black uppercase">Email</th>
              <th className="px-3 py-2 font-black uppercase">Role</th>
              <th className="px-3 py-2 font-black uppercase">Status</th>
              <th className="px-3 py-2 font-black uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} className="border-b-2 border-black/20">
                <td className="px-3 py-2 font-bold">{s.email ?? "—"}</td>
                <td className="px-3 py-2">{s.roleName}</td>
                <td className="px-3 py-2">
                  <span className="border-2 border-black bg-neo-muted px-2 py-0.5 text-xs font-black uppercase">
                    {s.status}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    {s.status === "INVITED" && (
                      <ActionBtn onClick={() => act(s.id, "ACTIVATE")}>Activate</ActionBtn>
                    )}
                    {s.status === "ACTIVE" && (
                      <ActionBtn onClick={() => act(s.id, "SUSPEND")}>Suspend</ActionBtn>
                    )}
                    {s.status === "SUSPENDED" && (
                      <ActionBtn onClick={() => act(s.id, "ACTIVATE")}>Reactivate</ActionBtn>
                    )}
                    {(s.status === "ACTIVE" || s.status === "SUSPENDED" || s.status === "INVITED") && (
                      <ActionBtn onClick={() => act(s.id, "REVOKE")}>Revoke</ActionBtn>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {staff.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center font-bold text-black/50">
                  No staff yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ActionBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="border-2 border-black bg-white px-2 py-1 text-xs font-black uppercase hover:bg-neo-secondary"
    >
      {children}
    </button>
  );
}
