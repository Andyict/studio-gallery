# Studio Gallery on Synology DSM

The DSM 7 package runs the backend and web UI as the dedicated `StudioGallery` system user. During package startup, DSM's `data-share` resource grants that user read-only access to the `Studio` shared folder. DSM creates `Studio` if it does not already exist. The app never runs with the installing administrator's account.

The Console lists DSM shared folders and reports whether the package user can read each one. Other folders remain inaccessible until an administrator grants the `StudioGallery` system user read-only access in Control Panel. Enabling a folder in the Console approves it as a photo source; it does not change DSM permissions.

The package preserves its application data under `/var/packages/StudioGallery/var` during upgrades.
