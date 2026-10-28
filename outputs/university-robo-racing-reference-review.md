# University Robo Racing: Reference Review

**Prepared:** 27 October 2026
**Purpose:** Evidence notes for the Tracked Robo Race game design brief. These examples show how particular events describe their own formats; they do not establish a universal university robo-race rule set.

## Findings by source

### 1. KIIT Robotics Society — BotBurnout

The current KIIT Robotics Society event page describes BotBurnout as a race through a course with twists, turns and obstacles. It gives a wireless control requirement, a 2 kg maximum bot weight, and a maximum size of 40 × 30 × 30 cm (with stated tolerances). The same page separately describes TrackTracer as an autonomous line-following event. This is good evidence for keeping manually driven obstacle racing distinct from line-following gameplay.

Source: [KIIT Robotics Society — KIIT Fest](https://krs.kiit.ac.in/kiitfest)

### 2. Silicon University / Nirman Silicon — Robo Race rulebook reference

The linked Scribd result describes a manually operated race and lists switch bridge, speed breakers, marble pit, slippery path, rotating disc and curved ramp-down obstacles. It also describes time and checkpoint-based judging, with a limited number of resets attracting a time penalty. The document is hosted on Scribd rather than an official Silicon University page, so treat the details as a rulebook reference attributed to the uploaded document, not independently verified current university policy.

Source: [Robo Race Event Details and Rules (Scribd)](https://www.scribd.com/document/817964319/Robo-race-Rulebook-4-0-20241216-210953-0000)

### 3. OP Jindal University — ROBOVATION 2026 Robo Race

The linked rulebook search extract describes a manually operated wireless or Bluetooth robot that must travel through turns and obstacles; the fastest completion wins, and obstacles cannot be skipped. The PDF could not be fetched directly during this review, so dimensions and other detailed requirements have not been independently checked here. Use the linked official PDF for any rule-level claims.

Source: [ROBOVATION 2026 Rule Book (PDF)](https://techno.opju.ac.in/rulebookrr.pdf)

### 4. KIIT School of Electrical Engineering — KINETIDROID 2025

KIIT's official event report says KINETIDROID 2025 ran during KIIT Fest 8.0 on 14–16 February 2025, with 23 groups, including 10 from other institutes. It lists five rounds: Robo Rush, Ballistic Brawl, Robo Hurdle Sprint, Robo Hurdle Havoc and Sandrover. This supports the variety of robotics competition formats and an event setting, but it does not specify a single robo-race track layout or standard rules.

Source: [KINETIDROID 2025 — KIIT School of Electrical Engineering](https://electrical.kiit.ac.in/kinetidroid-2025/)

### 5. IIIT Bhubaneswar — D³ FEST 2026

The event page describes “Robo Rash” as an all-terrain endurance rush over gravel, sand, turf and steep slopes, emphasizing stability and time. This is useful inspiration for a rough-terrain course theme. It is an event listing and should not be cited as a standard robo-race rulebook.

Source: [D³ FEST 2026 Events](https://d3fest.techsoc-iiitbbsr.com/events)

### 6. AISSMS IOIT TENET 2026 — Robo Race

The event page specifies an adjusted-time result: actual track time plus penalties. It describes sequential checkpoints, resetting at the last checkpoint after a flip or stall, and a 10-second penalty for checkpoint bypass, reset, or going off course without a crash. Its obstacle list includes hairpins, zig-zags, inclines, ramps, elevated bridges, rough terrain, speed breakers and barriers. This is a detailed current example for checkpoint and penalty mechanics, but those values are event-specific.

Source: [Robo Race — TENET ’26](https://www.ioittenet.com/techfiesta/robo_race)

## Design implications for the game

- Keep manual driving central. KIIT explicitly lists a separate line-following competition, while BotBurnout is described as obstacle racing.
- Build obstacle variety from real examples: slalom barriers, speed breakers, ramps, raised bridges, rotating platforms, slippery sections, shallow pits, gravel, sand and turf.
- Make checkpoint order and adjusted completion time configurable per course. Event penalty amounts and recovery rules differ; do not hard-code one university's rules as universal.
- Use fixed, authored routes first, then seeded variation inside validated templates. The sources establish obstacle examples, not permission to generate any arbitrary combination.
- Treat the supplied robot image as the visual reference for the visible low, wide tracked silhouette, black deck, rubber tracks, exposed wheels, red switch and upright antenna. Do not infer hidden construction or exact dimensions from the image.
- The reference pages have not been licensed for reuse. Use them for research; use the user-provided robot image or assets with clear reuse rights for final art.

## Access and verification notes

The KIIT Robotics Society, KIIT KINETIDROID, D³ FEST and TENET pages opened successfully. The OPJU PDF was discoverable in search with an extract, but direct PDF retrieval timed out. Scribd did not render its document in the browser, so the obstacle/rule summary above is limited to the indexed result. Links were reviewed on 27 October 2026; event pages and rules can change.
