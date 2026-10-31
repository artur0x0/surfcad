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
