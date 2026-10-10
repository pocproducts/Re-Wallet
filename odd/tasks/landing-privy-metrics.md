## Landing Page Private Metrics

**Goal**: Retrieve and display three key Privy metrics on the landing page. The metrics should be rendered in a responsive card layout and titled with a clear description.

### Required Metrics

1. **Total Wallets Created** – total count of user wallets created via Privy.
2. **Active Users (24h)** – number of unique users who signed in within the last 24 hours.
3. **Server‑Side Sign‑In Actions** – number of frontend sign‑in requests captured by the server.

(If preferred metrics differ, let me know.)

### Steps

1. **Privy API Exploration** – Inspect the Privy dashboard API or webhook data to identify the endpoints or webhook payloads that expose the required metrics.
2. **Backend Service Update** – Add a new route `/api/metrics/privy` to fetch those numbers from Privy (using saved webhook data or a direct request, depending on availability). Store the values in Redis/Cache to avoid rate limits.
3. **Frontend Update** – In the landing page (`04. Landing Page/site/`):
   - Add a new `<section id="privy-metrics">` with three cards.
   - Use CSS Grid or Flexbox for a three‑column layout on desktop, collapsing to single‑column on mobile.
   - Render the numbers using the fetched API.
4. **Styling** – Apply the lime color theme (`--lemon`) for text and icons, ensuring contrast against the dark background.
5. **Testing** – Write unit tests for the backend route; test responsiveness on iPhone SE, Galaxy S23, and desktop.
6. **Deployment** – Commit the changes, push to `main`, and execute the Cloudflare Pages deployment script.

### Acceptance Criteria

- Metrics are displayed correctly on the live site.
- Cards are responsive: 3 columns on ≥ 1024px width; 1 column on ≤ 768px.
- Numbers update via DNS‑cached API calls within 5‑minute granularity.

---

**Notes**: This task depends on Privy webhook data being stored. If the site does not already have webhook storage, please confirm so that we can add the ingestion logic first.
