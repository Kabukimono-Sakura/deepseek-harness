# 0002 — Keep desktop helper data inside the project

Date: 2026-10-28. Status: accepted for dsh-pet 0.3.8.

The user requested one D-drive project directory for source, runtime and associated data. Upstream dsh-pet honors DSH_HOME for its content but its Electron helper otherwise uses the OS profile directory for Chromium data.

`scripts/patch-pet-storage.mjs` checks both the package version and the original helper's SHA256 before inserting explicit Electron userData, sessionData, crashDumps and log paths under `$DSH_HOME/dsh-pet/electron-data`. It writes a new file and renames it over the installed helper, preserving pnpm's original content-addressed store. Reapplying the identical patch is safe; unknown upstream content stops installation for review.

`pet:install` also passes an explicit project-local pnpm store/cache and Electron download cache. The dependency's upstream license and attribution stay in its installed package. This is a local compatibility patch, not a modification submitted to upstream.

The adapter only projects an existing model reply via broadcast. Automatic chatter is disabled in the initial config. Upstream's own chat menu remains a separate conversation path until a unified input surface is implemented.
