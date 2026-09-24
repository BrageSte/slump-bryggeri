import type { DiyDogBeer } from "../../src/domain/import/diy-dog.ts";

const g = (value: number) => ({ value, unit: "grams" });
const kg = (value: number) => ({ value, unit: "kilograms" });
const c = (value: number) => ({ value, unit: "celsius" });

/** DIY Dog #1 as published in github.com/alxiw/punkapi (MIT). */
export const punkIpa: DiyDogBeer = {
  id: 1,
  name: "Punk IPA 2007 - 2010",
  tagline: "Post Modern Classic. Spiky. Tropical. Hoppy.",
  first_brewed: "04/2007",
  description: "Our flagship beer that kick started the craft beer revolution.",
  abv: 6,
  ibu: 60,
  target_fg: 1010,
  target_og: 1056,
  ebc: 17,
  attenuation_level: 82.14,
  volume: { value: 20, unit: "litres" },
  method: { mash_temp: [{ temp: c(65), duration: 75 }], fermentation: { temp: c(19) }, twist: null },
  ingredients: {
    malt: [{ name: "Extra Pale", amount: kg(5.3) }],
    hops: [
      { name: "Ahtanum", amount: g(17.5), add: "start", attribute: "bitter" },
      { name: "Chinook", amount: g(15), add: "start", attribute: "bitter" },
      { name: "Crystal", amount: g(17.5), add: "middle", attribute: "flavour" },
      { name: "Chinook", amount: g(17.5), add: "middle", attribute: "flavour" },
      { name: "Ahtanum", amount: g(17.5), add: "end", attribute: "flavour" },
      { name: "Chinook", amount: g(27.5), add: "end", attribute: "flavour" },
      { name: "Crystal", amount: g(17.5), add: "end", attribute: "flavour" },
      { name: "Motueka", amount: g(17.5), add: "end", attribute: "flavour" },
    ],
    yeast: "Wyeast 1056 - American Ale™",
  },
  brewers_tips: "Add the aroma hops just before knock out.",
};

/** Synthetic recipe exercising the messy cases found in the dataset. */
export const messy: DiyDogBeer = {
  id: 999,
  name: "Test Imperial Stout",
  tagline: "Big and black.",
  abv: 11,
  ibu: 1157,
  target_og: 1098,
  target_fg: 1016,
  ebc: 300,
  attenuation_level: 84,
  volume: { value: 20, unit: "litres" },
  method: {
    mash_temp: [
      { temp: c(65), duration: 30 },
      { temp: { value: null as unknown as number, unit: "celsius" }, duration: null },
      { temp: c(72), duration: null },
    ],
    fermentation: { temp: c(99) },
    twist: "Oak chips soaked in whisky 50g",
  },
  ingredients: {
    malt: [
      { name: "Maris Otter", amount: kg(7) },
      { name: "Honey", amount: kg(0.5) },
      { name: "Sweet Orange Peel", amount: g(20) },
    ],
    hops: [
      { name: "Columbus", amount: g(40), add: "90", attribute: "14% Alpha" },
      { name: "Mandarina Bavaria", amount: g(25), add: "First Wort Hops", attribute: "flavour" },
      { name: "Citra", amount: g(50), add: "WHP", attribute: "aroma" },
      { name: "Simcoe", amount: g(60), add: "Dry Hop, at Day 6", attribute: "aroma" },
      { name: "Mosaic", amount: g(30), add: "HD2", attribute: "aroma" },
      { name: "Cold Brew Coffee", amount: { value: 160, unit: "ml" }, add: "FV Addition", attribute: "Flavour" },
      { name: "American Oak Chips", amount: g(50), add: "Wood Ageing", attribute: "Wood Ageing" },
      { name: "Cascade", amount: g(10), add: "Hopback", attribute: "aroma" },
    ],
    yeast: null,
  },
};
