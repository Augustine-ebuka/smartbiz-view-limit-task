# Investor report links: optional view limit, and accurate view counts

Owners want to cap how many times a shared investor report can be opened.

When creating a link (`POST /api/v1/reports/share`, and `InvestorReportShareService.createShare`), accept an optional `maxViews`: a positive whole number. Reject any other value with a 400 and don't create the link. If it's omitted, the link has no view limit, as today.

Opening a link (`GET /api/v1/investor-reports/:token`, i.e. `getByToken`) should succeed at most `maxViews` times in total. After that, respond with a 410 saying the link has reached its view limit. This must hold even when many requests for the same link arrive at the same moment: a link with `maxViews: 3` hit by 20 simultaneous requests returns the report exactly 3 times.

Separately, `viewCount` is currently undercounted when views arrive together. Every successful view must be counted exactly once, and failed views (unknown, revoked, expired or over the limit) not at all.

Unknown, revoked and expired links keep their current 404 / 410 responses. Owners should see `maxViews` alongside `viewCount` in their share list (`GET /api/v1/reports/share`).
