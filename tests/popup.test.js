// Loads the real popup with a stand-in for chrome.storage and checks that it
// renders, previews and saves.
const { readExtensionFile, createReporter } = require("./helpers");
const { JSDOM } = require("jsdom");

const { expect, expectEqual, finish } = createReporter("popup");

function openPopup(storedSettings = {}) {
  const dom = new JSDOM(readExtensionFile("popup.html"), {
    url: "https://extension.test/popup.html",
    runScripts: "outside-only",
  });
  const window = dom.window;
  const saved = {};
  const scriptErrors = [];
  window.chrome = {
    runtime: { lastError: undefined },
    storage: {
      sync: {
        get: (_keys, callback) => callback({ ...storedSettings }),
        set: (values, callback) => {
          Object.assign(saved, values);
          if (callback) callback();
        },
      },
    },
    tabs: { create() {} },
  };
  window.addEventListener("error", (event) => scriptErrors.push(event.message));
  window.eval(readExtensionFile("date-settings.js"));
  window.eval(readExtensionFile("popup.js"));
  window.document.dispatchEvent(new window.Event("DOMContentLoaded"));

  const byId = (id) => window.document.getElementById(id);
  const change = (id, apply) => {
    apply(byId(id));
    byId(id).dispatchEvent(new window.Event("change"));
  };
  return { window, byId, change, saved, scriptErrors };
}

// ---- Defaults ---------------------------------------------------------------
const popup = openPopup();
const { byId, change, saved } = popup;

expect("the extension is on by default", byId("extensionToggle").checked);
expect("job posting dates are on by default", byId("jobDatesToggle").checked);
expectEqual("default 'Show as'", byId("separatorStyleSelect").value, "bullet");
expect("the preview shows a date for this year", /^01\/17\/\d\d, 5:22 PM \w+ • 2d$/.test(byId("datePreviewCurrent").textContent), byId("datePreviewCurrent").textContent);
expect("the date style options show real examples", [...byId("dateFormatSelect").options].map((option) => option.textContent.trim()).slice(0, 2).join(" | ") === "Jan 17 | January 17th");
expect("the Buy me a coffee link is present", !!popup.window.document.querySelector("a.coffee-button[href*='buymeacoffee.com']"));

// ---- Changing settings ------------------------------------------------------
change("dateFormatSelect", (select) => (select.value = "iso"));
expectEqual("choosing ISO is saved", saved.dateFormat, "iso");
expect("ISO locks the 24-hour switch", byId("timeFormatToggle").disabled);
expect("the preview follows the date style", byId("datePreviewCurrent").textContent.startsWith(`${new Date().getFullYear()}-01-17, 17:22`), byId("datePreviewCurrent").textContent);

change("separatorStyleSelect", (select) => (select.value = "date-only"));
expectEqual("'Date, no 2d' is saved", saved.separatorStyle, "date-only");
expect("'Date, no 2d' drops the 2d from the preview", !byId("datePreviewCurrent").textContent.includes("2d"), byId("datePreviewCurrent").textContent);

change("showTimeToggle", (toggle) => (toggle.checked = false));
expectEqual("turning off the time is saved", saved.showTime, false);
expect("the preview has no time", !/\d:\d\d/.test(byId("datePreviewCurrent").textContent), byId("datePreviewCurrent").textContent);

change("jobDatesToggle", (toggle) => (toggle.checked = false));
expectEqual("turning off job dates is saved", saved.showJobDates, false);

change("extensionToggle", (toggle) => (toggle.checked = false));
expectEqual("turning the extension off is saved", saved.extensionEnabled, false);
expect("the other settings are disabled while it is off", byId("dateFormatSelect").disabled && byId("jobDatesToggle").disabled);

expect("no script errors", popup.scriptErrors.length === 0, popup.scriptErrors.join("; "));

// ---- Stored settings are shown when the popup opens ---------------------------
const reopened = openPopup({ dateFormat: "friendly", separatorStyle: "hover", showJobDates: false, timezoneMode: "utc" });
expectEqual("stored date style is selected", reopened.byId("dateFormatSelect").value, "friendly");
expectEqual("stored 'Show as' is selected", reopened.byId("separatorStyleSelect").value, "hover");
expectEqual("stored job dates switch is shown", reopened.byId("jobDatesToggle").checked, false);
expectEqual("stored timezone is selected", reopened.byId("timezoneModeSelect").value, "utc");

finish();
