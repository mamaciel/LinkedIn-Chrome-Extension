# LinkedIn Date Display Extension 🕒

Hey there! I made this Chrome extension because I was tired of LinkedIn's vague "2w" or "3d" timestamps. Now you can see exactly when stuff was posted!

## What it does
- Replaces those annoying relative timestamps with actual dates
- Works everywhere on LinkedIn (feed, profiles, single posts)
- Keeps the original relative time too (like "2w") just in case you want both
- Very lightweight and shouldn't slow down your browsing

## Want to try it?
Just download it from the Chrome Web Store (https://chromewebstore.google.com/detail/display-linkedin-post-dat/hkgafbpgfpjjamcgkfdkdocppfpcjjhn)!
![image](https://github.com/user-attachments/assets/1dce4330-ab34-46e2-9ce8-17c413b9686c)


## Settings ⚙️
You get two display options:
- Just the date (like "12/25/23")
- Full date + time (like "12/25/23, 2:30PM EST")

## Tech Stuff (if you're curious)
- Uses MutationObserver to catch new posts as they load in the main feed
- Monitors URL changes for LinkedIn's single-page app navigation
- Decodes LinkedIn's post IDs to get the exact timestamp (pretty neat trick!)
- Keeps everything in sync with Chrome's storage API

## Found a bug?
Feel free to open an issue or shoot me a message!

The concept and the converting of the timestamps are straightforward, the hard part about this project is LinkedIn hides the post ID in different places and various formats, and since it uses single-page navigation you need to monitor the url differently.
