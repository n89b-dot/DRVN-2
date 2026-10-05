# Query-plan checks at volume

Throwaway databases only. Nothing here may point at shared dev or production;
the scripts refuse any port but the disposable ones (55440-55445) and any
engine but localhost.

```bash
# 1. A disposable Postgres 17 with every migration applied and the seed loaded,
#    plus a real PostgREST on PORT+1. PARTS sets the scale (members, cars and
#    updates follow from it — see the top of seed-volume.sql); UPTO stops the
#    migrations early for a "before" database.
PARTS=2000000 bash scripts/perf/fresh-db.sh                        # :55441, PostgREST :55442
UPTO=20261010100000 PARTS=200000 NAME=drvn-scale-200k PORT=55443 bash scripts/perf/fresh-db.sh

# 2. Timings through PostgREST, as a signed-out visitor and as a member with a
#    garage — the number that matters. MODE=after sends the requests the app
#    sends once 20261011100000-130000 are applied. OUT keeps a TSV.
API=http://127.0.0.1:55442 OUT=before.tsv bash scripts/perf/api-timings.sh
MODE=after API=http://127.0.0.1:55442 OUT=after.tsv bash scripts/perf/api-timings.sh

# 3. Sameness: the new paths against the old answers, row for row.
PGPASSWORD=postgres psql -h 127.0.0.1 -p 55441 -U supabase_admin -d postgres -f scripts/perf/compare-pages.sql
PGPASSWORD=postgres psql -h 127.0.0.1 -p 55441 -U supabase_admin -d postgres -f scripts/perf/compare-vehicle-fit.sql

# 4. What a write to a part costs (run before and after a migration).
PGPASSWORD=postgres psql -h 127.0.0.1 -p 55441 -U supabase_admin -d postgres -f scripts/perf/write-cost.sql

# 5. Plans, as the visitor's own database role.
PGPASSWORD=postgres psql -h 127.0.0.1 -p 55441 -U supabase_admin -d postgres -f scripts/perf/query-plans.sql | grep -E '^== |Execution Time'

# 6. A local search engine with the seed's parts for sale, built by the same
#    database function the search worker uses.
docker run -d --name drvn-scale-search -p 127.0.0.1:8109:8108 -v drvn-scale-search:/data typesense/typesense:30.2 --data-dir /data --api-key perf-key
ENGINE=http://127.0.0.1:8109 KEY=perf-key LIMIT=200000 bash scripts/perf/load-engine.sh
```

Step 2 is not optional. PostgREST passes a function's arguments as a joined
row, not as literals, and asks for an exact count by wrapping the call in a
CTE it reads twice. Both change the plan: a query that takes 60 ms in psql
took 2 s — or timed out — through the API.

On an 8 GB Mac the Docker VM has 6 GB: 2M parts (an 11 GB database) fit, but
not the 2M database and a full search engine at once (the engine needs about
3.3 KB of memory per part document). The seed builds 2M in about 30 minutes.
Results and what they led to are in `docs/performance/query-plans.md`; the
raw TSVs are in `scripts/perf/results/`.
