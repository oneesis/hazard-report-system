---
type: "query"
date: "2026-08-09T13:36:01.003444+00:00"
question: "Why does OneSapOfflineSync connect Hazard Report Form Logic to Inspection Form Logic?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["OneSapOfflineSync", "submitForm() (script.js)", "submitForm() (inspection-form.js)", "offline-sync.js"]
---

# Q: Why does OneSapOfflineSync connect Hazard Report Form Logic to Inspection Form Logic?

## Answer

Explained node offline_sync_onesapofflinesync directly: only 3 connections, all EXTRACTED. offline-sync.js 'contains' it (its own file), and two separate submitForm() functions reference it -- one in script.js:L1217 (the hazard report form, community Hazard Report Form Logic) and one in inspection-form.js:L736 (community Inspection Form Logic). This is a genuine shared-utility bridge: both forms independently import/call the same OneSapOfflineSync class from offline-sync.js to queue submissions when offline, so the two otherwise-separate form-handling communities both depend on one shared class. Unlike the tokens.css hub (12 spokes) this is a tight 2-caller bridge, both structurally EXTRACTED (real import/call relationships, not inferred).

## Outcome

- Signal: useful

## Source Nodes

- OneSapOfflineSync
- submitForm() (script.js)
- submitForm() (inspection-form.js)
- offline-sync.js