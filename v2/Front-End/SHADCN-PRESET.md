# Design system provenance

Initialized with the published, pinned shadcn 4.21.1 CLI:

```sh
npx shadcn@4.21.1 init --template vite --base radix --preset b67f2pbcWY --no-monorepo --yes --force --no-reinstall
npx shadcn@4.21.1 add card input label alert badge checkbox dialog sheet dropdown-menu select tabs progress skeleton empty separator aspect-ratio sonner calendar popover tooltip table --yes
```

The preset selects Vega, neutral base, blue theme, Montserrat body, Manrope headings, Lucide icons, default radii, subtle menu accents and translucent menus. Product CSS overrides primary/ring/sidebar-primary to exactly `#2983ff` with `#0a0a0a` foreground, retaining the preset's component spacing/radii and typefaces. Chart colors are neutral. Both fonts are served from bundled @fontsource-variable packages.

During initialization, the environment's network proxy denied `ui.shadcn.com`. The CLI's supported `REGISTRY_URL` setting pointed to a temporary local registry serving authoritative [shadcn-ui/ui](https://github.com/shadcn-ui/ui) source at commit `295a1f114a138f23b5dfee0e0c6812394dfeb90c` instead. Its `/init` response was produced with the official `buildRegistryBase` and `designSystemConfigSchema`; component registry items used the official Radix `_registry.ts` definitions and `createStyleMap`/`transformStyle` from the published CLI against official `registry/styles/style-vega.css`. The actual CLI decoded and applied `--preset b67f2pbcWY`, transformed component imports/icons/menu styles and installed fonts. No hand-authored replacement components or invented preset output were used.

`components.json` records the preset and primitive choice. The temporary mirror is not a runtime or build dependency. Future component additions use the standard shadcn registry when network access is available.
