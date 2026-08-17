---
type: "query"
date: "2026-08-09T13:33:47.130967+00:00"
question: "Why does Manajemen User Page (admin.html) connect App Pages & Project Docs to User Management Admin?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["Manajemen User Page (admin.html)", "initUserManagement()", "exportToExcel()", "openAddUser()", "handleCsvFile()", "submitResetPw()"]
---

# Q: Why does Manajemen User Page (admin.html) connect App Pages & Project Docs to User Management Admin?

## Answer

Explained node admin_page directly: 7 connections total. One EXTRACTED 'implements' edge to Design Tokens System (same hub-and-spoke as every other page), one EXTRACTED 'references' edge from Dashboard Laporan Page, and 4 INFERRED 'references' edges out to initUserManagement(), exportToExcel(), openAddUser(), handleCsvFile(), submitResetPw() -- all defined in user-management.js. These 4 are INFERRED not EXTRACTED because admin.html itself has no <script src> import edge into user-management.js in the AST; the semantic subagent matched onclick="fn()" attribute strings in the HTML to matching function names in user-management.js by name-shape inference, not a structural import. That is the bridge: a static HTML shell (App Pages & Project Docs) wired to its JS controller (User Management Admin) purely through DOM event-handler string matching, invisible to AST-based structural extraction.

## Outcome

- Signal: useful

## Source Nodes

- Manajemen User Page (admin.html)
- initUserManagement()
- exportToExcel()
- openAddUser()
- handleCsvFile()
- submitResetPw()