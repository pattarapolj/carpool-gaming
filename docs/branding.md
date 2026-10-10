# Shared Answer identity

The approved B mark pairs two facing conversational forms around an open channel. The Midnight Electric identity uses pale lime (`#D4F574`) on charcoal (`#171B24`). Reversed artwork uses charcoal on lime. Preserve the existing mark and outlined wordmark proportions.

The web header uses the outlined [horizontal logo](../apps/web/public/brand/horizontal.svg), with its canvas trimmed to remove excess header padding. [Stacked](../apps/web/public/brand/stacked.svg), [wordmark](../apps/web/public/brand/wordmark.svg), [symbol](../apps/web/public/brand/symbol.svg) and reversed SVGs are available in `apps/web/public/brand/`. The static header image has alt text `Carpool Quiz League`; completed games provide an explicit Return home action.

Keep clear space equal to the symbol's central channel (32 units on its 256-unit canvas). Preserve proportions, colours and the gap between the two forms. Use the symbol for small layouts; the horizontal header is 170 CSS pixels wide. The favicon has a wider channel for 16–24 px use. Avoid stretching, shadows, gradients and busy backgrounds.

The wordmark uses Segoe UI Bold and Semibold converted to vector outlines. No font files or live logo text are shipped. Microsoft's [font FAQ](https://learn.microsoft.com/en-us/typography/fonts/font-faq) describes permitted logo/graphic output and the separate restrictions on font-file redistribution.

Browser favicons and the Apple touch icon are linked in `apps/web/index.html`. The existing Vite PWA configuration generates the application manifest with 192/512 px PNG icons and a separate 512 px maskable icon. Keep this as the single manifest source; retain its application name and start URL, with charcoal theme/background colours. The install icons use lime on opaque charcoal tiles; the maskable artwork stays inside the central safe area.

## Site palette and imagery

Use charcoal `#171B24` for the canvas, slate `#222836` for elevated surfaces, white `#F3F5FA` for primary text, and cool gray `#BCC5D5` for supporting text. Lime indicates actions, selection outlines, and successful feedback. Error and warning surfaces retain their own labeled semantic colours. The site uses locally bundled Fraunces display fonts and honors reduced-motion preferences.

The hero asset is `apps/web/public/images/midnight-road.webp`, generated with the built-in image tool and optimized for web delivery. Prompt: photorealistic luxury travel photography of a winding coastal mountain road at blue hour, charcoal/slate tones, a subtle headlight trail, generous dark space for text, no people, text, logos, or interface. It is decorative imagery, not a claim about a real destination.
