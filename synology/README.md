# Studio Gallery Synology package

The package is designed for DSM Package Center and requires Synology Container Manager.
It owns the Compose lifecycle but keeps photo access explicit: `PHOTO_SOURCE` must be set to a Shared Folder path in the package settings before starting.

The production package builder should copy `docker-compose.registry.yml` into `var/docker-compose.yml`. Images are published by `.github/workflows/publish-images.yml` to GitHub Container Registry, so NAS installation pulls images instead of compiling them. Package Center should provide a Shared Folder picker that writes only `PHOTO_SOURCE`, `DATA_PATH`, and `CACHE_PATH` to `var/.env`.

Install, upgrade, and uninstall scripts deliberately preserve `var/data` and `var/cache`; uninstall should offer a separate “remove data” confirmation.
