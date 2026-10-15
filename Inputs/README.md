# Inputs: real London invoice-dispute cases

Reference cases for DisputeOS: real, fully resolved English court judgments where unpaid invoices were in dispute, heard in London. Each case folder holds:

- `judgment.pdf`: the published judgment from [The National Archives, Find Case Law](https://caselaw.nationalarchives.gov.uk/) (Open Justice Licence).
- `commentary.md`: inputs (parties, documents mapped to DisputeOS document kinds, amounts, defences), outcome (decision on each defence, money result) and commentary (what decided it, how the DisputeOS agents should treat a similar case).

- `documents/` (London cases): the case's key documents **reconstructed from the judgment** (contracts and purchase orders, delivery or performance records, invoices or statements of account, payments, and correspondence as `.eml`), plus a `manifest.json`. Same format as the app's sample packs in `public/samples/`, so a pack can be uploaded into DisputeOS and the agents' result compared with the court's.

Commentaries were drafted by AI from the full judgment text, with paragraph references. Check figures against the judgment before relying on them.

### About the reconstructed documents

- **They are not the original documents.** Courts publish judgments, not trial bundles. Every file ends with a footer saying it is a reconstruction and citing the judgment paragraphs it is based on.
- **Nothing is invented.** Figures, dates, numbers and quoted wording come from the judgment. Where the judgment is silent, files say `not stated`, use a single lump-sum line, or the document is left out; the footer says which. Email addresses are `.example` placeholders.
- **Each pack is the creditor's file before the court ruled.** Court findings (for example, that a document was altered) appear only in footers.
- **Where a judgment does not describe a document,** the pack may summarise a party's pleaded case as a letter (for example the debtor's defences in E-Nik and Addax); the footer says so.
- **Large cases are cut down** to the disputed invoices and key correspondence, and some packs use a statement of account where individual invoices are not described.
- **App limitations:** the app reads every amount as pounds. EUR and USD packs carry a `Currency:` field with the real currency, and the mixed GBP/EUR International Media Advertising pack totals incorrectly on upload. The app has no statement-of-account kind, so the statements in Ocean Healthcare and Gama upload as `other`. In CEP, the app picks the parent company as debtor; the money is owed by CEP Claddings.
- Every pack was run through the app's own intake classifier (`src/lib/intake/classify.ts`): all other files classify as the intended document kind with confidence of at least 0.7.

## Selection

1. Searched Find Case Law for "unpaid invoice(s)", "price of goods sold and delivered" and "statutory interest" + invoices across the Commercial Court, TCC, KBD/QBD, Chancery and Court of Appeal: 244 judgments.
2. Kept those mentioning invoices at least 15 times and London: 81.
3. Each of the 81 was reviewed against two tests:
   - **Invoice dispute:** a claim to be paid on invoices (or the invoiced price) is a central issue.
   - **Fully resolved:** after trial (or a final appeal) the court decided liability and what is owed. Only interest arithmetic, costs or the form of order may be left over.
4. 25 passed, plus Ocean Healthcare v Sigma found separately (26). Four were then found to have been heard outside London and moved to `excluded-non-london/`, leaving **22**.

**Tiers**
- `core/` (15): unpaid invoices were the main dispute and the money result was fully decided.
- `borderline/` (7): fully resolved, but with a caveat (the invoice was a side claim set off against a larger claim, construction final account, summary judgment rather than trial, or further claims go to a later trial). The caveat is on the Tier line of each commentary.

Appeals after these judgments were not checked.

## Core cases (15)

