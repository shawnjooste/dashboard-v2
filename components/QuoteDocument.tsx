import Image from "next/image";
import logo from "@/public/rocking-logo.png";
import { computeTotals, fmtMoney, type QuoteDoc, type ComparisonTable } from "@/lib/quotes/doc";
import s from "./QuoteDocument.module.css";

/** Read-only A4 render of a quote document — the portal twin of the print
 *  template. Browser print produces the same output as the original. */
export function QuoteDocument({ doc }: { doc: QuoteDoc }) {
  const totals = computeTotals(doc);
  const rate = doc.vatPercent;

  return (
    <div className={s.page}>
      <header className={s.docHeader}>
        <Image src={logo} alt="Rocking" className={s.brandLogo} />
        <div className={s.brandMeta}>
          <div className={s.brandName}>{doc.company.name}</div>
          {doc.company.addressLines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
          <div>VAT Number: {doc.company.vat}</div>
        </div>
      </header>

      <section className={s.parties}>
        <div>
          <div className={s.blockLabel}>Quote To</div>
          <div className={s.clientName}>{doc.client.name}</div>
          {doc.client.addressLines.map((line, i) => (
            <div key={i} className={s.clientLine}>{line}</div>
          ))}
          {doc.client.attention && (
            <div className={`${s.clientLine} ${s.attn}`}>Attn: {doc.client.attention}</div>
          )}
        </div>
        <div className={s.quoteMeta}>
          {[
            ["Quote Number", doc.meta.quoteNumber],
            ["Date", doc.meta.date],
            ["Valid Until", doc.meta.validUntil],
            ["Prepared by", doc.meta.preparedBy],
          ].map(([label, value]) => (
            <div key={label} className={s.metaRow}>
              <span className={s.metaLabel}>{label}</span>
              <span className={s.metaValue}>{value}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={s.projectBlock}>
        <h1 className={s.projectTitle}>{doc.projectTitle}</h1>
        <p className={s.projectIntro}>{doc.projectIntro}</p>
      </section>

      {doc.comparisonTable && <ComparisonBlock table={doc.comparisonTable} />}

      {doc.sections.map((sec, sIdx) => {
        const st = totals.sections[sIdx];
        return (
          <section key={sec.id || sIdx} className={s.section}>
            <div className={s.sectionHead}>
              <h2 className={s.sectionTitle}>{sec.title}</h2>
              {sec.subtitle && <span className={s.sectionSub}>{sec.subtitle}</span>}
            </div>
            <table className={s.lines}>
              <colgroup>
                <col className={s.colDesc} />
                <col className={s.colQty} />
                <col className={s.colUnit} />
                <col className={s.colTotal} />
              </colgroup>
              <thead>
                <tr>
                  <th>Description</th>
                  <th className={s.thNum}>Qty</th>
                  <th className={s.thNum}>
                    Unit Price <span className={s.thSub}>(ex VAT)</span>
                  </th>
                  <th className={s.thNum}>
                    Total <span className={s.thSub}>(ex VAT)</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sec.groups.map((g, gIdx) => (
                  <FragmentGroup key={gIdx} group={g} />
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className={s.totLabel}>Subtotal (ex VAT)</td>
                  <td className={`${s.cellNum} ${s.strong}`}>{fmtMoney(st.subtotal)}</td>
                </tr>
                <tr>
                  <td colSpan={3} className={s.totLabel}>VAT ({Math.round(rate)}%)</td>
                  <td className={`${s.cellNum} ${s.strong}`}>{fmtMoney(st.vat)}</td>
                </tr>
                <tr className={s.grandRow}>
                  <td colSpan={3} className={s.totLabel}>{sec.totalLabel}</td>
                  <td className={`${s.cellNum} ${s.strong}`}>{fmtMoney(st.grand)}</td>
                </tr>
              </tfoot>
            </table>
          </section>
        );
      })}

      <section className={s.summary}>
        <h3 className={s.blockTitle}>Cost Summary</h3>
        <div className={s.summaryRows}>
          {totals.sections.map((st, i) => (
            <div key={i} className={s.summaryRow}>
              <span className={s.summaryLabel}>
                {st.totalLabel.replace(/\s*\(.*?\)\s*$/, "")} (incl VAT)
              </span>
              <span className={s.summaryDots} />
              <span className={s.summaryValue}>
                {fmtMoney(st.grand)}
                {st.monthly ? " / month" : ""}
              </span>
            </div>
          ))}
        </div>
        {doc.summaryNote && <p className={s.summaryNote}>{doc.summaryNote}</p>}
      </section>

      {doc.terms.length > 0 && (
        <section className={s.terms}>
          <h3 className={s.blockTitle}>Terms &amp; Conditions</h3>
          <ul>
            {doc.terms.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </section>
      )}

      <section className={s.banking}>
        <h3 className={s.blockTitle}>Banking Details</h3>
        <div className={s.bankGrid}>
          <div><span className={s.bankLabel}>Bank</span>{doc.banking.bank}</div>
          <div><span className={s.bankLabel}>Account</span>{doc.banking.account}</div>
          <div><span className={s.bankLabel}>Branch</span>{doc.banking.branch}</div>
          <div><span className={s.bankLabel}>Branch Code</span>{doc.banking.branchCode}</div>
        </div>
        <p className={s.bankRef}>{doc.banking.reference}</p>
      </section>

      <footer className={s.docFooter}>
        Company Registration No: {doc.company.regNumber}
        <span className={s.dot}>·</span>
        Registered Office: {doc.company.registeredOffice}
      </footer>
    </div>
  );
}

function ComparisonBlock({ table }: { table: ComparisonTable }) {
  return (
    <section className={s.comparison}>
      <div className={s.sectionHead}>
        <h2 className={s.sectionTitle}>Cost Comparison</h2>
      </div>
      <table className={s.compTable}>
        <colgroup>
          <col className={s.compColLabel} />
          <col className={s.compColVal} />
          <col className={s.compColVal} />
        </colgroup>
        <thead>
          <tr>
            <th></th>
            <th className={s.compTh}>{table.beforeLabel}</th>
            <th className={s.compTh}>{table.afterLabel}</th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i} className={row.isTotal ? s.compTotRow : undefined}>
              <td className={row.isTotal ? s.compTotLabel : s.compLabel}>{row.label}</td>
              <td className={`${s.compCell} ${row.isTotal ? s.compTotCell : ""}`}>{row.before}</td>
              <td className={`${s.compCell} ${s.compAfter} ${row.isTotal ? s.compTotCell : ""}`}>{row.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function FragmentGroup({ group }: { group: QuoteDoc["sections"][number]["groups"][number] }) {
  return (
    <>
      {group.name && (
        <tr className={s.groupRow}>
          <td colSpan={4}>{group.name}</td>
        </tr>
      )}
      {group.items.map((it, i) => {
        const total = it.qty != null && it.unitPrice != null ? it.qty * it.unitPrice : null;
        return (
          <tr key={i}>
            <td>
              <div className={s.lineDesc}>{it.description}</div>
              {it.detail && <div className={s.lineDetail}>{it.detail}</div>}
            </td>
            <td className={s.cellNum}>{it.qty == null ? "—" : it.qty}</td>
            <td className={s.cellNum}>
              {it.unitPrice == null ? (it.usageNote ?? "—") : fmtMoney(it.unitPrice)}
            </td>
            <td className={`${s.cellNum} ${s.strong}`}>
              {total == null ? (it.totalNote ?? "—") : fmtMoney(total)}
            </td>
          </tr>
        );
      })}
    </>
  );
}
