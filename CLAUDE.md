# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FitPlan is a fitness and nutrition tracking application built with React, Vite, and Firebase. It allows users to track daily food intake, monitor weight history, calculate calorie needs (TDEE), and manage favorite meals. The app uses anonymous Firebase authentication and Firestore for data persistence.

## Tech Stack

- **Frontend**: React 19.2 with JSX
- **Build Tool**: Vite (using rolldown-vite@7.2.5)
- **Database**: Firebase Firestore
- **Authentication**: Firebase Anonymous Auth
- **Charts**: Recharts
- **Icons**: lucide-react
- **Styling**: Tailwind-like utility classes (custom CSS)

## Development Commands

```bash
# Install dependencies
npm install

# Start development server (with HMR)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Run ESLint
npm run lint
```

## Architecture

### Single-Page Application Structure

The entire application is contained in a single React component (`src/App.jsx`) with three main views:
- **Diary View**: Daily food logging with meal builder
- **History View**: Historical calorie tracking by date
- **Profile View**: User stats and weight tracking

### Firebase Data Model

Data is stored under a hierarchical structure:
```
/artifacts/{appId}/users/{userId}/
  ├── daily_logs/        # Food entries per day
  ├── saved_meals/       # User's favorite meals
  └── user_stats/        # Weight, height, age, TDEE history
```

**Important**: `appId` is hardcoded as `'fit-tracker-app'` in the codebase.

### State Management

No external state management library is used. Component state is managed with React hooks:
- `useState` for local component state
- `useEffect` for Firebase real-time subscriptions
- Real-time updates via Firestore `onSnapshot` listeners

### Key Features Implementation

1. **Meal Builder**: Users create meals by adding ingredients from:
   - Local MOCK_FOOD_DB (11 predefined items in Polish)
   - OpenFoodFacts API (searches automatically when typing 3+ characters)

2. **TDEE Calculation**: Uses Mifflin-St Jeor equation with activity multipliers:
   - Basal Metabolic Rate (BMR) based on weight, height, age, gender
   - Multiplied by activity level (1.2 to 1.9)
   - Macros calculated as: Protein 25%, Fat 30%, Carbs 45%

3. **Real-time Sync**: All data automatically syncs across sessions via Firestore listeners

## Firebase Configuration

Firebase config is hardcoded in `src/App.jsx` lines 18-25. To change Firebase project:
1. Update `firebaseConfig` object with new project credentials from Firebase Console
2. Ensure Firestore and Anonymous Auth are enabled in the new project

## Code Conventions

- **Language**: Polish for UI strings and comments
- **Naming**: camelCase for functions, PascalCase for components
- **Formatting**: 4-space indentation (inconsistent in some areas)
- **No TypeScript**: This is a pure JavaScript project
- **CSS**: Inline Tailwind-style classes, some custom CSS in `src/App.css` and `src/index.css`

## ESLint Configuration

Custom flat config in `eslint.config.js`:
- Extends recommended rules from `@eslint/js`, `react-hooks`, and `react-refresh`
- Custom rule: Allows unused variables starting with uppercase or underscore
- Ignores `dist` directory

## Food Database

### Local Database
Stored in `MOCK_FOOD_DB` object (line 53-65) with Polish food names:
- Values are per 100g/100ml or per piece (`szt.`)
- Format: `{ kcal, p, f, c, unit }`

### External API
Uses OpenFoodFacts API for extended food search:
- Endpoint: `https://pl.openfoodfacts.org/cgi/search.pl`
- Searches triggered after 3+ characters with 600ms debounce
- Returns top 5 results normalized to 100g format

## Common Development Tasks

### Adding New Food to Local Database
Edit `MOCK_FOOD_DB` object in `src/App.jsx` (~line 53):
```javascript
'nazwa produktu': { kcal: X, p: Y, f: Z, c: W, unit: 'g' }
```

### Modifying TDEE Formula
Edit `calculateBMR` function (~line 39) or `calculateMacros` function (~line 46)

### Changing Date Format
Edit `formatDate` function (~line 36)

### Adding New View/Tab
1. Add tab button in navigation (~line 248)
2. Create view component following pattern of `DiaryView`, `HistoryView`, `ProfileView`
3. Add conditional rendering in main component (~line 230-245)

## Known Patterns

- **Date Handling**: All dates stored as ISO strings (YYYY-MM-DD)
- **Timestamps**: Firestore `serverTimestamp()` for `createdAt` fields
- **Multipliers**: Ingredient amounts calculated as:
  - For g/ml: `(count / 100) * nutrient_value`
  - For pieces: `count * nutrient_value`
- **Sorting**: Firestore queries use `orderBy`, but diary logs are re-sorted client-side by timestamp descending

## Potential Gotchas

1. **Firebase Config Exposed**: API keys are visible in source. Firebase security rules should restrict access.
2. **Anonymous Auth**: Users lose data if they clear browser storage. No account recovery.
3. **Single File**: Entire app logic is in one 738-line file. Consider splitting for maintainability.
4. **Polish Language**: All UI text and comments are in Polish.
5. **No Tests**: No test files or testing framework configured.
6. **API Rate Limits**: OpenFoodFacts API has no rate limiting in code, could be throttled.
