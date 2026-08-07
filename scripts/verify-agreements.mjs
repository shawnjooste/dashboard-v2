// Throwaway end-to-end + security proof for the agreements feature.
//
//   node scripts/verify-agreements.mjs
//
// Creates a temp client, two temp managers (same client + a different client)
// and a temp member, exercises the whole flow with REAL user JWTs so RLS is
// genuinely in play, then deletes everything it made. Nothing it touches
// belongs to a real client.

import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const svc = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PW = "Verify!" + Math.random().toString(36).slice(2, 12);
const stamp = Date.now();
const made = { users: [], clients: [], agreements: [], objects: [] };

let pass = 0;
const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  if (ok) pass++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function makeUser(email, role, clientId) {
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password: PW,
    email_confirm: true,
  });
  if (error) throw error;
  made.users.push(data.user.id);
  // The profile row is created by a trigger on signup; upsert to be sure it
  // carries the role/client we need.
  const { error: pe } = await svc
    .from("profiles")
    .upsert({ id: data.user.id, email, role, client_id: clientId, status: "active" });
  if (pe) throw pe;
  return data.user.id;
}

async function asUser(email) {
  const c = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}

const BODY = `# Test Services Agreement

## 1. Scope

1. Rocking One will provide **managed IT services** to the Client.
2. The Client will provide reasonable access to its systems.

## 2. Term

- Runs for twelve months from the signature date.
- Either party may terminate on 30 days' written notice.
`;

