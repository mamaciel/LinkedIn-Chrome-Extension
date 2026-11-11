// Pure logic: date formatting, the label sanity check, and the job helpers.
const { EXT_DIR, MINUTE, HOUR, DAY, createReporter } = require("./helpers");
const path = require("path");

const settings = require(path.join(EXT_DIR, "date-settings.js"));
const jobs = require(path.join(EXT_DIR, "linkedin-jobs.js"));
const { expect, expectEqual, finish } = createReporter("unit");

// A fixed "today" so the expected strings below never change.
const now = Date.parse("2026-11-11T20:00:00Z");

// ---- Is a decoded timestamp consistent with LinkedIn's own label? ----------
const consistent = (label, age, pageOpenFor = 0) =>
  settings.isTimestampConsistentWithRelativeText(label, now - age, {
    now,
    labelRenderedAfter: now - pageOpenFor,
  });

// Seen on LinkedIn with the right ID: must be accepted.
expectEqual("2d at 2.2 days", consistent("2d •", 2.2 * DAY), true);
expectEqual("4mo at 112 days (LinkedIn rounds)", consistent("4mo", 112 * DAY), true);
expectEqual("2yr at 709 days (LinkedIn rounds)", consistent("2yr", 709 * DAY), true);
expectEqual("1yr at 709 days", consistent("1yr • Edited •", 709 * DAY), true);
expectEqual("4w at 30 days", consistent("4w •", 30 * DAY), true);
expectEqual("1mo at 33 days", consistent("1mo •", 33 * DAY), true);
expectEqual("1mo at 49 days", consistent("1mo •", 49 * DAY), true);
expectEqual("11mo at 351 days", consistent("11mo •", 351 * DAY), true);
expectEqual("7m at 7.5 minutes", consistent("7m •", 7.5 * MINUTE), true);
expectEqual("1h at 40 minutes (device clock off)", consistent("1h", 40 * MINUTE), true);
expectEqual("5m label on a tab open for 3 hours", consistent("5m •", 3 * HOUR + 5 * MINUTE, 3 * HOUR), true);

// Seen on LinkedIn with the wrong ID: must be rejected.
expectEqual("1d but the ID is 5 days old (drafted early)", consistent("1d •", 5 * DAY), false);
expectEqual("21h but the ID is 2.5 days old", consistent("21h •", 2.5 * DAY), false);
expectEqual("2d but the ID is 3.6 days old", consistent("2d •", 3.6 * DAY), false);
expectEqual("2w but the ID is 6.9 days old (a repost)", consistent("2w • Edited •", 6.94 * DAY), false);
expectEqual("1mo but the ID is 9 days old (another card)", consistent("1mo •", 9 * DAY), false);
expectEqual("5m but the ID is 3 hours old on a fresh page", consistent("5m •", 3 * HOUR), false);

// Long-form labels (job cards, older layouts).
expectEqual("'1 week ago' but the ID is 20 hours old", consistent("1 week ago", 20 * HOUR), false);
expectEqual("'1 week ago' at 8 days", consistent("1 week ago", 8 * DAY), true);
expectEqual("'3 days ago' at 3.4 days", consistent("3 days ago", 3.4 * DAY), true);
expectEqual("'2 months ago' at 70 days", consistent("2 months ago", 70 * DAY), true);
expectEqual("'5 hours ago' but the ID is 3 days old", consistent("5 hours ago", 3 * DAY), false);

// Labels the check does not understand are never blocked.
expectEqual("'3 j' (French) passes", consistent("3 j", 9 * DAY), true);
expectEqual("'now' passes", consistent("now", 5 * DAY), true);

// ---- Date formatting --------------------------------------------------------
const format = (iso, overrides) =>
  settings.formatAbsoluteDate(new Date(iso), {
    locale: "en-US",
    timezoneMode: "local",
    showTime: true,
    now: new Date(now),
    dateFormat: "numeric",
    shortTimeZone: "EST",
    ...overrides,
  });

