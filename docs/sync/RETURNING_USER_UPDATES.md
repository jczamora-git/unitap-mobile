# Returning User Data Update Experience — UniTap 2.0

## 1. Concept & User Experience Design

UniTap 2.0 distinguishes between:
1. **First-Time Login / Onboarding**: Complete provisioning flow with the Windows OOBE-inspired `UniWelcomeSetup.vue` screen.
2. **Normal Returning Login**: Instant entry into the portal when valid local cache exists, without any blocking setup screens.
3. **Returning Login with Required Data Rehydration**: Lightweight, friendly update experience when local data must be refreshed.

---

## 2. Rehydration Trigger Conditions

A returning user is shown the update experience ONLY when:
- The local SQLite database has missing required tables or zero records in a required dataset.
- The user switched accounts or role scope changed on the device.
- The user tapped **Refresh Local Data** under Settings.
- A database migration invalidated the cached sync cursor.
- An integrity check failed during startup.

---

## 3. UI Presentation (`UniDataUpdateScreen.vue`)

### Visual Specifications
- **Clean Layout**: Focused, calm card layout with UniTap brand mark.
- **Support for Dark & Light Themes**: Dark mode surfaces `#1B1D23`, light mode `#FFFFFF`.
- **Honest Non-Technical Copy**:
  - Phase 1: **Updating your data** — *"Making sure your information is current."*
  - Phase 2: **Getting everything ready** — *"Your latest records are being prepared."*
  - Phase 3: **Almost ready** — *"Finishing a few things before you continue."*
  - Phase 4: **You're up to date** — *"Everything needed is ready."*
- **No Deceptive Percentages**: Progress bar reflects actual processed table count.
- **Failure Experience**:
  - Title: **We couldn't update your information**
  - Subtitle: *"Check your connection and try again."*
  - Actions: **Try Again** (primary button), and **Continue Offline** (secondary outline button, only visible if valid cached data is present).

