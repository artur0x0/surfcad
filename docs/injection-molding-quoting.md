# Injection molding quoting

Budgetary tooling math for aluminum and steel. It reads a
`molding_tooling_rates` card and does not write one. It is not a supplier
quote. The print quote in `src/utils/quoteMath.js` is a different path.

The function is `toolingEstimate` in `src/molding/toolingEstimate.js`.
`TOOLING_CONSTANTS` in that file is the stand-in a manufacturing review
can retune. Nothing here calls a press, a resin price, or Stripe.

## Mold base

The footprint is the parting-plane box: length and width on the plate,
height along the pull. One cavity is the default.

Cavities sit in a grid that is as square as it can be. Plate length is
`columns × part length + (columns − 1) × gap + 2 × margin`. Width is the
same with the part width and the row count. The stack is the part height
plus backup on both sides, and at least the minimum stack.

Aluminum and steel each use their own density and their own `$/kg` from
the card. Mass in kilograms is `volume (mm³) × density (g/cm³) / 1,000,000`.

## Hours

Aluminum hours are `baseHoursSimple × cavities` plus the parting-line
length divided by the shutoff rate. Steel adds
`coolingLineHoursFactor × cavities`. Each metal multiplies its hours by
its own machining rate.

## Adders

Slides, lifters, ejector pins, and sleeves use the card's dollar adders.
The count is the analysis count times the cavity count, so each cavity
pays for its own actions. A shared slide across a family mold is not
modeled.

A hot runner is suggested when the flow is at least the flow limit, or
when flow length divided by max wall is at least the aspect limit. The
suggestion price stays off the aluminum and steel totals unless the
caller includes it. It is once per mold.

## Where steel becomes cheaper

Unit cost at quantity N is `part cost + tooling / N`. The reported
quantity is the smallest N where the steel unit cost is at or under the
aluminum unit cost. Steel never catches up when its tool costs more and
its part does not cost less.

Until part cost exists, the part figures are a stand-in cycle
(`fill + k × wall² + mechanical seconds`) times a stand-in press rate.
Resin is the same for both metals, so it would not move that quantity.
Pass `partCostUsd` to replace the stand-in. An inactive rate card is refused.

## Part cost and ranking

`rankMoldingQuotes` in `src/molding/partQuote.js` is the budgetary part price.
`quoteMolding` in `backend/services/moldingQuote.js` loads the active catalog
and calls it. The caller does not send a price. The result uses `anonLabel`
and `region` only. It does not write `Quote` and it does not add a molding
quote collection.

Clamp force is projected area times 50 MPa, converted at 9806.65 newtons per
ton. Projected area is the parting-plane footprint times the cavity count.
Shot volume is the part volume times the cavities times 1.15. A press fits
when the clamp is within its tonnage, the shot is 20–80% of the barrel, the
plate fits the platen and the tie bars in one rotation, and utilization is
under 100%. Effective rate is the hourly rate divided by `1 − utilization`.

Cycle time is the same stand-in as the tooling estimate: fill, plus `k` times
max wall squared, plus the mechanical seconds. Aluminum uses the uncooled `k`.
Resin mass is volume (cm³) times density (g/cm³), in kilograms. With no grade
named, the partner’s cheapest active resin is used. Grades match exactly.
Prices come from `molding_resin_prices` only. The generic resin library is
not loaded by this quote.

Partners with no fitting press are left out. The rest sort by the lowest unit
cost, then the public label. The range is the cheap metal and the expensive
metal across the presses that fit. Unit cost is the part cost plus tooling
divided by quantity. Each vendor row also lists that partner’s active grades
and the dollars per kilogram, so a picker can offer every grade even when one
grade was named for the price.

## Budgetary quote UI

`POST /api/molding/quote` calls `quoteMolding` and returns that result. It does
not write `Quote` and it does not add a molding quote collection. A signed-out
caller can use it. The limit is 30 requests in 10 minutes, keyed by the user
when a session exists and by IP otherwise. The body is the part measurements,
`quantity`, `cavityCount`, and an optional `grade`. A price field is rejected.
`cavityCount` above 64 is rejected. `flowLengthMm` may be null, and the hot
runner stays out of the total unless a later caller turns it on. This route
does not turn it on.

The quote button on the right rail opens a glass panel. It says Budgetary, not
binding. Quantity and cavity count send a new request. The resin menu is the
selected vendor’s grade list. Opening the quote closes the DFM report, and
opening the DFM report closes the quote. Neither one clears a mold skin.

## Resin suggestions

The quote panel also shows heuristic fill flags and up to three grades from
`GET /api/molding/resin-library`. The flags are thin sections from the wall
check, a high aspect ratio of the outside box, and a long stand-in flow. The
stand-in is the longest outside edge, not a melt path. A structural study
that is still in memory can add a stiffness hint from that study's modulus
and safety factor. Modal, stale, and missing results add nothing. The hint
does not read a stress field.

The suggestions do not change the partner resin menu or the quote request.
The panel says they are heuristic and not a mold-flow result.

## Firm quote and human review

`POST /api/molding/leads` is signed-in. The body is `type` (`firm_quote` or
`human_review`), the public `anonLabel`, and an optional snapshot of the
numbers on screen. A price the client invents is not a field. The route looks
up the active partner by that label and writes `molding_leads` with status
`sent`, commission 0, and `reviewFeePaid` false. It does not call Stripe and
it does not email the partner.

A firm quote returns that partner’s `displayName`. A human review does not.
A second request for the same user, partner, and type returns the same lead.
Ranking is unchanged: fit, then price.

## Human-review checkout

`POST /api/molding/review-checkout` is signed-in. The body is the public
`anonLabel` only. The fee is `MOLDING_REVIEW_FEE_USD` on the server. Unset,
below $0.50, or a secret key that is not allowed for this environment, and
the route does not call Stripe. A live secret is refused unless `NODE_ENV`
is production. Dev and staging stay on a test secret.

The route opens a Stripe Checkout Session in `payment` mode and returns the
hosted URL. It does not mark the lead paid, does not take a card number, and
does not send email. The existing order PaymentIntent path is untouched.

Stripe tells SurfCAD the result on the webhook already mounted at
`POST /api/webhooks/stripe`. `checkout.session.completed` and
`checkout.session.async_payment_succeeded` mark the lead paid only when
`payment_status` is `paid` and the amount matches the session. A succeeded
review PaymentIntent does the same when `amount_received` matches. Unpaid,
expired, and failed events leave `reviewFeePaid` false. The return URL is
not trusted. `GET /api/molding/review-status` then reveals that one partner.

## Admin lead board

Signed-in admins see those leads at `/admin`. They can filter by partner and
status, and they can set status (`sent`, `quoted`, `won`, `lost`) and the
commission owed. The page does not pay anyone and does not show who asked.
