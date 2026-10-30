# Testing it end to end

Everything is built ahead of testing on the real hardware. This is the order to test it in, from the Hub to the sofa. Note anything that fails and the step number.

## 1. Hub (Docker LXC 107)

1. `bash /containers/UltimateTV/tools/hub/update.sh` (pulls, rebuilds and checks the Hub is up)
2. Open `http://192.168.0.19:8095/api/health`: it should say ok.
3. Open `http://192.168.0.19:8095/setup/` on your phone. Add the IPTV login (Xtream or M3U plus EPG URL), then **Refresh**. Channels and the guide should fill within a minute or two.
4. Add Jellyfin (Quick Connect), AIOStreams (the manifest URL) and TorBox (the API key).
5. Open `http://192.168.0.19:8095/app/` in Chrome on a laptop. This is the TV app, with the keyboard as the remote; video that Chrome can't play shows artwork instead.

## 2. Box (before the CEC adapter)

1. Install Arch and run the installer ([box-install.md](box-install.md)), then reboot.
2. It should boot straight to **Who's watching?** with no desktop in sight. Time it: the target is under 15 seconds.
3. With a USB keyboard or the phone remote, pick Family and check:
   - Live TV: OK on a channel, change channels with PageUp/PageDown and digits, the banner shows now and next, Back closes it.
   - The guide's preview window shows the video in the top left.
   - Pause live TV for a minute, then press play: it carries on from where it paused.
   - A 4K HDR film: the TV shows its HDR badge. A 24p film: the TV's info shows 24 Hz.
   - A film with Dolby Digital Plus: the TV's sound info shows Dolby (Atmos if the file has it).
   - Subtitles and audio tracks from the yellow key in the player.

## 3. Phone remote

1. Settings › Phones and remotes: scan the code with the phone's camera. The remote opens and pairs (the phone appears in the TV's list). Arrows, OK, Back, colour keys, numbers and typing in Search should all work.
2. Install the Android app ([phone-remote.md](phone-remote.md)) and tap **Scan the TV's code**. Volume up and down should change channel.
   Turn the phone sideways (rotation lock off): the remote turns with it, every key fits on screen, and the d-pad still works; open 123 and check the numbers fit too. Same in the web remote added to the Home screen.
3. Pairing ([pairing.md](pairing.md)): a phone that hasn't paired (a private browser tab) gets the pairing screen and can't press keys. Remove the phone on the TV: its next key press brings the pairing screen back. A pop-up from Home Assistant without the API key is refused; with it, it shows.

## 4. Recording and series link

1. In the guide, press red on something starting soon and choose **Just this episode**. It should appear in Recordings › Coming up, then record, then play from Recorded.
2. Set a series link on a daily programme. Next day, Recordings › Series links should show the next episodes scheduled.
3. Record two things on at the same time while watching a third channel: the app should warn about the connection limit and offer what to drop.

## 5. Films and TV

1. Films: a Jellyfin film plays straight away, and Resume works after stopping halfway.
2. A title in both Jellyfin and IPTV: **Versions** lists both, library first.
3. Something from AIOStreams/TorBox plays. **Save to NAS** downloads it, it appears in Recordings › Downloads, then in Jellyfin.
   Also try Red in Versions, Options › Keep a copy while it plays, an episode's Save to NAS and the phone's Save button. The TV should say "saved and in Jellyfin" (see [save-to-nas.md](save-to-nas.md)).
4. A series: seasons and episodes, Up Next at the end of an episode.
5. With an OMDb key on the setup page: a film's page shows TMDB, IMDb and Rotten Tomatoes scores. **Trailer** plays the trailer in mpv; Back stops it. **More like this** lists only titles that can play, and Home has **Because you watched** after playing something ([watching-extras.md](watching-extras.md)).
6. With an OpenSubtitles key: a TorBox or IPTV film with no subtitles, on a profile with Subtitles On, gets subtitles a few seconds in ("Subtitles added from OpenSubtitles"). Yellow › Subtitles › Find more online lists others; pick one and check the timing. Settings › Picture and sound › Subtitle size, Dark box and Raised change them while the film plays.

## 6. Profiles

1. Set a PIN on Family. Switch to Kids: only kids' channels in the guide, only U/PG films, no Settings.
2. Try to switch back to Family: it asks for the PIN.
3. Turn the TV off and on: it goes to the profile picker.

## 6b. Music

Update the box first (Settings › About › Update the box): the update builds the Spotify receiver. See [music.md](music.md).

