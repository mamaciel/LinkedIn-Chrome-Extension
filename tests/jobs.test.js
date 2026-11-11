// Runs the real content scripts on a simulated LinkedIn jobs page and checks
// the date shown on the open job, with LinkedIn's job endpoint replaced by a
// stand-in that records every request.
const { MINUTE, DAY, sleep, idAt, createReporter, loadExtensionOnPage } = require("./helpers");

const { expect, finish } = createReporter("jobs");
const now = Date.now();

// What the stand-in endpoint knows about each job.
const postings = {
  // Listed a few minutes after it was created: not a repost.
  4487078550: { listedAt: now - 8 * DAY, originalListedAt: now - 8 * DAY - 7 * MINUTE },
  // Reposted 2 days ago, first posted 40 days ago.
  4400000001: { listedAt: now - 2 * DAY, originalListedAt: now - 40 * DAY },
  4488888888: { listedAt: now - 5 * DAY, originalListedAt: now - 5 * DAY },
};
const PLAIN_JOB = "4487078550";
const REPOSTED_JOB = "4400000001";

const requests = [];
let refuseWithStatus = null;
const fetch = (url, options = {}) => {
  requests.push({ url: String(url), headers: options.headers || {}, credentials: options.credentials });
  if (refuseWithStatus) {
    return Promise.resolve({ ok: false, status: refuseWithStatus, json: () => Promise.reject(new Error("no body")) });
  }
  const posting = postings[String(url).split("/").pop()];
  return Promise.resolve({ ok: !!posting, status: posting ? 200 : 404, json: () => Promise.resolve(posting) });
};

// ---- Page building blocks, shaped like LinkedIn's jobs markup ---------------
// The open job's line. New jobs have the label in <strong>.
const openJobPane = (jobId, label, { bold = false } = {}) => {
  const labelHtml = bold
    ? `<span><strong id="openJob">${label}</strong></span>`
    : `<span id="openJob">${label}</span>`;
  return (
    `<a href="/jobs/view/${jobId}/">Job title</a>` +
    `<p><span>New York, NY</span> · ${labelHtml} · <span>Over 100 people clicked apply</span></p>` +
    // Job pages embed a company post; its ID must never be used for the job.
    `<a href="https://www.linkedin.com/feed/update/urn:li:activity:${idAt(now - 0.8 * DAY)}/">A company post</a>`
  );
};
// A card in the results list: the label twice (once for screen readers), no job ID.
const listCard = (id, hiddenLabel, visibleLabel) =>
  `<div><p><span>${hiddenLabel}</span><span aria-hidden="true">${visibleLabel.replace("{id}", id)}</span></p></div>`;

const html = `<!doctype html><html lang="en"><body><main>
<div id="list">
  ${listCard("card1", "Posted 1 week ago", '<span id="{id}">1 week ago</span>')}
  ${listCard("card2", "Reposted 2 weeks ago", '<span id="{id}">2 weeks ago</span>')}
  ${listCard("card3", "Posted 2 minutes ago", '<strong id="{id}">2 minutes ago</strong>')}
</div>
<div id="pane">${openJobPane(PLAIN_JOB, "1 week ago")}</div>
</main></body></html>`;

const searchUrl = (jobId) => `/jobs/search-results/?currentJobId=${jobId}&keywords=engineer`;
const page = loadExtensionOnPage({
  html,
  url: `https://www.linkedin.com${searchUrl(PLAIN_JOB)}`,
  fetch,
  cookie: 'JSESSIONID="ajax:1234567890"',
});
const { text, element, formatDate, changeSettings, document } = page;

// What clicking another job in the list does: new URL, new pane, no reload.
const openJob = async (jobId, label, options) => {
  page.window.history.pushState({}, "", searchUrl(jobId));
  document.getElementById("pane").innerHTML = openJobPane(jobId, label, options);
  await sleep(1300);
};
// The stacked rows under a reposted job's line, as "label | value | label | value".
const stackedRows = () => {
  const rows = document.querySelector("#pane [data-linkedin-job-dates]");
  return rows ? [...rows.children].map((cell) => cell.textContent).join(" | ") : null;
};
const plain = postings[PLAIN_JOB];
const reposted = postings[REPOSTED_JOB];
const repostedRows = (overrides) =>
  `First posted | ${formatDate(reposted.originalListedAt, overrides)} | Reposted | ${formatDate(reposted.listedAt, overrides)}`;

