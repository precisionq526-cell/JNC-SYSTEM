# Queue theory: analysis and implementation

## References reviewed

- `Queueing_Theory_and_Schedule_Theory.pdf`, 9 pages: human and printer stages, M/G/1 and M/G/2, observations, waiting burden, ATC priority, hybrid refresh.
- `G_G_c Queue Model.pdf`, 15 pages: arrival and service variability, general multi-server approximations, tandem capacity analysis. Much of its narrative concerns 3D printing, so CAD, powder-bed quorum batches, and reinforcement learning are not requirements for this document-printing shop.
- `ISO 1941 and the implications of cohnitive ergonomics in system design.pdf`, 10 pages: the actual subject is ISO **9241**, interaction principles and usability evaluation.

The documents are research references, not operational instructions. Several references contain placeholder citations or incomplete titles. Claims of guaranteed optimality and universal accuracy have not been adopted. ISO's official description confirms the standard is ISO 9241-110:2020: https://www.iso.org/standard/75258.html. General queue approximations and their practical limitations are discussed by Ward Whitt: https://www.columbia.edu/~ww2040/ApproxGIGm1993.pdf.

## Applied rules

| Area | Implementation |
| --- | --- |
| Capacity | 0, 1, or 2 active order-processing staff slots. Zero pauses waiting work. Reducing capacity lets existing work drain. Printers are not added to the staff count. |
| Statistical model | G/G/c approximation using observed interarrival and service variability, utilization, Wq, W, Lq, L, and waiting burden. |
| Walk-ins | First come, first served, including large jobs. |
| Scheduled pickups | ATC score based on deadline slack, estimated duration in minutes, and the existing rush flag. Urgent scheduled pickups move ahead of ordinary walk-ins. |
| Fairness | Any waiting job aged at least 60 minutes is protected; protected jobs use arrival order. This threshold is a configurable shop policy, not a theorem in the PDFs. |
| Individual estimates | Simulate the finite backlog across processing slots, including residual in-progress work. Show separate waits before processing and estimates to finish. |
| State updates | Realtime events with 300 ms debounce, plus polling every 15 seconds under load and 30 seconds otherwise, only while the admin page is visible. These are practical bounds; the theoretical optimum needs measured cost constants. |
| Human factors | Priority reasons, stable ticket numbers, status text, loading/errors distinct from an empty queue, disabled invalid actions, completion confirmation, responsive table scrolling, labeled controls. |
| Observations | Arrival, processing start, completion, channel, empirical waiting/service/total times, and CSV export of valid completed samples. |

## Equations and units

All rates use orders per minute; all durations use minutes. c is the number of processing slots.

```text
lambda = arrivals during the latest 60 minutes / 60
mu = 1 / mean service minutes
Ca² = sample variance(interarrival minutes) / mean(interarrival minutes)²
Cs² = sample variance(service minutes) / mean(service minutes)²
rho = lambda * mean service minutes / c
Wq ≈ ((Ca² + Cs²) / 2) * rho^(sqrt(2(c+1))-1)
     * mean service minutes / (c * (1-rho))
W = Wq + mean service minutes
Lq = lambda * Wq
L = lambda * W
WBR = Wq / W
```

At c=0, there is no stationary estimate. At rho>=1, expected stationary waits and lengths are unavailable, rather than finite invented numbers. A finite current-backlog projection may still be shown with an explicit overload warning; it excludes future arrivals and is not a guaranteed completion time.

Arrival intervals include simultaneous orders (zero gaps). Overnight gaps across Manila calendar dates are excluded. The service sample uses only completed jobs with valid ordered timestamps in the latest seven days, up to 500 jobs. Estimated durations do not count as measured service samples. With fewer than 10 valid samples, the respective variability defaults to 1 and the model is labeled provisional. Ten samples is a display threshold, not proof of fit or sufficient statistical power. Correlations, breaks, heterogeneous work, and changing arrival rates can reduce accuracy.

### Priority rule

```text
ATC = weight / estimatedProcessingMinutes
      * exp(-max(0, minutesUntilPickup-estimatedProcessingMinutes)
            / (k * meanScheduledProcessingMinutes))
      / (1 + gamma * knownPages / meanKnownPages)
```

Default k=2, gamma=0. Page density is independently dimensionless. The first PDF adds pages directly to minutes; that unit mismatch is corrected. Page penalties remain disabled until calibrated because unknown page counts and heavy penalties can disadvantage large orders. Existing estimated order durations are used; no pages-per-minute speed has been invented. The rush weight is 2 when the existing server-controlled order field is true.

