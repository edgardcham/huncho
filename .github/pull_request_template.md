## Module

Which module this touches, and the seam it sits at.

## Interface

What a caller now has to know. Signature, invariants, error modes.

## Hides

What moved behind the interface.

## Tests

How the tests cross the interface. Fixtures added or changed.

## Checklist

- [ ] One ticket, one PR
- [ ] Tests pass locally and in CI, no network in unit tests
- [ ] No runtime dependencies added
- [ ] No vendor names above the Model seam
- [ ] Docs or fixtures updated where the ticket says so
