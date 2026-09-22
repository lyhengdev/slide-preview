import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldPlus, Users } from "lucide-react";
import { API_BASE_URL } from "../../lib/api";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Spinner } from "../../components/ui";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: "SUPER_ADMIN" | "EVENT_ADMIN";
}

export function AdminUsersPage() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: () =>
      fetch(`${API_BASE_URL}/admin/super/admin-users`, { credentials: "include" }).then((r) => {
        if (!r.ok) throw new Error("Super admin only");
        return r.json() as Promise<AdminUser[]>;
      }),
    retry: false,
  });

  const createUser = useMutation({
    mutationFn: async (body: { email: string; name: string; password: string; role: string }) => {
      const res = await fetch(`${API_BASE_URL}/admin/super/admin-users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json();
        throw new Error(b.error ?? "Could not create admin");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      setCreating(false);
    },
  });

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Admin Users</h1>
          <p className="text-sm text-ink-400">Manage platform administrators</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <ShieldPlus className="h-4 w-4" /> New Admin
        </Button>
      </div>

      {users.isLoading ? (
        <Spinner />
      ) : users.error ? (
        <Card className="p-6 text-sm text-amber-600">
          You need super admin access to manage admin users.
        </Card>
      ) : !users.data?.length ? (
        <Card>
          <EmptyState icon={<Users className="h-8 w-8" />} title="No admin users" />
        </Card>
      ) : (
        <Card className="divide-y divide-ink-100">
          {users.data.map((u) => (
            <div key={u.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="font-medium">{u.name}</p>
                <p className="text-xs text-ink-400">{u.email}</p>
              </div>
              <Badge color={u.role === "SUPER_ADMIN" ? "blue" : "default"}>{u.role}</Badge>
            </div>
          ))}
        </Card>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Create admin"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
            <Button type="submit" form="admin-form" loading={createUser.isPending}>Create</Button>
          </>
        }
      >
        <form
          id="admin-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            createUser.mutate(
              {
                email: String(form.get("email")),
                name: String(form.get("name")),
                password: String(form.get("password")),
                role: String(form.get("role")),
              },
              { onError: (err) => setError(err.message) }
            );
            setError(null);
          }}
        >
          <Field label="Name">
            <Input name="name" required placeholder="Event Admin" />
          </Field>
          <Field label="Email">
            <Input name="email" type="email" required placeholder="admin@ke.local" />
          </Field>
          <Field label="Password">
            <Input name="password" type="password" required placeholder="min 8 characters" />
          </Field>
          <Field label="Role">
            <select name="role" className="input">
              <option value="EVENT_ADMIN">Event Admin</option>
              <option value="SUPER_ADMIN">Super Admin</option>
            </select>
          </Field>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        </form>
      </Modal>
    </div>
  );
}