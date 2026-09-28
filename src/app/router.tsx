import { createBrowserRouter, Link } from "react-router";
import { AppShell } from "../components/AppShell.tsx";
import { buttonClasses, EmptyState } from "../design-system/index.ts";
import { LoginPage } from "../features/auth/LoginPage.tsx";
import { BatchPage } from "../features/batches/BatchPage.tsx";
import { BrewPage } from "../features/batches/BrewPage.tsx";
import { BreweryModePage } from "../features/breweries/BreweryModePage.tsx";
import { OnboardingPage } from "../features/breweries/OnboardingPage.tsx";
import { ExportPage } from "../features/breweries/ExportPage.tsx";
import { UnitConverterPage } from "../features/batches/UnitConverter.tsx";
import { ImportRecipePage } from "../features/recipes/ImportRecipePage.tsx";
import { LibraryRecipePage } from "../features/recipes/LibraryRecipePage.tsx";
import { RecipeDetailPage } from "../features/recipes/RecipeDetailPage.tsx";
import { RecipesPage } from "../features/recipes/RecipesPage.tsx";
import { RequireBrewery } from "./guards.tsx";
import { HomePage } from "./HomePage.tsx";
import { MorePage } from "./MorePage.tsx";

function NotFound() {
  return (
    <EmptyState
      title="Fant ikke siden"
      action={
        <Link to="/" className={buttonClasses("primary")}>
          Til forsiden
        </Link>
      }
    />
  );
}

// Heavier, less frequently used screens load on demand so brew day and home start fast.
const recipeEditor = async () => ({ Component: (await import("../features/recipes/RecipeEditorPage.tsx")).RecipeEditorPage });
const adaptRecipe = async () => ({ Component: (await import("../features/recipes/AdaptRecipePage.tsx")).AdaptRecipePage });
const members = async () => ({ Component: (await import("../features/breweries/MembersPage.tsx")).MembersPage });
const equipment = async () => ({ Component: (await import("../features/equipment/EquipmentPage.tsx")).EquipmentPage });
const calibration = async () => ({ Component: (await import("../features/calibration/CalibrationPage.tsx")).CalibrationPage });
const assistant = async () => ({ Component: (await import("../features/assistant/AssistantPage.tsx")).AssistantPage });
const settings = async () => ({ Component: (await import("./SettingsPage.tsx")).SettingsPage });
const batchResult = async () => ({ Component: (await import("../features/batches/BatchResultPage.tsx")).BatchResultPage });
const batchReport = async () => ({ Component: (await import("../features/batches/BatchReportPage.tsx")).BatchReportPage });
const bsmxImport = async () => ({ Component: (await import("../features/recipes/BsmxImportPage.tsx")).BsmxImportPage });

export const router = createBrowserRouter([
  { path: "/logg-inn", element: <LoginPage /> },
  { path: "/inngang", element: <BreweryModePage /> },
  { path: "/velkommen", element: <OnboardingPage /> },
  {
    element: <RequireBrewery />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <HomePage /> },
          { path: "brygg", element: <BrewPage /> },
          { path: "batcher/:batchId", element: <BatchPage /> },
          { path: "batcher/:batchId/resultat", lazy: batchResult },
          { path: "batcher/:batchId/rapport", lazy: batchReport },
          { path: "oppskrifter", element: <RecipesPage /> },
          { path: "oppskrifter/bibliotek/:libraryId", element: <LibraryRecipePage /> },
          { path: "oppskrifter/importer", element: <ImportRecipePage /> },
          { path: "oppskrifter/importer/beersmith", lazy: bsmxImport },
          { path: "oppskrifter/ny", lazy: recipeEditor },
          { path: "oppskrifter/:recipeId", element: <RecipeDetailPage /> },
          { path: "oppskrifter/:recipeId/rediger", lazy: recipeEditor },
          { path: "oppskrifter/:recipeId/tilpass", lazy: adaptRecipe },
          { path: "assistent", lazy: assistant },
          { path: "mer", element: <MorePage /> },
          { path: "mer/medlemmer", lazy: members },
          { path: "mer/eksport", element: <ExportPage /> },
          { path: "mer/omregner", element: <UnitConverterPage /> },
          { path: "mer/utstyr", lazy: equipment },
          { path: "mer/kalibrering", lazy: calibration },
          { path: "mer/innstillinger", lazy: settings },
          { path: "*", element: <NotFound /> },
        ],
      },
    ],
  },
]);
