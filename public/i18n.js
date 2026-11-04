/* Les Émirs — English version of the public site.
   French is the source of truth: the pages stay written in French and this file
   swaps the visible strings when the guest picks EN. One dictionary keyed by the
   exact French text, so nothing has to be tagged in the HTML — new copy simply
   shows in French until a translation is added here.
   Language is chosen with ?lang=en / ?lang=fr and remembered per browser. */
(function () {
  "use strict";

  var DICT = {
    /* ---- navigation ---- */
    "La Maison": "About us",
    "La Carte": "Menu",
    "Galerie": "Gallery",
    "Écrivez-nous": "Contact us",
    "Contact": "Contact",
    "Réserver": "Book",
    "Menu": "Menu",

    /* ---- hero ---- */
    "Depuis 1980": "Since 1980",
    "Apéros, déjeuners, dîners… et vibes chill au cœur de Port El Kantaoui.":
      "Aperitifs, lunches, dinners… and chill vibes in the heart of Port El Kantaoui.",
    "Événements live": "Live events",
    "Soirées karaoké": "Karaoke nights",
    "Ambiance conviviale": "Warm atmosphere",
    "Réserver une table": "Book a table",
    "Voir la carte": "View the menu",
    "Défiler": "Scroll",

    /* ---- la maison ---- */
    "Un haut lieu": "A landmark",
    "de la gastronomie": "of Tunisian",
    "tunisienne.": "gastronomy.",
    "Haut lieu de la gastronomie tunisienne depuis 1980, ce restaurant":
      "A landmark of Tunisian gastronomy since 1980, this restaurant",
    "3 fourchettes": "",
    "sis à Port El Kantaoui, une des plus belles stations balnéaires de la Méditerranée, a été décoré plusieurs fois dans des concours nationaux et internationaux.":
      "set in Port El Kantaoui, one of the most beautiful marina resorts of the Mediterranean, has been awarded several times in national and international competitions.",
    "Presque les pieds dans l’eau, vous serez enchantés par l’environnement féerique qui nous entoure. Notre carte est un métissage de spécialités tunisiennes et méditerranéennes, dont des spécialités devenues réputées mondialement — à l’instar de la fameuse":
      "Set right on the marina, with the Mediterranean Sea just steps away, you will be charmed by the magical setting around us. For generations of guests, Les Emirs has been more than a restaurant. It is a place where Tunisian culinary tradition, Mediterranean flavors and genuine hospitality come together, alongside signature dishes that have become part of the Les Emirs story. Among them, our famous",
    "Gargoulette des Émirs": "Gargoulette des Émirs",
    "— et bien d’autres qui font le plaisir des palais des fins gourmets.":
      "— slow-cooked, sealed in clay and opened tableside: a true Tunisian tradition made to be shared.",
    "Port El Kantaoui": "Port El Kantaoui",
    "L’art de recevoir, au bord du port, face à la Méditerranée.":
      "The art of hosting, by the harbour, facing the Mediterranean Sea.",

    /* ---- la table ---- */
    "La Table": "The Table",
    "Tunisie & Méditerranée.": "Tunisia & the Mediterranean.",
    "Une cuisine inspirée par les saveurs de la Tunisie et de la Méditerranée, où traditions, fraîcheur et créativité se rencontrent. Des spécialités emblématiques, façonnées au fil des années et dont la réputation s’est étendue bien au-delà de nos tables.":
      "A menu inspired by the flavors of Tunisia and the Mediterranean, where tradition, fresh ingredients and creativity come together. From iconic Tunisian specialties to fresh seafood and carefully prepared dishes, every plate reflects the character of our cuisine, rooted in tradition and made with creativity. The reputation of our signature dishes, shaped over the years, reaches far beyond our tables.",
    "Voir la carte complète": "See the full menu",

    /* ---- signature dish ---- */
    "Le plat emblème": "The signature dish",
    "La Gargoulette": "La Gargoulette",
    "des Émirs.": "des Émirs.",
    "Une spécialité devenue réputée mondialement. Scellée dans l’argile, mijotée lentement, ouverte devant vous — le plat que l’on vient partager, encore et encore.":
      "Slow-braised lamb in a sealed clay jar, broken in front of you, to share.",
    "Marinée au safran thym et romarin": "Marinated with saffron, thyme and rosemary",
    "Marinée au safran,": "Marinated with saffron,",
    "thym et romarin": "thyme and rosemary",
    "Scellée dans l’argile": "Sealed in clay",
    "Brisée et servie à table": "Broken and served at your table",
    "La Gargoulette des Émirs": "La Gargoulette des Émirs",
    "Agneau à l’étouffée, mijoté lentement dans une jarre d’argile scellée — brisée devant vous, à partager.":
      "Slow-braised lamb in a sealed clay jar, broken in front of you, to share.",
    "Agneau à l’étouffée dans une jarre": "Lamb braised, cooked in an earthenware pot",

    /* ---- vivier ---- */
    "Le vivier": "The tank",
    "Langoustes": "Live",
    "vivantes.": "lobster.",
    "De notre vivier de langoustes à votre assiette : l’authenticité de la mer,":
      "From our lobster tank to your plate: the sea at its most honest,",
    "la fraîcheur d’exception. Choisissez votre langouste vivante, savourez l’excellence.":
      "exceptional freshness. Pick your live lobster and enjoy — our kitchen takes care of the rest.",

    /* ---- galerie ---- */
    "Instants de table": "Moments at Les Emirs",
    "La maison, la terrasse et les assiettes.": "The atmosphere, the terrace and the plates.",
    "Cliquez pour agrandir — les vidéos se lancent avec le son":
      "Tap to enlarge — videos play with sound",
    "Activer le son": "Turn sound on",
    "Couper le son": "Turn sound off",
    "La terrasse, dressée face à la marina": "The terrace, set facing the marina",
    "Le salon, sous les arches": "The lounge, under the arches",
    "Le salon, à la nuit tombée": "The lounge, after dark",
    "Le service, au bord du port": "Service, by the harbour",
    "L’hôte de la maison": "Your host",
    "L’intérieur": "Inside",
    "Les assiettes de la maison": "The plates of the house",
    "Carpaccio de bœuf, face au port": "Beef carpaccio, facing the harbour",
    "Carpaccio de bœuf, parmesan & citron": "Beef carpaccio, parmesan & lemon",
    "Gambas royales, dressées en tour": "King prawns, served in a tower",
    "Gambas, à la tombée du soir": "King prawns, at dusk",
    "Pâtes aux fruits de mer": "Seafood pasta",
    "Moules et gambas": "Mussels and king prawns",
    "Gambas & moules, face au port": "King prawns & mussels, facing the harbour",
    "Gambas & moules au safran": "King prawns & mussels with saffron",
    "Penne aux gambas, face au port": "Penne with king prawns, facing the harbour",
    "Penne aux crevettes": "Penne with shrimp",
    "Dressage en terrasse": "Plated on the terrace",
    "Tagliatelle, face à l’eau": "Tagliatelle, facing the water",
    "À table, face au port": "At the table, facing the harbour",
    "Vue sur la mer et la marina": "Sea and marina view",
    "Soirées live et karaoké": "Live music and karaoke nights",
    "Réservation en ligne": "Book online",
    "Réserver en": "Book by",
    "par téléphone": "phone",

    /* ---- réservation ---- */
    "Votre table": "Your table",
    "vous attend.": "is waiting.",
    "Service continu": "All-day service",
    "De midi à minuit, tous les jours — toute la carte, à toute heure.":
      "From noon to midnight, every day — the full menu, at any hour.",
    "Nom": "Name",
    "Téléphone": "Phone",
    "Quel jour ?": "Which day?",
    "À quelle heure ?": "At what time?",
    "Place": "Seating",
    "Terrasse": "Terrace",
    "Salle intérieure": "Indoor room",
    "Combien de personnes ?": "How many guests?",
    "1 personne": "1 guest",
    "2 personnes": "2 guests",
    "3 personnes": "3 guests",
    "4 personnes": "4 guests",
    "5 personnes": "5 guests",
    "6 personnes": "6 guests",
    "7 personnes": "7 guests",
    "8 personnes": "8 guests",
    "9 personnes": "9 guests",
    "10 personnes": "10 guests",
    "Autre (plus de 10)": "Other (more than 10)",
    "Email": "Email",
    "Une occasion particulière ?": "A special occasion?",
    "(facultatif)": "(optional)",
    "Demander la réservation": "Request a booking",
    "Vos coordonnées servent uniquement à gérer votre réservation et à vous contacter à ce sujet. Elles ne sont ni vendues ni transmises à des tiers. Pour les corriger ou les supprimer, écrivez-nous à":
      "Your details are used only to manage your booking and to contact you about it. They are never sold or passed on to third parties. To correct or delete them, write to us at",
    "Dimanche": "Sunday", "Lundi": "Monday", "Mardi": "Tuesday", "Mercredi": "Wednesday",
    "Jeudi": "Thursday", "Vendredi": "Friday", "Samedi": "Saturday",

    /* ---- messages & erreurs ---- */
    "Une question ?": "A question?",
    "Écrivez-nous.": "Write to us.",
    "Téléphone ou email": "Phone or email",
    "Message": "Message",
    "Envoyer le message": "Send message",
    "Merci d'indiquer votre nom.": "Please enter your name.",
    "Merci d'indiquer un téléphone.": "Please enter a phone number.",
    "Merci de compléter nom, téléphone, email, date et heure.":
      "Please fill in your name, phone, email, date and time.",
    "Merci de vérifier votre adresse email.": "Please check your email address.",
    "Merci — votre message a bien été envoyé.": "Thank you — your message has been sent.",
    "Indiquez le nombre de personnes (plus de 10).": "Enter the number of guests (more than 10).",
    "Pour plus de 30 personnes, merci de nous appeler.": "For more than 30 guests, please call us.",
    "Un souci est survenu.": "Something went wrong.",
    "Un souci est survenu. Merci de réessayer ou de nous appeler.":
      "Something went wrong. Please try again or give us a call.",
    "Connexion impossible — vérifiez votre réseau et réessayez, ou appelez-nous.":
      "Connection failed — check your network and try again, or call us.",
    "Nous vous confirmons très rapidement": "We confirm very quickly",
    "Envoi…": "Sending…",
    "Envoi impossible.": "Could not send.",
    "Connexion impossible.": "Connection failed.",
    "Merci d'indiquer un message.": "Please write a message.",

    /* ---- confirmation & liste d'attente ---- */
    "Demande reçue": "Request received",
    "Référence": "Reference",
    "Merci, nous avons reçu votre demande de réservation.":
      "Thank you, we have received your booking request.",
    "La réservation n’est considérée valide que seulement après la confirmation de notre équipe envoyée par email.":
      "A booking is only valid once our team has confirmed it by email.",
    "Nous vous enverrons une réponse à votre demande dans les plus brefs délais.":
      "We will reply to your request as soon as possible.",
    "Parfait, merci": "Perfect, thank you",
    "Créneau complet": "Fully booked",
    "Ce créneau est complet": "This time slot is fully booked",
    "Choisir un autre horaire": "Choose another time",
    "Choisissez un autre horaire, ou appelez-nous au": "Choose another time, or call us on",
    "Prévenez-moi si une table se libère": "Let me know if a table frees up",
    "Nous vous appelons dès qu'une table se libère.": "We will call you as soon as a table frees up.",
    "M'inscrire sur la liste": "Add me to the list",
    "✓ Vous êtes sur la liste — nous vous appelons dès qu'une table se libère.":
      "✓ You are on the list — we will call you as soon as a table frees up.",
    "Il reste des tables en": "Tables are still available",
    "La salle et la terrasse sont complètes à": "The indoor room and the terrace are full at",
    "est complète": "is full",
    /* winter mode, the "complet" window, the booking form's checks */
    "Terrasse verrière": "Glass-covered terrace",
    "Terrasse en plein air": "Open-air terrace",
    "Complet": "Full",
    "Disponible": "Available",
    "Me prévenir ›": "Notify me ›",
    "Réserver ici ›": "Book here ›",
    "Touchez une place pour réserver.": "Tap an area to book.",
    "Touchez une place disponible pour réserver.": "Tap an available area to book.",
    "Touchez une place pour être prévenu si une table se libère.": "Tap an area to be told when a table frees up.",
    "Champ obligatoire": "Required",
    "Champ obligatoire : choisissez le jour": "Required: choose the day",
    "Champ obligatoire : choisissez l'heure": "Required: choose the time",
    "Numéro incomplet : 8 chiffres minimum": "Incomplete number: 8 digits minimum",
    "Téléphone (incomplet)": "Phone (incomplete)",
    "Adresse email invalide (ex. nom@gmail.com)": "Invalid email address (e.g. name@gmail.com)",
    "Email (invalide)": "Email (invalid)",
    "Jour": "Day",
    "Heure": "Time",
    "Merci d'écrire votre message.": "Please write your message.",
    "Choisir le mois": "Choose the month",
    "Ouvrir l’emplacement du restaurant dans Google Maps": "Open the restaurant’s location in Google Maps",
    "Janvier": "January", "Février": "February", "Mars": "March", "Avril": "April", "Mai": "May", "Juin": "June",
    "Juillet": "July", "Août": "August", "Septembre": "September", "Octobre": "October", "Novembre": "November", "Décembre": "December",

    /* ---- carte : rubriques ---- */
    "Entrées Froides": "Cold Starters",
    "Menu Enfants": "Children’s Menu",

    /* ---- carte : les plats ---- */
    "Salade Méchouia": "Grilled Tunisian Salad",
    "Salade César": "Caesar Salad",
    "Salade Pêcheur": "Seafood Salad",
    "Carpaccio de Bœuf à l’Huile de Truffe": "Beef Carpaccio with Truffle Oil",
    "Carpaccio de Poulpe aux Baies Roses": "Octopus Carpaccio with Pink Pepper",
    "Burrata Sicilienne": "Sicilian Burrata",
    "Foie Gras de Canard & Confit de Figues": "Duck Foie Gras with Fig Jam",
    "Mozzarella Cerise, Sauce Pesto": "Cherry Mozzarella with Pesto",
    "Soupe de Poisson": "Fish Soup",
    "Brick au Thon ou aux Crevettes": "Brick with Tuna or Shrimps",
    "Friture de Camembert": "Fried Camembert",
    "Camembert au Four, Miel & Thym": "Camembert in Oven, Honey & Thyme",
    "Seiches Grillées": "Grilled Cuttlefish",
    "Calmar Doré & sa Sauce Tartare": "Fried Squid with Tartar Sauce",
    "Moules Marinières": "Mussels Marinière",
    "Crevettes à l’Ail / Croustillant aux Crevettes": "Shrimps with Garlic or Fried",
    "Ojja au Merguez": "Ojja with Sausages",
    "Ojja aux Crevettes": "Ojja with Shrimps",
    "Kamounia Poulpe & Seiches": "Cumin Sauce with Octopus and Cuttlefish",
    "Calamar Farci à la Sfaxienne": "Stuffed Squid with Traditional Sauce",
    "Couscous au Calamar Farci": "Couscous with Stuffed Squid",
    "Couscous à l’Agneau": "Couscous with Lamb",
    "Couscous Royal": "King Couscous",
    "Couscous au Poisson": "Couscous with Fish",
    "Couscous au Poulpe": "Couscous with Octopus",
    "Gargoulette Les Émirs (2 pers.)": "Gargoulette Les Émirs (2 pax)",
    "Raviolis Ricotta & Épinard": "Ravioli with Ricotta & Spinach",
    "Raviolis au Saumon Fumé": "Ravioli with Salmon",
    "Penne Sauce Rosée, Crevettes & Champignons": "Rosé Sauce Penne with Shrimps",
    "Spaghetti Bolognaise": "Bolognese Spaghetti",
    "Spaghetti aux Fruits de Mer": "Spaghetti with Seafood",
    "Tagliatelle à la Crème de Truffes Noires": "Tagliatelle with Black Truffle Cream",
    "Rigatoni aux Cèpes": "Rigatoni with Porcini Mushrooms",
    "Cordon Bleu": "Cordon Bleu",
    "Poulet à l’Indienne au Curry": "Chicken with Curry Sauce",
    "Blanc de Poulet, Sauce à l’Orange ou aux Champignons": "Chicken Breast with Mushrooms or Orange Sauce",
    "Poulet Berbère au Romarin": "Berber Chicken with Rosemary",
    "Côte à l’Os à la Plancha": "Grilled Rib Eye Steak",
    "Entrecôte Maître d’Hôtel": "Sirloin with Garlic Butter",
    "Émincé de Bœuf Stroganoff & Riz Pilaf": "Sliced Beef Stroganoff",
    "Brochettes Mixtes au Romarin": "Mixed Skewers with Rosemary",
    "Tagliata de Bœuf & Copeaux de Parmesan": "Beef Tagliata with Parmesan",
    "Médaillons de Filet de Bœuf, Duo de Sauces": "Tenderloin Slices, Varied Sauces",
    "Filet de Bœuf au Poivre ou aux Champignons de Paris": "Tenderloin with Mushrooms or Pepper",
    "Filet de Bœuf au Roquefort ou au Parmesan": "Tenderloin with Blue Cheese Sauce",
    "Filet de Bœuf aux Cèpes": "Tenderloin with Porcini Mushrooms",
    "Filet de Bœuf à la Crème de Truffes Noires": "Tenderloin with Truffle Sauce",
    "Poisson du Jour, Grillé ou au Gros Sel": "Grilled Fish of the Day",
    "Filet de Loup, Sauce Citron & Œufs de Lompe": "Sea-Bass Fillet with Lemon Sauce",
    "Filet de Reine & sa Sauce aux Fruits de Mer": "Sea-Bream Fillet with Seafood Sauce",
    "Crevettes Royales à l’Ail ou au Curry": "King Prawn",
    "Crevettes Calibre Moyen (6 pièces)": "Middle Size Shrimps (6 pieces)",
    "Langouste Grillée ou Thermidor": "Lobster, Grilled or Thermidor",
    "Émincé de Poulet Pané + Coupe de Glace": "Breaded Chicken + Ice Cream",
    "Pâtes Bolognaise + Coupe de Glace": "Bolognese Pasta + Ice Cream",
    "Nougat Glacé": "Iced Nougat",
    "Tiramisu": "Tiramisu",
    "Moelleux au Chocolat": "Chocolate Moelleux",
    "Affogato": "Affogato",
    "Coupe de Glace Mixte": "Mixed Ice Cream Cup",
    "Sorbet de Citron à la Vodka": "Lemon Sorbet with Vodka",
    "prix / 100 g": "price / 100 g",
    /* dishes added by the owner in his dashboard (suggested English, he confirms) */
    "Filet de Loup Velouté de Sauce Citron & Perles Marines": "Sea-Bass Fillet, Lemon Velouté & Sea Pearls",
    "Filet de Reine & sa Sauce Crème de Crustacés": "Sea-Bream Fillet with Shellfish Cream Sauce",
    "Œufs de Seiche Poêlés en Persillade": "Pan-Fried Cuttlefish Eggs with Garlic & Parsley",
    "Pasta Boutargue & Calamars": "Pasta with Bottarga & Squid",
    "Boutargue Façon Carpaccio et Son Bouquet de Verdure": "Bottarga Carpaccio with Fresh Greens",
    "De notre vivier de langoustes à votre assiette : l’authenticité de la mer, la fraîcheur d’exception. Choisissez votre langouste vivante, savourez l’excellence.":
      "From our lobster tank to your plate: the sea at its most honest, exceptional freshness. Pick your live lobster and enjoy — our kitchen takes care of the rest.",
    "Entrées Chaudes": "Warm Starters",
    "Spécialités Tunisiennes": "Tunisian Specialities",
    "Les Pâtes": "Pasta",
    "Volailles": "Poultry",
    "Viandes": "Meat",
    "Poissons": "Fish",
    "Poissons & Fruits de Mer": "Fish & Seafood",
    "Fruits de Mer": "Seafood",
    "Desserts": "Desserts",
    "Boissons": "Drinks",
    "Salades": "Salads",
    "Pizzas": "Pizzas",
    "À partager": "To share",
    "Pas besoin d’attendre l’heure du déjeuner ou du dîner pour se faire plaisir !": "No need to wait for lunch or dinner to treat yourself!",
    "Nos petits snacks gourmands sont là pour être partagés entre amis et accompagner vos apéros…":
      "Our tasty little snacks are made for sharing with friends and to go with your drinks…",
    "Prix en dinars tunisiens (DT), taxes comprises.":
      "Prices in Tunisian dinars (DT), taxes included.",
    "Suggestions du jour et arrivages présentés à table.":
      "Daily specials and fresh catch presented at your table.",
    "Ouverture de la carte…": "Opening the menu…",
    "Voir la carte des Émirs": "View the Les Émirs menu",
    "Chargement…": "Loading…",

    /* ---- pied de page ---- */
    "Facebook": "Facebook",
    "Horaires": "Opening hours",
    "Tous les jours · 12h — 00h, service continu": "Every day · 12pm — 12am, all-day service",
    "Tous les jours": "Every day",
    "Port El Kantaoui — face à la marina": "Port El Kantaoui — facing the marina",
    "Restaurant Les Émirs · Port El Kantaoui": "Restaurant Les Émirs · Port El Kantaoui",
    "Port El Kantaoui, Hammam Sousse, Sousse — Tunisie":
      "Port El Kantaoui, Hammam Sousse, Sousse — Tunisia",
    "Port El Kantaoui · Sousse": "Port El Kantaoui · Sousse",
    "Restaurant Les Émirs — Port El Kantaoui, Sousse":
      "Restaurant Les Émirs — Port El Kantaoui, Sousse",

    /* ---- réservation : modifier / pass ---- */
    "Modifier ma réservation": "Change my booking",
    "Votre réservation": "Your booking",

    /* ---- attributs ---- */
    "Votre nom": "Your name",
    "Prénom": "First name",
    "Votre prénom": "Your first name",
    "Écrivez-nous": "Write to us",
    "Besoin d’aide ou d’information ?": "Need help or information?",
    "Réclamation": "Complaint",
    "Nous sommes à votre écoute.": "We are listening.",
    "Votre nom de famille": "Your last name",
    "Nombre de personnes": "Number of guests",
    "Pour recevoir la confirmation et votre code": "To receive your confirmation and code",
    "Anniversaire, décoration, table calme…": "Birthday, decoration, quiet table…",
    "Pour vous répondre": "So we can reply",
    "Votre message…": "Your message…",
    "Jours précédents": "Previous days",
    "Heures précédentes": "Earlier times",
    "Photo précédente": "Previous photo",
    "Fermer la carte": "Close the menu",
    "Demande de réservation reçue": "Booking request received",
    "Les Émirs — accueil": "Les Émirs — home",
    "La terrasse des Émirs ouverte sur le port El Kantaoui":
      "The Les Émirs terrace opening onto Port El Kantaoui",
    "Emplacement du Restaurant Les Émirs à Port El Kantaoui":
      "Location of Restaurant Les Émirs in Port El Kantaoui",

    /* ---- titres de page ---- */
    "Les Emirs - Restaurant, Port El Kantaoui": "Les Emirs - Restaurant, Port El Kantaoui",
    "Apéros, déjeuners, dîners... et vibes chill au coeur de Port El Kantaoui. L'art de recevoir, au bord du port, face à la méditerranée...":
      "Aperitifs, lunches, dinners... and chill vibes in the heart of Port El Kantaoui. The art of hosting, by the harbour, facing the Mediterranean Sea...",
    "La Carte — Les Émirs · Port El Kantaoui": "Menu — Les Émirs · Port El Kantaoui",
    "La carte du Restaurant Les Émirs, Port El Kantaoui : entrées, spécialités tunisiennes, pâtes, viandes, poissons et desserts.":
      "The menu of Restaurant Les Émirs, Port El Kantaoui: starters, Tunisian specialities, pasta, meat, fish and desserts.",
    "Modifier ma réservation — Les Émirs": "Change my booking — Les Émirs",
    "Votre réservation — Les Émirs": "Your booking — Les Émirs",
    "Les Émirs — Restaurant & bar avec vue sur la marina à Port El Kantaoui, Sousse : cuisine tunisienne, fruits de mer et grillades, terrasse face à la mer, apéros et soirées live.":
      "Les Émirs — Restaurant & bar overlooking the marina in Port El Kantaoui, Sousse: Tunisian cuisine, seafood and grills, seafront terrace, drinks and live nights."
  };

  /* French month abbreviations as the date chips print them */
  var MON = { "janv.": "Jan", "févr.": "Feb", "mars": "Mar", "avr.": "Apr", "mai": "May",
              "juin": "Jun", "juil.": "Jul", "août": "Aug", "sept.": "Sep", "oct.": "Oct",
              "nov.": "Nov", "déc.": "Dec" };

  /* patterns for the strings that carry a name, a number or a date */
  var RX = [
    [/^(\d{1,2}) (janv\.|févr\.|mars|avr\.|mai|juin|juil\.|août|sept\.|oct\.|nov\.|déc\.)$/,
      function (m) { return MON[m[2]] + " " + m[1]; }],
    [/^(\d{1,2})h(\d{2})$/, function (m) { return m[1] + ":" + m[2]; }],
    [/^Merci (.*?) — demande reçue\. Référence :\s*$/,
      function (m) { return "Thank you " + m[1] + " — request received. Reference: "; }],
    [/^Merci Mr\/Mme\s*$/, function () { return "Thank you "; }],
    [/^Merci Mr\/Mme (.+)$/, function (m) { return "Thank you " + m[1]; }],
    [/^(\d+) couverts? · (Terrasse verrière|Terrasse en plein air|Terrasse|Salle intérieure)$/, function (m) {
      return m[1] + (m[1] === "1" ? " guest · " : " guests · ") + DICT[m[2]];
    }],
    [/^(Janvier|Février|Mars|Avril|Mai|Juin|Juillet|Août|Septembre|Octobre|Novembre|Décembre) (\d{4})$/,
      function (m) { return DICT[m[1]] + " " + m[2]; }],
    [/^Agrandir : (.+)$/, function (m) { var c = DICT[m[1]]; return c ? "Enlarge: " + c : undefined; }],
    [/^(\d+) personnes?$/, function (m) { return m[1] + (m[1] === "1" ? " guest" : " guests"); }],
    [/^Table pour (\d+)$/, function (m) { return "Table for " + m[1]; }]
  ];

  /* one key per sentence: line breaks inside a paragraph must not split it */
  var norm = function (s) { return s.replace(/ /g, " ").replace(/\s+/g, " ").trim(); };

  function translate(s) {
    if (!s) return null;
    var key = norm(s);
    if (!key) return null;
    var hit = DICT[key];
    if (hit === undefined) {
      for (var i = 0; i < RX.length; i++) {
        var m = key.match(RX[i][0]);
        if (m) { hit = RX[i][1](m); break; }
      }
    }
    if (hit === undefined || hit === null || hit === key) return null;
    /* keep the original leading/trailing whitespace so inline layout is unchanged */
    var lead = s.match(/^\s*/)[0], tail = s.match(/\s*$/)[0];
    return lead + hit + tail;
  }

  var ATTRS = ["placeholder", "title", "aria-label", "alt", "value"];

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { var r = translate(root.nodeValue); if (r !== null) root.nodeValue = r; return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), n, nodes = [];
    while ((n = w.nextNode())) nodes.push(n);
    nodes.forEach(function (t) {
      var p = t.parentNode;
      if (!p || p.nodeName === "SCRIPT" || p.nodeName === "STYLE" || p.closest("[data-no-i18n]")) return;
      var r = translate(t.nodeValue);
      if (r !== null) t.nodeValue = r;
    });
    var els = root.querySelectorAll ? root.querySelectorAll("*") : [];
    [].forEach.call(els, function (el) {
      ATTRS.forEach(function (a) {
        if (!el.hasAttribute(a)) return;
        /* never rewrite what the guest typed, or a form value the server reads */
        if (a === "value" && el.tagName !== "BUTTON") return;
        var r = translate(el.getAttribute(a));
        if (r !== null) el.setAttribute(a, r);
      });
    });
  }

  /* English is ON: the owner sent his English texts (Nov 2026). false hides the
     FR | EN switch and ?lang=en again. */
  var ENABLED = true;

  /* the MENU alone can always be read in English (the rest of the site follows
     ENABLED): the menu window calls this on itself */
  window.emirsTranslate = function (root) { walk(root); };
  /* one string, for the dashboard's menu editor: "" when there is no translation */
  window.emirsT = function (s) {
    var hit = DICT[norm(s || "")];                 /* same word in both languages counts too (Tiramisu) */
    if (hit !== undefined) return hit;
    var r = translate(s); return r === null ? "" : r.trim();
  };

  /* ---- language choice ---- */
  if (!ENABLED) {
    try { localStorage.removeItem("emirs_lang"); } catch (e) {}
    window.EMIRS_LANG = "fr";
    return;
  }
  var qs = null;
  try { qs = new URLSearchParams(location.search).get("lang"); } catch (e) {}
  var stored = null;
  try { stored = localStorage.getItem("emirs_lang"); } catch (e) {}
  var lang = (qs === "en" || qs === "fr") ? qs : (stored === "en" ? "en" : "fr");
  if (qs === "en" || qs === "fr") { try { localStorage.setItem("emirs_lang", lang); } catch (e) {} }
  window.EMIRS_LANG = lang;

  /* FR|EN switch — a plain link per language, so each one is a normal page load
     and nothing has to be translated back */
  function mount() {
    if (document.getElementById("langSwitch")) return;
    var base = location.pathname + (location.hash || "");
    var box = document.createElement("div");
    box.id = "langSwitch";
    box.setAttribute("data-no-i18n", "");
    box.innerHTML = '<a href="' + base.replace(/#.*$/, "") + '?lang=fr' + (location.hash || "") + '"' +
        (lang === "fr" ? ' class="on" aria-current="true"' : "") + ' hreflang="fr">FR</a>' +
      '<a href="' + base.replace(/#.*$/, "") + '?lang=en' + (location.hash || "") + '"' +
        (lang === "en" ? ' class="on" aria-current="true"' : "") + ' hreflang="en">EN</a>';
    var css = document.createElement("style");
    css.textContent =
      "#langSwitch{display:inline-flex;align-items:center;gap:2px;margin-left:14px;font:600 11px/1 system-ui,sans-serif;" +
      "letter-spacing:.08em;vertical-align:middle;color:#f2ece0}" +
      /* the header sits on the photo until it turns solid — follow it, like the burger does */
      ".nav.solid #langSwitch{color:#17150f}" +
      "#langSwitch a{display:inline-block;padding:6px 8px;border-radius:100px;color:inherit;text-decoration:none;opacity:.6}" +
      "#langSwitch a.on{opacity:1;background:rgba(255,255,255,.14);outline:1px solid currentColor}" +
      "#langSwitch a:hover{opacity:1}" +
      "@media(max-width:900px){#langSwitch{margin:0 6px 0 auto}#langSwitch a{padding:6px 7px}" +
      /* a phone header is tight: show only the language you can switch to */
      "#langSwitch a.on{display:none}#langSwitch a{opacity:1;outline:1px solid currentColor}}";
    document.head.appendChild(css);
    /* the header bar itself, never the desktop link list: on a phone that list
       is hidden behind the burger, and a child of a hidden element never shows */
    var bar = document.querySelector(".nav__in") || document.querySelector("header") || document.body;
    if (bar === document.body) {
      box.style.position = "fixed"; box.style.top = "14px"; box.style.right = "14px"; box.style.zIndex = "60";
      box.style.background = "rgba(20,18,14,.55)"; box.style.borderRadius = "100px"; box.style.color = "#fff";
    }
    var burger = bar.querySelector ? bar.querySelector(".burger, #burger") : null;
    if (burger) bar.insertBefore(box, burger); else bar.appendChild(box);
  }

  function start() {
    mount();
    if (lang !== "en") return;
    document.documentElement.lang = "en";
    walk(document.body);
    var head = translate(document.title);
    if (head !== null) document.title = head;
    var md = document.querySelector('meta[name="description"]');
    if (md) { var d = translate(md.getAttribute("content")); if (d !== null) md.setAttribute("content", d); }
    /* the page renders the menu, the date chips and the confirmations after
       load — translate whatever appears next */
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        [].forEach.call(m.addedNodes, walk);
        if (m.type === "characterData") walk(m.target);
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
