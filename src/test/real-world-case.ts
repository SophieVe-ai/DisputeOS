// A case file written the way real documents are: prose contract, table-layout invoice,
// free-text delivery confirmation and bank transfer. The rules parser reads none of the figures.
import type { NewCaseInput } from "@/lib/repo/cases";
import type { Extraction } from "@/lib/agents/extraction";

export const REAL_WORLD_CASE: NewCaseInput & { id: string } = {
  id: "case-real-world",
  reference: "REAL-1",
  title: "Coffee equipment — Brightside Cafés",
  creditor: "Acme Coffee Equipment Ltd",
  debtor: "Brightside Cafés Ltd",
  debtorEmail: null,
  claimedAmountPence: 286_000,
  summary: "Real-format documents.",
  documents: [
    {
      kind: "contract",
      title: "Supply agreement",
      docDate: null,
      content: `SUPPLY AGREEMENT
This agreement dated 1 August 2026 is between Acme Coffee Equipment Ltd ("Supplier") and Brightside Cafés Ltd ("Customer").
The Customer agrees to purchase two espresso machines at £1,450.00 each and three coffee grinders at £320.00 each.
Invoices are payable within 30 days. Defects must be reported in writing within 5 working days of delivery.`,
    },
    {
      kind: "invoice",
      title: "Invoice ACE-7781",
      docDate: null,
      content: `ACME COFFEE EQUIPMENT LTD
TAX INVOICE                          No. ACE-7781
Invoice date 03/09/2026         Payment due 03/10/2026
Bill to  Brightside Cafés Ltd
Description            Qty    Unit price     Amount
Espresso machine         2     £1,450.00   £2,900.00
Coffee grinder           3       £320.00     £960.00
TOTAL DUE                                  £3,860.00`,
    },
    {
      kind: "delivery_note",
      title: "Delivery confirmation",
      docDate: null,
      content: `Delivery confirmation
Delivered on 05/09/2026 to Brightside Cafés, 12 Mill Lane, York.
2 x Espresso machine
2 x Coffee grinder
Received by: J. Patel`,
    },
    {
      kind: "payment",
      title: "Bank transfer",
      docDate: null,
      content: `Bank transfer confirmation
We have today (20/09/2026) transferred £1,000.00 to Acme Coffee Equipment Ltd in part payment of invoice ACE-7781.`,
    },
    {
      kind: "correspondence",
      title: "Email from Brightside",
      docDate: "2026-09-21",
      content: `From: Sam Reid <sam@brightside.example> (Brightside Cafés)
Date: 2026-09-21
Subject: Grinders

We only received 2 of the 3 grinders, so we will not pay for the missing one.`,
    },
  ],
};

/** What Claude would return, plus two deliberate errors grounding must catch. */
export const REAL_WORLD_EXTRACTION: Extraction = {
  creditor: "Acme Coffee Equipment Ltd",
  debtor: "Brightside Cafés Ltd",
  debtorEmail: "sam@brightside.example",
  documents: [
    { docIndex: 0, kind: "contract", reference: null, date: "2026-08-01", dueDate: null, paymentTermsDays: 30, inspectionDays: 5, signedBy: null, totalPence: null, amountPaidPence: null,
      lines: [{ item: "Espresso machine", qty: 2, unitPricePence: 145_000 }, { item: "Coffee grinder", qty: 3, unitPricePence: 32_000 }] },
    { docIndex: 1, kind: "invoice", reference: "ACE-7781", date: "2026-09-03", dueDate: "2026-10-03", paymentTermsDays: null, inspectionDays: null, signedBy: null, totalPence: 386_000, amountPaidPence: null,
      lines: [
        { item: "Espresso machine", qty: 2, unitPricePence: 145_000 },
        { item: "Coffee grinder", qty: 3, unitPricePence: 32_000 },
        { item: "Milk frother", qty: 1, unitPricePence: 9_900 }, // hallucinated: not on the invoice
      ] },
    { docIndex: 2, kind: "delivery_note", reference: null, date: "2026-09-05", dueDate: null, paymentTermsDays: null, inspectionDays: null, signedBy: "J. Patel", totalPence: null, amountPaidPence: null,
      lines: [{ item: "Espresso machine", qty: 2, unitPricePence: null }, { item: "Coffee grinder", qty: 2, unitPricePence: null }] },
    { docIndex: 3, kind: "payment", reference: "ACE-7781", date: "2026-09-20", dueDate: null, paymentTermsDays: null, inspectionDays: null, signedBy: null, totalPence: null, amountPaidPence: 100_000,
      lines: [] },
    { docIndex: 4, kind: "correspondence", reference: null, date: "2026-09-21", dueDate: null, paymentTermsDays: null, inspectionDays: null, signedBy: null, totalPence: null, amountPaidPence: null, lines: [] },
  ],
};
