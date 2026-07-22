# Welcome Banner for HydroOJ

A visual homepage **banner / cover manager** for HydroOJ. Instead of hand-editing a
JSON blob in system settings, you get a full management page in the admin control
panel where you can upload, preview, reorder, configure and delete banner slides.

Entry point: **Control Panel → Properties → Banner Management** (`/manage/banner`),
sitting right next to the other management tools — just like the user-manage addon.

## Features

- **Visual slide manager** — thumbnail preview of every slide, inline editing of
  link / title / alt text, per-slide enable-disable, up/down reordering and delete.
- **Image upload as user attachment** — pick a file and it is stored in *your* user
  attachments via HydroOJ's storage API; the returned `/file/<uid>/<name>` link is
  used as the slide image automatically. No manual URL juggling.
- **Add by URL** — or point a slide at any external image URL.
- **Live preview** — the exact carousel, rendered on the management page, updates
  with your current configuration.
- **Carousel configuration** — autoplay on/off, interval, fade or slide transition,
  dot indicators, prev/next arrows.
- **Appearance** — width, height, border radius, image fit (contain / cover),
  blurred background fill.
- **Hover zoom effect** — toggle the on-hover image zoom and tune its scale.
- **Master switch** — enable/disable the whole banner on the homepage in one click.
- **One-click homepage wiring** — a button that inserts the `banner` section into
  the homepage config for you if it is missing.
- **Backwards compatible** — migrates the old v1 `welcomeBanner.banners` setting.

## Install

Copy this folder into your HydroOJ addons directory and register it:

```bash
hydrooj addon add /path/to/welcome-banner
pm2 restart hydrooj      # or restart your hydrooj process
```

Or just run `./deploy.sh` from this directory.

## Homepage setup

The banner renders wherever a `banner` section appears in `hydrooj.homepage`.
Open **Banner Management** and click **Add `banner` to homepage now**, or add it
manually in system settings:

```yaml
- width: 12
  sections:
    - banner
    - hitokoto
    - contest
```

## How image storage works

Uploaded images go through HydroOJ's normal user-file storage
(`storage.put('user/<uid>/<filename>')`) and are registered in your user file list,
so they count against your file quota and appear in your file manager. The slide
simply references `/file/<uid>/<filename>`. Deleting a slide optionally deletes the
underlying attachment too.

## License

MIT
