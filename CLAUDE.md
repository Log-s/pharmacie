
## Engineering workflow requirements

For every implementation plan:

1. **Before UI implementation**
   - Use `frontend-design` for visual direction.
   - Use `Interface Design` to establish and maintain design tokens and conventions.
   - Use shadcn/ui skill guidance when implementing shadcn components.

2. **During implementation**
   - Follow Ponytail's engineering principles.
   - Prefer minimal, maintainable solutions.
   - Avoid unnecessary abstractions and dependencies.

3. **Before completion**
   - Invoke web-design-guidelines to audit accessibility,
     responsive behavior, and UI quality.
   - Invoke webapp-testing and run relevant browser tests.
   - Fix failures and rerun affected tests.

4. **Subagents**
   - Explicitly tell each relevant subagent which skills
     and project rules it must follow.
   - Do not assume skills invoked in the parent agent are
     automatically available in every subagent.

5. **Shipping gate**
   - Verify acceptance criteria, tests, documentation,
     and the final Git diff before reporting completion.
   - Report anything skipped or still failing.

