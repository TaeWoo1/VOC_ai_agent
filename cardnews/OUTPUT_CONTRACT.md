# Cardnews output contract

Where rendered cardnews artifacts land on disk, and the rules a
runner / test / operator can rely on.

## Run-package layout

Every pipeline run is a self-contained directory under
`outputs/content_packages/<run_dir>/`. The Phase 2E pipeline already
populates `shared/analysis_report.json`; the cardnews skill adds a
sibling `cardnews/<lang>/` subtree:

```
outputs/
  content_packages/
    <run_dir>/                      e.g. 2026-04-30_mediheal_pad_run-010
      shared/
        analysis_report.json        canonical adapter output
        consumer_insight_brief.json
      seller_report_ko.pdf          Phase 2E operator PDF
      manifest.json                 creator-handoff manifest (Phase 2E)
      cardnews/                     ← the cardnews skill writes here
        ko/
          content_plan.json         editorial planner output (validated)
          layout.json               long-layout dict (post-safety)
          manifest.json             render manifest (page list, sha, etc.)
          cardnews.css              staged copy of the rendered stylesheet
          pages/
            01_cover.png            1080×1350 @ deviceScaleFactor 2 → 2160×2700
            02_one_liner.png
            ...
            NN_cta.png
        en/                         (reserved — `--lang en`)
```

The English subtree is reserved by convention; emitting it requires a
content_plan in English (the planner's `language` field is locked to
`"ko"` today).

## Default out-dir derivation

`python -m cardnews.render --analysis-report <path>` derives `--out-dir`
automatically when the report sits in the canonical run-package layout
above. The match shape:

```
.../outputs/content_packages/<run_dir>/shared/analysis_report.json
       │
       ▼ becomes
.../outputs/content_packages/<run_dir>/cardnews/<lang>/
```

If the report path doesn't match (e.g. a one-off file outside `outputs/`),
`--out-dir` is required and the CLI exits with a clear error.

## Guarantees per render

- `manifest["page_count"] == len(layout["pages"]) == len(pages/*.png)`
- Every PNG is `2160 × 2700` (1080×1350 logical @ deviceScaleFactor 2).
- `validate_cardnews_safety(layout)` passes before any HTML/PNG is written —
  on violation, nothing is written and the CLI returns exit code 2.
- `layout.json` carries `analysis_report_sha256` and `content_plan_sha256`
  so a rendered run is auditable back to its inputs.

## Runtime artifact, not source

`outputs/` is in `.gitignore`. Treat everything under it as
re-derivable from `analysis_report.json` + the cardnews skill version.
Never check in rendered artifacts; cite a `<run_dir>` instead.

---

## End-to-end skill invocation (Korean cardnews v1)

The skill is two CLI calls, in order. Both default their output to the
same canonical `cardnews/<lang>/` dir, so the run is self-contained.

```bash
# 1) Build the validated content_plan (LLM mode by default — fail-closed).
python -m src.voc.content.editorial_planner \
    --analysis-report outputs/content_packages/<run>/shared/analysis_report.json \
    --mode llm
# (--out is derived to outputs/content_packages/<run>/cardnews/ko/content_plan.json)

# 2) Render the carousel from the same report + the plan from step 1.
python -m cardnews.render \
    --analysis-report outputs/content_packages/<run>/shared/analysis_report.json \
    --content-plan    outputs/content_packages/<run>/cardnews/ko/content_plan.json
# (--out-dir is derived to outputs/content_packages/<run>/cardnews/ko/)
```

Mock mode is for offline iteration / tests:

```bash
python -m src.voc.content.editorial_planner \
    --analysis-report outputs/content_packages/<run>/shared/analysis_report.json \
    --mode mock
```

### LLM provider selection

`--mode llm` defaults to OpenAI (`gpt-4o`). Override via:

```bash
--llm-provider {openai,anthropic}   # default: openai
--llm-model    <model-id>           # default: gpt-4o or claude-sonnet-4-5
```

Bootstraps from `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` in env. Missing
key raises immediately — the planner does not silently degrade.

### Raw-response debug policy

When `--mode llm` raises (parse failure, schema validation, safety
violation), the raw model response is written to:

```
outputs/content_packages/<run>/cardnews/ko/_debug/_planner_raw.txt
```

Override with `--raw-dump-dir <path>`. The `_debug/` dir is only
populated on failure; green runs leave no clutter. `_debug/` is under
`outputs/` and therefore git-ignored.

### Fail-closed semantics

Default behavior is fail-closed: any LLM error / validation error /
safety violation aborts with a non-zero exit. To allow falling back to
mock, pass `--allow-mock-fallback` explicitly — opt-in only.

---

## Manifest contract

`outputs/content_packages/<run>/cardnews/<lang>/manifest.json` carries:

| Field | Purpose |
|---|---|
| `schema_version` | Manifest format version. |
| `generated_at` | UTC timestamp of the layout build. |
| `language` | Locale (currently always `"ko"`). |
| `page_count` | Equals `len(pages)` and `len(pages/*.png)` on disk. |
| `analysis_report_sha256` | Audit pointer to the input report. |
| `content_plan_sha256` | Audit pointer to the editorial plan that drove this render. |
| `product` | `{name_ko, external_id, source_url, category}`. |
| `product_image_source` | One of `cli_path / cli_url / analysis_report / fallback_gradient`. |
| `pages[]` | `{index, type, png}` per page; `png` is relative to the run dir. |

`layout.json` carries the full layout dict (the safety-validated input
to render) plus the same two checksums — re-render from `layout.json`
alone is supported via `python -m cardnews.render --layout <path>`.

---

## Publish gate (informational; not auto-enforced)

| `page_count` | Status | Action |
|---|---|---|
| `>= 10` | **publish candidate** | Operator visual-QA + manual upload. |
| `< 10` | **analysis artifact only** | Do not publish; corpus is too thin to support a 10-page minimum carousel without padding. |

The 10-page floor matches Instagram's carousel minimum and the
v2.1 narrative's expandable 9-required-section base + at least one
optional spotlight or checkpoint page. The cardnews skill never pads
to clear the floor; if no signals support optional pages, the run is
classified analysis-only. Auto-enforcement is deferred — for now the
operator reads the `page_count` in the print output / manifest.
