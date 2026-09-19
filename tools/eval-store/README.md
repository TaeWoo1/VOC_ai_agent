# eval-store — where real eval data lives (Inquiry v3 WP-1 Stage 0)

**Rule.** A canonical eval asset — anything holding real inquiry ids, customer text, seller text or labels derived
from them — lives in exactly one place: the **durable private store**. Never in a repository. Never in an OS temp
directory (`/tmp`, `/private/tmp`, `/var/folders`, a session scratchpad). The repository holds only names, hashes,
counts, schema and provenance (`contracts/<dataset>/<version>/dataset.meta.json`) and synthetic fixtures.

Why: on 2026-09-20 the operating system deleted Eval v1's three files and both judge-input captures from the session
scratchpad they had been kept in. They came back byte-identical only because every build step had been recorded
(`docs/inquiry_architecture_v3_wp1.md` §1).

| | where | what |
|---|---|---|
| canonical store | `$SELLEROPS_EVAL_STORE` (default `~/.sellerops/eval-store`), mode 0700, files 0444 | `<dataset>/<version>/<file>` + `STORED.json` |
| local cache | `$SELLEROPS_EVAL_CACHE` (default `~/.cache/sellerops-eval`) | disposable; rebuilt by `restore` |
| repository | `contracts/<dataset>/<version>/dataset.meta.json` | `files` (name → sha256), counts, provenance, storage status |

`store.mjs` refuses a canonical root inside a temp directory, overlapping the repository, or inside a git working tree.

## Commands

```bash
node tools/eval-store/store.mjs where                                   # the roots, and whether the store root is allowed
node tools/eval-store/store.mjs put     <dataset> <version> --from <dir> # verify hashes + redaction gate, then store read-only
node tools/eval-store/store.mjs verify  <dataset> <version>
node tools/eval-store/store.mjs restore <dataset> <version>             # prints the cache dir; every byte verified
```

`put` refuses when a file's sha256 differs from the manifest, when the redaction gate finds anything, or when the store
already holds different bytes under the same version. **A changed dataset is a new version with a new manifest** —
never an edit of a stored one.

## Redaction gate

`redaction.mjs` — email, resident registration number, card number, Korean phone, runs of 11+ digits (order and
product-order numbers), road addresses, a name addressed as 「… 고객님」. It prints rule, line and JSON path, never the
value. It cannot find a name written without an honorific: a new dataset that carries free text also needs a human
read before `put`. `redact()` masks for the step BEFORE a new version is frozen.

## Recovery drill (run it after any machine change)

```bash
rm -rf ~/.cache/sellerops-eval
node tools/eval-store/store.mjs verify  inquiry-need-eval v1
node tools/eval-store/store.mjs restore inquiry-need-eval v1
node tools/inquiry-need-eval/validate.mjs ~/.cache/sellerops-eval/inquiry-need-eval/v1   # dataset_hash b94626cb…
node --test tools/eval-store/test/store.test.mjs                                         # the same drill on the synthetic fixture
```

## Datasets in the store

| dataset/version | files | status |
|---|---|---|
| `inquiry-need-eval/v1` | questions · needs · precedents | RECOVERED_BYTE_IDENTICAL (original storage lost 2026-09-20) |
| `inquiry-judge-capture/v1` | judge-inputs-S0 · judge-inputs-S1 | RECOVERED_BYTE_IDENTICAL (re-captured, no model) |
| `inquiry-resolution-plan/v1` | plans.jsonl · build.py | WITHDRAWN_BEFORE_USE (label semantics mixed; kept for the record) |
| `inquiry-resolution-plan/v2` | plans.jsonl · build.py | WITHDRAWN_BEFORE_USE (no name for a possible gap; kept for the record) |
| `inquiry-resolution-plan/v3` | plans.jsonl · build.py | frozen 2026-09-20 (WP-1): 66 frozen, 6 PENDING_ADJUDICATION |

Back the store up like any other private data; it is not in git by design.
