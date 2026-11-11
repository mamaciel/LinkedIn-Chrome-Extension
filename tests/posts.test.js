// Runs the real content scripts on a simulated LinkedIn feed and checks what
// each post, comment and reply ends up showing.
const {
  HOUR,
  DAY,
  sleep,
  idAt,
  encodedToken,
  shortLabel,
  createReporter,
  loadExtensionOnPage,
} = require("./helpers");

const { expect, finish } = createReporter("posts");
const now = Date.now();

// When each thing on the page was posted.
const posted = {
  draftTimeId: now - 2.3 * DAY, // card only has a ugcPost (creation-time) ID
  publishId: now - 23 * DAY, // card has an activity (publish-time) ID
  repostOriginal: now - 300 * DAY,
  repostActivity: now - 290 * DAY,
  draftedDaysEarlier: now - 5.2 * DAY, // ID says 5 days, LinkedIn's label says 1d
  withComments: now - 3.5 * DAY,
  comment: now - 1.4 * DAY,
  reply: now - 1.2 * DAY,
  reshare: now - 4.2 * DAY,
  embeddedOriginal: now - 9.5 * DAY,
  jobUpdateDraft: now - 8.4 * DAY,
  jobUpdatePublished: now - 8.4 * DAY + 5.5 * HOUR,
  addedLater: now - 6.1 * HOUR,
};

// ---- Page building blocks, shaped like LinkedIn's current feed markup -------
const FEED = "MAIN_FEED_RELEVANCE";
const timeLabel = (id, timestamp, suffix = " • ") =>
  `<p><span id="${id}">${shortLabel(now - timestamp)}${suffix}</span></p>`;
const card = (key, inner, feedType = FEED) =>
  `<div role="listitem" componentkey="update-card-focus${key}FeedType_${feedType}"><div componentkey="${key}">${inner}</div></div>`;
const commentBox = (key, timestamp, field, feedType = FEED) =>
  `<div componentkey="${encodedToken(timestamp, field)}-replaceableCommentTools${key}FeedType_${feedType}"></div>`;
const author = (name) => `<a href="https://www.linkedin.com/in/${name}/">${name}</a>`;
const postLink = (timestamp, text) =>
  `<a href="https://www.linkedin.com/feed/update/urn:li:activity:${idAt(timestamp)}/">${text}</a>`;
const commentKey = (postTimestamp, commentTimestamp) =>
  `replaceableComment_urn:li:comment:(urn:li:ugcPost:${idAt(postTimestamp)},${idAt(commentTimestamp)})`;

const html = `<!doctype html><html lang="en"><body>
<nav><span id="navTime">3h</span></nav>
<main><div role="list" id="list">
${card("KEYA", `${author("alice")}${timeLabel("draftTimeId", posted.draftTimeId)}<div>Post</div>${commentBox("KEYA", posted.draftTimeId, 2)}`)}
${card("KEYB", `${author("bob")}${timeLabel("publishId", posted.publishId, " • Edited • ")}<div>Post</div>${commentBox("KEYB", posted.publishId, 1)}`)}
${card("KEYR", `<p>Marcos reposted this</p>${author("amy")}${timeLabel("repost", posted.repostOriginal)}${postLink(posted.repostActivity, "Original text")}`, "PROFILE")}
${card("KEYD", `${author("dan")}<p><span id="drafted">1d • </span></p><div>Scheduled post</div>${commentBox("KEYD", posted.draftedDaysEarlier, 2)}`)}
${card("KEYC", `${author("cat")}${timeLabel("withComments", posted.withComments)}<div>Post</div>${commentBox("KEYC", posted.withComments, 2)}
  <div componentkey="${commentKey(posted.withComments, posted.comment)}"><span id="comment">${shortLabel(now - posted.comment)}</span><div>A comment</div>
    <div componentkey="${commentKey(posted.withComments, posted.reply)}"><span id="reply">${shortLabel(now - posted.reply)}</span><div>A reply</div></div>
  </div>`)}
${card("KEYO", `${author("olga")}${timeLabel("reshare", posted.reshare)}<div>My thoughts</div>
  <div>${author("eve")}${timeLabel("embedded", posted.embeddedOriginal)}${postLink(posted.embeddedOriginal, "Embedded text")}</div>${commentBox("KEYO", posted.reshare, 2)}`)}
${card("KEYJ", `${author("paul")}${timeLabel("jobUpdate", posted.jobUpdatePublished)}<div>${postLink(posted.jobUpdatePublished, "Starting a new position")}</div>${commentBox("KEYJ", posted.jobUpdateDraft, 2)}`, "PROFILE_REACTIONS")}
</div>
<section><p><span id="stray">3 days ago</span></p></section>
</main></body></html>`;

const page = loadExtensionOnPage({ html, url: "https://www.linkedin.com/feed/" });
const { text, element, formatDate, changeSettings, document } = page;

const original = (timestamp, suffix = " •") => shortLabel(now - timestamp) + suffix;
const showsExact = (id, timestamp, overrides) =>
  text(id).startsWith(`${formatDate(timestamp, overrides)} • `);
const showsApproximate = (id, timestamp, overrides) =>
  text(id).startsWith(`~${formatDate(timestamp, overrides)} • `);
const hasApproximateMark = (id) => element(id).hasAttribute("data-linkedin-approx");
const hoverDate = (id) => element(id).getAttribute("data-linkedin-hover-date");
const tooltip = () => document.querySelector("[data-linkedin-dates-tooltip]");
const tooltipVisible = () => !!tooltip() && tooltip().style.display === "block";
// The simulated page has no layout, so every element sits at 0,0: a pointer
// there counts as hovering the first marked date.
const movePointer = async (x, y) => {
  document.dispatchEvent(
    new page.window.MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true }),
  );
  await sleep(60);
};
const zoneOf = (timestamp) =>
  new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
    .formatToParts(new Date(timestamp))
    .find((part) => part.type === "timeZoneName").value;

