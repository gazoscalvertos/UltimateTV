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

1. Settings › Phone remote: scan the code. Arrows, OK, Back, colour keys, numbers and typing in Search should all work.
2. Install the Android app ([phone-remote.md](phone-remote.md)). Volume up and down should change channel.

## 4. Recording and series link

1. In the guide, press red on something starting soon and choose **Just this episode**. It should appear in Recordings › Coming up, then record, then play from Recorded.
2. Set a series link on a daily programme. Next day, Recordings › Series links should show the next episodes scheduled.
3. Record two things on at the same time while watching a third channel: the app should warn about the connection limit and offer what to drop.

## 5. Films and TV

1. Films: a Jellyfin film plays straight away, and Resume works after stopping halfway.
2. A title in both Jellyfin and IPTV: **Versions** lists both, library first.
3. Something from AIOStreams/TorBox plays. **Save to NAS** downloads it, it appears in Recordings › Downloads, then in Jellyfin.
4. A series: seasons and episodes, Up Next at the end of an episode.

## 6. Profiles

1. Set a PIN on Family. Switch to Kids: only kids' channels in the guide, only U/PG films, no Settings.
2. Try to switch back to Family: it asks for the PIN.
3. Turn the TV off and on: it goes to the profile picker.

## 6b. Music

Update the box first (Settings › About › Update the box): the update builds the Spotify receiver.

1. Music tab: it shows a code. On your phone go to spotify.com/pair (or scan the QR code) and enter it. Your playlists, albums and artists appear.
2. Play a playlist, then Shuffle; skip with Next and the remote's fast forward; change the volume. Sound comes from the TV.
3. In the Spotify app on your phone, pick **UltimateTV** from the devices list: it carries on playing on the TV, and the Music tab follows.
4. Start a film: the music pauses. Press Play/Pause on Home with no film playing: the music plays and pauses.
5. Deezer: scan the "Log in to Deezer" QR code in Music services, type your email and password on the phone and press Log in on the TV. Deezer opens on the TV and logs in (tick any "I'm not a robot" box with the remote). Google or Facebook login won't open. Arrows move a blue highlight, OK presses, Play/Pause plays. Back returns to the app and the music keeps going, with Deezer's song in Now Playing. Note anything you can't reach with the arrows.
6. If Spotify says it isn't set up: `systemctl --user -M tv@ status ultimatetv-spotify` and `journalctl --user -M tv@ -u ultimatetv-spotify` on the box.

## 7. TV remote (when the Pulse-Eight adapter arrives)

1. Plug it in between the box and the TV, turn on CEC on the TV.
2. Every button: arrows, OK, Back, Home, the colour keys, numbers, channel up and down, play/pause, rewind and fast forward, Guide and Info. Note any that do nothing.
3. Turn the TV off: playback stops. Turn it on: the TV switches to the box.

## 8. The WAF test

Hand over the remote with no instructions and ask for: watch BBC One; find tonight's film and record it; set a series link; carry on the film from yesterday; find a 4K comedy.
