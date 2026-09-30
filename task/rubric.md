# Rubric

Base commit: see `BASE_COMMIT`. Blockers: `bash task/run_blockers.sh` (tests in `task/tests/blockers.test.ts`).
The repo has no test suite of its own; its existing check is `npx tsc --noEmit` / `npm run build`, which must still pass.

## Blockers

| # | What it checks | Why a maintainer would reject a PR that fails it |
|---|---|---|
| B1 | A link with `maxViews: 3` hit by 20 simultaneous `getByToken` calls serves the report exactly 3 times, every other call fails with 410, and the stored `viewCount` is 3. Repeated 5 times. | This is the feature's whole promise. A limit that is checked and then incremented as two separate steps lets simultaneous requests slip past it (the near-miss serves 18 of 20). A leaked link could then be opened far more often than the owner allowed. |
| B2 | 25 simultaneous views of an unlimited link all succeed, `viewCount` ends at exactly 25, and `lastViewedAt` is set. | This is the reported bug. The base code records 25 simultaneous views as about 2, so owners get wrong engagement numbers. |
| B3 | A 2-view link returns 200, 200, then 410 twice, and `viewCount` stays at 2. An unknown token still returns 404. Revoked and expired links that have views left still return 410, and their `viewCount` doesn't change. | These are existing behaviours the issue says to keep. A common mistake with the atomic approach is returning 404 for every failed update, or counting views that weren't served. Either one breaks clients that show "expired" or "revoked" messages. |
| B4 | `POST /reports/share` returns 400 and creates no link for `maxViews` of 0, -1, 2.5, `"abc"` or `true`. `maxViews: 5` returns 201, stores 5, and the link opens. Leaving `maxViews` out gives an unlimited link (10 views succeed). | Unvalidated input could store a limit that locks the link from the start, or a value the atomic check compares wrongly. Omitting the field must not change existing behaviour. |
| B5 | `InvestorReportShareService.list` includes `maxViews` and the current `viewCount` for a limited link. | The issue asks for this. Without it, owners can't see how many views a link has left. |

## Quality criteria

1. **The limit check and the increment happen in one atomic, conditional database update.** For example, a single `findOneAndUpdate` or `updateOne` whose filter includes status, expiry and `viewCount < maxViews`, and which applies `$inc`. The fix doesn't read the document, check it, and then write. It doesn't add transactions, locks or retry loops, and it doesn't use `.save()` for the counter.
2. **Error responses reuse `ApiError` with the existing messages.** Unknown links return 404, and revoked or expired links return 410, with the same messages as before. The only new message is a 410 for the view limit. Any follow-up lookup that decides which error to return is read-only and never changes `viewCount`.
3. **`maxViews` is validated in the controller, next to the existing `range` checks.** An invalid value returns the same `{ success: false, message }` 400 shape before `createShare` is called. The service and model don't duplicate this validation, beyond at most a `min: 1` on the schema field.
4. **Existing links keep working without a migration.** `maxViews` is optional in the model and has no default, so links created before this change stay unlimited.
5. **The scope stays small.** Changes are limited to the share model, service and controller, plus route and doc comments. There are no new dependencies, and no changes to the rate limiter, the TTL index, token hashing or unrelated routes.

## Near-miss

`task/near-miss.patch` implements everything in the prompt. It validates `maxViews`, stores it, lists it, and makes the counter atomic with `$inc`, which fixes B2. But it checks `viewCount >= maxViews` on a document it already loaded and only then increments. It passes B2 through B5 and fails B1, serving the report 18 times against a limit of 3.
