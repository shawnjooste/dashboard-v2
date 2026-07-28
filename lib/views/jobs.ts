import { createClient } from "@/lib/supabase/server";

export type JobStatus = "todo" | "in_progress" | "waiting" | "done" | "cancelled";

export type JobCard = {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  status: JobStatus;
  ownerProfileId: string | null;
  ownerLabel: string | null;
  assignees: { id: string; label: string }[];
  taskTotal: number;
  taskDone: number;
  waitingNote: string | null;
  fromQuote: boolean;
  dueDate: string | null;
  boardPosition: number;
  updatedAt: string;
};

export type JobTask = { id: string; label: string; done: boolean; assigneeProfileId: string | null; assigneeLabel: string | null; position: number };
export type JobUpdate = { id: string; kind: string; body: string | null; author: string | null; emailedCount: number; createdAt: string };

export type JobDetail = {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  status: JobStatus;
  ownerProfileId: string | null;
  ownerLabel: string | null;
  notes: string | null;
  waitingNote: string | null;
  dueDate: string | null;
  quoteId: string | null;
  quoteNumber: string | null;
  completedAt: string | null;
  tasks: JobTask[];
  updates: JobUpdate[];
};

export type StaffOption = { id: string; label: string };
export type ClientOption = { id: string; name: string };
export type AssigneeOption = { id: string; label: string; kind: "staff" | "client" };

/** A friendly label from an email local-part (staff rarely have people rows). */
function emailLabel(email: string | undefined | null): string | null {
  if (!email) return null;
  return email.split("@")[0].replace(/[._]/g, " ");
}

/** Every job for the board (staff RLS). */
export async function getJobBoard(): Promise<JobCard[]> {
  const supabase = await createClient();
  const [{ data: jobs }, { data: clients }, { data: tasks }, { data: profiles }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, client_id, title, owner_profile_id, status, waiting_note, quote_id, due_date, board_position, updated_at")
      .order("board_position", { ascending: true })
      .order("updated_at", { ascending: false }),
    supabase.from("clients").select("id, name"),
    supabase.from("job_tasks").select("job_id, done, assignee_profile_id"),
    supabase.from("profiles").select("id, email"),
  ]);
  const cn = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const em = new Map((profiles ?? []).map((p) => [p.id, p.email]));
  const counts = new Map<string, { t: number; d: number }>();
  const assigneeIds = new Map<string, Set<string>>();
  for (const t of tasks ?? []) {
    const c = counts.get(t.job_id) ?? { t: 0, d: 0 };
    c.t++;
    if (t.done) c.d++;
    counts.set(t.job_id, c);
    // Gate on !t.done: "assignees" must mean "still on the hook", matching
    // getMyWork's `!t.done` filter and the digest route's `.eq("done", false)`.
    // Without this gate, a job whose only assigned task someone already
    // completed would still show them in the board's "Just mine" filter
    // (via filterJobCards) and in the assignee dropdown options in
    // app/(admin)/admin/jobs/page.tsx, while /admin/jobs/mine and the digest
    // both correctly consider that person to have nothing open on it.
    if (t.assignee_profile_id && !t.done) {
      const set = assigneeIds.get(t.job_id) ?? new Set<string>();
      set.add(t.assignee_profile_id);
      assigneeIds.set(t.job_id, set);
    }
  }
  return (jobs ?? []).map((j) => {
    const c = counts.get(j.id) ?? { t: 0, d: 0 };
    return {
      id: j.id,
      title: j.title,
      clientId: j.client_id,
      clientName: cn.get(j.client_id) ?? "—",
      status: j.status as JobStatus,
      ownerProfileId: j.owner_profile_id,
      ownerLabel: emailLabel(em.get(j.owner_profile_id ?? "")),
      assignees: [...(assigneeIds.get(j.id) ?? [])].map((id) => ({
        id,
        label: emailLabel(em.get(id)) ?? id,
      })),
      taskTotal: c.t,
      taskDone: c.d,
      waitingNote: j.waiting_note,
      fromQuote: !!j.quote_id,
      dueDate: j.due_date,
      boardPosition: j.board_position,
      updatedAt: j.updated_at,
    };
  });
}

