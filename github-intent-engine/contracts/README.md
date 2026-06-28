# Contracts

Track A and Track B communicate through JSONL files.

Rules:
- One JSON object per line.
- Every record must include a stable `id` when GitHub provides one.
- Every evidence-producing record must include a public `url`.
- Timestamps must be ISO 8601 strings.
- Raw records should preserve GitHub source fields where possible.
- Processed records should include evidence references back to raw records.

See `schemas.md` for the required MVP shapes.
