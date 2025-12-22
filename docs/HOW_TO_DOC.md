# Documentation Guidelines

---

## MUST DO SETUP

**Attention agent!** This file is a template for creating instructions on how to create documentation in this repository. The placeholder sections should be filled in, before anything else.

1. Fetch the most recent SimpleDoc specification from https://github.com/osolmaz/SimpleDoc and copy it below, replacing the placeholder content.
2. Ask the user about their preferences in documentation style: Do they prefer a certain style of writing, a certain tone, a certain level of technicality, a certain way to create implementation plans, etc. Do a few rounds of back-and-forth to get the user's preferences, and use the output to populate the placeholder content in the Preferences in Documentation Style section.

After finishing the setup, DELETE ONLY this section between dividers `---`. The other agent instruction below is to be kept as is.

---

**Attention agent!** Complete every item below before touching documentation work:

1. **Read this file in full for the current session.** No shortcuts. Open `docs/HOW_TO_DOC.md`, refresh your memory, and only then proceed.
2. **Verify that git is initialized and configured.** You will need the name and email of the current user in order to populate the `author` field in the YAML frontmatter. Run the following one-liner to verify:

```bash
printf '%s <%s>\n' "$(git config --local --get user.name 2>/dev/null || git config --global --get user.name)" "$(git config --local --get user.email 2>/dev/null || git config --global --get user.email)"
```

If the name and email are not available for some reason, ask the user to provide them, and also setup git configuration for them.

## SimpleDoc Specification

```
<Replace this part with the content of SimpleDoc specification>
```

## Preferences in Documentation Style

```
<Replace this part with the user's preferences in documentation style>
```

## Before You Start

1. Run `date +%Y-%m-%d` and use the output for both filename prefix and `date` field.
2. Identify where the document belongs:
   - Keep general documentation at the root of `docs/`.
   - If exists, use the dedicated subdirectories for specialized content.
3. Check for existing, related docs to avoid duplicates and to link to prior work.

## File Naming

- Format: `YYYY-MM-DD-descriptive-title.md`. Always use lower case, words separated by hyphens.
- Choose names that reflect the problem or topic, not the team or author.
- Example: `2025-06-20-api-migration-guide.md`.
- Place the file in the appropriate folder before committing.

### Timeless vs. Dated

- Docs fall into two buckets:
  - **Timeless general documents** describe enduring processes or repo-wide rules. They do not carry a date prefix and keep their canonical names.
  - **All other content** (design notes, incidents, feature guides, migrations, meeting notes, etc.) must use the date-prefixed naming pattern above with a lower-case, hyphenated title.
- When adding or reviewing documentation, decide which bucket applies. If the doc is not a long-lived reference, rename or relocate it so the filename uses the `YYYY-MM-DD-…` form before merging.

## Required Front Matter

Every doc **must** start with YAML front matter:

```yaml
---
date: 2025-10-24          # From `date +%Y-%m-%d`
author: Name <email@example.com>
title: Short Descriptive Title
tags: [tag1, tag2]        # Optional but recommended
---
```

SimpleDoc Guidelines:

- Keep the `date` value in sync with the filename prefix.
- Use a real contact in `author` (`Name <email>`).
- The `author` value **must** match the active user's entry in `.localuser`. Read that file and copy the exact `Name` and `Email` (e.g., `Author: John Doe <john@example.com>`).
- Choose a concise, action-oriented `title`.
- Populate `tags` when it improves discoverability; omit the line if not needed.

## Final Checks Before Submitting

- [ ] Filename follows the `YYYY-MM-DD-…` pattern and lives in the correct directory.
- [ ] Timeless vs. dated classification is correct and filenames reflect the choice.
- [ ] Front matter is complete and accurate.
- [ ] Links to related documentation exist where applicable.
