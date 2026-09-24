import { createBrowserRouter, Link } from "react-router";
import { AppShell } from "../components/AppShell.tsx";
import { buttonClasses, EmptyState } from "../design-system/index.ts";
import { AssistantPage } from "../features/assistant/AssistantPage.tsx";
import { LoginPage } from "../features/auth/LoginPage.tsx";
import { BatchPage } from "../features/batches/BatchPage.tsx";
import { BrewPage } from "../features/batches/BrewPage.tsx";
import { BreweryModePage } from "../features/breweries/BreweryModePage.tsx";
import { OnboardingPage } from "../features/breweries/OnboardingPage.tsx";
import { ExportPage } from "../features/breweries/ExportPage.tsx";
import { InventoryPage } from "../features/inventory/InventoryPage.tsx";
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
const settings = async () => ({ Component: (await import("./SettingsPage.tsx")).SettingsPage });

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
          { path: "oppskrifter", element: <RecipesPage /> },
          { path: "oppskrifter/bibliotek/:libraryId", element: <LibraryRecipePage /> },
          { path: "oppskrifter/importer", element: <ImportRecipePage /> },
          { path: "oppskrifter/ny", lazy: recipeEditor },
          { path: "oppskrifter/:recipeId", element: <RecipeDetailPage /> },
          { path: "oppskrifter/:recipeId/rediger", lazy: recipeEditor },
          { path: "oppskrifter/:recipeId/tilpass", lazy: adaptRecipe },
          { path: "inventar", element: <InventoryPage /> },
          { path: "assistent", element: <AssistantPage /> },
          { path: "mer", element: <MorePage /> },
          { path: "mer/medlemmer", lazy: members },
          { path: "mer/eksport", element: <ExportPage /> },
          { path: "mer/utstyr", lazy: equipment },
          { path: "mer/kalibrering", lazy: calibration },
          { path: "mer/innstillinger", lazy: settings },
          { path: "*", element: <NotFound /> },
        ],
      },
    ],
  },
]);
