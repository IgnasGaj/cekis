# Sprint 1 design mapping

The supplied files are PNG copies of the named reference screens. All four were visually inspected on 2026-10-05. Their device frame, clock, home indicator, product imagery and receipt images are reference material, not app content.

| File | Screen | Sprint 1 use |
| --- | --- | --- |
| `F930517C-1FE1-449B-A78E-622A01A83407.PNG` | Home with greeting, warranty panel, recent purchases and four-item nav | Heading, generous spacing, rounded card, teal and nav order; populated content replaced by an honest empty state |
| `85256887-FAEC-4B19-9E8D-3FCA76BAF5C1.PNG` | Receipt review with editable rows | Rounded input/card borders and icon treatment only |
| `19DBCD80-4614-4E17-8B06-6BB4F461F5F0.PNG` | Add receipt options | Pale teal tints and prominent action style only |
| `BC378C6F-806A-484C-ACEA-1D512D49D20A.PNG` | Purchase detail and receipt preview | Calm row/card style for settings only |

Approximate tokens: background `#faf9f6`, surface `#fff`, dark text `#0c2830`, muted text `#65717d`, teal `#277d78`, teal tint `#eaf5f2`, border `#e2e8e6`. Teal was darkened for readable text and controls. Cards use roughly 13–16 px radii; headings are 28–34 px. Layout starts at 320/390 px and centers at 680 px on desktop. The bottom nav includes safe-area padding and a 44 px or larger active touch target.

Only Home and Settings are active. Pirkiniai and Čekis retain their positions but are visibly unavailable, have accessible explanatory text and do not navigate. No bell, fake notification count, purchase content or warranty example appears in Sprint 1.

## Sprint 2 adaptation

The same four inspected PNG references guide the purchase list cards, field rows, add action and detail metadata. The device frames, product imagery and receipt previews remain reference material only. Pirkiniai now opens the private list. + Čekis opens a small add screen with one working manual-entry action and a clear notice that file capture and upload follow later. Home links to manual entry and the list without showing fabricated purchases or warranty totals. Detail uses real saved metadata, an empty attachment card and `Garantija nenurodyta`.

## Sprint 3 adaptation

The four available PNG references were inspected again. The add screen uses large camera, image and PDF choices and retains the manual path. Purchase detail lists real receipt filenames, type and size with view/download and attachment actions. The reference's scanned values, receipt photograph, product imagery and warranty examples are not rendered. Selected images are previewed from a short-lived local blob URL; uploaded originals use an authenticated server route. The shell, warm surface, teal controls and bottom navigation order stay consistent.

## Sprint 4 review mapping

`85256887-FAEC-4B19-9E8D-3FCA76BAF5C1.PNG` guides the back link, receipt preview, stacked editable fields and primary save action. The implemented page adds scan progress, cancel/retry and manual entry above the form. The reference's warranty row is omitted. Its single “Suma” row is split into a read-only OCR **Čekio suma** suggestion and an explicitly editable **Prekės kaina** field, so a multi-item total cannot become product price without a user's action. All statuses and controls are Lithuanian. The original receipt uses the owner-authorized route.
