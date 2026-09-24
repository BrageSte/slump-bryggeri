import { Link, useNavigate } from "react-router";
import { sunsetIpaRecipe } from "../../domain/fixtures/sunset-ipa.ts";
import { Icon, InlineError, PageHeader, StatusChip, useToast, type IconName } from "../../design-system/index.ts";
import { useCreateRecipe } from "./api.ts";

const upcoming: { label: string; icon: IconName; phase: string }[] = [
  { label: "Ta bilde av oppskrift", icon: "camera", phase: "Fase 5" },
  { label: "Last opp bilde", icon: "image", phase: "Fase 5" },
  { label: "PDF / BeerXML / BeerJSON", icon: "file", phase: "Fase 2" },
  { label: "Nettadresse", icon: "link", phase: "Fase 5" },
  { label: "Lim inn tekst", icon: "clipboard", phase: "Fase 5" },
];

/** Import entry point (wireframe §36). Methods not built yet are listed so the roadmap is visible. */
export function ImportRecipePage() {
  const create = useCreateRecipe();
  const navigate = useNavigate();
  const toast = useToast();

  const row = "flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left";

  return (
    <>
      <PageHeader back="/oppskrifter" title="Importer oppskrift" subtitle="Hvordan vil du legge inn oppskriften?" />
      <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
        <li>
          <Link to="/oppskrifter?vis=bibliotek" className={`${row} hover:bg-surface-2`}>
            <Icon name="book" className="text-primary-strong" />
            <span className="flex-1">
              <span className="block font-semibold">Finn i oppskriftsbiblioteket</span>
              <span className="block text-small text-muted">415 oppskrifter å søke i og kopiere</span>
            </span>
            <Icon name="chevronRight" size={20} className="text-muted" />
          </Link>
        </li>
        <li>
          <Link to="/oppskrifter/ny" className={`${row} hover:bg-surface-2`}>
            <Icon name="edit" className="text-primary-strong" />
            <span className="flex-1 font-semibold">Opprett manuelt</span>
            <Icon name="chevronRight" size={20} className="text-muted" />
          </Link>
        </li>
        <li>
          <button
            type="button"
            className={`${row} hover:bg-surface-2 disabled:opacity-60`}
            disabled={create.isPending}
            onClick={() =>
              create.mutate(
                { recipe: sunsetIpaRecipe, source: { kind: "example" } },
                {
                  onSuccess: ({ id }) => {
                    toast("Sunset IPA er lagt inn");
                    navigate(`/oppskrifter/${id}`);
                  },
                },
              )
            }
          >
            <Icon name="book" className="text-primary-strong" />
            <span className="flex-1">
              <span className="block font-semibold">Eksempel: Sunset IPA</span>
              <span className="block text-small text-muted">Referansebatchen fra 23. september, 60 L split</span>
            </span>
            <Icon name="chevronRight" size={20} className="text-muted" />
          </button>
        </li>
        {upcoming.map((item) => (
          <li key={item.label} className={`${row} text-muted`} aria-disabled="true">
            <Icon name={item.icon} />
            <span className="flex-1 font-semibold">{item.label}</span>
            <StatusChip>{item.phase}</StatusChip>
          </li>
        ))}
      </ul>
      {create.error && (
        <div className="mt-3">
          <InlineError>{create.error.message}</InlineError>
        </div>
      )}
    </>
  );
}
