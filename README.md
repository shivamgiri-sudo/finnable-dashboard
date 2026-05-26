# Finnable Sales & Quality Intelligence Command Center  
## Node.js + Express + MySQL Connection Pool — V1.0

This package moves the working Finnable dashboard from direct Apps Script JDBC calls to a pooled Node.js API while preserving the existing dashboard UI, analytics logic, call evidence trace and transcript highlighting.

## Confirmed SQL Source

| Item | Configuration |
|---|---|
| Database | `db_external` |
| Table | `CallDetails` |
| Finnable Scope | `client_id = 497` |
| Current SQL validation | 78 source columns validated; 800 Finnable rows observed during testing |
| Data access | Read-only `SELECT` queries only |

## Why This Build Fixes the Speed Problem

The Apps Script implementation establishes remote JDBC connections for page/detail requests. Your single call detail test returned approximately 4.8 seconds for the detail read even though the record is located through the primary-key `id` index.

This Node backend uses `mysql2/promise.createPool()` and warms reusable database connections when the server starts. The UI calls the Express API, and the API reuses pooled connections instead of making an Apps Script JDBC handshake per click.

## Preserved UI and Functions

The original HTML/CSS dashboard interface remains visually the same. A browser-side compatibility bridge maps the former `google.script.run` calls to REST endpoints without rewriting the render logic.

Preserved features include:

- PIN login
- Executive Overview
- Sales Pitch Intelligence
- Journey & Support Intelligence
- Quality & Coaching
- Compliance & Transparency
- Analyst Scorecard and Analyst Cockpit
- Call Explorer
- Action Center
- Filter controls and drilldowns
- Evidence-backed call drawer
- Exact transcript-range highlights
- Mobile masking and credential masking
- Existing leakage/risk/action derivation logic
- Existing Google Charts views
- 30-second auto refresh

Enhancements included:

- MySQL connection pooling and start-up warming
- JWT session after PIN login, so the PIN is not resent for every API call
- Summary-row cache for repeated dashboard/filter requests
- Manual Refresh bypasses cache
- Direct primary-key call-detail query
- Protected diagnostic endpoint for timing and EXPLAIN output
- Login rate limiting
- Security response headers and compression

## Project Structure

```text
Finnable_Node_MySQL_Pool_Dashboard_V1.0/
├── .env.example
├── .gitignore
├── package.json
├── public/
│   └── index.html
├── scripts/
│   └── test-sql.js
└── src/
    ├── server.js
    ├── config/index.js
    ├── db/pool.js
    ├── engine/analyticsEngine.js
    ├── middleware/auth.js
    ├── repositories/auditRepository.js
    ├── routes/api.js
    └── services/dashboardService.js
```

## Set Up on Your Windows Machine

### 1. Extract the ZIP and open PowerShell in the folder

```powershell
cd C:\path\to\Finnable_Node_MySQL_Pool_Dashboard_V1.0
```

### 2. Install packages

```powershell
npm install
```

### 3. Create your environment file

```powershell
Copy-Item .env.example .env
notepad .env
```

Update these values in `.env`:

```env
DASHBOARD_PIN=your_dashboard_pin
JWT_SECRET=put_a_long_random_secret_here_at_least_32_characters
DB_PASSWORD=your_existing_mysql_password
```

The database source is already prefilled:

```env
DB_HOST=122.184.128.90
DB_PORT=3306
DB_USER=shivam_user
DB_DATABASE=db_external
DB_AUDIT_TABLE=CallDetails
DEFAULT_CLIENT_ID=497
```

Never upload or share the completed `.env` file.

### 4. Test SQL through the pooled backend

```powershell
npm run test:sql
```

Expected output includes:

```json
{
  "success": true,
  "source": "db_external.CallDetails",
  "clientId": "497",
  "clientRowCount": 800,
  "detailReturned": true
}
```

The row count can increase as new calls are audited.

### 5. Start the dashboard

```powershell
npm start
```

Open:

```text
http://localhost:3000
```

Login with the `DASHBOARD_PIN` configured in `.env`.

## REST Endpoint Mapping

| Existing Dashboard Action | Node API Endpoint |
|---|---|
| Login / authenticate | `POST /api/auth/login` |
| Main dashboard | `POST /api/dashboard` |
| Insight drilldown calls | `POST /api/insights/calls` |
| Call Explorer | `POST /api/calls/explorer` |
| Analyst Cockpit | `POST /api/analysts/cockpit` |
| Call Evidence Detail | `GET /api/calls/:callId?clientId=497` |
| Database health | `GET /api/health` |
| Protected timing diagnostic | `GET /api/diagnostics/call/:callId?clientId=497` |

## Check Call-Detail Performance

After logging in, the dashboard call drawer will use the pooled API automatically. For a direct protected API diagnostic, open browser DevTools and call after login:

```javascript
fetch('/api/diagnostics/call/462834?clientId=497', {
  headers: { Authorization: 'Bearer ' + sessionStorage.getItem('finnable_dashboard_token') }
}).then(r => r.json()).then(console.log);
```

Compare `detailSqlMs` with the previous Apps Script result of approximately `4758 ms`.

## Deployment Note

Running this Node server from the same network/machine where your current MySQL login succeeds is the fastest first test. If you later deploy the Node backend to Azure/Linux or another server, the MySQL administrator must allow the backend server's IP for the existing read-only user, or create a new restricted read-only user for that server.

## SQL Index Request Still Relevant

The existing `PRIMARY (id)` supports single call detail lookup. The missing composite index below remains useful for dashboard date filtering and latest-call queries:

```sql
ALTER TABLE db_external.CallDetails
ADD INDEX idx_finnable_client_calldate (client_id, CallDate);
```

Your current `shivam_user` does not have ALTER permission, so this must be completed by the authorised database administrator.
