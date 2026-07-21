# Design QA — PNG Hero Background

- Source visual truth: `D:\VibeStudio\LiveMatch\frontend\src\assets\livematch-court-hero.png`
- Dark source asset: `D:\VibeStudio\LiveMatch\frontend\src\assets\livematch-court-hero-dark.png`
- Implementation screenshots:
  - `D:\VibeStudio\LiveMatch\design-qa-hero-light.png`
  - `D:\VibeStudio\LiveMatch\design-qa-hero-dark.png`
  - `D:\VibeStudio\LiveMatch\design-qa-hero-mobile-dark.png`
- Combined comparison: `D:\VibeStudio\LiveMatch\design-qa-hero-comparison.png`
- Viewports: 1440 × 900 desktop and 390 × 844 mobile
- State: authentication screen, light mode and dark mode

**Full-view comparison evidence**

- The selected badminton court artwork is rendered as an actual raster `<img>` layer that fills the hero card.
- Light and dark themes swap between dedicated PNG assets without CSS-generated artwork or gradients.
- The line-art court, net, shuttlecock, paper palette, and negative-space direction remain consistent with the selected visual.

**Focused region comparison evidence**

- The desktop authentication hero was inspected at native viewport resolution for heading contrast, image crop, border radius, and card alignment.
- The same hero was inspected at mobile width for text wrapping, background crop, and horizontal overflow. `scrollWidth` matched `clientWidth`.
- Dark-mode text, controls, and the generated night illustration were visually inspected together. No bright light-mode image flash or cream rectangle remained.

**Required fidelity surfaces**

- Fonts and typography: existing Noto Sans Thai + Inter stack is unchanged; heading and UI hierarchy remain readable in both themes.
- Spacing and layout rhythm: existing card layout and responsive spacing are preserved; no horizontal overflow at 390 px.
- Colors and visual tokens: light uses the paper/ink palette; dark uses a dedicated forest-green PNG and existing dark tokens.
- Image quality and asset fidelity: both backgrounds are opaque PNG files with matching composition and sufficient native resolution; no CSS/SVG substitute is used.
- Copy and content: no text, variable, prop, function, API field, or business content was changed.

**Findings**

- No actionable P0, P1, or P2 issues remain for the requested PNG-background conversion.
- P3: the illustration remains intentionally visible beneath some hero copy on narrow/tall cards; opacity is reduced on mobile to protect readability.

**Comparison history**

- Initial implementation used CSS pseudo-elements with gradient overlays, which made the illustration feel decorative rather than a real background.
- Replaced the pseudo-element artwork with a reusable `<img>` background layer and dedicated light/dark PNG sources.
- First visual pass showed excessive illustration contrast beneath copy. Reduced desktop opacity and added a lower mobile opacity while retaining a clearly visible background.
- Final desktop and mobile captures show the real PNG background, stable theme switching, readable content, and no layout overflow.

**Implementation checklist**

- [x] Real PNG image layer
- [x] Dedicated light and dark assets
- [x] Desktop and mobile responsive crop
- [x] Light/dark theme verification
- [x] Console error check
- [x] No business-logic changes

final result: passed
