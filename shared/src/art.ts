// Art mode: famous paintings from museums that give their images away, shown full screen like
// pictures on a wall. The Hub fetches and keeps them (see hub/src/art.ts); this is what the TV,
// the phone and the Hub agree on.

export type ArtSourceId = "aic" | "met" | "cma";

export interface ArtSourceInfo {
  id: ArtSourceId;
  name: string;
  /** How the museum describes the licence of the images the Hub takes. */
  licence: string;
}

export const ART_SOURCES: readonly ArtSourceInfo[] = [
  { id: "aic", name: "Art Institute of Chicago", licence: "Public domain (CC0)" },
  { id: "met", name: "The Metropolitan Museum of Art", licence: "Open Access (CC0)" },
  { id: "cma", name: "Cleveland Museum of Art", licence: "Open Access (CC0)" },
];

export interface ArtCollection {
  id: string;
  name: string;
  detail: string;
  /** Searched for in each museum's catalogue; paintings only. */
  terms: string[];
  /** Fine for children: no battles, saints' deaths or nudes among them (titles are checked too). */
  kids: boolean;
}

export const ART_COLLECTIONS: readonly ArtCollection[] = [
  { id: "masterpieces", name: "Masterpieces", detail: "The museums' own favourites", terms: ["masterpiece", "impressionist landscape", "portrait of a lady"], kids: false },
  { id: "impressionism", name: "Impressionism", detail: "Monet, Renoir, Pissarro, Sisley and friends", terms: ["Monet", "Renoir", "Pissarro", "Sisley", "Morisot", "Caillebotte"], kids: true },
  { id: "postimpressionism", name: "Post-Impressionism", detail: "Van Gogh, Cézanne, Gauguin, Seurat", terms: ["Van Gogh", "Cézanne", "Gauguin", "Seurat", "Signac"], kids: true },
  { id: "landscapes", name: "Landscapes", detail: "Hills, rivers, valleys and skies", terms: ["landscape", "river landscape", "mountain landscape", "pastoral landscape"], kids: true },
  { id: "seascapes", name: "Seascapes", detail: "Boats, harbours and the sea", terms: ["seascape", "harbour", "sailing ships", "marine"], kids: true },
  { id: "romantic", name: "Romantic skies", detail: "Turner, Constable, Friedrich, Cole", terms: ["Turner", "Constable", "Caspar David Friedrich", "Thomas Cole", "Church Hudson River"], kids: true },
  { id: "dutch", name: "Dutch Golden Age", detail: "Rembrandt, Vermeer, Hals, Ruisdael", terms: ["Rembrandt", "Vermeer", "Frans Hals", "Ruisdael", "Dutch interior"], kids: false },
  { id: "flowers", name: "Flowers and still life", detail: "Bouquets, fruit and tables laid out", terms: ["flowers", "still life", "bouquet", "fruit still life"], kids: true },
  { id: "animals", name: "Animals", detail: "Horses, dogs, birds and cats", terms: ["horses", "dog", "birds", "cat", "cows"], kids: true },
  { id: "japan", name: "Japan", detail: "Hokusai, Hiroshige and Japanese screens", terms: ["Hokusai", "Hiroshige", "Japanese landscape", "folding screen"], kids: true },
  { id: "portraits", name: "Portraits", detail: "People from five centuries", terms: ["portrait", "portrait of a man", "self-portrait"], kids: false },
  { id: "winter", name: "Winter scenes", detail: "Snow, skating and frozen rivers", terms: ["winter landscape", "snow", "skating"], kids: true },
];

export const isArtCollection = (id: unknown): id is string => ART_COLLECTIONS.some((c) => c.id === id);

/** Words that keep a painting out of Kids-friendly mode, whatever collection it came from. */
const NOT_FOR_KIDS = /\b(nude|naked|bather|bathers|bathing|venus|susanna|lucretia|salome|judith|holofernes|crucifixion|martyr|martyrdom|execution|beheading|massacre|slaughter|corpse|dead|death|skull|battle|war|hell|devil|satan|demon|temptation|rape|sabine|cupid|odalisque|sleeping|brothel|absinthe|drunk)\b/i;
export const kidsFriendlyTitle = (title: string): boolean => !NOT_FOR_KIDS.test(title);

/** A painting the Hub has kept. */
export interface ArtItem {
  id: string;
  title: string;
  artist: string;
  /** "1872", "about 1650" and the like, as the museum writes it. */
  date: string;
  source: ArtSourceId;
  /** The museum's page for it. */
  page: string;
  collections: string[];
  /** Kids-friendly: from a kids collection and with a title that passes kidsFriendlyTitle. */
  kids: boolean;
}

export interface ArtStatus {
  /** How many paintings are kept, and how many the Hub is aiming to keep. */
  cached: number;
  target: number;
  bytes: number;
  running: boolean;
  lastError?: string;
  /** When the last fetch finished (ms). */
  lastRun?: number;
  collections: readonly ArtCollection[];
  sources: readonly ArtSourceInfo[];
}

export type ArtOrder = "shuffle" | "ordered";
export type ArtFrame = "none" | "matte" | "gold";
export type ArtNight = "none" | "dim" | "black";
