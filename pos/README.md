<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/68f1a0d2-d9ef-496d-9a45-8f19290401f4

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Run with Docker Compose

From the repository root, run:

`docker compose up --build pos`

The POS frontend is available at `http://localhost:5175`. Requests to `/api` are proxied to the `backend` service.

## Current authentication UI

The POS includes a login-screen preview and a session-only frontend gate. It does not call the authentication API yet; submitting any valid email/password-shaped input opens the POS UI for design testing.

## Install as an app

Open the POS in a supported browser and use **Install app**. The included web app manifest, service worker, and dedicated icons install LiveMatch POS as a standalone PWA.
