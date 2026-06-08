# freelancer.combot

Chrome extension for automated bidding on [Freelancer.com](https://www.freelancer.com/search/projects).

## Project structure

- `extension/` — Chrome extension (Manifest V3)
- `f1.png`–`f8.png` — Reference screenshots for bidding workflow

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `extension` folder

## Features

- Monitors new projects and bids within 3–10 seconds
- Skips projects with 50+ bidders
- Minimum project price: $100 USD
- Excludes clients from India, Pakistan, and African countries
- AI-generated proposals (Claude / OpenAI) up to 1500 characters
- Auto-signs IP agreements and NDAs
- Dashboard for settings, stats, and bid logs

See [extension/README.md](extension/README.md) for detailed setup.
