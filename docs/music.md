# Music: Spotify, Deezer, radio and podcasts

The **Music** tab on the TV plays Spotify and Deezer through the TV's speakers, and plays UK radio stations and podcasts. What's playing sits at the top with its controls; below are the radio stations, your podcasts, the music services, then your Spotify playlists, albums and artists. Play/Pause on the remote works from any screen while any of it plays, and starting a film pauses it.

Kids profiles have the Music tab too, but only the radio stations meant for children (Fun Kids and Fun Kids Junior), the podcasts the household follows, and no Spotify or Deezer: the grown-ups' accounts aren't theirs to use. The Hub sends a Kids profile only the stations marked for children, so the list can't be got at with the phone remote either.

![The Music tab before Spotify is signed in](screenshots/31-music-spotify-sign-in.png)

## First time: sign in

Update the box first (Settings › About › Update the box), so it has the Spotify receiver and the latest sign-in screens. Then open the Music tab on the TV, or **Watch › Music** on the phone remote. Both show what still needs doing.

### Spotify (needs Premium)

The TV is a Spotify Connect speaker, like a smart speaker. To sign it in:

1. On a phone on the home Wi-Fi, open the Spotify app (the QR code on the TV opens it).
2. Play any song, then tap the devices button (the little speaker and screen) at the bottom of the player.
3. Pick **UltimateTV** (or whatever the app is called in Settings).

The music moves to the TV, and the TV remembers the account: your playlists, albums and artists appear in the Music tab, and the TV stays signed in after a restart. Anyone else at home can pick the TV from their own Spotify app as well; the TV then plays from their account until someone else picks it.

**The TV isn't in the devices list?** Choose **Not listed? Sign in with a code** under the instructions on the TV (or on the phone's Music page). The TV then shows a code: go to spotify.com/pair on any phone or computer (or scan the QR code), sign in, and enter it. Once you're signed in, the TV makes itself visible to phones again by itself.

![Signing in to Spotify with a code](screenshots/31-music-spotify-code.png)

### Deezer

Deezer has no app for the box, so the TV opens Deezer's own website player over the TV app.

1. Scan the **Log in to Deezer** QR code in Music services with your phone.
2. Type your Deezer email and password there and press **Log in on the TV**.
3. The TV opens Deezer and fills in its login. The phone says how it went: logged in, what Deezer said if it said no (a wrong password, say), or that Deezer wants something more on the TV, such as an "I'm not a robot" puzzle or a code it emailed you. Do that part on the TV: the arrows and OK work on the page, and the phone remote's keyboard types into it.

**Signed up to Deezer with Google, Apple or Facebook?** Those logins don't work on the TV (Google blocks sign-in inside apps). Give your Deezer account a password first: on deezer.com choose **Log in › Forgot your password?**, enter the email of your Google, Apple or Facebook account, and set a password from the email Deezer sends. Then log in on the TV with that email and password.

## Playing

