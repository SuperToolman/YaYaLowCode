---
name: isolated-script-example
description: Demonstrates independent scripts, templates and workspace artifacts.
---

Use skill_list_resources to find scripts and templates. Run scripts/report.py with
skill_run_script. Inputs are available below YAYA_INPUT_DIR, immutable Skill
resources below YAYA_SKILL_DIR, and generated files must be written below
YAYA_OUTPUT_DIR. These fixed runtime paths are documented conventions, not Skill
configuration. Do not request installation during a task. The platform injects
any Skill configuration at execution time; do not print or inspect configuration.
