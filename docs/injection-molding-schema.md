# Injection molding schema

Mongo collections for the molding partner catalog. They are separate from the
public interest form.

The interest form stores submissions in collection `partners` via
[`PartnerLead`](../backend/db/models/PartnerLead.js). Do not write molding
suppliers into that collection or that model.

Models live in `backend/db/models/` and register when a route imports them.
[`backend/db/connection.js`](../backend/db/connection.js) only opens the
connection. Nothing on the interest-form path imports these models. Empty
collections are fine. There is no seed.

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
The router is the one already mounted at `/api/admin`. Signed-out callers and
non-admins get 404. The per-user limit matches `GET /api/admin/stats`.

Lists include inactive rows. Partner rows include `displayName`. There is no
public catalog route. Deactivate sets `active` to false and does not change
child rows. A later `PATCH` with `active: true` turns a row back on. Leads are
not on this API.

Signed-in admins edit the same rows at `/admin` (`data-admin-mold-catalog`).
There is no leads board. `POST /api/molding/quote` returns a budgetary quote
and does not store it.
