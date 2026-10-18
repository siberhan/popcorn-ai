# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

<!-- No Impeccable platform value fits. The real platform is Fire TV on Vega OS (React Native 0.72, React 18.2), a 10-foot TV screen driven only by a D-pad remote. "web" is recorded so iOS/Android HIG rules (tab bars, touch targets, edge swipes) are not applied. The same code also runs as an Expo web preview, which is only a development tool. -->

## Users

A family on the living-room couch, choosing a movie together for tonight. They sit about 3 m from a TV and hold one remote between them. Members are adults and children (for example Bedirhan, Ayse, Can 9, Deniz 7). A child may join or leave in the middle of the session.

Hackathon judges are a second audience: they watch the demo video and may run the app on the Vega Virtual Device.

## Product Purpose

Popcorn AI is an AI movie companion for the living room. It remembers what each family member likes, finds movies that everyone on the couch will enjoy, and removes unsafe picks as soon as a child joins. Success means the family gets from "who's watching" to a movie they agree on quickly, and the next evening the app still remembers them.

## Positioning

Taste memory is kept per person, and recommendations are made for the people on the couch tonight, not for one account. The TV and a voice assistant (Alexa+ through MCP) share one live state, so a sentence said by voice ("Can joined us") changes the TV screen at once. The kid filter works live: when a child sits down, unsafe cards disappear from the screen.

## Operating Context

- Flow: who's watching (the couch) → a poster duel for new people (5–6 rounds, D-pad) → recommendations (posters, match %, a "why" line) → details. Voice can do every step too.
- The TV polls the server for state every second; the server decides which screen is shown.
- Seen from a sofa at TV distance, often in a dim room, by people of mixed ages, including children who cannot read well yet.

## Capabilities and Constraints

- Input is the remote only: D-pad, OK, Back. No pointer, no touch, no hover. Text entry goes through the Vega full-screen on-screen keyboard.
- Stack: React Native 0.72 with `react-tv-space-navigation` for focus. Fire TV builds must not add npm packages. The `Animated` end callback may not fire on Vega.
- 10-foot rules: text at least 18 px at 1080p, everything inside the 5% title-safe area.
- Kid filter: age under 13 → PG at most, under 17 → PG-13 at most.
- Movie data and posters come from TMDB and load at runtime. Posters are never saved in the repo.
- Hackathon deadline is 2026-10-23. The app must stay live until 2026-11-20.

## Brand Commitments

- Name: "Popcorn AI".
- No Alexa logo, no Alexa-like voice, and "Alexa" is not part of the product name. The voice page is labeled "Simulated Alexa+".
- Credit line: "This product uses the TMDB API but is not endorsed or certified by TMDB."
- The user wants the app to feel like a premium living-room product, on the level of the PlayStation 5 home screen and Apple's own apps, and not like generic AI-generated UI (stated 2026-10-18). Visual specifics are decided in new-work, not here.
- Standing preference from the first direction round (2026-10-18): the familiar console register. The user liked the console home-screen card for its soft blurred backdrop, simple palette and premium feel, and wants a dynamic, abstract flow behind the UI; in the second round they chose it over Taste Light, Key Art Drift and a refined Hi-fi. They rejected poster-scale type ("too big for a TV app") and loud graphic-identity worlds such as festival yellow and airport signage.

## Evidence on Hand

- A working end-to-end flow on the live server: couch, duel, recommendations, kid filter, watched memory.
- Screenshots of the current screens: `briefs/reports/*-shots/`.
- No user testimonials, usage numbers or press. Do not invent any.

## Product Principles

1. The couch, not the account: every screen shows who is watching and serves them all.
2. One remote, zero friction: every action works with the D-pad in a few presses, and voice is never required.
3. Safe by default: when a child is present, the app's choices are visibly safe for them.
4. Memory you can see: the app says why it picked a movie, in terms of the people on the couch.
5. Voice and TV are one product: whatever voice changes, the TV shows at once.

## Accessibility & Inclusion

Readable from the sofa: large type, strong contrast in a dim room, and a focus state that is unmistakable from 3 m away. Young children use it too, so the meaning of each person's avatar and state must not depend on reading or on color alone.
