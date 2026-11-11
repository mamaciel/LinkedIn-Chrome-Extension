# LinkedIn Date Display Extension 🕒

Hey there! I made this Chrome extension because I was tired of LinkedIn's vague "2w" or "3d" timestamps. Now you can see exactly when stuff was posted!

## What it does

- Replaces those annoying relative timestamps with actual dates
- Works on the feed, profiles, company pages, single posts, and comments
- Keeps the original relative time too (like "2w") just in case you want both
- Shows when a job posting went up, and when it was first posted if it has been reposted
- Marks a date with "~" when LinkedIn only exposes when the post was drafted or scheduled, so you know it may have been published a bit later
- Very lightweight and shouldn't slow down your browsing

## Want to try it?

Just download it from the Chrome Web Store (https://chromewebstore.google.com/detail/display-linkedin-post-dat/hkgafbpgfpjjamcgkfdkdocppfpcjjhn)!
![image](https://github.com/user-attachments/assets/1dce4330-ab34-46e2-9ce8-17c413b9686c)


## Settings

- Turn exact dates on or off
- Date style: compact, friendly, numeric, or ISO
- Show as date + 2d, date without the 2d, or date on hover
- Optional time of day, 24-hour clock, and timezone
- Job posting dates on or off
- Dates follow your browser language

## Tech Stuff (if you're curious)

- Uses MutationObserver to catch new posts as they load in the main feed
- Monitors URL changes for LinkedIn's single-page app navigation
- Decodes LinkedIn's post IDs to get the exact timestamp (pretty neat trick!)
- Keeps everything in sync with Chrome's storage API

## Working on it

The extension itself has no build step: load this folder with **Load unpacked** in `chrome://extensions`.

Tests and packaging need Node.js:

```bash
npm install
```

```bash
npm test
```

`npm test` runs four files in `tests/`:

- `unit.test.js`: date formatting, the check against LinkedIn's own label, job helpers
- `posts.test.js`: the real content scripts on a simulated feed (posts, comments, replies, reshares, settings)
- `jobs.test.js`: the same for a jobs page, with LinkedIn's job endpoint replaced by a stand-in
- `popup.test.js`: the popup renders, previews and saves

Set `VERBOSE=1` to list every check, not just failures.

To make the zip for the Chrome Web Store:

```bash
npm run zip
```

It writes `dist/linkedin-post-dates-<version>.zip` with only the files the extension runs. Upload that zip, not a zip of this folder, so tests and `node_modules` never ship.

## Found a bug?

Feel free to open an issue or shoot me a message!

The concept and the converting of the timestamps are straightforward, the hard part about this project is LinkedIn hides the post ID in different places and various formats, and since it uses single-page navigation you need to monitor the url differently.