export async function getJobDetail(id: string): Promise<JobDetail | null> {
  const supabase = await createClient();
  const { data: j } = await supabase.from("jobs").select("*").eq("id", id).maybeSingle();
  if (!j) return null;
  const [{ data: client }, { data: tasks }, { data: updates }, { data: profiles }, quoteRes] = await Promise.all([
    supabase.from("clients").select("name").eq("id", j.client_id).maybeSingle(),
    supabase.from("job_tasks").select("id, label, done, assignee_profile_id, position").eq("job_id", id).order("position"),
    supabase.from("job_updates").select("id, kind, body, posted_by_profile_id, emailed_count, created_at").eq("job_id", id).order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, email"),
    j.quote_id ? supabase.from("quotes").select("quote_number").eq("id", j.quote_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const em = new Map((profiles ?? []).map((p) => [p.id, p.email]));
  return {
    id: j.id,
    title: j.title,
    clientId: j.client_id,
    clientName: client?.name ?? "—",
    status: j.status as JobStatus,
    ownerProfileId: j.owner_profile_id,
    ownerLabel: emailLabel(em.get(j.owner_profile_id ?? "")),
    notes: j.notes,
    waitingNote: j.waiting_note,
    dueDate: j.due_date,
    quoteId: j.quote_id,
    quoteNumber: (quoteRes.data as { quote_number: string } | null)?.quote_number ?? null,
    completedAt: j.completed_at,
    tasks: (tasks ?? []).map((t) => ({ id: t.id, label: t.label, done: t.done, assigneeProfileId: t.assignee_profile_id, assigneeLabel: emailLabel(em.get(t.assignee_profile_id ?? "")), position: t.position })),
    updates: (updates ?? []).map((u) => ({ id: u.id, kind: u.kind, body: u.body, author: emailLabel(em.get(u.posted_by_profile_id ?? "")), emailedCount: u.emailed_count, createdAt: u.created_at })),
  };
}

export async function getJobFormOptions(): Promise<{ clients: ClientOption[]; staff: StaffOption[] }> {
  const supabase = await createClient();
  const [{ data: clients }, { data: staff }] = await Promise.all([
    supabase.from("clients").select("id, name").order("name"),
    supabase.from("profiles").select("id, email").eq("role", "rocking_staff").eq("status", "active"),
  ]);
  return {
    clients: (clients ?? []).map((c) => ({ id: c.id, name: c.name })),
    staff: (staff ?? []).map((s) => ({ id: s.id, label: emailLabel(s.email) ?? s.email })),
  };
}

export type MyJob = {
  id: string;
  title: string;
  clientName: string;
  status: JobStatus;
  dueDate: string | null;
  taskTotal: number;
  taskDone: number;
};
export type MyTask = {
  id: string;
  label: string;
  jobId: string;
  jobTitle: string;
  clientName: string;
  dueDate: string | null;
};
export type MyWork = { ownedJobs: MyJob[]; assignedTasks: MyTask[] };

/** One staffer's open work: jobs they own, and incomplete tasks assigned to them. */
export async function getMyWork(profileId: string): Promise<MyWork> {
  const supabase = await createClient();
  // One tasks query serves both purposes: the done/total counts need every task,
  // and the assigned list is the incomplete subset of the same rows.
  const [{ data: jobs }, { data: clients }, { data: tasks }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, client_id, title, owner_profile_id, status, due_date")
      .not("status", "in", "(done,cancelled)"),
    supabase.from("clients").select("id, name"),
    supabase.from("job_tasks").select("id, job_id, label, done, assignee_profile_id"),
  ]);
  const cn = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const openJobs = jobs ?? [];
  const byId = new Map(openJobs.map((j) => [j.id, j]));

  const counts = new Map<string, { t: number; d: number }>();
  for (const t of tasks ?? []) {
    const c = counts.get(t.job_id) ?? { t: 0, d: 0 };
    c.t++;
    if (t.done) c.d++;
    counts.set(t.job_id, c);
  }

  const ownedJobs: MyJob[] = openJobs
    .filter((j) => j.owner_profile_id === profileId)
    .map((j) => {
      const c = counts.get(j.id) ?? { t: 0, d: 0 };
      return {
        id: j.id,
        title: j.title,
        clientName: cn.get(j.client_id) ?? "—",
        status: j.status as JobStatus,
        dueDate: j.due_date,
        taskTotal: c.t,
        taskDone: c.d,
      };
    });

  const assignedTasks: MyTask[] = (tasks ?? [])
    .filter((t) => !t.done && t.assignee_profile_id === profileId && byId.has(t.job_id))
    .map((t) => {
      const j = byId.get(t.job_id)!;
      return {
        id: t.id,
        label: t.label,
        jobId: j.id,
        jobTitle: j.title,
        clientName: cn.get(j.client_id) ?? "—",
        dueDate: j.due_date,
      };
    });

  return { ownedJobs, assignedTasks };
}

/** People a task can be assigned to: all active staff + this client's active managers. */
export async function getJobAssignees(clientId: string): Promise<AssigneeOption[]> {
  const supabase = await createClient();
  const [{ data: staff }, { data: managers }] = await Promise.all([
    supabase.from("profiles").select("id, email").eq("role", "rocking_staff").eq("status", "active"),
    supabase
      .from("profiles")
      .select("id, email, people:person_id(display_name)")
      .eq("role", "client_manager")
      .eq("status", "active")
      .eq("client_id", clientId),
  ]);
  const staffOpts: AssigneeOption[] = (staff ?? []).map((s) => ({
    id: s.id,
    label: emailLabel(s.email) ?? s.email,
    kind: "staff",
  }));
  const clientOpts: AssigneeOption[] = (managers ?? []).map((m) => {
    const person = (Array.isArray(m.people) ? m.people[0] : m.people) as { display_name: string | null } | null;
    return { id: m.id, label: person?.display_name?.trim() || emailLabel(m.email) || m.email, kind: "client" };
  });
  const byLabel = (a: AssigneeOption, b: AssigneeOption) => a.label.localeCompare(b.label);
  return [...staffOpts.sort(byLabel), ...clientOpts.sort(byLabel)];
}
