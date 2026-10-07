# Shared Answer identity

The approved B mark pairs two facing conversational forms around an open channel. Use forest green (`#164A3D`) on cream (`#F6F1E7`) or white, and the cream reversed artwork on dark backgrounds.

The web header uses the outlined [horizontal logo](../apps/web/public/brand/horizontal.svg), with its canvas trimmed to remove excess header padding. [Stacked](../apps/web/public/brand/stacked.svg), [wordmark](../apps/web/public/brand/wordmark.svg), [symbol](../apps/web/public/brand/symbol.svg) and reversed SVGs are available in `apps/web/public/brand/`. The header's home link supplies the accessible name; its decorative image has empty alt text.

Keep clear space equal to the symbol's central channel (32 units on its 256-unit canvas). Preserve proportions, colours and the gap between the two forms. Use the symbol for small layouts; the horizontal header is 240 CSS pixels wide. The favicon has a wider channel for 16–24 px use. Avoid stretching, shadows, gradients and busy backgrounds.

The wordmark uses Segoe UI Bold and Semibold converted to vector outlines. No font files or live logo text are shipped. Microsoft's [font FAQ](https://learn.microsoft.com/en-us/typography/fonts/font-faq) describes permitted logo/graphic output and the separate restrictions on font-file redistribution.

Browser favicons and the Apple touch icon are linked in `apps/web/index.html`. The existing Vite PWA configuration generates the application manifest with 192/512 px PNG icons and a separate 512 px maskable icon. Keep this as the single manifest source; retain its application name, start URL and cream theme/background colours. The install icons use cream on opaque forest tiles; the maskable artwork stays inside the central safe area.