async function main() {
  console.log("Setting up throwaway records…");

  const { data: c1 } = await svc
    .from("clients")
    .insert({ name: `ZZ Verify A ${stamp}`, status: "active" })
    .select("id, name")
    .single();
  const { data: c2 } = await svc
    .from("clients")
    .insert({ name: `ZZ Verify B ${stamp}`, status: "active" })
    .select("id, name")
    .single();
  made.clients.push(c1.id, c2.id);

  const mgrEmail = `zz-verify-mgr-${stamp}@rocking.one`;
  const otherEmail = `zz-verify-other-${stamp}@rocking.one`;
  const memberEmail = `zz-verify-member-${stamp}@rocking.one`;
  const mgrId = await makeUser(mgrEmail, "client_manager", c1.id);
  await makeUser(otherEmail, "client_manager", c2.id);
  await makeUser(memberEmail, "client_member", c1.id);

  const mgr = await asUser(mgrEmail);
  const other = await asUser(otherEmail);
  const member = await asUser(memberEmail);

  // --- draft ---------------------------------------------------------------
  const { data: agr, error: ce } = await svc
    .from("agreements")
    .insert({ client_id: c1.id, title: "Test Services Agreement", body_md: BODY })
    .select("id, reference, status")
    .single();
  if (ce) throw ce;
  made.agreements.push(agr.id);
  check("reference generated", /^AGR-\d{4}-\d{3}$/.test(agr.reference), agr.reference);

  const draftSeen = await mgr.from("agreements").select("id").eq("id", agr.id);
  check("draft is invisible to the client manager", (draftSeen.data ?? []).length === 0);

  const draftSign = await mgr.rpc("sign_agreement", {
    p_agreement_id: agr.id,
    p_signer_name: "Too Early",
    p_ip: "",
    p_user_agent: "",
  });
  check("a draft cannot be signed", !!draftSign.error, draftSign.error?.message);

  // --- sent ----------------------------------------------------------------
  await svc.from("agreements").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", agr.id);

  const sentSeen = await mgr.from("agreements").select("id, body_md").eq("id", agr.id);
  check("sent agreement is visible to its client's manager", (sentSeen.data ?? []).length === 1);

  const otherSeen = await other.from("agreements").select("id").eq("id", agr.id);
  check("another client's manager sees 0 rows", (otherSeen.data ?? []).length === 0);

  const memberSeen = await member.from("agreements").select("id").eq("id", agr.id);
  check("a client_member of the same client sees 0 rows", (memberSeen.data ?? []).length === 0);

  const otherSign = await other.rpc("sign_agreement", {
    p_agreement_id: agr.id,
    p_signer_name: "Wrong Company",
    p_ip: "",
    p_user_agent: "",
  });
  check("another client's manager cannot sign it", !!otherSign.error, otherSign.error?.message);

  const memberSign = await member.rpc("sign_agreement", {
    p_agreement_id: agr.id,
    p_signer_name: "Not A Manager",
    p_ip: "",
    p_user_agent: "",
  });
  check("a client_member cannot sign it", !!memberSign.error, memberSign.error?.message);

  // feature override off → invisible and unsignable
  await svc.from("profiles").update({ feature_overrides: { agreements: false } }).eq("id", mgrId);
  const mgrOff = await asUser(mgrEmail);
  const offSeen = await mgrOff.from("agreements").select("id").eq("id", agr.id);
  check("feature override off ⇒ 0 rows", (offSeen.data ?? []).length === 0);
  const offSign = await mgrOff.rpc("sign_agreement", {
    p_agreement_id: agr.id,
    p_signer_name: "Feature Off",
    p_ip: "",
    p_user_agent: "",
  });
  check("feature override off ⇒ cannot sign", !!offSign.error, offSign.error?.message);
  await svc.from("profiles").update({ feature_overrides: null }).eq("id", mgrId);

  // --- signing -------------------------------------------------------------
  const mgr2 = await asUser(mgrEmail);
  const { data: signed, error: se } = await mgr2.rpc("sign_agreement", {
    p_agreement_id: agr.id,
    p_signer_name: "  Jane Verify  ",
    p_ip: "41.13.5.7",
    p_user_agent: "Mozilla/5.0 (verify script)",
  });
  check("the client's manager can sign", !se, se?.message);
  const row = Array.isArray(signed) ? signed[0] : signed;
  check("signer name is trimmed", row?.signer_name === "Jane Verify", JSON.stringify(row?.signer_name));
  check("signer email is taken from the session, not the form", row?.signer_email === mgrEmail, row?.signer_email);
  check("IP recorded", row?.signer_ip === "41.13.5.7", row?.signer_ip);

  const twice = await mgr2.rpc("sign_agreement", {
    p_agreement_id: agr.id,
    p_signer_name: "Jane Again",
    p_ip: "",
    p_user_agent: "",
  });
  check("a second signature is refused", !!twice.error, twice.error?.message);

  // --- immutability, proven with the SERVICE ROLE (bypasses RLS, not triggers)
  const bodyPatch = await svc.from("agreements").update({ body_md: "# Tampered" }).eq("id", agr.id);
  check("signed body cannot be altered", !!bodyPatch.error, bodyPatch.error?.message);
  const namePatch = await svc.from("agreements").update({ signer_name: "Someone Else" }).eq("id", agr.id);
  check("signer name cannot be altered", !!namePatch.error, namePatch.error?.message);
  const statusPatch = await svc.from("agreements").update({ status: "void" }).eq("id", agr.id);
  check("a signed agreement cannot be voided", !!statusPatch.error, statusPatch.error?.message);
  const titlePatch = await svc.from("agreements").update({ title: "Renamed" }).eq("id", agr.id);
  check("title cannot be altered", !!titlePatch.error, titlePatch.error?.message);

  const mgrWrite = await mgr2.from("agreements").update({ body_md: "# Client tamper" }).eq("id", agr.id);
  const { data: afterMgrWrite } = await svc.from("agreements").select("body_md").eq("id", agr.id).single();
  check(
    "a manager cannot write to the agreement at all",
    afterMgrWrite.body_md === BODY,
    mgrWrite.error?.message ?? "0 rows updated",
  );

  // --- PDF -----------------------------------------------------------------
  const { buildAgreementPdf } = await import("../lib/agreements/pdf.ts");
  const pdf = await buildAgreementPdf({
    reference: row.reference,
    title: row.title,
    bodyMd: row.body_md,
    clientName: c1.name,
    signerName: row.signer_name,
    signerEmail: row.signer_email,
    signedAt: row.signed_at,
    signerIp: row.signer_ip,
  });
  const path = `${c1.id}/${agr.id}.pdf`;
  const up = await svc.storage.from("agreement-pdfs").upload(path, Buffer.from(pdf), {
    contentType: "application/pdf",
    upsert: true,
  });
  check("PDF uploads to the private bucket", !up.error, up.error?.message);
  if (!up.error) made.objects.push(path);

  const pdfPatch = await svc.from("agreements").update({ pdf_path: path }).eq("id", agr.id);
  check("pdf_path is still writable on a signed row", !pdfPatch.error, pdfPatch.error?.message);

  // The bucket must not be readable without a signed URL.
  const anon = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const pub = await fetch(`${URL_}/storage/v1/object/public/agreement-pdfs/${path}`);
  check("the PDF is not publicly fetchable", pub.status >= 400, `HTTP ${pub.status}`);
  const anonDl = await anon.storage.from("agreement-pdfs").download(path);
  check("anon cannot download the PDF object", !!anonDl.error, anonDl.error?.message);
  const mgrDl = await mgr2.storage.from("agreement-pdfs").download(path);
  check("a signed-in manager cannot reach the object directly", !!mgrDl.error, mgrDl.error?.message);

  const { data: signedUrl } = await svc.storage.from("agreement-pdfs").createSignedUrl(path, 60);
  const got = await fetch(signedUrl.signedUrl);
  const bytes = Buffer.from(await got.arrayBuffer());
  check("a signed URL serves the PDF", got.ok && bytes.length === pdf.length, `${bytes.length} bytes`);

  // A signed agreement whose PDF never stored must still be downloadable —
  // agreementPdfUrl() rebuilds it from the frozen row. Simulate the failure by
  // removing both the object and the pointer.
  await svc.storage.from("agreement-pdfs").remove([path]);
  const clearPtr = await svc.from("agreements").update({ pdf_path: null }).eq("id", agr.id);
  check("pdf_path can be cleared on a signed row", !clearPtr.error, clearPtr.error?.message);
  const { ensureAgreementPdf } = await import("../lib/views/agreements.ts");
  const rebuiltPath = await ensureAgreementPdf(agr.id);
  check("missing PDF is rebuilt on download", rebuiltPath === path, String(rebuiltPath));

  const { data: afterRebuild } = await svc.from("agreements").select("pdf_path").eq("id", agr.id).single();
  check("pdf_path is restored on the row", afterRebuild.pdf_path === path, afterRebuild.pdf_path);

  const { data: url2 } = await svc.storage.from("agreement-pdfs").createSignedUrl(path, 60);
  const got2 = await fetch(url2.signedUrl);
  const bytes2 = Buffer.from(await got2.arrayBuffer());
  check(
    "the rebuilt PDF is identical to the original",
    got2.ok && Buffer.compare(bytes2, bytes) === 0,
    `${bytes2.length} vs ${bytes.length} bytes`,
  );

  writeFileSync(new URL("../verify-agreement.pdf", import.meta.url), bytes);
  console.log(`\n  PDF written to verify-agreement.pdf (${bytes.length} bytes) for visual inspection`);

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${pass}/${checks.length} checks passed`);
  if (failed.length) console.log("FAILED:\n" + failed.map((f) => `  - ${f.name}`).join("\n"));
  return failed.length === 0;
}

async function cleanup() {
  console.log("\nCleaning up…");
  if (made.objects.length) await svc.storage.from("agreement-pdfs").remove(made.objects);
  for (const id of made.agreements) {
    // The freeze trigger blocks UPDATE, not DELETE — temp rows must not linger.
    const { error } = await svc.from("agreements").delete().eq("id", id);
    if (error) console.log(`  ! agreement ${id}: ${error.message}`);
  }
  for (const id of made.users) await svc.auth.admin.deleteUser(id);
  for (const id of made.clients) {
    const { error } = await svc.from("clients").delete().eq("id", id);
    if (error) console.log(`  ! client ${id}: ${error.message}`);
  }
  const left = await svc.from("agreements").select("id").in("id", made.agreements.length ? made.agreements : ["x"]);
  const leftClients = await svc.from("clients").select("id, name").ilike("name", "ZZ Verify%");
  console.log(
    `  agreements left: ${(left.data ?? []).length}, ZZ Verify clients left: ${(leftClients.data ?? []).length}`,
  );
}

let ok = false;
try {
  ok = await main();
} catch (e) {
  console.error("\nERROR:", e.message);
} finally {
  await cleanup();
}
process.exit(ok ? 0 : 1);
