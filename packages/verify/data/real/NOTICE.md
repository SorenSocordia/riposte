# Third-party data attributions

Real sample records under this directory are redistributed under their source licences. Attribution is required (CC-BY).

- **A-invoices-receipts/cord-v2.sample.json** — from **naver-clova-ix/cord-v2** (CORD: Consolidated Receipt Dataset), **CC-BY-4.0**. Source: https://huggingface.co/datasets/naver-clova-ix/cord-v2 . Images omitted; only the `ground_truth` parse is kept. Used to benchmark footing on real receipts (roadmap 1.4).
- **B-legal-opinions/HFforLegal-case-law.sample.json** — from **HFforLegal/case-law** ("us" split), **CC-BY-4.0**; underlying US court opinions are public-domain government works. Source: https://huggingface.co/datasets/HFforLegal/case-law . Used to benchmark verbatim cite-checking.
- **C-bank-paystub/AgamiAI-Indian-Bank-Statements.schema.json** — schema only, from **AgamiAI/Indian-Bank-Statements** (synthetic), **Apache-2.0**. Source: https://huggingface.co/datasets/AgamiAI/Indian-Bank-Statements .
- **D-ap-distil/invoice_cases.jsonl** — from **distil-labs/invoice-processing-pipeline** (data/invoice_cases.jsonl), **Apache-2.0** (licence copied alongside as LICENSE-distil-labs-Apache-2.0). Source: https://github.com/distil-labs/invoice-processing-pipeline . 100 synthetic free-text invoice emails with ERP purchase order + goods receipt and gold pay/hold decisions. Used to benchmark the AP three-way-match pack (src/ap).

Do NOT add non-commercial (CC-BY-NC-*), GPL, or unlicensed data here — this folder ships in an Apache-2.0 repository. (Vetted and excluded: pile-of-law is non-commercial, DocILE is research-only, mychen76 invoices carry no licence.)
