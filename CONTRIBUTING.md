# Contributing to QuackBoard

Thank you for considering contributing to **QuackBoard**! We welcome bug reports, feature ideas, chart visualizers, database connectors, and documentation improvements.

## Local Development

```bash
git clone https://github.com/aymanmali/quackboard.git
cd quackboard
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — QuackBoard works immediately in zero-config browser mode (DuckDB-Wasm + IndexedDB) with a bundled Global Superstore sample dataset.

### Running Checks

Before opening a pull request, please ensure all checks pass:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Pull Request Guidelines

1. Keep pull requests focused on a single feature or fix.
2. Add or update unit tests in `src/**/*.test.ts` for any query compiler, security, or chart builder changes.
3. Follow the existing TypeScript strict mode and Tailwind styling conventions.
4. Explain the **why** and include screenshots for UI changes.
