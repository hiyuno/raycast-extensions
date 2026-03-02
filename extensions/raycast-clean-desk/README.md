# Clean Desk (Raycast)

This Raycast extension provides one command: **Clean Desk**.

## Settings

You can configure these command preferences in Raycast:

- `Destination Folder Name`: name of the folder that will receive all cleaned Desktop files (default: `Desk`).
- `Destination Parent Directory`: where that folder is created (via folder picker) (default: `~/Desktop`).
- `Move Inactive Files to Trash Folder`: enable/disable moving old inactive files to `Trash` (default: off).
- `Inactive Days`: number of days since last access to treat a file as inactive (default: `30`).
- `Open Destination Folder After Clean`: enable/disable opening destination folder when process ends (default: on).
- `Desktop Sort By`: choose Finder `Sort By` mode applied after cleaning (`Name`, `Kind`, `Date Last Opened`, `Date Added`, `Date Modified`, `Date Created`, `Size`, `Tags`) (default: `Name`).
- `Eject Installer Volumes After Clean`: enable/disable ejecting mounted installer volumes (`.dmg`) at the end (default: off).

Example:

- Folder Name: `Desk`
- Parent Path: `~/Documents`

Resulting destination: `~/Documents/Desk`

## What it does

- Moves all files and folders from `~/Desktop` into your configured destination folder.
- Excludes the destination folder from source only when destination parent is also `~/Desktop`, to avoid moving it into itself.
- Organizes first-level items inside the destination folder into:
  - `Images`
  - `Videos`
  - `Folders`
  - `Screenshots`
  - `3D Print`
  - `Trash` (only when `Move Inactive Files to Trash Folder` is enabled)
  - `Others`
- Category folders are created only when at least one item is moved into them.
- Empty category folders are removed at the end.
- Includes hidden items (for example `.DS_Store`) because scope is "move everything".

## Categorization rules

1. Directories go to `Folders`.
2. Screenshot files are detected by name and go to `Screenshots` if filename contains:
   - `screenshot`
   - `screen shot`
   - `screenshoot` (typo tolerance)
   - `cleanshot`
   - or starts with macOS-like prefixes such as `Screen Shot `, `Screenshot `, `Captura de pantalla `
3. 3D print files by extension go to `3D Print`:
   - `.stl`, `.3mf`, `.step`, `.stp`, `.obj`, `.gcode`
4. Image files by extension go to `Images`:
   - `.png`, `.jpg`, `.jpeg`, `.heic`, `.gif`, `.webp`, `.tif`, `.tiff`, `.bmp`, `.svg`
5. Video files by extension go to `Videos`:
   - `.mp4`, `.mov`, `.m4v`, `.avi`, `.mkv`, `.webm`, `.flv`, `.wmv`, `.mpg`, `.mpeg`, `.3gp`, `.mts`, `.m2ts`, `.ts`, `.vob`, `.ogv`, `.rm`, `.rmvb`, `.f4v`, `.asf`, `.divx`, `.hevc`, `.h265`, `.h264`
6. If `Move Inactive Files to Trash Folder` is enabled, files not accessed for more than `Inactive Days` are moved to `Trash` (before normal category rules).
7. Everything else goes to `Others`.

## Conflict policy

- If an item with the same name already exists in the destination folder, it is removed first.
- The source item from `~/Desktop` is then moved in, effectively overwriting.

## Behavior

- Runs directly (no confirmation dialog).
- Shows a loading toast while moving and organizing.
- Shows success/partial-failure/error toast at the end with move and organization counts.
- Applies Finder Desktop `Sort By` after cleaning and organizing using your selected setting.
- If Finder automation is unavailable, sorting is skipped silently without failing the clean process.
- Optionally ejects mounted installer volumes (DMG-based mounts) after sorting and cleaning.
- If eject fails for some volumes, cleaning still succeeds (best effort).
- Optionally opens the destination folder when at least one item is moved or organized.

## Command

- Name: `clean-desktop`
- Title: `Clean Desk`
- Mode: `no-view`

## Development

```bash
npm install
npm run build
```

For Raycast local development, run:

```bash
npm run dev
```
