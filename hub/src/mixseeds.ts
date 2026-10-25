// The music video channels a new Hub starts with. Each names about forty tracks, more than the
// thirty it keeps, because some only exist in SD on YouTube and are skipped; the searches fill
// any gap. Change them on the TV (Settings › Music channels) or through /api/mix-channels.

import type { MixChannel } from "@ultimatetv/shared";

export type MixSeed = Pick<MixChannel, "name" | "brief" | "picks" | "queries" | "colour"> & Partial<Pick<MixChannel, "exclude" | "number">>;

export const MIX_SEEDS: MixSeed[] = [
  {
    name: "Clubland TV",
    number: 390,
    colour: "#e0218a",
    brief: "UK club anthems and Eurodance from the Clubland era: hands-up, bouncy trance and big vocal dance hits, mostly 1998 to 2012",
    picks: [
      "Cascada - Everytime We Touch", "Cascada - Evacuate the Dancefloor", "Ultrabeat - Pretty Green Eyes", "Basshunter - Now You're Gone",
      "Basshunter - All I Ever Wanted", "Scooter - Nessaja", "Alice Deejay - Better Off Alone", "Darude - Sandstorm", "ATB - 9 PM (Till I Come)",
      "Lasgo - Something", "DJ Sammy - Heaven", "Ian Van Dahl - Castles in the Sky", "Sash! - Ecuador", "Fragma - Toca's Miracle",
      "September - Cry for You", "Agnes - Release Me", "Inna - Hot", "Global Deejays - The Sound of San Francisco", "Kate Ryan - Désenchantée",
      "Milk Inc - In My Eyes", "Special D - Come with Me", "N-Trance - Set You Free", "Uniting Nations - Out of Touch", "Sonique - It Feels So Good",
      "Love Inc - You're a Superstar", "Starchaser - Love Will Set You Free", "Example - Changed the Way You Kiss Me", "Wiley - Heatwave",
      "Dizzee Rascal & Armand van Helden - Bonkers", "Calvin Harris - Acceptable in the 80s", "Avicii - Levels", "Swedish House Mafia - Don't You Worry Child",
      "David Guetta - Titanium", "Sigma - Nobody to Love", "Eric Prydz - Call On Me", "Groove Coverage - God Is a Girl", "Brooklyn Bounce - Get Ready to Bounce",
      "Kelly Llorenna - Tell It to My Heart", "Dario G - Sunchyme", "Robert Miles - Children",
    ],
    queries: ["clubland anthem official music video", "eurodance official music video", "uk vocal dance hit official video"],
  },
  {
    name: "House TV",
    number: 391,
    colour: "#1f8ef1",
    brief: "House music, from classic piano and vocal house to French touch, UK garage-tinged and modern house hits",
    picks: [
      "Stardust - Music Sounds Better With You", "Daft Punk - One More Time", "Daft Punk - Around the World", "Robin S - Show Me Love",
      "Crystal Waters - Gypsy Woman (She's Homeless)", "Black Box - Ride on Time", "CeCe Peniston - Finally", "Armand van Helden - You Don't Know Me",
      "Basement Jaxx - Where's Your Head At", "Basement Jaxx - Romeo", "Fatboy Slim - Praise You", "Benny Benassi - Satisfaction",
      "Bob Sinclar - Love Generation", "Shapeshifters - Lola's Theme", "Disclosure - Latch", "Disclosure - White Noise", "Duke Dumont - Need U (100%)",
      "Duke Dumont - Ocean Drive", "Gorgon City - Ready for Your Love", "MK - 17", "Fisher - Losing It", "Calvin Harris - Feel So Close",
      "Peggy Gou - (It Goes Like) Nanana", "Purple Disco Machine - Hypnotized", "Sigala - Easy Love", "Route 94 - My Love",
      "Kungs vs Cookin' on 3 Burners - This Girl", "Jax Jones - You Don't Know Me", "Martin Solveig - Hello", "Roger Sanchez - Another Chance",
      "Modjo - Lady (Hear Me Tonight)", "Spiller - Groovejet (If This Ain't Love)", "Moloko - Sing It Back", "Storm Queen - Look Right Through",
      "Joel Corry - Head & Heart", "Riton x Nightcrawlers - Friday", "Becky Hill & David Guetta - Remember", "CamelPhat & Elderbrook - Cola",
      "Felix Jaehn - Ain't Nobody (Loves Me Better)", "Fred again.. - Delilah (pull me out of this)",
    ],
    queries: ["house music official music video", "vocal house official video", "deep house official music video"],
  },
  {
    name: "Halloween TV",
    number: 392,
    colour: "#f07b16",
    brief: "Spooky and Halloween music videos: monsters, ghosts, horror-film looks and dark pop and rock, fine for a family party",
    picks: [
      "Michael Jackson - Thriller", "Ray Parker Jr. - Ghostbusters", "Bobby Pickett - Monster Mash", "The Rocky Horror Picture Show - Time Warp",
      "Rockwell - Somebody's Watching Me", "Oingo Boingo - Dead Man's Party", "Marilyn Manson - This Is Halloween", "Rob Zombie - Dragula",
      "Rihanna - Disturbia", "Billie Eilish - bury a friend", "Lady Gaga - Bloody Mary", "Siouxsie and the Banshees - Spellbound",
      "Blue Öyster Cult - (Don't Fear) The Reaper", "Warren Zevon - Werewolves of London", "Talking Heads - Psycho Killer", "The Specials - Ghost Town",
      "Alice Cooper - Feed My Frankenstein", "Ozzy Osbourne - Bark at the Moon", "Imagine Dragons - Demons", "Katy Perry - Dark Horse",
      "Bonnie Tyler - Total Eclipse of the Heart", "Meat Loaf - I'd Do Anything for Love", "Kate Bush - Wuthering Heights",
      "Echo & the Bunnymen - The Killing Moon", "The Cure - Lullaby", "Gorillaz - Clint Eastwood", "The Cranberries - Zombie",
      "Duran Duran - Hungry Like the Wolf", "Eurythmics - Sweet Dreams (Are Made of This)", "Metallica - Enter Sandman",
      "Yeah Yeah Yeahs - Heads Will Roll", "My Chemical Romance - Welcome to the Black Parade", "Creedence Clearwater Revival - Bad Moon Rising",
      "Shakespears Sister - Stay", "Concrete Blonde - Bloodletting (The Vampire Song)", "Mike Oldfield - Tubular Bells", "Michael Jackson - Ghosts",
      "Busta Rhymes - Gimme Some More", "Lorde - Everybody Wants to Rule the World", "Alice Cooper - Poison",
    ],
    queries: ["halloween song official music video", "spooky official music video"],
  },
];
