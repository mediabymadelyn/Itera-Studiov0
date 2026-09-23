# Itera Studio v0

Itera Studio is an AI-assisted reference search tool for artists.

It does not generate images.
It helps users find real, credited visual references from trusted museum and image APIs.

## v0 goal
A user types a prompt and gets back credited image references.

## Initial sources
- The Metropolitan Museum of Art API
- Art Institute of Chicago API
- Unsplash API

## Core flow
user input -> query interpretation -> source routing -> API search -> normalization -> filtering -> ranking -> credited results

## Required metadata for every result
- title
- artist or creator if available
- source name
- image URL
- license type if available
- original link

## Non-goals for v0
- no image generation
- no custom model training
- no complex multimodal comparison yet
