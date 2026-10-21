"""Derive and render report figures from docs/er-diagram.mmd."""

import argparse
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
FIGURES = [
    ("er-diagram-1-identity-banking", {"APP_USER", "APP_SESSION", "CUSTOMER", "ADDRESS", "ACCOUNT", "PAYMENT_METHOD", "PERSONAL_DATA_REDACTION"}),
    ("er-diagram-2-transactions-risk", {"ACCOUNT", "PAYMENT_METHOD", "TRANSACTION", "MERCHANT", "DEVICE_FINGERPRINT", "RISK_RULE", "RISK_SIGNAL", "SEMANTIC_DOCUMENT", "FRAUD_SCENARIO", "TRANSACTION_LABEL"}),
    ("er-diagram-3-investigation", {"APP_USER", "TRANSACTION", "INVESTIGATION_CASE", "CASE_EVENT", "CASE_COMMAND_RECEIPT"}),
]


def derive():
    source = (DOCS / "er-diagram.mmd").read_text(encoding="utf-8")
    entities = dict(re.findall(r"^    (\w+) \{\n(.*?)^    \}", source, re.M | re.S))
    relationships = re.findall(r"^    (\w+) ([|o{}-]+) (\w+) : (.+)$", source, re.M)
    if not entities or not relationships:
        raise ValueError("Canonical entity/relationship inventory is empty")
    for left, _, right, _ in relationships:
        if left not in entities or right not in entities:
            raise ValueError(f"Relationship references missing entity: {left}/{right}")
    required = [
        'PAYMENT_METHOD o|--o{ TRANSACTION',
        'TRANSACTION ||--o{ INVESTIGATION_CASE',
        'TRANSACTION o|--o{ SEMANTIC_DOCUMENT',
        'APP_USER ||--o{ CASE_EVENT',
        'jsonb metadata "NOT NULL default empty object',
        'bigint version "positive, default 1',
        'integer event_ordinal "positive canonical order',
        'numeric amount_base "numeric(20,2), generated round',
    ]
    for clause in required:
        if clause not in source:
            raise ValueError(f"Missing reviewed ER invariant: {clause}")
    for entity in ("APP_SESSION", "CASE_COMMAND_RECEIPT"):
        if entity not in entities:
            raise ValueError(f"Missing reviewed entity: {entity}")

    outputs = {}
    for name, members in FIGURES:
        if not members <= entities.keys():
            raise ValueError(f"Unknown figure entities: {members - entities.keys()}")
        lines = ["erDiagram"]
        lines += [f"    {left} {edge} {right} : {label}" for left, edge, right, label in relationships if left in members and right in members]
        for entity, fields in entities.items():
            if entity in members:
                lines.append(f"\n    {entity} {{\n{fields}    }}")
        outputs[name + ".mmd"] = "\n".join(lines) + "\n"

    text = (DOCS / "er-diagram.md").read_text(encoding="utf-8")
    blocks = iter(outputs.values())
    text, count = re.subn(r"```mermaid\n.*?```", lambda _: "```mermaid\n" + next(blocks) + "```", text, flags=re.S)
    if count != 3:
        raise ValueError("Expected exactly three report Mermaid blocks")
    tables = []
    fields_count = 0
    for entity, fields in entities.items():
        tables += [f"### `{entity}`", "", "| Field | Type | Key / design notes |", "|---|---|---|"]
        for line in fields.strip().splitlines():
            match = re.fullmatch(r'\s*(\w+)\s+(\w+)(?:\s+([^"\n]+?))?(?:\s+"([^"\n]*)")?\s*', line)
            if not match:
                raise ValueError(f"Cannot parse canonical field: {line}")
            kind, field, keys, note = match.groups()
            detail = "; ".join(x.strip() for x in (keys, note) if x)
            detail = detail.replace("|", "\\|")
            tables.append(f"| `{field}` | `{kind}` | {detail or 'See entity contract'} |")
            fields_count += 1
        tables.append("")
    marker = "<!-- BEGIN FIELD INVENTORY -->\n" + "\n".join(tables) + "\n<!-- END FIELD INVENTORY -->"
    text, count = re.subn(r"<!-- BEGIN FIELD INVENTORY -->.*?<!-- END FIELD INVENTORY -->", lambda _: marker, text, flags=re.S)
    if count != 1:
        raise ValueError("Expected field inventory markers")
    outputs["er-diagram.md"] = text
    return outputs, len(entities), fields_count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--write", action="store_true")
    action.add_argument("--check", action="store_true")
    action.add_argument("--render", action="store_true")
    parser.add_argument("--browser", type=Path)
    args = parser.parse_args()
    outputs, entity_count, field_count = derive()
    for name, expected in outputs.items():
        path = DOCS / name
        if args.write:
            path.write_text(expected, encoding="utf-8")
        elif not path.exists() or path.read_text(encoding="utf-8") != expected:
            raise ValueError(f"Derived artifact differs: {path}; run --write")
    print(f"PASS: {entity_count} entities, {field_count} fields, three synchronized figures and reviewed invariants", flush=True)
    if not args.render:
        return
    from PIL import Image

    if not args.browser or not args.browser.is_file():
        parser.error("--render requires --browser pointing to an existing Chromium executable")
    npx = shutil.which("npx.cmd") or shutil.which("npx")
    if not npx:
        parser.error("npx is required for rendering")
    with tempfile.TemporaryDirectory(prefix="finsight-er-") as tmp:
        render_env = {**os.environ, "PUPPETEER_SKIP_DOWNLOAD": "true"}
        config = Path(tmp) / "puppeteer.json"
        config.write_text(json.dumps({"executablePath": str(args.browser.resolve())}), encoding="utf-8")
        for name in ["er-diagram"] + [name for name, _ in FIGURES]:
            width = "6000" if name == "er-diagram" else "3000"
            for extension in ("svg", "png"):
                output = DOCS / f"{name}.svg" if extension == "svg" else Path(tmp) / f"{name}.png"
                subprocess.run([npx, "--yes", "--package", "@mermaid-js/mermaid-cli@11.12.0", "mmdc", "-i", str(DOCS / f"{name}.mmd"), "-o", str(output), "-p", str(config), "-b", "white", "-w", width, "-H", "1200"], check=True, env=render_env)
            with Image.open(Path(tmp) / f"{name}.png") as rendered:
                rendered.convert("RGB").save(DOCS / f"{name}.jpg", quality=95)
                print(f"Rendered {name}: {rendered.size}", flush=True)


if __name__ == "__main__":
    main()
