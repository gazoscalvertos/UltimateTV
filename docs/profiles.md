# Profiles and the Kids lock

The TV starts with two profiles, **Family** (adult) and **Kids**. Add, rename or remove them in **Settings › Profiles and PIN**.

## What Kids can see

- **Channels:** only channels in kids' categories (CBBC, CBeebies and the like, from the IPTV playlist's groups). Others are hidden from the guide, Home, search and channel numbers, and can't be tuned.
- **Films and TV:** only titles rated up to the profile's limit (PG by default, and anything up to 15 in the profile's options). Titles with no rating are shown only if their genres include Kids or Family. Jellyfin titles use Jellyfin's own parental rating.
- **No settings, no deleting recordings, no downloads, no series link changes.** The Hub refuses these for a Kids profile even if someone tries from a browser.

## Custom guides

Above the TV Guide's grid are the channel lists: all channels, favourites, your custom guides and
each category. Press Up from the top row to pick one, or Blue to step through them.

- **New guide** builds one: OK on a channel on the left adds or removes it; on the right, OK picks
  a channel up so Up and Down move it, and Red takes it out. Blue changes the category on the
  left, Yellow adds everything it shows, and the number keys jump to a channel.
- **Make default** saves the list you're on as the one this profile's guide opens on. Each profile
  keeps its own, Kids included.
- Custom guides are shared by the household; only adults can build, change or delete them. A Kids
  profile only sees the kids' channels in them.

## The PIN

Set a 4-digit PIN on the adult profile (**Settings › Profiles and PIN › Family › Set a PIN**). Then:

- Switching from Kids to an adult profile asks for the PIN.
- Once any adult profile has a PIN, every adult profile needs one. An adult profile without its own PIN takes the household PIN (the first one set).
- The setup page asks for the PIN before it changes anything.
- When the TV is turned on, it goes to the profile picker if a PIN is set, so the TV is never left on an adult profile.

Forgotten the PIN? On the Hub, run `docker compose exec hub node hub/dist/reset-pins.js`, which clears every PIN.
