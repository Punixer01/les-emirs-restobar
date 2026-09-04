import { sql } from "./_lib/db.mjs";
import { json, readBody } from "./_lib/util.mjs";
import { auth } from "./_lib/auth.mjs";

// Editable site content. GET is public (site reads it); POST is owner (CMS save).
export const DEFAULTS = {
  tagline: "Apéros, déjeuners, dîners… et vibes chill au cœur de Port El Kantaoui.",
  about:
    "Depuis le port, nous cuisinons la mer avec respect — poissons du jour saisis à la braise, fruits de mer et épices d’ici. Une table où la Méditerranée se raconte, assiette après assiette.",
  phone: "+216 73 348 700",
  address: "Port El Kantaoui, Hammam Sousse, Sousse — Tunisie",
  facebook: "https://www.facebook.com/restaurantlesemirs/",
  hours: { lunch: "12:00 — 15:30", dinner: "19:00 — 23:00", days: "Tous les jours" },
  quotes: {
    signature_title: "La Gargoulette des Émirs",
    signature_text: "Agneau à l’étouffée, mijoté lentement dans une jarre d’argile scellée — brisée devant vous, à partager.",
    terrace: "L’art de recevoir, au bord du port, face à la Méditerranée.",
    invite: "Une table où la Méditerranée se raconte, assiette après assiette.",
  },
  menu: [
    { cat: "Entrées Froides", name: "Salade Méchouia", desc: "", price: "19" },
    { cat: "Entrées Froides", name: "Salade César", desc: "", price: "28" },
    { cat: "Entrées Froides", name: "Salade Pêcheur", desc: "", price: "40" },
    { cat: "Entrées Froides", name: "Carpaccio de Bœuf à l’Huile de Truffe", desc: "", price: "40" },
    { cat: "Entrées Froides", name: "Carpaccio de Poulpe aux Baies Roses", desc: "", price: "45" },
    { cat: "Entrées Froides", name: "Burrata Sicilienne", desc: "", price: "35" },
    { cat: "Entrées Froides", name: "Foie Gras de Canard & Confit de Figues", desc: "", price: "45" },
    { cat: "Entrées Froides", name: "Mozzarella Cerise, Sauce Pesto", desc: "", price: "28" },

    { cat: "Entrées Chaudes", name: "Soupe de Poisson", desc: "", price: "15" },
    { cat: "Entrées Chaudes", name: "Brick au Thon ou aux Crevettes", desc: "", price: "13" },
    { cat: "Entrées Chaudes", name: "Friture de Camembert", desc: "", price: "32" },
    { cat: "Entrées Chaudes", name: "Camembert au Four, Miel & Thym", desc: "", price: "38" },
    { cat: "Entrées Chaudes", name: "Seiches Grillées", desc: "", price: "40" },
    { cat: "Entrées Chaudes", name: "Calmar Doré & sa Sauce Tartare", desc: "", price: "32" },
    { cat: "Entrées Chaudes", name: "Moules Marinières", desc: "", price: "32" },
    { cat: "Entrées Chaudes", name: "Crevettes à l’Ail / Croustillant aux Crevettes", desc: "", price: "40" },

    { cat: "Spécialités Tunisiennes", name: "Ojja au Merguez", desc: "", price: "30" },
    { cat: "Spécialités Tunisiennes", name: "Ojja aux Crevettes", desc: "", price: "40" },
    { cat: "Spécialités Tunisiennes", name: "Kamounia Poulpe & Seiches", desc: "", price: "55" },
    { cat: "Spécialités Tunisiennes", name: "Calamar Farci à la Sfaxienne", desc: "", price: "53" },
    { cat: "Spécialités Tunisiennes", name: "Couscous au Calamar Farci", desc: "", price: "53" },
    { cat: "Spécialités Tunisiennes", name: "Couscous à l’Agneau", desc: "", price: "65" },
    { cat: "Spécialités Tunisiennes", name: "Couscous Royal", desc: "", price: "60" },
    { cat: "Spécialités Tunisiennes", name: "Couscous au Poisson", desc: "", price: "54" },
    { cat: "Spécialités Tunisiennes", name: "Couscous au Poulpe", desc: "", price: "65" },
    { cat: "Spécialités Tunisiennes", name: "Gargoulette Les Émirs (2 pers.)", desc: "Agneau à l’étouffée dans une jarre", price: "150" },

    { cat: "Les Pâtes", name: "Raviolis Ricotta & Épinard", desc: "", price: "36" },
    { cat: "Les Pâtes", name: "Raviolis au Saumon Fumé", desc: "", price: "40" },
    { cat: "Les Pâtes", name: "Penne Sauce Rosée, Crevettes & Champignons", desc: "", price: "45" },
    { cat: "Les Pâtes", name: "Spaghetti Bolognaise", desc: "", price: "36" },
    { cat: "Les Pâtes", name: "Spaghetti aux Fruits de Mer", desc: "", price: "56" },
    { cat: "Les Pâtes", name: "Tagliatelle à la Crème de Truffes Noires", desc: "", price: "48" },
    { cat: "Les Pâtes", name: "Rigatoni aux Cèpes", desc: "", price: "52" },

    { cat: "Volailles", name: "Cordon Bleu", desc: "", price: "39" },
    { cat: "Volailles", name: "Poulet à l’Indienne au Curry", desc: "", price: "36" },
    { cat: "Volailles", name: "Blanc de Poulet, Sauce à l’Orange ou aux Champignons", desc: "", price: "36" },
    { cat: "Volailles", name: "Poulet Berbère au Romarin", desc: "", price: "36" },

    { cat: "Viandes", name: "Côte à l’Os à la Plancha", desc: "", price: "65" },
    { cat: "Viandes", name: "Entrecôte Maître d’Hôtel", desc: "", price: "58" },
    { cat: "Viandes", name: "Émincé de Bœuf Stroganoff & Riz Pilaf", desc: "", price: "57" },
    { cat: "Viandes", name: "Brochettes Mixtes au Romarin", desc: "", price: "49" },
    { cat: "Viandes", name: "Tagliata de Bœuf & Copeaux de Parmesan", desc: "", price: "60" },
    { cat: "Viandes", name: "Médaillons de Filet de Bœuf, Duo de Sauces", desc: "", price: "63" },
    { cat: "Viandes", name: "Filet de Bœuf au Poivre ou aux Champignons de Paris", desc: "", price: "65" },
    { cat: "Viandes", name: "Filet de Bœuf au Roquefort ou au Parmesan", desc: "", price: "69" },
    { cat: "Viandes", name: "Filet de Bœuf aux Cèpes", desc: "", price: "73" },
    { cat: "Viandes", name: "Filet de Bœuf à la Crème de Truffes Noires", desc: "", price: "73" },

    { cat: "Poissons", name: "Poisson du Jour, Grillé ou au Gros Sel", desc: "prix / 100 g", price: "22" },
    { cat: "Poissons", name: "Filet de Loup, Sauce Citron & Œufs de Lompe", desc: "", price: "54" },
    { cat: "Poissons", name: "Filet de Reine & sa Sauce aux Fruits de Mer", desc: "", price: "56" },
    { cat: "Poissons", name: "Crevettes Royales à l’Ail ou au Curry", desc: "prix / 100 g", price: "28" },
    { cat: "Poissons", name: "Crevettes Calibre Moyen (6 pièces)", desc: "", price: "55" },
    { cat: "Poissons", name: "Langouste Grillée ou Thermidor", desc: "prix / 100 g", price: "45" },

    { cat: "Menu Enfants", name: "Émincé de Poulet Pané + Coupe de Glace", desc: "", price: "33" },
    { cat: "Menu Enfants", name: "Pâtes Bolognaise + Coupe de Glace", desc: "", price: "33" },

    { cat: "Desserts", name: "Nougat Glacé", desc: "", price: "23" },
    { cat: "Desserts", name: "Tiramisu", desc: "", price: "20" },
    { cat: "Desserts", name: "Moelleux au Chocolat", desc: "", price: "20" },
    { cat: "Desserts", name: "Affogato", desc: "", price: "14" },
    { cat: "Desserts", name: "Coupe de Glace Mixte", desc: "", price: "14" },
    { cat: "Desserts", name: "Sorbet de Citron à la Vodka", desc: "", price: "16" },
  ],
};

export default async (req) => {
  if (req.method === "GET") {
    let stored = {};
    let custom = false;
    try {
      const rows = await sql`select value from settings where key = 'content'`;
      if (rows.length) { try { stored = JSON.parse(rows[0].value || "{}"); } catch (e) {} custom = true; }
    } catch (e) { /* DB down -> return defaults so the site never breaks */ }
    return json({ content: { ...DEFAULTS, ...stored }, custom });
  }

  const me = auth(req, ["owner"]);
  if (!me) return json({ error: "unauthorized" }, 401);

  if (req.method === "POST") {
    const body = await readBody(req);
    const content = body.content && typeof body.content === "object" ? body.content : {};
    await sql`
      insert into settings (key, value) values ('content', ${JSON.stringify(content)})
      on conflict (key) do update set value = excluded.value`;
    return json({ ok: true });
  }
  return json({ error: "method" }, 405);
};
