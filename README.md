<div align="center">

<img src="./assets/icon.png" alt="UseIT" width="110" />

# UseIT

**Airbnb for your idle stuff — swipe to discover nearby gear, chat with the owner, and rent it securely.**

[![React Native](https://img.shields.io/badge/React_Native-20232A?style=flat&logo=react&logoColor=61DAFB)](https://reactnative.dev/)
[![Expo](https://img.shields.io/badge/Expo-000020?style=flat&logo=expo&logoColor=white)](https://expo.dev/)
[![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=flat&logo=supabase&logoColor=white)](https://supabase.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Stripe](https://img.shields.io/badge/Stripe-635BFF?style=flat&logo=stripe&logoColor=white)](https://stripe.com/)

</div>

---

## Overview

UseIT connects people who own equipment with people who need it — locally, securely, and without middlemen. Browse items by swiping through a location-aware feed, send a rental request, pay through an escrow-protected flow, and confirm every pickup and return with a unique QR code.

Built as a cross-platform mobile app (iOS + Android) using React Native and Expo, with Supabase handling auth, database, real-time messaging, and file storage.

---

## Features

|   | Feature | Description |
|---|---|---|
| 📍 | **Location-based Feed** | Swipe through items sorted by distance from your location |
| 💬 | **Real-time Chat** | Message lenders directly; rental requests flow through the chat |
| ✨ | **AI Auto-Fill** | Snap a photo of your item — a Groq vision model suggests title, category, description, and price |
| 🤖 | **AI Trip Planner** | Groq-powered agent that finds items matching a free-text query and real availability |
| 🔐 | **Escrow-style Payments** | Stripe Connect holds funds and releases them to the lender after a confirmed return |
| 📷 | **QR Transfer Verification** | Unique QR per transaction, GPS-proximity checked, scanned on pickup and return |
| ⭐ | **Reputation & Trust Score** | Separate lender/renter ratings and written reviews feed a trust tier that discounts platform fees |
| 🛡️ | **Trust & Safety Console** | Admin dispute resolution, user reports, listing moderation, and an overdue-rentals queue |
| 🔒 | **Biometric Security Gate** | Face ID / Touch ID required before listing an item or committing to a rental |
| ❤️ | **Wishlist** | Save items and come back to them later |
| 🗓️ | **Availability Calendar** | Request specific dates; conflicts are blocked automatically |
| 🛡️ | **Verified Listings** | Items go through a verification flow before going live |
| 🔑 | **Account Controls** | Full account deletion and GDPR-style data export, self-serve from the app |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Mobile | React Native + Expo (iOS & Android) |
| Auth & Database | Supabase (PostgreSQL + Row-Level Security) |
| Real-time Messaging | Supabase Realtime |
| File Storage | Supabase Storage |
| Payments | Stripe (Escrow flow, test mode) |
| Maps & Location | Google Maps API |
| AI Agent | Groq |
| Local Notifications | Expo Notifications |

---

## Project Status & Scope

UseIT is a complete, working concept: the product, the technical architecture, and every core user flow — browsing, chat, AI-assisted listing, payment, QR handoff, disputes, reputation, admin moderation — are built and demonstrable end-to-end.

Turning it into an operating business is a separate step from the software, and nothing on that side is finalized yet. In particular: the escrow-style payment flow is built on Stripe Connect and works fully in Stripe's test mode, but Stripe Connect's own onboarding doesn't currently offer Israel as a supported business country — so running this as a live payment platform there would need a different payment provider, or a business entity registered elsewhere. More generally, we haven't registered a business or done the legal/compliance work an operating marketplace would need; that's deliberately out of scope for this repository.

---

## Screenshots

<table>
  <tr>
    <td align="center" width="25%">
      <img src="./screenshots/screenshot-feed.png" width="180" alt="Swipe Feed" /><br/>
      <b>📍 Location-based Feed</b><br/>
      <sub>Swipe through nearby items filtered by radius</sub>
    </td>
    <td align="center" width="25%">
      <img src="./screenshots/screenshot-item-detail.png" width="180" alt="Item Detail" /><br/>
      <b>🛍️ Item Detail</b><br/>
      <sub>Full listing view with Rent, Wishlist, and Chat actions</sub>
    </td>
    <td align="center" width="25%">
      <img src="./screenshots/screenshot-chat.png" width="180" alt="Real-time Chat" /><br/>
      <b>💬 Real-time Chat</b><br/>
      <sub>Direct messaging between renter and lender</sub>
    </td>
    <td align="center" width="25%">
      <img src="./screenshots/screenshot-my-items.png" width="180" alt="My Items" /><br/>
      <b>📦 Lender Dashboard</b><br/>
      <sub>Manage listings — edit, hide, or track rentals</sub>
    </td>
  </tr>
</table>

---

## Try It

**Expo Go won't run this app** — `@stripe/stripe-react-native` needs native code that only ships in a custom dev client, so payments (and anything that touches them) fail under Expo Go. Build a dev client instead:

```bash
git clone https://github.com/pamnati592/UseIT.git
cd UseIT
npm install
npx expo run:ios      # or: npx expo run:android
```

That builds and installs a dev client on a simulator/emulator or a connected device. On a free Apple developer account, an on-device build's signature expires after 7 days — re-run `npx expo run:ios --device` to refresh it.

---

## Local Development

```bash
# Install dependencies
npm install

# Rebuild and launch the dev client
npx expo run:ios       # iOS simulator or connected device
npx expo run:android   # Android emulator or connected device

# Once the dev client is installed, subsequent runs only need the bundler:
npx expo start
```

> Requires a `.env` file with your Supabase URL, anon key, Stripe publishable key, Google Maps API key, and Groq key — see `.env.example`.

---

## Product Spec

The full product requirements document (PRD) is available in this repository:
[product-spec.pdf](./product-spec.pdf)

---

## Team

| Name | Role |
|---|---|
| Ori Perelman | Full-Stack / Mobile |
| Netanel Pham | Full-Stack / Mobile |

---

<div align="center">
  <sub>Built with React Native + Expo · Supabase · Stripe · Groq</sub>
</div>
