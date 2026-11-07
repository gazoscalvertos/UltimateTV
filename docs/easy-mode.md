# Easy mode and the first-time tour

For people who just want to watch (issue #229).

## Easy mode

A profile setting. Turn it on in **Settings › Profiles and PIN › [a profile] › Easy mode**, or on the phone's setup page (`/setup/`) under the profile.

With Easy mode on, that profile gets:

- **Home with four big tiles:** Watch TV (the guide), Films and TV (a Films / TV shows choice, or straight there if only one is on), Recordings and Search. Under them, Continue watching. Nothing else.
- **A short menu along the top:** Home, TV Guide, Films, TV Shows and Recordings. No Music, Cast & games, Downloaded, weather chip or Settings.
- **No Settings:** every route to it is refused, from the menu, a phone or a shortcut, with a note saying why.
- Every screen is one press from Home (two for Films or TV shows).

The tiles follow Features per screen and a Guest's sections: a tile for something switched off isn't shown.

To get out of Easy mode, pick another profile (the avatar at the top right) and switch it off in that profile's Settings, or use the phone's setup page. So a visitor who is handed an Easy profile cannot wander into Settings.

## The first-time tour

About a minute, seven screens, one idea each: welcome, the arrows and OK, Back, Home, the colour keys, Info, and done. The remote is drawn with the button being talked about lit. **Back skips it** at any point, and skipping counts as seen.

- Shown once for each profile, the first time it is picked (not for a Guest, which keeps nothing).
- Remembered on the Hub (`POST /api/profiles/me/toured`, which any profile may call for itself and only ever sets that flag), so every screen and app agrees.
- Replay it any time: **Info › Show me around**.

## For the WAF test (#91)

Switch Easy mode on and off for the same profile to compare: same Home content, but four targets instead of a screen of rails.

Untested on hardware (like the rest of the build): checked with the type check and the profile tests only.
