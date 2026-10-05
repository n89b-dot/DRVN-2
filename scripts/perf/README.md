# Query-plan checks at volume

Throwaway databases only. Nothing here may point at shared dev or production;
the scripts refuse any port but the disposable ones.

```bash
# 1. A disposable database with every migration applied
docker run -d --name drvn-plans-db -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55441:5432 supabase/postgres:15.14.1.158
export PGPASSWORD=postgres PGHOST=127.0.0.1 PGPORT=55441 PGUSER=supabase_admin PGDATABASE=postgres
psql -q -v ON_ERROR_STOP=1 -f supabase/tests/ci_shim.sql
for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done

# 2. About 100x the invited beta: 60,000 parts, 120,000 updates, 12,000 cars
psql -q -f scripts/perf/seed-volume.sql

# 3. Plans, as the visitor's own database role
psql -f scripts/perf/query-plans.sql | grep -E '^== |Execution Time'

# 4. Timings through a real PostgREST — the number that matters
docker network create drvn-plans-net && docker network connect drvn-plans-net drvn-plans-db
psql -c "alter role authenticator with password 'postgres'"
docker run -d --name drvn-plans-rest --network drvn-plans-net -p 127.0.0.1:55442:3000 \
  -e PGRST_DB_URI=postgres://authenticator:postgres@drvn-plans-db:5432/postgres \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  -e PGRST_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long \
  public.ecr.aws/supabase/postgrest:v14.1
API=http://127.0.0.1:55442 bash scripts/perf/api-timings.sh
```

Step 4 is not optional. PostgREST passes a function's arguments as a joined
row, not as literals, and asks for an exact count by wrapping the call in a
CTE it reads twice. Both change the plan: a query that takes 60 ms in psql
took 2 s — or timed out — through the API. Results and what they led to are
in `docs/performance/query-plans.md`.
