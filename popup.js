document.addEventListener("DOMContentLoaded", () => {
  const successMessage = document.getElementById("successMessage");
  const extensionToggle = document.getElementById("extensionToggle");
  const dateFormatSelect = document.getElementById("dateFormatSelect");
  const separatorStyleSelect = document.getElementById("separatorStyleSelect");
  const timezoneModeSelect = document.getElementById("timezoneModeSelect");
  const timeFormatToggle = document.getElementById("timeFormatToggle");
  const showTimeToggle = document.getElementById("showTimeToggle");
  const jobDatesToggle = document.getElementById("jobDatesToggle");
  const datePreviewCurrent = document.getElementById("datePreviewCurrent");
  const datePreviewPrevious = document.getElementById("datePreviewPrevious");
  const settingsFields = document.getElementById("settingsFields");
  const timeFormatRow = document.getElementById("timeFormatRow");
  const timeFormatHint = document.getElementById("timeFormatHint");
  const localTimezoneOption = document.getElementById("localTimezoneOption");
  const timeFormatSwitchLabel = timeFormatToggle.closest(".switch");
  const {
    STORAGE_KEYS,
    normalizeDateFormat,
    normalizeSeparatorStyle,
    normalizeTimezoneMode,
    formatPreviewText,
    formatAbsoluteDate,
    localeUses24Hour,
    getShortTimeZone,
  } = LinkedInDateSettings;
  const userLocale = navigator.language || navigator.languages?.[0] || "en-US";
  const shortTimeZone = getShortTimeZone(new Date(), userLocale);

  if (localTimezoneOption) {
    localTimezoneOption.textContent = shortTimeZone
      ? `My timezone (${shortTimeZone})`
      : "My timezone";
  }

  function applyStoredSettings(data) {
    extensionToggle.checked = data.extensionEnabled !== false;
    dateFormatSelect.value = normalizeDateFormat(data.dateFormat);
    separatorStyleSelect.value = normalizeSeparatorStyle(data.separatorStyle);
    timezoneModeSelect.value = normalizeTimezoneMode(data.timezoneMode);
    timeFormatToggle.checked =
      data.use24HourTime !== undefined
        ? !!data.use24HourTime
        : localeUses24Hour(userLocale);
    showTimeToggle.checked = data.showTime !== false;
    jobDatesToggle.checked = data.showJobDates !== false;
    syncToggleA11y();
    setSettingsEnabled(extensionToggle.checked);
    updateTimeFormatToggleState();
  }

  if (typeof chrome === "undefined" || !chrome.storage) {
    applyStoredSettings({});
  } else {
    chrome.storage.sync.get(
      STORAGE_KEYS,
      (data) => {
        if (chrome.runtime.lastError) {
          applyStoredSettings({});
          return;
        }
        applyStoredSettings(data || {});
      },
    );
  }

  function syncToggleA11y() {
    extensionToggle.setAttribute("aria-checked", String(extensionToggle.checked));
    showTimeToggle.setAttribute("aria-checked", String(showTimeToggle.checked));
    jobDatesToggle.setAttribute("aria-checked", String(jobDatesToggle.checked));
    timeFormatToggle.setAttribute("aria-checked", String(timeFormatToggle.checked));
  }

  function setSettingsEnabled(enabled) {
    settingsFields.dataset.disabled = enabled ? "false" : "true";
    settingsFields.querySelectorAll("select, input").forEach((control) => {
      if (control === timeFormatToggle) return;
      control.disabled = !enabled;
    });
    if (enabled) {
      updateTimeFormatToggleState();
    } else {
      timeFormatToggle.disabled = true;
    }
  }

  function persistSettings(settings, onSaved) {
    if (typeof chrome === "undefined" || !chrome.storage) {
      onSaved?.();
      return;
    }

    chrome.storage.sync.set(settings, () => {
      if (chrome.runtime.lastError) {
        successMessage.textContent = "Couldn’t save";
        showSuccessMessage();
        if (Object.prototype.hasOwnProperty.call(settings, "extensionEnabled")) {
          extensionToggle.checked = !settings.extensionEnabled;
          applyEnabledState(extensionToggle.checked);
        }
        return;
      }
      successMessage.textContent = "Saved";
      onSaved?.();
    });
  }

  function getUiSettings() {
    return {
      dateFormat: dateFormatSelect.value,
      separatorStyle: separatorStyleSelect.value,
      timezoneMode: timezoneModeSelect.value,
      use24HourTime: timeFormatToggle.checked,
      showTime: showTimeToggle.checked,
    };
  }

  function updateSettings(settings) {
    persistSettings(settings, () => {
      showSuccessMessage();
    });
  }

  function applyEnabledState(extensionEnabled) {
    syncToggleA11y();
    setSettingsEnabled(extensionEnabled);
  }

  extensionToggle.addEventListener("change", () => {
    const extensionEnabled = extensionToggle.checked;
    applyEnabledState(extensionEnabled);
    persistSettings({ extensionEnabled }, () => {
      showSuccessMessage();
    });
  });

  dateFormatSelect.addEventListener("change", () => {
    updateTimeFormatToggleState();
    updateDatePreview();
    updateSettings({ dateFormat: dateFormatSelect.value });
  });

  separatorStyleSelect.addEventListener("change", () => {
    updateDatePreview();
    updateSettings({ separatorStyle: separatorStyleSelect.value });
  });

  timezoneModeSelect.addEventListener("change", () => {
    updateDatePreview();
    updateSettings({ timezoneMode: timezoneModeSelect.value });
  });

  timeFormatToggle.addEventListener("change", () => {
    if (timeFormatToggle.disabled) return;
    updateDatePreview();
    updateSettings({ use24HourTime: timeFormatToggle.checked });
  });

  showTimeToggle.addEventListener("change", () => {
    updateTimeFormatToggleState();
    updateSettings({ showTime: showTimeToggle.checked });
  });

  jobDatesToggle.addEventListener("change", () => {
    syncToggleA11y();
    updateSettings({ showJobDates: jobDatesToggle.checked });
  });

  function updateTimeFormatToggleState() {
    const isoLocked = dateFormatSelect.value === "iso";
    const timeHidden = !showTimeToggle.checked;
    const shouldDisable = isoLocked || timeHidden || !extensionToggle.checked;

    timeFormatToggle.disabled = shouldDisable;
    timeFormatRow.style.opacity = shouldDisable ? 0.5 : 1;
    timeFormatSwitchLabel.title = isoLocked
      ? "The 2026-01-17 style always uses 24-hour time"
      : timeHidden
        ? "Turn on Include time to change this"
        : "";
    timeFormatHint.textContent = isoLocked
      ? "Always on for 2026-01-17 dates"
      : timeHidden
        ? "Available when time is shown"
        : timeFormatToggle.checked
          ? "Example: 17:22"
          : localeUses24Hour(userLocale)
            ? "Uses your language default"
            : "Example: 5:22 PM";

    syncToggleA11y();
    updateDatePreview();
  }

  function updateDateStyleOptions() {
    const sample = new Date(new Date().getFullYear(), 0, 17, 17, 22);
    const optionSettings = {
      locale: userLocale,
      timezoneMode: "hidden",
      showTime: false,
      now: sample,
    };
    ["compact", "friendly", "numeric"].forEach((dateFormat) => {
      const option = dateFormatSelect.querySelector(
        `option[value="${dateFormat}"]`,
      );
      if (option) {
        option.textContent = formatAbsoluteDate(sample, {
          ...optionSettings,
          dateFormat,
        });
      }
    });
  }

  updateDateStyleOptions();

  function updateDatePreview() {
    const currentYear = new Date().getFullYear();
    const settings = {
      ...getUiSettings(),
      locale: userLocale,
      shortTimeZone,
    };

    datePreviewCurrent.textContent = formatPreviewText(
      new Date(currentYear, 0, 17, 17, 22),
      settings,
    );
    datePreviewPrevious.textContent = formatPreviewText(
      new Date(currentYear - 1, 0, 17, 17, 22),
      settings,
    );
  }

  let successMessageTimer = 0;

  function showSuccessMessage() {
    successMessage.classList.add("show");
    clearTimeout(successMessageTimer);
    successMessageTimer = setTimeout(() => {
      successMessage.classList.remove("show");
    }, 2000);
  }

  function openLinkFromPopup(event) {
    event.preventDefault();
    const url = event.currentTarget?.href;
    if (!url || typeof chrome === "undefined" || !chrome.tabs?.create) return;
    chrome.tabs.create({ url });
  }

  document.getElementById("creditsLink").addEventListener("click", openLinkFromPopup);
  document.querySelector(".coffee-button").addEventListener("click", openLinkFromPopup);
});