(async () => {
  await sleep(900);

  // The open job
  expect("the open job shows its posting date", text("openJob") === `${formatDate(plain.listedAt)} • 1 week ago`, text("openJob"));
  expect("a job listed minutes after creation is not called a repost", stackedRows() === null);

  // The list
  expect("list cards are left alone", text("card1") === "1 week ago" && text("card2") === "2 weeks ago" && text("card3") === "2 minutes ago", `${text("card1")} | ${text("card2")} | ${text("card3")}`);
  expect("no post date is invented on a job page", document.querySelectorAll("[data-original-text]").length === 0);

  // The lookup
  expect("exactly one lookup, for the open job", requests.length === 1 && requests[0].url === `/voyager/api/jobs/jobPostings/${PLAIN_JOB}`, requests.map((request) => request.url).join(", "));
  expect("the lookup is signed like LinkedIn's own requests", requests[0].headers["csrf-token"] === "ajax:1234567890" && requests[0].credentials === "include");

  // A reposted job
  await openJob(REPOSTED_JOB, "Reposted 2 days ago");
  expect("a reposted job keeps LinkedIn's label in its line", text("openJob") === "Reposted 2 days ago", text("openJob"));
  expect("both dates are stacked under the line, first posted on top", stackedRows() === repostedRows(), stackedRows());
  expect("the stacked dates sit inside the job's own line", document.querySelector("[data-linkedin-job-dates]").parentElement === element("openJob").closest("p"));
  expect("opening a second job made one more lookup", requests.length === 2, requests.length);

  // Back to the first job, this time with a bold label
  await openJob(PLAIN_JOB, "1 week ago", { bold: true });
  expect("a bold label on the open job is dated", element("openJob").tagName === "STRONG" && text("openJob") === `${formatDate(plain.listedAt)} • 1 week ago`, text("openJob"));
  expect("a job that was not reposted has no stacked rows", stackedRows() === null);
  expect("going back to a job uses the cache", requests.length === 2, requests.length);

  // Settings
  await openJob(REPOSTED_JOB, "Reposted 2 days ago");
  changeSettings({ separatorStyle: "hover" });
  await sleep(300);
  expect("hover mode keeps LinkedIn's label and shows no rows", text("openJob") === "Reposted 2 days ago" && stackedRows() === null);
  expect("hover mode: the tooltip has both dates on two lines", element("openJob").getAttribute("data-linkedin-hover-date") === `First posted ${formatDate(reposted.originalListedAt)}\nReposted ${formatDate(reposted.listedAt)}`, JSON.stringify(element("openJob").getAttribute("data-linkedin-hover-date")));

  changeSettings({ separatorStyle: "bullet", dateFormat: "iso" });
  await sleep(300);
  expect("the date style applies to the stacked dates", stackedRows() === repostedRows({ dateFormat: "iso" }), stackedRows());
  changeSettings({ dateFormat: "numeric" });
  await sleep(300);
  expect("only one block of stacked rows exists", document.querySelectorAll("[data-linkedin-job-dates]").length === 1);

  // On / off
  changeSettings({ showJobDates: false });
  await sleep(300);
  expect("turning job dates off removes them", text("openJob") === "Reposted 2 days ago" && stackedRows() === null && !element("openJob").hasAttribute("data-linkedin-job-id"));
  changeSettings({ showJobDates: true });
  await sleep(600);
  expect("turning job dates back on re-applies them", stackedRows() === repostedRows(), stackedRows());

  changeSettings({ extensionEnabled: false });
  await sleep(300);
  expect("turning the extension off removes them", text("openJob") === "Reposted 2 days ago" && stackedRows() === null);
  changeSettings({ extensionEnabled: true });
  await sleep(900);
  expect("turning the extension on re-applies them", stackedRows() === repostedRows(), stackedRows());
  expect("none of the settings changes made another lookup", requests.length === 2, requests.length);

  // LinkedIn refuses a lookup
  refuseWithStatus = 429;
  await openJob("4499999999", "3 days ago");
  expect("a refused lookup leaves LinkedIn's label", text("openJob") === "3 days ago", text("openJob"));
  const requestsBeforePause = requests.length;
  refuseWithStatus = null;
  await openJob("4488888888", "5 days ago");
  expect("after a refusal no lookups are made for a while", requests.length === requestsBeforePause && text("openJob") === "5 days ago", `${requests.length - requestsBeforePause} new`);

  expect("no script errors", page.scriptErrors.length === 0, page.scriptErrors.join("; "));
  finish();
})();
