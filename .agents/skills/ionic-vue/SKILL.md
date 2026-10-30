---
name: ionic-vue
description: Ionic Vue 9 and Vue 3 Composition API conventions for UniTap.
---

# Ionic Vue Skill

## Guidelines
1. **View Structure**: Every top-level page must use `<ion-page>` and `<ion-content :fullscreen="true">`.
2. **Navigation**:
   - Use Ionic router `router.push('/path')` or `<ion-tab-button href="...">`.
   - Never nest `<ion-tabs>` inside child tab pages.
   - Respect mobile safe areas (`env(safe-area-inset-bottom)`).
3. **Full-Page Form Rule**:
   - Complex workflows (Register Student, Create Event, Issue Charge, Make Payment) should be full pages, not crowded modals.
   - Modals and action sheets are reserved for quick confirmations and inline edits.
4. **Lifecycle**:
   - Use `onIonViewDidEnter` and `onIonViewDidLeave` to manage hardware scanners and reactive listeners.
