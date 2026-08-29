# AfterRelease checklist

- [ ] Smoke-test the released environment (key flows work, not just localhost).
- [ ] Confirm migrations applied successfully on the target database.
- [ ] Watch logs/metrics for new errors right after release.
- [ ] Tag the release and record the version in the Changelog.
- [ ] Update docs (Configuration / Migration / README) if the release changed them.
- [ ] Capture anything learned during release as a `skills/` file (merge, don't duplicate).
- [ ] Report release status faithfully, including anything that needs follow-up.