1. Music tab: Spotify shows "Sign in to Spotify from your phone". In the Spotify app on your phone, play a song, tap the devices button and pick **UltimateTV**. The music moves to the TV, and your playlists, albums and artists appear in the Music tab.
2. Restart the box: Spotify is still signed in and the playlists come back.
3. Play a playlist, then Shuffle; skip with Next and the remote's fast forward; change the volume. Sound comes from the TV.
4. Start a film: the music pauses. Press Play/Pause on Home with no film playing: the music plays and pauses.
5. Sign in with a code instead: (to test it) press **Not listed? Sign in with a code**. A code shows within a few seconds; enter it at spotify.com/pair. Once signed in, the TV is in the phone's devices list again.
6. Phone remote, Watch › Music: before signing in it shows the same steps; after, the playlists.
7. Deezer: scan the "Log in to Deezer" QR code in Music services, type your Deezer email and password on the phone (a Google-only account needs a Deezer password first, see music.md). Deezer opens on the TV and logs in, and the phone says "Logged in", or what Deezer said. Try a wrong password once: the phone shows Deezer's message. Arrows move a blue highlight, OK presses, Play/Pause plays. Back returns to the app and the music keeps going, with Deezer's song in Now Playing.
8. If Spotify says it isn't starting: the TV shows the receiver's own message. Also `systemctl --user -M tv@ status ultimatetv-spotify` and `journalctl --user -M tv@ -u ultimatetv-spotify` on the box.

## 7. TV remote (when the Pulse-Eight adapter arrives)

1. Plug it in between the box and the TV, turn on CEC on the TV.
2. Every button: arrows, OK, Back, Home, the colour keys, numbers, channel up and down, play/pause, rewind and fast forward, Guide and Info. Note any that do nothing.
3. Turn the TV off: playback stops. Turn it on: the TV switches to the box.
4. **TV apps** along the top: after the note, the TV leaves for its own Home (Netflix and the rest). Input › UltimateTV comes back to Home. If the TV stays put, try the other ways in Settings › Picture and sound › TV apps button, and note which one the Hisense needs ([watching-extras.md](watching-extras.md)).

## 8. Music video channels

1. Settings › Music channels: the downloader shows a yt-dlp version, and Clubland TV, House TV and Halloween TV count up their ready videos over the first hour or so (files appear in `Music Videos` on the NAS).
2. Channel 390 in the guide (Music list) shows one programme per video. Tune in: a video starts part-way through, the next one follows straight on, and the banner's Now matches the song.
3. Watch for a while: no video repeats until all the channel's videos have played.
4. Create a channel ("Oasis, Blur, Pulp"); within a few minutes it has videos. Take one off (OK on it): it disappears from the guide and another replaces it.

### YouTube playlists on a channel

Update the Hub first. Use a short public playlist of 4 or 5 music videos.

1. TV: Settings › Music channels › a channel › **Add a YouTube playlist**. Open the phone remote's keyboard, paste the link and Send: it appears in the dialog; Done. A toast says the Hub is reading it.
2. The channel screen gets a **Playlists it follows** row showing the playlist's name and "N of M downloaded · downloading 40% · K waiting". Its videos list as "playlist: <name>" and go Waiting, Downloading, then HD or 4K.
3. When they're done, tune the channel in: playlist videos play and the caption shows them. Pull the NAS cable or stop the Hub's internet: they still play.
4. Phone settings page › Music channels › Videos: the same playlist shows with Check now, Stop following and Remove. Paste a playlist link into "Add a video": it is taken as a playlist.
5. Add a video to the YouTube playlist, then press **Check now**: the new video downloads. Remove one from it: **Check now** takes it off the channel.
6. Try a private playlist link: the playlist row says it couldn't be read and why, and the channel keeps playing.
7. **Remove** the playlist: its videos leave the channel and `Music Videos` on the NAS. **Stop following** instead keeps them.
8. Leave the Hub overnight: the playlist is read again by itself (the Hub log says "Music channel playlist read").

## 8b. Downloads to the box

1. Update the Hub and the box. On a film's page, **Download to box**: a toast says how much room is free, and a **Downloaded** tab appears on the top menu with the film counting up.
2. On a series, **Download to box** › All of Series 1: the episodes download one after another, and each episode card gets a Downloaded badge as it finishes.
3. Play the film from the **Downloaded** tab: the player shows "Downloaded" as the source. Stop half way, then play it again: it resumes.
4. Unplug the box's network cable and play it again: it still plays.
5. The phone remote's **On the box** tab shows the same list with percentages; ✕ deletes one.
6. Switch to Kids: the Downloaded tab only lists what Kids may watch.

## 8c. Cast, games and the everyday extras

See [casting-and-games.md](casting-and-games.md) for the one-off setup (box installer, HTTPS port,
controller pairing).

