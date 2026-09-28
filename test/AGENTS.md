# Frontend Test Guide

| Layer | Tool | Location |
|---|---|---|
| Unit | Vitest + React Testing Library | `test/*.test.ts(x)` |
| Integration | Vitest + RTL + real Rust via NAPI | `test/integration/**/*.test.tsx` |

Setup lives in `setup.common.ts` (DOM polyfills, Tauri API stubs) and `setup.integration.ts` (NAPI dispatch). Factories are in `factories/`, UI library mocks in `mocks/`, render helpers in `test-utils.tsx`.

## Integration test pattern

1. Create a real jj repository via NAPI (`createTestRepo`)
2. Set the active repo URL param (`openRepo`)
3. Render `<Dashboard />` — Tauri `invoke` is replaced with NAPI dispatch
4. Drive the UI via `userEvent`
5. Assert DOM state

```typescript
describe("workspace header", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    const { repoPath } = createTestRepo(false);
    openRepo(repoPath);
    user = userEvent.setup();
  });

  it("switches branch on click", async () => {
    await createWorkspace(repoPath, "feat/thing");
    render(<Dashboard />);
    await user.click(await findSidebarBranchElement("feat/thing"));
    expect(await screen.findByText("feat/thing")).toBeTruthy();
  });
});
```

## Checklist

- Start every test from `createTestRepo()`; never share repo state between tests
- Render `<Dashboard />`, not individual components, so the full provider tree runs
- Use `userEvent`, never `fireEvent`
- Prefer `screen.findBy*` over `getBy*` for elements that appear after Rust calls resolve
- Assert visible text or ARIA roles, not internal state or which private functions ran
- Keep `beforeEach` minimal; move complex repo setup into the test or a shared helper
- Never mock the Rust backend in integration tests; use the real NAPI dispatch