// The zone label follows the date shown, not today's date.
expectEqual("October date says EDT", format("2026-10-29T12:08:00Z"), "10/29/26, 8:08 AM EDT");
expectEqual("November date says EST", format("2026-11-09T05:03:00Z"), "11/09/26, 12:03 AM EST");
expectEqual("friendly style", format("2026-07-04T04:05:00Z", { dateFormat: "friendly" }), "July 4th, 12:05 AM EDT");
expectEqual("compact style adds the year for other years", format("2025-07-04T04:05:00Z", { dateFormat: "compact", showTime: false }), "Jul 4, 2025");
expectEqual("ISO style is 24-hour", format("2026-07-04T04:05:00Z", { dateFormat: "iso" }), "2026-07-04, 00:05 EDT");
expectEqual("UTC", format("2026-10-29T12:08:00Z", { timezoneMode: "utc" }), "10/29/26, 12:08 PM UTC");
expectEqual("timezone hidden", format("2026-10-29T12:08:00Z", { timezoneMode: "hidden" }), "10/29/26, 8:08 AM");
expectEqual("24-hour clock", format("2026-11-09T05:03:00Z", { use24HourTime: true }), "11/09/26, 00:03 EST");

// ---- Which text counts as a LinkedIn relative time ---------------------------
for (const text of ["2d •", "5d • Edited •", "1w", "1mo • Edited • ", "1yr", "now", "3h", "45m", "1 week ago"]) {
  expectEqual(`relative time: ${JSON.stringify(text)}`, settings.isRelativeTimeText(text), true);
}
for (const text of ["3 comments", "7 min read", "2 yrs 3 mos", "1st", "500+", "11/02/26, 12:46 PM EST • 2d •"]) {
  expectEqual(`not a relative time: ${JSON.stringify(text)}`, settings.isRelativeTimeText(text), false);
}

// ---- Job helpers ------------------------------------------------------------
expectEqual("job ID from ?currentJobId", jobs.getJobIdFromUrl("https://www.linkedin.com/jobs/search-results/?currentJobId=4487078550&keywords=x"), "4487078550");
expectEqual("job ID from /jobs/view/ID/", jobs.getJobIdFromUrl("https://www.linkedin.com/jobs/view/4487078550/"), "4487078550");
expectEqual("job ID from /jobs/view/title-ID", jobs.getJobIdFromUrl("https://www.linkedin.com/jobs/view/full-stack-engineer-at-spotify-4487078550?trk=x"), "4487078550");
expectEqual("no job ID on the feed", jobs.getJobIdFromUrl("https://www.linkedin.com/feed/"), "");
expectEqual("no job ID on the jobs home page", jobs.getJobIdFromUrl("https://www.linkedin.com/jobs/"), "");
expect("job pages are /jobs/...", jobs.isJobsPath("/jobs/search-results/") && jobs.isJobsPath("/jobs") && !jobs.isJobsPath("/in/someone/") && !jobs.isJobsPath("/company/x/jobs/"));

expectEqual("job label", JSON.stringify(jobs.extractJobAgeParts("1 week ago")), JSON.stringify({ prefix: "", relative: "1 week ago" }));
expectEqual("reposted job label", JSON.stringify(jobs.extractJobAgeParts("Reposted  2 days ago")), JSON.stringify({ prefix: "Reposted ", relative: "2 days ago" }));
expectEqual("a sentence is not a job label", jobs.extractJobAgeParts("12 months ago I walked through the doors"), null);
expectEqual("a post's short label is not a job label", jobs.extractJobAgeParts("2d •"), null);

const reposted = jobs.parseJobPosting({ listedAt: now - 2 * DAY, originalListedAt: now - 40 * DAY, title: "x" });
expect("posting dates are read", reposted.listedAt === now - 2 * DAY && reposted.originalListedAt === now - 40 * DAY);
expectEqual("posting wrapped in { data }", jobs.parseJobPosting({ data: { listedAt: now - DAY } }).originalListedAt, now - DAY);
expectEqual("posting without dates", jobs.parseJobPosting({ title: "x" }), null);
expectEqual("a 38-day gap is a repost", jobs.isRepostedJob(reposted), true);
expectEqual("a 7-minute gap is not a repost", jobs.isRepostedJob({ listedAt: now, originalListedAt: now - 7 * MINUTE }), false);

finish();