(async () => {
  await sleep(300);

  // Each post gets its own date
  expect("a post with a draft-time ID shows its date marked ~", showsApproximate("draftTimeId", posted.draftTimeId), text("draftTimeId"));
  expect("a post with a publish-time ID shows an exact date", showsExact("publishId", posted.publishId), text("publishId"));
  expect("the Edited suffix is kept", text("publishId").endsWith("• Edited •"), text("publishId"));
  expect("the timezone label matches the post's date, not today", text("publishId").includes(` ${zoneOf(posted.publishId)} `), text("publishId"));
  expect("exact dates carry no ~ mark", !text("publishId").startsWith("~") && !hasApproximateMark("publishId"));

  // Explaining the ~
  expect("~ dates are marked for the tooltip, without a title attribute", hasApproximateMark("draftTimeId") && element("draftTimeId").getAttribute("title") === null);
  await movePointer(0, 0);
  expect("hovering a ~ date shows the tooltip", tooltipVisible());
  expect("the tooltip is inside <body>, where LinkedIn does not hide it", tooltip().parentElement === document.body);
  await movePointer(500, 500);
  expect("moving away hides the tooltip", !tooltipVisible());

  // Cases where the only ID on the card is not the post's own
  expect("a 'reposted this' card is left alone", text("repost") === original(posted.repostOriginal), text("repost"));
  expect("an ID that contradicts LinkedIn's label is not shown", text("drafted") === "1d •", text("drafted"));
  expect("a time with no post card around it gets no date", text("stray") === "3 days ago", text("stray"));
  expect("a time in the nav bar is ignored", text("navTime") === "3h", text("navTime"));

  // Comments and replies
  expect("a post with comments open shows the post's date", showsApproximate("withComments", posted.withComments), text("withComments"));
  expect("a comment shows its own date", showsExact("comment", posted.comment), text("comment"));
  expect("a reply shows its own date, not its parent comment's", showsExact("reply", posted.reply), text("reply"));
  expect("comment dates are exact", !hasApproximateMark("comment") && !hasApproximateMark("reply"));

  // Reshares and in-card links
  expect("a reshare shows its own date", showsApproximate("reshare", posted.reshare), text("reshare"));
  expect("the embedded original shows the original's date", showsExact("embedded", posted.embeddedOriginal), text("embedded"));
  expect("an in-card link to the post beats the draft-time ID", showsExact("jobUpdate", posted.jobUpdatePublished), text("jobUpdate"));

  // Infinite scroll
  document.getElementById("list").insertAdjacentHTML(
    "beforeend",
    card("KEYL", `${author("lee")}${timeLabel("addedLater", posted.addedLater)}<div>Post</div>${commentBox("KEYL", posted.addedLater, 1)}`),
  );
  await sleep(300);
  expect("a card added after load is dated", showsExact("addedLater", posted.addedLater), text("addedLater"));

  // Settings
  changeSettings({ dateFormat: "iso" });
  await sleep(150);
  expect("ISO date style", showsApproximate("draftTimeId", posted.draftTimeId, { dateFormat: "iso" }) && text("draftTimeId").charAt(5) === "-", text("draftTimeId"));

  changeSettings({ separatorStyle: "date-only", showTime: false, dateFormat: "friendly" });
  await sleep(150);
  const friendlyDay = { dateFormat: "friendly", showTime: false };
  expect("date without the 2d and without a time", text("draftTimeId") === `~${formatDate(posted.draftTimeId, friendlyDay)} •`, text("draftTimeId"));

  changeSettings({ separatorStyle: "hover" });
  await sleep(150);
  expect("hover mode keeps LinkedIn's text", text("draftTimeId") === original(posted.draftTimeId), text("draftTimeId"));
  expect("hover mode: approximate date says so", hoverDate("draftTimeId") === `~${formatDate(posted.draftTimeId, friendlyDay)} (approximate)`, hoverDate("draftTimeId"));
  expect("hover mode: exact date has no ~", hoverDate("publishId") === formatDate(posted.publishId, friendlyDay), hoverDate("publishId"));
  await movePointer(0, 0);
  expect("hover mode: hovering shows the tooltip", tooltipVisible());
  await movePointer(500, 500);

  changeSettings({ timezoneMode: "utc", separatorStyle: "paren", showTime: true, dateFormat: "numeric" });
  await sleep(150);
  const utcDate = `~${formatDate(posted.draftTimeId, { timezoneMode: "utc" })}`;
  expect("UTC with the 2d in parentheses", text("draftTimeId") === `${utcDate} (${shortLabel(now - posted.draftTimeId)}) •` && text("draftTimeId").includes(" UTC ("), text("draftTimeId"));

  // On / off
  changeSettings({ extensionEnabled: false });
  await sleep(150);
  expect("turning the extension off restores LinkedIn's labels", text("draftTimeId") === original(posted.draftTimeId) && text("reply") === shortLabel(now - posted.reply) && text("publishId") === original(posted.publishId, " • Edited •"), `${text("draftTimeId")} | ${text("reply")} | ${text("publishId")}`);
  await movePointer(0, 0);
  expect("turning it off removes the ~ mark and the tooltip", !hasApproximateMark("draftTimeId") && !tooltipVisible());

  changeSettings({ extensionEnabled: true });
  await sleep(300);
  expect("turning it back on re-applies the dates", text("draftTimeId").startsWith(utcDate) && hasApproximateMark("draftTimeId"), text("draftTimeId"));

  expect("no script errors", page.scriptErrors.length === 0, page.scriptErrors.join("; "));
  finish();
})();