- **Spotify**: pick a playlist, album or artist in the Music tab (or on the phone's Music page) and press Play or Shuffle, or pick a song. Or play from the Spotify app on your phone and choose the TV as the device. Next and previous are the remote's fast-forward and rewind keys.
- **Deezer**: press the Deezer card. Use the arrows and OK on the page (a blue outline shows where you are). Back returns to the TV app and the music keeps playing; it shows in Now Playing with play/pause and skip.
- Spotify and Deezer pause each other: only one plays at a time.
- **Radio**: pick a station under **Radio** and it plays through the TV. Each station shows what it's playing where its stream says (classic FM, Heart, Smooth, Radio X, Radio Paradise and the commercial stations do; the BBC's streams don't, so they show the station only). Pause and play with the remote. The same list is on the phone remote under **Watch › Radio**.
- **Podcasts**: add one by searching for it or pasting its feed address under **Podcasts**. A show you follow arrives with new episodes marked, and an episode you're part way through starts where you left off; back out of it (or pause) and the place is kept.
- **From any screen**: while music, the radio or a podcast plays, a small chip at the top right of every screen but the Music tab names what's playing and has a pause/play button. Its name opens the Music tab. The remote's Play/Pause key does the same from anywhere.

**Adding a station of your own**: **Add a station** under Radio asks for a name and the stream address (the `http://` or `https://` address the station publishes; most have one for apps). It's kept on the Hub, so it's there on every screen and on the phone.

## Changing how radio behaves

**Settings › Radio and podcasts** on the TV (or **Radio** on the setup page) has five choices. They're kept on the Hub, so they apply to every screen:

| Setting | What it does |
|---|---|
| Keep the screen awake | The screensaver normally comes on while the radio plays, with the station named on it. This keeps the picture up instead. |
| Name the station on the screensaver | Leave the station off the screensaver's clock, if you'd rather it just told the time. |
| Say what's playing | The Hub asks each station for the current song every so often. Off means the TV shows only the station's name, and the Hub opens no streams in the background. |
| Podcasts on the Music tab | Hide the podcasts from the Music tab for a household that only wants the radio. Your followed shows are kept; they just aren't listed. |
| Station order | **As they come** is the built-in running order (BBC first, then the commercial stations, then Fun Kids). **Yours first** puts the stations you added on top. **By name** sorts the lot alphabetically, with the children's stations kept together at the top. |

## When something's wrong

| The TV says | What to do |
|---|---|
| Spotify isn't on this box yet | Update the box (Settings › About). The update builds the Spotify receiver; it takes a few minutes the first time. |
| Spotify is starting… | Normal for a few seconds after the box starts. |
| Spotify isn't starting, with a message from the box | Press **Restart Spotify**. If it keeps failing, the message says why; more is in the box's log (below). |
| The TV isn't in Spotify's devices list | Check the phone is on the home Wi-Fi (not mobile data), or sign in with a code instead. |
| Deezer didn't take that login | The phone shows what Deezer said. Check the password works on deezer.com, or set one (see above). |
| Deezer wants something more | Finish on the TV with the remote; the phone remote's keyboard types into the page. |
| That doesn't look like a stream address | The address must start with `http://` or `https://`. Copy the one the station gives out for apps, not its web page. |
| That address isn't a podcast feed | Paste the show's **RSS** feed (its own address, usually ending `.xml`, `.rss` or `/feed`), not the page you read it on. |
| The feed answered 404 | The show moved or stopped publishing. Search for it again by name. |
| That feed has no episodes in it | The feed is empty or is only a trailer feed; try the show's main feed. |
| A station won't play | Its stream may be geoblocked or gone. Try the station's own app to check, then remove it with **Remove** in its menu. |

On the box, the Spotify receiver's state and log:

```
systemctl --user -M tv@ status ultimatetv-spotify
journalctl --user -M tv@ -u ultimatetv-spotify -n 50
```

The box also writes what the Spotify receiver says is wrong into its diagnostics report on the Hub (`/api/diagnostics?format=text`, see [diagnostics.md](diagnostics.md)).

## How it works

| Part | |
|---|---|
| Spotify receiver | [go-librespot](https://github.com/devgianlu/go-librespot), built by `tools/box/install.sh` and run as the `ultimatetv-spotify` user service of the tv user. It plays through PipeWire to the TV's HDMI output and answers a local API on `127.0.0.1:3678`. |
| Its config | `~tv/.config/go-librespot/config.yml`, written from `tools/box/files/go-librespot.yml` on each box update (the device name is kept). The sign-in is kept in `state.json` beside it. |
| Signing in | By default Spotify Connect's own sign-in (`credentials: zeroconf` with `persist_credentials`), so picking the TV in the Spotify app signs it in and that account is kept. **Sign in with a code** switches the config to `device_auth` with phones turned off (go-librespot can't answer its API while it waits for a code with both on), restarts it, and switches back once signed in. `box/src/spotify.ts` does this. |
| `box/src/spotify.ts` | Reads the receiver's status, the sign-in code, its library and track lists; sends play and control commands. When the receiver doesn't answer it tells "not installed" from "not running", and reads the reason from its log. |
| `box/src/webapp.ts` | Deezer's web player in its own browser profile (the login lasts), the phone login (fills Deezer's form one step at a time, accepts a cookie banner in the way, then watches for the sign-in cookie or Deezer's error), and the remote's keys on the page (`webapp-preload.ts`). |
| `hub/src/musiclogin.ts` | The phone page `/music-login/`. What's typed is kept in memory for two minutes and handed to the TV once; the TV reports back how it went (`POST /api/music/login/:id/result`) and the phone page shows that (`GET /api/music/login/:id/status`). Nothing is written to disk or logged. |
| `ui/src/screens/Music.tsx` | The Music tab, with the sign-in panel and the service cards. |
| `ui/src/screens/Radio.tsx`, `ui/src/radio.ts` | The radio and podcast parts of the Music tab, the podcast show screen, and the small store behind them (which station or episode is on, and saving the place in an episode). |
| `hub/src/radio.ts` | The station list (the presets that ship, plus any added here), the Kids subset, and **now playing**: it opens the stream with `Icy-MetaData: 1`, reads `icy-metaint` and picks `StreamTitle` out of the metadata. Stations that don't answer that just have no now-playing line. |
| `hub/src/podcastfeed.ts`, `hub/src/podcasts.ts` | Reading podcast feeds with `sax` (RSS and Atom, `<enclosure>`/`media:content` for the audio, `itunes:duration`, CDATA descriptions), searching iTunes for new shows, and storing the shows, episodes and where you are in each episode. Feeds are re-read every 30 minutes, so a new-episode badge appears without opening the show. |
| `hub/src/radioroutes.ts` | `/api/radio` and `/api/podcasts`, and the two that turn a station or an episode into a `PlaybackInfo` the player already understands. |
| Phone remote | Watch › Music asks the TV app (`/api/tv/call/musicStatus`, `musicSetup`, `musicLibrary`, `musicTracks`, `musicPlay`, `musicControl`). Watch › Radio lists the Hub's stations (`/api/radio`, and `/now` for each) and starts one with `/api/tv/call/radio`, as it does for everything else it starts on the TV. |
| Voice | "play Radio 2", "put on Classic FM", "tune to Radio 4". `hub/src/voice.ts` matches the words against the station names; the TV starts the station when it hears `remote.radio`. |

Deezer's developer API is closed to new apps, so there's no Deezer library in the TV's own screens: Deezer is its web player. Unofficial Deezer clients that sign in with a copied cookie were left out, because they're against Deezer's terms.
