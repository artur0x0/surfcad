# Injection molding schema

Mongo collections for the molding partner catalog. They are separate from the
public interest form.

The interest form stores submissions in collection `partners` via
[`PartnerLead`](../backend/db/models/PartnerLead.js). Do not write molding
suppliers into that collection or that model.

Models live in `backend/db/models/` and register when a route imports them.
[`backend/db/connection.js`](../backend/db/connection.js) only opens the
connection. Nothing on the interest-form path imports these models. Empty
partner-catalog collections are fine. The partner catalog has no seed. The
generic resin library below is a separate collection and has its own seed.

Field names are camelCase. Print-quote models (`Material`, `Quote`) use
kebab-case. That split stays.

Money fields accept 0. A clamp force, shot size, platen, tie-bar spacing, or
resin density of 0 does not. Utilization is a percent from 0 to 100.

## molding_partners

Model `MoldingPartner`. Real names stay on `displayName`. `anonLabel` is the
public stand-in (`Partner A`) and is unique. `region` is free text until a
taxonomy is chosen. `active` defaults to true. `notes` is optional.

Indexes: unique `anonLabel`; `active` + `anonLabel`; `displayName`.

## molding_machines

Model `MoldingMachine`. `partnerId` references `MoldingPartner`.

`tonnage` is clamp force and must be greater than 0. `barrelShotCm3`,
`platenWidthMm`, `platenHeightMm`, `tieBarSpacingXMm`, and `tieBarSpacingYMm`
must be greater than 0. `utilizationPct` is 0–100. `utilizationUpdatedAt` is
the last time that percent was set, separate from `updatedAt`.
`hourlyRateUsd` is 0 or greater. `active` defaults to true.

Indexes: unique `partnerId` + `name`; `partnerId` + `active`.

## molding_resin_prices

Model `MoldingResinPrice`. One row per partner and `grade`. Grades match
exactly, including case. `usdPerKg` is 0 or greater. `densityGCm3` is greater
than 0. `active` defaults to true.

Indexes: unique `partnerId` + `grade`; `partnerId` + `active`.

## molding_resins

Model `MoldingResin`. Generic injection-resin properties. This is not a price
and it has no `partnerId`. Grades match exactly, including case. `grade` is
unique.

`tensileModulusMpa` is greater than 0. Shrink percents are 0–100.
`wallMinMm` and `wallMaxMm` are greater than 0. Melt and mold temperatures
are 0 or greater, in °C. Each low value is less than or equal to its high
value. `notes` is optional. `active` defaults to true. There is no
`usdPerKg` on the collection.

The seed module also stores a published density and a USD per kilogram on
every grade, each with a source and an as-of date. That table is what the
mold report reads. Saving a seed grade does not copy those fields into
`molding_resins`, and the public route does not return them.

The curated seed is typical unfilled grades (ABS, PP, HDPE, PC, PA66, POM,
PC/ABS). `GET /api/admin/molding/resin-library` inserts a seed grade only
when that grade is missing. It does not overwrite an edited row and it does
not turn a deactivated grade back on. It does not write `materials` or
`molding_resin_prices`. Quotes do not read this collection.

Indexes: unique `grade`; `active` + `grade`.

`GET /api/molding/resin-library` is public and read-only. It returns modulus,
shrink, wall, and temperature bands. It does not return a price or a partner.
An empty collection answers with the curated seed and does not insert it.
Stored rows win, including a library with no active grades. The quote route
does not call this.

## molding_tooling_rates

Model `MoldingToolingRate`. One card per partner (`partnerId` is unique).

Required and 0 or greater: `aluminumUsdPerKg`, `steelUsdPerKg`,
`aluminumMachiningUsdPerHour`, `steelMachiningUsdPerHour`, `baseHoursSimple`,
`coolingLineHoursFactor`, `slideAdderUsd`, `lifterAdderUsd`, `ejectorPinUsd`,
`sleeveUsd`, `hotRunnerSuggestionUsd`. `active` defaults to true so a card can
be turned off without deleting it. The budgetary tooling estimate reads this
card ([injection-molding-quoting.md](injection-molding-quoting.md)). It does
not write the card.

## molding_leads

Model `MoldingLead`. `userId` references `User`. `partnerId` references
`MoldingPartner`.

`type` is `firm_quote` or `human_review`. `status` is `sent`, `quoted`, `won`,
or `lost`. `commissionOwedUsd` is 0 or greater and defaults to 0.
`budgetaryQuoteSnapshot` is an optional mixed object. The quote document shape
is not fixed here. `stripePaymentIntentId` is an optional string. This schema
does not call Stripe. `reviewFeePaid` defaults to false.

Indexes: `status` + `createdAt`; `partnerId` + `status`; `userId` + `createdAt`.

## Admin API

Catalog edits are `GET` and `POST` `/api/admin/molding/partners`, `/machines`,
`/resins`, and `/rates`, plus `PATCH /:id` and `POST /:id/deactivate` on each.
The generic library is `GET` and `POST /api/admin/molding/resin-library`, plus
`PATCH /:id` and `POST /:id/deactivate`. A library body that includes
`usdPerKg` or `partnerId` is rejected. `/resins` is still the partner price
list.
The router is the one already mounted at `/api/admin`. Signed-out callers and
non-admins get 404. The per-user limit matches `GET /api/admin/stats`.

Lists include inactive rows. Partner rows include `displayName`. There is no
public catalog route. Deactivate sets `active` to false and does not change
child rows. A later `PATCH` with `active: true` turns a row back on.

Leads are `GET /api/admin/molding/leads` and `PATCH /api/admin/molding/leads/:id`
on that same admin router, so the 404 gate and the stats rate limit apply.
The list filters by `partnerId` and `status`. The patch changes `status` and
`commissionOwedUsd` only. The JSON has the partner's real name, the public
label, type, status, commission, whether the review fee is paid, and the
time. It does not include the requester, `userId`, email, the quote snapshot,
or `stripePaymentIntentId`. There is no export and no partner portal.

Signed-in admins edit the catalog, the resin library, and the lead board at
`/admin` (`data-admin-mold-catalog`, `data-admin-mold-library`,
`data-admin-mold-leads`). `POST /api/molding/quote`
returns a budgetary quote and does not store it. `POST /api/molding/leads`
stores a lead for the signed-in user. It does not call Stripe and it does not
return the partner's name. The public response says to pay for review to see
the partner. `POST /api/molding/review-checkout` opens Stripe Checkout for
`MOLDING_REVIEW_FEE_USD` and does not mark the lead paid. The Stripe webhook
sets `reviewFeePaid` only after a paid event whose amount matches, and only
on that user's human-review lead. `GET /api/molding/review-status` returns
the partner name only for that paid lead. A return URL does not. The row
stores a payment id string, not a card number. The admin list still includes
the partner's real name.
