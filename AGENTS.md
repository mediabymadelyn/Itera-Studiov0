# AGENTS.md

## Project overview
This repository is for Itera Studio, an AI-assisted search tool for artists that returns real, credited references from trusted APIs.

The product does NOT generate images.
The product should help users discover real artwork and reference images with attribution.

## Tech stack
- Next.js
- TypeScript
- App Router
- Minimal clean UI

## Build priorities
1. Build a working v0 quickly
2. Keep the architecture modular
3. Prefer simple deterministic logic before adding LLM features
4. Preserve attribution and source transparency everywhere

## Current v0 scope
Only implement these sources first:
- Metropolitan Museum of Art API
- Art Institute of Chicago API
- Unsplash API

Do not add more APIs until v0 works.

## Required result schema
Every source adapter must normalize into one shared result type with these fields:
- id
- title
- artist
- source
- imageUrl
- thumbnailUrl
- licenseType
- originalLink
- sourceLink
- score

## Rules
- Use TypeScript only
- Keep source adapters separate from UI
- Never pass raw API response objects directly into UI components
- Normalize every source response into one shared schema
- Filter out unusable results
- Prefer maintainable code over clever code
- Do not build features outside the requested milestone
- Keep diffs scoped and small

## Validation rules
Before finishing a task:
- ensure the app builds
- ensure types are valid
- ensure search results display with attribution
- ensure no source adapter returns malformed data

## Folder expectations
- app/ for frontend routes
- app/api/search for the main search endpoint
- lib/types for shared types
- lib/sources for API adapters
- lib/search for routing, expansion, and ranking
- components for UI parts

## Product behavior
The search experience should:
- accept a user prompt
- decide which sources to search
- fetch results
- normalize results
- filter bad results
- rank results
- return credited results to the frontend

## Routing hints
Use simple keyword-based routing for v0:
- portrait, oil painting, classical art -> museum APIs first
- photography, street photo, modern fashion -> Unsplash first
- otherwise search all v0 sources and rank results

## UI requirements
The UI should include:
- a search bar
- a submit button
- loading state
- result cards
- visible attribution on every card

Every result card should show:
- image
- title
- artist or creator if available
- source
- license if available
- original link

## What not to do yet
- no authentication
- no database
- no background jobs
- no custom training
- no advanced LLM orchestration
- no extra APIs beyond the first three
