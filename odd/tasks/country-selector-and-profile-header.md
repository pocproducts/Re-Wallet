# Feature: country selector in onboarding, two-column profile header

## Goal

Two UI changes the product owner asked for on 2026-09-29.

1. **Onboarding.** The country next to the phone input stops being a fixed
   Argentine label and becomes a selector: flag plus the first three letters,
   opening a list of twenty Latin American countries, each with its real
   international dialling code. The code composes the number, so picking Chile
   produces `+56 …` and not `+54 …`.
2. **Profile.** The registration date stops printing a raw ISO timestamp and
   prints `MM-DD-AA` under the Biometría row. The header splits into two
   columns: identity on the left, the tag and the wallet on the right. The tag
   becomes a real, persisted input.

## Non-goals

- No change to what gets stored for a profile that already exists. A stored
  `telefono` keeps its composed prefix; nothing re-parses it.
- No new persistence store. The profile already lives in `localStorage` under
  `geodrop_user_profile_data`; a tag that does not survive a reload would be an
  input that lies.
- No change to the auth contract. `RegisterInput` keeps the same shape; the
  country is a UI concern that is composed into the phone before it is submitted.

## Decisions (user, 2026-09-29)

1. **Twenty Latin American countries**, each with its real dialling code.
2. **The tag is editable and persisted.**
3. **The dialling prefix follows the country** chosen in both onboarding flows.

## Tasks

### T1 — One country catalogue, one selector

- [x] `config/countries.ts` — the twenty countries, with `code` (ISO 3166-1
      alpha-2), `flag`, `name`, `short` (first three letters) and `dial`
- [x] `components/Onboarding/CountrySelect.tsx` — the selector, so the register
      form and the recovery form cannot drift apart. The codebase already
      documents twice that duplicating this produced two truths.
- [x] Both call sites use it

### T2 — Onboarding wiring

- [x] `composePhone` takes the country instead of reading a constant
- [x] The recovery form carries the same country, so the code it sends is
      composed with the prefix the user actually chose
- [x] The country survives being chosen in one step and used in another

### T3 — Profile: the date

- [x] `MM-DD-AA`, formatted from the stored ISO string
- [x] Rendered as a row below Biometría, not in the header
- [x] An unparseable or absent date does not render `Invalid Date`

### T4 — Profile: the two-column header

- [x] Left: the avatar, and the name below it, broken across two lines when it
      is two words
- [x] Right: the tag as an editable input, styled like the wallet pill, with a
      copy button; the wallet below it
- [x] The tag is persisted, and a profile restored from `localStorage` shows the
      tag that was saved rather than one re-derived from the name

## Evidence

- **Typecheck clean, build clean.** Both sides.
- **The catalogue is right, checked against the module Vite actually serves** —
  not against the source file, which is the version that gets shipped: 20
  countries, no duplicate ISO code, no duplicate three-letter short, every
  `short` exactly three letters, every `dial` carrying its `+`, `+1` shared by
  Puerto Rico and República Dominicana, and Argentina/Chile/Mexico/Peru/Uruguay
  each on their real code. This check CAUGHT A BUG: Haiti was missing from the
  list I wrote, and only asserting the count exposed it.
- **Date, name and tag logic exercised against edge cases**, not just the happy
  path: a UTC-midnight timestamp stays on the correct day (reading it as local
  time moves it back a day west of Greenwich), an empty string, a
  non-date string and an absent value all render nothing rather than
  `Invalid Date`; a one-word name is NOT split; a three-word name splits after the
  first; a stored tag beats a derived one and an empty stored tag falls back to
  the derived one.
- **The capsule no longer disagrees with the profile.** `App.tsx` derived the tag
  from the name by hand while the profile showed the edited one, so the thing you
  tap to reach the tag would have shown the old value. Both now call one
  `resolveTag`.

## Defects found while verifying

1. Haiti was missing from the country list. Caught by the count assertion.
2. The tag appeared in two places, derived twice. Caught by grepping for the
   derivation rather than assuming there was one.

## Commits

Not committed — the working tree carries unrelated pending deletions and the
owner has not asked for commits.
