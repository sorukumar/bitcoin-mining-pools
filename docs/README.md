# Documentation Index

This folder is the canonical reference for any LLM or developer working on this project.
Read these documents **in order** before making any change.

| File | What it answers |
|---|---|
| [01-architecture.md](./01-architecture.md) | What the system is, what it does, folder layout, tech stack, constraints |
| [02-data-flow.md](./02-data-flow.md) | How data moves from raw CSV → parquet → browser → charts, including every transform |
| [03-logic-flow.md](./03-logic-flow.md) | Runtime execution order, state machine, function call graph, filter/render cycle |
| [04-adding-features.md](./04-adding-features.md) | Step-by-step patterns for the most common extension tasks |

## Project in one sentence
A static Bitcoin mining pool dashboard hosted on GitHub Pages that reads
**dual-parquet** files in the browser via **hyparquet**, aggregates 869k+ blocks client-side,
and renders eight **ECharts** visualisations including market share, decentralization indices,
and geographic distributions — no backend, no build step.
