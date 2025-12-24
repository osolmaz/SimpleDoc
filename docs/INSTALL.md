# Setup SimpleDoc in your agentic repository

This installer is for repos that already have an `AGENTS.md` file (run from repo root). Run the following script from repo root to set up SimpleDoc in your repository:

```bash
bash <<'EOF'
set -euo pipefail

AGENTS_FILE="AGENTS.md"
DOCS_DIR="docs"
DOC_URL="https://raw.githubusercontent.com/osolmaz/SimpleDoc/refs/heads/main/docs/HOW_TO_DOC.md"
DOC_OUT="${DOCS_DIR}/HOW_TO_DOC.md"

LINE="**Attention agent!** Before creating ANY documentation, read the docs/HOW_TO_DOC.md file first. It contains guidelines on how to create documentation in this repository."

if [[ ! -f "${AGENTS_FILE}" ]]; then
  echo "Error: ${AGENTS_FILE} not found (run this from repo root)." >&2
  exit 1
fi

if ! grep -Fqx "${LINE}" "${AGENTS_FILE}"; then
  printf '\n%s\n' "${LINE}" >> "${AGENTS_FILE}"
fi

mkdir -p "${DOCS_DIR}"

RAW_URL="${DOC_URL}"
if [[ "${DOC_URL}" == https://github.com/*/blob/* ]]; then
  RAW_URL="${DOC_URL/https:\\/\\/github.com\\//https:\\/\\/raw.githubusercontent.com\\/}"
  RAW_URL="${RAW_URL/\\/blob\\//\\/}"
fi

tmp="$(mktemp)"
trap 'rm -f "${tmp}"' EXIT
curl -fsSL "${RAW_URL}" -o "${tmp}"
mv "${tmp}" "${DOC_OUT}"
trap - EXIT
EOF
```

Notes:

- Appends the instruction line to `AGENTS.md` (only if it’s not already present).
- Creates `docs/` (if needed).
- Downloads the latest [HOW_TO_DOC.md](./HOW_TO_DOC.md) template from the SimpleDoc repo and saves it to `docs/HOW_TO_DOC.md`.

## After installation

The next time an agent needs to create a doc, the agent should fill in the missing parts in `docs/HOW_TO_DOC.md` and ask you to set up git author info if it is missing. If you want to speed this up, ask the agent to do the setup right away.
