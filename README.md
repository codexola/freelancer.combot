# freelancer.combot

Browser extension for automated bidding on [Freelancer.com](https://www.freelancer.com/search/projects). **Designed for [Octo Browser](https://octobrowser.net/)** (Chromium-based anti-detect profiles).

## Project structure

- `extension/` — Manifest V3 extension (works in Octo Browser and other Chromium browsers)
- `f1.png`–`f8.png` — Reference screenshots for bidding workflow

## Install (Octo Browser)

### 1. Profile settings (required)

Before installing the extension, create or edit your Octo profile and enable under **Storages**:

- **Extensions**
- **Local Storage**
- **Service workers** ← required for background monitoring and bidding

Save the profile, then start it.

### 2. Load the extension

**Option A — Profile Extensions menu (recommended, persists across sessions)**

1. In Octo, open **Create / Edit Profile** → **Extensions**
2. Click **Add a new extension** → tab **From file or folder**
3. Select the `extension` folder from this repo
4. Enable the extension in the profile settings

**Option B — Developer mode inside a running profile**

1. Start the profile
2. Open `chrome://extensions` in the address bar
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the `extension` folder
5. Turn the extension **on**

### 3. Icons (optional)

Run `node extension/scripts/generate-icons.js` if icon files are missing.

### 4. Use

1. Log in to [Freelancer.com](https://www.freelancer.com) in the **same Octo profile**
2. Click the extension icon → **ダッシュボードを開く**
3. Configure API keys and bid settings → click **開始**

See [extension/README.md](extension/README.md) for full setup and troubleshooting.

## Features

- Monitors new projects and bids within your configured time window
- Skips projects with 50+ bidders (configurable)
- Minimum project price: $100 USD
- Excludes clients from India, Pakistan, and African countries
- AI-generated proposals (Claude / OpenAI) up to 1500 characters
- Auto-signs IP agreements and NDAs
- Dashboard with real-time filtering console

## Octo Browser notes

- Run the bot **inside the Octo profile** where Freelancer is logged in — not in a separate Chrome window.
- Keep the profile **running** while the bot is active; closing the profile stops the service worker.
- If the filtering console stays empty, reload the extension on `chrome://extensions` and confirm **Service workers** is enabled in profile Storages.
- Official docs: [Installing Extensions | Octo Browser](https://docs.octobrowser.net/en/profiles/extensions/)
