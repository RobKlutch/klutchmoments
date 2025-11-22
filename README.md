# Klutch Moments

Klutch Moments includes a React frontend, Node/Express backend, and Supabase wiring to generate highlights powered by a Replicate-hosted YOLO model.

## Project Structure
- `client/` – Klutch frontend (React + Vite)
- `server/` – Klutch backend (Node/Express)
- `docs/supabase-schema.sql` – SQL script for the `highlight_jobs` table
- `replicate-model/` – Standalone Cog project for training and deploying the YOLOv11 + BoT-SORT tracker to Replicate

## Deployment
- **App (client + server):** Deploy to Vercel (or similar) with environment variables from `.env.example` set in the hosting environment.
- **Model:** From inside `replicate-model/`, run `cog push r8.im/<owner>/<model-name>` to publish the model to Replicate. Update `REPLICATE_YOLO_MODEL` in the app environment to point to the pushed model version.

## Environment Variables
Use `.env.example` as a template for the app. These variables should be set both locally and in your deployment provider.

## Building
Install dependencies and run a production build from the repository root:

```bash
npm install
npm run build
```
