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
