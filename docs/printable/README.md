# Current demonstration diagrams

Use these two print masters for the demonstration:

- [ER diagram](../../output/pdf/FinSight-ER-Diagram.pdf): Chen notation with entity rectangles, attribute ellipses, relationship diamonds, cardinalities and underlined primary keys. The master is A0 landscape.
- [Schema diagram](../../output/pdf/FinSight-Schema-Diagram.pdf): attribute strips, solid PK underlines, dotted FK underlines, red primary-key dependencies and black declared-FK arrows. The master is A1 landscape.

Both print **FinSight**, **Shrikar Desai**, and **Shreyas P Kulkarni**. They are vector PDFs: zoom for inspection, or ask a print shop to print at the stated native size. Shrinking the whole poster to A4 makes the attributes too small. [ER preview](finsight-er-preview.png) and [schema preview](finsight-schema-preview.png) are screen previews, not the print masters.

## Verified scope

The catalog was extracted from PostgreSQL 17.11 after applying all seven current migrations through `060_session_cleanup.sql`, matching main revision `843f0af9597439cafefe35c62dea8b9be29540bb`. The diagrams show all 17 implemented application tables, the migration-runner bookkeeping table, the derived risk view and the Mongo telemetry collection. There are 161 SQL columns across those tables/view and 20 declared SQL foreign keys. The Mongo base fields and both shape-specific payloads come from the executable validator.

Bookkeeping, the derived view and Mongo documents are visibly distinguished. Mongo UUID references are application-validated, not SQL foreign keys. `candidate_session_ids` is a retained UUID-array snapshot, not an FK. `case_event.operation_id` is provenance, not a declared FK to a receipt. Both composite transaction FKs are shown with branches to the exact referenced columns. The diagrams do not claim that generated fields or document structures are normalized 3NF relations.

The old `docs/er-diagram*.mmd`, SVG/JPG figures and PlantUML are design/history material. They contain deferred vocabulary and are not current demonstration printouts. In particular, deferred `SEMANTIC_DOCUMENT` and `PERSONAL_DATA_REDACTION` do not appear in these current diagrams; implemented sessions, receipts, case events and session-cleanup audit do.

## Reproduction and freshness

The [schema catalog](schema-catalog.json) records columns, types, nullability, keys, actual FK tuples, generated fields and migration checksums. [Relationship data](relationships.json) records the rendered cardinalities. The full SQL constraint expressions remain in the catalog and migrations; they are not invented attributes in the diagrams.

Export only against an explicitly opted-in local test database. `export-catalog.mjs` applies the repository migrations before reading catalog metadata; it does not change application schemas or overwrite customer data. For a new export, supply `TEST_DATABASE_URL` (or `DIAGRAM_DATABASE_URL`) and `ALLOW_TEST_DATABASE=true`, then run:

```powershell
node --env-file-if-exists=.env.local scripts/diagrams/export-catalog.mjs
```

Install `@viz-js/viz@3.31.0` in a temporary directory, outside application dependencies. Supply that directory to the layout command. Python needs `reportlab` and `pymupdf`:

```powershell
node scripts/diagrams/layout-er.mjs C:/path/to/temporary-viz-install
python scripts/diagrams/render_printables.py
```

The layout command generates Graphviz layout data under ignored `tmp/pdfs/`; the renderer produces the SVG, preview PNGs and both PDF masters. It checks that every catalog table/column, every Mongo property and both names appear in the PDF text. Visual QA additionally checks the full pages and close-ups for clipping or overlaps. Re-export and regenerate if a migration or Mongo schema changes before the demonstration. Make the same migrations and application revision available on both teammates' systems.
