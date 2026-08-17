---
type: "query"
date: "2026-08-09T12:59:47.021971+00:00"
question: "Why does Design Tokens System (tokens.css) connect App Pages & Project Docs to SAP Achievement Dashboard, Report Detail Page?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["Design Tokens System (tokens.css)", "Capaian SAP Page (capaian-sap.html)", "Detail Laporan Page (laporan-detail.html)", "Dashboard Laporan Page (dashboard.html)"]
---

# Q: Why does Design Tokens System (tokens.css) connect App Pages & Project Docs to SAP Achievement Dashboard, Report Detail Page?

## Answer

Expanded from original query via vocab: [design, token, css, system, dashboard, report, detail, achievement, sap, page, capaian]. Then explained node redesign_spec_design_tokens directly: it has 12 connections, all EXTRACTED 'implements' edges, one from every HTML page in the app (login, index, index-home, inspection, inspection-form, dashboard, capaian-sap, laporan-admin, laporan-detail, eskalasi, admin) back to REDESIGN_SPEC.md's Design Tokens System. It bridges communities because it's a single shared design-token spec (tokens.css) that every page across every feature community (SAP Achievement Dashboard, Report Detail Page, Dashboard Analytics, User Management Admin, etc.) individually implements -- a hub-and-spoke pattern, not a chain.

## Outcome

- Signal: useful

## Source Nodes

- Design Tokens System (tokens.css)
- Capaian SAP Page (capaian-sap.html)
- Detail Laporan Page (laporan-detail.html)
- Dashboard Laporan Page (dashboard.html)