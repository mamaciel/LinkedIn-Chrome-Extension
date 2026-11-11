(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.LinkedInJobs = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const EARLIEST_JOB_TS = Date.UTC(2003, 0, 1);

  function isJobsPath(pathname) {
    return /^\/jobs(?:\/|$)/i.test(String(pathname || ""));
  }

  // The job that is open: ?currentJobId=123 on search and collection pages,
  // /jobs/view/123/ (optionally /jobs/view/some-title-123/) on its own page.
  function getJobIdFromUrl(href) {
    let url;
    try {
      url = new URL(String(href || ""), "https://www.linkedin.com");
    } catch (error) {
      return "";
    }

    const fromQuery = url.searchParams.get("currentJobId") || "";
    if (/^\d{6,}$/.test(fromQuery)) return fromQuery;

    const match = url.pathname.match(
      /^\/jobs\/view\/(?:[^/?#]*?-)?(\d{6,})(?:\/|$)/i,
    );
    return match ? match[1] : "";
  }

  // LinkedIn's own label on a job: "1 week ago", "Reposted 2 days ago".
  const JOB_AGE_REGEX =
    /^(reposted\s+|posted\s+)?((?:\d+\s+(?:minutes?|hours?|days?|weeks?|months?|years?)\s+ago)|just now)$/i;

  function extractJobAgeParts(value) {
    const text = String(value || "")
      .replace(/ /g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const match = text.match(JOB_AGE_REGEX);
    if (!match) return null;
    return {
      prefix: match[1] ? `${match[1].trim()} ` : "",
      relative: match[2],
    };
  }

  function toTimestamp(value) {
    const number = Number(value);
    return Number.isFinite(number) &&
      number > EARLIEST_JOB_TS &&
      number < Date.now() + 2 * DAY_MS
      ? number
      : null;
  }

  // Reads the two dates out of LinkedIn's job posting response:
  // listedAt is the current listing (a repost moves it), originalListedAt is
  // when the job was first put up.
  function parseJobPosting(payload) {
    const sources = [
      payload,
      payload && payload.data,
      payload && Array.isArray(payload.elements) && payload.elements[0],
    ];
    for (const source of sources) {
      if (!source || typeof source !== "object") continue;
      const listedAt = toTimestamp(source.listedAt);
      const originalListedAt = toTimestamp(source.originalListedAt);
      if (!listedAt && !originalListedAt) continue;
      return {
        listedAt: listedAt || originalListedAt,
        originalListedAt: originalListedAt || listedAt,
      };
    }
    return null;
  }

  // A new listing is usually created a few minutes before it goes live, so
  // only a gap of a day or more counts as a repost.
  function isRepostedJob(posting) {
    return (
      !!posting && posting.listedAt - posting.originalListedAt >= DAY_MS
    );
  }

  return {
    isJobsPath,
    getJobIdFromUrl,
    extractJobAgeParts,
    parseJobPosting,
    isRepostedJob,
  };
});
