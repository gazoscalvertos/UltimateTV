# Profiles and the Kids lock

The TV starts with two profiles, **Family** (adult) and **Kids**. Add, rename or remove them in **Settings › Profiles and PIN**.

## What Kids can see

- **Channels:** only channels in kids' categories (CBBC, CBeebies and the like, from the IPTV playlist's groups). Others are hidden from the guide, Home, search and channel numbers, and can't be tuned.
- **Films and TV:** only titles rated up to the profile's limit (PG by default, and anything up to 15 in the profile's options). Titles with no rating are shown only if their genres include Kids or Family. Jellyfin titles use Jellyfin's own parental rating.
- **No settings, no deleting recordings, no downloads, no series link changes.** The Hub refuses these for a Kids profile even if someone tries from a browser.

## TV time and bedtime

Each Kids profile can have a daily allowance and a bedtime: **Settings › Profiles and PIN › Kids ›
TV time and bedtime** on the TV, or the Kids profile under Profiles on the phone's setup page.

- **Each day:** no limit, or 30 minutes to 4 hours. Time counts only while something plays on
  that profile (paused doesn't count), and starts again at midnight. Watching on two screens at
  once on the same profile counts once.
- **Bedtime:** one for Sunday to Thursday nights and one for Friday and Saturday nights, 18:00 to
  23:00 or none. Bedtime lasts until 6 in the morning.
- **Warnings:** a card says "5 more minutes" and "2 more minutes" before whichever comes first.
- **When time's up** what's on may finish (the episode, the film, or the programme on live TV),
  for 30 minutes at most. Nothing new starts: the next episode, another channel or a new film is
  refused. Then the sound fades and the TV goes back to **Who's watching?**.
- **More time:** pick the Kids profile again and an adult's PIN gives 15, 30 or 60 more minutes, or
  no limits until 6 the next morning. On the setup page the same buttons are under the profile,
  with how long has been watched today.
- **Tell my phone when time's up** sends a message to wherever Settings › Alerts sends (Home
  Assistant or ntfy), once each time.

![TV time and bedtime in Settings](screenshots/kids-time-settings.png)
![Asking for more time at bedtime](screenshots/kids-time-up.png)

The Hub keeps the count and refuses to start anything on a Kids profile whose time is up, so a
browser or the Android app can't get round it (the Android app warns and closes its player too).
Bedtime goes by the Hub's clock. Two things to know:

- **Set an adult PIN.** Without one anyone can switch to Family, and more time needs no PIN.
- The allowance is counted from the TV's and the Android app's "still playing" reports every half
  minute. A download played on the phone away from the home Wi-Fi isn't counted, and something
  already playing in a browser isn't cut off by the Hub (it just can't start the next thing).

## Favourites

Each profile has its own favourite films, TV shows and guide channels. Starring something on one
profile doesn't change another's.

| Where | How |
| --- | --- |
| A film's or show's page | **Blue**, or the **Add to Favourites** button (a filled heart once it's a favourite) |
| Watching a film or episode | **Green**, or Options (Yellow) › Favourites |
| Live TV | **Green** stars the channel on the banner |
| TV Guide | **Hold OK** for about a second on a channel, or Info › *Add BBC One to Favourites* |
| Phone remote | The **♡ Add to Favourites** button on a film's sheet and a channel's sheet. It stars it on the profile the TV is on |
| Android app | The heart on a title's page and beside each channel in the guide |

What follows the profile watching:

- The guide's **Favourites** list (and its count) is that profile's channels, and so is the **Live
  now** row on Home, which leads with them.
- A **Favourites** row on Home, after Saved for later.
- Films and TV Shows have **Everything / Favourites** chips at the top; Favourites shows just that
  profile's films or shows. The Android app has the same chips under Films & TV.
- Kids can only star what their profile is allowed to watch.

When favourites became per profile, every profile that existed got a copy of the household's
favourite channels, so nothing was lost. A profile made after that starts with none. With no
profile chosen (the phone's settings page, Guide lists and channels), the star is still the
household's own and only changes what shows with no profile. Favourites live in the Hub's database,
so the nightly backup keeps them; deleting a profile deletes its favourites.

![A film's page with its Favourite button](screenshots/favourites-details.png)
![The guide's Favourites list, with a heart beside each starred channel](screenshots/favourites-guide.png)

## Custom guides

Above the TV Guide's grid are the channel lists: all channels, favourites, your custom guides and
each category. Press Up from the top row to pick one, or Blue to step through them.

- **New guide** builds one: OK on a channel on the left adds or removes it; on the right, OK picks
  a channel up so Up and Down move it, and Red takes it out. Blue changes the category on the
  left, Yellow adds everything it shows, and the number keys jump to a channel.
- **Make default** saves the list you're on as the one this profile's guide opens on. Each profile
  keeps its own, Kids included.
- The phone settings page (Guide lists and channels) does all of this too, and also sets the
  order of the lists, every channel's number and category, and the household's favourites (used
  when no profile is chosen; each profile has its own, see [Favourites](#favourites)).
- Custom guides are shared by the household; only adults can build, change or delete them. A Kids
  profile only sees the kids' channels in them.

## The PIN

Set a 4-digit PIN on the adult profile (**Settings › Profiles and PIN › Family › Set a PIN**). Then:

- Switching from Kids to an adult profile asks for the PIN.
- Once any adult profile has a PIN, every adult profile needs one. An adult profile without its own PIN takes the household PIN (the first one set).
- The setup page asks for the PIN before it changes anything.
- When the TV is turned on, it goes to the profile picker if a PIN is set, so the TV is never left on an adult profile.
- Five wrong PINs lock that profile out for a minute, and each further wrong try doubles the wait up to an hour. The count is kept per profile and per device (or address), survives a Hub restart, and is forgotten after an hour without a wrong try or as soon as the right PIN goes in. The TV and the phone show "Too many tries, wait N minutes" while it lasts.

Forgotten the PIN? On the Hub, run `docker compose exec hub node hub/dist/reset-pins.js`, which clears every PIN and any lockout.
