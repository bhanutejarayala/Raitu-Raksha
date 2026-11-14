# Raitu Raksha (రైతు రక్ష) - Fertilizer Recommendation System

Hackathon Problem Statement 14 | Team HKWT49-KM-BT09 | SR University, Warangal

Web app that takes crop, growth stage, area and soil test values and returns fertilizer type, quantity
for the farmer's own area, timing and precautions. Recommendations come from a rule table that an
agronomist can edit from the browser.

## Stack
HTML / CSS / JavaScript (no framework), Node.js + Express, MySQL (MariaDB also works), JWT + bcrypt.

## Run it
1. Install Node 18+ and MySQL.
2. `npm install`
3. Copy `.env.example` to `.env` and put your MySQL user / password in it.
4. Create the tables: `mysql -u root -p < db/schema.sql`
5. Fill the knowledge base: `npm run seed`
6. `npm start` and open http://localhost:3000

Agronomist login (created by the seed): `agronomist@raitu-raksha.in` / `agro@123`
Farmers register from the login page.

## Folders
- `server.js` - routes
- `src/engine.js` - rule matching and quantity calculation
- `src/auth.js`, `src/db.js` - login middleware, connection pool
- `db/schema.sql`, `db/seed.js` - tables and starter knowledge base (6 crops, 8 fertilizers, 120+ rules)
- `public/` - front end

## How the engine works
1. Soil values are normalised: numbers in kg/ha become low / medium / high, area becomes hectares.
2. Every rule for the crop (and the crop-independent pH rules) whose conditions fit is picked.
3. Rules for the same fertilizer are merged. Nitrogen supplied by DAP is subtracted from urea.
4. Per-hectare quantities are scaled to the farmer's area.

Seeded dose = crop dose x stage share x level factor (low 1.25, medium 1.0, high 0.5) / nutrient %.
Starting doses are standard published values; have a local agronomist review them before real use.

## API
| Purpose | Route | Method | Role |
|---|---|---|---|
| Register / login | `/api/auth/register`, `/api/auth/login` | POST | all |
| Crops | `/api/crops` | GET | logged in |
| Request recommendation | `/api/recommendations/request` | POST | user |
| Get one | `/api/recommendations/:id` | GET | user |
| Save | `/api/recommendations/:id/save` | POST | user |
| History | `/api/recommendations/user/:userId` | GET | user |
| Feedback | `/api/recommendations/:id/feedback` | POST | user |
| Knowledge base | `/api/kb` | GET | logged in |
| Crops / fertilizers / rules | `/api/admin/crops`, `/api/admin/fertilizers`, `/api/admin/rules` | POST, PUT (DELETE on rules) | agronomist |
| All feedback | `/api/admin/feedback` | GET | agronomist |
