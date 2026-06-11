import type { M365User } from "@/lib/views/m365";
import { Card, CardHeader } from "./ui/Card";

/**
 * Licensed-users drill-down table. With `license` set, shows everyone holding
 * that licence; otherwise all active licensed users.
 */
export function M365UsersTable({
  users,
  license,
}: {
  users: M365User[];
  license?: string;
}) {
  const rows = license
    ? users.filter((u) => u.licenses.includes(license))
    : users.filter((u) => u.licensed);

  return (
    <Card>
      <CardHeader title={license ?? "Licensed users"} count={rows.length} />
      {rows.length === 0 ? (
        <p className="px-4 py-3.5 text-sm text-muted">
          {license ? "Nobody holds this licence." : "No licensed users found."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line-soft text-left text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Name</th>
                <th className="px-4 py-2.5 font-semibold">Email</th>
                <th className="px-4 py-2.5 font-semibold">Licences</th>
                <th className="px-4 py-2.5 font-semibold">Two-step sign-in</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.upn} className="border-b border-line-soft last:border-0 hover:bg-canvas">
                  <td className="px-4 py-2.5 font-medium text-ink">{u.name}</td>
                  <td className="px-4 py-2.5 text-ink-2">{u.upn}</td>
                  <td className="px-4 py-2.5">
                    {u.licenses.length === 0 ? (
                      <span className="text-faint">—</span>
                    ) : (
                      <span className="flex flex-wrap gap-1.5">
                        {u.licenses.map((l) => (
                          <span
                            key={l}
                            className={`rounded bg-line-soft px-1.5 py-0.5 text-xs ${
                              l === license ? "font-semibold text-ink" : "text-ink-3"
                            }`}
                          >
                            {l}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {u.mfaStrong ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-[7px] w-[7px] rounded-full bg-good-dot" />
                        <span className="text-[12.5px] font-medium text-good">
                          On{u.methods.length > 0 ? ` · ${u.methods.join(", ")}` : ""}
                        </span>
                      </span>
                    ) : (
                      <span className="rounded-full bg-brand-tint px-[11px] py-1 text-[12.5px] font-semibold text-brand">
                        Off
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