- [ ] iPhone: Control Centre › Screen Mirroring lists the TV; mirroring shows full screen; Back on the TV remote ends it and the app comes back.
- [ ] Laptop: `https://<hub>:8096/cast/` in Chrome, accept the certificate warning, Share my screen; the TV asks; OK shows it; Back stops it; Stop sharing on the laptop also returns the TV.
- [ ] Phone remote › Cast: a YouTube link plays on the TV; a photo shows full screen; sharing a link from the YouTube app to the installed remote opens Cast.
- [ ] Cast and games: RetroArch opens full screen with a Bluetooth pad; quitting it brings the TV app back. Same for Moonlight (with Sunshine on a PC).
- [ ] Kids profile: AirPlay is dropped, a laptop share is refused, games are hidden.
- [ ] Sleep timer of 15 minutes from Options: the card shows a minute before; OK adds 15 minutes; left alone, the sound fades and the TV turns off.
- [ ] Alerts: set an ntfy topic, Send a test alert; it arrives on the phone.
- [ ] Red on a film saves it; it's on Home under Saved for later; "save Dune for later" by voice adds it too.
- [ ] A recording from an ad-funded channel shows Skip adverts in its breaks (give comskip a few minutes after it finishes).
- [ ] Settings › Seasonal clips › Try one now shows a projection; download one from Shared by others.
- [ ] Weather: on the phone's Settings › Weather, find your postcode and Use it. Home shows today's weather in the corner and the temperature by the clock; OK on the temperature opens the forecast, and the days show their hours. "What's the weather like" by voice opens it. The screensaver shows it under the clock.

## 8d. Themes, queue, screensavers and projected clips

These have no checks elsewhere in this run.

- [ ] Settings › Theme: moving over a tile previews it; pick Cyberpunk and the phone remote follows. Turn Seasonal on and check the right theme on its dates ([themes.md](themes.md)).
- [ ] Play queue: add a film and a recording from the TV and one from the phone; they play in order, and the queue survives a box restart.
- [ ] Screensaver › Try it now, then leave the TV idle: it dims at 10 minutes and the screensaver starts at 20. A NAS photo folder shows your photos.
- [ ] Projected clips: put on a starter pack (Christmas) over a 4K film; the animation stays smooth and its sound plays over the film. Send a `.utvpack` from the phone and add it from the QR code. Loop mode runs for an evening ([projected-clips.md](projected-clips.md#not-tested-on-the-box-yet)).
- [ ] A trip: `travel.sh away` on the box, then `travel.sh home` sends the changes back ([travel.md](travel.md)).

## 8e. Hub backup and the box without the Hub

See [backup.md](backup.md). Update the Hub and the box first.

- [ ] Ten minutes after the Hub starts, `/mnt/nas/.ultimatetv-backups` (on the Docker LXC: `/mnt/nas/video/.ultimatetv-backups`) has an `ultimatetv-hub-….tar.gz`. Settings › About › Hub backup on the TV and ⚙ Settings › Hub backup on the phone show it, "on the NAS".
- [ ] Back up now on the phone adds another; the next morning there's one from 03:30.
- [ ] `bash tools/hub/update.sh` prints "Backed up to …" before it rebuilds.
- [ ] Change something small (rename the app), then Restore the earlier backup from the phone: the Hub restarts within a minute and the old name is back. `bash tools/hub/restore.sh` lists the same files.
- [ ] `docker stop ultimatetv-hub`: within a minute or so (nothing playing) the TV shows the box's own screen with the time, "Can't reach the Hub" and the downloads. Play one with OK; Back stops it.
- [ ] `docker start ultimatetv-hub`: the TV app comes back by itself.
- [ ] Reboot the box with the Hub stopped: it goes straight to the box's screen, not a blank one.
- [ ] On Kids, stop the Hub: only Kids' downloads show, and no games.

## 8f. Skip intro and accessibility

Skip intro: see [watching-extras.md](watching-extras.md#skip-intro-everywhere). Update the Hub and the box first.

- [ ] `node tools/jellyfin/intro-skipper.mjs install`, then `scan`; when Dashboard › Scheduled Tasks shows it finished, `check` lists intro markers on most episodes, and `check --series "<a recorded series>"` on a recorded one.
- [ ] Play one of those episodes: **Skip intro** shows during the titles and OK lands just after them.
- [ ] Near the end of an episode with credits marked: Up Next shows as the credits start, counts down from 15, and the next episode plays. Back hides it and the credits carry on.
- [ ] An episode without markers still gets Up Next in the last 30 seconds.

Accessibility: see [accessibility.md](accessibility.md).

- [ ] Settings › Accessibility › Text size 150%: Home, the guide, a film's page, Settings, Music, Recordings and Cast and games have no cut-off or overlapping writing. Readable from the sofa?
- [ ] Bold focus: the yellow ring is easy to follow on the dark and light themes, and in the guide it's round the programme.
- [ ] Reduce motion: screens don't slide, a seasonal clip sent from the phone doesn't appear, and the drawn screensaver (Aurora) is still.
- [ ] Audio description on: a BBC channel or a film known to have a described track switches to it a few seconds after starting, and says so. Yellow › Audio shows it as "Audio description". Off again: the plain track plays.
- [ ] Switch to the Kids profile and back: each keeps its own settings. The phone's setup page shows and changes the same ones.

## 9. The WAF test

Hand over the remote with no instructions and ask for: watch BBC One; find tonight's film and record it; set a series link; carry on the film from yesterday; find a 4K comedy.
