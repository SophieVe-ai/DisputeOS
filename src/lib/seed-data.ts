// Fictional UK SME demo cases. Each showcases a different agent behaviour:
//  1. Harbour Joinery — partially valid damage claim + a late, rebutted quality complaint.
//  2. Northbank Print — clean overdue debt, no defence → full claim + court pack.
//  3. Peak Catering   — WE overcharged and short-delivered → credit note before demanding the rest.
import type { NewCaseInput } from "./repo/cases";

export const DEMO_CASES: (NewCaseInput & { id: string })[] = [
  {
    id: "case-harbour-kestrel",
    reference: "DOS-2026-0141",
    title: "Kitchen units — Kestrel Developments",
    creditor: "Harbour Joinery Ltd",
    debtor: "Kestrel Developments Ltd",
    debtorEmail: "accounts@kestrel-dev.example",
    claimedAmountPence: 1_292_000,
    summary: "Balance of £12,920 unpaid on a £17,920 kitchen-unit order after a £5,000 part payment. Debtor alleges damage.",
    documents: [
      {
        kind: "contract",
        title: "Master supply agreement HJ-KD-2026-01",
        docDate: "2026-03-02",
        content: `MASTER SUPPLY AGREEMENT
Contract reference: HJ-KD-2026-01
Contract date: 2026-03-02
Supplier: Harbour Joinery Ltd
Customer: Kestrel Developments Ltd
Payment terms: 30 days from invoice
Inspection period: 5 working days from delivery. Defects not notified in writing within this period are deemed accepted.
Pricing:
- Shaker oak kitchen unit | qty 40 | £385.00 per unit
- Quartz worktop section | qty 12 | £210.00 per unit
Signed: M. Hughes (Harbour Joinery), D. Okafor (Kestrel Developments)`,
      },
      {
        kind: "delivery_note",
        title: "Delivery note DN-5531",
        docDate: "2026-06-03",
        content: `DELIVERY NOTE DN-5531
Delivery date: 2026-06-03
Site: Riverside Mews, Plot 4-9, Bristol
- Shaker oak kitchen unit | qty 40
- Quartz worktop section | qty 12
Signed by: R. Patel (Site Manager, Kestrel Developments)
Condition notes: Received`,
      },
      {
        kind: "invoice",
        title: "Invoice HJ-1042",
        docDate: "2026-06-05",
        content: `INVOICE
Invoice number: HJ-1042
Invoice date: 2026-06-05
Due date: 2026-07-05
Bill to: Kestrel Developments Ltd
- Shaker oak kitchen unit | qty 40 | £385.00
- Quartz worktop section | qty 12 | £210.00
Total due: £17,920.00`,
      },
      {
        kind: "correspondence",
        title: "Email from Kestrel — damaged units",
        docDate: "2026-06-06",
        content: `From: Dami Okafor <d.okafor@kestrel-dev.example> (Kestrel Developments)
To: accounts@harbourjoinery.example
Date: 2026-06-06
Subject: Plot 4-9 delivery

Hi team, on unpacking we found that 3 of the Shaker oak kitchen units were damaged — cracked door panels on all three. Photos attached. Please advise on replacements.`,
      },
      {
        kind: "payment",
        title: "Remittance advice — part payment",
        docDate: "2026-07-20",
        content: `REMITTANCE ADVICE
From: Kestrel Developments Ltd
Payment date: 2026-07-20
Amount paid: £5,000.00
Reference: HJ-1042 part payment`,
      },
      {
        kind: "correspondence",
        title: "Payment reminder from Harbour",
        docDate: "2026-08-12",
        content: `From: Megan Hughes <accounts@harbourjoinery.example> (Harbour Joinery)
To: d.okafor@kestrel-dev.example
Date: 2026-08-12
Subject: Overdue balance HJ-1042

Dear Dami, invoice HJ-1042 fell due on 5 July. £12,920.00 remains outstanding. Please arrange payment this week.`,
      },
      {
        kind: "correspondence",
        title: "Email from Kestrel — refusing payment",
        docDate: "2026-08-20",
        content: `From: Dami Okafor <d.okafor@kestrel-dev.example> (Kestrel Developments)
To: accounts@harbourjoinery.example
Date: 2026-08-20
Subject: RE: Overdue balance HJ-1042

Our client now says the worktops are poor quality and the finish is not acceptable. We are withholding the balance until this is resolved.`,
      },
    ],
  },
  {
    id: "case-northbank-lumen",
    reference: "DOS-2026-0142",
    title: "Event print run — Lumen Events",
    creditor: "Northbank Print Co",
    debtor: "Lumen Events Ltd",
    debtorEmail: "finance@lumen-events.example",
    claimedAmountPence: 675_000,
    summary: "£6,750 print invoice 87 days overdue. Debtor acknowledges the debt but keeps deferring payment.",
    documents: [
      {
        kind: "contract",
        title: "Accepted quotation Q-7781",
        docDate: "2026-05-28",
        content: `ACCEPTED QUOTATION
Contract reference: Q-7781
Contract date: 2026-05-28
Supplier: Northbank Print Co
Customer: Lumen Events Ltd
Payment terms: 30 days from invoice
Pricing:
- A5 event brochure (pack of 100) | qty 30 | £95.00 per pack
- Roller banner 850mm | qty 12 | £150.00 per unit
- Large-format backdrop print | qty 2 | £1,050.00 per unit
Accepted by: S. Laurent, Lumen Events (2026-05-28)`,
      },
      {
        kind: "delivery_note",
        title: "Courier proof of delivery",
        docDate: "2026-06-18",
        content: `PROOF OF DELIVERY
Delivery date: 2026-06-18
Courier: CityFreight tracking CF-99812
- A5 event brochure (pack of 100) | qty 30
- Roller banner 850mm | qty 12
- Large-format backdrop print | qty 2
Signed by: J. Moss (Lumen Events reception)`,
      },
      {
        kind: "invoice",
        title: "Invoice NP-2207",
        docDate: "2026-06-20",
        content: `INVOICE
Invoice number: NP-2207
Invoice date: 2026-06-20
Due date: 2026-07-20
- A5 event brochure (pack of 100) | qty 30 | £95.00
- Roller banner 850mm | qty 12 | £150.00
- Large-format backdrop print | qty 2 | £1,050.00
Total due: £6,750.00`,
      },
      {
        kind: "correspondence",
        title: "Reminder from Northbank",
        docDate: "2026-08-04",
        content: `From: Priya Nair <credit@northbankprint.example> (Northbank Print)
To: finance@lumen-events.example
Date: 2026-08-04
Subject: NP-2207 overdue

Hello, invoice NP-2207 for £6,750.00 was due on 20 July. Please confirm a payment date.`,
      },
      {
        kind: "correspondence",
        title: "Reply from Lumen",
        docDate: "2026-08-11",
        content: `From: Sophie Laurent <finance@lumen-events.example> (Lumen Events)
To: credit@northbankprint.example
Date: 2026-08-11
Subject: RE: NP-2207 overdue

Apologies — cash flow is tight after the summer season. We will pay next month.`,
      },
    ],
  },
  {
    id: "case-peak-ashford",
    reference: "DOS-2026-0143",
    title: "Catering consumables — Ashford Hotel Group",
    creditor: "Peak Catering Supplies Ltd",
    debtor: "Ashford Hotel Group plc",
    debtorEmail: "ap@ashford-hotels.example",
    claimedAmountPence: 954_000,
    summary: "£9,540 invoice unpaid. Debtor says we overcharged and short-delivered.",
    documents: [
      {
        kind: "contract",
        title: "Framework supply agreement PCS-AHG-07",
        docDate: "2026-04-15",
        content: `FRAMEWORK SUPPLY AGREEMENT
Contract reference: PCS-AHG-07
Contract date: 2026-04-15
Supplier: Peak Catering Supplies Ltd
Customer: Ashford Hotel Group plc
Payment terms: 30 days from invoice
Inspection period: 3 working days from delivery
Pricing:
- Compostable takeaway box | qty 2000 | £3.95 per unit
- Recycled napkin case | qty 40 | £28.50 per case`,
      },
      {
        kind: "delivery_note",
        title: "Delivery note PCS-D-3307",
        docDate: "2026-07-27",
        content: `DELIVERY NOTE PCS-D-3307
Delivery date: 2026-07-27
- Compostable takeaway box | qty 2000
- Recycled napkin case | qty 36
Signed by: T. Green (Goods-in, Ashford Kensington)`,
      },
      {
        kind: "invoice",
        title: "Invoice PCS-8811",
        docDate: "2026-07-28",
        content: `INVOICE
Invoice number: PCS-8811
Invoice date: 2026-07-28
Due date: 2026-08-27
- Compostable takeaway box | qty 2000 | £4.20
- Recycled napkin case | qty 40 | £28.50
Total due: £9,540.00`,
      },
      {
        kind: "correspondence",
        title: "Email from Ashford — invoice queried",
        docDate: "2026-08-29",
        content: `From: Tom Green <ap@ashford-hotels.example> (Ashford Hotel Group)
To: accounts@peakcatering.example
Date: 2026-08-29
Subject: Invoice PCS-8811

Your invoice charges more than the agreed price for the Compostable takeaway box (framework says £3.95). We also only received 36 napkin cases, so 4 are missing. We will not pay until a corrected invoice is issued.`,
      },
    ],
  },
];
