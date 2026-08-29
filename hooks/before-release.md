# BeforeRelease checklist

> Release is hard to reverse. **Get explicit user approval before proceeding.**

- [ ] All AfterTask and BeforeCommit checks passed on the release branch.
- [ ] Full test suite / build passes cleanly.
- [ ] Version bumped and Changelog updated.
- [ ] All DB migrations are ready and idempotent; migration guide updated if needed.
- [ ] Config/environment differences between environments confirmed (e.g. `.env` targets the right server).
- [ ] Deploy artifacts verified (e.g. build output, SPA fallback files, static assets present).
- [ ] Rollback plan understood.
- [ ] User has explicitly approved the release.
