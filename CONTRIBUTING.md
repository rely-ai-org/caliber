# Contributing to Caliber

Thanks for your interest in contributing! Here's how to get started.

## Setup

```bash
git clone https://github.com/rely-ai-org/caliber.git
cd caliber
npm install
npm run dev      # Watch mode
npm run test     # Run tests
npm run build    # Compile
```

## Development

- **Build**: `npm run build` (tsup → `dist/`)
- **Watch**: `npm run dev`
- **Test**: `npm run test` (Vitest)
- **Type check**: `npx tsc --noEmit`
- **Single test**: `npx vitest run src/scoring/__tests__/accuracy.test.ts`

### Project structure

| Directory | Purpose |
|-----------|---------|
| `src/commands/` | CLI commands (init, score, skills, etc.) |
| `src/ai/` | LLM-powered generation, refinement, detection |
| `src/llm/` | Multi-provider LLM layer (Anthropic, Vertex, OpenAI, Claude CLI, Cursor) |
| `src/fingerprint/` | Project analysis (languages, deps, file tree) |
| `src/scoring/` | Deterministic config quality scoring |
| `src/writers/` | File writers for Claude/Cursor configs |
| `src/scanner/` | Local state detection |

### Key conventions

- ES module imports require `.js` extension (even for `.ts` source)
- Prefer `unknown` over `any`
- Tests live in `__tests__/` directories next to their source
- Global LLM mocks are in `src/test/setup.ts`

## Pull requests

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add tests for new functionality
4. Run `npm run test` and `npx tsc --noEmit`
5. Use [conventional commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `refactor:`, `chore:`

## Reporting issues

Open an issue with:
- What you expected vs what happened
- Steps to reproduce
- Your environment (Node version, OS, provider used)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
