# Public Infrastructure Inspection Map

A map-based inspection reporting app built on the Re:Earth CMS Integration API. Inspectors select an infrastructure asset (manhole, streetlight, traffic sign, or public bench) on the map and submit a condition report, with optional photos. The asset's condition and last-inspected date update automatically once a report is published.

## Security note

This project is built for learning the Integration API and is not hardened for
production use. The backend has no authentication — anyone with the URL can
create reports or modify asset data. Do not deploy this publicly without adding
your own authentication and access control.

## Architecture

- **Frontend** (`frontend/`) — Vite + TypeScript + MapLibre GL JS. Renders the map and the inspection form.
- **Backend** (`backend/`) — Express + TypeScript. Holds the Re:Earth CMS Integration API token and proxies all CMS operations. The frontend never sees the token.

## Prerequisites

- Node.js 20+
- A Re:Earth CMS project with `infrastructure-assets` and `inspection-reports` models (see [`backend/.env.example`](backend/.env.example) for the expected field keys), and an Integration API token with at least Writer access to it

## Setup

### Backend

```bash
cd backend
npm install
cp .env.example .env
```

Fill in `.env` with your CMS workspace ID, project ID, and integration token.

```bash
npm run dev
```

Runs at `http://localhost:3000`. `npm run build` compiles to `dist/`; `npm start` runs the compiled build.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs at `http://localhost:5173` (Vite dev server), proxying `/api` requests to the backend on port 3000 — both need to be running at once. `npm run build` produces a production build; `npm run preview` serves it locally.

## Environment variables (backend)

| Variable | Purpose |
|---|---|
| `PORT` | Backend server port (default `3000`) |
| `CMS_BASE_URL` | Re:Earth CMS API base URL |
| `CMS_WORKSPACE_ID` | Workspace ID or alias |
| `CMS_PROJECT_ID` | Project ID or alias |
| `CMS_ASSETS_MODEL` | Model key for infrastructure assets |
| `CMS_REPORTS_MODEL` | Model key for inspection reports |
| `CMS_INTEGRATION_TOKEN` | Integration API token — keep secret, never commit |