| Case | Court, date | Invoices / claim | Outcome |
|---|---|---|---|
| [Ocean Healthcare v Sigma Pharmaceuticals [2014] EWCA Civ 1468](core/2014-ewca-civ-1468-ocean-healthcare-v-sigma/commentary.md) | CA (from Mayor's and City of London Court), Nov 2014 | Pharmacy goods, about £21k disputed; buyer said delivery notes were forged | Supplier wins £25,997.49 incl interest; appeal dismissed |
| [Winch Design v Le Souef [2025] EWHC 120 (Comm)](core/2025-ewhc-120-comm-winch-design-v-le-souef/commentary.md) | Commercial Court, Jan 2025 | 3 superyacht design invoices, £733,750 | Supplier wins in full plus 3% over base; counterclaim dismissed |
| [Pharos Offshore v Keynvor Morlift [2025] EWHC 1764 (TCC)](core/2025-ewhc-1764-tcc-pharos-offshore-v-keynvor-morlift/commentary.md) | TCC, Jul 2025 | 6 invoices for subsea equipment hire, £918k | Supplier owed £608,883 incl VAT; buyer's delay counterclaim £113,215 set off; 1998 Act interest |
| [Vitol v Genser Energy Ghana [2022] EWHC 1812 (Comm)](core/2022-ewhc-1812-comm-vitol-v-genser-energy-ghana/commentary.md) | London Circuit Commercial Court, Jul 2022 | Propane; settlement sum US$3.58m, alternatively invoices | Supplier wins settlement sum; 1998 Act interest applies |
| [Gama Aviation v Bin Otaiba [2026] EWHC 258 (Comm)](core/2026-ewhc-258-comm-gama-aviation-v-bin-otaiba/commentary.md) | Commercial Court, 2026 | Aircraft management invoices, about US$3.89m | Supplier wins less two adjustments, plus 1% a month interest; defendant absent, may apply to set aside |
| [International Media Advertising v Turkey [2018] EWHC 3285 (QB)](core/2018-ewhc-3285-qb-international-media-advertising-v-turkey/commentary.md) | QBD, 2018 | 33 media-buying invoices, £250k + €170k | **Creditor at fault:** recovers only £12,450 + €950; owes £367,261 + €14,988 for altered invoices |
| [KSY Juice Blends v Citrosuco [2024] EWHC 2098 (Comm)](core/2024-ewhc-2098-comm-ksy-juice-blends-v-citrosuco/commentary.md) | London Circuit Commercial Court, Aug 2024 | Invoices for juice by-product, claim up to about €4.8m | Claim fails: no agreed price, invoices without call-off created no debt |
| [Furmans Electrical v Elecref [2009] EWCA Civ 170](core/2009-ewca-civ-170-furmans-electrical-v-elecref/commentary.md) | CA, 2009 | 6 unpaid subcontract invoices, about £23k | Subcontractor wins less £3,500; paid invoices cannot be reopened |
| [Blacklion Law v Amira Nature Foods [2022] EWHC 1500 (Ch)](core/2022-ewhc-1500-ch-blacklion-law-v-amira-nature-foods/commentary.md) | Chancery, 2022 | Law firm fixed-fee invoices | £300,000 plus 1.5% a month contractual interest; director liable for procuring breach |
| [Astea v Time Group [2003] EWHC 725 (TCC)](core/2003-ewhc-725-tcc-astea-v-time-group/commentary.md) | TCC, Apr 2003 | Software licence and services invoices | Supplier wins £214,769.14; customer's repudiation defence and counterclaim fail |
| [Addax Energy v Petro Trade [2023] EWHC 1609 (Comm)](core/2023-ewhc-1609-comm-addax-energy-v-petro-trade/commentary.md) | Commercial Court, 2023 | 4 oil-product invoices | Seller wins US$2,744,174.93 plus 8% interest; defendant absent |
| [Rotamead v Durston Scaffolding [2020] EWHC 2738 (TCC)](core/2020-ewhc-2738-tcc-rotamead-v-durston-scaffolding/commentary.md) | TCC, 2020 | Scaffold hire invoices | Supplier wins £492,514.19 incl interest and Part 36 uplift; counterclaim dismissed |
| [Longulf Trading v Niyazi Onen Gida [2019] EWHC 1573 (Comm)](core/2019-ewhc-1573-comm-longulf-trading-v-niyazi-onen-gida/commentary.md) | Commercial Court, 2019 | Guarantee of unpaid procurement invoices | US$2,300,170 plus interest and expenses; fees claim fails for lack of demand |
| [CEP Holdings v CEP Claddings [2009] EWHC 2447 (QB)](core/2009-ewhc-2447-qb-cep-holdings-v-cep-claddings/commentary.md) | QBD, 2009 | Supplier's 35 unpaid cladding-panel invoices (counterclaim) | Supplier wins €216,900.52 + €18,508 plus interest and £125,000 damages |
| [Cardiorentis v IQVIA [2022] EWHC 250 (Comm)](core/2022-ewhc-250-comm-cardiorentis-v-iqvia/commentary.md) | Commercial Court, 2022 | Clinical-trial service invoices, €9.5m claimed | Supplier recovers €4,509,244.47; unproven and over-billed invoices disallowed |

## Borderline cases (7)

| Case | Caveat | Outcome |
|---|---|---|
| [Trinsic Collagen v Procoll [2026] EWHC 1793 (Ch)](borderline/2026-ewhc-1793-ch-trinsic-collagen-v-procoll/commentary.md) | Invoice is a set-off against buyer's defect claim | Buyer gets £3,000, wiped out by £30,000 unpaid invoice |
| [Magnetic Shields v VAS [2024] EWHC 2260 (TCC)](borderline/2024-ewhc-2260-tcc-magnetic-shields-v-vas/commentary.md) | Invoice is a counterclaim against defect damages | Net judgment for customer £16,234.97 |
| [Digital Capital v Genesis Mining [2021] EWHC 2462 (Comm)](borderline/2021-ewhc-2462-comm-digital-capital-v-genesis-mining/commentary.md) | Separate damages go to a second trial | Invoices £2,484,046 awarded in full |
| [CIS General Insurance v IBM [2021] EWHC 347 (TCC)](borderline/2021-ewhc-347-tcc-cis-general-insurance-v-ibm/commentary.md) | Invoice was one issue in an IT project case | £2.89m invoice due but set off; customer nets £12,998,390 |
| [Bluewater v Mercon [2014] EWHC 2132 (TCC)](borderline/2014-ewhc-2132-tcc-bluewater-v-mercon/commentary.md) | Construction final account | €961,324.66 due to employer |
| [RAM Media v Hellenic Ministry of Culture [2008] EWHC 1835 (QB)](borderline/2008-ewhc-1835-qb-ram-media-v-hellenic-ministry-of-culture/commentary.md) | Main fight was repudiation | €2.4m to supplier |
| [E-Nik v DCLG [2012] EWHC 3027 (Comm)](borderline/2012-ewhc-3027-comm-e-nik-v-dclg/commentary.md) | Summary judgment, not trial | 2 consultancy invoices awarded less VAT, plus 1998 Act interest |

## Excluded: not heard in London (4)

Kept for reference in `excluded-non-london/`: First Personnel v Halfords (Birmingham), Zenith Logistics v Keates (Cardiff), Amey v Cumbria County Council (Manchester), Marpaul Southern v Betteshanger (Birmingham).