The combined dispatch order is: protected old jobs, scheduled jobs whose latest start has passed, FCFS walk-ins, then remaining scheduled jobs ranked by ATC. Ties use arrival time and ID. Running jobs are never preempted. If an in-progress job has exceeded its estimated duration or has no start timestamp, remaining time is unknown. Blocked slots yield unavailable estimates; a separate free slot may still accept work. The model recalculates at each queue refresh; projected durations hold the current rank fixed until the next refresh. Administrators can choose a different waiting job, within the enforced available capacity.

Individual backlog waits are **not** increased by stationary Wq: doing that would count congestion twice. Ticket numbers are identifiers; the current position is a separate calculated value. Overnight unfinished jobs remain eligible. Positions and estimates come from the same snapshot for admin and customer tracking, rather than stale submission-time values.

## What is still an empirical research step

This release models occupied order-processing slots from `started_at` through `completed_at`. It is a conservative pooled workflow approximation. Those durations include printer execution and finishing; they are not isolated active human labor measurements. The UI states this limitation.

The references' desired network is preparation -> printers -> finishing/pickup, with human staff shared between preparation and finishing. A reliable tandem model needs separate start/end events for each stage, staff break/return logs, compatible printer capacity and availability, page counts, and service classes. Neither the current schema nor the completed-job sample contains that full data. The implementation therefore does not claim that printers are negligible or sum human and printer server counts.

For a later field study:

1. Record arrival, preparation start/end, printer start/end, finishing start/end, staff ID, available staff, printer ID, pages/copies, interruptions, and promised pickup.
2. Estimate arrival and each stage's service moments within comparable open-hour/peak periods. Model staff availability changes as transient events; a changed stationary c is only a baseline.
3. Estimate the printer-stage arrival variance from actual preparation departures, or a validated QNA approximation.
4. Find the smallest stable integer printer count for which estimated printer waiting is below the chosen fraction of human waiting or total lead time. The two PDFs use different denominators (human wait vs. total lead time); choose and document one. Do not treat their thresholds as interchangeable.
5. Validate predictions against held-out observations and discrete-event simulation before changing promises or purchasing printers.

Failure to reject an exponential-arrival hypothesis is not proof of Poisson arrivals. Rejection of exponential service times does not uniquely identify a distribution. A chi-squared fit test needs suitable bins, expected counts, and adjusted degrees of freedom. G/G/c is used without asserting a tested Poisson process.

No ISO certification is claimed. Measure staff task completion, time on task, errors, and satisfaction in the actual shop. Evaluate keyboard use, mobile scrolling, error recovery, large-job fairness, staffing changes, and deadline comprehension with representative users.

## Database rollout

Apply `supabase/migrations/20260929_ggc_dispatch.sql` after the existing schema and hardware migration. It adds a singleton settings table and an atomic status-transition function. The function locks the settings row and order, checks the admin actor, validates transitions, and enforces capacity before starting work. Only service_role can invoke it; every Server Action also checks the authenticated user's admin profile. Order and queue timestamps update together. Hardware tracking follows the successful order transaction.

The existing project has not yet received this migration. If the settings table is missing, the admin displays a setup message, shows estimates explicitly assuming one slot, and disables the new dispatch controls. This is not an offline or successful setup indicator. There is no SQL execution RPC configured and no database password/management connection supplied in the workspace, so the migration requires an authorized database connection or the project's Supabase SQL editor.

To finish setup: open the project's SQL editor, run the saved migration, refresh the app, and select the actual active staff count. Validate two simultaneous starts and the last available slot on disposable test orders; no live orders were changed during development. Existing in-progress jobs above the selected capacity can finish, and new starts wait for capacity.

## Login connection follow-up

The earlier login error was a browser `Failed to fetch`. An initial sandboxed DNS query failed, but a later lookup resolved the project and an unrestricted read reached Supabase. The database read also succeeded. The project is not established to be deleted or paused.

Login now uses a Next.js Server Action and the existing Supabase SSR cookie client. The browser submits to the same app origin. Connection errors are shown inline with recovery instructions, and external redirect values are rejected. The local development server was restarted bound to 127.0.0.1:3100 with outbound access to the existing project. The existing admin credentials successfully opened the protected admin queue through the updated flow.

## Verification

- `node --test scripts/queue-model.test.cjs`: 20 model/scheduler tests passed.
- TypeScript check, targeted ESLint, and production build passed.
- Read-only Supabase checks confirmed the project responds, four active orders exist, and the new queue settings table is missing.
- Live admin login succeeded. The protected queue displayed the four existing active orders and the setup warning.
- No order was started, completed, or submitted to the cloud as a test.
- Atomic transition and RLS integration must be checked after the migration is applied; local mathematical tests do not validate a remote PostgreSQL transaction.

This document supersedes the older SYSTEM_MANUAL sections describing M/G/1-only telemetry, submission-time waits, and queue-number-only dispatch.
